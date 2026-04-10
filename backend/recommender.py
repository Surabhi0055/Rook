from __future__ import annotations
import hashlib
import os
import re
import requests
import numpy as np
import pandas as pd
import joblib
import faiss
import ollama
from datetime import datetime
from functools import lru_cache
from sqlalchemy.orm import Session
from sqlalchemy import select
from models import Rating, Book
from concurrent.futures import ThreadPoolExecutor, as_completed
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
from sklearn.decomposition import TruncatedSVD

try:
    from cachetools import TTLCache
    _HAS_CACHETOOLS = True
except ImportError:
    _HAS_CACHETOOLS = False

# ── Config ────────────────────────────────────────────────────────────────────
GOOGLE_BOOKS_API_KEY = os.getenv("GOOGLE_BOOKS_API_KEY", "")
_GBOOKS_URL          = "https://www.googleapis.com/books/v1/volumes"

_EMBED_MODEL        = "nomic-embed-text"
_LLM_MODEL          = os.getenv("ROOK_LLM_MODEL", "llama3.2:3b")
_LLM_MODEL_FALLBACK = "llama3.2:1b"
_BASE_DIR = os.path.dirname(os.path.abspath(__file__))
_PROJ_DIR = os.path.dirname(_BASE_DIR)

_FAISS_INDEX_PATH   = os.path.join(_PROJ_DIR, "models", "book_faiss.index")
_BOOK_META_PATH     = os.path.join(_PROJ_DIR, "models", "book_meta.pkl")

_llm_query_cache: dict = {}
_LLM_CACHE_MAX        = 200
_SEM_W                = 0.45
_CONT_W               = 0.25
_COLLAB_W             = 0.15
_RATING_W             = 0.15
_RL_ALPHA             = 0.30
_FUSED_SOFT_POP_FLOOR = 20

# data loading
try:
    model      = joblib.load(os.path.join(_PROJ_DIR, "models", "svd_model.pkl"))
    _tfidf     = joblib.load(os.path.join(_PROJ_DIR, "models", "tfidf_vectorizer.pkl"))
    _tfidf_matrix = load_npz(os.path.join(_PROJ_DIR, "models", "tfidf_matrix.npz"))
    cosine_sim = joblib.load(os.path.join(_PROJ_DIR, "models", "cosine_sim.pkl"))

    ratings = pd.read_csv(os.path.join(_PROJ_DIR, "dataset", "ratings_processed.csv"))
    books = pd.read_csv(os.path.join(_PROJ_DIR, "dataset", "books_genre.csv"))
    books["title"] = books["title"].fillna("")
    books["authors"] = books["authors"].fillna("")
    books["description"] = books["description"].fillna("")
    books["genre"] = books["genre"].fillna("")
except Exception as e:
    print(f"[recommender] WARNING: Missing essential ML models or CSV datasets. Error: {e}")
    model = None
    _tfidf = None
    _tfidf_matrix = None
    cosine_sim = None
    ratings = pd.DataFrame(columns=["user_id", "book_id", "rating"])
    books = pd.DataFrame(columns=["book_id", "title", "authors", "description", "genre", "average_rating", "rating_count", "image_url", "title_clean", "authors_clean", "genre_clean"])

if len(books) > 0:
    books = books[books["title"].apply(lambda x: isinstance(x, str) and bool(str(x).strip()))].copy()
books = books.reset_index(drop=True)
print(f"[startup] Books loaded: {len(books)}")

books["title_clean"]   = books["title"].fillna("").str.lower().str.strip()
books["authors_clean"] = books["authors"].fillna("").str.lower().str.strip()

if "tag_name" in books.columns:
    _raw_genre = books["tag_name"].fillna("")
elif "genres" in books.columns:
    _raw_genre = books["genres"].fillna("")
else:
    _raw_genre = pd.Series([""] * len(books))
books["genre_clean"] = _raw_genre.str.lower().str.strip()

_ALL_DESC_COLS = [
    "description", "summary", "book_description", "synopsis",
    "overview", "about", "desc", "plot", "blurb",
    "best_book_description", "work_description", "content",
]
_DESC_COL = next((c for c in _ALL_DESC_COLS if c in books.columns), None)
print(f"[startup] DESC_COL={_DESC_COL!r}")

_BAD_VALUES = {"nan", "none", "n/a", "", "no description available.",
               "no description available for this book."}
if _DESC_COL:
    books["description"] = books[_DESC_COL].fillna("").str.strip()
    books.loc[books["description"].str.lower().isin(_BAD_VALUES), "description"] = ""
else:
    books["description"] = ""

if "image_url" not in books.columns:
    books["image_url"] = ""
books["image_url"] = books["image_url"].fillna("").str.strip()
books["image_url"] = books["image_url"].str.replace(r"^http://", "https://", regex=True)
_bad_img = books["image_url"].str.match(
    r".*(nophoto\.|placeholder\.|no-cover|nocover).*", case=False, na=False
)
books.loc[_bad_img, "image_url"] = ""

_YEAR_COL_CANDIDATES = [
    "original_publication_year", "publication_year", "publish_date",
    "published_date", "year", "pub_year", "work_publication_year",
]
_YEAR_COL = next((c for c in _YEAR_COL_CANDIDATES if c in books.columns), None)

def _extract_year(val) -> str:
    if pd.isna(val): return ""
    m = re.search(r'\b(1[0-9]{3}|20[0-9]{2})\b', str(val).strip())
    return m.group(1) if m else ""

if _YEAR_COL:
    books["published_year"] = books[_YEAR_COL].apply(_extract_year)
else:
    books["published_year"] = ""
    for col in _YEAR_COL_CANDIDATES:
        if col in books.columns:
            mask = books["published_year"] == ""
            books.loc[mask, "published_year"] = books.loc[mask, col].apply(_extract_year)

_rc   = ratings.groupby("book_id").size().reset_index(name="rating_count")
books = books.merge(_rc, on="book_id", how="left")
books["rating_count"] = books["rating_count"].fillna(0).astype(int)
if "average_rating" not in books.columns:
    books["average_rating"] = 0.0
books["average_rating"] = pd.to_numeric(books["average_rating"], errors="coerce").fillna(0.0)
books = books.reset_index(drop=True)

# page-count detection
_PAGE_COLS = ["num_pages", "pages", "page_count", "number_of_pages", "book_pages"]
_PAGE_COL  = next((c for c in _PAGE_COLS if c in books.columns), None)
if _PAGE_COL:
    books["_pages"] = pd.to_numeric(books[_PAGE_COL], errors="coerce").fillna(0).astype(int)
    print(f"[startup] Page-count column: {_PAGE_COL!r}  "
          f"(populated: {(books['_pages'] > 0).sum()} / {len(books)})")
else:
    books["_pages"] = 0
    print("[startup] No page-count column found — reading-time recs use genre fallback")

# tag parsing
def _split_tags(s) -> list[str]:
    if not s or not isinstance(s, str) or not s.strip():
        return []
    s = s.strip()
    if   "," in s: parts = [t.strip().lower() for t in s.split(",")]
    elif "|" in s: parts = [t.strip().lower() for t in s.split("|")]
    else:          parts = [t.strip().lower() for t in s.split()]
    return [p.replace(" ", "-") for p in parts if p and not p.isdigit()]

_ALL_TAG_COLS = [c for c in ["tag_name", "genres", "genre", "tags", "categories",
                               "subject", "subjects", "genre_list", "tag_list",
                               "content_features", "content"] if c in books.columns]

def _collect_all_tags(row) -> list[str]:
    seen, out = set(), []
    for col in _ALL_TAG_COLS:
        val = row[col] if col in row.index else ""
        for t in _split_tags(str(val or "")):
            if t not in seen: seen.add(t); out.append(t)
    val = row["genre_clean"] if "genre_clean" in row.index else ""
    for t in _split_tags(str(val or "")):
        if t not in seen: seen.add(t); out.append(t)
    return out

books["all_tags"]   = books.apply(_collect_all_tags, axis=1)
books["genre_tags"] = books["genre_clean"].apply(_split_tags)

_rng_init = np.random.default_rng(seed=42)
books["_trend_score"] = (
    books["average_rating"] * np.log1p(books["rating_count"])
    + _rng_init.random(len(books)) * 0.05
)
_trending_order = books["_trend_score"].argsort()[::-1].values
_MAX_RC = float(books["rating_count"].max()) if len(books) else 1.0

_book_id_to_idx: dict         = {int(bid): int(idx) for idx, bid in enumerate(books["book_id"])}
_title_to_row_idx: dict       = {str(t).strip(): int(i) for i, t in enumerate(books["title"])
                                  if isinstance(t, str) and t.strip()}
_title_clean_to_row_idx: dict = {str(t).strip().lower(): int(i) for i, t in enumerate(books["title"])
                                  if isinstance(t, str) and t.strip()}

# known-genre overrides
_TITLE_GENRE_OVERRIDES: dict[str, set[str]] = {
    "harry potter":           {"fantasy", "magic", "young-adult"},
    "lord of the rings":      {"fantasy", "epic-fantasy"},
    "fellowship of the ring": {"fantasy", "epic-fantasy"},
    "two towers":             {"fantasy", "epic-fantasy"},
    "return of the king":     {"fantasy", "epic-fantasy"},
    "the hobbit":             {"fantasy", "epic-fantasy"},
    "jrr tolkien":            {"fantasy", "epic-fantasy"},
    "carrie":                 {"horror", "scary"},
    "the shining":            {"horror", "scary"},
    "salem's lot":            {"horror", "scary"},
    "pet sematary":           {"horror", "scary"},
    "the stand":              {"horror", "sci-fi"},
    "fullmetal alchemist":    {"manga", "graphic-novel", "anime"},
    "naruto":                 {"manga", "graphic-novel", "anime"},
    "one piece":              {"manga", "graphic-novel", "anime"},
    "attack on titan":        {"manga", "graphic-novel", "anime"},
    "death note":             {"manga", "graphic-novel", "anime"},
    "ender's game":           {"science-fiction", "sci-fi"},
    "dune":                   {"science-fiction", "sci-fi"},
    "the hunger games":       {"science-fiction", "dystopia", "young-adult"},
    "hunger games":           {"science-fiction", "dystopia", "young-adult"},
    "divergent":              {"science-fiction", "dystopia", "young-adult"},
    "percy jackson":          {"fantasy", "young-adult"},
    "chronicles of narnia":   {"fantasy", "children"},
    "game of thrones":        {"fantasy", "epic-fantasy"},
    "a song of ice":          {"fantasy", "epic-fantasy"},
    "wheel of time":          {"fantasy", "epic-fantasy"},
    "mistborn":               {"fantasy", "epic-fantasy"},
    "the name of the wind":   {"fantasy", "epic-fantasy"},
    "eragon":                 {"fantasy", "young-adult"},
}

def _get_effective_tags(row_idx: int) -> list[str]:
    row       = books.iloc[row_idx]
    base_tags = list(row["all_tags"])
    title_lc  = str(row.get("title_clean", ""))
    for fragment, inject_tags in _TITLE_GENRE_OVERRIDES.items():
        if fragment in title_lc:
            for t in inject_tags:
                if t not in base_tags: base_tags.append(t)
            break
    return base_tags

# genre exclusion tables
_DESC_EXTRA_EXCLUSIONS: dict[str, set[str]] = {
    "summer": {"fantasy", "epic-fantasy", "high-fantasy", "young-adult", "ya","magic", "wizards", "dragons",        "children", "childrens", "kids", "middle-grade",        "classics",        "manga", "graphic-novel", "comics",        "pillar", "kingsbridge",    },
    "romance": {"fantasy", "epic-fantasy", "high-fantasy", "magic", "wizards","children", "childrens", "kids", "middle-grade","manga", "graphic-novel","classics",},
    "cosy": {"epic-fantasy", "high-fantasy", "fantasy", "magic","science-fiction", "sci-fi", "dystopia","horror", "dark", "gothic","children", "manga", "graphic-novel","classics",},
}

_HARD_TITLE_BLACKLIST = {"harry potter", "anne of green gables", "the pillars of the earth", "the kingsbridge series", "the great book of amber", "chronicles of amber", "the very hungry caterpillar", "the americas test kitchen", "taste of home cookbook", "america's test kitchen",  "dr seuss", "sherlock holmes",  "forever in blue", "second summer of the sisterhood",
    "the door into summer", "a room with a view", "pride and prejudice", "the thorn birds", "nine stories", "hard eight","pablo neruda", "the poetry of pablo neruda", "twenty love poems", "the hitchhiker's guide", "ultimate hitchhikers guide",}

_GENRE_EXCLUSION_TAGS: dict[str, set[str]] = {
    "romance": {"fantasy", "epic-fantasy", "high-fantasy", "dark-fantasy", "urban-fantasy","magic", "wizards", "dragons", "sword-and-sorcery", "fairy-tales", "mythology","science-fiction", "sci-fi", "scifi", "space", "dystopia", "dystopian","cyberpunk", "steampunk", "aliens", "post-apocalyptic","horror", "scary", "occult","children", "childrens", "kids", "middle-grade","non-fiction", "nonfiction", "biography", "autobiography", "memoir","self-help", "business", "economics", "philosophy", "psychology",  "history", "politics", "science", "travel", "essays",  "graphic-novel", "comics", "manga", "anime", "poetry", },
    "fiction": { "non-fiction", "nonfiction", "biography", "autobiography", "memoir","self-help", "business", "economics", "philosophy", "psychology", "history", "politics", "science", "travel", "essays","graphic-novel", "comics", "manga", "anime", "true-story", "true-crime", },
    "fantasy": {"romance-novels", "chick-lit", "contemporary-romance", "biography", "autobiography", "memoir", "non-fiction", "nonfiction",  "self-help", "business", "manga", "anime",},
    "mystery":  {"children", "childrens", "kids", "middle-grade"},
    "thriller": {"children", "childrens", "kids", "middle-grade"},
    "horror":   {"children", "childrens", "kids", "middle-grade", "romance-novels", "chick-lit"},
    "self-help": {"fiction", "literary-fiction", "fantasy", "horror", "thriller", "romance-novels", "mystery"},
    "biography": {"fiction", "literary-fiction", "fantasy", "horror", "thriller", "romance-novels", "mystery"},
    "summer": { "horror", "scary", "occult", "dark-fantasy", "gothic", "non-fiction", "nonfiction", "biography", "autobiography", "memoir", "philosophy", "psychology", "economics", "essays", "epic-fantasy", "high-fantasy", "science-fiction", "sci-fi",},
    "morning": {"horror", "scary", "occult", "epic-fantasy", "high-fantasy", "non-fiction", "nonfiction", "biography", "poetry", "manga", "graphic-novel", "children", "childrens", "kids",},
    "early_morning": { "horror", "scary", "fantasy", "epic-fantasy", "high-fantasy", "romance-novels", "graphic-novel", "manga", "thriller", "children", "childrens", "kids",},
    "afternoon": { "horror", "scary", "occult", "non-fiction", "nonfiction", "biography", "philosophy", "essays", "epic-fantasy", "high-fantasy", "manga", "graphic-novel",},
    "late_afternoon": {"horror", "scary", "occult", "graphic-novel", "manga", "children", "childrens", "kids", "middle-grade",},
    "evening": {  "children", "childrens", "kids", "middle-grade","non-fiction", "nonfiction", "biography", "self-help",  "epic-fantasy", "high-fantasy", "manga", "graphic-novel",},
    "night": { "horror", "scary", "occult", "non-fiction", "nonfiction", "biography", "self-help", "philosophy","epic-fantasy", "high-fantasy", "science-fiction", "sci-fi","children", "childrens", "kids", "middle-grade","manga", "graphic-novel",},
    "late_night": {"children", "childrens", "kids", "middle-grade", "romance-novels", "chick-lit", "comedy", "epic-fantasy", "high-fantasy",},
    "winter": {"chick-lit", "contemporary-romance", "romance-novels", "comedy", "humor",},
    "long flight": {"non-fiction", "nonfiction", "biography", "autobiography", "philsophy", "essays", "poetry",},
    "beach": {"horror", "scary", "gothic", "occult","non-fiction", "nonfiction", "philosophy", "psychology", "essays",  "epic-fantasy", "high-fantasy", "science-fiction",},
    "road trip": {"horror", "scary", "occult", "gothic", "fantasy", "epic-fantasy", "science-fiction",    },
    "30 minutes": { "epic-fantasy", "high-fantasy", "fantasy", "science-fiction", "sci-fi","history", "biography", "autobiography", "memoir", "non-fiction", "nonfiction","philosophy", "politics", "economics", "essays", "self-help","horror", "gothic", "occult",},
    "2 hours": { "epic-fantasy", "high-fantasy", "non-fiction", "nonfiction","biography", "autobiography", "memoir", "philosophy", "economics","history", "politics", "essays",},
    "weekend": {"children", "childrens", "kids", "middle-grade","poetry", "short-stories", "anthology","comedy", "humor", "humour",},
    "train": {"horror", "scary", "non-fiction", "nonfiction", "philosophy", "essays",},
    "hopeful": { "epic-fantasy", "high-fantasy", "fantasy", "horror", "scary", "occult", "dark-fantasy", "gothic", "non-fiction", "nonfiction", "philosophy", "economics", "science-fiction", "sci-fi", "manga", "graphic-novel",},
    "emotional": { "epic-fantasy", "high-fantasy", "fantasy", "comedy", "humor", "humour","science-fiction", "sci-fi", "manga", "graphic-novel",},
    "adventurous": {"epic-fantasy", "high-fantasy", "romance-novels", "chick-lit", "contemporary-romance", "non-fiction", "nonfiction", "biography", "philosophy", "essays",  "manga", "graphic-novel",},
    "romantic": {"epic-fantasy", "high-fantasy", "fantasy","horror", "scary", "occult",  "science-fiction", "sci-fi","non-fiction", "nonfiction", "biography", "philosophy", "history", "manga", "graphic-novel", "children", "childrens", "kids",},
    "dark": { "epic-fantasy", "high-fantasy", "children", "childrens", "kids", "middle-grade", "comedy", "humor", "humour", "romance-novels", "chick-lit",  "non-fiction", "nonfiction", "self-help", "manga", "graphic-novel",},
    "cosy": {"epic-fantasy", "high-fantasy", "fantasy","horror", "scary", "occult", "gothic","science-fiction", "sci-fi","non-fiction", "nonfiction", "biography", "philosophy", "manga", "graphic-novel",},
    "intellectual": {"epic-fantasy", "high-fantasy", "fantasy","romance-novels", "chick-lit", "comedy", "humor", "manga", "graphic-novel", "children", "childrens", "kids", "horror", "scary",},
    "tense": { "epic-fantasy", "high-fantasy", "fantasy","children", "childrens", "kids", "middle-grade","romance-novels", "chick-lit", "comedy", "non-fiction", "nonfiction", "self-help", "biography", "manga", "graphic-novel",},
    "dreamy": {"epic-fantasy", "high-fantasy", "non-fiction", "nonfiction", "biography", "history","science-fiction", "sci-fi", "dystopia", "children", "childrens", "kids", "manga", "graphic-novel",},
    "funny": {"epic-fantasy", "high-fantasy", "fantasy","horror", "scary", "occult","non-fiction", "nonfiction", "biography", "philosophy", "science-fiction", "sci-fi","manga", "graphic-novel",},
    "reflective": { "epic-fantasy", "high-fantasy", "fantasy","science-fiction", "sci-fi","horror", "scary", "occult", "comedy", "humor", "humour","manga", "graphic-novel", "children", "childrens", "kids",},
    "mysterious": { "epic-fantasy", "high-fantasy", "fantasy","comedy", "humor", "humour","romance-novels", "chick-lit", "non-fiction", "nonfiction", "self-help","manga", "graphic-novel", "children", "childrens", "kids", },
}

_GENRE_TITLE_EXCLUSIONS: dict[str, list[str]] = {
    "romance": ["harry potter", "lord of the rings", "fellowship of the ring", "two towers", "return of the king", "the hobbit", "tolkien", "carrie", "the shining", "salem's lot", "pet sematary","fullmetal alchemist", "naruto", "one piece", "attack on titan",  "death note", "ender's game", "hunger games", "divergent","percy jackson", "chronicles of narnia", "game of thrones", "a song of ice", "wheel of time", "mistborn", "the name of the wind",  "eragon", "inheritance cycle",  ],}

_DESC_INTENT_PATTERNS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\bsad\b|\btragic\b|\btragedy\b|\bcry\b|\bcries\b|\btears\b|"r"\bheartbreak\b|\bheartbreaking\b|\bheartwrenching\b|\bheart.wrench|" r"\bgrief\b|\bmourning\b|\bloss\b|\bdeath\b|\bdying\b|\bbereave|" r"sad ending|tragic ending|sad conclusion|emotional ending|"r"makes you cry|will make you cry|book that makes|bittersweet", re.I), "emotional"),
    (re.compile( r"rom[\s-]?com|romantic comedy|chick.?lit|beach read|" r"enemies.to.lovers|fake.?dating|friends.to.lovers|" r"summer romance|holiday romance|feel.?good romance|light.?heart", re.I), "summer"),
    (re.compile(r"\bpink\b|\bpastel\b|\bspringy\b|\bcute\b|\bfresh\b|\bfluffy\b|" r"spring vibes?|pink vibes?|cottagecore|soft aesthetic|" r"wholesome.*romance|sweet.*romance|light.*romance|" r"feel.?good|uplifting.*romance|charming.*romance", re.I), "hopeful"),
    (re.compile(r"\bsummer\b|\bbeach\b|\bholiday\b|\bsun[ny]?\b|\bwarm\b|\bvacation\b|\btropic", re.I ), "summer"),
    (re.compile(r"\bromance\b|\bromantic\b|\blove story\b|\bslow.?burn\b|\bpassionate love\b|" r"love.*book|book.*love",re.I), "romance"),
    (re.compile( r"\bthriller\b|\bsuspense\b|\bpsychological\b|\bmurder\b|\bdetective\b|"r"\bnoir\b|\bwhodunit\b|\bcrime fiction\b|\bserial killer\b|\bcriminal\b", re.I), "tense"),
    (re.compile(r"\bfantasy\b|\bmagic\b|\bdragon\b|\bwizard\b|\bfae\b|\bepic quest\b|\bhigh fantasy\b",re.I), "fiction"),
    (re.compile(r"\bcozy\b|\bcosy\b|\bcomforting\b|\bwholesome\b|\bcharming\b|\bvillage\b|"r"\bfeel.?good\b|\bcottage\b|\bwarm.*hug\b", re.I ), "cosy"),
    (re.compile( r"\bdark\b|\bgritty\b|\bsinister\b|\bbleak\b|\bunsettling\b|\bdisturbing\b|"r"\bdystoп\b|\bdystopia\b|\bpost.?apocal",re.I ), "dark"),
    (re.compile(r"\bfunny\b|\bhumor\b|\bhumour\b|\bcomic\b|\babsurd\b|\bwitty\b|\blaugh\b|"r"\bsatiric\b|\bsatire\b|\bhilarious\b", re.I ), "funny"),
    (re.compile( r"\bhealing\b|\brecovery\b|\bovercoming\b|\bsurviving\b|\bresilience\b|"r"\bgrowing through\b|\bfinding hope\b",re.I), "hopeful"),
    (re.compile( r"\bhopefu|\buplifting\b|\bredemptive\b|\binspiring\b|\boptimist",re.I ), "hopeful"),
    (re.compile( r"\bhistorical\b|\bancient\b|\bvictorian\b|\bmedieval\b|\bworld war\b|" r"\brome\b|\btutor\b|\bregency\b|\bperiod drama\b", re.I), "reflective"),
    (re.compile( r"\bself.?help\b|\bpersonal development\b|\bhabits\b|\bmindset\b|\bproductivity\b",re.I ), "intellectual"),
    (re.compile( r"\bbusiness\b|\bmarketing\b|\bsales\b|\bstartup\b|\bentrepreneur\b|\bleadership\b", re.I), "intellectual"),
    (re.compile( r"\bsports?\b|\bteam spirit\b|\bathlete\b|\bchampionship\b|\bcoach\b|\bcompetition\b",re.I), "adventurous"),
    (re.compile( r"\beducation\b|\blearning\b|\bteaching\b|\bpedagogy\b|\bschool\b|\bacademic\b", re.I ), "intellectual"),
    (re.compile(r"\bnature\b|\bastronomy\b|\bplanet\b|\bstar\b|\bcosmos\b|\bgeograph\b|\bwildlife\b|\becolog",re.I), "intellectual"),
    (re.compile(r"\bscience fiction\b|\bsci.?fi\b|\bdystop\b|\bfuturistic\b|\bspace\b|\brobots?\b|\balien\b", re.I), "adventurous"),
    (re.compile(r"\bcoming.of.age\b|\byoung adult\b|\bya novel\b|\bteen\b|\bfirst love\b|\bgrowing up\b",re.I), "hopeful"),
    (re.compile(r"\bdark academia\b|\bcampus\b|\bboarding school\b|\bgothic literary\b|\blyrical prose\b", re.I), "intellectual"),(re.compile( r"\bmysterious\b|\benigmatic\b|\bunreliable narrator\b|\bpuzzle\b|"r"\bhidden truth\b|\bcozy mystery\b|\bcosy mystery\b",re.I), "mysterious"),(re.compile(r"\bdream\b|\blyrical\b|\bpoetic\b|\bsurreal\b|\bmagical realism\b|\betherea",re.I), "dreamy"),]

def _detect_description_intent(description: str) -> str | None:
    for pattern, intent_key in _DESC_INTENT_PATTERNS:
        if pattern.search(description):
            return intent_key
    return None

def _is_title_blacklisted(title: str) -> bool:
    t = title.lower().strip()
    return any(frag in t for frag in _HARD_TITLE_BLACKLIST)

def _is_excluded_from_genre(row_idx: int, genre_key: str) -> bool:
    title_lc  = str(books.iloc[row_idx].get("title_clean", ""))
    for fragment in _GENRE_TITLE_EXCLUSIONS.get(genre_key, []):
        if fragment in title_lc:
            return True
    excl_tags = _GENRE_EXCLUSION_TAGS.get(genre_key, set())
    if not excl_tags:
        return False
    for tag in _get_effective_tags(row_idx):
        tag_norm = tag.replace(" ", "-")
        if tag_norm in excl_tags or tag in excl_tags:
            return True
        for excl in excl_tags:
            if len(excl) >= 6 and excl == tag_norm:
                return True
    return False

def _passes_description_filter(row_idx: int, intent_key: str | None) -> bool:
    title = str(books.iloc[row_idx].get("title_clean", ""))
    if _is_title_blacklisted(title):
        return False
    if intent_key and _is_excluded_from_genre(row_idx, intent_key):
        return False
    if intent_key and intent_key in _DESC_EXTRA_EXCLUSIONS:
        extra_excl = _DESC_EXTRA_EXCLUSIONS[intent_key]
        for tag in _get_effective_tags(row_idx):
            tag_norm = tag.replace(" ", "-").lower()
            if tag_norm in extra_excl or tag in extra_excl:
                return False
    return True

# content matrix (TF-IDF + SVD)
def _make_soup(row: pd.Series) -> str:
    desc   = " ".join([str(row.get("description", "") or "")] * 2)
    genre  = " ".join([str(row.get("genre_clean",  "") or "")] * 3)
    content= str(row.get("content",          "") or "").replace("-"," ").replace("_"," ")
    cf     = str(row.get("content_features", "") or "").replace("-"," ").replace("_"," ")
    author = " ".join([str(row.get("authors_clean","") or "")] * 2)
    title  = str(row.get("title_clean",      "") or "")
    return f"{desc} {content} {cf} {genre} {author} {title}".strip()

books["soup"]    = books.apply(_make_soup, axis=1)
_tfidf           = TfidfVectorizer(analyzer="word", ngram_range=(1, 2),
                                   min_df=2, max_features=40_000,
                                   stop_words="english", sublinear_tf=True)
_tfidf_matrix    = _tfidf.fit_transform(books["soup"])
_K               = min(120, _tfidf_matrix.shape[1] - 1)
_svd_desc        = TruncatedSVD(n_components=_K, random_state=42)
_latent_mat      = _svd_desc.fit_transform(_tfidf_matrix)

try:
    _pu          = model.pu; _qi = model.qi; _bu = model.bu; _bi = model.bi
    _global_mean = model.trainset.global_mean
    _uid_map     = model.trainset._raw2inner_id_users
    _iid_map     = model.trainset._raw2inner_id_items
    _book_inner  = np.array([_iid_map.get(int(bid), -1) for bid in books["book_id"]], dtype=np.int32)
    _USE_BATCH_SVD = True
    print("[startup] SVD batch mode: ON")
except AttributeError:
    _USE_BATCH_SVD = False
    print("[startup] SVD batch mode: OFF")

# semantic layer (FAISS)
_faiss_index: faiss.Index | None = None
_book_meta:   pd.DataFrame | None = None
_sem_ready:   bool = False

def _load_semantic_layer() -> None:
    global _faiss_index, _book_meta, _sem_ready
    try:
        if not os.path.exists(_FAISS_INDEX_PATH): return
        if not os.path.exists(_BOOK_META_PATH):   return
        _faiss_index = faiss.read_index(_FAISS_INDEX_PATH)
        _book_meta   = pd.read_pickle(_BOOK_META_PATH)
        _sem_ready   = True
        print(f"[semantic] FAISS loaded vectors={_faiss_index.ntotal}")
    except Exception as e:
        print(f"[semantic] Failed: {e}")

_load_semantic_layer()

def _embed_query(text: str) -> np.ndarray:
    dim = _faiss_index.d if _faiss_index else 768
    try:
        resp = ollama.embed(model=_EMBED_MODEL, input=text)
        vec  = np.array(resp["embeddings"][0], dtype=np.float32)
        norm = np.linalg.norm(vec)
        if norm > 0: vec = vec / norm
        return vec.reshape(1, -1)
    except Exception as e:
        print(f"[embed_query] {e}")
        return np.zeros((1, dim), dtype=np.float32)

def _semantic_search_raw(query_text: str, pool: int = 150, offset: int = 0) -> tuple[np.ndarray, np.ndarray]:
    if not _sem_ready or _faiss_index is None:
        return np.array([]), np.array([])
    vec = _embed_query(query_text)
    if np.allclose(vec, 0):
        return np.array([]), np.array([])
    fetch_n = pool + offset
    raw_scores, raw_indices = _faiss_index.search(vec, fetch_n)
    scores  = raw_scores[0]
    indices = raw_indices[0]
    valid_mask = indices >= 0
    scores  = scores[valid_mask]
    indices = indices[valid_mask]
    if offset > 0 and len(indices) > offset:
        scores  = scores[offset:]
        indices = indices[offset:]
    return scores[:pool], indices[:pool]

# genre aliases and index
_GENRE_ALIASES: dict[str, list[str]] = {
    "romance": ["romance","romance-novels","romantic","love","love-story","contemporary-romance","historical-romance","chick-lit", "romantic-suspense","paranormal-romance","regency-romance","romance-contemporary","romance-historical","romance-paranormal", "new-adult-romance","adult-romance","romances","romantic-fiction","clean-romance","sweet-romance","inspirational-romance","christian-romance","sports-romance","billionaire-romance",
        "second-chance-romance","enemies-to-lovers","slow-burn","slow-burn-romance","friends-to-lovers","forbidden-romance", "small-town-romance","office-romance","fake-dating","marriage-of-convenience","arranged-marriage",],
    "fantasy": ["fantasy","epic-fantasy","high-fantasy","dark-fantasy","urban-fantasy", "magic","sword-sorcery","fairy-tales","mythology","wizards","dragons",],
    "mystery": ["mystery","mysteries","detective","cozy-mystery","whodunit","noir","crime-fiction",],
    "thriller": [        "thriller","suspense","psychological-thriller","spy","espionage",        "legal-thriller","political-thriller",    ],
    "horror": [        "horror","gothic","supernatural","dark","scary","occult",    ],
    "science fiction": [        "science-fiction","sci-fi","scifi","space","dystopia","dystopian",        "cyberpunk","steampunk","aliens","post-apocalyptic","science fiction",    ],
    "sci-fi": [        "science-fiction","sci-fi","scifi","space","dystopia","dystopian","cyberpunk","steampunk","aliens","post-apocalyptic",    ],
    "adventure": [        "adventure","action","action-adventure","survival","quest",],
    "classics": ["classics","classic","classic-literature","literature",   ],
    "literary": [        "literary-fiction","literary","contemporary-fiction","fiction","general-fiction",    ],
    "fiction": [        "fiction","literary-fiction","contemporary-fiction","general-fiction","literary",    ],
    "history": [        "history","historical","historical-fiction","historical-novel",    ],
    "biography": [        "biography","autobiography","memoir","memoirs","true-story",    ],
    "self-help": [        "self-help","personal-development","productivity","motivation",        "self-improvement","nonfiction","non-fiction","selfhelp",    ],
    "comedy": [        "comedy","humor","humour","funny","satire","comic-fiction",    ],
    "young-adult": [        "young-adult","ya","teen","coming-of-age",    ],
    "philosophy": [        "philosophy","ethics","essays","intellectual",    ],
    "poetry": [        "poetry","poems","verse",    ],
    "paranormal": [        "paranormal","vampires","werewolves","witches","supernatural",    ],
    "children": [        "children","childrens","kids","middle-grade",    ],
    "crime": [        "crime","detective","true-crime","murder","police","noir",    ],
    "short-stories": [        "short-stories","anthology","short-story","collection",    ],
    "psychology": [        "psychology","mental-health","mind",    ],
    "non-fiction": [        "non-fiction","nonfiction","true-crime","essays",    ],
    "graphic novel": [        "graphic-novel","comics","manga","graphic novel",    ],}

_TAG_TO_GENRE: dict[str, str] = {}
for _g, _aliases in _GENRE_ALIASES.items():
    for _alias in _aliases:
        _TAG_TO_GENRE[_alias] = _g

_GENRE_INDEX: dict[str, np.ndarray] = {}

def _build_genre_index() -> None:
    global _GENRE_INDEX
    print("[genre_index] Building …")
    genre_to_rows: dict[str, list[int]] = {g: [] for g in _GENRE_ALIASES}
    for row_idx in range(len(books)):
        tags    = books.iloc[row_idx]["all_tags"]
        matched: set[str] = set()
        for tag in (tags if isinstance(tags, list) else []):
            if not isinstance(tag, str): continue
            t = tag.lower().strip().replace(" ", "-")
            g = _TAG_TO_GENRE.get(t)
            if g and g not in matched:
                matched.add(g)
                genre_to_rows[g].append(row_idx)
    for g, rows in genre_to_rows.items():
        if rows:
            _GENRE_INDEX[g] = np.array(sorted(set(rows)), dtype=np.int32)
            print(f"  [{g}] {len(_GENRE_INDEX[g])} books")

_build_genre_index()

# mood mappings
_MOOD_TO_GENRES: dict[str, list[str]] = {
    "summer":              ["adventure","comedy","young-adult","romance"], "spring":              ["young-adult","literary","romance","comedy"],"rainy":               ["horror","paranormal","thriller","mystery"],"autumn":              ["classics","history","crime","mystery"], "fall":                ["classics","history","crime","mystery"], "winter":              ["fantasy","sci-fi","horror","literary"],
    "early_morning":       ["philosophy","poetry","self-help","biography"],
    "morning":             ["crime","thriller","mystery","fiction"],"afternoon":           ["comedy","young-adult","adventure","romance"], "late_afternoon":      ["history","literary","classics","fiction"], "evening":             ["thriller","mystery","horror","crime"], "night":               ["paranormal","romance","literary","classics"], "late_night":          ["horror","thriller","sci-fi","crime"],
    "long flight":         ["fantasy","sci-fi","adventure","thriller"],"train":               ["classics","history","mystery","romance"], "beach":               ["romance","comedy","young-adult","adventure"], "road trip":           ["biography","self-help","adventure","literary"],
    "30 minutes":          ["comedy","romance","mystery","young-adult","fiction"],
    "2 hours":             ["thriller","mystery","romance","fiction","young-adult"],
    "weekend":             ["fantasy","literary","history","classics","sci-fi"],
    "adventurous":         ["adventure","thriller","crime","young-adult"],
    "cosy":                ["mystery","romance","comedy","classics"],
    "dark":                ["horror","thriller","crime","mystery"],
    "emotional":           ["literary","romance","biography","classics"],
    "funny":               ["comedy","young-adult","romance"],
    "hopeful":             ["romance","literary","young-adult","fiction"],
    "intellectual":        ["philosophy","classics","literary","biography"],
    "mysterious":          ["mystery","crime","thriller","paranormal"],
    "romantic":            ["romance","paranormal","classics","literary"],
    "dreamy":              ["paranormal","romance","literary","poetry"],
    "reflective":          ["literary","classics","biography","philosophy"],
    "tense":               ["thriller","horror","mystery","crime"],
    "fiction":             ["literary","classics","romance","mystery"],
    "non-fiction":         ["biography","self-help","history","philosophy"],
    "romance":             ["romance","paranormal","young-adult","classics"],
    "slow burn romance":   ["romance","paranormal","classics"],
    "love story":          ["romance","literary","classics"],
    "contemporary romance":["romance","young-adult","literary"],
    "historical romance":  ["romance","classics","history"],
}

def _match_mood_key(query: str) -> str | None:
    q = query.lower().strip()
    if q in _MOOD_TO_GENRES: return q
    best, best_len = None, 0
    for key in _MOOD_TO_GENRES:
        if key in q and len(key) > best_len:
            best, best_len = key, len(key)
        elif q in key and len(q) >= 3 and len(key) > best_len:
            best, best_len = key, len(key)
    if best: return best
    _KEY_SIGNALS: dict[str, list[str]] = {
        "summer":    ["beach","sun","holiday","warm","tropical"],
        "rainy":     ["rain","grey","moody","overcast"],
        "autumn":    ["autumn","fall","crisp","nostalg"],
        "winter":    ["fireside","snow","cold","cosy","cozy"],
        "morning":   ["morning","coffee","commute","early"],
        "evening":   [r"evening","unwind",r"after.*work"],
        "night":     ["bedtime","sleep","dreamlike","peaceful"],
        "late_night":["midnight","obsessive"],
        "romantic":  [r"slow.burn","romance","romantic","love story","tender","heart","passion"],
        "romance":   ["romance","love","relationship","heart",r"happily ever after",r"meet.cute"],
        "dreamy":    ["dream","lyrical","magical"],
        "tense":     ["paranoia","gripped"],
        "cosy":      ["fireside","safe","gentle","community"],
        "dark":      ["menace","gritty","morally complex"],
        "emotional": ["grief","longing","cathartic","loss"],
        "funny":     ["comic","laugh","wit","satir","absurd"],
    }
    for key, signals in _KEY_SIGNALS.items():
        for signal in signals:
            if re.search(signal, q): return key
    return None

# genre mood search
def _stable_rng_seed(text: str) -> int:
    return int(hashlib.md5(text.encode(), usedforsecurity=False).hexdigest(), 16) % (2**31)

def _genre_mood_search(
    query: str,
    pool: int = 300,
    genre_filter: str | None = None,
    offset: int = 0,
) -> list[int]:
    if not query: return []
    mood_key   = _match_mood_key(query)
    genre_keys = _MOOD_TO_GENRES.get(mood_key, []) if mood_key else []
    if not genre_keys:
        for key, genres in _MOOD_TO_GENRES.items():
            if key in query.lower(): genre_keys = genres; break

    excl_key = genre_filter or mood_key
    candidate_sets, seen_set = [], set()
    for g in genre_keys:
        arr = _GENRE_INDEX.get(g)
        if arr is None or len(arr) == 0: continue
        new_idx = arr[~np.isin(arr, list(seen_set))]
        if len(new_idx) > 0:
            candidate_sets.append(new_idx)
            seen_set.update(new_idx.tolist())
    if not candidate_sets:
        fallback = list(np.argsort(books["_trend_score"].values)[::-1][:pool * 2])
        if excl_key:
            fallback = [i for i in fallback if not _is_excluded_from_genre(i, excl_key)]
        return fallback[:pool]

    all_candidates = np.concatenate(candidate_sets)
    if excl_key:
        all_candidates = np.array(
            [i for i in all_candidates if not _is_excluded_from_genre(int(i), excl_key)],
            dtype=np.int32
        )
    if len(all_candidates) == 0:
        return list(np.argsort(books["_trend_score"].values)[::-1][:pool])
    rng = np.random.default_rng(seed=_stable_rng_seed(query + str(offset)))
    score = (
        books.iloc[all_candidates]["average_rating"].values.astype(float)
        * np.log1p(books.iloc[all_candidates]["rating_count"].values.astype(float))
        + rng.random(len(all_candidates)) * 0.5
    )
    sorted_idx = all_candidates[np.argsort(score)[::-1]]
    if offset > 0:
        if len(sorted_idx) > offset:
            sorted_idx = sorted_idx[offset:]
    return list(sorted_idx[:pool])

def _tfidf_mood_search(query: str, pool: int = 200) -> list[int]:
    if not query or not query.strip(): return []
    try:
        q_vec = _tfidf.transform([query.lower().strip()])
        if q_vec.nnz == 0: return []
        sims  = cosine_similarity(q_vec, _tfidf_matrix).flatten()
        top   = np.argsort(sims)[::-1][:pool]
        return [int(i) for i in top if sims[i] > 0.001]
    except Exception as e:
        print(f"[tfidf_mood_search] {e}"); return []

# LLM expansion
_SCENE_PROMPTS: dict[str, str] = {
    "hopeful":      "The reader wants a book that leaves them feeling lifted and warm. They need stories about overcoming, healing, second chances, or quiet triumphs. The writing should feel like sunlight through a window.",
    "emotional":    "The reader wants to feel something deeply — grief, longing, love, loss. They want prose that aches, characters whose inner lives feel utterly real, and an ending that stays with them long after the last page.",
    "adventurous":  "The reader wants to be propelled forward — fast pacing, high stakes, physical danger, discovery. The world should feel vast and the protagonist always moving, always choosing, always risking something.",
    "romantic":     "The reader wants slow-burn tension, emotional chemistry, longing glances, and the ache of two people circling each other. The romance is the engine. The payoff should feel deeply earned.",
    "dark":         "The reader wants moral complexity, unsettling atmosphere, and a world where the light doesn't always win. Dread should build slowly. Characters should be flawed in interesting, dangerous ways.",
    "cosy":         "The reader is curled up somewhere warm. They want a book that feels like a hug — gentle stakes, a charming setting, likable characters, and a world they'd happily live inside for a few hours.",
    "intellectual": "The reader wants their assumptions challenged. Dense ideas, careful arguments, or fiction so precisely observed it feels like philosophy. They want to finish the book smarter or more unsettled than when they started.",
    "tense":        "The reader wants to be unable to put the book down. Relentless pacing, a clock ticking, paranoia or dread beneath every scene. The chapters should end mid-breath.",
    "dreamy":       "The reader wants to drift — lyrical prose, an otherworldly or surreal atmosphere, time that moves strangely, and images that feel more like paintings than plot. The mood matters more than the story.",
    "funny":        "The reader wants to laugh out loud. Sharp wit, comic timing, absurd situations or satirical edge. The writing itself should be the pleasure — every sentence doing something clever.",
    "reflective":   "The reader is in a quiet, contemplative mood. They want a book that matches their inner pace — slow, introspective, character-driven. Something that makes them think about their own life.",
    "mysterious":   "The reader wants a puzzle they can't solve — hidden truths, unreliable narrators, revelations that reframe everything before them. The atmosphere should feel like fog: something important is always just out of sight.",
    "summer":       "The reader is outside — or wishes they were. Sun, heat, a long afternoon. They want something breezy, escapist, fun. The book should feel like a cold drink on a hot day: easy, pleasurable, refreshing.",
    "spring":       "The reader feels optimistic, open to something new. They want warmth, gentle romance, characters beginning something, a story that opens like a window onto fresh air.",
    "rainy":        "The reader is inside watching rain. The mood is grey and intimate. They want something atmospheric, moody, psychological — a book that matches the sound of rain on glass and the feeling of being enclosed with one's thoughts.",
    "autumn":       "The reader is surrounded by amber light and falling leaves. They want something rich, slightly melancholic, literary — a book with texture and weight, like the season itself.",
    "winter":       "The reader is by a fire or buried under blankets. The world outside is cold and still. They want a long, immersive book — something to disappear into completely, something that rewards slow reading and long evenings.",
    "long flight":  "The reader has 8+ hours in a seat with nowhere to go. They want a book so gripping they forget about the flight — something long enough to last, with enough plot momentum to kill hours without effort.",
    "train":        "The reader is watching countryside pass through a window. The rhythm is gentle and contemplative. They want something atmospheric, medium-length, satisfying — a book that matches the pace of the journey.",
    "beach":        "The reader is in a sunlounger with salt air and the sound of waves. They want something light, fun, undemanding — easy to pick up and put down, with enough story to keep them turning pages between swims.",
    "road trip":    "The reader is moving — or about to be. They want a book with forward momentum, a sense of discovery, characters going somewhere new. The reading experience should feel like the open road: free, energised, moving.",
    "early_morning":"It's barely light. The reader has coffee and quiet. They want something that sharpens their mind — clear prose, purposeful ideas, a book that sets an intention for the day rather than pulling them into plot.",
    "morning":      "The reader has a commute or a focused hour. They want something engaging enough to crowd out the noise — a puzzle, a case, a chase. The pages should turn themselves.",
    "afternoon":    "The reader has a lunch break or slow afternoon. They want something light and enjoyable — funny, romantic, or gently exciting. Easy to start, hard to put down.",
    "late_afternoon":"The golden hour. The reader wants to drift into a story that's richer than a quick read — literary, emotional, absorbing. Something that earns its length.",
    "evening":      "The day is winding down. The reader wants to be pulled into a story that's gripping enough to delay sleep — a thriller, a mystery, a twist they didn't see coming.",
    "night":        "The reader is in bed, the room is dark. They want something tender and soothing — a gentle romance, a quiet literary novel, something that eases them toward sleep rather than keeping them up.",
    "late_night":   "It's past midnight and the reader can't sleep. They want something dark, obsessive, unsettling — a book that matches the hour. The kind of story that feels different read in darkness.",
}

_SYSTEM_PROMPT = (
    "You are a book recommendation engine. Your job is to generate a rich, "
    "sensory description of the IDEAL BOOK for a reader in a specific scene. "
    "Describe the book's atmosphere, emotional register, pacing, and prose style. "
    "Do NOT name genres, authors, or specific titles. "
    "Do NOT use bullet points, labels, or introductory phrases. "
    "Output ONLY 2-3 sentences of vivid description. Be specific and evocative."
)

def _make_scene_prompt(mood: str, context: dict) -> str:
    mood_lower = mood.lower().strip()
    scene = ""
    for ctx_key in ("time_of_day", "travel", "season", "reading_time"):
        val = (context.get(ctx_key) or "").lower().strip()
        if val and val in _SCENE_PROMPTS:
            scene = _SCENE_PROMPTS[val]; break
    if not scene:
        scene = _SCENE_PROMPTS.get(mood_lower, "")
    user_genres = ""
    if context and context.get("user_genres"):
        g = context["user_genres"]
        gstr = ", ".join(g[:3]) if isinstance(g, list) else str(g)
        user_genres = f"\nThe reader typically enjoys: {gstr}."
    if scene:
        return (
            f"Scene: {scene}{user_genres}\n\n"
            f"Mood keyword: {mood}\n\n"
            "Describe the ideal book for this reader in this exact moment:"
        )
    return f"The reader's mood is: {mood}.{user_genres}\n\nDescribe the ideal book for this reader:"

def _llm_cache_key(mood: str, context: dict) -> str:
    ctx = context or {}
    relevant = tuple(sorted(
        (k, v) for k, v in ctx.items()
        if k in ("season", "time_of_day", "travel", "reading_time")
        and isinstance(v, str) and v.strip()
    ))
    return f"{mood.lower().strip()}::{relevant}"

def _expand_mood(mood: str, context: dict) -> str:
    cache_key = _llm_cache_key(mood, context)
    if cache_key in _llm_query_cache:
        print(f"[expand_mood] cache hit: {cache_key[:60]}")
        return _llm_query_cache[cache_key]
    if len(_llm_query_cache) >= _LLM_CACHE_MAX:
        del _llm_query_cache[next(iter(_llm_query_cache))]

    user_prompt = _make_scene_prompt(mood, context)
    for model_name in (_LLM_MODEL, _LLM_MODEL_FALLBACK):
        try:
            resp = ollama.chat(
                model=model_name,
                messages=[
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user",   "content": user_prompt},
                ],
                options={"temperature": 0.45, "num_predict": 180, "top_p": 0.9},
            )
            expanded = resp["message"]["content"].strip()
            if len(expanded) < 40 or any(
                bad in expanded.lower()
                for bad in ["fantasy novel", "science fiction", "harry potter",
                            "tolkien", "genre:", "bullet"]
            ):
                continue
            print(f"[expand_mood] {model_name} '{mood[:40]}' → {expanded[:80]}…")
            _llm_query_cache[cache_key] = expanded
            return expanded
        except Exception as e:
            print(f"[expand_mood] {model_name} unavailable: {e}")
            continue
    return mood

# Google Books enrichment
@lru_cache(maxsize=4096)
def _google_enrich(title: str, author: str) -> tuple:
    if not GOOGLE_BOOKS_API_KEY:
        return ("", "")
    try:
        params = {"q": f"{title} {author}".strip(), "maxResults": 1,
                  "printType": "books", "key": GOOGLE_BOOKS_API_KEY}
        r = requests.get(_GBOOKS_URL, params=params, timeout=5)
        if not r.ok:
            print(f"[google_enrich] HTTP {r.status_code} for '{title}': {r.text[:200]}")
            return ("", "")
        items = r.json().get("items", [])
        if not items:
            return ("", "")
        info  = items[0].get("volumeInfo", {})
        links = info.get("imageLinks", {})
        img   = (links.get("extraLarge") or links.get("large") or
                 links.get("medium") or links.get("small") or
                 links.get("thumbnail") or links.get("smallThumbnail") or "")
        img = img.replace("http://", "https://")
        img = re.sub(r'zoom=\d', 'zoom=2', img)
        img = img.replace("&edge=curl", "")
        return (info.get("description", "").strip(), img)
    except Exception as e:
        print(f"[google_enrich] Exception for '{title}': {e}")
        return ("", "")

# display helpers
_GENRE_MAP = {"fiction":"Fiction","fantasy":"Fantasy","mystery":"Mystery","romance":"Romance","thriller":"Thriller","horror":"Horror","science-fiction":"Sci-Fi","sci-fi":"Sci-Fi", "scifi":"Sci-Fi","biography":"Biography","biographies":"Biography","history":"History", "historical":"Historical Fiction","historical-fiction":"Historical Fiction","classics":"Classics","classic":"Classics","literature":"Literature", "literary-fiction":"Literary Fiction","self-help":"Self-Help","selfhelp":"Self-Help", "comedy":"Comedy","humor":"Humor","humour":"Humor","adventure":"Adventure","action":"Adventure", "non-fiction":"Non-Fiction","nonfiction":"Non-Fiction","young-adult":"Young Adult","ya":"Young Adult", "children":"Children","childrens":"Children","graphic-novel":"Graphic Novel","comics":"Graphic Novel", "crime":"Crime","detective":"Crime","poetry":"Poetry","drama":"Drama","psychology":"Psychology", "philosophy":"Philosophy","science":"Science","travel":"Travel","paranormal":"Paranormal","dystopia":"Dystopia","magic":"Fantasy","wizards":"Fantasy","vampires":"Paranormal","werewolves":"Paranormal","war":"War","military":"War","memoir":"Memoir","autobiography":"Memoir","short-stories":"Short Stories","anthology":"Anthology","spirituality":"Spirituality","religion":"Religion","business":"Business","economics":"Economics","politics":"Politics","essay":"Essays","contemporary-romance":"Romance","historical-romance":"Romance","paranormal-romance":"Romance","romantic-suspense":"Romance",    "chick-lit":"Romance","regency-romance":"Romance","new-adult":"Romance","love-story":"Romance",}

_SKIP_TAGS = { "favorites","favourite","owned","books-i-own","to-read","toread","read","currently-reading","re-read","school","library","my-books","bookshelf",    "default","kindle","ebook","e-book","audiobook","audio","did-not-finish","dnf","maybe","wishlist","borrowed","gave-away","loaned","lost","abandoned",    "unfinished","recommended","recommendation","suggestions","challenge","book-club","bookclub","series","novel","novels","book","books",    "english","american","british","classic-literature","i-own","iown","have","want","buy","bought"}

def _clean_genre(genre_str: str) -> str:
    if not genre_str or not genre_str.strip(): return ""
    raw   = genre_str.strip()
    parts = ([p.strip() for p in raw.split(",") if p.strip()] if "," in raw else
             [p.strip() for p in raw.split("|") if p.strip()] if "|" in raw else raw.split())
    clean, seen = [], set()
    for part in parts:
        tag = part.lower().strip().strip('"').strip("'")
        if not tag or tag.isdigit() or tag in _SKIP_TAGS: continue
        label = _GENRE_MAP.get(tag)
        if not label:
            slug = tag.replace("-","").replace("_","").replace(" ","")
            label = _GENRE_MAP.get(slug)
        if not label:
            for key, val in _GENRE_MAP.items():
                if key in tag: label=val; break
        if not label:
            label = tag.replace("-"," ").replace("_"," ").title()
            if label.lower().replace(" ","") in {s.replace("-","") for s in _SKIP_TAGS}: continue
        if label.lower() not in seen: seen.add(label.lower()); clean.append(label)
        if len(clean) >= 3: break
    return ", ".join(clean)

# serialisation
def _to_dict(row: pd.Series, predicted_rating=None, enrich: bool = False) -> dict:
    title   = str(row.get("title",      "") or "").strip()
    authors = str(row.get("authors",    "") or "").strip()
    image   = str(row.get("image_url",  "") or "").strip()
    genre   = str(row.get("genre_clean","") or "").strip()

    description = ""
    for col in _ALL_DESC_COLS:
        raw_val = str(row.get(col, "") or "")
        val = re.sub(r'<[^>]+>', '', raw_val.replace("<br>", " ")).strip()
        if val and val.lower() not in _BAD_VALUES and len(val) > 20:
            description = val; break

    if enrich and title and (not description or not image):
        g_desc, g_img = _google_enrich(title, authors)
        if not description and g_desc: description = g_desc
        if not image and g_img:        image = g_img

    if image:
        image = image.replace("http://", "https://")
        image = re.sub(r'zoom=\d', 'zoom=2', image)
        image = image.replace("&edge=curl", "")

    pub_year = str(row.get("published_year", "") or "").strip()
    if not pub_year:
        for col in _YEAR_COL_CANDIDATES:
            raw = row.get(col, "")
            if raw and str(raw).strip() not in ("nan","none","","0"):
                m = re.search(r'\b(1[0-9]{3}|20[0-9]{2})\b', str(raw))
                if m: pub_year = m.group(1); break

    book_id_val = row.get("book_id", None)
    try:
        n = float(str(book_id_val))
        book_id_val = int(n) if (n > 0 and n == int(n)) else None
    except (ValueError, TypeError):
        book_id_val = None

    d = {
        "book_id":        book_id_val,
        "title":          title,
        "authors":        authors,
        "average_rating": float(row.get("average_rating", 0.0) or 0.0),
        "rating_count":   int(  row.get("rating_count",   0)   or 0),
        "image_url":      image,
        "description":    description,
        "genre":          _clean_genre(genre),
        "published_date": pub_year,
    }
    if predicted_rating is not None:
        d["predicted_rating"] = round(float(predicted_rating), 2)
    return d

def _rows_to_dicts_parallel(df: pd.DataFrame, top_n: int,
                             predicted_ratings: dict | None = None,
                             enrich: bool = False) -> list[dict]:
    rows = list(df.head(top_n).iterrows())
    if not rows: return []
    pr = predicted_ratings or {}
    def _convert(item):
        idx, row = item
        return _to_dict(row, predicted_rating=pr.get(int(idx)), enrich=enrich)
    if len(rows) < 16:
        return [_convert(item) for item in rows]
    with ThreadPoolExecutor(max_workers=8) as ex:
        return list(ex.map(_convert, rows))

def _rows_to_dicts_fast(row_indices: list[int],
                        predicted_ratings: dict | None = None,
                        enrich: bool = False) -> list[dict]:
    if not row_indices: return []
    pr = predicted_ratings or {}
    return [
        _to_dict(books.iloc[i], predicted_rating=pr.get(i), enrich=enrich)
        for i in row_indices if 0 <= i < len(books)
    ]

# index helpers
def _title_to_idx(title: str) -> int | None:
    if not isinstance(title, str) or not title.strip(): return None
    idx = _title_to_row_idx.get(title.strip())
    if idx is not None: return idx
    idx = _title_clean_to_row_idx.get(title.strip().lower())
    if idx is not None: return idx
    t = title.lower().strip()
    for clean_title, row_idx in _title_clean_to_row_idx.items():
        if t[:20] in clean_title: return row_idx
    return None

def _titles_to_indices(titles: list) -> list[int]:
    out, seen = [], set()
    for t in titles:
        if not isinstance(t, str) or not t.strip(): continue
        idx = _title_to_idx(t)
        if idx is not None and idx not in seen: seen.add(idx); out.append(idx)
    return out

def _apply_rl_rerank(scores: np.ndarray, seed_indices: list) -> np.ndarray:
    if not seed_indices: return scores
    boost = cosine_similarity(_latent_mat, _latent_mat[seed_indices]).max(axis=1)
    combined = scores + _RL_ALPHA * boost
    max_val = float(combined.max())
    if max_val > 0:
        combined = combined / max_val
    return combined

# collaborative scoring
def _compute_collab_scores(user_id: int) -> dict[str, float]:
    if not _USE_BATCH_SVD: return {}
    try:
        inner_uid = _uid_map.get(user_id)
        if inner_uid is None: return {}
        all_scores = _global_mean + float(_bu[inner_uid]) + _bi + (_qi @ _pu[inner_uid])
        result = {}
        for row_idx, bid in enumerate(books["book_id"]):
            inner_iid = _book_inner[row_idx]
            if inner_iid < 0: continue
            result[books.iloc[row_idx]["title"]] = max(0.0, (float(all_scores[inner_iid]) - 1.0) / 4.0)
        return result
    except Exception as e:
        print(f"[collab_scores] {e}"); return {}

if _HAS_CACHETOOLS:
    _collab_cache: TTLCache = TTLCache(maxsize=256, ttl=300)
    def _get_collab_scores_for_user(user_id: int) -> dict[str, float]:
        if user_id in _collab_cache:
            return _collab_cache[user_id]
        result = _compute_collab_scores(user_id)
        _collab_cache[user_id] = result
        return result
else:
    @lru_cache(maxsize=256)
    def _get_collab_scores_for_user(user_id: int) -> dict[str, float]:
        return _compute_collab_scores(user_id)

# fused recommendation
def recommend_fused(
    semantic_query:    str,
    mood_context:      dict       | None = None,
    seed_titles:       list[str]  | None = None,
    user_id:           int        | None = None,
    top_n:             int               = 12,
    sem_w:             float             = _SEM_W,
    content_w:         float             = _CONT_W,
    collab_w:          float             = _COLLAB_W,
    rating_w:          float             = _RATING_W,
    exclude_titles:    set[str]   | None = None,
    force_genre_blend: bool              = False,
    genre_filter:      str        | None = None,
    offset:            int               = 0,
) -> list[dict]:
    exclude = {t.lower().strip() for t in (exclude_titles or set())
               if isinstance(t, str) and t.strip()}
    pool = min(300, len(books))

    # semantic (FAISS) scores
    sem_idx_scores: dict[int, float] = {}
    if _sem_ready and semantic_query:
        raw_scores, raw_indices = _semantic_search_raw(semantic_query, pool, offset)
        if len(raw_scores) > 0:
            s_min, s_max = float(raw_scores.min()), float(raw_scores.max())
            s_range = s_max - s_min if s_max != s_min else 1.0
            for score, meta_idx in zip(raw_scores, raw_indices):
                if 0 <= meta_idx < len(_book_meta):
                    title = _book_meta.iloc[int(meta_idx)]["title"]
                    if not isinstance(title, str) or not title.strip(): continue
                    row_idx = _title_to_row_idx.get(title.strip())
                    if row_idx is not None:
                        sem_idx_scores[row_idx] = float((score - s_min) / s_range)

    # genre / mood scores
    tfidf_idx_scores: dict[int, float] = {}
    genre_idx_scores: dict[int, float] = {}
    if (not sem_idx_scores or force_genre_blend) and semantic_query:
        genre_routing_key = semantic_query
        ctx = mood_context or {}
        for ck in ("season", "time_of_day", "travel", "reading_time"):
            v = ctx.get(ck)
            if v and isinstance(v, str):
                vl = v.lower().strip()
                for mk in _MOOD_TO_GENRES:
                    if mk == vl or mk in vl or vl in mk:
                        genre_routing_key = mk; break
                else:
                    continue
                break
        genre_candidates = _genre_mood_search(
            genre_routing_key, pool, genre_filter=genre_filter, offset=offset
        )
        if genre_candidates:
            max_rank = len(genre_candidates)
            for rank, idx in enumerate(genre_candidates):
                genre_idx_scores[idx] = 1.0 - (rank / max_rank)
        else:
            mood_indices = _tfidf_mood_search(semantic_query, pool)
            max_rank = len(mood_indices) if mood_indices else 1
            for rank, idx in enumerate(mood_indices):
                tfidf_idx_scores[idx] = 1.0 - (rank / max_rank)
    elif sem_idx_scores and semantic_query:
        genre_candidates = _genre_mood_search(
            semantic_query, pool, genre_filter=genre_filter, offset=offset
        )
        max_rank = len(genre_candidates) if genre_candidates else 1
        for rank, idx in enumerate(genre_candidates):
            genre_idx_scores[idx] = 1.0 - (rank / max_rank)

    # content (seed-title) scores
    seed_idx_scores: dict[int, float] = {}
    if seed_titles:
        clean_seeds  = [t for t in seed_titles if isinstance(t, str) and t.strip()]
        seed_indices = _titles_to_indices(clean_seeds[:5])
        if seed_indices:
            sim_matrix = cosine_similarity(_tfidf_matrix[seed_indices], _tfidf_matrix)
            for li, bi in enumerate(seed_indices): sim_matrix[li, bi] = 0.0
            max_sims = sim_matrix.max(axis=0)
            cont_max = float(max_sims.max()) if max_sims.max() > 0 else 1.0
            for i, s in enumerate(max_sims):
                if s > 0: seed_idx_scores[i] = float(s) / cont_max

    # collaborative scores
    collab_scores = _get_collab_scores_for_user(user_id) if user_id else {}
    collab_idx_scores: dict[int, float] = {}
    for title, score in collab_scores.items():
        idx = _title_to_row_idx.get(title)
        if idx is not None: collab_idx_scores[idx] = score

    candidate_indices: set[int] = (
        set(sem_idx_scores) | set(genre_idx_scores)
        | set(tfidf_idx_scores) | set(seed_idx_scores)
    )
    if not candidate_indices: return trending_books(top_n)

    if force_genre_blend and genre_idx_scores:
        eff_sem_w   = sem_w * 0.40
        eff_genre_w = sem_w * 0.60
    elif genre_idx_scores:
        eff_sem_w   = sem_w * 0.70
        eff_genre_w = sem_w * 0.30
    else:
        eff_sem_w   = sem_w
        eff_genre_w = 0.0

    fused: list[tuple[int, float]] = []
    for idx in candidate_indices:
        if not (0 <= idx < len(books)): continue
        title = books.iloc[idx]["title"]
        if not isinstance(title, str) or not title.strip(): continue
        if title.lower().strip() in exclude: continue
        title_lc = str(books.iloc[idx].get("title_clean", ""))
        if _is_title_blacklisted(title_lc): continue
        if genre_filter and _is_excluded_from_genre(idx, genre_filter): continue
        sem_n   = sem_idx_scores.get(idx, 0.0)
        genre_n = genre_idx_scores.get(idx, tfidf_idx_scores.get(idx, 0.0))
        cont_n  = seed_idx_scores.get(idx, 0.0)
        coll_n  = collab_idx_scores.get(idx, 0.0)
        rc      = float(books.iloc[idx].get("rating_count", 0) or 0)
        rat_n   = np.log1p(rc) / np.log1p(_MAX_RC) if _MAX_RC > 0 else 0.0
        fused.append((idx, eff_sem_w*sem_n + eff_genre_w*genre_n
                      + content_w*cont_n + collab_w*coll_n + rating_w*rat_n))

    if not fused: return trending_books(top_n)
    fused.sort(key=lambda x: x[1], reverse=True)

    extended  = [i for i, _ in fused[:top_n * 4]]
    popular   = [i for i in extended if books.iloc[i]["rating_count"] >= _FUSED_SOFT_POP_FLOOR]
    unpopular = [i for i in extended if books.iloc[i]["rating_count"] <  _FUSED_SOFT_POP_FLOOR]
    reranked  = (popular + unpopular)[:top_n]
    if len(popular) < max(3, top_n // 2):
        reranked = [i for i, _ in fused[:top_n]]
    return _rows_to_dicts_fast(reranked)

# mood query map and semantic query builder
_MOOD_QUERY_MAP: dict[str, str] = {
    "summer":        "beach holiday adventure sun romance light-hearted escapism warm fast-paced",
    "spring":        "new beginnings hope renewal growth optimistic fresh character",
    "rainy":         "atmospheric moody interior psychological suspense dark enclosed melancholic",
    "autumn":        "nostalgia literary atmospheric detective gothic crime melancholic",
    "fall":          "nostalgia literary atmospheric detective gothic crime melancholic",
    "winter":        "epic fantasy cosy long immersive dark saga fireside cold",
    "early_morning":  "clarity focus purpose mindfulness self-improvement essays philosophy calm morning",
    "morning":        "gripping detective crime procedural whodunit fast-paced engaging morning commute",
    "afternoon":      "light funny witty entertaining breezy romantic comedy adventure quick read",
    "late_afternoon": "immersive literary character-driven emotional rich prose absorbing drama",
    "evening":        "suspenseful tense psychological thriller page-turner atmospheric twisty gripping",
    "night":          "soothing tender romantic soft cosy heartwarming gentle love slow quiet comforting bedtime",
    "late_night":     "dark psychological unsettling obsessive disturbing twisty horror suspense midnight",
    "long flight":   "epic fantasy adventure world-building long immersive journey",
    "train":         "mystery romance atmospheric medium-length satisfying",
    "beach":         "romance comedy light holiday sun beach easy fun",
    "road trip":     "biography memoir adventure self-discovery motivating",
    "30 minutes":    ("quick short fast read compact story under 200 pages novella ""light fun breezy comedic slice-of-life short fiction easy quick bite"),
    "2 hours":       ("gripping medium-length novel under 300 pages fast-paced page-turner " "thriller mystery romance satisfying complete single-sitting read"),
    "weekend":       ( "long immersive epic saga multi-generational sprawling world-building " "fantasy classics literary masterpiece weekend read rich detailed"),
    "adventurous":   ( "high-stakes action-packed daring bold fast-paced journey survival ""discovery risk courage exciting page-turner adrenaline" ),
    "cosy":          ( "warm safe gentle comforting quiet village community charming "  "fireside cozy small-town feel-good heartwarming soft" ),
    "romantic": (
        "sweeping love story slow burn enemies to lovers second chance romance "
        "tender passionate heartwarming happily ever after emotional chemistry "
        "yearning desire falling in love couple relationship"
    ),
    "romance": (
        "popular bestselling romance novel falling in love passionate tender heartwarming "
        "slow burn enemies to lovers second chance happy ending couple relationship "
        "emotional chemistry longing desire meet cute"
    ),
    "dark":          (
        "gritty unsettling morally complex disturbing bleak sinister "
        "menacing psychological tension dark atmosphere dread"
    ),
    "funny":         (
        "laugh-out-loud witty comic absurdist satirical humorous clever wordplay "
        "banter sharp funny lighthearted amusing quirky"
    ),
    "intellectual":  (
        "thought-provoking philosophical challenging ideas complex argument "
        "intellectual depth nuanced analysis stimulating dense rewarding"
    ),
    "mysterious":    (
        "secrets hidden truth unreliable narrator puzzling enigmatic "
        "whodunit clues investigation suspense revelation unexpected twist"
    ),
    "hopeful":       (
        "uplifting redemptive second-chance inspiring overcoming obstacles "
        "optimistic warm triumphant resilience healing growth transformation"
    ),
    "tense":         ("unbearable suspense relentless pacing paranoia unstoppable countdown " "nail-biting gripping can't-put-down anxiety high-stakes nerve-shredding" ),
    "dreamy":        ( "lyrical poetic atmospheric otherworldly magical surreal lush "  "languid evocative sensory immersive soft ethereal enchanting"  ),
    "reflective":    ("quiet contemplative introspective meditative inner-life prose " "slow-burn character study melancholic thoughtful consciousness"),
    "contemporary romance": (  "modern love story contemporary romance relatable characters emotional connection ""witty banter second chance happily ever after"),
    "historical romance": ( "regency romance period romance historical love story aristocracy ballroom " "forbidden love Austen-esque witty heroine passionate hero" ),
    "slow burn romance": ("slow burn romance longing unresolved tension enemies to lovers ""friends to lovers restrained desire emotional payoff"),
}

_PROSE_STOP = { "a","an","the","and","or","but","in","on","at","to","for","of","with","by",  "from","as","is","are","was","were","be","been","being","have","has","had", "do","does","did","will","would","could","should","may","might","that","which", "who","this","these","those","their","its","his","her","our","your","it", "they","we","you","he","she","not","no","nor","so","yet","both","either", "neither","each","few","more","most","other","some","such","than","too","very","just","because","if","while","where","when","how","what","kind","type","sort", "rather","also","there","here","then","now","still","only","even","about", "into","through","before","after","once","same","can","need","like","feel","reader","book","story","novel","prose","character","characters","narrator","page","pages","chapter","plot","ending","beginning","middle",}

_GENRE_DOMINANT_MOODS = { "romance","romantic","slow burn romance","love story", "contemporary romance","historical romance", "fantasy","mystery","thriller","horror","sci-fi",  "crime","biography","self-help","comedy",}

def _is_genre_dominant(mood: str) -> bool:
    m  = mood.lower().strip()
    if m in _GENRE_DOMINANT_MOODS: return True
    mk = _match_mood_key(m)
    return mk in _GENRE_DOMINANT_MOODS if mk else False

def _build_semantic_query(mood: str, context: dict, use_llm: bool = True) -> str:
    mood_lower = mood.lower().strip()
    if _is_genre_dominant(mood_lower):
        if mood_lower in _MOOD_QUERY_MAP:
            return _MOOD_QUERY_MAP[mood_lower]
        for mk, q in _MOOD_QUERY_MAP.items():
            if mk in mood_lower or mood_lower in mk:
                return q
    if use_llm:
        try:
            expanded = _expand_mood(mood, context)
            if expanded and expanded != mood: return expanded
        except Exception:
            pass
    ctx = context or {}
    for ck in ("season", "time_of_day", "travel", "reading_time"):
        ctx_key = ctx.get(ck, "").lower().strip()
        if not ctx_key: continue
        if ctx_key in _MOOD_QUERY_MAP: return _MOOD_QUERY_MAP[ctx_key]
        for mk, q in _MOOD_QUERY_MAP.items():
            if mk in ctx_key or ctx_key in mk: return q
    if mood_lower in _MOOD_QUERY_MAP: return _MOOD_QUERY_MAP[mood_lower]
    for mk, q in _MOOD_QUERY_MAP.items():
        if mk in mood_lower or mood_lower in mk: return q
    words     = re.findall(r"[a-z]{4,}", mood_lower)
    key_terms = [w for w in words if w not in _PROSE_STOP]
    return " ".join(key_terms[:20]) if key_terms else mood_lower

# reading-time recommendation
_READING_TIME_PAGES: dict[str, tuple[int, int]] = {
    "30 minutes": (0,   220),
    "2 hours":    (150, 420),
    "weekend":    (350, 9999),
}

_SHORT_BOOK_GENRES  = {"comedy","romance","young-adult","fiction","mystery","thriller","horror"}
_LONG_BOOK_GENRES   = {"fantasy","sci-fi","history","classics","biography","literary"}
_MEDIUM_BOOK_GENRES = {"thriller","mystery","romance","fiction","young-adult","crime","paranormal"}

_SHORT_TITLE_SIGNALS = [ "short", "novella", "tale", "story", "fable", "brief", "little","slim", "quick", "micro", "mini",]
_LONG_TITLE_SIGNALS = [ "saga", "epic", "complete", "collection", "trilogy", "chronicles",  "omnibus", "boxed", "boxset", "volume", "series", "compendium",]

def _page_length_score(row_idx: int, reading_time_key: str) -> float:
    pages = int(books.iloc[row_idx]["_pages"])
    lo, hi = _READING_TIME_PAGES[reading_time_key]
    if pages > 10:
        if lo <= pages <= hi:
            centre   = (lo + hi) / 2 if hi < 9000 else lo + 200
            distance = abs(pages - centre)
            width    = max((hi - lo) / 2, 50)
            return max(0.4, 1.0 - (distance / (width * 2)))
        overshoot = max(pages - hi, lo - pages)
        penalty   = min(1.0, overshoot / 300)
        return max(0.0, 0.35 - penalty)
    tags  = set(_get_effective_tags(row_idx))
    title = books.iloc[row_idx].get("title_clean", "").lower()
    if reading_time_key == "30 minutes":
        if any(s in title for s in _LONG_TITLE_SIGNALS): return 0.05
        if any(s in title for s in _SHORT_TITLE_SIGNALS): return 0.7
        if tags & {"comedy","romance","mystery","young-adult","fiction"}: return 0.55
        if tags & {"epic-fantasy","high-fantasy","history","biography"}: return 0.05
        return 0.3
    elif reading_time_key == "2 hours":
        if any(s in title for s in _LONG_TITLE_SIGNALS): return 0.1
        if tags & _MEDIUM_BOOK_GENRES: return 0.65
        if tags & _LONG_BOOK_GENRES:   return 0.25
        return 0.45
    else:
        if any(s in title for s in _LONG_TITLE_SIGNALS): return 0.85
        if tags & {"epic-fantasy","high-fantasy","classics","history"}: return 0.8
        if tags & _SHORT_BOOK_GENRES:  return 0.15
        return 0.5

def recommend_by_reading_time(
    reading_time_key: str,
    top_n:            int       = 28,
    offset:           int       = 0,
    seed_titles:      list[str] | None = None,
    user_id:          int       | None = None,
) -> list[dict]:
    if reading_time_key not in _READING_TIME_PAGES:
        return []
    genre_keys = _MOOD_TO_GENRES.get(reading_time_key, [])
    excl_key   = reading_time_key
    seen_set, candidate_sets = set(), []
    for g in genre_keys:
        arr = _GENRE_INDEX.get(g)
        if arr is None or len(arr) == 0: continue
        new_idx = arr[~np.isin(arr, list(seen_set))]
        if len(new_idx): candidate_sets.append(new_idx); seen_set.update(new_idx.tolist())
    if not candidate_sets:
        candidates = np.argsort(books["_trend_score"].values)[::-1][:500]
    else:
        candidates = np.concatenate(candidate_sets)
    candidates = np.array(
        [i for i in candidates if not _is_excluded_from_genre(int(i), excl_key)],
        dtype=np.int32,
    )
    if len(candidates) == 0:
        return trending_books(top_n)
    rng = np.random.default_rng(seed=_stable_rng_seed(reading_time_key + str(offset)))
    page_scores   = np.array([_page_length_score(int(i), reading_time_key) for i in candidates])
    rating_scores = (
        books.iloc[candidates]["average_rating"].values.astype(float)
        * np.log1p(books.iloc[candidates]["rating_count"].values.astype(float))
    )
    if rating_scores.max() > 0:
        rating_scores = rating_scores / rating_scores.max()
    jitter        = rng.random(len(candidates)) * 0.06
    combined      = 0.55 * page_scores + 0.40 * rating_scores + jitter
    sorted_order  = np.argsort(combined)[::-1]
    sorted_idx    = candidates[sorted_order]
    if offset > 0 and len(sorted_idx) > offset:
        sorted_idx = sorted_idx[offset:]
    chosen = list(sorted_idx[:top_n])
    return _rows_to_dicts_fast(chosen)

_READING_TIME_KEYS = {"30 minutes", "2 hours", "weekend"}

def recommend_by_mood_semantic(
    mood:        str,
    context:     dict       | None = None,
    seed_titles: list[str]  | None = None,
    user_id:     int        | None = None,
    top_n:       int               = 12,
    use_llm:     bool              = True,
    offset:      int               = 0,
) -> list[dict]:
    clean_seeds = [t for t in (seed_titles or []) if isinstance(t, str) and t.strip()]
    mood_key    = _match_mood_key(mood.lower().strip()) or mood.lower().strip()
    if mood_key in _READING_TIME_KEYS:
        result = recommend_by_reading_time(
            reading_time_key=mood_key,
            top_n=top_n, offset=offset,
            seed_titles=clean_seeds, user_id=user_id,
        )
        if len(result) >= max(4, top_n // 3):
            return result
    ctx            = context or {}
    semantic_query = _build_semantic_query(mood, ctx, use_llm=use_llm)
    force_blend    = _is_genre_dominant(mood)
    genre_filter: str | None = None
    if mood_key in _GENRE_EXCLUSION_TAGS:
        genre_filter = mood_key
    elif mood.lower().strip() in _GENRE_EXCLUSION_TAGS:
        genre_filter = mood.lower().strip()
    return recommend_fused(
        semantic_query=semantic_query, mood_context=ctx,
        seed_titles=clean_seeds, user_id=user_id, top_n=top_n,
        exclude_titles={t.lower() for t in clean_seeds},
        force_genre_blend=force_blend,
        genre_filter=genre_filter, offset=offset,
    )

# genre browse
_GENRE_TAG_MAP = {
    "romance": { "romance","romance-novels","romantic","contemporary-romance","historical-romance","paranormal-romance","love-story","romantic-suspense","regency-romance","chick-lit", "romance-contemporary","romance-historical","romance-paranormal","new-adult-romance", "adult-romance","romances","romantic-fiction","clean-romance","sweet-romance", "inspirational-romance","christian-romance","sports-romance","billionaire-romance", "second-chance-romance","enemies-to-lovers","slow-burn","slow-burn-romance","friends-to-lovers","forbidden-romance","small-town-romance","office-romance", "fake-dating","marriage-of-convenience","arranged-marriage",  },
    "fantasy": {"fantasy","epic-fantasy","high-fantasy","dark-fantasy","urban-fantasy",  "magic","wizards","sword-and-sorcery","fairy-tales","mythology","dragons", },
    "fiction": {"fiction","literary-fiction","contemporary-fiction","general-fiction","literary",},
    "mystery": { "mystery","mysteries","detective","cozy-mystery","whodunit","noir","crime-fiction", },
    "thriller": { "thriller","suspense","psychological-thriller","legal-thriller","spy","espionage", },
    "horror": { "horror","gothic","supernatural","scary", },
    "science fiction": {"science-fiction","sci-fi","scifi","space","dystopia","dystopian", "cyberpunk","steampunk","aliens","post-apocalyptic","science fiction",},
    "sci-fi": { "science-fiction","sci-fi","scifi","space","dystopia","dystopian", "cyberpunk","steampunk","aliens","post-apocalyptic","science fiction", },
    "biography": {"biography","autobiography","memoir","memoirs","true-story","biographies", },
    "history": { "history","historical","historical-fiction","historical-novel", },
    "classics": {"classics","classic","classic-literature",},
    "self-help": {"self-help","personal-development","productivity","motivation","self-improvement","selfhelp", },
    "comedy": { "comedy","humor","humour","funny","satire",  },
    "adventure": { "adventure","action","action-adventure","survival","quest", },
    "young-adult": { "young-adult","ya","teen","coming-of-age", },
    "children": {"children","childrens","kids","middle-grade", },
    "non-fiction": { "non-fiction","nonfiction","true-crime","essays",},
    "paranormal": {"paranormal","vampires","werewolves","witches","supernatural",},
    "psychology": { "psychology","mental-health",},
    "philosophy": {"philosophy","ethics", },
    "poetry": {"poetry","poems","verse",},
    "graphic novel": {"graphic-novel","comics","manga",},
    "crime": {"crime","detective","true-crime","murder","police","noir",},}

_ROMANCE_CLASSICS_TITLES = {"pride and prejudice", "sense and sensibility", "emma","persuasion", "northanger abbey", "mansfield park","jane eyre", "wuthering heights", "rebecca", "gone with the wind","anna karenina", "the age of innocence", "north and south","wives and daughters", "little women", "the scarlet letter","tess of the d'urbervilles", "far from the madding crowd","a room with a view", "howard's end", "the notebook", "me before you","outlander", "the time traveler's wife", "atonement", "one day","ps i love you", "the fault in our stars", "twilight", "the kiss quotient", "beach read","the hating game", "it ends with us", "ugly love", "verity",}

_SHELF_TAGS = { "favorites","favourite","owned","books-i-own","to-read","toread","read","currently-reading","re-read","school","library","my-books","bookshelf","default","kindle","ebook","audiobook","did-not-finish","dnf","maybe", "wishlist","borrowed","novel","novels","book","books","english","american","british","i-own","have","want","buy","recommended","challenge","book-club","series","owned","literature","fiction",}

_GENRE_SCORE_THRESHOLDS = {"romance":0.05,"fiction":0.10,"fantasy":0.10,"mystery":0.10,"thriller":0.10,"horror":0.10,"science fiction":0.08,"sci-fi":0.08,"young-adult":0.08,"biography":0.10,"history":0.10,"self-help":0.10,"non-fiction":0.10, "crime":0.10,"paranormal":0.08,"classics":0.08,"adventure":0.08,"_default":0.12,}

_GENRE_MIN_RATINGS = { "romance":20,"fiction":30,"fantasy":30,"mystery":30,"thriller":30,"horror":20,"science fiction":20,"sci-fi":20,"young-adult":20,"biography":15,"history":15,"self-help":15,"non-fiction":10,"crime":20, "paranormal":10,"classics":30,"adventure":20,"_default":10,}

def _score_genre_match(tags: list[str], approved: set) -> float:
    if not tags: return 0.0
    real_tags = [t for t in tags if t not in _SHELF_TAGS]
    if not real_tags: return 0.0
    approved_norm = {a.replace("-", " ").replace("_", " ") for a in approved}
    hits = 0.0
    for t in real_tags:
        t_norm = t.replace("-", " ").replace("_", " ")
        if t in approved or t_norm in approved_norm:
            hits += 1.0; continue
        matched = False
        for a_norm in approved_norm:
            a_words = a_norm.split()
            t_words = t_norm.split()
            if len(a_words) >= 2 and all(w in t_words for w in a_words):
                hits += 0.5; matched = True; break
            if len(t_words) >= 2 and all(w in a_words for w in t_words):
                hits += 0.5; matched = True; break
        _ = matched
    return min(1.0, hits / len(real_tags))

_GENRE_CANONICAL: dict[str, str] = {"science fiction":"science fiction","science-fiction":"science fiction", "sci-fi":"science fiction","scifi":"science fiction","sf":"science fiction", "selfhelp":"self-help","self help":"self-help","ya":"young-adult","young adult":"young-adult","teen":"young-adult", "nonfiction":"non-fiction","non fiction":"non-fiction","graphic-novel":"graphic novel","comics":"graphic novel","manga":"graphic novel","memoir":"biography","autobiography":"biography","biographies":"biography","historical":"history","historical-fiction":"history",
    "classic":"classics","classic-literature":"classics","detective":"mystery","cozy-mystery":"mystery","whodunit":"mystery", "true-crime":"crime","murder":"crime","vampires":"paranormal","werewolves":"paranormal","witches":"paranormal", "humor":"comedy","humour":"comedy","funny":"comedy","satire":"comedy",}

def recommend_by_genre(genre: str, top_n: int = 9999) -> list[dict]:
    if not genre: return []
    g_raw  = genre.lower().strip()
    g      = _GENRE_CANONICAL.get(g_raw, g_raw)
    g_norm = g.replace(" ", "-")
    print(f"[recommend_by_genre] genre={genre!r} → canonical={g!r}")
    approved = None
    for candidate in [g, g_norm, g_raw]:
        if candidate in _GENRE_TAG_MAP:
            approved = _GENRE_TAG_MAP[candidate]
            print(f"[recommend_by_genre] approved tags via key={candidate!r} ({len(approved)} tags)")
            break
    if approved is None:
        for key, tags in _GENRE_TAG_MAP.items():
            if key in g or g in key or g_norm in key or key in g_norm:
                approved = tags
                print(f"[recommend_by_genre] approved tags via substring key={key!r}")
                break
    if approved is None:
        approved = {g, g_norm, g_raw, g + "-fiction", g + "-novels"}
        print(f"[recommend_by_genre] WARNING: fallback tag set for {g!r}")
    scores_list = []
    for row_idx in range(len(books)):
        if _is_excluded_from_genre(row_idx, g):
            scores_list.append(0.0)
        else:
            scores_list.append(_score_genre_match(_get_effective_tags(row_idx), approved))
    scores_arr = pd.Series(scores_list, index=books.index)
    if g == "romance":
        for row_idx in range(len(books)):
            title_lc = str(books.iloc[row_idx].get("title_clean", ""))
            if any(classic in title_lc for classic in _ROMANCE_CLASSICS_TITLES):
                if scores_arr.iat[row_idx] < 0.05:
                    scores_arr.iat[row_idx] = 0.3
    THRESHOLD   = _GENRE_SCORE_THRESHOLDS.get(g, _GENRE_SCORE_THRESHOLDS["_default"])
    min_ratings = _GENRE_MIN_RATINGS.get(g, _GENRE_MIN_RATINGS["_default"])
    mask     = (scores_arr >= THRESHOLD) & (books["rating_count"] >= min_ratings)
    filtered = books[mask].copy()
    filtered["_genre_score"] = scores_arr[mask]
    print(f"[recommend_by_genre] primary filter: {len(filtered)} books")
    if len(filtered) < 10:
        mask2    = scores_arr >= THRESHOLD
        filtered = books[mask2].copy()
        filtered["_genre_score"] = scores_arr[mask2]
        print(f"[recommend_by_genre] relaxed popularity gate: {len(filtered)} books")
    if len(filtered) < 5:
        any_pos  = scores_arr > 0
        filtered = books[any_pos].copy()
        filtered["_genre_score"] = scores_arr[any_pos]
        print(f"[recommend_by_genre] relaxed threshold: {len(filtered)} books")
    if filtered.empty:
        print(f"[recommend_by_genre] WARNING: empty result for {g!r}")
        return []
    filtered["_final_score"] = (
        filtered["_genre_score"]
        * filtered["average_rating"]
        * (filtered["rating_count"].astype(float) ** 0.6)
    )
    filtered = filtered.sort_values("_final_score", ascending=False)
    if g == "romance":
        classic_mask = filtered["title_clean"].apply(
            lambda t: any(c in str(t) for c in _ROMANCE_CLASSICS_TITLES)
        )
        filtered = pd.concat([filtered[classic_mask], filtered[~classic_mask]])
    result = _rows_to_dicts_parallel(filtered, min(top_n, len(filtered)))
    print(f"[recommend_by_genre] returning {len(result)} books for genre={g!r}")
    return result

# author / title recommendations
@lru_cache(maxsize=256)
def recommend_by_author(author: str, top_n: int = 20) -> list:
    if not author: return []
    a        = author.lower().strip()
    filtered = books[books["authors_clean"].str.contains(a, na=False)]
    if filtered.empty: return []
    score    = filtered["average_rating"] * np.log1p(filtered["rating_count"].astype(float))
    return _rows_to_dicts_parallel(
        filtered.assign(_score=score).sort_values("_score", ascending=False), top_n
    )

def recommend_by_title(title: str, top_n: int = 10) -> list:
    if not title: return []
    idx = _title_to_idx(title)
    if idx is None: return []
    # use tfidf_matrix directly — avoids cosine_sim shape mismatch on reload
    sims = cosine_similarity(_tfidf_matrix[idx], _tfidf_matrix).flatten()
    sims[idx] = 0.0
    top_idxs  = np.argsort(sims)[::-1][:top_n]
    valid     = top_idxs[sims[top_idxs] > 0]
    return _rows_to_dicts_parallel(books.iloc[valid], top_n)

# description search
def recommend_by_description(
    description:  str,
    top_n:        int          = 10,
    liked_titles: list | None  = None,
    saved_titles: list | None  = None,
) -> list:

    if not description or not description.strip():
        return []

    seed_titles = [t for t in ((liked_titles or []) + (saved_titles or []))
                   if isinstance(t, str) and t.strip()]
    intent_key = _detect_description_intent(description)

    if _sem_ready:
        raw_results = recommend_fused( semantic_query=description, seed_titles=seed_titles, top_n=top_n * 4, genre_filter=intent_key, )
        filtered = []
        for book_dict in raw_results:
            title = str(book_dict.get("title", "")).lower().strip()
            if _is_title_blacklisted(title):
                continue
            row_idx = _title_clean_to_row_idx.get(title)
            if row_idx is not None:
                if not _passes_description_filter(row_idx, intent_key):
                    continue
            filtered.append(book_dict)
            if len(filtered) >= top_n:
                break
        return filtered[:top_n]

    # TF-IDF fallback
    q_vec = _tfidf.transform([description.lower().strip()])
    sims  = cosine_similarity(q_vec, _tfidf_matrix).flatten()
    seed_indices = _titles_to_indices(seed_titles)
    if seed_indices:
        sims = _apply_rl_rerank(sims, seed_indices)
    top_idxs = np.argsort(sims)[::-1]
    valid = []
    for idx in top_idxs:
        if sims[idx] <= 0:
            break
        if _passes_description_filter(int(idx), intent_key):
            valid.append(idx)
        if len(valid) >= top_n:
            break
    return _rows_to_dicts_parallel(books.iloc[valid], top_n)

# saved / liked / collaborative / trending
def _seed_titles_to_query(seed_titles: list[str]) -> str:
    desc_parts = []
    for t in seed_titles[:5]:
        idx = _title_to_idx(t)
        if idx is not None:
            desc  = str(books.iloc[idx].get("description", "") or "").strip()
            genre = str(books.iloc[idx].get("genre_clean",  "") or "").strip()
            if desc and len(desc) > 30:
                desc_parts.append(desc[:200])
            elif genre:
                desc_parts.append(genre)
    return " ".join(desc_parts) if desc_parts else " ".join(seed_titles[:5])

def _build_beginner_query(user_genres: list[str] | None = None) -> str:
    if user_genres:
        genre_queries = []
        for g in user_genres[:3]:
            g_lower = g.lower().strip()
            if g_lower in _MOOD_QUERY_MAP:
                genre_queries.append(_MOOD_QUERY_MAP[g_lower])
            else:
                genre_queries.append(g_lower)
        return " ".join(genre_queries)
    return (
        "popular bestselling fiction novel highly rated engaging "
        "compelling characters emotional literary fiction thriller mystery romance"
    )

_TASTE_SYSTEM_PROMPT = (
    "You are a book recommendation engine. Analyse the list of books a reader "
    "has liked, saved, or read. Identify the common threads: themes, emotional "
    "register, pacing, prose style, atmosphere, and character types they gravitate to. "
    "Output ONLY a 2-3 sentence description of what this reader enjoys — written as "
    "a search query for finding similar books. Be specific and evocative. "
    "Do NOT list the books back. Do NOT name genres. Do NOT use bullet points."
)
def _build_taste_profile(
    liked_titles:  list[str],
    saved_titles:  list[str],
    read_titles:   list[str] | None = None,
    user_genres:   list[str] | None = None,
) -> str:
    all_seeds = list(dict.fromkeys(
        (liked_titles or []) + (read_titles or []) + (saved_titles or [])
    ))[:8]
    if not all_seeds:
        return ""
    cache_key = "taste::" + "|".join(sorted(all_seeds[:6]))
    if cache_key in _llm_query_cache:
        return _llm_query_cache[cache_key]
    book_lines = []
    for title in all_seeds[:8]:
        idx = _title_to_idx(title)
        if idx is None:
            book_lines.append(f"- {title}")
            continue
        row   = books.iloc[idx]
        desc  = str(row.get("description", "") or "").strip()
        genre = str(row.get("genre_clean",  "") or "").strip()
        line  = f"- {title}"
        if desc and len(desc) > 30:
            line += f": {desc[:180]}"
        elif genre:
            line += f" ({genre})"
        book_lines.append(line)
    genre_hint = ""
    if user_genres:
        genre_hint = f"\nThe reader says they enjoy: {', '.join(user_genres[:3])}."
    user_prompt = (
        f"Books this reader has liked or read:{genre_hint}\n"
        + "\n".join(book_lines)
        + "\n\nDescribe what this reader enjoys and what their next book should feel like:"
    )
    for model_name in (_LLM_MODEL, _LLM_MODEL_FALLBACK):
        try:
            resp = ollama.chat(
                model=model_name,
                messages=[
                    {"role": "system", "content": _TASTE_SYSTEM_PROMPT},
                    {"role": "user",   "content": user_prompt},
                ],
                options={"temperature": 0.4, "num_predict": 200, "top_p": 0.9},
            )
            profile = resp["message"]["content"].strip()
            if len(profile) > 40:
                print(f"[taste_profile] '{all_seeds[0]}'+{len(all_seeds)-1} → {profile[:80]}…")
                if len(_llm_query_cache) >= _LLM_CACHE_MAX:
                    del _llm_query_cache[next(iter(_llm_query_cache))]
                _llm_query_cache[cache_key] = profile
                return profile
        except Exception as e:
            print(f"[taste_profile] {model_name}: {e}")
            continue
    return _seed_titles_to_query(all_seeds[:5])

def recommend_from_saved_liked(
    liked_titles:  list,
    saved_titles:  list,
    top_n:         int        = 10,
    read_titles:   list | None = None,
    user_genres:   list | None = None,
    user_action:   str  | None = None,
    context_title: str  | None = None,
) -> list:
    liked_titles = [t for t in (liked_titles or []) if isinstance(t, str) and t.strip()]
    saved_titles = [t for t in (saved_titles or []) if isinstance(t, str) and t.strip()]
    read_titles  = [t for t in (read_titles  or []) if isinstance(t, str) and t.strip()]
    all_seeds    = list(dict.fromkeys(liked_titles + read_titles + saved_titles))

    if not all_seeds:
        query = _build_beginner_query(user_genres)
        return recommend_fused(semantic_query=query, top_n=top_n)

    semantic_query = _build_taste_profile( liked_titles=liked_titles,saved_titles=saved_titles,read_titles=read_titles, user_genres=user_genres,)
    if context_title:
        ctx_idx = _title_to_idx(context_title)
        if ctx_idx is not None:
            ctx_desc = str(books.iloc[ctx_idx].get("description", "") or "").strip()
            if ctx_desc and len(ctx_desc) > 30:
                semantic_query = f"{semantic_query} {ctx_desc[:200]}"

    if _sem_ready and semantic_query:
        return recommend_fused(
            semantic_query=semantic_query,
            seed_titles=all_seeds[:6],
            top_n=top_n,
            exclude_titles={t.lower() for t in all_seeds},
        )
    seed_indices = _titles_to_indices(all_seeds)
    if not seed_indices: return []
    sim_matrix = cosine_similarity(_tfidf_matrix[seed_indices], _tfidf_matrix)
    for li, bi in enumerate(seed_indices): sim_matrix[li, bi] = 0.0
    scores   = sim_matrix.mean(axis=0)
    top_idxs = np.argsort(scores)[::-1]
    seed_set = set(seed_indices)
    chosen   = [i for i in top_idxs if i not in seed_set and scores[i] > 0][:top_n]
    return _rows_to_dicts_parallel(books.iloc[chosen], top_n)

def book_recommender(user_id: int, top_n: int = 10) -> list:
    user_rated = set(ratings[ratings["user_id"] == user_id]["book_id"].values)
    if _USE_BATCH_SVD:
        try:
            inner_uid = _uid_map.get(user_id)
            if inner_uid is None: return trending_books(top_n)
            all_scores = _global_mean + float(_bu[inner_uid]) + _bi + (_qi @ _pu[inner_uid])
            preds = []
            for row_idx, bid in enumerate(books["book_id"]):
                if bid in user_rated: continue
                inner_iid = _book_inner[row_idx]
                if inner_iid < 0: continue
                preds.append((row_idx, float(all_scores[inner_iid])))
            if not preds: return trending_books(top_n)
            preds.sort(key=lambda x: x[1], reverse=True)
            top_preds   = preds[:top_n]
            chosen_rows = books.iloc[[p[0] for p in top_preds]]
            pr          = {books.index[p[0]]: p[1] for p in top_preds}
            return _rows_to_dicts_parallel(chosen_rows, top_n, pr)
        except Exception:
            pass
    preds = []
    for book_id in books["book_id"].unique():
        if book_id not in user_rated:
            try: preds.append((book_id, model.predict(user_id, book_id).est))
            except Exception: pass
    if not preds: return trending_books(top_n)
    preds.sort(key=lambda x: x[1], reverse=True)
    chosen = [_book_id_to_idx[int(bid)] for bid, _ in preds[:top_n] if int(bid) in _book_id_to_idx]
    pr     = {int(books.index[_book_id_to_idx[int(bid)]]): score
              for bid, score in preds[:top_n] if int(bid) in _book_id_to_idx}
    return _rows_to_dicts_parallel(books.iloc[chosen], top_n, pr)

def trending_books(top_n: int = 20) -> list:
    return _rows_to_dicts_parallel(books.iloc[_trending_order[:top_n]], top_n)

# search autocomplete
def search_autocomplete(query: str, limit: int = 10) -> list:
    if not query or not query.strip(): return []
    q = query.lower().strip()
    genre_key = next((gk for gk in _GENRE_TAG_MAP if gk == q or q in gk or gk in q), None)
    if genre_key:
        res = recommend_by_genre(genre_key, top_n=limit)
        if res: return res
    title_mask  = books["title_clean"].str.contains(q, na=False, regex=False)
    author_mask = books["authors_clean"].str.contains(q, na=False, regex=False)
    genre_mask  = books["genre_clean"].str.contains(q, na=False, regex=False)
    matches     = books[title_mask | author_mask | genre_mask]
    if matches.empty: return []
    ranked = pd.concat([
        matches[matches["title_clean"].str.startswith(q, na=False)],
        matches[title_mask  & ~matches["title_clean"].str.startswith(q, na=False)],
        matches[author_mask & ~title_mask],
        matches[genre_mask  & ~title_mask & ~author_mask],
    ]).copy()
    ranked["_s"] = ranked["average_rating"] * (ranked["rating_count"].astype(float) ** 0.3)
    return _rows_to_dicts_parallel(ranked.sort_values("_s", ascending=False), limit)

# new releases / hybrid recommend
def fetch_new_releases(max_results: int = 20) -> list | dict:
    queries = ["subject:fiction","subject:thriller","subject:romance","subject:fantasy","subject:mystery"]
    def _fetch_query(q: str) -> list:
        out = []
        try:
            params = {"q": q, "orderBy": "newest", "maxResults": 8,
                      "printType": "books", "langRestrict": "en"}
            if GOOGLE_BOOKS_API_KEY: params["key"] = GOOGLE_BOOKS_API_KEY
            r = requests.get(_GBOOKS_URL, params=params, timeout=8)
            if not r.ok:
                print(f"[new_releases] HTTP {r.status_code} for '{q}'")
                return out
            for item in r.json().get("items", []):
                info  = item.get("volumeInfo", {})
                title = (info.get("title") or "").strip()
                if not title: continue
                links = info.get("imageLinks", {})
                img   = (links.get("extraLarge") or links.get("large") or
                         links.get("medium") or links.get("small") or
                         links.get("thumbnail") or links.get("smallThumbnail") or "")
                img = img.replace("http://", "https://")
                img = re.sub(r'zoom=\d', 'zoom=2', img)
                img = img.replace("&edge=curl", "")
                if not img: continue
                pub_date = info.get("publishedDate", "")
                pub_year = ""
                m = re.search(r'\b(1[0-9]{3}|20[0-9]{2})\b', pub_date)
                if m: pub_year = m.group(1)
                out.append({
                    "title":          title,
                    "authors":        ", ".join(info.get("authors", ["Unknown"])),
                    "average_rating": info.get("averageRating", 0),
                    "rating_count":   info.get("ratingsCount", 0),
                    "image_url":      img,
                    "description":    info.get("description", ""),
                    "genre":          ", ".join(info.get("categories", [])),
                    "published_date": pub_year,
                })
        except Exception as e:
            print(f"[new_releases] '{q}': {e}")
        return out

    seen, results = set(), []
    with ThreadPoolExecutor(max_workers=5) as ex:
        futures = {ex.submit(_fetch_query, q): q for q in queries}
        for future in as_completed(futures):
            try:
                for book in future.result():
                    key = book["title"].lower()
                    if key not in seen: seen.add(key); results.append(book)
            except Exception as e:
                print(f"[new_releases] future: {e}")

    if not results:
        return {"error": True, "message": "Couldn't load new releases right now.", "books": []}
    results.sort(key=lambda b: b.get("published_date", ""), reverse=True)
    return results[:max_results]

def hybrid_recommend(
    user_id:      int        | None = None,
    title:        str        | None = None,
    top_n:        int               = 10,
    liked_titles: list | None       = None,
    saved_titles: list | None       = None,
) -> list:
    liked_titles = [t for t in (liked_titles or []) if isinstance(t, str) and t.strip()]
    saved_titles = [t for t in (saved_titles or []) if isinstance(t, str) and t.strip()]
    if liked_titles or saved_titles:
        recs = recommend_from_saved_liked(liked_titles, saved_titles, top_n)
        if recs: return recs
    if title and isinstance(title, str) and title.strip():
        recs = recommend_by_title(title, top_n)
        if recs: return recs
    if user_id is not None:
        try:
            recs = book_recommender(user_id, top_n)
            if recs: return recs
        except Exception:
            pass
    return trending_books(top_n)

def trending_and_new_books(top_n: int = 20, new_n: int = 20) -> dict:
    return {"trending": trending_books(top_n), "new": fetch_new_releases(new_n)}
# time + season + smart home
def get_current_season() -> str:
    m = datetime.now().month
    return ("winter" if m in (12, 1, 2) else "spring" if m in (3, 4, 5)
            else "summer" if m in (6, 7, 8) else "autumn")

_SEASON_CONFIG = {
    "summer": {"label":"Summer Reads","message":"Sun-soaked stories for long bright days",  "genres":["adventure","romance","thriller","comedy"], "mood":"beach holiday adventure sun romance light-hearted escapism warm fast-paced"},
    "winter": {"label":"Winter Reads","message":"Curl up with something long and immersive","genres":["fantasy","classics","mystery","horror"],"mood":"epic fantasy cosy long immersive dark saga fireside cold winter"},
    "spring": {"label":"Spring Reads","message":"Fresh stories for new beginnings", "genres":["fiction","romance","young-adult","poetry"],"mood":"new beginnings hope renewal growth optimistic fresh character"},
    "autumn": {"label":"Autumn Reads","message":"Rich, literary reads for crisp evenings", "genres":["mystery","thriller","history","classics"],"mood":"nostalgia literary atmospheric detective gothic crime melancholic autumn"},
}

_TIME_CONFIG = {
    "early_morning": {"label":"Rise and Shine","message":"Start your day right","genres":["self-help","philosophy","poetry"],"mood":"clarity focus purpose mindfulness self-improvement essays philosophy calm morning"},
    "morning":       {"label":"Morning Reads","message":"Perfect with your morning coffee","genres":["crime","thriller","mystery"],"mood":"gripping detective crime procedural whodunit fast-paced engaging morning commute"},
    "afternoon":     {"label":"Lunch Break","message":"Quick and gripping reads","genres":["comedy","adventure","young-adult"], "mood":"light funny witty entertaining breezy romantic comedy adventure quick read"},
    "late_afternoon":{"label":"Afternoon Escape","message":"Lose yourself in a great story","genres":["fiction","literary","history"], "mood":"immersive literary character-driven emotional rich prose absorbing drama"},
    "evening":       {"label":"Evening Wind-Down","message":"Wind down with these favourites", "genres":["thriller","mystery","crime"], "mood":"suspenseful tense psychological thriller page-turner atmospheric twisty gripping"},
    "night":         {"label":"Bedtime Picks","message":"Perfect reads before you sleep","genres":["romance","paranormal","classics"],"mood":"soothing tender romantic soft cosy heartwarming gentle love slow quiet comforting bedtime"},
    "late_night":    {"label":"Past Midnight","message":"For those who read past midnight", "genres":["horror","thriller","sci-fi"], "mood":"dark psychological unsettling obsessive disturbing twisty horror suspense midnight"},
}

def get_time_slot() -> str:
    h = datetime.now().hour
    return ("early_morning" if 5 <= h < 8 else "morning" if 8 <= h < 12
            else "afternoon" if 12 <= h < 14 else "late_afternoon" if 14 <= h < 18
            else "evening" if 18 <= h < 21 else "night" if 21 <= h < 24 else "late_night")

def _build_label_message(time_slot: str, season: str) -> tuple[str, str]:
    tc = _TIME_CONFIG[time_slot]; sc = _SEASON_CONFIG[season]
    return f"{tc['label']}  ·  {sc['label']}", f"{tc['message']} — {sc['message'].lower()}"

def smart_home_recommendations(
    liked_titles: list | None = None,
    saved_titles: list | None = None,
    user_id:      int  | None = None,
    top_n:        int         = 20,
) -> dict:
    liked_titles = [t for t in (liked_titles or []) if isinstance(t, str) and t.strip()]
    saved_titles = [t for t in (saved_titles or []) if isinstance(t, str) and t.strip()]
    time_slot    = get_time_slot()
    season       = get_current_season()
    label, message = _build_label_message(time_slot, season)
    seed_titles  = (liked_titles + saved_titles)[:5]
    sections: list = []

    global_seen: set[str] = set()
    def _dedup(bl: list) -> list:
        out = []
        for b in bl:
            k = b["title"].lower()
            if k not in global_seen:
                global_seen.add(k); out.append(b)
        return out

    if liked_titles or saved_titles:
        personal_books = recommend_from_saved_liked(liked_titles, saved_titles, top_n=top_n * 2)
        label_ = (f"Because You Liked {liked_titles[0]!r}" if liked_titles
                  else "Because You Saved These Books")
        sections.append({"heading": label_, "books": _dedup(personal_books)[:top_n]})

    if user_id is not None:
        try:
            cf_books = book_recommender(user_id, top_n=top_n * 2)
            if cf_books:
                sections.append({"heading": "Picked For You", "books": _dedup(cf_books)[:top_n]})
        except Exception:
            pass

    time_books = recommend_by_mood_semantic(
        mood=_TIME_CONFIG[time_slot]["mood"],
        context={"time_of_day": time_slot, "season": season},
        seed_titles=seed_titles, user_id=user_id,
        top_n=top_n * 3, use_llm=False, offset=0,
    )
    sections.append({"heading": _TIME_CONFIG[time_slot]["label"],
                     "books": _dedup(time_books)[:top_n]})

    season_books = recommend_by_mood_semantic(
        mood=_SEASON_CONFIG[season]["mood"],
        context={"season": season},
        seed_titles=seed_titles, user_id=user_id,
        top_n=top_n * 3, use_llm=False, offset=top_n,
    )
    sections.append({"heading": _SEASON_CONFIG[season]["label"],
                     "books": _dedup(season_books)[:top_n]})

    sections.append({"heading": "Trending Now",
                     "books": _dedup(trending_books(top_n=top_n * 4))[:top_n]})

    return {
        "slot": time_slot, "season": season, "label": label,
        "message": message, "semantic_on": _sem_ready, "sections": sections,
    }

# status
def _check_ollama() -> str:
    try:
        models = [m["name"] for m in ollama.list().get("models", [])]
        return f"running — models: {', '.join(models[:3])}"
    except Exception as e:
        return f"unavailable ({e}) — using TF-IDF fallback"

def get_recommender_status() -> dict:
    return {
        "semantic_ready":     _sem_ready,
        "faiss_vectors":      _faiss_index.ntotal if _faiss_index else 0,
        "faiss_dim":          _faiss_index.d      if _faiss_index else 0,
        "embed_model":        _EMBED_MODEL,
        "llm_model":          _LLM_MODEL,
        "svd_batch_mode":     _USE_BATCH_SVD,
        "books_loaded":       len(books),
        "ratings_loaded":     len(ratings),
        "desc_col":           _DESC_COL,
        "year_col":           _YEAR_COL,
        "time_slot":          get_time_slot(),
        "season":             get_current_season(),
        "ollama_status":      _check_ollama(),
        "romance_index_size": len(_GENRE_INDEX.get("romance", [])),
    }

# rating weights
def get_rating_weight(user_id: int, csv_book_id: int, db: Session) -> float:
    book_result = db.execute(
        select(Book.id).where(Book.book_id == csv_book_id)
    ).scalar_one_or_none()
    if not book_result:
        return 1.0
    book_pk = book_result
    rating_entry = db.execute(
        select(Rating).where(
            Rating.user_id == user_id,
            Rating.book_id == book_pk,
        )
    ).scalar_one_or_none()
    if not rating_entry:
        return 1.0
    weight_map = {5: 1.5, 4: 1.2, 3: 1.0, 2: 0.6, 1: 0.3}
    return weight_map.get(rating_entry.rating, 1.0)

def get_all_user_rating_weights(user_id: int, db: Session) -> dict[int, float]:
    rows = db.execute(
        select(Book.book_id, Rating.rating)
        .join(Rating, Rating.book_id == Book.id)
        .where(Rating.user_id == user_id)
    ).all()
    weight_map = {5: 1.5, 4: 1.2, 3: 1.0, 2: 0.6, 1: 0.3}
    return {
        int(row.book_id): weight_map.get(row.rating, 1.0)
        for row in rows
    }

def apply_rating_weights(candidates: list, user_id: int, db: Session) -> list:
    if not candidates or not user_id:
        return candidates
    weights = get_all_user_rating_weights(user_id, db)
    for item in candidates:
        csv_id = item.get("book_id")
        if csv_id is not None:
            item["score"] = item.get("score", 1.0) * weights.get(int(csv_id), 1.0)
    candidates.sort(key=lambda x: x.get("score", 0), reverse=True)
    return candidates
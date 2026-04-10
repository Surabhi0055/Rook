# recommendation.py
from typing import List, Optional

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import models
import schemas
from database import AsyncSessionLocal
from recommender import (
    book_recommender,
    hybrid_recommend,
    recommend_by_author,
    recommend_by_description,
    recommend_by_genre,
    recommend_by_title,
    recommend_from_saved_liked,
    recommend_by_mood_semantic,
    search_autocomplete,
    trending_and_new_books,
    trending_books,
    smart_home_recommendations,
    get_recommender_status,
    apply_rating_weights
)

# ── Router ────────────────────────────────────────────────────────────────────
router = APIRouter(
    tags=["Recommendations"],
)


# ── DB Dependency ─────────────────────────────────────────────────────────────
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


# ── Helper: fetch DB-persisted favorites for a user ──────────────────────────
async def _db_favorites(user_id: int, db: AsyncSession) -> List[str]:
    result = await db.execute(
        select(models.Favorite)
        .where(models.Favorite.user_id == user_id)
    )
    favs = result.scalars().all()
    titles = []
    for fav in favs:
        book_result = await db.execute(
            select(models.Book).where(models.Book.book_id == fav.book_id)
        )
        book = book_result.scalar_one_or_none()
        if book:
            titles.append(book.title)
    return titles


def _merge(from_request: List[str], from_db: List[str]) -> List[str]:
    """Merge two title lists, deduplicate, preserve order."""
    seen = set()
    out  = []
    for t in (from_request + from_db):
        if not isinstance(t, str) or not t.strip():
            continue
        key = t.lower().strip()
        if key not in seen:
            seen.add(key)
            out.append(t)
    return out


# ── Request models ────────────────────────────────────────────────────────────

class _MoodRequestWithOffset(BaseModel):
    mood:         str            = Field(..., description="Mood or reading context string")
    top_n:        int            = Field(12, ge=1, le=50)
    user_id:      Optional[int]  = None
    liked_titles: List[str]      = []
    saved_titles: List[str]      = []
    season:       Optional[str]  = None
    time_of_day:  Optional[str]  = None
    travel:       Optional[str]  = None
    reading_time: Optional[str]  = None
    user_genres:  List[str]      = []
    use_llm:      bool           = True
    offset:       int            = Field(0, ge=0)


class _ContextRequestWithOffset(BaseModel):
    top_n:        int            = Field(12, ge=1, le=50)
    user_id:      Optional[int]  = None
    liked_titles: List[str]      = []
    saved_titles: List[str]      = []
    season:       Optional[str]  = None
    time_of_day:  Optional[str]  = None
    travel:       Optional[str]  = None
    reading_time: Optional[str]  = None
    user_genres:  List[str]      = []
    use_llm:      bool           = True
    offset:       int            = Field(0, ge=0)


class _SavedLikedRequest(BaseModel):
    liked_titles:  List[str]      = []
    saved_titles:  List[str]      = []
    read_titles:   List[str]      = []
    user_genres:   List[str]      = []
    user_action:   Optional[str]  = None
    context_title: Optional[str]  = None
    top_n:         int            = Field(24, ge=1, le=50)
    user_id:       Optional[int]  = None


# ══════════════════════════════════════════════════════════════════════════════
#  1. SVD COLLABORATIVE FILTERING
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/recommend/user",
    summary="Personalised picks via SVD collaborative filtering",
)
def recommend_user(
    user_id: int = Query(..., description="CF model user_id from ratings CSV"),
    top_n:   int = Query(10, ge=1, le=50),
):
    return book_recommender(user_id, top_n)


# ══════════════════════════════════════════════════════════════════════════════
#  2. GENRE
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/recommend/genre",
    summary="Books filtered by genre, ranked by popularity score",
)
def recommend_genre(
    genre: str = Query(..., description="Genre name, e.g. 'fantasy'"),
    top_n: int = Query(20, ge=1, le=500),
):
    return recommend_by_genre(genre, top_n)


# ══════════════════════════════════════════════════════════════════════════════
#  3. AUTHOR
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/recommend/author",
    summary="Books filtered by author, ranked by popularity score",
)
def recommend_author(
    author: str = Query(..., description="Author name, e.g. 'Rowling'"),
    top_n:  int = Query(20, ge=1, le=100),
):
    return recommend_by_author(author, top_n)


# ══════════════════════════════════════════════════════════════════════════════
#  4. TITLE  (content-based cosine similarity)
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/recommend/title",
    summary="Content-based recs from a seed book title",
)
def recommend_title(
    title: str = Query(...),
    top_n: int = Query(10, ge=1, le=50),
):
    return recommend_by_title(title, top_n)


# ══════════════════════════════════════════════════════════════════════════════
#  5. DESCRIPTION  (TF-IDF / semantic query + RL re-ranking)
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/recommend/description",
    summary="Find books from a free-text mood/theme description",
)
async def recommend_description(
    body:    schemas.DescriptionRequest,
    user_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    liked = list(body.liked_titles)
    saved = list(body.saved_titles)

    if user_id:
        db_favs = await _db_favorites(user_id, db)
        liked   = _merge(liked, db_favs)

    result = recommend_by_description(
        description  = body.description,
        top_n        = body.top_n,
        liked_titles = liked,
        saved_titles = saved,
    )

    if user_id:
        result = apply_rating_weights(
            [{"book_id": b.get("book_id", i), "score": b.get("predicted_rating", 3.0)}
             for i, b in enumerate(result)],
            user_id=user_id, db=db
        )

    return result


# ══════════════════════════════════════════════════════════════════════════════
#  6. SAVED / LIKED  (LLM-powered personalised)
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/recommend/saved",
    summary="LLM-powered personalised recs from user's full library + action history",
)
async def recommend_saved(
    body:    _SavedLikedRequest,
    db_user: Optional[int] = Query(None, alias="db_user_id"),
    db: AsyncSession = Depends(get_db),
):
    liked = list(body.liked_titles or [])
    saved = list(body.saved_titles or [])
    read  = list(body.read_titles  or [])

    if db_user:
        db_favs = await _db_favorites(db_user, db)
        liked   = _merge(liked, db_favs)

    result = recommend_from_saved_liked(
        liked_titles  = liked,
        saved_titles  = saved,
        top_n         = body.top_n,
        read_titles   = read,
        user_genres   = list(body.user_genres or []),
        user_action   = body.user_action,
        context_title = body.context_title,
    )

    user_id_val = body.user_id
    if user_id_val:
        result = apply_rating_weights(
            [{"book_id": b.get("book_id", i), "score": b.get("predicted_rating", 3.0)}
             for i, b in enumerate(result)],
            user_id=user_id_val, db=db
        )

    return result


# ══════════════════════════════════════════════════════════════════════════════
#  7. SAVED-LIKED  (backward-compatible alias)
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/recommend/saved-liked",
    summary="Backward-compatible alias for /recommend/saved",
)
async def recommend_saved_liked(
    body:    _SavedLikedRequest,
    user_id: Optional[int] = Query(None),
    db: AsyncSession = Depends(get_db),
):
    liked = list(body.liked_titles or [])
    saved = list(body.saved_titles or [])
    read  = list(body.read_titles  or [])

    if user_id:
        db_favs = await _db_favorites(user_id, db)
        liked   = _merge(liked, db_favs)

    result = recommend_from_saved_liked(
        liked_titles  = liked,
        saved_titles  = saved,
        top_n         = body.top_n,
        read_titles   = read,
        user_genres   = list(body.user_genres or []),
        user_action   = body.user_action,
        context_title = body.context_title,
    )

    user_id_val = body.user_id
    if user_id_val:
        result = apply_rating_weights(
            [{"book_id": b.get("book_id", i), "score": b.get("predicted_rating", 3.0)}
             for i, b in enumerate(result)],
            user_id=user_id_val, db=db
        )

    return result


# ══════════════════════════════════════════════════════════════════════════════
#  8. HYBRID  (GET — backward-compatible)
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/recommend/hybrid",
    summary="Hybrid GET — SVD → title content-based → trending",
)
def recommend_hybrid_get(
    user_id: Optional[int] = Query(None),
    title:   Optional[str] = Query(None),
    top_n:   int           = Query(10, ge=1, le=50),
):
    return hybrid_recommend(user_id=user_id, title=title, top_n=top_n)


# ══════════════════════════════════════════════════════════════════════════════
#  9. HYBRID  (POST — full pipeline with saved/liked)
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/recommend/hybrid",
    summary="Hybrid POST — SVD → saved/liked → title → trending",
)
async def recommend_hybrid_post(
    body:    _SavedLikedRequest,
    user_id: Optional[int] = Query(None),
    title:   Optional[str] = Query(None),
    db_user: Optional[int] = Query(None, alias="db_user_id"),
    db: AsyncSession = Depends(get_db),
):
    liked = list(body.liked_titles or [])
    saved = list(body.saved_titles or [])

    if db_user:
        db_favs = await _db_favorites(db_user, db)
        liked   = _merge(liked, db_favs)

    result = hybrid_recommend(
        user_id      = user_id,
        title        = title,
        top_n        = body.top_n,
        liked_titles = liked,
        saved_titles = saved,
    )

    user_id_val = body.user_id
    if user_id_val:
        result = apply_rating_weights(
            [{"book_id": b.get("book_id", i), "score": b.get("predicted_rating", 3.0)}
             for i, b in enumerate(result)],
            user_id=user_id_val, db=db
        )

    return result


# ══════════════════════════════════════════════════════════════════════════════
#  10. MOOD  — LLM query expansion + semantic FAISS + 4-pillar fusion
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/recommend/mood",
    summary="Mood-aware recommendations — LLM query expansion + semantic FAISS + hybrid fusion",
)
async def recommend_mood(
    body:    _MoodRequestWithOffset,
    db_user: Optional[int] = Query(None, alias="db_user_id"),
    db: AsyncSession = Depends(get_db),
):
    liked = list(body.liked_titles or [])
    saved = list(body.saved_titles or [])

    if db_user:
        db_favs = await _db_favorites(db_user, db)
        liked   = _merge(liked, db_favs)

    seed_titles = liked + saved

    context = {k: v for k, v in {
        "season":       body.season,
        "time_of_day":  body.time_of_day,
        "travel":       body.travel,
        "reading_time": body.reading_time,
        "user_genres":  body.user_genres or [],
    }.items() if v}

    result = recommend_by_mood_semantic(
        mood        = body.mood,
        context     = context,
        seed_titles = seed_titles,
        user_id     = body.user_id,
        top_n       = body.top_n,
        use_llm     = body.use_llm,
        offset      = body.offset,
    )

    user_id_val = body.user_id
    if user_id_val:
        result = apply_rating_weights(
            [{"book_id": b.get("book_id", i), "score": b.get("predicted_rating", 3.0)}
             for i, b in enumerate(result)],
            user_id=user_id_val, db=db
        )

    return result


# ══════════════════════════════════════════════════════════════════════════════
#  11. CONTEXT  — pure context-based (season / travel / time) with LLM
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/recommend/context",
    summary="Context-aware recommendations driven by season, travel, and time signals",
)
async def recommend_context(
    body:    _ContextRequestWithOffset,
    db_user: Optional[int] = Query(None, alias="db_user_id"),
    db: AsyncSession = Depends(get_db),
):
    liked = list(body.liked_titles or [])
    saved = list(body.saved_titles or [])

    if db_user:
        db_favs = await _db_favorites(db_user, db)
        liked   = _merge(liked, db_favs)

    seed_titles = liked + saved

    context_parts = []
    if body.season:       context_parts.append(body.season)
    if body.travel:       context_parts.append(f"{body.travel} trip")
    if body.time_of_day:  context_parts.append(f"{body.time_of_day} reading")
    if body.reading_time: context_parts.append(f"{body.reading_time} read")
    synthetic_mood = ", ".join(context_parts) if context_parts else "relaxing"

    context = {k: v for k, v in {
        "season":       body.season,
        "time_of_day":  body.time_of_day,
        "travel":       body.travel,
        "reading_time": body.reading_time,
        "user_genres":  body.user_genres or [],
    }.items() if v}

    result = recommend_by_mood_semantic(
        mood        = synthetic_mood,
        context     = context,
        seed_titles = seed_titles,
        user_id     = body.user_id,
        top_n       = body.top_n,
        use_llm     = body.use_llm,
        offset      = body.offset,
    )

    user_id_val = body.user_id
    if user_id_val:
        result = apply_rating_weights(
            [{"book_id": b.get("book_id", i), "score": b.get("predicted_rating", 3.0)}
             for i, b in enumerate(result)],
            user_id=user_id_val, db=db
        )

    return result


# ══════════════════════════════════════════════════════════════════════════════
#  SEARCH & TRENDING
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/search",
    summary="Autocomplete — prefix-ranked title search with author + semantic fallback",
)
def search(
    query: str,
    top_n: int  = 10,
    limit: int  = None,
):
    n = limit if limit is not None else top_n
    return search_autocomplete(query, n)


@router.get(
    "/trending",
    summary="Global trending books",
)
def trending(
    top_n: int = Query(100, ge=1, le=500),
):
    return trending_books(top_n)


@router.get(
    "/trending/new",
    summary="Trending books + recent new releases",
)
def trending_new(
    top_n:            int = Query(20, ge=1, le=100),
    new_n:            int = Query(10, ge=1, le=50),
    new_within_years: int = Query(2,  ge=1, le=20),
):
    return trending_and_new_books(top_n=top_n, new_n=new_n)


# ══════════════════════════════════════════════════════════════════════════════
#  HOME RECOMMENDATIONS
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/recommend/home-recommendations",
    summary="Time + season + personalised home page recommendations",
)
def home_recommendations(
    user_id: Optional[int] = Query(None),
    liked:   Optional[str] = Query(None, description="Comma-separated liked titles"),
    saved:   Optional[str] = Query(None, description="Comma-separated saved titles"),
    top_n:   int           = Query(20, ge=1, le=50),
):
    liked_list = [t.strip() for t in liked.split(",") if t.strip()] if liked else []
    saved_list = [t.strip() for t in saved.split(",") if t.strip()] if saved else []
    return smart_home_recommendations(
        liked_titles = liked_list,
        saved_titles = saved_list,
        user_id      = user_id,
        top_n        = top_n,
    )


# ══════════════════════════════════════════════════════════════════════════════
#  STATUS
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/status",
    summary="Recommender health check — shows semantic layer, model, dataset info",
)
def recommender_status():
    return get_recommender_status()
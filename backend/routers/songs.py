import json
import os
import re
import time
import random
import httpx
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(prefix="/songs", tags=["Songs"])

# ─── Env / config ─────────────────────────────────────────────────────────────
_LLM_MODEL             = os.getenv("ROOK_LLM_MODEL", "llama3.2:3b")
_LLM_FALLBACK          = "llama3.2:1b"
_SPOTIFY_CLIENT_ID     = os.getenv("SPOTIFY_CLIENT_ID", "")
_SPOTIFY_CLIENT_SECRET = os.getenv("SPOTIFY_CLIENT_SECRET", "")

# ─── Spotify token cache ───────────────────────────────────────────────────────
_spotify_token: str = ""
_spotify_token_expiry: float = 0.0


async def _get_spotify_token() -> str:
    global _spotify_token, _spotify_token_expiry
    if _spotify_token and time.time() < _spotify_token_expiry - 60:
        return _spotify_token
    if not _SPOTIFY_CLIENT_ID or not _SPOTIFY_CLIENT_SECRET:
        return ""
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.post(
                "https://accounts.spotify.com/api/token",
                data={"grant_type": "client_credentials"},
                auth=(_SPOTIFY_CLIENT_ID, _SPOTIFY_CLIENT_SECRET),
            )
            if r.status_code == 200:
                data = r.json()
                _spotify_token = data["access_token"]
                _spotify_token_expiry = time.time() + data.get("expires_in", 3600)
                return _spotify_token
    except Exception as e:
        print(f"[songs] Spotify token error: {e}")
    return ""


async def _search_spotify(query: str, limit: int = 10) -> list:
    token = await _get_spotify_token()
    if not token:
        return []
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(
                "https://api.spotify.com/v1/search",
                headers={"Authorization": f"Bearer {token}"},
                params={"q": query, "type": "track", "limit": limit, "market": "US"},
            )
            if r.status_code != 200:
                print(f"[songs] Spotify search failed: {r.status_code}")
                return []
            items = r.json().get("tracks", {}).get("items", [])
            results = []
            for t in items:
                if not t:
                    continue
                images = t.get("album", {}).get("images", [])
                results.append({
                    "title":       t["name"],
                    "artist":      ", ".join(a["name"] for a in t.get("artists", [])),
                    "spotify_url": t.get("external_urls", {}).get("spotify", ""),
                    "preview_url": "",
                    "image":       images[0]["url"] if images else "",
                    "mood":        "",
                })
            return results
    except Exception as e:
        print(f"[songs] Spotify search error: {e}")
        return []


async def _search_spotify_multi(queries: list, target: int = 5) -> list:
    seen_keys: set = set()
    merged: list = []
    for q in queries:
        if len(merged) >= target:
            break
        tracks = await _search_spotify(q, limit=min(10, target * 2))
        for t in tracks:
            key = (t["title"].lower().strip(), t["artist"].lower()[:25].strip())
            if key not in seen_keys:
                seen_keys.add(key)
                merged.append(t)
            if len(merged) >= target:
                break
    return merged[:target]


async def _lookup_spotify_track(title: str, artist: str) -> Optional[dict]:
    token = await _get_spotify_token()
    if not token:
        return None
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            r = await client.get(
                "https://api.spotify.com/v1/search",
                headers={"Authorization": f"Bearer {token}"},
                params={"q": f"track:{title} artist:{artist}", "type": "track", "limit": 1, "market": "US"},
            )
            if r.status_code != 200:
                return None
            items = r.json().get("tracks", {}).get("items", [])
            if not items:
                return None
            t = items[0]
            images = t.get("album", {}).get("images", [])
            return {
                "title":       t["name"],
                "artist":      ", ".join(a["name"] for a in t.get("artists", [])),
                "spotify_url": t.get("external_urls", {}).get("spotify", ""),
                "preview_url": "",
                "image":       images[0]["url"] if images else "",
                "mood":        "",
            }
    except Exception as e:
        print(f"[songs] Spotify track lookup error: {e}")
        return None


# ─── Skip non-narrative genres ────────────────────────────────────────────────
_NO_SONG_GENRES = {
    "textbook", "academic", "mathematics", "physics", "chemistry", "engineering",
    "programming", "computer science", "law", "legal", "medicine", "medical",
    "cooking", "cookbook", "recipes", "travel guide", "guidebook", "dictionary",
    "encyclopedia", "grammar", "exam prep", "test prep",
}
_NO_SONG_TITLE_SIGNALS = [
    "how to ", "guide to ", "introduction to ", "teach yourself", "complete guide",
    "for dummies", "step by step", "workbook", "study guide", "exam prep", "test prep",
]

def _should_skip(genre: str, title: str) -> bool:
    g, t = genre.lower(), title.lower()
    return any(ng in g for ng in _NO_SONG_GENRES) or any(s in t for s in _NO_SONG_TITLE_SIGNALS)


# ─── KNOWN BOOK → CURATED SOUNDTRACK ─────────────────────────────────────────
_KNOWN_SOUNDTRACKS: dict = {
    "the great gatsby": [
        {"title": "Young and Beautiful",               "artist": "Lana Del Rey",           "mood": "haunting golden longing"},
        {"title": "A Little Party Never Killed Nobody","artist": "Fergie",                 "mood": "roaring twenties glamour"},
        {"title": "Over the Love",                     "artist": "Florence + the Machine", "mood": "aching romantic yearning"},
        {"title": "Together",                          "artist": "Sia",                    "mood": "desperate glittering excess"},
        {"title": "Where the Wind Blows",              "artist": "Cody Fry",               "mood": "nostalgic bittersweet dream"},
    ],
    "call me by your name": [
        {"title": "Mystery of Love",   "artist": "Sufjan Stevens",     "mood": "tender aching summer beauty"},
        {"title": "Visions of Gideon", "artist": "Sufjan Stevens",     "mood": "haunting bittersweet longing"},
        {"title": "Futile Devices",    "artist": "Sufjan Stevens",     "mood": "quiet tender devotion"},
        {"title": "Come Back to Me",   "artist": "Sufjan Stevens",     "mood": "fragile yearning love"},
        {"title": "Love My Way",       "artist": "Psychedelic Furs",   "mood": "electric golden summer desire"},
    ],
    "the summer i turned pretty": [
        {"title": "Cruel Summer",     "artist": "Taylor Swift", "mood": "electric teenage tension"},
        {"title": "cardigan",         "artist": "Taylor Swift", "mood": "bittersweet first love"},
        {"title": "august",           "artist": "Taylor Swift", "mood": "golden summer memory"},
        {"title": "Summer Girl",      "artist": "HAIM",         "mood": "warm nostalgic longing"},
        {"title": "The Night We Met", "artist": "Lord Huron",   "mood": "aching youthful regret"},
    ],
    "its not summer without you": [
        {"title": "august",           "artist": "Taylor Swift", "mood": "fading summer nostalgia"},
        {"title": "Cruel Summer",     "artist": "Taylor Swift", "mood": "bittersweet heat"},
        {"title": "End of Beginning", "artist": "Djo",          "mood": "quiet heartbreak drift"},
        {"title": "Electric Love",    "artist": "BORNS",        "mood": "warm electric longing"},
        {"title": "Prom Dress",       "artist": "mxmtoon",      "mood": "soft teenage ache"},
    ],
    "well always have summer": [
        {"title": "Daylight",     "artist": "Taylor Swift",    "mood": "hopeful romantic bloom"},
        {"title": "Lover",        "artist": "Taylor Swift",    "mood": "tender dreamy warmth"},
        {"title": "august",       "artist": "Taylor Swift",    "mood": "summer memory shimmer"},
        {"title": "Golden",       "artist": "Harry Styles",    "mood": "warm glowing love"},
        {"title": "Bloom",        "artist": "The Paper Kites", "mood": "soft romantic haze"},
    ],
    "white nights": [
        {"title": "Exit Music (For a Film)",   "artist": "Radiohead",             "mood": "cold desolate longing"},
        {"title": "The Night Will Always Win", "artist": "Manchester Orchestra",  "mood": "bleak tender isolation"},
        {"title": "Lua",                       "artist": "Bright Eyes",           "mood": "raw lonely yearning"},
        {"title": "Motion Picture Soundtrack", "artist": "Radiohead",             "mood": "fragile melancholic stillness"},
        {"title": "Fade Into You",             "artist": "Mazzy Star",            "mood": "hazy dreamlike ache"},
    ],
    "crime and punishment": [
        {"title": "How to Disappear Completely", "artist": "Radiohead",    "mood": "dissociative dark dread"},
        {"title": "Atmosphere",                  "artist": "Joy Division",  "mood": "cold oppressive weight"},
        {"title": "Where Is My Mind",            "artist": "Pixies",        "mood": "unravelling anxious tension"},
        {"title": "Disorder",                    "artist": "Joy Division",  "mood": "restless feverish guilt"},
        {"title": "Motion Picture Soundtrack",   "artist": "Radiohead",     "mood": "fragile psychological spiral"},
    ],
    "the brothers karamazov": [
        {"title": "Lux Aeterna",          "artist": "Clint Mansell",    "mood": "solemn aching gravitas"},
        {"title": "Spiegel im Spiegel",   "artist": "Arvo Part",        "mood": "sparse eternal stillness"},
        {"title": "Hurt",                 "artist": "Johnny Cash",      "mood": "haunting quiet devastation"},
        {"title": "The Sound of Silence", "artist": "Simon & Garfunkel","mood": "desolate moral void"},
        {"title": "Both Sides Now",       "artist": "Joni Mitchell",    "mood": "reflective earned wisdom"},
    ],
    "the secret history": [
        {"title": "Oblivion",                "artist": "Grimes",              "mood": "cold dark academia chill"},
        {"title": "My Body Is a Cage",       "artist": "Arcade Fire",         "mood": "suffocating privileged guilt"},
        {"title": "Comptine d'un autre ete", "artist": "Yann Tiersen",        "mood": "delicate haunting elegance"},
        {"title": "Creep",                   "artist": "Radiohead",           "mood": "outsider desperate longing"},
        {"title": "I Giorni",                "artist": "Ludovico Einaudi",    "mood": "melancholic refined beauty"},
    ],
    "if we were villains": [
        {"title": "Oblivion",    "artist": "Grimes",                  "mood": "theatrical dark obsession"},
        {"title": "Seven Devils","artist": "Florence + the Machine",  "mood": "dramatic doom-laden dread"},
        {"title": "O Fortuna",   "artist": "Carl Orff",               "mood": "epic theatrical fate"},
        {"title": "Sorrow",      "artist": "David Bowie",             "mood": "elegant decadent grief"},
        {"title": "Lux Aeterna", "artist": "Clint Mansell",           "mood": "solemn impending doom"},
    ],
    "dead poets society": [
        {"title": "To Build a Home",         "artist": "The Cinematic Orchestra", "mood": "tender fragile beauty"},
        {"title": "Blackbird",               "artist": "The Beatles",             "mood": "gentle hopeful awakening"},
        {"title": "The Sound of Silence",    "artist": "Simon & Garfunkel",       "mood": "quiet lonely resistance"},
        {"title": "Comptine d'un autre ete", "artist": "Yann Tiersen",            "mood": "nostalgic delicate youth"},
        {"title": "Vincent",                 "artist": "Don McLean",              "mood": "tender melancholic beauty"},
    ],
    "pride and prejudice": [
        {"title": "Comptine d'un autre ete", "artist": "Yann Tiersen",  "mood": "delicate nostalgic charm"},
        {"title": "From Eden",               "artist": "Hozier",        "mood": "slow aching pull"},
        {"title": "Clair de Lune",           "artist": "Claude Debussy","mood": "timeless moonlit grace"},
        {"title": "The Night We Met",        "artist": "Lord Huron",    "mood": "bittersweet romantic longing"},
        {"title": "Gymnopédie No. 1",        "artist": "Erik Satie",    "mood": "soft delicate yearning"},
    ],
    "jane eyre": [
        {"title": "Wuthering Heights",        "artist": "Kate Bush",   "mood": "wild gothic yearning"},
        {"title": "Fade Into You",            "artist": "Mazzy Star",  "mood": "hazy dreamlike devotion"},
        {"title": "Skinny Love",              "artist": "Bon Iver",    "mood": "raw restrained ache"},
        {"title": "The Night We Met",         "artist": "Lord Huron",  "mood": "haunting romantic fate"},
        {"title": "Motion Picture Soundtrack","artist": "Radiohead",   "mood": "fragile melancholic stillness"},
    ],
    "wuthering heights": [
        {"title": "Wuthering Heights", "artist": "Kate Bush",                "mood": "wild obsessive yearning"},
        {"title": "Howl",              "artist": "Florence + the Machine",   "mood": "primal consuming passion"},
        {"title": "Cosmic Love",       "artist": "Florence + the Machine",   "mood": "dark transcendent devotion"},
        {"title": "Never Let Me Go",   "artist": "Florence + the Machine",   "mood": "haunting inevitable sorrow"},
        {"title": "Strange Love",      "artist": "Halsey",                   "mood": "destructive dark romance"},
    ],
    "harry potter and the philosophers stone": [
        {"title": "Hedwig's Theme",         "artist": "John Williams", "mood": "magical wonder discovery"},
        {"title": "Pure Imagination",       "artist": "Gene Wilder",   "mood": "whimsical childlike magic"},
        {"title": "Concerning Hobbits",     "artist": "Howard Shore",  "mood": "gentle pastoral warmth"},
        {"title": "Starman",                "artist": "David Bowie",   "mood": "otherworldly wonder arrival"},
        {"title": "Harry's Wondrous World", "artist": "John Williams", "mood": "enchanting adventurous delight"},
    ],
    "harry potter and the deathly hallows": [
        {"title": "O Children",         "artist": "Nick Cave and the Bad Seeds", "mood": "haunting dark farewell"},
        {"title": "Running Up That Hill","artist": "Kate Bush",                  "mood": "desperate sacrifice drive"},
        {"title": "Death With Dignity",  "artist": "Sufjan Stevens",             "mood": "tender grief acceptance"},
        {"title": "Oblivion",            "artist": "Grimes",                     "mood": "cold ethereal loss"},
        {"title": "The Scientist",       "artist": "Coldplay",                   "mood": "aching bittersweet regret"},
    ],
    "twilight": [
        {"title": "Flightless Bird American Mouth", "artist": "Iron and Wine",           "mood": "soft ethereal longing"},
        {"title": "Decode",                         "artist": "Paramore",                "mood": "tense dark obsession"},
        {"title": "Eyes on Fire",                   "artist": "Blue Foundation",         "mood": "cold predatory pull"},
        {"title": "Cosmic Love",                    "artist": "Florence + the Machine",  "mood": "dark transcendent pull"},
        {"title": "Bella's Lullaby",                "artist": "Carter Burwell",          "mood": "delicate haunting romance"},
    ],
    "the lord of the rings": [
        {"title": "Concerning Hobbits", "artist": "Howard Shore",  "mood": "gentle pastoral wonder"},
        {"title": "May It Be",          "artist": "Enya",          "mood": "ethereal hopeful farewell"},
        {"title": "Into the West",      "artist": "Annie Lennox",  "mood": "bittersweet epic ending"},
        {"title": "Kashmir",            "artist": "Led Zeppelin",  "mood": "vast mythic journey"},
        {"title": "Mordred's Lullaby",  "artist": "Heather Dale",  "mood": "dark enchanted dread"},
    ],
    "dune": [
        {"title": "Paul's Dream",       "artist": "Hans Zimmer",        "mood": "vast desert prophecy"},
        {"title": "Eclipse",            "artist": "Pink Floyd",          "mood": "cosmic epic scale"},
        {"title": "An Ending Ascent",   "artist": "Brian Eno",           "mood": "infinite ambient space"},
        {"title": "The Immigrant Song", "artist": "Led Zeppelin",        "mood": "mythic relentless power"},
        {"title": "Experience",         "artist": "Ludovico Einaudi",    "mood": "vast quiet wonder"},
    ],
    "gone girl": [
        {"title": "Immigrant Song",      "artist": "Karen O",          "mood": "cold driving menace"},
        {"title": "In the Air Tonight",  "artist": "Phil Collins",     "mood": "slow-burn revelation dread"},
        {"title": "You Know Im No Good", "artist": "Amy Winehouse",    "mood": "cool self-destructive calm"},
        {"title": "Criminal",            "artist": "Fiona Apple",      "mood": "chilling calculated dark"},
        {"title": "Teardrop",            "artist": "Massive Attack",   "mood": "cold clinical unease"},
    ],
    "rebecca": [
        {"title": "Gloomy Sunday",      "artist": "Billie Holiday", "mood": "mournful gothic dread"},
        {"title": "Fade Into You",      "artist": "Mazzy Star",     "mood": "hazy obsessive haunting"},
        {"title": "A Forest",           "artist": "The Cure",       "mood": "cold searching darkness"},
        {"title": "Strange Fruit",      "artist": "Billie Holiday", "mood": "heavy sinister shadow"},
        {"title": "Riders on the Storm","artist": "The Doors",      "mood": "rainy ominous drift"},
    ],
    "the alchemist": [
        {"title": "Holocene",    "artist": "Bon Iver",             "mood": "vast humbling wonder"},
        {"title": "Unwritten",   "artist": "Natasha Bedingfield",  "mood": "hopeful destiny beckons"},
        {"title": "Eye of the Tiger",  "artist": "Survivor",       "mood": "determined quest drive"},
        {"title": "Dust in the Wind",  "artist": "Kansas",         "mood": "humbling mortal reflection"},
        {"title": "The Road",    "artist": "Frank Turner",         "mood": "open horizon freedom"},
    ],
    "six of crows": [
        {"title": "Seven Devils",            "artist": "Florence + the Machine", "mood": "dark heist dread power"},
        {"title": "Run Boy Run",             "artist": "Woodkid",                "mood": "relentless desperate escape"},
        {"title": "Iron",                    "artist": "Woodkid",                "mood": "epic dark power"},
        {"title": "Radioactive",             "artist": "Imagine Dragons",        "mood": "gritty dystopian energy"},
        {"title": "No Church in the Wild",   "artist": "Jay-Z",                  "mood": "cold calculated danger"},
    ],
    "a little life": [
        {"title": "Death With Dignity",       "artist": "Sufjan Stevens",        "mood": "tender grief devastation"},
        {"title": "Casimir Pulaski Day",      "artist": "Sufjan Stevens",        "mood": "raw sorrow beauty"},
        {"title": "The Night Will Always Win","artist": "Manchester Orchestra",  "mood": "bleak quiet surrender"},
        {"title": "Motion Picture Soundtrack","artist": "Radiohead",             "mood": "fragile melancholic stillness"},
        {"title": "Skinny Love",              "artist": "Bon Iver",              "mood": "broken tender rawness"},
    ],
    "normal people": [
        {"title": "Georgia",                        "artist": "Phoebe Bridgers", "mood": "soft aching intimacy"},
        {"title": "Motion Sickness",                "artist": "Phoebe Bridgers", "mood": "restless longing tension"},
        {"title": "The Night We Met",               "artist": "Lord Huron",      "mood": "bittersweet romantic ache"},
        {"title": "Skinny Love",                    "artist": "Bon Iver",        "mood": "raw quiet devotion"},
        {"title": "Flightless Bird American Mouth", "artist": "Iron and Wine",   "mood": "soft vulnerable longing"},
    ],
    "frankenstein": [
        {"title": "Mad World",                   "artist": "Gary Jules",  "mood": "cold lonely devastation"},
        {"title": "Creep",                       "artist": "Radiohead",   "mood": "outcast desperate yearning"},
        {"title": "Disorder",                    "artist": "Joy Division","mood": "restless existential dread"},
        {"title": "People Are Strange",          "artist": "The Doors",   "mood": "alienated dark unease"},
        {"title": "How to Disappear Completely", "artist": "Radiohead",   "mood": "fragile isolated ache"},
    ],
    "dracula": [
        {"title": "Bela Lugosi's Dead",  "artist": "Bauhaus",    "mood": "gothic undead dread"},
        {"title": "A Forest",            "artist": "The Cure",   "mood": "cold nocturnal hunting"},
        {"title": "Season of the Witch", "artist": "Donovan",    "mood": "occult murky malevolence"},
        {"title": "Lullaby",             "artist": "The Cure",   "mood": "predatory gothic haunting"},
        {"title": "Riders on the Storm", "artist": "The Doors",  "mood": "rainy ominous dread"},
    ],
    "1984": [
        {"title": "2 + 2 = 5",           "artist": "Radiohead",      "mood": "oppressive dystopian dread"},
        {"title": "Idioteque",            "artist": "Radiohead",      "mood": "cold paranoid panic"},
        {"title": "Enjoy the Silence",    "artist": "Depeche Mode",   "mood": "cold surveillance chill"},
        {"title": "Strange Fruit",        "artist": "Billie Holiday", "mood": "haunting totalitarian sorrow"},
        {"title": "In the Air Tonight",   "artist": "Phil Collins",   "mood": "slow-burn oppressive weight"},
    ],
    "to kill a mockingbird": [
        {"title": "Strange Fruit",               "artist": "Billie Holiday",  "mood": "haunting injustice sorrow"},
        {"title": "The Times They Are A-Changin","artist": "Bob Dylan",       "mood": "era-shifting moral gravity"},
        {"title": "Fast Car",                    "artist": "Tracy Chapman",   "mood": "yearning dignity grace"},
        {"title": "Blackbird",                   "artist": "The Beatles",     "mood": "gentle hopeful resilience"},
        {"title": "Man in the Mirror",           "artist": "Michael Jackson", "mood": "quiet moral awakening"},
    ],
    "the handmaids tale": [
        {"title": "You Don't Own Me",    "artist": "Lesley Gore",    "mood": "defiant controlled rage"},
        {"title": "Running Up That Hill","artist": "Kate Bush",      "mood": "desperate suppressed longing"},
        {"title": "Army of Me",          "artist": "Bjork",          "mood": "cold steel resistance"},
        {"title": "Strange Fruit",       "artist": "Billie Holiday", "mood": "haunting oppressive sorrow"},
        {"title": "Disorder",            "artist": "Joy Division",   "mood": "bleak institutional dread"},
    ],
    "caraval": [
        {"title": "Enchanted",         "artist": "Taylor Swift",    "mood": "magical breathless wonder"},
        {"title": "Wonderland",        "artist": "Taylor Swift",    "mood": "dark dazzling illusion"},
        {"title": "Mad Hatter",        "artist": "Melanie Martinez","mood": "whimsical dark circus"},
        {"title": "Mordred's Lullaby", "artist": "Heather Dale",    "mood": "enchanted sinister spell"},
        {"title": "Dollhouse",         "artist": "Melanie Martinez","mood": "pretty dark uncanny"},
    ],
    "the little prince": [
        {"title": "Space Oddity",            "artist": "David Bowie",    "mood": "cosmic lonely wonder"},
        {"title": "Pure Imagination",        "artist": "Gene Wilder",    "mood": "whimsical childlike magic"},
        {"title": "Starman",                 "artist": "David Bowie",    "mood": "gentle cosmic hope"},
        {"title": "Vincent",                 "artist": "Don McLean",     "mood": "tender misunderstood beauty"},
        {"title": "Comptine d'un autre ete", "artist": "Yann Tiersen",   "mood": "delicate nostalgic fragility"},
    ],
    "outlander": [
        {"title": "The Skye Boat Song", "artist": "Raya Yarbrough",          "mood": "haunting Highland longing"},
        {"title": "From Eden",          "artist": "Hozier",                   "mood": "aching ancient pull"},
        {"title": "Toss the Feathers",  "artist": "The Corrs",                "mood": "wild Celtic passion"},
        {"title": "Cosmic Love",        "artist": "Florence + the Machine",   "mood": "dark transcendent devotion"},
        {"title": "The Night We Met",   "artist": "Lord Huron",               "mood": "bittersweet timeless ache"},
    ],
    "anna karenina": [
        {"title": "Spiegel im Spiegel",    "artist": "Arvo Part",       "mood": "vast sorrowful stillness"},
        {"title": "Nocturne Op. 9 No. 2",  "artist": "Frederic Chopin", "mood": "tragic romantic beauty"},
        {"title": "Both Sides Now",        "artist": "Joni Mitchell",   "mood": "reflective bittersweet fate"},
        {"title": "La Vie en Rose",        "artist": "Edith Piaf",      "mood": "wistful passionate longing"},
        {"title": "Hurt",                  "artist": "Johnny Cash",     "mood": "haunting inevitable loss"},
    ],
    "we were liars": [
        {"title": "Liability",      "artist": "Lorde",          "mood": "isolated painful truth"},
        {"title": "Ribs",           "artist": "Lorde",          "mood": "anxious fractured youth"},
        {"title": "The Night We Met","artist": "Lord Huron",    "mood": "haunting lost memory"},
        {"title": "Retrograde",     "artist": "James Blake",    "mood": "cold fragile unravelling"},
        {"title": "Hard Way Home",  "artist": "Brandi Carlile", "mood": "raw consequence dread"},
    ],
    "the perks of being a wallflower": [
        {"title": "Asleep",           "artist": "The Smiths",              "mood": "fragile lonely comfort"},
        {"title": "Landslide",        "artist": "Fleetwood Mac",           "mood": "quiet introspective change"},
        {"title": "Heroes",           "artist": "David Bowie",             "mood": "brief transcendent hope"},
        {"title": "Come On Eileen",   "artist": "Dexys Midnight Runners",  "mood": "nostalgic youthful energy"},
        {"title": "Peach, Plum, Pear","artist": "Joanna Newsom",           "mood": "strange tender beauty"},
    ],
    "the kite runner": [
        {"title": "Fast Car",             "artist": "Tracy Chapman",  "mood": "yearning escape longing"},
        {"title": "The Sound of Silence", "artist": "Simon & Garfunkel","mood": "quiet guilt sorrow"},
        {"title": "Holocene",             "artist": "Bon Iver",       "mood": "vast humbling regret"},
        {"title": "Hurt",                 "artist": "Nine Inch Nails","mood": "raw guilt devastation"},
        {"title": "Lua",                  "artist": "Bright Eyes",    "mood": "tender broken redemption"},
    ],
    "the bell jar": [
        {"title": "Lithium",      "artist": "Nirvana",       "mood": "numb fractured despair"},
        {"title": "Creep",        "artist": "Radiohead",     "mood": "outsider aching isolation"},
        {"title": "Mad World",    "artist": "Gary Jules",    "mood": "cold lonely stillness"},
        {"title": "4 AM",         "artist": "Our Lady Peace","mood": "quiet sleepless dread"},
        {"title": "Fade Into You","artist": "Mazzy Star",    "mood": "hazy dissociated drift"},
    ],
    "little women": [
        {"title": "When You Say Nothing at All","artist": "Alison Krauss",     "mood": "warm tender devotion"},
        {"title": "Blackbird",                  "artist": "The Beatles",        "mood": "gentle hopeful growing"},
        {"title": "The House That Built Me",    "artist": "Miranda Lambert",    "mood": "nostalgic home longing"},
        {"title": "Vincent",                    "artist": "Don McLean",         "mood": "tender artistic yearning"},
        {"title": "Bloom",                      "artist": "The Paper Kites",    "mood": "soft romantic warmth"},
    ],
    "the picture of dorian gray": [
        {"title": "Wicked Game",  "artist": "Chris Isaak",        "mood": "seductive dark obsession"},
        {"title": "Sorrow",       "artist": "David Bowie",         "mood": "elegant decadent ruin"},
        {"title": "Criminal",     "artist": "Fiona Apple",         "mood": "beautiful moral decay"},
        {"title": "Strange",      "artist": "Celeste",             "mood": "haunting hidden darkness"},
        {"title": "Black",        "artist": "Pearl Jam",           "mood": "aching beautiful loss"},
    ],
    "emma": [
        {"title": "Comptine d'un autre ete","artist": "Yann Tiersen", "mood": "delicate witty charm"},
        {"title": "La Vie en Rose",         "artist": "Edith Piaf",   "mood": "romantic comedic warmth"},
        {"title": "Gymnopedie No. 1",       "artist": "Erik Satie",   "mood": "gentle ironic grace"},
        {"title": "From Eden",              "artist": "Hozier",       "mood": "witty romantic pull"},
        {"title": "Lover",                  "artist": "Taylor Swift", "mood": "tender playful romance"},
    ],
    "sense and sensibility": [
        {"title": "Comptine d'un autre ete","artist": "Yann Tiersen",  "mood": "delicate emotional restraint"},
        {"title": "The Night We Met",       "artist": "Lord Huron",    "mood": "bittersweet restrained longing"},
        {"title": "Gymnopedie No. 1",       "artist": "Erik Satie",    "mood": "soft quiet yearning"},
        {"title": "From Eden",              "artist": "Hozier",        "mood": "slow burning romantic pull"},
        {"title": "Both Sides Now",         "artist": "Joni Mitchell", "mood": "reflective emotional wisdom"},
    ],
    "the hunger games": [
        {"title": "Safe & Sound",      "artist": "Taylor Swift",    "mood": "haunting quiet survival"},
        {"title": "Run Boy Run",       "artist": "Woodkid",         "mood": "relentless desperate escape"},
        {"title": "Atlas",             "artist": "Coldplay",        "mood": "burden heavy determination"},
        {"title": "Seven Devils",      "artist": "Florence + the Machine","mood": "dark defiant power"},
        {"title": "The Hanging Tree",  "artist": "Jennifer Lawrence","mood": "haunting rebellious cry"},
    ],
    "divergent": [
        {"title": "Elastic Heart",    "artist": "Sia",              "mood": "resilient defiant strength"},
        {"title": "Radioactive",      "artist": "Imagine Dragons",  "mood": "gritty dystopian awakening"},
        {"title": "Run Boy Run",      "artist": "Woodkid",          "mood": "relentless desperate escape"},
        {"title": "Warriors",         "artist": "Imagine Dragons",  "mood": "rising fierce determination"},
        {"title": "Ready Aim Fire",   "artist": "Imagine Dragons",  "mood": "driving urgent action"},
    ],
    "the fault in our stars": [
        {"title": "Oblivion",         "artist": "Grimes",           "mood": "cold ethereal fragile"},
        {"title": "All I Want",       "artist": "Kodaline",         "mood": "aching tender devotion"},
        {"title": "Bloom",            "artist": "The Paper Kites",  "mood": "soft romantic fleeting"},
        {"title": "Skinny Love",      "artist": "Bon Iver",         "mood": "raw fragile heartbreak"},
        {"title": "Ed Sheeran - Afire Love","artist": "Ed Sheeran", "mood": "tender bittersweet love"},
    ],
    "the book thief": [
        {"title": "Lua",              "artist": "Bright Eyes",          "mood": "tender wartime sorrow"},
        {"title": "Mad World",        "artist": "Gary Jules",           "mood": "cold quiet devastation"},
        {"title": "The Sound of Silence","artist": "Simon & Garfunkel","mood": "quiet wartime grief"},
        {"title": "Skinny Love",      "artist": "Bon Iver",             "mood": "raw innocent loss"},
        {"title": "Strange Fruit",    "artist": "Billie Holiday",       "mood": "haunting wartime horror"},
    ],
}


def _normalize(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()


def _find_known(title: str) -> Optional[list]:
    t = _normalize(title)
    if t in _KNOWN_SOUNDTRACKS:
        return _KNOWN_SOUNDTRACKS[t]
    for key, songs in _KNOWN_SOUNDTRACKS.items():
        if key in t or t in key:
            return songs
    return None


# ─── Genre keyword extraction ──────────────────────────────────────────────────
def _extract_genre_keywords(genre_str: str) -> list:
    """
    Split "LGBT, Fiction, Romance" → ["lgbt", "fiction", "romance"].
    BUG FIX: always parse ALL genres, not just the first one.
    """
    if not genre_str:
        return []
    parts = re.split(r"[,/|&\n]+", genre_str.lower())
    return [p.strip() for p in parts if p.strip()]


# ─── Genre → Spotify queries ──────────────────────────────────────────────────
# Each key is a single lowercase word/phrase matched against individual genre tokens.
_GENRE_QUERY_MAP: dict = {
    # Core fiction
    "fiction":           ["melancholic indie emotional storytelling", "quiet atmospheric indie folk cinematic"],
    "literary":          ["melancholic indie introspective folk beautiful", "reflective emotional piano indie sad"],
    "literary fiction":  ["melancholic indie introspective folk beautiful", "tender literary songwriter indie"],
    "contemporary":      ["indie folk emotional contemporary sad", "quiet reflective modern indie acoustic"],
    "classics":          ["classical piano melancholic nocturne beautiful", "romantic orchestral timeless classical"],
    "classic":           ["classical piano melancholic nocturne beautiful", "elegant chamber music introspective"],

    # Romance varieties
    "romance":           ["indie romantic love soft acoustic tender", "dreamy heartfelt love ballad bittersweet"],
    "romantic":          ["indie romantic love soft acoustic tender", "dreamy heartfelt love ballad bittersweet"],
    "lgbt":              ["tender queer love indie emotional soft", "bittersweet longing soft indie folk aching"],
    "queer":             ["tender queer love indie emotional soft", "bittersweet longing soft indie folk aching"],

    # Genre fiction
    "fantasy":           ["epic fantasy orchestral cinematic", "magical ethereal folk wonder dark"],
    "science fiction":   ["ambient space electronic futuristic synth", "cosmic drift synth instrumental cinematic"],
    "sci-fi":            ["ambient space electronic futuristic synth", "cosmic drift synth instrumental cinematic"],
    "horror":            ["gothic dark eerie haunting cold", "creeping dread post-punk dark atmospheric"],
    "mystery":           ["dark noir cinematic atmospheric tension", "eerie ambient mysterious indie cold"],
    "thriller":          ["suspenseful tense dark electronic", "cold paranoia dark synth driving"],
    "crime":             ["dark jazz noir crime atmospheric", "cold calculated thriller electronic slow"],
    "adventure":         ["epic adventure orchestral cinematic heroic", "driving quest folk rock journey"],
    "dystopian":         ["oppressive dark synth dystopia bleak", "rebellious alternative dark rock cold"],

    # YA
    "young adult":       ["indie pop coming of age emotional teen", "bittersweet youthful longing soft acoustic"],
    "ya":                ["indie pop coming of age emotional teen", "bittersweet youthful longing soft acoustic"],
    "coming of age":     ["nostalgic indie coming of age bittersweet", "emotional youthful longing indie pop"],

    # Non-fiction
    "biography":         ["inspirational soul folk motivational", "reflective life journey acoustic emotional"],
    "memoir":            ["reflective emotional acoustic storytelling honest", "quiet personal growth indie folk"],
    "history":           ["folk protest historical acoustic", "wartime melancholic period drama score"],
    "historical":        ["folk protest historical acoustic melancholic", "slow romantic classical period"],
    "historical fiction":["period drama romantic orchestral cinematic", "folk historical emotional acoustic"],
    "war":               ["haunting war melancholic folk", "wartime orchestral drama sorrowful"],

    # Mood-based
    "psychological":     ["psychological tension dark ambient unsettling", "cold introspective dark indie"],
    "dark":              ["dark brooding moody atmospheric indie", "cold melancholic post-punk"],
    "dark academia":     ["dark academia classical piano moody", "gothic literary ambient haunting elegant"],
    "gothic":            ["gothic dark atmospheric haunting Victorian", "cold post-punk eerie"],

    # Cultural/regional
    "russia":            ["melancholic Russian soul classical existential", "cold desolate introspective piano"],
    "russian":           ["melancholic Russian soul classical existential", "cold desolate introspective piano"],
    "russian lit":       ["dark existential brooding classical melancholic", "cold oppressive atmospheric moody"],

    # Other common genres
    "magical realism":   ["magical dreamlike indie folk atmospheric", "mystical cinematic orchestral beautiful"],
    "supernatural":      ["haunting ethereal atmospheric dark indie", "eerie supernatural ambient orchestral"],
    "paranormal":        ["haunting ethereal atmospheric dark", "supernatural eerie indie ambient"],
    "action":            ["driving intense cinematic action", "urgent fast-paced electronic driving"],
    "comedy":            ["feel-good upbeat indie pop happy", "light-hearted fun acoustic folk"],
    "humor":             ["feel-good upbeat indie pop playful", "light quirky acoustic indie"],
    "spirituality":      ["peaceful ambient meditative serene", "reflective spiritual acoustic folk"],
    "self-help":         ["motivational uplifting indie folk", "hopeful empowering acoustic pop"],
    "philosophy":        ["introspective ambient philosophical", "deep reflective classical piano"],
}

# Guaranteed fallback queries — always added at end
_DEFAULT_QUERIES = [
    "indie folk emotional atmospheric cinematic",
    "melancholic cinematic piano beautiful acoustic",
    "soft emotional indie pop bittersweet",
    "cinematic orchestral beautiful melancholic tender",
]


def _build_spotify_queries(genre_keywords: list, description: str) -> list:
    """
    Build a deduplicated list of Spotify queries from ALL genre keywords.
    Guaranteed to return at least 4 queries.
    """
    queries: list = []
    seen: set = set()

    def _add(items):
        for q in items:
            if q not in seen:
                seen.add(q)
                queries.append(q)

    # Step 1: Match EVERY genre keyword against the map
    for kw in genre_keywords:
        matched = False
        for map_key, q_list in _GENRE_QUERY_MAP.items():
            # substring match in either direction
            if map_key in kw or kw in map_key:
                _add(q_list)
                matched = True
                break
        # If no direct map match, try partial word match
        if not matched:
            for map_key, q_list in _GENRE_QUERY_MAP.items():
                # Check if any word of the keyword appears in the map key
                kw_words = kw.split()
                if any(w in map_key for w in kw_words if len(w) > 3):
                    _add(q_list)
                    break

    # Step 2: Description mood keyword sniffing
    desc = (description or "").lower()
    mood_extra = [
        ("melanchol", "melancholic sad emotional indie atmospheric"),
        ("romantic",  "romantic tender love indie soft beautiful"),
        ("dark",      "dark brooding moody atmospheric indie"),
        ("grief",     "grief sorrow tender devastating acoustic"),
        ("guilt",     "guilt haunting brooding dark introspective"),
        ("longing",   "longing bittersweet yearning indie folk"),
        ("summer",    "summer nostalgic warm indie golden acoustic"),
        ("forbidden", "forbidden love bittersweet aching indie"),
        ("obsess",    "obsession dark atmospheric intense driving"),
        ("war",       "wartime haunting melancholic folk sorrowful"),
        ("identity",  "identity self-discovery coming of age indie"),
        ("love",      "tender love romantic indie soft beautiful"),
    ]
    added = 0
    for kw, q in mood_extra:
        if kw in desc and added < 3 and q not in seen:
            seen.add(q)
            queries.append(q)
            added += 1

    # Step 3: Always append defaults at the end
    _add(_DEFAULT_QUERIES)

    return queries


async def _spotify_genre_search(genre_str: str, description: str) -> tuple:
    """
    Always-on Spotify search using ALL genre tokens.
    Returns (tracks_list, mood_label_str).
    """
    genre_keywords = _extract_genre_keywords(genre_str)
    if not genre_keywords:
        genre_keywords = ["fiction"]

    queries = _build_spotify_queries(genre_keywords, description)
    print(f"[songs] Spotify {len(queries)} queries for genres={genre_keywords}: {queries[:2]}")

    tracks = await _search_spotify_multi(queries, target=5)

    # Build mood label from first 2 genre keywords
    mood_label = " · ".join(kw.title() for kw in genre_keywords[:2]) if genre_keywords else "atmospheric"
    for t in tracks:
        if not t.get("mood"):
            t["mood"] = mood_label

    return tracks, mood_label


# ─── Static fallback pools ────────────────────────────────────────────────────
_STATIC_FALLBACKS: dict = {
    "romance":        [
        {"title": "Lover",                   "artist": "Taylor Swift",    "mood": "tender dreamy longing"},
        {"title": "From Eden",               "artist": "Hozier",          "mood": "aching romantic pull"},
        {"title": "The Night We Met",        "artist": "Lord Huron",      "mood": "bittersweet longing"},
        {"title": "Bloom",                   "artist": "The Paper Kites", "mood": "soft romantic haze"},
        {"title": "Comptine d'un autre ete", "artist": "Yann Tiersen",    "mood": "delicate nostalgic warmth"},
    ],
    "mystery":        [
        {"title": "Teardrop",         "artist": "Massive Attack", "mood": "cold atmospheric dread"},
        {"title": "In the Air Tonight","artist": "Phil Collins",  "mood": "slow-burn foreboding"},
        {"title": "Criminal",         "artist": "Fiona Apple",   "mood": "uneasy dark tension"},
        {"title": "Intro",            "artist": "The xx",        "mood": "sparse tense stillness"},
        {"title": "Bloodstream",      "artist": "Stateless",     "mood": "dark relentless pull"},
    ],
    "fantasy":        [
        {"title": "Concerning Hobbits","artist": "Howard Shore",  "mood": "gentle pastoral wonder"},
        {"title": "River Flows in You","artist": "Yiruma",        "mood": "soft ethereal calm"},
        {"title": "May It Be",        "artist": "Enya",          "mood": "ethereal hopeful wonder"},
        {"title": "Spiegel im Spiegel","artist": "Arvo Part",    "mood": "timeless sacred stillness"},
        {"title": "Mordred's Lullaby","artist": "Heather Dale",   "mood": "dark enchanted spell"},
    ],
    "horror":         [
        {"title": "Atmosphere",        "artist": "Joy Division",  "mood": "cold desolate dread"},
        {"title": "Burn the Witch",    "artist": "Radiohead",     "mood": "eerie creeping menace"},
        {"title": "Lullaby",           "artist": "The Cure",      "mood": "predatory gothic haunting"},
        {"title": "Season of the Witch","artist": "Donovan",      "mood": "occult murky tension"},
        {"title": "Bela Lugosi's Dead","artist": "Bauhaus",       "mood": "gothic undead dread"},
    ],
    "science fiction":[
        {"title": "Space Oddity",          "artist": "David Bowie",      "mood": "drifting cosmic isolation"},
        {"title": "Midnight City",         "artist": "M83",              "mood": "futuristic dreamy drive"},
        {"title": "Experience",            "artist": "Ludovico Einaudi", "mood": "vast quiet wonder"},
        {"title": "An Ending Ascent",      "artist": "Brian Eno",        "mood": "infinite ambient space"},
        {"title": "Interstellar Main Theme","artist": "Hans Zimmer",     "mood": "epic lonely vastness"},
    ],
    "lgbt":           [
        {"title": "Mystery of Love",   "artist": "Sufjan Stevens","mood": "tender aching longing"},
        {"title": "Take Me to Church", "artist": "Hozier",        "mood": "burning defiant devotion"},
        {"title": "Boys Don't Cry",    "artist": "The Cure",      "mood": "vulnerable quiet ache"},
        {"title": "Fade Into You",     "artist": "Mazzy Star",    "mood": "hazy yearning drift"},
        {"title": "Skinny Love",       "artist": "Bon Iver",      "mood": "raw intimate tender"},
    ],
    "literary":       [
        {"title": "Holocene",                 "artist": "Bon Iver",          "mood": "vast quiet beauty"},
        {"title": "The Sound of Silence",     "artist": "Simon & Garfunkel", "mood": "quiet lonely introspection"},
        {"title": "Both Sides Now",           "artist": "Joni Mitchell",     "mood": "reflective earned wisdom"},
        {"title": "Motion Picture Soundtrack","artist": "Radiohead",         "mood": "fragile melancholic stillness"},
        {"title": "Fast Car",                 "artist": "Tracy Chapman",     "mood": "yearning restless hope"},
    ],
    "thriller":       [
        {"title": "Running Up That Hill","artist": "Kate Bush",      "mood": "desperate urgent drive"},
        {"title": "Enjoy the Silence",   "artist": "Depeche Mode",  "mood": "cold creeping paranoia"},
        {"title": "Intro",               "artist": "The xx",        "mood": "sparse tense stillness"},
        {"title": "Seven Nation Army",   "artist": "The White Stripes","mood": "grinding pressure"},
        {"title": "Teardrop",            "artist": "Massive Attack", "mood": "cold clinical unease"},
    ],
    "default":        [
        {"title": "Holocene",                 "artist": "Bon Iver",          "mood": "vast quiet beauty"},
        {"title": "Gymnopedie No. 1",         "artist": "Erik Satie",        "mood": "slow peaceful solitude"},
        {"title": "Hallelujah",               "artist": "Jeff Buckley",      "mood": "soaring emotional depth"},
        {"title": "Motion Picture Soundtrack","artist": "Radiohead",         "mood": "fragile melancholic stillness"},
        {"title": "The Sound of Silence",     "artist": "Simon & Garfunkel", "mood": "quiet lonely introspection"},
    ],
}


def _static_fallback(genre_keywords: list) -> list:
    for kw in genre_keywords:
        for pool_key in _STATIC_FALLBACKS:
            if pool_key == "default":
                continue
            if pool_key in kw or kw in pool_key:
                pool = _STATIC_FALLBACKS[pool_key]
                return [
                    {**s, "spotify_url": "", "preview_url": "", "image": "",
                     "searchUrl": "https://www.youtube.com/results?search_query="
                                  + (s["title"] + " " + s["artist"]).replace(" ", "+")}
                    for s in random.sample(pool, min(5, len(pool)))
                ]
    pool = _STATIC_FALLBACKS["default"]
    return [{**s, "spotify_url": "", "preview_url": "", "image": "",
             "searchUrl": "https://www.youtube.com/results?search_query="
                          + (s["title"] + " " + s["artist"]).replace(" ", "+")} for s in pool]


# ─── LLM mood extraction (optional) ──────────────────────────────────────────
_MOOD_SYSTEM = (
    "You are a mood analyser. Given a book, return ONLY a JSON object:\n"
    '{"mood":["adjective1","adjective2"],"energy":"low|medium|high","keywords":["w1","w2","w3"]}\n'
    "Output ONLY raw JSON. No markdown. No explanation."
)

def _extract_mood_ollama(title: str, authors: str, genre: str, description: str) -> dict:
    try:
        import ollama as _ollama
    except ImportError:
        return {}
    parts = [f'Book: "{title}"']
    if authors:    parts.append(f"By: {authors}")
    if genre:      parts.append(f"Genre: {genre}")
    if description:
        clean = re.sub(r"<[^>]+>", "", description).strip()[:300]
        if clean: parts.append(f"Summary: {clean}")
    prompt = "\n".join(parts) + "\n\nReturn JSON only."
    for model in (_LLM_MODEL, _LLM_FALLBACK):
        for attempt in range(2):
            try:
                resp = _ollama.chat(
                    model=model,
                    messages=[{"role": "system", "content": _MOOD_SYSTEM}, {"role": "user", "content": prompt}],
                    options={"temperature": 0.3 + attempt * 0.1, "num_predict": 200},
                )
                raw = re.sub(r"```(?:json)?|```", "", resp["message"]["content"].strip()).strip()
                m = re.search(r"\{.*\}", raw, re.DOTALL)
                if m:
                    data = json.loads(m.group())
                    if "mood" in data or "keywords" in data:
                        return data
            except Exception as e:
                print(f"[songs] mood {model} attempt {attempt+1}: {e}")
    return {}


def _mood_to_query(mood_data: dict, genre: str) -> str:
    parts = list((mood_data.get("mood") or [])[:2]) + list((mood_data.get("keywords") or [])[:3])
    energy = mood_data.get("energy", "")
    if energy == "low":    parts.append("slow atmospheric")
    elif energy == "high": parts.append("intense driving")
    return " ".join(parts)[:100] if parts else f"{genre} atmospheric"


# ─── In-memory cache ──────────────────────────────────────────────────────────
_song_cache: dict = {}
_CACHE_MAX = 500


class SongRequest(BaseModel):
    title:       str
    authors:     Optional[str] = ""
    genre:       Optional[str] = ""
    description: Optional[str] = ""


# ─── Main endpoint ────────────────────────────────────────────────────────────
@router.post("/recommend")
async def recommend_songs(body: SongRequest):
    """
    Return 5 songs as a reading soundtrack.
    Priority:
      1. Known curated list → Spotify lookup
      2. LLM mood (Ollama, optional) → Spotify search
      3. Spotify multi-query using ALL genre tokens (ALWAYS runs)
      4. Static offline fallback (guaranteed songs)
    """
    title       = (body.title       or "").strip()
    genre       = (body.genre       or "").strip()
    authors     = (body.authors     or "").strip()
    description = (body.description or "").strip()

    cache_key = f"{title}::{genre}".lower()[:120]
    if cache_key in _song_cache:
        return _song_cache[cache_key]

    if _should_skip(genre, title):
        return {"songs": [], "skipped": True, "reason": "genre"}

    # Parse ALL genre tokens once
    genre_keywords = _extract_genre_keywords(genre)
    desc_clean = re.sub(r"<[^>]+>", "", description).strip()[:300]

    songs: list = []
    existing_keys: set = set()

    def _merge(new_tracks: list):
        for t in new_tracks:
            key = (t["title"].lower().strip(), t["artist"].lower()[:25].strip())
            if key not in existing_keys:
                existing_keys.add(key)
                songs.append(t)
            if len(songs) >= 5:
                return

    # ── 1. Known curated soundtrack ──────────────────────────────────────────
    known = _find_known(title)
    if known:
        print(f"[songs] curated: {title!r}")
        resolved = []
        for s in known:
            track = await _lookup_spotify_track(s["title"], s["artist"])
            if track:
                track["mood"] = s["mood"]
                resolved.append(track)
            else:
                resolved.append({
                    "title":       s["title"],  "artist":      s["artist"],
                    "mood":        s["mood"],   "spotify_url": "",
                    "preview_url": "",          "image":       "",
                    "searchUrl":   "https://www.youtube.com/results?search_query="
                                   + (s["title"] + " " + s["artist"]).replace(" ", "+"),
                })
        _merge(resolved)

    # ── 2. LLM mood → Spotify (if Ollama available) ───────────────────────────
    if len(songs) < 5:
        mood_data = _extract_mood_ollama(title, authors, genre, description)
        if mood_data:
            query = _mood_to_query(mood_data, genre)
            print(f"[songs] LLM query: {query!r}")
            sp = await _search_spotify(query, limit=8)
            mood_label = " ".join(list(mood_data.get("mood") or []) + list(mood_data.get("keywords") or []))[:40]
            for t in sp:
                t["mood"] = mood_label
            _merge(sp)

    # ── 3. Spotify genre search — ALWAYS runs, uses ALL genre tokens ──────────
    if len(songs) < 5:
        sp, _ = await _spotify_genre_search(genre, desc_clean)
        _merge(sp)

    # ── 4. Static offline fallback — guaranteed songs ─────────────────────────
    if len(songs) < 5:
        print(f"[songs] static fallback: {title!r} genres={genre_keywords}")
        _merge(_static_fallback(genre_keywords))

    result = {"songs": songs[:5], "skipped": False}

    if songs:
        if len(_song_cache) >= _CACHE_MAX:
            del _song_cache[next(iter(_song_cache))]
        _song_cache[cache_key] = result

    return result
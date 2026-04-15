<div align="center">

# ROOK

### Semantic Book Discovery Engine

**Discover your next great read — by mood, season, vibe, time or feeling.**

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-Latest-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-Latest-646CFF?style=for-the-badge&logo=vite&logoColor=white)](https://vitejs.dev)
[![SQLite](https://img.shields.io/badge/SQLite-aiosqlite-003B57?style=for-the-badge&logo=sqlite&logoColor=white)](https://sqlite.org)
[![Ollama](https://img.shields.io/badge/Ollama-LLM-black?style=for-the-badge)](https://ollama.ai)
[![FAISS](https://img.shields.io/badge/FAISS-Semantic_Search-blue?style=for-the-badge)](https://faiss.ai)

[🚀 Features](#-features) · [📸 Screenshots](#-screenshots) · [🛠 Tech Stack](#-tech-stack) · [⚙️ Setup](#-getting-started) · [🔌 API](#-api-reference) · [📁 Structure](#-project-structure)

</div>


---

## 🔗 Deployment

| Component | Platform | URL |
| --------- | -------- | --- |
| **Frontend** | Vercel | [rook-frontend.vercel.app](https://rook-frontend.vercel.app/) |
| **Backend API** | Hugging Face | [surabhibh05-rook.hf.space](https://huggingface.co/spaces/surabhibh05/rook) |
| **Database** | **Supabase** | [supabase.com](https://supabase.com/) |

---

## Features

ROOK is a discovery engine that moves beyond simple search to find books based on atmosphere and personal reading context.

| Feature                        | Description                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------------- |
| **Mood Recommendations** | 12 emotional presets (cosy, tense, dreamy, romantic…) powered by Ollama LLM + FAISS semantic search |
| **Contextual Discovery** | Recommendations adapt to your season, time of day, travel context, and reading time                  |
| **Song Soundtracks**     | Every book gets a curated Spotify playlist matching its emotional atmosphere                         |
| **Personal Taste Profile**     | "For You" uses locally-processed analysis to identify personalized picks from your library.               |
| **Describe Any Vibe**    | Type*"a cosy mystery set in a rainy English village"* and get perfect matches                        |
| **Smart Ratings Chart**  | Your 4–5 star ratings + likes/reads build a personal ranked chart                                   |
| **Full Authentication**  | Email/password, Google OAuth, and OTP-based password recovery.                                    |
| **Dark / Light Theme**   | Beautiful dual-theme design system with animated toggle                                              |
| **Responsive Design**    | Works seamlessly on desktop and mobile                                                               |

---

## Screenshots

### Landing Page

> Public-facing entry point with book cover collage and call-to-action buttons.

<img src="screenshots/12_landing_page.png" alt="ROOK Landing Page" width="100%"/>

---

### Authentication

> Clean login panel with Google OAuth, email/password, remember me, and forgot password — rendered over a beautiful book-cover grid background.

<img src="screenshots/11_auth_login.png" alt="ROOK Auth Login" width="100%"/>

---

### Hero Carousel — Home Page

> Full-height blurred-background hero carousel of daily featured books. Rotates every 7 seconds, seeded by genre and date. Thumbnail strip at the bottom for quick navigation.

<img src="screenshots/01_hero_carousel.png" alt="ROOK Hero Carousel" width="100%"/>

---

### Home Feed & Search

> Time-aware greeting ("Good night, Surabhi"), semantic search bar with autocomplete, genre pill shortcuts, and the "Recently Viewed" row. All sections load lazily as you scroll.

<img src="screenshots/02_home_search.png" alt="ROOK Home Search" width="100%"/>

---

### Genre Page

> Browse 22 genres from a collapsible sidebar. Each genre shows a full book grid with cover images, star ratings, and infinite scroll pagination.

<img src="screenshots/03_genre_page.png" alt="ROOK Genre Page Romance" width="100%"/>

---

### Author Page

> Search any author by name. Featured authors row with Wikipedia profile photos. Results show the full book collection with a genre quick-filter dropdown (showing Agatha Christie's 43 books).

<img src="screenshots/04_author_page.png" alt="ROOK Author Page Agatha Christie" width="100%"/>

---

### For You — Personalised Recommendations

> Based on your full library (24 books in this example). Includes "You Might Like" smart picks and "Top Rated for You" personal chart with ranked numbered cards and "You rated 5★" badges.

<img src="screenshots/05_for_you.png" alt="ROOK For You Page" width="100%"/>

---

### Describe a Book — Semantic Search

> Type any description in plain English. The engine uses mood detection, genre mapping, and LLM expansion to find matching books. 10 example prompt chips provided as inspiration.

<img src="screenshots/06_describe_page.png" alt="ROOK Describe Page" width="100%"/>

---

### Season & Travel Sections

> Season-themed recommendations (Summer/Spring/Rainy/Autumn/Winter) with animated gradient backgrounds. Travel section with Long Flight, Train Journey, Beach Holiday, and Road Trip tabs.

<img src="screenshots/07_season_travel.png" alt="ROOK Season and Travel" width="100%"/>

---

### Book Modal — Song Soundtrack

> Click any book to open the detail modal. Shows description, star rating widget (5★ rated), Save/Like/Wishlist/Already Read buttons, and a **"Songs That Match This Book"** section with Spotify-linked tracks and mood tags.

<img src="screenshots/08_book_modal_songs.png" alt="ROOK Book Modal Songs" width="100%"/>

---

### Book Modal — Author Collection & More Like This

> Scrolling down the same modal reveals the **Gillian Flynn Collection** and a **"More Like This"** horizontal row — all powered by the 4-tier recommendation cascade.

<img src="screenshots/09_modal_author_similar.png" alt="ROOK Book Modal Author Similar" width="100%"/>

---

### Profile & Settings

> User profile with avatar, display name, bio, favourite author detection, and email. Settings tab shows Account Information, editable Profile fields, and Your Library stats.

<img src="screenshots/10_profile_settings.png" alt="ROOK Profile Settings" width="100%"/>

---

## Project Structure

BOOK_RECOMMENDER/                    ← Project Root
├── backend/
│   ├── auth/
│   │   ├── __init__.py
│   │   ├── email_auth.py            # OTP emails via Gmail (aiosmtplib)
│   │   ├── google_auth.py           # Google ID token verification
│   │   ├── router.py                # All /api/auth endpoints
│   │   └── security.py             # JWT creation + bcrypt hashing
│   ├── routers/
│   │   ├── __init__.py
│   │   ├── books.py                 # Book CRUD + add-or-get upsert
│   │   ├── ratings.py               # Star ratings (upsert + community stats)
│   │   ├── recommendation.py        # 11 recommendation endpoints
│   │   ├── songs.py                 # Song soundtrack feature
│   │   └── users.py                 # Profile, avatar upload, favorites
│   ├── uploads/                     # User avatar image files
│   ├── database.py                  # Async SQLAlchemy engine + session factory
│   ├── external_books.py            # Google Books / OpenLibrary enrichment
│   ├── main.py                      # FastAPI app entry point + lifespan
│   ├── model_loader.py              # joblib model loader
│   ├── models.py                    # SQLAlchemy ORM models (10 tables)
│   ├── recommender.py               # Core ML engine (~1,800 lines)
│   ├── schemas.py                   # Pydantic request/response schemas
│   └── rook.db                      # SQLite database (auto-created)
│
├── dataset/                         # Goodreads CSV data files
│   ├── books_genre.csv              # Main book catalogue
│   ├── books_cleaned.csv            # Pre-processed books
│   ├── books.csv                    # Raw Goodreads books
│   ├── book_tags.csv                # Tag-to-book mappings
│   ├── ratings.csv                  # Raw user ratings
│   ├── ratings_processed.csv        # Cleaned ratings for SVD training
│   ├── tags.csv                     # Tag definitions
│   └── data.csv                     # Additional book data
│
├── models/                          # Pre-trained ML model files
│   ├── book_embeddings/             # Embedding data folder
│   ├── book_faiss.index             # FAISS vector index (768-dim)
│   ├── book_meta.pkl                # FAISS index → book title mapping
│   ├── cosine_sim.pkl               # Pre-computed cosine similarity matrix
│   ├── svd_model.pkl                # Trained Surprise SVD model
│   └── tfidf_vectorizer.pkl         # Fitted TF-IDF vectorizer (40k features)
│
├── notebooks/                       # Jupyter training notebooks
│   ├── books_cleaned.ipynb          # Data cleaning pipeline
│   ├── build_semantic_*.ipynb       # FAISS index builder (Ollama embeddings)
│   ├── content_based.ipynb          # TF-IDF content similarity
│   ├── model_svd.ipynb              # SVD collaborative filtering training
│   ├── ratings_cleaned.ipynb        # Ratings preprocessing
│   └── tfidf.ipynb                  # TF-IDF vectorizer training
│
├── frontend/
│   └── rook-frontend/
│       ├── public/assets/           # rook.png, bg.png, BOOK.png fallback
│       ├── src/
│       │   ├── api/
│       │   │   └── client.js        # All API wrapper functions
│       │   ├── components/
│       │   │   ├── BookCard.jsx     # Book modal + song recs + mini cards
│       │   │   ├── BookRow.jsx      # Horizontal scroll row + skeleton loader
│       │   │   └── StarRating.jsx   # Interactive 1–5 star widget
│       │   ├── context/
│       │   │   └── AppContext.jsx   # Global state (saved, liked, theme…)
│       │   ├── hooks/
│       │   │   └── useBooks.js      # Shared fetch hooks + utilities
│       │   ├── pages/
│       │   │   ├── Auth.jsx         # Login / Register / Forgot Password
│       │   │   ├── AuthorPage.jsx   # Author search + featured authors
│       │   │   ├── DescribePage.jsx # Semantic search page
│       │   │   ├── ForYouPage.jsx   # Personalised recommendations
│       │   │   ├── GenrePage.jsx    # Browse by genre with sidebar
│       │   │   ├── Getstarted.jsx   # Landing page
│       │   │   ├── Home.jsx         # Main app shell (all home sections)
│       │   │   ├── TopRatedPage.jsx # Personal ratings chart
│       │   │   ├── TrendingPage.jsx # Most popular books
│       │   │   └── YourRatingsPage.jsx
│       │   ├── styles/
│       │   │   └── global.css       # 12,000+ line design system
│       │   └── utils/
│       │       └── imageUtils.jsx   # Queued cover image pipeline
│       ├── App.jsx
│       ├── main.jsx
│       └── index.html
│
├── .env                             # 🔒 Secret keys — NEVER commit
├── .gitignore
├── requirements.txt
└── README.md

---

## Tech Stack

### Frontend

| Technology                         | Purpose                                              |
| ---------------------------------- | ---------------------------------------------------- |
| **React 18 + Vite**          | SPA framework + fast build tool                      |
| **React Router DOM v6**      | Client-side page routing                             |
| **Custom CSS (global.css)**  | 12,000+ line design system — dark/light, animations |
| **Google Fonts**             | Montaga + Montserrat Alternates typography           |
| **Google Books API**         | Cover images + descriptions                          |
| **Spotify Web API**          | Real song URLs + album art for book soundtracks      |
| **Wikipedia REST API**       | Author profile photos                                |
| **Google Identity Services** | Google OAuth sign-in button (GSI)                    |

### Backend

| Technology                     | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| **FastAPI**              | Async REST API                                       |
| **SQLAlchemy 2.x async** | ORM — works with SQLite (dev) and **Supabase/PostgreSQL** (prod) |
| **Pydantic v2**          | Schema validation for all requests/responses         |
| **python-jose**          | JWT access + refresh token generation                |
| **passlib + bcrypt**     | Secure password hashing                              |
| **httpx**                | Async Spotify API calls                              |
| **aiofiles**             | Async avatar image file uploads                      |

### Machine Learning & AI

| Technology                          | Purpose                                              |
| ----------------------------------- | ---------------------------------------------------- |
| **FAISS**                     | Vector database — semantic nearest-neighbour search |
| **Ollama (nomic-embed-text)** | Local text → 768-dim vector embeddings              |
| **Ollama LLM (llama3.2:3b)**  | Mood query expansion + taste profiling               |
| **Surprise SVD**              | Collaborative filtering on Goodreads ratings         |
| **Scikit-learn TF-IDF**       | Content-based similarity (40,000 features)           |
| **TruncatedSVD**              | Latent semantic analysis (120 components)            |
| **NumPy + Pandas**            | Data processing and scoring                          |

### Dataset

> Sourced from the **Goodreads Books Dataset** — cleaned, tagged with genres, and processed into training-ready CSVs.

| File                      | Contents                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `books_genre.csv`       | Main catalogue — 10,000+ books with title, authors, genre, description, image_url, ratings |
| `ratings_processed.csv` | Cleaned user-book rating pairs — used for SVD training                                     |
| `books.csv`             | Raw Goodreads book metadata                                                                 |
| `book_tags.csv`         | Tag-to-book mappings                                                                        |
| `ratings.csv`           | Raw user ratings (millions of rows)                                                         |
| `tags.csv`              | Tag names and definitions                                                                   |

---

## How the Recommendation Engine Works

ROOK uses a **5-signal fusion** approach in `recommender.py`:

```
Final Score = 45% Semantic (FAISS + Ollama embeddings)
            + 25% Genre/Mood Index (pre-built genre buckets)
            + 25% Content Similarity (TF-IDF cosine)
            + 15% Collaborative Filtering (Surprise SVD)
            + 15% Popularity (log1p(rating_count) × avg_rating)
```

**Mood → Books pipeline:**

```
"cosy mystery" → _match_mood_key() → canonical key
       ↓
Genre-dominant? → YES: use curated query map (skip LLM)
                → NO:  Ollama expands to rich description
       ↓
FAISS semantic search (768-dim embedding space)
       ↓
Genre index provides candidate pool
       ↓
5-signal fusion → popularity filter → top N books
```

**Reading time recommendations:**

| Bucket     | Page Range       | Primary Genres                            |
| ---------- | ---------------- | ----------------------------------------- |
| 30 minutes | ≤ 220 pages     | comedy, romance, mystery, YA              |
| 2 hours    | 150 – 420 pages | thriller, fiction, crime                  |
| Weekend    | 350+ pages       | epic-fantasy, classics, history, literary |

---

## Song Soundtrack Feature

Each book gets 5 perfectly matched songs via a priority cascade:

```
1. Curated list     50+ hand-picked book→song mappings
                    (Gone Girl → Immigrant Song, Criminal, Teardrop…)
                    Each song looked up on Spotify for real URLs + album art

2. Ollama mood      LLM extracts mood adjectives + energy level
                    → Spotify search query

3. Genre search     ALL genre tokens mapped to curated query templates
                    → Multi-query Spotify search → 5 tracks

4. Static fallback  8 genre pools of pre-selected songs
                    (always returns results even without Spotify or Ollama)
```

---

## Getting Started

### Prerequisites

- Python 3.10+
- Node.js 18+
- [Ollama](https://ollama.ai) — optional, for LLM mood expansion

### 1. Clone

```bash
git clone https://github.com/YOUR_USERNAME/rook.git
cd rook
```

### 2. Backend

```bash
cd backend
python -m venv env
source env/bin/activate        # Windows: env\Scripts\activate
pip install -r requirements.txt
```

### 3. Environment Variables

Create `.env` in the `backend/` folder:

```env
# Database (Supabase / PostgreSQL)
DATABASE_URL=postgresql+asyncpg://postgres:[YOUR-PASSWORD]@db.[YOUR-PROJECT].supabase.co:5432/postgres

# JWT — generate key with: openssl rand -hex 32
JWT_SECRET_KEY=your-secret-key-here
JWT_ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
REFRESH_TOKEN_EXPIRE_DAYS=30

# Google OAuth (console.cloud.google.com)
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com

# Spotify (developer.spotify.com/dashboard)
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret

# Optional
GOOGLE_BOOKS_API_KEY=your_key
ROOK_LLM_MODEL=llama3.2:3b
```

### 4. Dataset & Model Files

Place files at the project root level (one folder above `backend/`):

```
BOOK_RECOMMENDER/
├── backend/          ← you are here
├── dataset/          ← books_genre.csv, ratings_processed.csv go here
└── models/           ← pkl and index files go here
```

### 5. Ollama (Optional)

```bash
ollama pull nomic-embed-text
ollama pull llama3.2:3b
ollama serve
```

### 6. Start Backend

```bash
uvicorn main:app --reload --port 8000
# Docs → http://localhost:8000/docs
```

### 7. Start Frontend

```bash
cd frontend/rook-frontend
npm install
npm run dev
# App → http://localhost:5173
```

---

## API Reference

### Auth (`/api/auth`)

| Method   | Endpoint                     | Description          |
| -------- | ---------------------------- | -------------------- |
| `POST` | `/register`                | Create account       |
| `POST` | `/login`                   | Login → JWT tokens  |
| `POST` | `/google`                  | Google OAuth         |
| `POST` | `/refresh`                 | Refresh access token |
| `GET`  | `/me`                      | Current user profile |
| `POST` | `/forgot-password/request` | Send OTP             |
| `POST` | `/forgot-password/verify`  | Verify OTP           |
| `POST` | `/forgot-password/reset`   | Reset password       |

### Recommendations (`/api/recommend`)

| Method   | Endpoint         | Key Parameters                                                                   |
| -------- | ---------------- | -------------------------------------------------------------------------------- |
| `POST` | `/mood`        | `mood`, `season`, `time_of_day`, `travel`, `reading_time`, `use_llm` |
| `POST` | `/saved`       | `liked_titles[]`, `saved_titles[]`, `read_titles[]`, `user_genres[]`     |
| `GET`  | `/genre`       | `genre`, `top_n`                                                             |
| `GET`  | `/author`      | `author`, `top_n`                                                            |
| `GET`  | `/title`       | `title`, `top_n`                                                             |
| `POST` | `/description` | `description`, `liked_titles[]`                                              |
| `GET`  | `/trending`    | `top_n`                                                                        |
| `GET`  | `/search`      | `query`, `limit`                                                             |

### Books, Ratings & Songs

| Method   | Endpoint                     | Description                         |
| -------- | ---------------------------- | ----------------------------------- |
| `POST` | `/books/add-or-get`        | Upsert book by CSV book_id or title |
| `GET`  | `/books/{book_id}`         | Get single book                     |
| `POST` | `/ratings/rate`            | Submit/update star rating           |
| `GET`  | `/ratings/{book_id}`       | Community average + count           |
| `POST` | `/songs/recommend`         | Get 5 songs for a book              |
| `POST` | `/users/{id}/upload-image` | Upload profile avatar               |

---

## Database

Supports **SQLite** (development) and **PostgreSQL** (production) — change `DATABASE_URL` in `.env`.

10 tables are auto-created on startup: `users`, `refresh_tokens`, `books`, `ratings`, `user_ratings`, `user_saved_books`, `user_liked_books`, `favorites`, `search_history`, `recommendation_logs`.

---

## Security Notes

- Passwords hashed with **bcrypt** — never stored in plain text
- JWTs use **HS256** — set a strong `JWT_SECRET_KEY` (32-byte hex minimum)
- Refresh tokens stored in DB for **revocation support**
- Google tokens **verified server-side** with `google-auth-library`
- File uploads validated by extension and capped at **5 MB**
- `.env` is always in `.gitignore` — never commit secrets

---

## Contributing

1. Fork the repository
2. Create your branch: `git checkout -b feature/amazing-feature`
3. Commit: `git commit -m 'Add amazing feature'`
4. Push: `git push origin feature/amazing-feature`
5. Open a Pull Request

---

## 📄 License

This project is licensed under the MIT License.

---

<div align="center">

### ROOK — Your Literary Compass

*React · FastAPI · Ollama · FAISS · Goodreads · Spotify*

</div>

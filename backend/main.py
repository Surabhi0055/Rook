from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from database import engine, Base
from auth.router import router as auth_router
from routers import users, books, recommendation, ratings
from routers import songs  
import os
from pathlib import Path

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield

app = FastAPI(
    title="ROOK — Book Recommendation API",
    version="4.0.0",
    lifespan=lifespan,
)

_raw_cors = os.getenv(
    "CORS_ORIGINS",
    "*"  # Defaulting to allow all for debugging, but we'll prioritize the env var
)

if _raw_cors == "*":
    _cors_origins = ["*"]
else:
    _cors_origins = [o.strip() for o in _raw_cors.split(",") if o.strip()]

# Remove '*' from credentials mode if it's there (FastAPI requirement)
_allow_credentials = True
if "*" in _cors_origins:
    _allow_credentials = False # Credentials cannot be True if origin is '*'

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=_allow_credentials,
    allow_methods=["*"],
    allow_headers=["*"],
)

Path("uploads").mkdir(exist_ok=True)

app.mount("/uploads", StaticFiles(directory="uploads"), name="uploads")

app.include_router(auth_router, prefix="/api")
app.include_router(users.router, prefix="/api")
app.include_router(books.router, prefix="/api")
app.include_router(recommendation.router, prefix="/api")
app.include_router(ratings.router, prefix="/api")
app.include_router(songs.router, prefix="/api")

@app.get("/")
def root():
    return {"status": "ok", "docs": "/docs"}
import os
import ssl
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base

load_dotenv()

_raw_url: str = str(os.getenv("DATABASE_URL") or "").strip()

if not _raw_url:
    # Use config.env if root .env was ignored
    load_dotenv("config.env")
    _raw_url = str(os.getenv("DATABASE_URL") or "").strip()

if not _raw_url:
    # Final production fallback
    _raw_url = "sqlite+aiosqlite:///./rook.db"

# ── Normalise driver prefix ───────────────────────────────────────────────────
if _raw_url.startswith("postgresql://"):
    DATABASE_URL = _raw_url.replace("postgresql://", "postgresql+asyncpg://", 1)
elif _raw_url.startswith("postgres://"):     
    DATABASE_URL = _raw_url.replace("postgres://", "postgresql+asyncpg://", 1)
else:
    DATABASE_URL = _raw_url               

_is_sqlite    = DATABASE_URL.startswith("sqlite")
_is_postgres  = DATABASE_URL.startswith("postgresql")


_engine_kwargs: dict = {
    "echo":         os.getenv("DEBUG", "false").lower() == "true",
    "future":       True,
    "pool_pre_ping": True,
}

if _is_sqlite:
   
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

elif _is_postgres:
    # Supabase pooler uses self-signed certs — create a permissive SSL context
    _ssl_ctx = ssl.create_default_context()
    _ssl_ctx.check_hostname = False
    _ssl_ctx.verify_mode = ssl.CERT_NONE
    # statement_cache_size=0 is REQUIRED for Supabase transaction-mode pooler (pgBouncer/Supavisor)
    _engine_kwargs["pool_size"]       = 10
    _engine_kwargs["max_overflow"]    = 20
    _engine_kwargs["connect_args"]    = {
        "ssl": _ssl_ctx,
        "statement_cache_size": 0,
    }

engine = create_async_engine(DATABASE_URL, **_engine_kwargs)

# ── Session factory ───────────────────────────────────────────────────────────
AsyncSessionLocal = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,   # prevents lazy-load errors after commit in async context
    autocommit=False,
    autoflush=False,
)

# ── Declarative base ──────────────────────────────────────────────────────────
Base = declarative_base()

async def get_db():
    async with AsyncSessionLocal() as session:
        try:
            yield session
        finally:
            await session.close()

async def reconcile_db():
    """Ensure existing tables have current columns (SQLite only helper)."""
    if not _is_sqlite:
        return
    
    import sqlite3
    db_path = DATABASE_URL.replace("sqlite+aiosqlite:///", "")
    if not os.path.exists(db_path):
        return
    
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    
    # ── Users table ───────────────────────────────────────────────────────────
    cur.execute("PRAGMA table_info(users)")
    cols = [row[1] for row in cur.fetchall()]
    
    if "created_at" not in cols:
        cur.execute("ALTER TABLE users ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP")
    if "updated_at" not in cols:
        cur.execute("ALTER TABLE users ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP")
    if "image_url" not in cols:
        cur.execute("ALTER TABLE users ADD COLUMN image_url TEXT")
    if "cf_user_id" not in cols:
        cur.execute("ALTER TABLE users ADD COLUMN cf_user_id INTEGER")
    
    # ── Books table ───────────────────────────────────────────────────────────
    cur.execute("PRAGMA table_info(books)")
    cols = [row[1] for row in cur.fetchall()]
    if "created_at" not in cols:
        cur.execute("ALTER TABLE books ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP")
    if "updated_at" not in cols:
        cur.execute("ALTER TABLE books ADD COLUMN updated_at DATETIME DEFAULT CURRENT_TIMESTAMP")
    if "image_url" not in cols:
        cur.execute("ALTER TABLE books ADD COLUMN image_url TEXT")
    
    # ── Ratings table ─────────────────────────────────────────────────────────
    cur.execute("PRAGMA table_info(ratings)")
    cols = [row[1] for row in cur.fetchall()]
    if cols: # only if it exists
        if "rated_at" not in cols:
            cur.execute("ALTER TABLE ratings ADD COLUMN rated_at DATETIME DEFAULT CURRENT_TIMESTAMP")
        if "review" not in cols:
            cur.execute("ALTER TABLE ratings ADD COLUMN review TEXT")
    
    # ── Refresh Tokens column check ───────────────────────────────────────────
    cur.execute("PRAGMA table_info(refresh_tokens)")
    cols = [row[1] for row in cur.fetchall()]
    if cols and "created_at" not in cols:
        cur.execute("ALTER TABLE refresh_tokens ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP")
    
    conn.commit()
    conn.close()
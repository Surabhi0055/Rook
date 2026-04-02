import os
from dotenv import load_dotenv
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import declarative_base

load_dotenv()

_raw_url: str = os.getenv("DATABASE_URL", "")

if not _raw_url:
    raise RuntimeError(
        "DATABASE_URL is not set in your .env file.\n"
        "Example for SQLite:     DATABASE_URL=sqlite+aiosqlite:///./rook.db\n"
        "Example for PostgreSQL: DATABASE_URL=postgresql://user:pass@localhost/rook"
    )

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
    # Connection pool settings only make sense for a real server database
    _engine_kwargs["pool_size"]    = 10
    _engine_kwargs["max_overflow"] = 20

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
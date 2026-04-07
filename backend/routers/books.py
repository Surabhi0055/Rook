#books.py
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import models
import schemas
from database import AsyncSessionLocal

# ── Router ────────────────────────────────────────────────────────────────────
router = APIRouter(
    prefix="/books",
    tags=["Books"],
)


# ── DB Dependency ─────────────────────────────────────────────────────────────
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


# ── Shared helper ─────────────────────────────────────────────────────────────
async def _get_book_or_404(book_id: int, db: AsyncSession) -> models.Book:
    """Look up by CSV book_id, raise 404 if missing."""
    result = await db.execute(
        select(models.Book).where(models.Book.book_id == book_id)
    )
    book = result.scalar_one_or_none()
    if not book:
        raise HTTPException(
            status_code=404,
            detail=f"Book with book_id={book_id} not found",
        )
    return book


# ══════════════════════════════════════════════════════════════════════════════
#  BOOK CRUD
# ══════════════════════════════════════════════════════════════════════════════

@router.post(
    "/",
    response_model=schemas.BookResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a book to the database (seed or admin insert)",
)
async def create_book(
    body: schemas.BookCreate,
    db: AsyncSession = Depends(get_db),
):
    
    existing = await db.execute(
        select(models.Book).where(models.Book.book_id == body.book_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"book_id={body.book_id} already exists",
        )

    book = models.Book(**body.model_dump())
    db.add(book)
    await db.commit()
    await db.refresh(book)
    return book


@router.get(
    "/",
    response_model=List[schemas.BookResponse],
    summary="List books (paginated)",
)
async def list_books(
    skip:  int = Query(0,   ge=0,   description="Rows to skip"),
    limit: int = Query(100, ge=1, le=500, description="Max rows to return"),
    genre: Optional[str] = Query(None, description="Filter by genre (partial match)"),
    db: AsyncSession = Depends(get_db),
):
    
    query = select(models.Book).offset(skip).limit(limit)

    if genre:
        # SQLite: LIKE is case-insensitive for ASCII by default
        query = query.where(models.Book.genre.ilike(f"%{genre}%"))

    result = await db.execute(query)
    return result.scalars().all()


@router.get(
    "/{book_id}",
    response_model=schemas.BookResponse,
    summary="Get a single book by its CSV book_id",
)
async def get_book(
    book_id: int,
    db: AsyncSession = Depends(get_db),
):
    return await _get_book_or_404(book_id, db)


@router.put(
    "/{book_id}",
    response_model=schemas.BookResponse,
    summary="Update book metadata (full replace of mutable fields)",
)
async def update_book(
    book_id: int,
    body: schemas.BookCreate,
    db: AsyncSession = Depends(get_db),
):
    
    if body.book_id != book_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Path book_id ({book_id}) does not match body book_id ({body.book_id})",
        )

    book = await _get_book_or_404(book_id, db)

    book.title          = body.title
    book.authors        = body.authors
    book.genre          = body.genre
    book.description    = body.description
    book.image_url      = body.image_url
    book.average_rating = body.average_rating
    book.rating_count   = body.rating_count

    db.add(book)
    await db.commit()
    await db.refresh(book)
    return book


@router.delete(
    "/{book_id}",
    summary="Delete a book and all related ratings / favorites (cascade)",
)
async def delete_book(
    book_id: int,
    db: AsyncSession = Depends(get_db),
):
    book = await _get_book_or_404(book_id, db)
    await db.delete(book)
    await db.commit()
    return {"detail": f"Book with book_id={book_id} deleted"}

# ─────────────────────────────────────────────────────────────────────────────
# ADD OR GET BOOK (for ratings system)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/add-or-get", response_model=schemas.BookResponse)
async def add_or_get_book(
    body: schemas.BookCreate,
    db: AsyncSession = Depends(get_db),
):
    # Try finding by CSV book_id first (BEST)
    if body.book_id:
        result = await db.execute(
            select(models.Book).where(models.Book.book_id == body.book_id)
        )
        existing = result.scalar_one_or_none()

        if existing:
            return existing

    # Fallback: match by title
    result = await db.execute(
        select(models.Book).where(models.Book.title == body.title)
    )
    existing = result.scalar_one_or_none()

    if existing:
        return existing

    # Create new book
    new_book = models.Book(**body.model_dump())
    db.add(new_book)
    await db.commit()
    await db.refresh(new_book)

    return new_book
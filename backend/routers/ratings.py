from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import func, select
from database import get_db
from models import Rating, Book, User
from schemas import RatingCreate, RatingResponse, BookRatingStats, UserRatingResponse
from auth.security import get_current_user
from typing import List, Optional
from pydantic import BaseModel

router = APIRouter(prefix="/ratings", tags=["ratings"])

import hashlib

class RateBookRequest(BaseModel):
    book_id: Optional[int] = None
    title: Optional[str] = None
    authors: Optional[str] = None
    image_url: Optional[str] = None
    rating: int

def generate_book_id(title: str) -> int:
    """Generate a pseudo-random integer ID based on title hash (positive int32 range)."""
    h = hashlib.sha256(title.encode('utf-8')).hexdigest()
    # Take first 7 chars of hash to stay in a reasonable positive integer range
    return int(h[:7], 16)

# ─────────────────────────────────────────────────────────────────────────────
# POST /ratings/rate  → Add or Update a rating (upsert)
# ─────────────────────────────────────────────────────────────────────────────
@router.post("/rate", response_model=RatingResponse)
async def rate_book(
    rating_data: RateBookRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        if not (1 <= rating_data.rating <= 5):
            raise HTTPException(status_code=400, detail="Rating must be between 1 and 5")

        book = None
        # 1. Try finding by CSV book_id if provided
        if rating_data.book_id:
            result = await db.execute(
                select(Book).where(Book.book_id == rating_data.book_id)
            )
            book = result.scalar_one_or_none()

            # 2. Try as DB secondary PK (id) if not found by CSV ID
            if not book:
                result = await db.execute(
                    select(Book).where(Book.id == rating_data.book_id)
                )
                book = result.scalar_one_or_none()

        # 3. Try finding by title if still no book
        if not book and rating_data.title:
            result = await db.execute(
                select(Book).where(Book.title == rating_data.title)
            )
            book = result.scalar_one_or_none()

        # 4. Create book if not exists
        if not book:
            # We NEED a title to create/generate an ID
            if not rating_data.title:
                raise HTTPException(status_code=400, detail="Title is required if book_id is missing or not found")
            
            # Use provided book_id or generate one
            final_book_id = rating_data.book_id or generate_book_id(rating_data.title)
            
            # Ensure final_book_id is unique (rare collision case for hashes)
            check_exist = await db.execute(select(Book).where(Book.book_id == final_book_id))
            if check_exist.scalar_one_or_none():
                 final_book_id += 1 

            book = Book(
                book_id=final_book_id,
                title=rating_data.title,
                authors=rating_data.authors,
                image_url=rating_data.image_url,
                average_rating=0.0,
                rating_count=0,
            )
            db.add(book)
            await db.commit()
            await db.refresh(book)

        book_pk = book.id
        result = await db.execute(
            select(Rating).where(
                Rating.user_id == current_user.id,
                Rating.book_id == book_pk
            )
        )
        existing_rating = result.scalar_one_or_none()

        if existing_rating:
            existing_rating.rating = rating_data.rating
            rating_obj = existing_rating
        else:
            rating_obj = Rating(
                user_id=current_user.id,
                book_id=book_pk,
                rating=rating_data.rating
            )
            db.add(rating_obj)

        # Capture all needed data BEFORE commit to prevent DetachedInstanceError
        response_data = {
            "id": int(rating_obj.id) if (hasattr(rating_obj, 'id') and rating_obj.id) else 0,
            "user_id": int(current_user.id),
            "book_id": int(book.id),
            "csv_book_id": int(book.book_id) if book.book_id else None,
            "rating": int(rating_obj.rating),
        }

        await db.commit()
        return response_data
    
    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        import traceback
        traceback.print_exc()   
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
# ─────────────────────────────────────────────────────────────────────────────
# GET /ratings/{book_id}  → Average rating + total count
# book_id is the CSV/Goodreads book_id (what the frontend sends)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/{book_id}", response_model=BookRatingStats)
async def get_book_ratings(book_id: int, db: AsyncSession = Depends(get_db)):
    # Resolve CSV book_id → Book DB primary key
    book_result = await db.execute(
        select(Book.id).where(Book.book_id == book_id)
    )
    book_pk = book_result.scalar_one_or_none()

    if not book_pk:
        # Book not in DB — return zeroes so the UI stays clean
        return {"book_id": book_id, "average_rating": 0.0, "total_ratings": 0}

    result = await db.execute(
        select(
            func.avg(Rating.rating).label("average_rating"),
            func.count(Rating.id).label("total_ratings"),
        ).where(Rating.book_id == book_pk)
    )
    row = result.first()

    return {
        "book_id": book_id,
        "average_rating": round(float(row.average_rating or 0), 1),
        "total_ratings": row.total_ratings or 0,
    }


# ─────────────────────────────────────────────────────────────────────────────
# GET /ratings/me  → Current user's ratings (for recommendation weighting)
# Returns {book_id (CSV): rating} mapping for use in recommendation engine
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/me/all")
async def get_my_ratings(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(
        select(Rating, Book.book_id.label("csv_book_id"))
        .join(Book, Book.id == Rating.book_id)
        .where(Rating.user_id == current_user.id)
    )
    rows = result.all()

    return [
        {
            "book_id": row.csv_book_id,   # CSV/Goodreads id
            "rating": row.Rating.rating,
            "rated_at": row.Rating.rated_at,
        }
        for row in rows
    ]


# ─────────────────────────────────────────────────────────────────────────────
# GET /ratings/user/{user_id}  → All ratings by a specific user
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/user/{user_id}", response_model=List[UserRatingResponse])
async def get_user_ratings(user_id: int, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Rating).where(Rating.user_id == user_id))
    return result.scalars().all()


# ─────────────────────────────────────────────────────────────────────────────
# GET /ratings/top-rated/books  → Top rated books
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/top-rated/books")
async def get_top_rated_books(limit: int = 10, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(
            Rating.book_id,
            func.avg(Rating.rating).label("avg_rating"),
            func.count(Rating.id).label("total"),
        )
        .group_by(Rating.book_id)
        .having(func.count(Rating.id) >= 3)
        .order_by(func.avg(Rating.rating).desc())
        .limit(limit)
    )
    rows = result.all()

    return [
        {
            "book_id": r.book_id,
            "average_rating": round(float(r.avg_rating), 1),
            "total_ratings": r.total,
        }
        for r in rows
    ]
# In your books/search router
@router.get("/books/resolve")
async def resolve_book_id(title: str, db: AsyncSession = Depends(get_db)):
    """Resolve a book title to its CSV book_id for rating purposes."""
    result = await db.execute(
        select(Book.id, Book.book_id, Book.title)
        .where(func.lower(Book.title).like(f"%{title.lower()}%"))
        .order_by(func.length(Book.title))  # prefer shorter/exact matches
        .limit(5)
    )
    rows = result.all()
    return [{"db_id": r.id, "book_id": r.book_id, "title": r.title} for r in rows]
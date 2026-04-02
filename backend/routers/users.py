import os
import uuid
from typing import List
from pathlib import Path
from uuid import uuid4
import aiofiles
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import models
import schemas
from auth.security import get_current_active_user
from database import AsyncSessionLocal

router = APIRouter(prefix="/users", tags=["Users"])

UPLOAD_DIR = "uploads/avatars"
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB


# ── DB dependency ──────────────────────────────────────────────────────────────
async def get_db():
    async with AsyncSessionLocal() as session:
        yield session


# ── Shared helpers ─────────────────────────────────────────────────────────────

async def _get_user_or_404(user_id: int, db: AsyncSession) -> models.User:
    r = await db.execute(select(models.User).where(models.User.id == user_id))
    user = r.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail=f"User {user_id} not found")
    return user


async def _get_book_or_404(book_id: int, db: AsyncSession) -> models.Book:
    r = await db.execute(select(models.Book).where(models.Book.book_id == book_id))
    book = r.scalar_one_or_none()
    if not book:
        raise HTTPException(
            status_code=404,
            detail=f"book_id={book_id} not found — seed it via POST /books/ first",
        )
    return book


def _assert_owner(current_user: models.User, user_id: int) -> None:
    if current_user.id != user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only modify your own account",
        )
# ══════════════════════════════════════════════════════════════════════════════
#  PROFILE
# ══════════════════════════════════════════════════════════════════════════════
@router.get(
    "/me",
    response_model=schemas.UserResponse,
    summary="Get your own profile",
)
async def get_me(current_user: models.User = Depends(get_current_active_user)):
    return schemas.UserResponse.model_validate(current_user)

@router.patch(
    "/me",
    response_model=schemas.UserResponse,
    summary="Update your own profile (convenience alias)",
)
async def update_me(
    body: schemas.UserUpdate,
    current_user: models.User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await _apply_user_update(current_user.id, body, current_user, db)


@router.get(
    "/{user_id}",
    response_model=schemas.UserResponse,
    summary="Get any user profile by ID",
)
async def get_user(
    user_id: int,
    _: models.User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    return await _get_user_or_404(user_id, db)


@router.patch(
    "/{user_id}",
    response_model=schemas.UserResponse,
    summary="Update profile (own account only)",
)
async def update_user(
    user_id: int,
    body: schemas.UserUpdate,
    current_user: models.User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _assert_owner(current_user, user_id)
    return await _apply_user_update(user_id, body, current_user, db)


async def _apply_user_update(
    user_id: int,
    body: schemas.UserUpdate,
    current_user: models.User,
    db: AsyncSession,
) -> schemas.UserResponse:
    user = await _get_user_or_404(user_id, db)

    if body.display_name    is not None: user.display_name    = body.display_name
    if body.email           is not None: user.email           = body.email
    if body.favourite_genre is not None: user.favourite_genre = body.favourite_genre
    if body.cf_user_id      is not None: user.cf_user_id      = body.cf_user_id
    if body.is_active       is not None: user.is_active       = body.is_active
    if body.image_url       is not None: user.image_url       = body.image_url
    if body.password        is not None:
        from auth.security import hash_password
        user.hashed_password = hash_password(body.password)

    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.delete(
    "/{user_id}",
    summary="Delete account and all associated data (own account only)",
)
async def delete_user(
    user_id: int,
    current_user: models.User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _assert_owner(current_user, user_id)
    user = await _get_user_or_404(user_id, db)
    await db.delete(user)
    await db.commit()
    return {"detail": f"User {user_id} and all associated data deleted"}

@router.post("/{user_id}/upload-image", response_model=schemas.UserResponse)
async def upload_image(
    user_id: int,
    file: UploadFile = File(...),
    current_user = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    if current_user.id != user_id:
        raise HTTPException(status_code=403, detail="Not allowed")

    # Save file
    ext = Path(file.filename).suffix
    filename = f"user_{user_id}_{uuid4().hex}{ext}"
    save_path = Path("uploads") / filename
    save_path.parent.mkdir(parents=True, exist_ok=True)

    async with aiofiles.open(save_path, "wb") as f:
        content = await file.read()
        await f.write(content)

    # Update DB
    result = await db.execute(select(models.User).where(models.User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")

    user.image_url = f"/uploads/{filename}"
    await db.commit()
    await db.refresh(user)

    return schemas.UserResponse.model_validate(user)  # ✅ was missing
# ══════════════════════════════════════════════════════════════════════════════
#  RATINGS
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/{user_id}/ratings",
    response_model=List[schemas.RatingResponse],
    summary="List all star ratings submitted by a user",
)
async def list_ratings(
    user_id: int,
    _: models.User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_user_or_404(user_id, db)
    r = await db.execute(
        select(models.UserRating)
        .where(models.UserRating.user_id == user_id)
        .order_by(models.UserRating.rated_at.desc())
    )
    return r.scalars().all()


@router.post(
    "/{user_id}/ratings",
    response_model=schemas.RatingResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit or update a star rating (upsert)",
)
async def add_rating(
    user_id: int,
    body: schemas.RatingCreate,
    current_user: models.User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _assert_owner(current_user, user_id)
    await _get_user_or_404(user_id, db)
    book = await _get_book_or_404(body.book_id, db)

    r = await db.execute(
        select(models.UserRating).where(
            models.UserRating.user_id == user_id,
            models.UserRating.book_id == book.id,
        )
    )
    existing = r.scalar_one_or_none()
    if existing:
        existing.rating = body.rating
        await db.commit()
        await db.refresh(existing)
        return existing

    row = models.UserRating(user_id=user_id, book_id=book.id, rating=body.rating)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


@router.delete(
    "/{user_id}/ratings/{book_id}",
    summary="Delete a rating",
)
async def delete_rating(
    user_id: int,
    book_id: int,
    current_user: models.User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _assert_owner(current_user, user_id)
    book = await _get_book_or_404(book_id, db)

    r = await db.execute(
        select(models.UserRating).where(
            models.UserRating.user_id == user_id,
            models.UserRating.book_id == book.id,
        )
    )
    row = r.scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"No rating found for book_id={book_id}")
    await db.delete(row)
    await db.commit()
    return {"detail": f"Rating for book_id={book_id} deleted"}


# ══════════════════════════════════════════════════════════════════════════════
#  FAVORITES
# ══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/{user_id}/favorites",
    response_model=List[schemas.FavoriteResponse],
    summary="List all favorites for a user",
)
async def list_favorites(
    user_id: int,
    _: models.User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_user_or_404(user_id, db)
    r = await db.execute(
        select(models.Favorite)
        .where(models.Favorite.user_id == user_id)
        .order_by(models.Favorite.created_at.desc())
    )
    return r.scalars().all()


@router.post(
    "/{user_id}/favorites/{book_id}",
    response_model=schemas.FavoriteResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a book to favorites (idempotent)",
)
async def add_favorite(
    user_id: int,
    book_id: int,
    current_user: models.User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _assert_owner(current_user, user_id)
    await _get_user_or_404(user_id, db)
    await _get_book_or_404(book_id, db)

    r = await db.execute(
        select(models.Favorite).where(
            models.Favorite.user_id == user_id,
            models.Favorite.book_id == book_id,
        )
    )
    row = r.scalar_one_or_none()
    if row:
        return row  # idempotent

    fav = models.Favorite(user_id=user_id, book_id=book_id)
    db.add(fav)
    await db.commit()
    await db.refresh(fav)
    return fav


@router.delete(
    "/{user_id}/favorites/{book_id}",
    summary="Remove a book from favorites",
)
async def remove_favorite(
    user_id: int,
    book_id: int,
    current_user: models.User = Depends(get_current_active_user),
    db: AsyncSession = Depends(get_db),
):
    _assert_owner(current_user, user_id)

    r = await db.execute(
        select(models.Favorite).where(
            models.Favorite.user_id == user_id,
            models.Favorite.book_id == book_id,
        )
    )
    row = r.scalar_one_or_none()
    if not row:
        raise HTTPException(404, f"book_id={book_id} is not in your favorites")
    await db.delete(row)
    await db.commit()
    return {"detail": f"book_id={book_id} removed from favorites"}
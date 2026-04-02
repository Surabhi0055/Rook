# schemas.py
from datetime import datetime
from typing import Any, List, Optional

from pydantic import BaseModel, EmailStr, Field, field_validator

class BookShort(BaseModel):
    book_id:          Optional[int]   = None
    title:            str
    authors:          Optional[str]   = None
    genre:            Optional[str]   = None
    description:      Optional[str]   = None
    image_url:        Optional[str]   = None
    average_rating:   Optional[float] = None
    rating_count:     Optional[int]   = None
    predicted_rating: Optional[float] = None

    model_config = {"from_attributes": True}


class BookCreate(BaseModel):
    book_id:          int
    title:            str
    authors:          Optional[str]  = None
    genre:            Optional[str]  = None
    description:      Optional[str]  = None
    image_url:        Optional[str]  = None
    average_rating:   float          = 0.0
    rating_count:     int            = 0
    publication_year: Optional[int]  = None


class BookResponse(BookCreate):
    id:         int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════════════════════════
#  AUTH
# ══════════════════════════════════════════════════════════════════════════════

class RegisterRequest(BaseModel):
    username:        str            = Field(..., min_length=3, max_length=80)
    password:        str            = Field(..., min_length=8)
    email:           Optional[EmailStr] = Field(None)
    display_name:    Optional[str]  = Field(None, max_length=120)
    favourite_genre: Optional[str]  = Field(None, max_length=80)
    cf_user_id:      Optional[int]  = Field(
        None,
        description="Integer user_id from ratings_processed.csv — enables SVD filtering"
    )


class LoginRequest(BaseModel):
    identifier: str = Field(..., description="Username or email address")
    password:   str = Field(..., min_length=1)


class RefreshRequest(BaseModel):
    refresh_token: str = Field(...)


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1)
    new_password:     str = Field(..., min_length=8)


class AccessTokenResponse(BaseModel):
    access_token: str
    token_type:   str = "bearer"


class TokenResponse(BaseModel):
    access_token:  str
    refresh_token: str
    token_type:    str = "bearer"
    user:          Optional["UserResponse"] = None


# ══════════════════════════════════════════════════════════════════════════════
#  USER
# ══════════════════════════════════════════════════════════════════════════════

class UserCreate(BaseModel):
    username:        str            = Field(..., min_length=3, max_length=80)
    email:           Optional[EmailStr] = None
    password:        Optional[str]  = Field(None, min_length=8)
    display_name:    Optional[str]  = Field(None, max_length=120)
    favourite_genre: Optional[str]  = Field(None, max_length=80)
    cf_user_id:      Optional[int]  = Field(None)


class UserUpdate(BaseModel):
    display_name:    Optional[str]      = Field(None, max_length=120)
    email:           Optional[EmailStr] = None
    password:        Optional[str]      = Field(None, min_length=8)
    favourite_genre: Optional[str]      = Field(None, max_length=80)
    cf_user_id:      Optional[int]      = None
    is_active:       Optional[bool]     = None
    image_url:       Optional[str]      = None


class UserStats(BaseModel):
    saved_count:  int = 0
    liked_count:  int = 0
    rated_count:  int = 0
    search_count: int = 0


class UserResponse(BaseModel):
    id:              int
    username:        str
    email:           Optional[str]
    display_name:    Optional[str]
    favourite_genre: Optional[str]
    cf_user_id:      Optional[int]
    is_active:       bool
    image_url:       str | None = None
    created_at:      datetime
    updated_at:      datetime
    model_config = {"from_attributes": True}


class UserProfileResponse(UserResponse):
    stats: UserStats


# ══════════════════════════════════════════════════════════════════════════════
#  SAVED BOOKS
# ══════════════════════════════════════════════════════════════════════════════

class SavedBookCreate(BaseModel):
    title:     str
    authors:   Optional[str] = None
    genre:     Optional[str] = None
    image_url: Optional[str] = None
    book_id:   Optional[int] = Field(None)


class SavedBookResponse(BaseModel):
    id:       int
    user_id:  int
    book:     BookShort
    saved_at: datetime

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════════════════════════
#  LIKED BOOKS
# ══════════════════════════════════════════════════════════════════════════════

class LikedBookCreate(BaseModel):
    title:     str
    authors:   Optional[str] = None
    genre:     Optional[str] = None
    image_url: Optional[str] = None
    book_id:   Optional[int] = Field(None)


class LikedBookResponse(BaseModel):
    id:       int
    user_id:  int
    book:     BookShort
    liked_at: datetime

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════════════════════════
#  USER RATINGS — review field removed, just star ratings
# ══════════════════════════════════════════════════════════════════════════════

class RatingCreate(BaseModel):
    """
    Schema for submitting or updating a star rating.
    book_id is the CSV/Goodreads book_id (integer), NOT the DB primary key.
    review is accepted for backward compatibility but not stored.
    """
    book_id: int   = Field(..., description="CSV book_id from books_genre.csv")
    rating:  int   = Field(..., ge=1, le=5, description="Star rating 1-5")
    review:  Optional[str] = Field(None, description="Deprecated — not stored")

    @field_validator("rating")
    @classmethod
    def rating_in_range(cls, v: int) -> int:
        if not (1 <= v <= 5):
            raise ValueError("Rating must be between 1 and 5")
        return v


class RatingUpdate(BaseModel):
    rating: int = Field(..., ge=1, le=5)

    @field_validator("rating")
    @classmethod
    def rating_in_range(cls, v: int) -> int:
        if not (1 <= v <= 5):
            raise ValueError("Rating must be between 1 and 5")
        return v

class RatingResponse(BaseModel):
    id: int
    user_id: int
    book_id: int
    csv_book_id: int
    rating: int

    model_config = {"from_attributes": True}

class BookRatingStats(BaseModel):
    book_id:        int
    average_rating: float
    total_ratings:  int


class UserRatingResponse(BaseModel):
    id:       int
    book_id:  int
    rating:   int
    rated_at: datetime

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════════════════════════
#  SEARCH HISTORY
# ══════════════════════════════════════════════════════════════════════════════

class SearchHistoryResponse(BaseModel):
    id:           int
    user_id:      int
    query:        str
    search_type:  str
    result_count: Optional[int]
    searched_at:  datetime

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════════════════════════
#  RECOMMENDATION LOGS
# ══════════════════════════════════════════════════════════════════════════════

class RecommendationLogUpdate(BaseModel):
    was_clicked: Optional[bool]     = None
    was_saved:   Optional[bool]     = None
    was_liked:   Optional[bool]     = None
    was_rated:   Optional[bool]     = None
    clicked_at:  Optional[datetime] = None


class RecommendationLogResponse(BaseModel):
    id:          int
    user_id:     int
    book_id:     int
    strategy:    str
    position:    int
    session_id:  Optional[str]
    was_clicked: bool
    was_saved:   bool
    was_liked:   bool
    was_rated:   bool
    served_at:   datetime
    clicked_at:  Optional[datetime]

    model_config = {"from_attributes": True}


# ══════════════════════════════════════════════════════════════════════════════
#  RECOMMENDATION REQUESTS  (ML endpoints)
# ══════════════════════════════════════════════════════════════════════════════

class SavedLikedRequest(BaseModel):
    liked_titles: List[str] = Field(default_factory=list)
    saved_titles: List[str] = Field(default_factory=list)
    top_n:        int       = Field(10, ge=1, le=100)


class DescriptionRequest(BaseModel):
    description:  str       = Field(..., min_length=3, max_length=2000)
    liked_titles: List[str] = Field(default_factory=list)
    saved_titles: List[str] = Field(default_factory=list)
    top_n:        int       = Field(10, ge=1, le=100)


class MoodRequest(BaseModel):
    mood:         str                 = Field(
        ..., min_length=1, max_length=200,
    )
    season:       Optional[str]       = Field(None)
    time_of_day:  Optional[str]       = Field(None)
    travel:       Optional[str]       = Field(None)
    reading_time: Optional[str]       = Field(None)
    user_genres:  Optional[List[str]] = Field(default_factory=list)
    user_id:      Optional[int]       = Field(None)
    liked_titles: Optional[List[str]] = Field(default_factory=list)
    saved_titles: Optional[List[str]] = Field(default_factory=list)
    top_n:        int                 = Field(12, ge=1, le=100)
    use_llm:      bool                = Field(True)


class ContextRequest(BaseModel):
    season:       Optional[str]       = Field(None)
    time_of_day:  Optional[str]       = Field(None)
    travel:       Optional[str]       = Field(None)
    reading_time: Optional[str]       = Field(None)
    user_genres:  Optional[List[str]] = Field(default_factory=list)
    user_id:      Optional[int]       = Field(None)
    liked_titles: Optional[List[str]] = Field(default_factory=list)
    saved_titles: Optional[List[str]] = Field(default_factory=list)
    top_n:        int                 = Field(12, ge=1, le=100)
    use_llm:      bool                = Field(True)


# ══════════════════════════════════════════════════════════════════════════════
#  ANALYTICS
# ══════════════════════════════════════════════════════════════════════════════

class StrategyStats(BaseModel):
    strategy:      str
    total_served:  int
    total_clicked: int
    total_saved:   int
    total_liked:   int
    ctr:           float
    save_rate:     float
    like_rate:     float


class AnalyticsSummary(BaseModel):
    total_users:        int
    total_books_cached: int
    total_saved:        int
    total_liked:        int
    total_ratings:      int
    total_searches:     int
    total_recs_served:  int
    strategy_stats:     List[StrategyStats]


# ══════════════════════════════════════════════════════════════════════════════
#  GENERIC
# ══════════════════════════════════════════════════════════════════════════════

class MessageResponse(BaseModel):
    message: str
    detail:  Optional[str] = None


class ErrorResponse(BaseModel):
    error:  str
    detail: Optional[str] = None
    code:   Optional[int] = None


# ══════════════════════════════════════════════════════════════════════════════
#  FAVORITES
# ══════════════════════════════════════════════════════════════════════════════

class FavoriteResponse(BaseModel):
    id:         int
    user_id:    int
    book_id:    int
    created_at: datetime

    model_config = {"from_attributes": True}


TokenResponse.model_rebuild()
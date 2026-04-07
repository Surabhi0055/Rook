from datetime import datetime
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship
from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey, Text, UniqueConstraint
from sqlalchemy.sql import func
from database import Base


# ══════════════════════════════════════════════════════════════════════════════
#  USERS
# ══════════════════════════════════════════════════════════════════════════════
class User(Base):
    __tablename__ = "users"

    id               = Column(Integer, primary_key=True, autoincrement=True)
    cf_user_id       = Column(Integer, unique=True, nullable=True, index=True)
    username         = Column(String(80), unique=True, nullable=False, index=True)
    email            = Column(String(255), unique=True, nullable=True, index=True)
    hashed_password  = Column(String(255), nullable=True)
    display_name     = Column(String(120), nullable=True)
    favourite_genre  = Column(String(80), nullable=True)
    is_active        = Column(Boolean, nullable=False, default=True)
    image_url        = Column(String, nullable=True)
    created_at       = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at       = Column(DateTime, nullable=False, default=datetime.utcnow,
                              onupdate=datetime.utcnow)

    ratings = relationship(
        "UserRating",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="select"
    )
    reviews = relationship(        
        "Rating",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="select"
    )

    saved_books = relationship("UserSavedBook", back_populates="user",
                               cascade="all, delete-orphan", lazy="select")

    liked_books = relationship("UserLikedBook", back_populates="user",
                               cascade="all, delete-orphan", lazy="select")

    search_history = relationship("SearchHistory", back_populates="user",
                                 cascade="all, delete-orphan", lazy="select",
                                 order_by="desc(SearchHistory.searched_at)")

    recommendation_logs = relationship("RecommendationLog", back_populates="user",
                                       cascade="all, delete-orphan", lazy="select")
# ══════════════════════════════════════════════════════════════════════════════
#  REFRESH TOKENS  (JWT revocation store)
# ══════════════════════════════════════════════════════════════════════════════

class RefreshToken(Base):
   
    __tablename__ = "refresh_tokens"

    id         = Column(Integer,      primary_key=True, autoincrement=True)
    user_id    = Column(Integer,      ForeignKey("users.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    token      = Column(String(512),  nullable=False, unique=True, index=True)
    expires_at = Column(DateTime,     nullable=False)
    created_at = Column(DateTime,     nullable=False, default=datetime.utcnow)

    user = relationship("User", backref="refresh_tokens")

    def __repr__(self) -> str:
        return f"<RefreshToken user={self.user_id} expires={self.expires_at}>"


# ══════════════════════════════════════════════════════════════════════════════
#  BOOKS   (local DB cache — mirrors books_genre.csv)
# ══════════════════════════════════════════════════════════════════════════════

class Book(Base):
    
    __tablename__ = "books"

    id               = Column(Integer,      primary_key=True, autoincrement=True)
    book_id          = Column(Integer,      unique=True, nullable=False, index=True)
    title            = Column(String(512),  nullable=False, index=True)
    authors          = Column(String(512),  nullable=True)
    genre            = Column(String(200),  nullable=True)
    description      = Column(Text,         nullable=True)
    image_url        = Column(String(512),  nullable=True)
    average_rating   = Column(Float,        nullable=False, default=0.0)
    rating_count     = Column(Integer,      nullable=False, default=0)
    publication_year = Column(Integer,      nullable=True)
    created_at       = Column(DateTime,     nullable=False, default=datetime.utcnow)
    updated_at       = Column(DateTime,     nullable=False, default=datetime.utcnow,
                              onupdate=datetime.utcnow)

    # ── back-references ───────────────────────────────────────────────────────
    saved_by            = relationship("UserSavedBook",     back_populates="book",
                                       cascade="all, delete-orphan", lazy="select")
    liked_by            = relationship("UserLikedBook",     back_populates="book",
                                       cascade="all, delete-orphan", lazy="select")
    user_ratings        = relationship("UserRating",        back_populates="book",
                                       cascade="all, delete-orphan", lazy="select")
    recommendation_logs = relationship("RecommendationLog", back_populates="book",
                                       cascade="all, delete-orphan", lazy="select")
    reviews             = relationship("Rating", back_populates="book")        


    def __repr__(self) -> str:
        return f"<Book book_id={self.book_id} title={self.title!r}>"


# ══════════════════════════════════════════════════════════════════════════════
#  USER_SAVED_BOOKS
# ══════════════════════════════════════════════════════════════════════════════

class UserSavedBook(Base):
    
    __tablename__ = "user_saved_books"

    id       = Column(Integer,  primary_key=True, autoincrement=True)
    user_id  = Column(Integer,  ForeignKey("users.id", ondelete="CASCADE"),
                      nullable=False, index=True)
    book_id  = Column(Integer,  ForeignKey("books.id", ondelete="CASCADE"),
                      nullable=False, index=True)
    saved_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "book_id", name="uq_saved_user_book"),
    )

    user = relationship("User", back_populates="saved_books")
    book = relationship("Book", back_populates="saved_by")

    def __repr__(self) -> str:
        return f"<UserSavedBook user={self.user_id} book={self.book_id}>"


# ══════════════════════════════════════════════════════════════════════════════
#  USER_LIKED_BOOKS
# ══════════════════════════════════════════════════════════════════════════════

class UserLikedBook(Base):
    
    __tablename__ = "user_liked_books"

    id       = Column(Integer,  primary_key=True, autoincrement=True)
    user_id  = Column(Integer,  ForeignKey("users.id", ondelete="CASCADE"),
                      nullable=False, index=True)
    book_id  = Column(Integer,  ForeignKey("books.id", ondelete="CASCADE"),
                      nullable=False, index=True)
    liked_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "book_id", name="uq_liked_user_book"),
    )

    user = relationship("User", back_populates="liked_books")
    book = relationship("Book", back_populates="liked_by")

    def __repr__(self) -> str:
        return f"<UserLikedBook user={self.user_id} book={self.book_id}>"


# ══════════════════════════════════════════════════════════════════════════════
#  USER_RATINGS
# ══════════════════════════════════════════════════════════════════════════════

class UserRating(Base):
    
    __tablename__ = "user_ratings"

    id         = Column(Integer,  primary_key=True, autoincrement=True)
    user_id    = Column(Integer,  ForeignKey("users.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    book_id    = Column(Integer,  ForeignKey("books.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    rating     = Column(Float,    nullable=False)   # 1.0 – 5.0
    rated_at   = Column(DateTime, nullable=False, default=datetime.utcnow)
    updated_at = Column(DateTime, nullable=False, default=datetime.utcnow,
                        onupdate=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "book_id", name="uq_rating_user_book"),
    )

    user = relationship("User", back_populates="ratings")
    book = relationship("Book", back_populates="user_ratings")

    def __repr__(self) -> str:
        return f"<UserRating user={self.user_id} book={self.book_id} rating={self.rating}>"


# ══════════════════════════════════════════════════════════════════════════════
#  SEARCH_HISTORY
# ══════════════════════════════════════════════════════════════════════════════

class SearchHistory(Base):
    
    __tablename__ = "search_history"

    id           = Column(Integer,     primary_key=True, autoincrement=True)
    user_id      = Column(Integer,     ForeignKey("users.id", ondelete="CASCADE"),
                          nullable=False, index=True)
    query        = Column(String(512), nullable=False)
    search_type  = Column(String(20),  nullable=False, default="title")
    result_count = Column(Integer,     nullable=True)
    searched_at  = Column(DateTime,    nullable=False, default=datetime.utcnow,
                          index=True)

    __table_args__ = (
        # Composite index: fast "most recent searches for user X"
        Index("ix_sh_user_time", "user_id", "searched_at"),
    )

    user = relationship("User", back_populates="search_history")

    def __repr__(self) -> str:
        return (f"<SearchHistory user={self.user_id} "
                f"type={self.search_type!r} query={self.query!r}>")


# ══════════════════════════════════════════════════════════════════════════════
#  RECOMMENDATION_LOGS
# ══════════════════════════════════════════════════════════════════════════════

class RecommendationLog(Base):
    
    __tablename__ = "recommendation_logs"

    id          = Column(Integer,     primary_key=True, autoincrement=True)
    user_id     = Column(Integer,     ForeignKey("users.id", ondelete="CASCADE"),
                         nullable=False, index=True)
    book_id     = Column(Integer,     ForeignKey("books.id", ondelete="CASCADE"),
                         nullable=False, index=True)
    strategy    = Column(String(30),  nullable=False, index=True)
    position    = Column(Integer,     nullable=False, default=1)
    session_id  = Column(String(64),  nullable=True)   # browser session token
    was_clicked = Column(Boolean,     nullable=False, default=False)
    was_saved   = Column(Boolean,     nullable=False, default=False)
    was_liked   = Column(Boolean,     nullable=False, default=False)
    was_rated   = Column(Boolean,     nullable=False, default=False)
    served_at   = Column(DateTime,    nullable=False, default=datetime.utcnow,
                         index=True)
    clicked_at  = Column(DateTime,    nullable=True)

    __table_args__ = (
        Index("ix_rl_strategy_time", "strategy", "served_at"),
        Index("ix_rl_user_time",     "user_id",  "served_at"),
    )

    user = relationship("User", back_populates="recommendation_logs")
    book = relationship("Book", back_populates="recommendation_logs")

    def __repr__(self) -> str:
        return (f"<RecommendationLog user={self.user_id} "
                f"book={self.book_id} strategy={self.strategy!r} "
                f"pos={self.position} clicked={self.was_clicked}>")


# ══════════════════════════════════════════════════════════════════════════════
#  FAVORITES  (simple liked/bookmarked books per user — used by /users routes)
# ══════════════════════════════════════════════════════════════════════════════

class Favorite(Base):
    
    __tablename__ = "favorites"

    id         = Column(Integer,  primary_key=True, autoincrement=True)
    user_id    = Column(Integer,  ForeignKey("users.id", ondelete="CASCADE"),
                        nullable=False, index=True)
    book_id    = Column(Integer,  nullable=False, index=True,
                        comment="CSV book_id from books_genre.csv")
    created_at = Column(DateTime, nullable=False, default=datetime.utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "book_id", name="uq_favorite_user_book"),
    )

    user = relationship("User", backref="favorites")

    def __repr__(self) -> str:
        return f"<Favorite user={self.user_id} book={self.book_id}>"
    
#ratings
class Rating(Base):
    """
    Stores user ratings for books.
    Each user can rate a book ONLY ONCE (enforced by unique constraint).
    """
    __tablename__ = "ratings"
 
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    book_id = Column(Integer, ForeignKey("books.id"), nullable=False)
    rating = Column(Integer, nullable=False)          # value: 1 to 5
    review = Column(Text, nullable=True)              # optional text review
    timestamp = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
 
    # Relationships (so you can do rating.user or rating.book)
    user = relationship("User", back_populates="reviews")
    book = relationship("Book", back_populates="reviews")
 
    # UNIQUE CONSTRAINT: one user → one rating per book
    __table_args__ = (
        UniqueConstraint("user_id", "book_id", name="unique_user_book_rating"),
    )
 
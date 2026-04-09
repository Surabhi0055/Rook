import os
from datetime import datetime, timedelta, timezone
from typing import Optional

from dotenv import load_dotenv
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import jwt
from jwt.exceptions import ExpiredSignatureError, PyJWTError
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from database import AsyncSessionLocal

load_dotenv()

# ─────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────

# Clean up environment variables to remove any hidden newlines or spaces
SECRET_KEY = str(os.getenv("JWT_SECRET_KEY") or "3e584f23e429738c82d92167732a6889eb205f0370fabb3f905540447385a498").strip()
ALGORITHM  = "HS256"  # Hardcoded to bypass environment corruption (HS256\n)

ACCESS_TOKEN_EXPIRE_MINUTES = int(str(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES") or "10080").strip())
REFRESH_TOKEN_EXPIRE_DAYS   = int(str(os.getenv("REFRESH_TOKEN_EXPIRE_DAYS") or "30").strip())


if not SECRET_KEY:
    raise RuntimeError(
        "JWT_SECRET_KEY is not set in your .env file.\n"
        "Generate one with:  openssl rand -hex 32"
    )
if ACCESS_TOKEN_EXPIRE_MINUTES <= 0:
    raise RuntimeError(
        "ACCESS_TOKEN_EXPIRE_MINUTES must be set to a positive integer in .env\n"
        "Example: ACCESS_TOKEN_EXPIRE_MINUTES=60"
    )
if REFRESH_TOKEN_EXPIRE_DAYS <= 0:
    raise RuntimeError(
        "REFRESH_TOKEN_EXPIRE_DAYS must be set to a positive integer in .env\n"
        "Example: REFRESH_TOKEN_EXPIRE_DAYS=30"
    )

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security    = HTTPBearer()


import bcrypt

# ─────────────────────────────────────────────
# PASSWORD
# ─────────────────────────────────────────────

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt()
    pwd_bytes = password.encode('utf-8')
    hashed = bcrypt.hashpw(pwd_bytes, salt)
    return hashed.decode('utf-8')


def verify_password(plain: str, hashed: str) -> bool:
    if not hashed:
        return False
    # Backward compatibility: ensure it handles bytes
    plain_bytes = plain.encode('utf-8')
    hashed_bytes = hashed.encode('utf-8')
    try:
        return bcrypt.checkpw(plain_bytes, hashed_bytes)
    except Exception:
        return False



# ─────────────────────────────────────────────
# TOKEN CREATION
# ─────────────────────────────────────────────

def create_access_token(user_id: int) -> str:
    expire  = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "type": "access", "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def create_refresh_token(user_id: int) -> str:
    expire  = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {"sub": str(user_id), "type": "refresh", "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


# ─────────────────────────────────────────────
# TOKEN VALIDATION
# ─────────────────────────────────────────────

def decode_token(token: str, expected_type: Optional[str] = None) -> dict:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])

        if expected_type and payload.get("type") != expected_type:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=f"Expected '{expected_type}' token, got '{payload.get('type')}'",
            )

        return payload

    except ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired",
        )
    except PyJWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )


# ─────────────────────────────────────────────
# CURRENT USER DEPENDENCY
# ─────────────────────────────────────────────

async def _get_db():
    async with AsyncSessionLocal() as session:
        yield session


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(_get_db),
):
    token   = credentials.credentials
    payload = decode_token(token, expected_type="access")
    user_id = int(payload["sub"])

    import models
    result = await db.execute(
        select(models.User).where(models.User.id == user_id)
    )
    user = result.scalar_one_or_none()

    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
        )

    return user


async def get_current_active_user(current_user=Depends(get_current_user)):
    if not current_user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Inactive user",
        )
    return current_user
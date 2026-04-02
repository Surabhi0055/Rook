from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select, delete, or_
from sqlalchemy.ext.asyncio import AsyncSession
import models
import schemas

from auth.google_auth import verify_google_token
from auth.security import (
    create_access_token,       
    create_refresh_token,
    decode_token,
    get_current_active_user,
    hash_password,
    verify_password,
)
from database import AsyncSessionLocal
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from auth.email_auth import store_otp, verify_otp, send_otp_email
security = HTTPBearer()

router = APIRouter(prefix="/auth", tags=["Authentication"])
# ─────────────────────────────────────────────
# DB Dependency
# ─────────────────────────────────────────────

async def get_db():
    async with AsyncSessionLocal() as session:
        yield session

# ─────────────────────────────────────────────
# REGISTER
# ─────────────────────────────────────────────

@router.post("/register", response_model=schemas.TokenResponse, status_code=201)
async def register(body: schemas.RegisterRequest, db: AsyncSession = Depends(get_db)):

    result = await db.execute(
        select(models.User).where(models.User.username == body.username)
    )
    if result.scalar_one_or_none():
        raise HTTPException(409, "Username already exists")

    # allowing duplicate emails which breaks Google OAuth user lookup later.
    if body.email:
        email_check = await db.execute(
            select(models.User).where(models.User.email == body.email)
        )
        if email_check.scalar_one_or_none():
            raise HTTPException(409, "Email already registered")

    user = models.User(
        username=body.username,
        email=body.email,
        hashed_password=hash_password(body.password),
        display_name=body.display_name,
        favourite_genre=body.favourite_genre,
        cf_user_id=body.cf_user_id,
    )

    db.add(user)
    await db.commit()
    await db.refresh(user)

    access  = create_access_token(user.id)
    refresh = create_refresh_token(user.id)

    db.add(models.RefreshToken(
        user_id=user.id,
        token=refresh,
        expires_at=datetime.fromtimestamp(
            decode_token(refresh)["exp"], tz=timezone.utc
        )
    ))
    await db.commit()

    return schemas.TokenResponse(
        access_token=access,
        refresh_token=refresh,
        user=schemas.UserResponse.model_validate(user),
    )

# ─────────────────────────────────────────────
# LOGIN
# ─────────────────────────────────────────────
@router.post("/login", response_model=schemas.TokenResponse)
async def login(body: schemas.LoginRequest, db: AsyncSession = Depends(get_db)):

    result = await db.execute(
        select(models.User).where(
            or_(
                models.User.username == body.identifier,
                models.User.email    == body.identifier,
            )
        )
    )
    user = result.scalar_one_or_none()

    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username/email or password",
        )

    access  = create_access_token(user.id)
    refresh = create_refresh_token(user.id)

    db.add(models.RefreshToken(
        user_id=user.id,
        token=refresh,
        expires_at=datetime.fromtimestamp(
            decode_token(refresh)["exp"], tz=timezone.utc
        )
    ))
    await db.commit()

    return schemas.TokenResponse(
        access_token=access,
        refresh_token=refresh,
        user=schemas.UserResponse.model_validate(user),   # FIX 4
    )

class GoogleLoginRequest(BaseModel):
    id_token: str   # matches frontend: apiPost('/auth/google', { id_token: ... })


@router.post("/google", response_model=schemas.TokenResponse)
async def google_login(body: GoogleLoginRequest, db: AsyncSession = Depends(get_db)):

    user_info = verify_google_token(body.id_token)
    if not user_info:
        raise HTTPException(status_code=400, detail="Invalid or expired Google token")

    email = user_info.get("email")
    name  = user_info.get("name", "")

    if not email:
        raise HTTPException(status_code=400, detail="Google account has no email address")

    # Find existing user by email, or create a new one
    result = await db.execute(
        select(models.User).where(models.User.email == email)
    )
    user = result.scalar_one_or_none()

    is_new_user = False
    if not user:
        is_new_user = True

        # Derive a unique username from the email prefix
        base     = email.split("@")[0].replace(".", "_")[:40]
        username = base
        suffix   = 1
        while True:
            clash = await db.execute(
                select(models.User).where(models.User.username == username)
            )
            if not clash.scalar_one_or_none():
                break
            username = f"{base}_{suffix}"
            suffix  += 1

        user = models.User(
            username=username,
            email=email,
            display_name=name or username,
            hashed_password="",   # no password for OAuth-only accounts
            is_active=True,
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    access  = create_access_token(user.id)
    refresh = create_refresh_token(user.id)

    db.add(models.RefreshToken(
        user_id=user.id,
        token=refresh,
        expires_at=datetime.fromtimestamp(
            decode_token(refresh)["exp"], tz=timezone.utc
        )
    ))
    await db.commit()

    # is_new_user lets the frontend show "Welcome!" vs "Welcome back!"
    return {
        "access_token":  access,
        "refresh_token": refresh,
        "token_type":    "bearer",
        "user":          schemas.UserResponse.model_validate(user),
        "is_new_user":   is_new_user,
    }
# ─────────────────────────────────────────────
# REFRESH TOKEN
# ─────────────────────────────────────────────
@router.post("/refresh", response_model=schemas.AccessTokenResponse)
async def refresh_token(data: schemas.RefreshRequest):
    payload          = decode_token(data.refresh_token, expected_type="refresh")
    new_access_token = create_access_token(int(payload["sub"]))
    return {"access_token": new_access_token, "token_type": "bearer"}
# ─────────────────────────────────────────────
# ME
# ─────────────────────────────────────────────

@router.get("/me", response_model=schemas.UserResponse)
async def me(current_user=Depends(get_current_active_user)):
    return schemas.UserResponse.model_validate(current_user)   # FIX 4

# ─────────────────────────────────────────────
# CHANGE PASSWORD
# ─────────────────────────────────────────────
class ChangePasswordBody(BaseModel):
    current_password: str
    new_password: str

@router.post("/change-password", response_model=schemas.TokenResponse)
async def change_password(
    body: ChangePasswordBody,
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: AsyncSession = Depends(get_db),          # ONE session for everything
):
    # 1. Decode token manually using THIS endpoint's db session
    from auth.security import decode_token, verify_password, hash_password, \
                              create_access_token, create_refresh_token, security

    token   = credentials.credentials
    payload = decode_token(token, expected_type="access")
    user_id = int(payload["sub"])

    # 2. Load user from THIS session (not security.py's separate session)
    result = await db.execute(
        select(models.User).where(models.User.id == user_id)
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=403, detail="Inactive user")

    # 3. Verify current password
    if not verify_password(body.current_password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password incorrect")

    # 4. Validate new password
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="New password must be at least 8 characters")
    if body.current_password == body.new_password:
        raise HTTPException(status_code=400, detail="New password must differ from current password")

    # 5. Update password — user is attached to db (this session), so commit works
    user.hashed_password = hash_password(body.new_password)
    await db.flush()   

    # 6. Invalidate all old refresh tokens in SAME session
    await db.execute(
        delete(models.RefreshToken).where(
            models.RefreshToken.user_id == user.id
        )
    )
    access  = create_access_token(user.id)
    refresh = create_refresh_token(user.id)

    db.add(models.RefreshToken(
        user_id=user.id,
        token=refresh,
        expires_at=datetime.fromtimestamp(
            decode_token(refresh)["exp"], tz=timezone.utc
        )
    ))

    await db.commit()         
    await db.refresh(user)     

    return schemas.TokenResponse(
        access_token=access,
        refresh_token=refresh,
        user=schemas.UserResponse.model_validate(user),
    )
# FORGOT PASSWORD

class ForgotPasswordRequest(BaseModel):
    email: str

@router.post("/forgot-password/request")
async def forgot_password_request(
    body: ForgotPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(models.User).where(models.User.email == body.email.lower().strip())
    )
    user = result.scalar_one_or_none()

    if user:
        otp = store_otp(body.email)
        try:
            await send_otp_email(body.email, otp, user.username)
        except Exception as e:
            print(f"[email] Failed to send OTP: {e}")
            raise HTTPException(500, "Failed to send email. Check your GMAIL credentials.")

    # Always return 200 — never reveal if email exists
    return {"message": "If that email is registered, a code has been sent."}

class VerifyOTPRequest(BaseModel):
    email: str
    otp: str

@router.post("/forgot-password/verify")
async def forgot_password_verify(body: VerifyOTPRequest):
    if not verify_otp(body.email, body.otp):
        raise HTTPException(400, "Invalid or expired code. Please request a new one.")
   
    from auth.email_auth import _otp_store
    _otp_store[body.email.lower() + ":verified"] = True
    return {"message": "Code verified. You may now set a new password."}

# FORGOT PASSWORD — Step 3: Set new password
class ResetPasswordRequest(BaseModel):
    email: str
    new_password: str

@router.post("/forgot-password/reset", response_model=schemas.TokenResponse)
async def forgot_password_reset(
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_db),
):
    from auth.email_auth import _otp_store

    # Check verified marker
    key = body.email.lower() + ":verified"
    if not _otp_store.pop(key, False):
        raise HTTPException(400, "Please verify your OTP first before resetting password.")

    if len(body.new_password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")

    result = await db.execute(
        select(models.User).where(models.User.email == body.email.lower().strip())
    )
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found.")

    # Update password
    user.hashed_password = hash_password(body.new_password)
    await db.flush()

    # Invalidate all old refresh tokens
    await db.execute(
        delete(models.RefreshToken).where(models.RefreshToken.user_id == user.id)
    )
    # Issue fresh tokens — user is logged in immediately after reset
    access  = create_access_token(user.id)
    refresh = create_refresh_token(user.id)
    db.add(models.RefreshToken(
        user_id=user.id,
        token=refresh,
        expires_at=datetime.fromtimestamp(
            decode_token(refresh)["exp"], tz=timezone.utc
        )
    ))

    await db.commit()
    await db.refresh(user)

    return schemas.TokenResponse(
        access_token=access,
        refresh_token=refresh,
        user=schemas.UserResponse.model_validate(user),
    )

@router.put("/me", response_model=schemas.UserResponse)
async def update_profile(
    body: schemas.UserUpdate,
    db: AsyncSession = Depends(get_db),
    current_user = Depends(get_current_active_user),
):
    if body.display_name is not None:
        current_user.display_name = body.display_name

    if body.email is not None:
        current_user.email = body.email

    if body.favourite_genre is not None:
        current_user.favourite_genre = body.favourite_genre

    if body.image_url is not None:
        current_user.image_url = body.image_url  

    await db.commit()
    await db.refresh(current_user)

    return schemas.UserResponse.model_validate(current_user)
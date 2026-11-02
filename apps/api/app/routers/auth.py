from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..database import get_db
from ..dependencies import current_user
from ..models import RefreshToken, User
from ..schemas import AuthRequest, RefreshRequest, TokenResponse, UserResponse
from ..security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    hash_refresh_token,
    verify_password,
)

router = APIRouter(prefix="/api/v1/auth", tags=["authentication"])


def serialize_user(user: User) -> UserResponse:
    return UserResponse(id=str(user.id), email=user.email, created_at=user.created_at)


async def issue_tokens(db: AsyncSession, user: User) -> TokenResponse:
    access_token = create_access_token(user.id, user.email)
    refresh_token, token_hash, expires_at = create_refresh_token()
    db.add(RefreshToken(id=uuid4(), user_id=user.id, token_hash=token_hash, expires_at=expires_at))
    await db.commit()
    settings = get_settings()
    return TokenResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_in=settings.access_token_minutes * 60,
        user=serialize_user(user),
    )


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
async def signup(payload: AuthRequest, db: AsyncSession = Depends(get_db)):
    email = str(payload.email).strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    if result.scalar_one_or_none():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account already exists with this email.")
    user = User(email=email, password_hash=hash_password(payload.password))
    db.add(user)
    await db.flush()
    return await issue_tokens(db, user)


@router.post("/signin", response_model=TokenResponse)
async def signin(payload: AuthRequest, db: AsyncSession = Depends(get_db)):
    email = str(payload.email).strip().lower()
    result = await db.execute(select(User).where(User.email == email))
    user = result.scalar_one_or_none()
    if user is None or not user.is_active or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="The email or password is incorrect.")
    return await issue_tokens(db, user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    token_hash = hash_refresh_token(payload.refresh_token)
    result = await db.execute(
        select(RefreshToken).where(
            RefreshToken.token_hash == token_hash,
            RefreshToken.revoked_at.is_(None),
        )
    )
    session = result.scalar_one_or_none()
    if session is None or session.expires_at <= datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Refresh token is invalid or expired.")

    user_result = await db.execute(select(User).where(User.id == session.user_id, User.is_active.is_(True)))
    user = user_result.scalar_one_or_none()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive.")

    session.revoked_at = datetime.now(timezone.utc)
    await db.flush()
    return await issue_tokens(db, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout(payload: RefreshRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(payload.refresh_token)))
    session = result.scalar_one_or_none()
    if session:
        session.revoked_at = datetime.now(timezone.utc)
        await db.commit()


@router.get("/me", response_model=UserResponse)
async def me(user: User = Depends(current_user)):
    return serialize_user(user)

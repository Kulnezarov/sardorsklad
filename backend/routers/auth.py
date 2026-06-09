import os

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from dependencies import get_current_user
from security import create_access_token, hash_password, verify_password
from services.public_rate_limit import check_rate_limit, client_ip

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

ALLOW_OPEN_REGISTRATION = os.getenv("ALLOW_OPEN_REGISTRATION", "false").lower() == "true"

_LOGIN_RATE = int(os.getenv("LOGIN_RATE_LIMIT", "10"))
_LOGIN_WINDOW = int(os.getenv("LOGIN_RATE_WINDOW_SEC", "300"))


@router.post("/register", response_model=schemas.AuthTokenResponse)
def register(payload: schemas.UserRegister, db: Session = Depends(get_db)):
    if not ALLOW_OPEN_REGISTRATION:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Регистрация отключена (ALLOW_OPEN_REGISTRATION=false)",
        )
    existing = db.query(models.User).filter(models.User.email == payload.email.lower()).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email уже зарегистрирован")

    user = models.User(
        email=payload.email.lower(),
        hashed_password=hash_password(payload.password),
        full_name=payload.full_name,
        role="manager",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user_id=user.id, email=user.email)
    return schemas.AuthTokenResponse(
        access_token=token,
        user=schemas.UserPublic.model_validate(user),
    )


@router.post("/login", response_model=schemas.AuthTokenResponse)
def login(payload: schemas.UserLogin, request: Request, db: Session = Depends(get_db)):
    # Лимит попыток по IP + email — защита от онлайн-перебора паролей.
    ip = client_ip(request)
    if not check_rate_limit("login", f"{ip}:{payload.email.lower()}", _LOGIN_RATE, _LOGIN_WINDOW):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Слишком много попыток входа. Попробуйте позже.",
        )
    user = db.query(models.User).filter(models.User.email == payload.email.lower()).first()
    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Неверный email или пароль",
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Учётная запись отключена")

    token = create_access_token(user_id=user.id, email=user.email)
    return schemas.AuthTokenResponse(
        access_token=token,
        user=schemas.UserPublic.model_validate(user),
    )


@router.get("/me", response_model=schemas.UserPublic)
def me(current: models.User = Depends(get_current_user)):
    return schemas.UserPublic.model_validate(current)


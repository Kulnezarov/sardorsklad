import os

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from dependencies import get_current_user
from security import create_access_token, hash_password, verify_password

router = APIRouter(prefix="/api/v1/auth", tags=["auth"])

ALLOW_OPEN_REGISTRATION = os.getenv("ALLOW_OPEN_REGISTRATION", "true").lower() == "true"


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
def login(payload: schemas.UserLogin, db: Session = Depends(get_db)):
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


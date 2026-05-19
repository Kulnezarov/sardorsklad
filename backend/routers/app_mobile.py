"""Публичные настройки мобильного приложения (версия, обновление)."""

import os

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

import models
from database import get_db
from routers.settings import get_or_create_settings

router = APIRouter(prefix="/api/v1/app", tags=["app"])


@router.get("/config")
def get_mobile_app_config(db: Session = Depends(get_db)):
    """Без авторизации — проверка версии до/после входа."""
    settings = get_or_create_settings(db)
    min_ver = (
        getattr(settings, "mobile_min_app_version", None)
        or os.getenv("MOBILE_MIN_APP_VERSION", "1.0.0")
    )
    force = bool(getattr(settings, "mobile_force_update", False))
    if os.getenv("MOBILE_FORCE_UPDATE", "").lower() in ("1", "true", "yes"):
        force = True
    store_url = (
        getattr(settings, "mobile_store_url", None)
        or os.getenv("MOBILE_STORE_URL")
        or ""
    )
    return {
        "min_app_version": str(min_ver),
        "force_update": force,
        "store_url": store_url,
        "api_version": 1,
    }

"""Password hashing and JWT helpers."""
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from zoneinfo import ZoneInfo

from jose import JWTError, jwt
from passlib.context import CryptContext

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

_DEFAULT_SECRET = "change-me-in-production"
SECRET_KEY = os.getenv("SECRET_KEY", _DEFAULT_SECRET)
_ENVIRONMENT = os.getenv("ENVIRONMENT", "development").strip().lower()

# В проде запрещаем дефолтный/слабый ключ — иначе можно подделать JWT и получить доступ админа.
if _ENVIRONMENT == "production" and (SECRET_KEY == _DEFAULT_SECRET or len(SECRET_KEY) < 32):
    raise RuntimeError(
        "SECRET_KEY обязателен в production и должен быть длиной не менее 32 символов. "
        "Сгенерируйте: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
    )

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", str(60 * 24 * 7)))


def _next_auth_expiry_utc() -> datetime:
    """Следующий момент «сброса сессии» (по умолчанию каждый день 00:03 в AUTH_SESSION_TZ)."""
    tz_name = os.getenv("AUTH_SESSION_TZ", "Asia/Tashkent")
    hour = int(os.getenv("AUTH_SESSION_RESET_HOUR", "0"))
    minute = int(os.getenv("AUTH_SESSION_RESET_MINUTE", "3"))
    tz = ZoneInfo(tz_name)
    now = datetime.now(tz)
    cand = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if now >= cand:
        cand = cand + timedelta(days=1)
    return cand.astimezone(timezone.utc)


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(*, user_id: int, email: str) -> str:
    if os.getenv("AUTH_SESSION_DAILY_RESET", "true").lower() in ("1", "true", "yes"):
        expire = _next_auth_expiry_utc()
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "email": email, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[dict[str, Any]]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None

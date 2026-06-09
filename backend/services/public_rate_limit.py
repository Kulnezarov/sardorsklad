"""Простой лимит запросов по IP (in-memory, на воркер uvicorn).

Для нескольких воркеров/реплик вынесите счётчики в Redis. Здесь — базовая защита
от перебора и спама на публичных и auth-эндпоинтах.
"""
import os
import time
from collections import defaultdict
from threading import Lock

from fastapi import Request

_lock = Lock()
_buckets: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))

MAX_PER_WINDOW = int(os.getenv("PUBLIC_ORDER_RATE_LIMIT", "30"))
WINDOW_SEC = int(os.getenv("PUBLIC_ORDER_RATE_WINDOW_SEC", "60"))

# Заголовок, который выставляет ТОЛЬКО доверенный обратный прокси (Caddy/nginx).
# X-Forwarded-For клиент может подделать, поэтому по умолчанию читаем X-Real-IP.
_TRUSTED_PROXY_HEADER = os.getenv("TRUSTED_PROXY_HEADER", "x-real-ip").lower()
_TRUST_PROXY = os.getenv("TRUST_PROXY", "true").strip().lower() in ("1", "true", "yes")


def client_ip(request: Request) -> str:
    """IP клиента с учётом доверенного прокси-заголовка (без слепого доверия X-Forwarded-For)."""
    if _TRUST_PROXY:
        val = request.headers.get(_TRUSTED_PROXY_HEADER)
        if val:
            return val.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def _check(bucket: str, key: str, max_per_window: int, window_sec: int) -> bool:
    if not key:
        key = "unknown"
    now = time.time()
    cutoff = now - window_sec
    with _lock:
        lst = _buckets[bucket][key]
        lst[:] = [t for t in lst if t > cutoff]
        if len(lst) >= max_per_window:
            return False
        lst.append(now)
        return True


def check_public_order_rate_limit(client_ip_value: str) -> bool:
    """True — запрос разрешён; False — превышен лимит на создание заказа."""
    return _check("order", client_ip_value, MAX_PER_WINDOW, WINDOW_SEC)


def check_rate_limit(bucket: str, key: str, max_per_window: int, window_sec: int = 60) -> bool:
    """Универсальная проверка лимита (логин, поиск заказа и т.д.)."""
    return _check(bucket, key, max_per_window, window_sec)

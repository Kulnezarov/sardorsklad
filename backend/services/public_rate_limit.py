"""Простой лимит запросов по IP для публичного POST /orders (in-memory, один воркер uvicorn)."""
import os
import time
from collections import defaultdict
from threading import Lock

_lock = Lock()
_window: dict[str, list[float]] = defaultdict(list)

MAX_PER_WINDOW = int(os.getenv("PUBLIC_ORDER_RATE_LIMIT", "30"))
WINDOW_SEC = int(os.getenv("PUBLIC_ORDER_RATE_WINDOW_SEC", "60"))


def check_public_order_rate_limit(client_ip: str) -> bool:
    """
    Возвращает True, если запрос разрешён; False — превышен лимит.
    """
    if not client_ip or client_ip == "unknown":
        client_ip = "unknown"
    now = time.time()
    cutoff = now - WINDOW_SEC
    with _lock:
        lst = _window[client_ip]
        lst[:] = [t for t in lst if t > cutoff]
        if len(lst) >= MAX_PER_WINDOW:
            return False
        lst.append(now)
        return True

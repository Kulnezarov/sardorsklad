"""
Клиентские уведомления: абстракция с идемпотентностью.
Если нет настроенного провайдера (Telegram/SMS) — status=no_provider, событие сохранено.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from urllib.parse import quote_plus
from urllib.request import urlopen

import models
from config.logger import setup_logger
from sqlalchemy.orm import Session

logger = setup_logger("customer_notifications")

REASON_TITLES_RU: dict[str, str] = {
    "wrong_product": "неверно указан товар",
    "not_paid": "неоплата / неподтверждение оплаты",
    "invalid_contact_data": "некорректные контакты",
    "not_reachable": "не удалось связаться",
    "out_of_stock": "нет в наличии",
    "client_refused": "клиент отказался",
    "duplicate": "дубль заказа",
    "other": "другое",
}


def _build_cancel_message(order: models.Reserve) -> str:
    code = (order.cancellation_reason_code or "").strip()
    title = REASON_TITLES_RU.get(code, code or "—")
    extra = (order.cancellation_comment or "").strip()
    body = f"ℹ️ Сообщение о заказе {order.order_code} (id {order.id}): отмена."
    body += f"\nПричина: {title}"
    if code == "other" and extra:
        body += f"\nКомментарий: {extra}"
    return body


def _send_telegram_message(token: str, chat_id: str, text: str) -> None:
    url = f"https://api.telegram.org/bot{token}/sendMessage?chat_id={quote_plus(chat_id)}&text={quote_plus(text)}"
    with urlopen(url, timeout=12) as r:
        payload = json.loads(r.read().decode("utf-8"))
        if not payload.get("ok"):
            raise RuntimeError(payload.get("description", "telegram error"))


def notify_order_cancelled(db: Session, order: models.Reserve) -> models.CustomerNotificationEvent:
    idem = f"order_cancelled:reserve_{order.id}"
    existing = (
        db.query(models.CustomerNotificationEvent)
        .filter(models.CustomerNotificationEvent.idempotency_key == idem)
        .first()
    )
    if existing:
        return existing

    text = _build_cancel_message(order)
    ev = models.CustomerNotificationEvent(
        reserve_id=order.id,
        event_type="order_cancelled",
        idempotency_key=idem,
        provider="telegram" if os.getenv("CUSTOMER_NOTIFY_TELEGRAM_CHAT_ID", "").strip() else None,
        status="pending",
        payload_json={"message": text},
    )
    db.add(ev)
    db.flush()

    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chat = os.getenv("CUSTOMER_NOTIFY_TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat:
        ev.status = "no_provider"
        ev.error_message = "no CUSTOMER_NOTIFY_TELEGRAM_CHAT_ID or TELEGRAM_BOT_TOKEN"
        return ev
    try:
        _send_telegram_message(token, chat, text)
        ev.status = "sent"
        ev.sent_at = datetime.now(timezone.utc)
    except Exception as e:
        logger.warning("Customer cancel notification failed: %s", e)
        ev.status = "failed"
        ev.error_message = str(e)[:2000]
    return ev

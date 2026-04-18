import json
import os
from datetime import datetime, timezone
from urllib.parse import quote_plus
from urllib.request import urlopen

import models
from config.logger import setup_logger
from sqlalchemy.orm import Session

logger = setup_logger("telegram_orders")


def _chat_ids() -> list[str]:
    raw = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    if not raw:
        return []
    return [c.strip() for c in raw.split(",") if c.strip()]


def _send_message(token: str, chat_id: str, text: str) -> None:
    url = f"https://api.telegram.org/bot{token}/sendMessage?chat_id={quote_plus(chat_id)}&text={quote_plus(text)}"
    with urlopen(url, timeout=12) as r:
        payload = json.loads(r.read().decode("utf-8"))
        if not payload.get("ok"):
            raise RuntimeError(payload.get("description", "telegram error"))


def _build_order_text(order: models.Reserve, admin_base_url: str) -> str:
    lines = [
        "🛒 Новый заказ",
        f"ID: #{order.id}",
        f"Дата: {datetime.now(timezone.utc).astimezone().strftime('%Y-%m-%d %H:%M')}",
        f"Клиент: {order.customer_name}",
        f"Телефон: {order.customer_phone or '-'}",
        "",
        "Позиции:",
    ]
    for item in order.items:
        unit = item.sale_price_snapshot or item.price_kzt or 0
        qty = item.quantity or item.quantity_ordered
        lines.append(f"- {item.product_name} × {qty} = {item.line_total or 0} ₸ (цена {unit} ₸)")
    lines.extend(
        [
            "",
            f"Сумма: {order.total_amount or order.total_amount_kzt} ₸",
            f"Карточка: {admin_base_url.rstrip('/')}/orders/{order.id}",
        ]
    )
    return "\n".join(lines)


def send_new_order_notification(db: Session, order: models.Reserve) -> None:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chats = _chat_ids()
    if not token or not chats:
        return

    message = _build_order_text(order, os.getenv("ADMIN_BASE_URL", "https://sklad.kz"))
    notif = models.TelegramNotification(
        reserve_id=order.id,
        notification_type="new_order",
        payload_json={"text": message, "chat_ids": chats},
        status="pending",
    )
    db.add(notif)
    db.commit()
    db.refresh(notif)

    try:
        for chat_id in chats:
            _send_message(token, chat_id, message)
        notif.status = "sent"
        notif.sent_at = datetime.utcnow()
        notif.error_message = None
    except Exception as exc:
        notif.status = "failed"
        notif.error_message = str(exc)[:1000]
        logger.warning("Telegram order notification failed: %s", exc)
    finally:
        notif.attempts += 1
        notif.last_attempt_at = datetime.utcnow()
        db.commit()


def retry_failed_notifications(db: Session, limit: int = 20) -> int:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chats = _chat_ids()
    if not token or not chats:
        return 0

    rows = (
        db.query(models.TelegramNotification)
        .filter(models.TelegramNotification.status == "failed")
        .order_by(models.TelegramNotification.created_at.asc())
        .limit(limit)
        .all()
    )
    sent = 0
    for row in rows:
        try:
            text = (row.payload_json or {}).get("text")
            if not text:
                row.status = "failed"
                row.error_message = "missing payload text"
                continue
            for chat_id in chats:
                _send_message(token, chat_id, text)
            row.status = "sent"
            row.sent_at = datetime.utcnow()
            row.error_message = None
            sent += 1
        except Exception as exc:
            row.status = "failed"
            row.error_message = str(exc)[:1000]
        finally:
            row.attempts += 1
            row.last_attempt_at = datetime.utcnow()
    db.commit()
    return sent

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

    # Каждый chat_id независимо: один неверный ID не должен блокировать остальные.
    errors: list[str] = []
    sent_any = False
    for chat_id in chats:
        try:
            _send_message(token, chat_id, message)
            sent_any = True
        except Exception as exc:
            err = f"{chat_id}: {exc}"
            errors.append(err)
            logger.warning("Telegram send to chat %s failed: %s", chat_id, exc)
    if sent_any and not errors:
        notif.status = "sent"
        notif.sent_at = datetime.utcnow()
        notif.error_message = None
    elif sent_any:
        notif.status = "sent"
        notif.sent_at = datetime.utcnow()
        notif.error_message = "; ".join(errors)[:1000]
    else:
        notif.status = "failed"
        notif.error_message = "; ".join(errors)[:1000] if errors else "unknown"
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
            errs: list[str] = []
            ok_any = False
            for chat_id in chats:
                try:
                    _send_message(token, chat_id, text)
                    ok_any = True
                except Exception as exc:
                    errs.append(f"{chat_id}: {exc}")
                    logger.warning("Telegram retry to chat %s failed: %s", chat_id, exc)
            if ok_any:
                row.status = "sent"
                row.sent_at = datetime.utcnow()
                row.error_message = "; ".join(errs)[:1000] if errs else None
                sent += 1
            else:
                row.status = "failed"
                row.error_message = "; ".join(errs)[:1000] if errs else "send failed"
        except Exception as exc:
            row.status = "failed"
            row.error_message = str(exc)[:1000]
        finally:
            row.attempts += 1
            row.last_attempt_at = datetime.utcnow()
    db.commit()
    return sent

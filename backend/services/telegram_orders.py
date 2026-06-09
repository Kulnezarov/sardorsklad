import json
import os
from datetime import UTC, datetime, timezone
from urllib.parse import quote_plus
from urllib.request import urlopen
from zoneinfo import ZoneInfo

import models
from config.logger import setup_logger
from sqlalchemy.orm import Session, joinedload

logger = setup_logger("telegram_orders")


def _report_tz() -> ZoneInfo:
    name = os.getenv("TELEGRAM_REPORT_TZ", "Asia/Almaty").strip() or "Asia/Almaty"
    return ZoneInfo(name)


def _format_order_datetime(order: models.Reserve) -> str:
    dt = order.created_at or datetime.now(timezone.utc)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(_report_tz()).strftime("%d.%m.%Y %H:%M")


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
        f"Дата: {_format_order_datetime(order)} (Алматы)",
        f"Клиент: {order.customer_name}",
        f"Телефон: {order.customer_phone or '-'}",
        "",
        "Позиции:",
    ]
    for item in order.items:
        st = getattr(item, "line_status", None) or "pending"
        if st == "cancelled":
            continue
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
        notif.sent_at = datetime.now(UTC)
        notif.error_message = None
    elif sent_any:
        notif.status = "sent"
        notif.sent_at = datetime.now(UTC)
        notif.error_message = "; ".join(errors)[:1000]
    else:
        notif.status = "failed"
        notif.error_message = "; ".join(errors)[:1000] if errors else "unknown"
    notif.attempts += 1
    notif.last_attempt_at = datetime.now(UTC)
    db.commit()


def resend_order_notification(db: Session, order: models.Reserve) -> bool:
    """Повторная отправка уведомления по одному заказу (с актуальным текстом)."""
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chats = _chat_ids()
    if not token or not chats:
        return False

    message = _build_order_text(order, os.getenv("ADMIN_BASE_URL", "https://sklad.kz"))
    errors: list[str] = []
    sent_any = False
    for chat_id in chats:
        try:
            _send_message(token, chat_id, message)
            sent_any = True
        except Exception as exc:
            errors.append(f"{chat_id}: {exc}")
            logger.warning("Telegram resend to chat %s failed: %s", chat_id, exc)

    notif = models.TelegramNotification(
        reserve_id=order.id,
        notification_type="new_order_resend",
        payload_json={"text": message, "chat_ids": chats},
        status="sent" if sent_any else "failed",
        sent_at=datetime.now(UTC) if sent_any else None,
        error_message="; ".join(errors)[:1000] if errors else None,
        attempts=1,
        last_attempt_at=datetime.now(UTC),
    )
    db.add(notif)
    db.commit()
    return sent_any


def retry_failed_notifications(db: Session, limit: int = 20, reserve_id: int | None = None) -> int:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    chats = _chat_ids()
    if not token or not chats:
        return 0

    q = db.query(models.TelegramNotification).filter(models.TelegramNotification.status == "failed")
    if reserve_id is not None:
        q = q.filter(models.TelegramNotification.reserve_id == reserve_id)
    rows = q.order_by(models.TelegramNotification.created_at.asc()).limit(limit).all()
    sent = 0
    for row in rows:
        try:
            text = (row.payload_json or {}).get("text")
            if not text and row.reserve_id:
                order = (
                    db.query(models.Reserve)
                    .options(joinedload(models.Reserve.items))
                    .filter(models.Reserve.id == row.reserve_id)
                    .first()
                )
                if order:
                    text = _build_order_text(order, os.getenv("ADMIN_BASE_URL", "https://sklad.kz"))
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
                row.sent_at = datetime.now(UTC)
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
            row.last_attempt_at = datetime.now(UTC)
    db.commit()
    return sent

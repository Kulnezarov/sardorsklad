"""
Ежедневный отчёт в Telegram: продажи за календарный день (выручка, чеки, топ по штукам).
Включение: TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID в окружении.
Токен выдаёт @BotFather; chat_id — после /start у бота (см. docs/telegram-bot.md).
"""
from __future__ import annotations

import html
import os
from typing import Any, Optional
from datetime import datetime, time, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy.orm import Session, joinedload

import models
from config.logger import setup_logger
from database import SessionLocal

# Тот же логгер, что и в main.py — иначе сообщения не видны в docker logs
logger = setup_logger("skladpro")

_scheduler = None


def _money_kzt(v) -> str:
    n = float(v or 0)
    s = f"{n:,.0f}"
    return s.replace(",", " ")


def _report_day_bounds(tz_name: str):
    tz = ZoneInfo(tz_name)
    now = datetime.now(tz)
    day = now.date()
    start = datetime.combine(day, time.min, tzinfo=tz)
    end = start + timedelta(days=1)
    return start, end, day


def build_daily_report_text(db: Session, tz_name: str) -> str:
    start, end, day = _report_day_bounds(tz_name)
    day_label = day.strftime("%d.%m.%Y")

    sales = (
        db.query(models.Sale)
        .options(joinedload(models.Sale.items).joinedload(models.SaleItem.product))
        .filter(models.Sale.created_at >= start, models.Sale.created_at < end)
        .order_by(models.Sale.created_at.asc())
        .all()
    )

    total_revenue = sum((Decimal(str(s.total_amount or 0)) for s in sales), start=Decimal("0"))
    discount_sum = Decimal("0")
    discounted_checks = 0
    for s in sales:
        sub = Decimal(str(s.subtotal_amount or s.total_amount or 0))
        tot = Decimal(str(s.total_amount or 0))
        if s.discount_percent and Decimal(str(s.discount_percent)) > 0 and sub > tot:
            discount_sum += sub - tot
            discounted_checks += 1
    receipts = len(sales)
    total_units = 0
    total_profit = Decimal("0")
    agg: dict[str, dict] = {}

    for sale in sales:
        for item in sale.items:
            qty = int(item.quantity or 0)
            total_units += qty
            unit_price = Decimal(str(item.unit_price or 0))
            sub = Decimal(str(item.subtotal or 0))
            purchase = Decimal("0")
            name = "Неизвестный товар"
            prod = item.product
            if prod is None and item.product_id:
                prod = db.query(models.Product).filter(models.Product.id == item.product_id).first()
            if prod:
                purchase = Decimal(str(prod.purchase_price or 0))
                name = html.escape((prod.name or "—")[:100])
            line_profit = (unit_price - purchase) * qty
            total_profit += line_profit

            if name not in agg:
                agg[name] = {"qty": 0, "subtotal": Decimal("0")}
            agg[name]["qty"] += qty
            agg[name]["subtotal"] += sub

    lines = [
        f"📊 <b>Продажи за {day_label}</b> · SkladPro",
        f"🕐 Часовой пояс: {tz_name}",
        "",
        f"💰 <b>Выручка:</b> {_money_kzt(total_revenue)} ₸",
        f"🏷 <b>Скидки:</b> −{_money_kzt(discount_sum)} ₸ ({discounted_checks} чек.)",
        f"📈 <b>Оценка прибыли:</b> {_money_kzt(total_profit)} ₸",
        f"🧾 <b>Чеков:</b> {receipts}",
        f"📦 <b>Всего единиц (шт):</b> {total_units}",
    ]

    if receipts == 0:
        lines += ["", "<i>За этот день продаж пока нет.</i>"]
        return "\n".join(lines)

    top = sorted(agg.items(), key=lambda x: x[1]["qty"], reverse=True)[:25]
    lines += ["", "<b>Топ по количеству:</b>"]
    for name, v in top:
        lines.append(
            f"• {name} — <b>{v['qty']}</b> шт, {_money_kzt(v['subtotal'])} ₸"
        )

    text = "\n".join(lines)
    if len(text) > 4000:
        text = text[:3990] + "\n…"
    return text


def post_telegram_html_to_chat(
    chat_id: str | int,
    text: str,
    reply_markup: Optional[dict[str, Any]] = None,
) -> bool:
    """Одно сообщение в указанный чат (для ответов на команды бота)."""
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        payload: dict[str, Any] = {
            "chat_id": chat_id,
            "text": text,
            "parse_mode": "HTML",
            "disable_web_page_preview": True,
        }
        if reply_markup is not None:
            payload["reply_markup"] = reply_markup
        r = httpx.post(
            url,
            json=payload,
            timeout=45.0,
        )
        if r.status_code != 200:
            logger.error("Telegram API chat=%s %s: %s", chat_id, r.status_code, r.text[:500])
            return False
        return True
    except Exception as e:
        logger.exception("Telegram send failed: %s", e)
        return False


def send_telegram_html(text: str) -> bool:
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    raw_chats = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    if not token or not raw_chats:
        logger.warning("Telegram: пропуск отправки — нет TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID")
        return False
    chat_ids = [c.strip() for c in raw_chats.split(",") if c.strip()]
    if not chat_ids:
        return False
    ok_all = True
    for chat_id in chat_ids:
        if not post_telegram_html_to_chat(chat_id, text):
            ok_all = False
    return ok_all


def run_daily_report_job():
    if os.getenv("TELEGRAM_DAILY_REPORT", "true").lower() not in ("1", "true", "yes"):
        return
    if not os.getenv("TELEGRAM_BOT_TOKEN", "").strip():
        return

    tz_name = os.getenv("TELEGRAM_REPORT_TZ", "Asia/Almaty")
    db = SessionLocal()
    try:
        text = build_daily_report_text(db, tz_name)
        ok = send_telegram_html(text)
        if ok:
            logger.info("Telegram: ежедневный отчёт отправлен")
    except Exception:
        logger.exception("Telegram: ошибка формирования/отправки отчёта")
    finally:
        db.close()


def setup_telegram_scheduler():
    """Старт APScheduler; вернуть объект или None если бот не настроен."""
    global _scheduler
    if not os.getenv("TELEGRAM_BOT_TOKEN", "").strip():
        logger.info("Telegram: ежедневный отчёт выключен (нет TELEGRAM_BOT_TOKEN)")
        return None
    if not os.getenv("TELEGRAM_CHAT_ID", "").strip():
        logger.warning(
            "Telegram: задайте TELEGRAM_CHAT_ID (или несколько через запятую) — см. docs/telegram-bot.md"
        )
        return None

    from apscheduler.schedulers.background import BackgroundScheduler

    tz_name = os.getenv("TELEGRAM_REPORT_TZ", "Asia/Almaty")
    hour = int(os.getenv("TELEGRAM_REPORT_HOUR", "21"))
    minute = int(os.getenv("TELEGRAM_REPORT_MINUTE", "0"))

    sched = BackgroundScheduler(timezone=tz_name)
    sched.add_job(
        run_daily_report_job,
        "cron",
        hour=hour,
        minute=minute,
        id="skladpro_telegram_daily",
        replace_existing=True,
    )
    sched.start()
    _scheduler = sched
    logger.info(
        "Telegram: планировщик — каждый день в %02d:%02d (%s)",
        hour,
        minute,
        tz_name,
    )
    return sched


def shutdown_telegram_scheduler(sched):
    global _scheduler
    if sched is None:
        return
    try:
        sched.shutdown(wait=False)
    except Exception as e:
        logger.warning("Telegram scheduler shutdown: %s", e)
    _scheduler = None

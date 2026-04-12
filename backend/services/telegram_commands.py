"""
Команды бота в Telegram (long polling): склад, категории, поиск, отчёт за сегодня.
Если chat_id не совпал с TELEGRAM_CHAT_ID — на /help и др. команды приходит подсказка с вашим id.
"""
from __future__ import annotations

import html
import os
import threading
import time
from typing import Optional, Set

import httpx
from sqlalchemy import func, or_

import models
from database import SessionLocal
from config.logger import setup_logger
from services.telegram_daily import build_daily_report_text, post_telegram_html_to_chat

logger = setup_logger("skladpro")

_poller_thread: Optional[threading.Thread] = None
_stop = threading.Event()


def _allowed_chat_ids() -> Set[int]:
    out: Set[int] = set()
    raw = os.getenv("TELEGRAM_CHAT_ID", "").strip()
    for part in raw.split(","):
        part = part.strip().strip("\ufeff")
        if not part:
            continue
        try:
            out.add(int(part))
        except ValueError:
            logger.warning("Telegram commands: пропуск неверного chat_id в TELEGRAM_CHAT_ID: %r", part)
    return out


def _split_html_chunks(text: str, limit: int = 3800) -> list[str]:
    if len(text) <= limit:
        return [text]
    chunks = []
    rest = text
    while rest:
        if len(rest) <= limit:
            chunks.append(rest)
            break
        cut = rest.rfind("\n", 0, limit)
        if cut < limit // 2:
            cut = limit
        chunks.append(rest[:cut])
        rest = rest[cut:].lstrip("\n")
    return chunks


def _reply(chat_id: int, text: str) -> None:
    for chunk in _split_html_chunks(text):
        if not post_telegram_html_to_chat(chat_id, chunk):
            logger.error("Telegram: sendMessage не удался (chat_id=%s)", chat_id)
        time.sleep(0.05)


def _reply_wrong_chat_onboarding(chat_id: int, allowed: Set[int]) -> None:
    """Подсказка, если TELEGRAM_CHAT_ID не совпал или список пуст."""
    listed = ", ".join(str(x) for x in sorted(allowed)) if allowed else "(в .env пусто — задайте TELEGRAM_CHAT_ID)"
    text = (
        "<b>SkladPro</b>\n\n"
        f"Ваш <code>chat_id</code>: <code>{chat_id}</code>\n\n"
        "Вставьте <b>именно это число</b> в <code>TELEGRAM_CHAT_ID</code> в файле "
        "<code>backend/.env</code> на сервере (без пробелов и кавычек). "
        "Несколько чатов — через запятую.\n\n"
        f"Сейчас в доступе числа: {html.escape(listed)}\n\n"
        "Затем: <code>docker compose … up -d backend</code> (перезапуск backend)."
    )
    _reply(chat_id, text)


def _cmd_help() -> str:
    return (
        "<b>SkladPro — команды</b>\n\n"
        "/отчет — продажи и прибыль за сегодня (по часовому поясу из настроек)\n"
        "/категории — список категорий и остатки\n"
        "/кат название — товары в категории (часть названия)\n"
        "/поиск текст — поиск по имени или артикулу (SKU)\n"
        "/help — это сообщение"
    )


def _handle_categories(db) -> str:
    rows = (
        db.query(
            models.Product.category,
            func.count(models.Product.id),
            func.coalesce(func.sum(models.Product.quantity), 0),
        )
        .filter(models.Product.is_active == True)
        .group_by(models.Product.category)
        .order_by(func.count(models.Product.id).desc())
        .all()
    )
    lines = ["<b>Категории на складе</b>\n"]
    if not rows:
        return "<i>Нет активных товаров.</i>"
    for cat, cnt, qty in rows:
        label = html.escape(str(cat or "Без категории"))
        lines.append(f"• {label} — <b>{int(qty or 0)}</b> шт, позиций: {cnt}")
    return "\n".join(lines)


def _sanitize_like(s: str, max_len: int = 80) -> str:
    """Убираем символы шаблона LIKE."""
    s = (s or "").strip()[:max_len]
    return "".join(c for c in s if c not in "%_")


def _handle_cat(db, arg: str) -> str:
    arg = _sanitize_like(arg)
    if len(arg) < 1:
        return "Укажите категорию: <code>/кат фильтр</code>"

    q = (
        db.query(models.Product.category)
        .filter(
            models.Product.is_active == True,
            models.Product.category.isnot(None),
            models.Product.category.ilike(f"%{arg}%"),
        )
        .distinct()
        .limit(8)
        .all()
    )
    cats = [r[0] for r in q if r[0]]
    if not cats:
        return f"<i>Категории по «{html.escape(arg)}» не найдены.</i>"
    if len(cats) > 1:
        clist = "\n".join(f"• {html.escape(c)}" for c in cats)
        return f"Несколько совпадений, уточните:\n{clist}"

    cat = cats[0]
    prods = (
        db.query(models.Product)
        .filter(
            models.Product.is_active == True,
            models.Product.category == cat,
        )
        .order_by(models.Product.name.asc())
        .limit(45)
        .all()
    )
    lines = [f"<b>{html.escape(cat)}</b>\n"]
    for p in prods:
        nm = html.escape((p.name or "—")[:80])
        sku = html.escape(str(p.sku or ""))
        lines.append(f"• {nm} — <b>{int(p.quantity or 0)}</b> шт, SKU: <code>{sku}</code>")
    if len(prods) >= 45:
        lines.append("\n<i>Показаны первые 45 позиций.</i>")
    return "\n".join(lines)


def _handle_search(db, arg: str) -> str:
    arg = _sanitize_like(arg, max_len=120)
    if len(arg) < 2:
        return "Минимум 2 символа: <code>/поиск 123</code>"

    like = f"%{arg}%"
    prods = (
        db.query(models.Product)
        .filter(
            models.Product.is_active == True,
            or_(models.Product.name.ilike(like), models.Product.sku.ilike(like)),
        )
        .order_by(models.Product.quantity.desc())
        .limit(25)
        .all()
    )
    if not prods:
        return f"<i>По запросу «{html.escape(arg)}» ничего не найдено.</i>"
    lines = [f"<b>Поиск:</b> {html.escape(arg)}\n"]
    for p in prods:
        nm = html.escape((p.name or "—")[:70])
        cat = html.escape(str(p.category or "—"))
        lines.append(
            f"• {nm}\n  <b>{int(p.quantity or 0)}</b> шт · {cat} · SKU <code>{html.escape(str(p.sku or ''))}</code>"
        )
    return "\n".join(lines)


def _parse_command(text: str) -> tuple[str, str]:
    t = (text or "").strip()
    if not t.startswith("/"):
        return "", ""
    parts = t.split(maxsplit=1)
    cmd = parts[0].split("@")[0].lower()
    arg = parts[1].strip() if len(parts) > 1 else ""
    return cmd, arg


def _dispatch(chat_id: int, text: str) -> None:
    cmd, arg = _parse_command(text)
    if not cmd:
        return

    aliases = {
        "/start": "/help",
        "/help": "/help",
        "/?": "/help",
        "/отчет": "/report",
        "/отчёт": "/report",
        "/report": "/report",
        "/сегодня": "/report",
        "/категории": "/categories",
        "/categories": "/categories",
        "/кат": "/cat",
        "/cat": "/cat",
        "/поиск": "/search",
        "/search": "/search",
    }
    cmd = aliases.get(cmd, cmd)

    db = SessionLocal()
    try:
        if cmd in ("/help",):
            _reply(chat_id, _cmd_help())
            return
        if cmd in ("/report",):
            tz_name = os.getenv("TELEGRAM_REPORT_TZ", "Asia/Almaty")
            body = build_daily_report_text(db, tz_name)
            _reply(chat_id, body)
            return
        if cmd in ("/categories",):
            _reply(chat_id, _handle_categories(db))
            return
        if cmd in ("/cat",):
            _reply(chat_id, _handle_cat(db, arg))
            return
        if cmd in ("/search",):
            _reply(chat_id, _handle_search(db, arg))
            return
        _reply(chat_id, "Неизвестная команда. /help")
    except Exception:
        logger.exception("Telegram command dispatch error")
        _reply(chat_id, "<b>Ошибка</b> при обработке команды. Попробуйте позже.")
    finally:
        db.close()


def _poll_loop():
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        return

    base = f"https://api.telegram.org/bot{token}"
    # Пропускаем накопившиеся апдейты при старте (не обрабатываем старую очередь)
    offset = 0
    try:
        r0 = httpx.get(f"{base}/getUpdates", params={"timeout": 0}, timeout=15.0)
        if r0.status_code == 200 and r0.json().get("ok"):
            upds0 = r0.json().get("result") or []
            if upds0:
                offset = max(u["update_id"] for u in upds0) + 1
    except Exception as e:
        logger.warning("Telegram: не удалось сбросить очередь getUpdates: %s", e)

    logger.info("Telegram: long polling команд запущен")

    while not _stop.is_set():
        allowed = _allowed_chat_ids()
        try:
            r = httpx.get(
                f"{base}/getUpdates",
                params={"offset": offset, "timeout": 30},
                timeout=40.0,
            )
            if r.status_code == 409:
                logger.error(
                    "Telegram getUpdates 409: этот бот уже опрашивается в другом месте "
                    "(второй сервер, скрипт или контейнер). Остановите дубликат — иначе ответов не будет."
                )
                time.sleep(10)
                continue
            if r.status_code != 200:
                logger.warning("Telegram getUpdates: %s %s", r.status_code, r.text[:200])
                time.sleep(3)
                continue
            data = r.json()
            if not data.get("ok"):
                logger.warning("Telegram getUpdates ok=false: %s", data)
                time.sleep(3)
                continue
            for upd in data.get("result", []):
                offset = max(offset, upd["update_id"] + 1)
                msg = upd.get("message") or {}
                chat = msg.get("chat") or {}
                cid = chat.get("id")
                if cid is None:
                    continue
                text = msg.get("text") or ""
                if not text:
                    continue
                cid_int = int(cid)
                if cid_int not in allowed:
                    if text.strip().startswith("/"):
                        logger.info(
                            "Telegram: chat_id=%s не в TELEGRAM_CHAT_ID — отправляю подсказку",
                            cid_int,
                        )
                        _reply_wrong_chat_onboarding(cid_int, allowed)
                    continue
                _dispatch(cid_int, text)
        except Exception as e:
            if not _stop.is_set():
                logger.exception("Telegram poll error: %s", e)
                time.sleep(5)


def setup_telegram_command_poller():
    global _poller_thread
    if os.getenv("TELEGRAM_COMMANDS", "true").lower() not in ("1", "true", "yes"):
        logger.info("Telegram: команды выключены (TELEGRAM_COMMANDS=false)")
        return
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        return

    try:
        r = httpx.get(f"https://api.telegram.org/bot{token}/getMe", timeout=15.0)
        j = r.json()
        if r.status_code != 200 or not j.get("ok"):
            logger.error("Telegram: TELEGRAM_BOT_TOKEN неверен или сеть: %s", r.text[:300])
            return
        un = j.get("result", {}).get("username") or "?"
        logger.info("Telegram: токен ок, бот @%s", un)
    except Exception as e:
        logger.error("Telegram: не удалось вызвать getMe: %s", e)
        return

    allowed = _allowed_chat_ids()
    if not allowed:
        logger.warning(
            "TELEGRAM_CHAT_ID пуст — на любую команду /… бот ответит подсказкой с вашим chat_id; "
            "добавьте id в .env и перезапустите backend."
        )

    if _poller_thread is not None and _poller_thread.is_alive():
        return

    _stop.clear()
    _poller_thread = threading.Thread(target=_poll_loop, name="telegram-commands", daemon=True)
    _poller_thread.start()


def shutdown_telegram_command_poller():
    global _poller_thread
    _stop.set()
    t = _poller_thread
    _poller_thread = None
    if t and t.is_alive():
        t.join(timeout=3.0)
    _stop.clear()

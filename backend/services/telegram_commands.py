"""
Команды бота в Telegram (long polling): кнопки, склад (только просмотр),
«нужно заказать» (wish_items pending), заказы в пути.
Изменение товаров на складе через бота недоступно.
"""
from __future__ import annotations

import html
import os
import threading
import time
from typing import Callable, Dict, Optional, Set

import httpx
from sqlalchemy import desc, func, or_

import models
from config.logger import setup_logger
from database import SessionLocal
from services.telegram_daily import build_daily_report_text, post_telegram_html_to_chat

logger = setup_logger("skladpro")

_poller_thread: Optional[threading.Thread] = None
_stop = threading.Event()

_state_lock = threading.Lock()
_pending_wish_name: Set[int] = set()
_pending_stock_search: Set[int] = set()

# ── Кнопки ReplyKeyboard (точное совпадение текста) ─────────────────────────
BTN_STOCK_CATS = "📦 Категории склада"
BTN_STOCK_SEARCH = "🔍 Поиск по складу"
BTN_WISH_LIST = "📋 Нужно заказать"
BTN_WISH_ADD = "➕ Добавить в список"
BTN_REPORT = "📊 Отчёт за сегодня"
BTN_IN_TRANSIT = "🚚 Заказано / в пути"
BTN_HELP = "ℹ️ Помощь"


def _main_menu_markup() -> dict:
    return {
        "keyboard": [
            [{"text": BTN_STOCK_CATS}, {"text": BTN_STOCK_SEARCH}],
            [{"text": BTN_WISH_LIST}, {"text": BTN_WISH_ADD}],
            [{"text": BTN_REPORT}, {"text": BTN_IN_TRANSIT}],
            [{"text": BTN_HELP}],
        ],
        "resize_keyboard": True,
        "input_field_placeholder": "Кнопки меню или команды /help",
    }


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


def _reply(chat_id: int, text: str, reply_markup: Optional[dict] = None) -> None:
    chunks = _split_html_chunks(text)
    for i, chunk in enumerate(chunks):
        mk = reply_markup if i == len(chunks) - 1 else None
        if not post_telegram_html_to_chat(chat_id, chunk, reply_markup=mk):
            logger.error("Telegram: sendMessage не удался (chat_id=%s)", chat_id)
        time.sleep(0.05)


def _clear_states(chat_id: int) -> None:
    with _state_lock:
        _pending_wish_name.discard(chat_id)
        _pending_stock_search.discard(chat_id)


def _reply_wrong_chat_onboarding(chat_id: int, allowed: Set[int]) -> None:
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


def _welcome_text() -> str:
    return (
        "<b>SkladPro</b>\n\n"
        "Я помогаю смотреть склад и списки заказов.\n\n"
        "• <b>Склад</b> — только просмотр: остатки, закуп ₸, поиск. "
        "<b>Менять товары здесь нельзя</b> (только через сайт).\n"
        "• <b>Нужно заказать</b> — позиции со статусом «ещё не заказано».\n"
        "• <b>Добавить в список</b> — новая строка в «нужно заказать».\n"
        "• <b>Заказано / в пути</b> — заказы у поставщика.\n\n"
        "Выберите кнопку ниже 👇"
    )


def _cmd_help() -> str:
    return (
        "<b>Команды</b> (дублируют кнопки)\n\n"
        "/отчет — продажи за сегодня\n"
        "/категории — категории склада\n"
        "/кат слово — товары категории (закуп + остаток)\n"
        "/поиск текст — по складу\n"
        "/заказать название — в список «нужно заказать»\n"
        "/отмена — сбросить ввод\n"
        "/start — меню с кнопками"
    )


def _fmt_kzt(v) -> str:
    n = float(v or 0)
    return f"{n:,.0f}".replace(",", " ")


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
    lines = ["<b>Категории на складе</b> <i>(только просмотр)</i>\n"]
    if not rows:
        return "<i>Нет активных товаров.</i>"
    for cat, cnt, qty in rows:
        label = html.escape(str(cat or "Без категории"))
        lines.append(f"• {label} — <b>{int(qty or 0)}</b> шт, позиций: {cnt}")
    lines.append("\n<i>Для списка товаров с закупом:</i> <code>/кат название</code>")
    return "\n".join(lines)


def _sanitize_like(s: str, max_len: int = 80) -> str:
    s = (s or "").strip()[:max_len]
    return "".join(c for c in s if c not in "%_")


def _line_product_readonly(p: models.Product) -> str:
    nm = html.escape((p.name or "—")[:75])
    sku = html.escape(str(p.sku or "—"))
    q = int(p.quantity or 0)
    buy = _fmt_kzt(p.purchase_price)
    return f"• {nm}\n  <b>{q}</b> шт · закуп <b>{buy}</b> ₸ · SKU <code>{sku}</code>"


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
        .limit(40)
        .all()
    )
    lines = [f"<b>{html.escape(cat)}</b> <i>(просмотр)</i>\n"]
    for p in prods:
        lines.append(_line_product_readonly(p))
    if len(prods) >= 40:
        lines.append("\n<i>Показаны первые 40 позиций.</i>")
    return "\n".join(lines)


def _handle_search(db, arg: str) -> str:
    arg = _sanitize_like(arg, max_len=120)
    if len(arg) < 2:
        return "Минимум 2 символа для поиска."

    like = f"%{arg}%"
    prods = (
        db.query(models.Product)
        .filter(
            models.Product.is_active == True,
            or_(models.Product.name.ilike(like), models.Product.sku.ilike(like)),
        )
        .order_by(models.Product.quantity.desc())
        .limit(20)
        .all()
    )
    if not prods:
        return f"<i>По запросу «{html.escape(arg)}» ничего не найдено.</i>"
    lines = [f"<b>Поиск склада:</b> {html.escape(arg)} <i>(просмотр)</i>\n"]
    for p in prods:
        lines.append(_line_product_readonly(p))
    return "\n".join(lines)


def _handle_wish_pending(db) -> str:
    items = (
        db.query(models.WishItem)
        .filter(models.WishItem.status == "pending")
        .order_by(desc(models.WishItem.created_at))
        .limit(50)
        .all()
    )
    if not items:
        return "<b>Нужно заказать</b>\n\n<i>Список пуст. Кнопка «➕ Добавить в список» или /заказать название</i>"
    lines = ["<b>Нужно заказать</b> <i>(ещё не переведено в «заказано»)</i>\n"]
    for it in items:
        nm = html.escape((it.name or "—")[:120])
        br = html.escape(str(it.brand or ""))
        extra = f" · {br}" if br else ""
        lines.append(f"• #{it.id} {nm}{extra}")
    if len(items) >= 50:
        lines.append("\n<i>Показаны последние 50.</i>")
    return "\n".join(lines)


def _handle_in_transit(db) -> str:
    orders = (
        db.query(models.PurchaseOrder)
        .filter(models.PurchaseOrder.status.in_(("in_transit", "partial")))
        .order_by(desc(models.PurchaseOrder.ordered_at))
        .limit(35)
        .all()
    )
    if not orders:
        return "<b>Заказано / в пути</b>\n\n<i>Нет активных заказов со статусом в пути.</i>"
    lines = ["<b>Заказано / в пути</b>\n"]
    for o in orders:
        nm = html.escape((o.name or "—")[:70])
        st = html.escape(str(o.status or ""))
        qo = int(o.quantity_ordered or 0)
        qr = int(o.quantity_received or 0)
        lines.append(f"• #{o.id} {nm}\n  {st} · заказано <b>{qo}</b> · получено <b>{qr}</b>")
    return "\n".join(lines)


def _commit_wish_item(chat_id: int, name: str) -> None:
    with _state_lock:
        _pending_wish_name.discard(chat_id)
    name = name.strip()
    if len(name) < 2:
        with _state_lock:
            _pending_wish_name.add(chat_id)
        _reply(chat_id, "Слишком коротко. Введите название или /отмена", _main_menu_markup())
        return
    db = SessionLocal()
    try:
        w = models.WishItem(name=name[:255], status="pending")
        db.add(w)
        db.commit()
        _reply(chat_id, f"В списке «нужно заказать»: <b>{html.escape(name[:200])}</b>", _main_menu_markup())
    except Exception:
        logger.exception("Telegram: wish item create")
        _reply(chat_id, "<b>Ошибка</b> при записи в базу.", _main_menu_markup())
    finally:
        db.close()


def _parse_command(text: str) -> tuple[str, str]:
    t = (text or "").strip()
    if not t.startswith("/"):
        return "", ""
    parts = t.split(maxsplit=1)
    cmd = parts[0].split("@")[0].lower()
    arg = parts[1].strip() if len(parts) > 1 else ""
    return cmd, arg


def _dispatch_command(chat_id: int, text: str) -> None:
    cmd, arg = _parse_command(text)
    if not cmd:
        return

    if cmd in ("/отмена", "/cancel"):
        _clear_states(chat_id)
        _reply(chat_id, "Ок, отменено.", _main_menu_markup())
        return

    aliases = {
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
        "/заказать": "/wishadd",
        "/wish": "/wishadd",
    }
    cmd = aliases.get(cmd, cmd)

    db = SessionLocal()
    try:
        if cmd in ("/start",):
            _clear_states(chat_id)
            _reply(chat_id, _welcome_text(), _main_menu_markup())
            return
        if cmd in ("/help",):
            _clear_states(chat_id)
            _reply(chat_id, _cmd_help(), _main_menu_markup())
            return
        _clear_states(chat_id)
        if cmd in ("/report",):
            tz_name = os.getenv("TELEGRAM_REPORT_TZ", "Asia/Almaty")
            _reply(chat_id, build_daily_report_text(db, tz_name), _main_menu_markup())
            return
        if cmd in ("/categories",):
            _reply(chat_id, _handle_categories(db), _main_menu_markup())
            return
        if cmd in ("/cat",):
            _reply(chat_id, _handle_cat(db, arg), _main_menu_markup())
            return
        if cmd in ("/search",):
            if len(arg) < 2:
                _reply(chat_id, "Использование: <code>/поиск текст</code>", _main_menu_markup())
                return
            _reply(chat_id, _handle_search(db, arg), _main_menu_markup())
            return
        if cmd in ("/wishadd",):
            if len(arg.strip()) < 2:
                _reply(chat_id, "Использование: <code>/заказать Название детали</code>", _main_menu_markup())
                return
            w = models.WishItem(name=arg.strip()[:255], status="pending")
            db.add(w)
            db.commit()
            _reply(
                chat_id,
                f"В списке «нужно заказать»: <b>{html.escape(arg.strip()[:200])}</b>",
                _main_menu_markup(),
            )
            return
        _reply(chat_id, "Неизвестная команда. /help", _main_menu_markup())
    except Exception:
        logger.exception("Telegram command dispatch error")
        _reply(chat_id, "<b>Ошибка</b> при обработке. Попробуйте позже.", _main_menu_markup())
    finally:
        db.close()


def _act_categories(chat_id: int) -> None:
    _clear_states(chat_id)
    db = SessionLocal()
    try:
        _reply(chat_id, _handle_categories(db), _main_menu_markup())
    finally:
        db.close()


def _act_stock_search_prompt(chat_id: int) -> None:
    _clear_states(chat_id)
    with _state_lock:
        _pending_stock_search.add(chat_id)
    _reply(
        chat_id,
        "Введите запрос для поиска по <b>названию</b> или <b>SKU</b>.\n/отмена — отменить.",
        _main_menu_markup(),
    )


def _act_wish_list(chat_id: int) -> None:
    _clear_states(chat_id)
    db = SessionLocal()
    try:
        _reply(chat_id, _handle_wish_pending(db), _main_menu_markup())
    finally:
        db.close()


def _act_wish_add_prompt(chat_id: int) -> None:
    _clear_states(chat_id)
    with _state_lock:
        _pending_wish_name.add(chat_id)
    _reply(
        chat_id,
        "Введите <b>название детали</b> для списка «нужно заказать».\n/отмена — отменить.",
        _main_menu_markup(),
    )


def _act_report(chat_id: int) -> None:
    _clear_states(chat_id)
    db = SessionLocal()
    try:
        tz_name = os.getenv("TELEGRAM_REPORT_TZ", "Asia/Almaty")
        _reply(chat_id, build_daily_report_text(db, tz_name), _main_menu_markup())
    finally:
        db.close()


def _act_in_transit(chat_id: int) -> None:
    _clear_states(chat_id)
    db = SessionLocal()
    try:
        _reply(chat_id, _handle_in_transit(db), _main_menu_markup())
    finally:
        db.close()


def _act_help(chat_id: int) -> None:
    _clear_states(chat_id)
    _reply(chat_id, _cmd_help(), _main_menu_markup())


_BUTTON_ACTIONS: Dict[str, Callable[[int], None]] = {
    BTN_STOCK_CATS: _act_categories,
    BTN_STOCK_SEARCH: _act_stock_search_prompt,
    BTN_WISH_LIST: _act_wish_list,
    BTN_WISH_ADD: _act_wish_add_prompt,
    BTN_REPORT: _act_report,
    BTN_IN_TRANSIT: _act_in_transit,
    BTN_HELP: _act_help,
}


def _route_message(chat_id: int, text: str) -> None:
    raw = (text or "").strip()
    low = raw.lower()

    if low in ("/отмена", "/cancel", "отмена"):
        _clear_states(chat_id)
        _reply(chat_id, "Ок, отменено.", _main_menu_markup())
        return

    if raw.startswith("/"):
        _dispatch_command(chat_id, raw)
        return

    # Кнопки меню — раньше ожидания ввода текста (иначе «Категории» уйдёт в поиск)
    if raw in _BUTTON_ACTIONS:
        _BUTTON_ACTIONS[raw](chat_id)
        return

    with _state_lock:
        in_wish = chat_id in _pending_wish_name
        in_search = chat_id in _pending_stock_search

    if in_wish:
        _commit_wish_item(chat_id, raw)
        return

    if in_search:
        with _state_lock:
            _pending_stock_search.discard(chat_id)
        db = SessionLocal()
        try:
            _reply(chat_id, _handle_search(db, raw), _main_menu_markup())
        finally:
            db.close()
        return

    _reply(
        chat_id,
        "Нажмите кнопку меню или отправьте команду, например <code>/help</code>",
        _main_menu_markup(),
    )


def _poll_loop():
    token = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
    if not token:
        return

    base = f"https://api.telegram.org/bot{token}"
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
                _route_message(cid_int, text)
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

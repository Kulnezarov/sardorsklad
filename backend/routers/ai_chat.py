import base64
import logging
import os
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

import models
from database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/ai-chat", tags=["ai-chat"])

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

SYSTEM_PROMPT = """Ты — ASTRA, интеллектуальный ассистент по китайским автозапчастям.
Создатель: Сардор Кулнезаров.

Твои возможности:
- Ты эксперт по китайским автозапчастям (Changan, Chery, Geely, Haval, BYD, JAC, FAW, Dongfeng, Great Wall и др.)
- У тебя есть доступ к актуальной базе товаров на складе в реальном времени
- Ты умеешь анализировать товары: советовать по ценам, определять залежалые позиции, рекомендовать закупки
- Ты можешь определять запчасти по фото и давать информацию о них
- Ты знаешь OEM-номера, аналоги, совместимость запчастей

Языки:
- Основной язык общения — русский
- Ты умеешь отвечать на китайском (中文), если пользователь пишет по-китайски или просит перевод
- Ты умеешь отвечать на узбекском (o'zbek tili), если пользователь пишет по-узбекски
- При необходимости можешь давать названия запчастей на китайском для поиска у поставщиков

Стиль:
- Отвечай кратко и по делу
- Используй данные из базы товаров когда это уместно
- Если спрашивают про товар на складе — ищи в предоставленных данных
- Будь дружелюбным и профессиональным
"""


class ChatMessage(BaseModel):
    role: str  # "user" or "assistant"
    text: str


class ChatRequest(BaseModel):
    message: str
    photo_base64: Optional[str] = None
    history: Optional[List[ChatMessage]] = []


class ChatResponse(BaseModel):
    reply: str


def _build_products_context(db: Session) -> str:
    products = (
        db.query(models.Product)
        .filter(models.Product.is_active == True)
        .order_by(models.Product.name)
        .limit(500)
        .all()
    )
    if not products:
        return "База товаров пуста."

    lines = [f"Актуальная база товаров ({len(products)} позиций):"]
    for p in products:
        parts = [f"#{p.id} {p.name}"]
        if p.brand:
            parts.append(f"марка:{p.brand}")
        if p.category:
            parts.append(f"кат:{p.category}")
        parts.append(f"кол:{p.quantity}")
        parts.append(f"цена:{p.sale_price}₸")
        if p.purchase_price:
            parts.append(f"закуп:{p.purchase_price}₸")
        if p.supplier:
            parts.append(f"пост:{p.supplier}")
        lines.append(" | ".join(parts))

    return "\n".join(lines)


@router.post("/", response_model=ChatResponse)
def chat_with_astra(req: ChatRequest, db: Session = Depends(get_db)):
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY не настроен на сервере")

    try:
        import google.generativeai as genai
    except ImportError:
        raise HTTPException(status_code=500, detail="Библиотека google-generativeai не установлена")

    genai.configure(api_key=GEMINI_API_KEY)

    products_context = _build_products_context(db)

    full_system = f"{SYSTEM_PROMPT}\n\n{products_context}"

    contents = []

    if req.history:
        for msg in req.history[-20:]:
            contents.append({
                "role": "user" if msg.role == "user" else "model",
                "parts": [{"text": msg.text}],
            })

    user_parts = [{"text": req.message}]

    if req.photo_base64:
        try:
            raw = req.photo_base64
            if "," in raw:
                header, raw = raw.split(",", 1)
            else:
                header = ""

            mime = "image/jpeg"
            if "png" in header:
                mime = "image/png"
            elif "webp" in header:
                mime = "image/webp"
            elif "gif" in header:
                mime = "image/gif"

            image_bytes = base64.b64decode(raw)
            user_parts.append({
                "inline_data": {
                    "mime_type": mime,
                    "data": base64.b64encode(image_bytes).decode("utf-8"),
                }
            })
        except Exception as e:
            logger.warning("Failed to process photo: %s", e)

    contents.append({"role": "user", "parts": user_parts})

    try:
        model = genai.GenerativeModel(
            "gemini-2.0-flash",
            system_instruction=full_system,
        )
        response = model.generate_content(contents)
        reply_text = response.text or "Не удалось получить ответ."
    except Exception as e:
        logger.error("Gemini API error: %s", e)
        raise HTTPException(status_code=502, detail=f"Ошибка Gemini API: {str(e)[:200]}")

    return ChatResponse(reply=reply_text)

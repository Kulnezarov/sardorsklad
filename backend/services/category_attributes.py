"""Валидация и синхронизация category_id / attributes у товаров."""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException
from sqlalchemy.orm import Session

import models


def normalize_attributes(raw: Any) -> dict | None:
    if raw is None:
        return None
    if not isinstance(raw, dict):
        return None
    out: dict[str, Any] = {}
    for k, v in raw.items():
        if v is None:
            continue
        key = str(k).strip()
        if not key:
            continue
        if isinstance(v, str):
            s = v.strip()
            if s:
                out[key] = s
        elif isinstance(v, (int, float, bool)):
            out[key] = v
        else:
            out[key] = str(v).strip()
    return out or None


def get_category_schema(db: Session, category_id: int | None) -> dict | None:
    if not category_id:
        return None
    cat = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not cat:
        return None
    schema = cat.attribute_schema
    return schema if isinstance(schema, dict) else None


def sync_category_text(db: Session, payload: dict) -> None:
    """Если передан category_id — подставить имя подкатегории в category (legacy-строка)."""
    cid = payload.get("category_id")
    if not cid:
        return
    cat = db.query(models.Category).filter(models.Category.id == int(cid)).first()
    if cat:
        payload["category"] = cat.name


def validate_attributes_for_category(
    db: Session,
    category_id: int | None,
    attributes: dict | None,
    *,
    strict: bool = False,
) -> dict | None:
    """Проверка attributes по attribute_schema подкатегории."""
    attrs = normalize_attributes(attributes)
    if not category_id:
        return attrs
    cat = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not cat:
        if strict:
            raise HTTPException(status_code=400, detail="Категория не найдена")
        return attrs
    if cat.parent_id is None:
        if strict:
            raise HTTPException(status_code=400, detail="Выберите подкатегорию, а не группу")
        return attrs
    schema = cat.attribute_schema if isinstance(cat.attribute_schema, dict) else {}
    fields = schema.get("fields") or []
    if not fields:
        return attrs
    out = dict(attrs or {})
    for f in fields:
        if not isinstance(f, dict):
            continue
        key = str(f.get("key") or "").strip()
        if not key:
            continue
        required = bool(f.get("required"))
        val = out.get(key)
        if required and strict and (val is None or val == ""):
            label = f.get("label") or key
            raise HTTPException(status_code=400, detail=f"Заполните поле: {label}")
        ftype = f.get("type") or "text"
        if val is not None and val != "" and ftype in ("select", "chip"):
            opts = f.get("options") or []
            if opts and str(val) not in [str(o) for o in opts]:
                label = f.get("label") or key
                raise HTTPException(status_code=400, detail=f"Недопустимое значение для «{label}»")
    return out or None


def needs_category_refresh(db: Session, p) -> bool:
    """Товар нужно обновить: нет category_id или не пересчитан display_layout."""
    if getattr(p, "category_id", None) is None:
        return True
    schema = get_category_schema(db, p.category_id)
    if not schema:
        return False
    from services.form_layout import has_custom_form_layout

    if not has_custom_form_layout(schema):
        return False
    dl = getattr(p, "display_layout", None)
    return not isinstance(dl, list) or len(dl) == 0


def attribute_labels_from_product(db: Session, p) -> list[str]:
    """Человекочитаемые характеристики для витрины."""
    attrs = p.attributes if isinstance(getattr(p, "attributes", None), dict) else {}
    if not attrs:
        return []
    schema = get_category_schema(db, getattr(p, "category_id", None)) or {}
    fields = schema.get("fields") or []
    label_by_key = {
        str(f.get("key")): str(f.get("label") or f.get("key"))
        for f in fields
        if isinstance(f, dict) and f.get("key")
    }
    unit_by_key = {
        str(f.get("key")): f.get("unit")
        for f in fields
        if isinstance(f, dict) and f.get("key")
    }
    out: list[str] = []
    for key, val in attrs.items():
        if val is None or val == "":
            continue
        label = label_by_key.get(str(key), str(key))
        unit = unit_by_key.get(str(key))
        text = f"{label}: {val}"
        if unit:
            text = f"{label}: {val} {unit}"
        out.append(text)
    return out

"""Порядок и состав полей товара для склада и витрины."""

from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

import models
from services.category_attributes import get_category_schema

BUILTIN_DEFAULTS: list[dict[str, str]] = [
    {"id": "name", "kind": "builtin", "key": "name", "label": "Название"},
    {"id": "brand", "kind": "builtin", "key": "brand", "label": "Марка авто"},
    {"id": "model", "kind": "builtin", "key": "model", "label": "Модель авто"},
    {"id": "sku", "kind": "builtin", "key": "sku", "label": "Артикул"},
]


def _entry_id(entry: dict) -> str:
    return str(entry.get("id") or entry.get("key") or "").strip()


def default_display_layout(category_schema: dict | None = None) -> list[dict[str, Any]]:
    layout: list[dict[str, Any]] = [dict(x) for x in BUILTIN_DEFAULTS]
    fields = (category_schema or {}).get("fields") or []
    seen = {_entry_id(x) for x in layout}
    for f in fields:
        if not isinstance(f, dict):
            continue
        key = str(f.get("key") or "").strip()
        if not key:
            continue
        eid = f"attr:{key}"
        if eid in seen:
            continue
        seen.add(eid)
        layout.append(
            {
                "id": eid,
                "kind": "attribute",
                "key": key,
                "label": str(f.get("label") or key),
            }
        )
    return layout


def normalize_display_layout(raw: Any, category_schema: dict | None = None) -> list[dict[str, Any]]:
    if not isinstance(raw, list) or not raw:
        return default_display_layout(category_schema)
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "custom").strip() or "custom"
        key = str(item.get("key") or "").strip()
        eid = _entry_id(item) or (f"custom:{key}" if key else "")
        if not eid or eid in seen:
            continue
        seen.add(eid)
        label = str(item.get("label") or key or eid).strip()
        row: dict[str, Any] = {"id": eid, "kind": kind, "label": label}
        if key:
            row["key"] = key
        if kind == "custom":
            val = item.get("value")
            if val is not None and str(val).strip():
                row["value"] = str(val).strip()
        out.append(row)
    return out or default_display_layout(category_schema)


def merge_display_layout_with_schema(
    layout: list[dict[str, Any]] | None,
    category_schema: dict | None,
) -> list[dict[str, Any]]:
    """Добавляет новые поля категории в конец, сохраняя порядок пользователя."""
    base = normalize_display_layout(layout, category_schema)
    existing_attr = {
        str(x.get("key"))
        for x in base
        if x.get("kind") == "attribute" and x.get("key")
    }
    for f in (category_schema or {}).get("fields") or []:
        if not isinstance(f, dict):
            continue
        key = str(f.get("key") or "").strip()
        if not key or key in existing_attr:
            continue
        base.append(
            {
                "id": f"attr:{key}",
                "kind": "attribute",
                "key": key,
                "label": str(f.get("label") or key),
            }
        )
    return base


def _strip_or_none(value: Any) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _builtin_value(p: models.Product, key: str) -> str | None:
    mapping = {
        "name": p.name,
        "brand": p.brand,
        "model": p.model,
        "sku": p.sku,
        "description": p.description,
    }
    val = mapping.get(key)
    if val is None:
        return None
    s = str(val).strip()
    return s or None


def _attribute_value(p: models.Product, key: str, schema: dict | None) -> str | None:
    attrs = p.attributes if isinstance(getattr(p, "attributes", None), dict) else {}
    val = attrs.get(key)
    if val is None or val == "":
        return None
    unit = None
    for f in (schema or {}).get("fields") or []:
        if isinstance(f, dict) and str(f.get("key")) == key:
            unit = f.get("unit")
            break
    text = str(val).strip()
    if unit:
        return f"{text} {unit}".strip()
    return text


def product_purpose_from_product(
    p: models.Product,
    schema: dict | None = None,
    storefront_fields: list[dict[str, str]] | None = None,
) -> str | None:
    """Назначение товара для карточки витрины (без открытия страницы товара)."""
    for row in storefront_fields or []:
        label = str(row.get("label") or "").strip().lower()
        value = _strip_or_none(row.get("value"))
        if value and "назнач" in label:
            return value

    attrs = p.attributes if isinstance(getattr(p, "attributes", None), dict) else {}
    for f in (schema or {}).get("fields") or []:
        if not isinstance(f, dict):
            continue
        label = str(f.get("label") or "").strip().lower()
        key = str(f.get("key") or "").strip()
        if not key:
            continue
        if "назнач" not in label and key not in ("naznachenie", "naznacheniye", "purpose", "назначение"):
            continue
        value = attrs.get(key)
        if value is None or str(value).strip() == "":
            continue
        text = str(value).strip()
        unit = f.get("unit")
        if unit:
            text = f"{text} {unit}".strip()
        return text

    for key in ("naznachenie", "naznacheniye", "purpose", "назначение"):
        value = attrs.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return None


def storefront_fields_from_product(db: Session, p: models.Product) -> list[dict[str, str]]:
    schema = get_category_schema(db, getattr(p, "category_id", None))
    layout = merge_display_layout_with_schema(
        p.display_layout if isinstance(getattr(p, "display_layout", None), list) else None,
        schema,
    )
    out: list[dict[str, str]] = []
    for entry in layout:
        kind = entry.get("kind")
        label = str(entry.get("label") or "").strip()
        key = str(entry.get("key") or "").strip()
        value: str | None = None
        if kind == "builtin" and key:
            value = _builtin_value(p, key)
            if not label:
                label = next((x["label"] for x in BUILTIN_DEFAULTS if x["key"] == key), key)
        elif kind == "attribute" and key:
            value = _attribute_value(p, key, schema)
            if not label:
                label = key
        elif kind == "custom":
            raw_val = entry.get("value")
            if raw_val is not None and str(raw_val).strip():
                value = str(raw_val).strip()
            elif key:
                attrs = p.attributes if isinstance(getattr(p, "attributes", None), dict) else {}
                av = attrs.get(key)
                if av is not None and str(av).strip():
                    value = str(av).strip()
        if not label or not value:
            continue
        out.append({"label": label, "value": value})
    return out


def sync_custom_fields_to_attributes(
    layout: list[dict[str, Any]] | None,
    attributes: dict | None,
) -> dict | None:
    """Custom-поля из layout → attributes (для поиска/экспорта)."""
    attrs = dict(attributes or {})
    if not isinstance(layout, list):
        return attrs or None
    for entry in layout:
        if not isinstance(entry, dict) or entry.get("kind") != "custom":
            continue
        key = str(entry.get("key") or entry.get("id") or "").strip()
        if not key:
            continue
        val = entry.get("value")
        if val is None or str(val).strip() == "":
            attrs.pop(key, None)
        else:
            attrs[key] = str(val).strip()
    return attrs or None

"""Шаблон карточки товара (form_layout) в attribute_schema категории."""

from __future__ import annotations

from typing import Any

LOCKED_ROWS: list[dict[str, str]] = [
    {"id": "photos", "kind": "locked", "key": "gallery", "width": "full"},
    {"id": "barcode", "kind": "locked", "key": "barcode", "width": "full"},
]

LOCKED_KEYS = {str(x["key"]) for x in LOCKED_ROWS}

BUILTIN_ROWS: list[dict[str, str]] = [
    {"id": "name", "kind": "builtin", "key": "name", "width": "full", "placeholder": "Название товара"},
    {"id": "cny", "kind": "builtin", "key": "cny_price", "width": "half"},
    {"id": "delivery", "kind": "builtin", "key": "delivery_block", "width": "full"},
    {"id": "sale", "kind": "builtin", "key": "sale_price", "width": "half"},
    {"id": "qty", "kind": "builtin", "key": "quantity", "width": "half"},
    {"id": "supplier", "kind": "builtin", "key": "supplier", "width": "full"},
    {"id": "description", "kind": "builtin", "key": "description", "width": "full"},
]

BUILTIN_LABELS: dict[str, str] = {
    "name": "Название",
    "brand": "Марка авто",
    "model": "Модель авто",
    "sku": "Артикул",
    "description": "Описание",
    "cny_price": "Закуп (¥)",
    "delivery_block": "Доставка (₸, кг)",
    "purchase_block": "Закуп и доставка",
    "sale_price": "Цена продажи",
    "quantity": "Количество",
    "supplier": "Поставщик",
    "gallery": "Фото",
    "barcode": "Штрих-код",
}

STOREFRONT_BUILTIN_KEYS = frozenset({"name", "brand", "model", "sku", "description"})

VALID_FIELD_TYPES = frozenset({"text", "number", "select", "chip", "textarea"})
VALID_WIDTHS = frozenset({"full", "half"})
VALID_ROW_KINDS = frozenset({"locked", "builtin", "attribute", "compatibility"})


def _row_id(entry: dict) -> str:
    return str(entry.get("id") or entry.get("key") or "").strip()


def default_form_layout(
    category_schema: dict | None = None,
    *,
    show_compatibility: bool | None = None,
) -> list[dict[str, Any]]:
    """Дефолтный порядок полей формы добавления товара."""
    schema = category_schema or {}
    show_compat = (
        bool(show_compatibility)
        if show_compatibility is not None
        else bool(schema.get("show_compatibility"))
    )
    layout: list[dict[str, Any]] = [dict(x) for x in LOCKED_ROWS]
    layout.append(dict(BUILTIN_ROWS[0]))
    if show_compat:
        layout.append({"id": "compat", "kind": "compatibility", "width": "full"})
    fields = schema.get("fields") or []
    for f in fields:
        if not isinstance(f, dict):
            continue
        key = str(f.get("key") or "").strip()
        if not key:
            continue
        width = str(f.get("width") or "full").strip()
        if width not in VALID_WIDTHS:
            width = "full"
        row: dict[str, Any] = {
            "id": f"attr:{key}",
            "kind": "attribute",
            "key": key,
            "width": width,
        }
        placeholder = str(f.get("placeholder") or "").strip()
        if placeholder:
            row["placeholder"] = placeholder
        layout.append(row)
    layout.append({"id": "sku", "kind": "locked", "key": "sku", "width": "full"})
    for row in BUILTIN_ROWS[1:]:
        layout.append(dict(row))
    return layout


def normalize_form_layout(
    raw: Any,
    category_schema: dict | None = None,
) -> list[dict[str, Any]]:
    """Нормализует form_layout: locked-поля, ширина, синхронизация attribute-строк с fields."""
    schema = category_schema if isinstance(category_schema, dict) else {}
    fields = schema.get("fields") or []
    field_by_key = {
        str(f.get("key") or "").strip(): f
        for f in fields
        if isinstance(f, dict) and str(f.get("key") or "").strip()
    }

    if not isinstance(raw, list) or not raw:
        return default_form_layout(schema)

    out: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    seen_locked: set[str] = set()
    seen_attr: set[str] = set()
    has_compat = False

    for item in raw:
        if not isinstance(item, dict):
            continue
        kind = str(item.get("kind") or "").strip()
        if kind not in VALID_ROW_KINDS:
            continue
        key = str(item.get("key") or "").strip()
        eid = _row_id(item) or (f"attr:{key}" if kind == "attribute" and key else "")
        if not eid or eid in seen_ids:
            continue

        width = str(item.get("width") or "full").strip()
        if width not in VALID_WIDTHS:
            width = "full"

        row: dict[str, Any] = {"id": eid, "kind": kind, "width": width}
        if key:
            row["key"] = key
        placeholder = str(item.get("placeholder") or "").strip()
        if placeholder:
            row["placeholder"] = placeholder

        if kind == "locked":
            if key not in LOCKED_KEYS:
                continue
            seen_locked.add(key)
        elif kind == "builtin":
            if key == "purchase_block":
                for split in (
                    {"id": "cny", "kind": "builtin", "key": "cny_price", "width": width},
                    {"id": "delivery", "kind": "builtin", "key": "delivery_block", "width": "full"},
                ):
                    sid = split["id"]
                    if sid in seen_ids:
                        continue
                    seen_ids.add(sid)
                    out.append(dict(split))
                continue
            if key not in BUILTIN_LABELS:
                continue
        elif kind == "attribute":
            if not key or key not in field_by_key:
                continue
            seen_attr.add(key)
            fdef = field_by_key[key]
            if not placeholder:
                ph = str(fdef.get("placeholder") or "").strip()
                if ph:
                    row["placeholder"] = ph
        elif kind == "compatibility":
            has_compat = True

        seen_ids.add(eid)
        out.append(row)

    for locked in LOCKED_ROWS:
        key = locked["key"]
        if key in seen_locked:
            continue
        insert_at = 0 if key == "gallery" else sum(1 for x in out if x.get("kind") == "locked")
        out.insert(insert_at, dict(locked))
        seen_locked.add(key)
    if "sku" not in seen_locked:
        insert_at = 0
        for i, row in enumerate(out):
            if row.get("kind") == "attribute":
                insert_at = i
        out.insert(insert_at, {"id": "sku", "kind": "locked", "key": "sku", "width": "full"})
        seen_locked.add("sku")

    tail_start = len(out)
    for i, row in enumerate(out):
        if row.get("kind") == "locked" and row.get("key") == "sku":
            tail_start = i
            break
    for f in fields:
        if not isinstance(f, dict):
            continue
        key = str(f.get("key") or "").strip()
        if not key or key in seen_attr:
            continue
        width = str(f.get("width") or "full").strip()
        if width not in VALID_WIDTHS:
            width = "full"
        attr_row: dict[str, Any] = {
            "id": f"attr:{key}",
            "kind": "attribute",
            "key": key,
            "width": width,
        }
        ph = str(f.get("placeholder") or "").strip()
        if ph:
            attr_row["placeholder"] = ph
        out.insert(tail_start, attr_row)
        tail_start += 1
        seen_attr.add(key)

    if schema.get("show_compatibility") and not has_compat:
        name_idx = next((i for i, r in enumerate(out) if r.get("key") == "name"), 1)
        out.insert(name_idx + 1, {"id": "compat", "kind": "compatibility", "width": "full"})

    # Гарантировать ¥, доставку, продажу и остаток после артикула
    tail_keys = {str(r["key"]) for r in BUILTIN_ROWS[1:]}
    existing_tail = {
        str(r.get("key"))
        for r in out
        if r.get("kind") == "builtin" and str(r.get("key") or "") in tail_keys
    }
    sku_idx = next((i for i, r in enumerate(out) if r.get("key") == "sku"), len(out))
    insert_at = sku_idx + 1
    for row in BUILTIN_ROWS[1:]:
        key = str(row["key"])
        if key in existing_tail:
            continue
        out.insert(insert_at, dict(row))
        insert_at += 1

    return out or default_form_layout(schema)


def normalize_attribute_fields(raw: Any) -> list[dict[str, Any]]:
    """Нормализует fields[] в attribute_schema."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        key = str(item.get("key") or "").strip()
        label = str(item.get("label") or key).strip()
        if not key or not label or key in seen:
            continue
        seen.add(key)
        ftype = str(item.get("type") or "text").strip()
        if ftype not in VALID_FIELD_TYPES:
            ftype = "text"
        row: dict[str, Any] = {"key": key, "label": label, "type": ftype}
        unit = str(item.get("unit") or "").strip()
        if unit:
            row["unit"] = unit
        if bool(item.get("required")):
            row["required"] = True
        width = str(item.get("width") or "").strip()
        if width in VALID_WIDTHS:
            row["width"] = width
        placeholder = str(item.get("placeholder") or "").strip()
        if placeholder:
            row["placeholder"] = placeholder
        opts_raw = item.get("options")
        if ftype in ("select", "chip") and opts_raw is not None:
            if isinstance(opts_raw, list):
                opts = [str(o).strip() for o in opts_raw if str(o).strip()]
            else:
                opts = [s.strip() for s in str(opts_raw).split(",") if s.strip()]
            if opts:
                row["options"] = opts
        out.append(row)
    return out


def normalize_attribute_schema(raw: Any) -> dict:
    """Полная нормализация attribute_schema: fields + form_layout + show_compatibility."""
    if not isinstance(raw, dict):
        raw = {}
    fields = normalize_attribute_fields(raw.get("fields"))
    show_compatibility = bool(raw.get("show_compatibility"))
    base = {"fields": fields, "show_compatibility": show_compatibility}
    base["form_layout"] = normalize_form_layout(raw.get("form_layout"), base)
    return base


def has_custom_form_layout(schema: dict | None) -> bool:
    if not isinstance(schema, dict):
        return False
    fl = schema.get("form_layout")
    if not isinstance(fl, list) or not fl:
        return False
    default = default_form_layout(schema)
    if len(fl) != len(default):
        return True
    for a, b in zip(fl, default):
        if not isinstance(a, dict) or not isinstance(b, dict):
            return True
        if _row_id(a) != _row_id(b) or a.get("width") != b.get("width"):
            return True
    return False


def display_layout_from_form_layout(
    form_layout: list[dict[str, Any]] | None,
    category_schema: dict | None = None,
) -> list[dict[str, Any]]:
    """Строит display_layout витрины из form_layout категории."""
    schema = category_schema if isinstance(category_schema, dict) else {}
    fields = schema.get("fields") or []
    label_by_key = {
        str(f.get("key") or "").strip(): str(f.get("label") or f.get("key") or "").strip()
        for f in fields
        if isinstance(f, dict) and f.get("key")
    }
    layout = form_layout if isinstance(form_layout, list) else []
    if not layout:
        layout = default_form_layout(schema)

    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for row in layout:
        if not isinstance(row, dict):
            continue
        kind = str(row.get("kind") or "").strip()
        key = str(row.get("key") or "").strip()
        eid = _row_id(row)

        if kind == "attribute" and key:
            disp_id = f"attr:{key}"
            if disp_id in seen:
                continue
            seen.add(disp_id)
            out.append({
                "id": disp_id,
                "kind": "attribute",
                "key": key,
                "label": label_by_key.get(key, key),
            })
        elif kind == "builtin" and key in STOREFRONT_BUILTIN_KEYS:
            if eid in seen:
                continue
            seen.add(eid)
            out.append({
                "id": eid,
                "kind": "builtin",
                "key": key,
                "label": BUILTIN_LABELS.get(key, key),
            })
        elif kind == "locked" and key == "sku":
            if "sku" in seen:
                continue
            seen.add("sku")
            out.append({"id": "sku", "kind": "builtin", "key": "sku", "label": "Артикул"})

    if not out:
        from services.product_display import default_display_layout

        return default_display_layout(schema)
    return out

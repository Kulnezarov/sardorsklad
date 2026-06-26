"""Слияние строк накладной при upsert — защита от потери серверных полей."""

from __future__ import annotations

from typing import Any


def _line_key(line: dict) -> str:
    lid = str(line.get("local_id") or "").strip()
    if lid:
        return lid
    return str(line.get("barcode") or "").strip()


def _union_str_list(existing: Any, incoming: Any) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for source in (existing, incoming):
        if not isinstance(source, list):
            continue
        for item in source:
            s = str(item or "").strip()
            if not s or s in seen:
                continue
            seen.add(s)
            out.append(s)
    return out


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, dict)):
        return len(value) == 0
    return False


def merge_intake_line(existing: dict | None, incoming: dict) -> dict:
    """Объединить поля одной строки: incoming побеждает, защищённые поля не затираются."""
    base = dict(existing) if isinstance(existing, dict) else {}
    out = {**base, **incoming}

    out["warehouse_image_urls"] = _union_str_list(
        base.get("warehouse_image_urls"),
        incoming.get("warehouse_image_urls"),
    )
    out["intake_photo_data"] = _union_str_list(
        base.get("intake_photo_data"),
        incoming.get("intake_photo_data"),
    )

    if base.get("warehouse_synced") is True and incoming.get("warehouse_synced") is not True:
        if "warehouse_synced" not in incoming or incoming.get("warehouse_synced") is None:
            out["warehouse_synced"] = True

    if _is_empty(incoming.get("product_id")) and not _is_empty(base.get("product_id")):
        out["product_id"] = base.get("product_id")

    return out


def merge_intake_lines(existing_lines: list | None, incoming_lines: list | None) -> list:
    """Слить строки по local_id; состав списка определяет incoming."""
    existing = existing_lines if isinstance(existing_lines, list) else []
    incoming = incoming_lines if isinstance(incoming_lines, list) else []

    by_key: dict[str, dict] = {}
    for raw in existing:
        if not isinstance(raw, dict):
            continue
        key = _line_key(raw)
        if key:
            by_key[key] = raw

    merged: list = []
    for raw in incoming:
        if not isinstance(raw, dict):
            continue
        key = _line_key(raw)
        if not key:
            merged.append(raw)
            continue
        merged.append(merge_intake_line(by_key.get(key), raw))
    return merged

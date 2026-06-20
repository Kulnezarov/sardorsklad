"""Форматирование и нормализация полей кодов моторов (engine_families)."""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Optional

FUEL_TYPE_LABELS: dict[str, str] = {
    "petrol": "Бензин",
    "diesel": "Дизель",
    "hybrid": "Гибрид",
    "lpg": "Газ (LPG)",
    "electric": "Электро",
}

VALID_FUEL_TYPES = frozenset(FUEL_TYPE_LABELS.keys())


def _fmt_displacement(value: Any) -> Optional[str]:
    if value is None or value == "":
        return None
    try:
        d = Decimal(str(value).replace(",", "."))
    except (InvalidOperation, ValueError):
        return None
    if d <= 0:
        return None
    s = f"{d:.2f}".rstrip("0").rstrip(".")
    return f"{s} л"


def format_engine_family_summary(row: Any) -> Optional[str]:
    """Краткая строка: 1.5 л · Бензин · 98 л.с. · Changan."""
    parts: list[str] = []
    disp = _fmt_displacement(getattr(row, "displacement_l", None))
    if disp:
        parts.append(disp)
    fuel = getattr(row, "fuel_type", None)
    if fuel:
        parts.append(FUEL_TYPE_LABELS.get(str(fuel), str(fuel)))
    power = (getattr(row, "power", None) or "").strip()
    if power:
        parts.append(power)
    manufacturer = (getattr(row, "manufacturer", None) or "").strip()
    if manufacturer:
        parts.append(manufacturer)
    name = (getattr(row, "name", None) or "").strip()
    if name and name not in parts:
        parts.append(name)
    notes = (getattr(row, "notes", None) or "").strip()
    if notes and len(parts) < 2:
        parts.append(notes[:80] + ("…" if len(notes) > 80 else ""))
    return " · ".join(parts) if parts else None


def parse_displacement_l(value: Any) -> Optional[Decimal]:
    if value is None or value == "":
        return None
    try:
        d = Decimal(str(value).replace(",", ".").strip())
    except (InvalidOperation, ValueError):
        return None
    if d <= 0:
        return None
    return d.quantize(Decimal("0.01"))


def normalize_fuel_type(value: Any) -> Optional[str]:
    if value is None or value == "":
        return None
    s = str(value).strip().lower()
    return s if s in VALID_FUEL_TYPES else None


def normalize_optional_str(value: Any, *, max_len: int = 255) -> Optional[str]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    return s[:max_len]


def apply_engine_family_details(row: Any, payload: dict) -> None:
    """Записать опциональные поля описания из API payload на ORM-строку."""
    if "name" in payload:
        row.name = normalize_optional_str(payload.get("name"), max_len=255)
    if "displacement_l" in payload:
        row.displacement_l = parse_displacement_l(payload.get("displacement_l"))
    if "fuel_type" in payload:
        row.fuel_type = normalize_fuel_type(payload.get("fuel_type"))
    if "power" in payload:
        row.power = normalize_optional_str(payload.get("power"), max_len=80)
    if "manufacturer" in payload:
        row.manufacturer = normalize_optional_str(payload.get("manufacturer"), max_len=120)
    if "notes" in payload:
        row.notes = normalize_optional_str(payload.get("notes"), max_len=2000)

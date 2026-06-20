"""Идемпотентная авто-миграция профилей категорий (pricing_mode, vehicle_mode)."""
from __future__ import annotations

import logging
from typing import Any

from sqlalchemy.orm import Session

import models
from services.form_layout import (
    VALID_PRICING_MODES,
    VALID_VEHICLE_MODES,
    VALID_ENGINE_CODE_MODES,
    DEFAULT_PRICING_MODE,
    DEFAULT_ENGINE_CODE_MODE,
    normalize_attribute_schema,
)

logger = logging.getLogger(__name__)

# Жидкости (масла, антифриз…) — без привязки к марке авто
LIQUID_GROUP_NAMES = frozenset({"Жидкости"})

# Группы, где код мотора обязателен (двигатель, КПП, фильтры, тросы…)
ENGINE_CODE_REQUIRED_GROUP_KEYWORDS = (
    "двигател",
    "трансмисс",
    "кпп",
    "фильтр",
    "трос",
    "привод",
    "сцеплен",
)

# Группы, где код мотора не нужен (кузов, интерьер, оптика…)
ENGINE_CODE_NONE_GROUP_KEYWORDS = (
    "кузов",
    "интерьер",
    "оптик",
    "салон",
    "стекл",
    "двер",
    "бампер",
    "зеркал",
)


def _group_name_matches(name: str | None, keywords: tuple[str, ...]) -> bool:
    n = (name or "").strip().casefold()
    if not n:
        return False
    return any(kw in n for kw in keywords)


def _target_engine_code_mode(group_name: str | None, cat_name: str | None) -> str | None:
    """
    Целевой engine_code_mode по имени группы/подкатегории.
    None — не менять (уже задан явно пользователем).
    """
    combined = f"{group_name or ''} {cat_name or ''}".casefold()
    if group_name in LIQUID_GROUP_NAMES:
        return "none"
    if _group_name_matches(combined, ENGINE_CODE_REQUIRED_GROUP_KEYWORDS):
        return "required"
    if _group_name_matches(combined, ENGINE_CODE_NONE_GROUP_KEYWORDS):
        return "none"
    return DEFAULT_ENGINE_CODE_MODE


def _parent_group_name(db: Session, cat: models.Category) -> str | None:
    if not cat.parent_id:
        return None
    parent = db.query(models.Category).filter(models.Category.id == cat.parent_id).first()
    return parent.name if parent else None


def _target_vehicle_mode(cat_name: str, group_name: str | None, schema: dict) -> tuple[str, bool] | None:
    """
    Целевой (vehicle_mode, show_compatibility) для апгрейда уже мигрированных категорий.
    None — не менять.

    Правило: все подкатегории, кроме группы «Жидкости», получают полный пикер марок/моделей.
    """
    show = bool(schema.get("show_compatibility"))
    vm = str(schema.get("vehicle_mode") or "").strip()

    if group_name in LIQUID_GROUP_NAMES:
        if vm != "none" or show:
            return "none", False
        return None

    # Любая запчасть (в т.ч. пользовательские группы вроде «Кузовные запчасти и Оптика»)
    if vm != "compatibility" or not show:
        return "compatibility", True

    return None


def _auto_pricing_mode(schema: dict) -> str:
    """Определить pricing_mode по содержимому схемы (для миграции)."""
    pm = str(schema.get("pricing_mode") or "").strip()
    if pm in VALID_PRICING_MODES:
        return pm
    return DEFAULT_PRICING_MODE  # import_cny по умолчанию


def _auto_vehicle_mode(schema: dict) -> str:
    """Определить vehicle_mode: миграция из show_compatibility."""
    vm = str(schema.get("vehicle_mode") or "").strip()
    if vm in VALID_VEHICLE_MODES:
        return vm
    return "compatibility" if schema.get("show_compatibility") else "none"


def normalize_catalog_profiles(db: Session) -> dict[str, int]:
    """
    Для каждой подкатегории (не имеющей pricing_mode/vehicle_mode):
    - определить профиль из show_compatibility и содержимого
    - записать в attribute_schema
    - Идемпотентно: повторный запуск безопасен
    """
    categories: list[models.Category] = (
        db.query(models.Category).filter(models.Category.parent_id.isnot(None)).all()
    )

    updated = 0
    skipped = 0

    for cat in categories:
        raw: Any = cat.attribute_schema if isinstance(cat.attribute_schema, dict) else {}

        pm_existing = str(raw.get("pricing_mode") or "").strip()
        vm_existing = str(raw.get("vehicle_mode") or "").strip()

        if pm_existing in VALID_PRICING_MODES and vm_existing in VALID_VEHICLE_MODES:
            skipped += 1
            continue

        pm_new = _auto_pricing_mode(raw)
        vm_new = _auto_vehicle_mode(raw)

        old_pm = pm_existing or "(не задан)"
        old_vm = vm_existing or "(не задан)"

        normalized = normalize_attribute_schema({
            **raw,
            "pricing_mode": pm_new,
            "vehicle_mode": vm_new,
        })

        from sqlalchemy.dialects.postgresql import JSONB
        from sqlalchemy import update as sa_update

        db.execute(
            sa_update(models.Category)
            .where(models.Category.id == cat.id)
            .values(attribute_schema=normalized)
        )

        logger.info(
            "catalog_migrate: cat_id=%d name=%r pricing_mode: %s→%s vehicle_mode: %s→%s",
            cat.id,
            cat.name,
            old_pm,
            pm_new,
            old_vm,
            vm_new,
        )
        updated += 1

    upgraded = 0
    for cat in categories:
        raw: Any = cat.attribute_schema if isinstance(cat.attribute_schema, dict) else {}
        group_name = _parent_group_name(db, cat)
        target = _target_vehicle_mode(cat.name, group_name, raw)
        if not target:
            continue

        vm_new, show_new = target
        pm = _auto_pricing_mode(raw)
        normalized = normalize_attribute_schema({
            **raw,
            "pricing_mode": pm,
            "vehicle_mode": vm_new,
            "show_compatibility": show_new,
        })

        from sqlalchemy.dialects.postgresql import JSONB
        from sqlalchemy import update as sa_update

        db.execute(
            sa_update(models.Category)
            .where(models.Category.id == cat.id)
            .values(attribute_schema=normalized)
        )
        logger.info(
            "catalog_migrate upgrade: cat_id=%d name=%r group=%r vehicle_mode→%s show_compatibility→%s",
            cat.id,
            cat.name,
            group_name,
            vm_new,
            show_new,
        )
        upgraded += 1

    engine_upgraded = 0
    for cat in categories:
        raw: Any = cat.attribute_schema if isinstance(cat.attribute_schema, dict) else {}
        ecm_existing = str(raw.get("engine_code_mode") or "").strip()
        if ecm_existing in VALID_ENGINE_CODE_MODES:
            continue
        group_name = _parent_group_name(db, cat)
        ecm_new = _target_engine_code_mode(group_name, cat.name)
        if ecm_new is None:
            continue
        pm = _auto_pricing_mode(raw)
        vm = _auto_vehicle_mode(raw)
        normalized = normalize_attribute_schema({
            **raw,
            "pricing_mode": pm,
            "vehicle_mode": vm,
            "engine_code_mode": ecm_new,
        })
        from sqlalchemy import update as sa_update

        db.execute(
            sa_update(models.Category)
            .where(models.Category.id == cat.id)
            .values(attribute_schema=normalized)
        )
        logger.info(
            "catalog_migrate engine_code_mode: cat_id=%d name=%r group=%r → %s",
            cat.id,
            cat.name,
            group_name,
            ecm_new,
        )
        engine_upgraded += 1

    if updated or upgraded or engine_upgraded:
        db.commit()

    logger.info(
        "catalog_migrate done: updated=%d upgraded=%d engine_upgraded=%d skipped=%d",
        updated,
        upgraded,
        engine_upgraded,
        skipped,
    )
    return {
        "updated": updated,
        "upgraded": upgraded,
        "engine_upgraded": engine_upgraded,
        "skipped": skipped,
    }

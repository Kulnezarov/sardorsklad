"""Начальные марки и модели автомобилей (идемпотентный сид)."""
from __future__ import annotations

import re

from sqlalchemy.orm import Session

import models


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9а-яё]+", "-", name.lower()).strip("-")
    return s or "item"


VEHICLE_CATALOG: list[tuple[str, list[str]]] = [
    ("Toyota", ["Camry", "Corolla", "Land Cruiser", "RAV4", "Hilux", "Prado"]),
    ("BMW", ["3 Series", "5 Series", "7 Series", "X5", "X3", "M3"]),
    ("Mercedes", ["C-Class", "E-Class", "S-Class", "GLE", "GLK", "Sprinter"]),
    ("Hyundai", ["Accent", "Elantra", "Sonata", "Tucson", "Santa Fe", "Creta"]),
    ("Kia", ["Rio", "Cerato", "Sportage", "Sorento", "Optima"]),
    ("ВАЗ", ["Niva", "2107", "2110", "Granta", "Vesta", "XRAY"]),
]


def _upsert_brand(db: Session, name: str, sort_order: int) -> models.VehicleBrand:
    slug = _slug(name)
    row = db.query(models.VehicleBrand).filter(models.VehicleBrand.slug == slug).first()
    if row:
        row.name = name
        row.is_active = True
        return row
    row = models.VehicleBrand(name=name, slug=slug, is_active=True)
    db.add(row)
    db.flush()
    return row


def _upsert_model(db: Session, brand_id: int, name: str) -> models.VehicleModel:
    slug = f"{brand_id}-{_slug(name)}"
    row = (
        db.query(models.VehicleModel)
        .filter(
            models.VehicleModel.vehicle_brand_id == brand_id,
            models.VehicleModel.name == name,
        )
        .first()
    )
    if row:
        row.is_active = True
        return row
    row = models.VehicleModel(
        vehicle_brand_id=brand_id,
        name=name,
        slug=slug,
        is_active=True,
    )
    db.add(row)
    db.flush()
    return row


def seed_default_vehicles(db: Session) -> int:
    """Идемпотентно создаёт марки и модели. Возвращает число марок."""
    count = 0
    for i, (brand_name, models_list) in enumerate(VEHICLE_CATALOG):
        brand = _upsert_brand(db, brand_name, i)
        count += 1
        for model_name in models_list:
            _upsert_model(db, brand.id, model_name)
    db.commit()
    return count

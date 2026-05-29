"""Поиск товаров по артикулу (SKU) и формирование ответа при дубликате."""

from __future__ import annotations

from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

import models


def normalize_sku(sku: Optional[str]) -> str:
    return (sku or "").strip()


def find_product_by_sku(
    db: Session,
    sku: str,
    *,
    exclude_id: Optional[int] = None,
) -> Optional[models.Product]:
    norm = normalize_sku(sku)
    if not norm:
        return None
    q = db.query(models.Product).filter(func.lower(models.Product.sku) == norm.lower())
    if exclude_id is not None:
        q = q.filter(models.Product.id != exclude_id)
    return q.first()


def sku_conflict_detail(existing: models.Product) -> dict:
    return {
        "code": "SKU_EXISTS",
        "message": "Артикул уже используется другим товаром",
        "product_id": existing.id,
        "sku": existing.sku,
        "name": existing.name,
        "brand": existing.brand,
        "barcode": existing.barcode,
        "is_active": bool(existing.is_active),
    }

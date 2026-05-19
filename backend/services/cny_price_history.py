"""Запись и чтение истории закупочных цен в ¥."""

from decimal import Decimal

from sqlalchemy.orm import Session

import models


def record_cny_price_history(
    db: Session,
    *,
    barcode: str | None,
    cny_price,
    delivery_cost_kzt=None,
    product_id: int | None = None,
) -> models.ProductCnyPriceHistory | None:
    code = (barcode or "").strip()
    if not code:
        return None
    try:
        cny = Decimal(str(cny_price))
    except Exception:
        return None
    if cny <= 0:
        return None

    del_val = None
    if delivery_cost_kzt is not None:
        try:
            d = Decimal(str(delivery_cost_kzt))
            if d > 0:
                del_val = d
        except Exception:
            pass

    recent = (
        db.query(models.ProductCnyPriceHistory)
        .filter(models.ProductCnyPriceHistory.barcode == code)
        .order_by(models.ProductCnyPriceHistory.created_at.desc())
        .first()
    )
    if recent is not None:
        same_cny = Decimal(str(recent.cny_price)) == cny
        recent_del = Decimal(str(recent.delivery_cost_kzt or 0))
        same_del = recent_del == (del_val or Decimal("0"))
        if same_cny and same_del:
            if product_id and recent.product_id is None:
                recent.product_id = product_id
            return recent

    row = models.ProductCnyPriceHistory(
        product_id=product_id,
        barcode=code,
        cny_price=cny,
        delivery_cost_kzt=del_val,
    )
    db.add(row)
    return row

from datetime import datetime
from decimal import Decimal
import os

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session, joinedload

import models
import schemas
from database import get_db
from services.telegram_orders import send_new_order_notification

router = APIRouter(prefix="/api/v1/public", tags=["public"])

SITE_NEW_ORDER_STATUS = "Новый заказ с сайта"


@router.get("/products", response_model=list[schemas.PublicProductResponse])
def list_public_products(
    db: Session = Depends(get_db),
    q: str | None = Query(None),
    category_id: int | None = Query(None, ge=1),
    in_stock: bool | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    query = db.query(models.Product).filter(models.Product.is_active.is_(True))
    if q:
        term = q.strip()
        if term:
            query = query.filter(models.Product.name.ilike(f"%{term}%"))
    if category_id:
        query = query.filter(models.Product.category_id == category_id)
    if in_stock is True:
        query = query.filter(models.Product.quantity > 0)
    elif in_stock is False:
        query = query.filter(models.Product.quantity <= 0)
    return query.order_by(models.Product.id.desc()).offset(offset).limit(limit).all()


@router.post(
    "/orders",
    response_model=schemas.PublicOrderCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_public_order(payload: schemas.PublicOrderCreate, db: Session = Depends(get_db)):
    if not payload.items:
        raise HTTPException(status_code=400, detail="invalid payload: empty items")

    reserve_stock = os.getenv("PUBLIC_ORDER_RESERVE_STOCK_IMMEDIATELY", "false").lower() in ("1", "true", "yes")
    product_ids = {i.product_id for i in payload.items}
    products = (
        db.query(models.Product)
        .filter(models.Product.id.in_(product_ids), models.Product.is_active.is_(True))
        .with_for_update()
        .all()
    )
    by_id = {p.id: p for p in products}
    missing = [pid for pid in product_ids if pid not in by_id]
    if missing:
        raise HTTPException(status_code=404, detail=f"product not found: {missing[0]}")

    total = Decimal("0")
    for item in payload.items:
        p = by_id[item.product_id]
        if item.quantity <= 0:
            raise HTTPException(status_code=400, detail="invalid payload: quantity must be > 0")
        if item.quantity > (p.quantity or 0):
            raise HTTPException(status_code=409, detail=f"not enough stock for product_id={p.id}")
        total += Decimal(str(p.sale_price or 0)) * item.quantity

    order_code = f"WEB-{int(datetime.utcnow().timestamp())}"
    reserve = models.Reserve(
        order_code=order_code,
        customer_name=payload.customer_name.strip(),
        customer_phone=payload.customer_phone.strip(),
        source="website",
        status=SITE_NEW_ORDER_STATUS,
        total_amount_cny=Decimal("0"),
        total_amount_kzt=total,
        total_amount=total,
        cny_rate=1.0,
        notes=payload.comment,
    )
    db.add(reserve)
    db.flush()

    for item in payload.items:
        p = by_id[item.product_id]
        line_total = Decimal(str(p.sale_price or 0)) * item.quantity
        reserve_item = models.ReserveItem(
            reserve_id=reserve.id,
            product_id=p.id,
            product_name=p.name,
            quantity_ordered=item.quantity,
            quantity_received=0,
            quantity=item.quantity,
            price_cny=Decimal("0"),
            price_kzt=Decimal(str(p.sale_price or 0)),
            sale_price_snapshot=Decimal(str(p.sale_price or 0)),
            line_total=line_total,
        )
        db.add(reserve_item)
        if reserve_stock:
            p.quantity = max(0, (p.quantity or 0) - item.quantity)

    db.add(
        models.History(
            product_id=None,
            operation_type=models.OperationType.ORDERED.value,
            reference_type="reserve",
            reference_id=reserve.id,
            details={"source": "website", "status": SITE_NEW_ORDER_STATUS},
        )
    )
    db.commit()
    db.refresh(reserve)
    reserve = (
        db.query(models.Reserve)
        .options(joinedload(models.Reserve.items))
        .filter(models.Reserve.id == reserve.id)
        .first()
    )
    try:
        send_new_order_notification(db, reserve)
    except Exception:
        # создание заказа не должно падать из-за telegram
        pass
    return schemas.PublicOrderCreateResponse(ok=True, reserve_id=reserve.id)

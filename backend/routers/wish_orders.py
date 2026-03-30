"""
Wish Orders router — handles the "Нужно заказать" (WishItem) and
"Заказано / В пути" (PurchaseOrder) flows for the Reserve section.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status as http_status
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import datetime
from decimal import Decimal
from typing import List, Optional
import time

import models
import schemas
from database import get_db

router = APIRouter(tags=["wish_orders"])


# ─────────────────────────────────────────────────────────────────────────────
# WISH ITEMS — «Нужно заказать»
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/api/v1/wish-items/", response_model=List[schemas.WishItemResponse])
def list_wish_items(
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(models.WishItem)
    if status:
        q = q.filter(models.WishItem.status == status)
    return q.order_by(desc(models.WishItem.created_at)).all()


@router.post(
    "/api/v1/wish-items/",
    response_model=schemas.WishItemResponse,
    status_code=http_status.HTTP_201_CREATED,
)
def create_wish_item(payload: schemas.WishItemCreate, db: Session = Depends(get_db)):
    item = models.WishItem(**payload.model_dump())
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/api/v1/wish-items/{item_id}", response_model=schemas.WishItemResponse)
def update_wish_item(
    item_id: int, payload: schemas.WishItemUpdate, db: Session = Depends(get_db)
):
    item = db.query(models.WishItem).filter(models.WishItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="WishItem not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(item, k, v)
    db.commit()
    db.refresh(item)
    return item


@router.delete("/api/v1/wish-items/{item_id}", status_code=http_status.HTTP_204_NO_CONTENT)
def delete_wish_item(item_id: int, db: Session = Depends(get_db)):
    item = db.query(models.WishItem).filter(models.WishItem.id == item_id).first()
    if not item:
        raise HTTPException(status_code=404, detail="WishItem not found")
    db.delete(item)
    db.commit()


# ─────────────────────────────────────────────────────────────────────────────
# PURCHASE ORDERS — «Заказано / В пути»
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/api/v1/purchase-orders/", response_model=List[schemas.PurchaseOrderResponse])
def list_purchase_orders(
    status: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    q = db.query(models.PurchaseOrder)
    if status:
        q = q.filter(models.PurchaseOrder.status == status)
    return q.order_by(desc(models.PurchaseOrder.ordered_at)).all()


@router.post(
    "/api/v1/purchase-orders/",
    response_model=schemas.PurchaseOrderResponse,
    status_code=http_status.HTTP_201_CREATED,
)
def create_purchase_order(payload: schemas.PurchaseOrderCreate, db: Session = Depends(get_db)):
    order = models.PurchaseOrder(**payload.model_dump())
    db.add(order)

    # Mark the source WishItem as ordered
    if payload.wish_item_id:
        wish = db.query(models.WishItem).filter(
            models.WishItem.id == payload.wish_item_id
        ).first()
        if wish:
            wish.status = 'ordered'

    db.commit()
    db.refresh(order)
    return order


@router.put(
    "/api/v1/purchase-orders/{order_id}",
    response_model=schemas.PurchaseOrderResponse,
)
def update_purchase_order(
    order_id: int, payload: schemas.PurchaseOrderUpdate, db: Session = Depends(get_db)
):
    order = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="PurchaseOrder not found")
    for k, v in payload.model_dump(exclude_unset=True).items():
        setattr(order, k, v)
    db.commit()
    db.refresh(order)
    return order


@router.post("/api/v1/purchase-orders/{order_id}/accept")
def accept_to_stock(
    order_id: int, payload: schemas.AcceptToStockPayload, db: Session = Depends(get_db)
):
    """
    Accept goods from a purchase order into the warehouse catalog.
    Supports partial receipt — if received < ordered the order stays 'partial'.
    """
    order = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="PurchaseOrder not found")
    if order.status == 'completed':
        raise HTTPException(status_code=400, detail="Order already fully received")

    qty = payload.quantity_received
    remaining_ordered = order.quantity_ordered - order.quantity_received

    if qty > remaining_ordered:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot receive {qty} — only {remaining_ordered} remaining in this order",
        )

    # ── Create product in catalog ─────────────────────────────────────────
    sku = f"PO-{order_id}-{int(time.time())}"
    new_product = models.Product(
        name=order.name,
        sku=sku,
        barcode=order.barcode,
        brand=order.brand,
        category=order.category,
        purchase_price=payload.purchase_price_kzt,
        delivery_cost_kzt=payload.delivery_cost_kzt or Decimal('0'),
        sale_price=payload.sale_price_kzt,
        quantity=qty,
        supplier=order.supplier,
        location_zone=payload.storage_location,
        description=payload.notes or order.notes,
        is_active=True,
    )
    db.add(new_product)

    # ── Update order ──────────────────────────────────────────────────────
    order.quantity_received += qty
    if not payload.keep_remainder or order.quantity_received >= order.quantity_ordered:
        order.status = 'completed'
        order.completed_at = datetime.utcnow()
    else:
        order.status = 'partial'

    # ── History log ───────────────────────────────────────────────────────
    db.flush()
    hist = models.History(
        product_id=new_product.id,
        operation_type=models.OperationType.TO_STOCK,
        quantity_change=qty,
        reference_type='purchase_order',
        reference_id=order_id,
        details={"order_name": order.name, "qty": qty},
    )
    db.add(hist)

    db.commit()
    db.refresh(order)
    return {
        "message": "Товар добавлен в склад",
        "product_id": new_product.id,
        "order": schemas.PurchaseOrderResponse.model_validate(order),
    }


@router.post("/api/v1/purchase-orders/{order_id}/cancel")
def cancel_purchase_order(order_id: int, db: Session = Depends(get_db)):
    order = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="PurchaseOrder not found")
    order.status = 'cancelled'
    db.commit()
    return {"message": "Заказ отменён"}


@router.post("/api/v1/purchase-orders/{order_id}/restore")
def restore_purchase_order(order_id: int, db: Session = Depends(get_db)):
    order = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="PurchaseOrder not found")
    if order.status != 'cancelled':
        raise HTTPException(status_code=400, detail="Only cancelled orders can be restored")
    order.status = 'in_transit'
    db.commit()
    return {"message": "Заказ восстановлен"}


@router.delete(
    "/api/v1/purchase-orders/{order_id}",
    status_code=http_status.HTTP_204_NO_CONTENT,
)
def delete_purchase_order(order_id: int, db: Session = Depends(get_db)):
    order = db.query(models.PurchaseOrder).filter(models.PurchaseOrder.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="PurchaseOrder not found")
    db.delete(order)
    db.commit()

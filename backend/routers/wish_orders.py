"""
Wish Orders router — handles the "Нужно заказать" (WishItem) and
"Заказано / В пути" (PurchaseOrder) flows for the Reserve section.
"""
from fastapi import APIRouter, Depends, HTTPException, Query, status as http_status
from sqlalchemy.orm import Session
from sqlalchemy import desc
from datetime import UTC, datetime
from decimal import Decimal
from typing import List, Optional
import time

import models
import schemas
from database import get_db
from dependencies import require_manager_or_admin
from services.category_attributes import (
    get_category_schema,
    sync_category_text,
    validate_attributes_for_category,
)
from services.form_layout import (
    display_layout_from_form_layout,
    normalize_form_layout,
    resolve_category_profile,
    sync_custom_fields_to_attributes,
)
from services.product_compatibility import apply_product_compatibility

router = APIRouter(
    tags=["wish_orders"],
    dependencies=[Depends(require_manager_or_admin)],
)


def _resolve_category_id(db: Session, data: dict) -> dict:
    """Если передан category_id — подставить имя подкатегории в category."""
    cid = data.get("category_id")
    if cid is None:
        return data
    cat = db.query(models.Category).filter(models.Category.id == int(cid)).first()
    if not cat:
        raise HTTPException(status_code=422, detail="Категория не найдена")
    if cat.parent_id is None:
        raise HTTPException(status_code=422, detail="Выберите подкатегорию, не группу")
    data["category"] = cat.name
    return data


def _validate_engine_families_for_category(
    db: Session,
    category_id: int | None,
    engine_family_ids: list | None,
) -> None:
    if not category_id:
        return
    schema = get_category_schema(db, category_id) or {}
    profile = resolve_category_profile(schema)
    ecm = profile.get("engine_code_mode")
    if ecm not in ("required", "required_single"):
        return
    ids = [int(x) for x in (engine_family_ids or []) if x]
    if ecm == "required_single":
        if len(ids) != 1:
            raise HTTPException(
                status_code=422,
                detail="Для этой категории укажите ровно один код мотора",
            )
        return
    if not ids:
        raise HTTPException(
            status_code=422,
            detail="Для этой категории обязателен хотя бы один код мотора",
        )


def _build_product_payload_from_accept(
    db: Session,
    order: models.PurchaseOrder,
    payload: schemas.AcceptToStockPayload,
) -> dict:
    """Собрать поля товара при приёмке из заказа поставщика."""
    category_id = order.category_id
    product_data: dict = {
        "category_id": category_id,
        "category": order.category,
        "brand": payload.brand if payload.brand is not None else order.brand,
        "attributes": payload.attributes,
    }
    sync_category_text(db, product_data)

    if category_id:
        schema = get_category_schema(db, category_id) or {}
        attrs = validate_attributes_for_category(
            db, category_id, product_data.get("attributes"), strict=False
        )
        form_layout = normalize_form_layout(schema.get("form_layout"), schema)
        product_data["display_layout"] = display_layout_from_form_layout(form_layout, schema)
        merged_attrs = sync_custom_fields_to_attributes(
            product_data["display_layout"], attrs
        )
        if merged_attrs is not None:
            product_data["attributes"] = validate_attributes_for_category(
                db, category_id, merged_attrs, strict=False
            )
        product_data["needs_category_refresh"] = False

    return product_data


# ─────────────────────────────────────────────────────────────────────────────
# WISH ITEMS — «Нужно заказать»
# ─────────────────────────────────────────────────────────────────────────────
@router.get("/api/v1/wish-items/", response_model=List[schemas.WishItemResponse])
def list_wish_items(
    status: Optional[str] = Query(None),
    category_id: Optional[int] = Query(None, ge=1),
    db: Session = Depends(get_db),
):
    q = db.query(models.WishItem)
    if status:
        q = q.filter(models.WishItem.status == status)
    if category_id is not None:
        q = q.filter(models.WishItem.category_id == category_id)
    return q.order_by(desc(models.WishItem.created_at)).all()


@router.post(
    "/api/v1/wish-items/",
    response_model=schemas.WishItemResponse,
    status_code=http_status.HTTP_201_CREATED,
)
def create_wish_item(payload: schemas.WishItemCreate, db: Session = Depends(get_db)):
    data = _resolve_category_id(db, payload.model_dump())
    item = models.WishItem(**data)
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
    data = payload.model_dump(exclude_unset=True)
    if "category_id" in data:
        data = _resolve_category_id(db, data)
    for k, v in data.items():
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
    category_id: Optional[int] = Query(None, ge=1),
    db: Session = Depends(get_db),
):
    q = db.query(models.PurchaseOrder)
    if status:
        q = q.filter(models.PurchaseOrder.status == status)
    if category_id is not None:
        q = q.filter(models.PurchaseOrder.category_id == category_id)
    return q.order_by(desc(models.PurchaseOrder.ordered_at)).all()


@router.post(
    "/api/v1/purchase-orders/",
    response_model=schemas.PurchaseOrderResponse,
    status_code=http_status.HTTP_201_CREATED,
)
def create_purchase_order(payload: schemas.PurchaseOrderCreate, db: Session = Depends(get_db)):
    data = _resolve_category_id(db, payload.model_dump())
    order = models.PurchaseOrder(**data)
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

    category_id = order.category_id
    v_ids = payload.compatibility_vehicle_model_ids
    e_ids = payload.compatibility_engine_family_ids
    _validate_engine_families_for_category(db, category_id, e_ids)

    product_extra = _build_product_payload_from_accept(db, order, payload)

    # ── Create product in catalog ─────────────────────────────────────────
    sku = f"PO-{order_id}-{int(time.time())}"
    new_product = models.Product(
        name=order.name,
        sku=sku,
        barcode=order.barcode,
        brand=product_extra.get("brand") or order.brand,
        model=payload.model,
        category=product_extra.get("category") or order.category,
        category_id=product_extra.get("category_id"),
        attributes=product_extra.get("attributes"),
        display_layout=product_extra.get("display_layout"),
        needs_category_refresh=product_extra.get("needs_category_refresh", True),
        purchase_price=payload.purchase_price_kzt,
        delivery_cost_kzt=payload.delivery_cost_kzt or Decimal('0'),
        sale_price=payload.sale_price_kzt,
        quantity=qty,
        supplier=order.supplier,
        location_zone=payload.storage_location,
        description=payload.notes or order.notes,
        is_active=True,
        received_at=datetime.now(UTC),
    )
    db.add(new_product)
    db.flush()

    apply_product_compatibility(
        db,
        new_product,
        vehicle_model_ids=v_ids,
        engine_family_ids=e_ids,
    )

    # ── Update order ──────────────────────────────────────────────────────
    order.quantity_received += qty
    if not payload.keep_remainder or order.quantity_received >= order.quantity_ordered:
        order.status = 'completed'
        order.completed_at = datetime.now(UTC)
    else:
        order.status = 'partial'

    # ── History log ───────────────────────────────────────────────────────
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

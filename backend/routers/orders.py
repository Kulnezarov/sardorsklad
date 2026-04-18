from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session, joinedload

import models
import schemas
from database import get_db
from dependencies import require_manager_or_admin
from services.audit import write_audit_log
from services.telegram_orders import retry_failed_notifications

router = APIRouter(
    prefix="/api/v1/orders",
    tags=["orders"],
    dependencies=[Depends(require_manager_or_admin)],
)

# Согласовано с витриной: новый заказ → «Выдано» (списание) или «Отменен»
STATUS_NEW = "Новый заказ"
STATUS_NEW_LEGACY = "Новый заказ с сайта"  # старые записи до переименования
STATUS_ISSUED = "Выдано"
STATUS_CANCELLED = "Отменен"


def _is_new_order_status(s: str) -> bool:
    return s in (STATUS_NEW, STATUS_NEW_LEGACY)


@router.get("/", response_model=list[schemas.ReserveResponse])
def list_orders(
    db: Session = Depends(get_db),
    status: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    customer: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=500),
):
    q = db.query(models.Reserve).options(joinedload(models.Reserve.items))
    if status:
        q = q.filter(models.Reserve.status == status)
    if source:
        q = q.filter(models.Reserve.source == source)
    if customer:
        q = q.filter(
            (models.Reserve.customer_name.ilike(f"%{customer}%"))
            | (models.Reserve.customer_phone.ilike(f"%{customer}%"))
        )
    if date_from:
        q = q.filter(models.Reserve.created_at >= date_from)
    if date_to:
        q = q.filter(models.Reserve.created_at <= date_to)
    return q.order_by(desc(models.Reserve.created_at)).offset(skip).limit(limit).all()


@router.get("/{order_id}", response_model=schemas.ReserveResponse)
def get_order(order_id: int, db: Session = Depends(get_db)):
    order = (
        db.query(models.Reserve)
        .options(joinedload(models.Reserve.items))
        .filter(models.Reserve.id == order_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    return order


@router.put("/{order_id}/status", response_model=schemas.ReserveResponse)
def update_order_status(
    order_id: int,
    payload: schemas.OrderStatusUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_manager_or_admin),
):
    new_status = payload.status.strip()
    order = (
        db.query(models.Reserve)
        .options(joinedload(models.Reserve.items))
        .filter(models.Reserve.id == order_id)
        .first()
    )
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")

    prev = order.status

    if new_status == prev:
        return order

    if new_status == STATUS_ISSUED:
        if not _is_new_order_status(prev):
            raise HTTPException(
                status_code=400,
                detail="Выдать можно только заказ в статусе «Новый заказ»",
            )
        for it in order.items:
            qty = it.quantity if it.quantity is not None else it.quantity_ordered
            if qty and qty > 0 and not it.product_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Позиция «{it.product_name}» не привязана к товару — выдача невозможна",
                )

        product_ids = list({it.product_id for it in order.items if it.product_id})
        products = (
            db.query(models.Product)
            .filter(models.Product.id.in_(product_ids))
            .with_for_update()
            .all()
        )
        by_id = {p.id: p for p in products}

        for it in order.items:
            if not it.product_id:
                continue
            p = by_id.get(it.product_id)
            if not p:
                raise HTTPException(status_code=404, detail=f"Товар id={it.product_id} не найден")
            qty = it.quantity if it.quantity is not None else it.quantity_ordered
            if qty <= 0:
                continue
            if (p.quantity or 0) < qty:
                raise HTTPException(
                    status_code=409,
                    detail=f"Недостаточно «{p.name}» на складе: есть {p.quantity}, нужно {qty}",
                )

        now = datetime.now(timezone.utc)
        for it in order.items:
            if not it.product_id:
                continue
            qty = it.quantity if it.quantity is not None else it.quantity_ordered
            if qty <= 0:
                continue
            p = by_id[it.product_id]
            p.quantity = max(0, (p.quantity or 0) - qty)
            p.last_sale_date = now
            db.add(
                models.History(
                    product_id=p.id,
                    operation_type=models.OperationType.SOLD.value,
                    quantity_change=-qty,
                    reference_type="reserve",
                    reference_id=order.id,
                    details={
                        "message": f"Выдача заказа {order.order_code}",
                        "order_id": order.id,
                        "by_user_id": current_user.id,
                    },
                )
            )

        order.status = STATUS_ISSUED
        order.completed_at = now

    elif new_status == STATUS_CANCELLED:
        if not _is_new_order_status(prev):
            raise HTTPException(
                status_code=400,
                detail="Отменить можно только заказ в статусе «Новый заказ»",
            )
        order.status = STATUS_CANCELLED

    else:
        raise HTTPException(
            status_code=400,
            detail='Укажите статус «Выдано» (списать товар со склада) или «Отменен»',
        )

    write_audit_log(
        db,
        user_id=current_user.id,
        action="UPDATE_ORDER_STATUS",
        entity_type="order",
        entity_id=order_id,
        payload={"before": prev, "after": order.status},
    )
    db.add(
        models.History(
            product_id=None,
            operation_type=models.OperationType.EDITED.value,
            reference_type="reserve",
            reference_id=order_id,
            details={"status_before": prev, "status_after": order.status, "by_user_id": current_user.id},
        )
    )
    db.commit()
    return (
        db.query(models.Reserve)
        .options(joinedload(models.Reserve.items))
        .filter(models.Reserve.id == order_id)
        .first()
    )


@router.post("/notifications/retry")
def retry_order_notifications(db: Session = Depends(get_db)):
    sent = retry_failed_notifications(db)
    return {"ok": True, "sent": sent}

from datetime import datetime, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc
from sqlalchemy.orm import Session, joinedload

import models
import schemas
from database import get_db
from dependencies import require_manager_or_admin
from services.audit import write_audit_log
from services.customer_notifications import notify_order_cancelled
from services.telegram_orders import resend_order_notification, retry_failed_notifications

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


def _item_line_status(it: models.ReserveItem) -> str:
    return (getattr(it, "line_status", None) or "pending").strip() or "pending"


def _active_items(order: models.Reserve) -> list[models.ReserveItem]:
    return [it for it in (order.items or []) if _item_line_status(it) != "cancelled"]


def _line_amount(it: models.ReserveItem) -> Decimal:
    if it.line_total is not None:
        return Decimal(str(it.line_total))
    qty = it.quantity if it.quantity is not None else it.quantity_ordered
    price = it.sale_price_snapshot if it.sale_price_snapshot is not None else it.price_kzt
    return Decimal(str(price or 0)) * Decimal(str(qty or 0))


def _recalc_order_total(order: models.Reserve) -> None:
    total = sum((_line_amount(it) for it in _active_items(order)), start=Decimal("0"))
    order.total_amount = total
    order.total_amount_kzt = total


def _load_order(db: Session, order_id: int) -> models.Reserve | None:
    return (
        db.query(models.Reserve)
        .options(joinedload(models.Reserve.items))
        .filter(models.Reserve.id == order_id)
        .first()
    )


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
        if status == STATUS_NEW:
            q = q.filter(models.Reserve.status.in_([STATUS_NEW, STATUS_NEW_LEGACY]))
        else:
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
            if _item_line_status(it) == "cancelled":
                continue
            qty = it.quantity if it.quantity is not None else it.quantity_ordered
            if qty and qty > 0 and not it.product_id:
                raise HTTPException(
                    status_code=400,
                    detail=f"Позиция «{it.product_name}» не привязана к товару — выдача невозможна",
                )

        product_ids = list(
            {it.product_id for it in order.items if it.product_id and _item_line_status(it) != "cancelled"}
        )
        products = (
            db.query(models.Product)
            .filter(models.Product.id.in_(product_ids))
            .with_for_update()
            .all()
        )
        by_id = {p.id: p for p in products}

        for it in order.items:
            if _item_line_status(it) == "cancelled":
                continue
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

        if not _active_items(order):
            raise HTTPException(status_code=400, detail="Нет активных позиций для выдачи")

        now = datetime.now(timezone.utc)
        for it in order.items:
            if _item_line_status(it) == "cancelled":
                continue
            if not it.product_id:
                continue
            qty = it.quantity if it.quantity is not None else it.quantity_ordered
            if qty <= 0:
                continue
            p = by_id[it.product_id]
            p.quantity = max(0, (p.quantity or 0) - qty)
            p.last_sale_date = now
            it.line_status = "fulfilled"
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
        if payload.cancellation_reason is None:
            raise HTTPException(
                status_code=400,
                detail="Укажите причину отмены (cancellation_reason)",
            )
        cmt = (payload.cancellation_comment or "").strip()
        if payload.cancellation_reason == schemas.CancellationReasonCode.other and len(cmt) < 1:
            raise HTTPException(
                status_code=400,
                detail="Для причины «другое» укажите комментарий (cancellation_comment)",
            )
        order.cancellation_reason_code = payload.cancellation_reason.value
        order.cancellation_comment = cmt or None
        order.cancelled_by_user_id = current_user.id
        order.cancelled_at = datetime.now(timezone.utc)
        order.status = STATUS_CANCELLED
        for it in order.items:
            if _item_line_status(it) not in ("cancelled", "fulfilled"):
                it.line_status = "cancelled"
        _recalc_order_total(order)
        try:
            notify_order_cancelled(db, order)
        except Exception as ne:
            # не блокируем смену статуса, если уведомление не записалось
            import logging

            logging.getLogger(__name__).warning("customer notify: %s", ne)

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


@router.post("/{order_id}/items/{item_id}/cancel", response_model=schemas.ReserveResponse)
def cancel_order_item(
    order_id: int,
    item_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_manager_or_admin),
):
    order = _load_order(db, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    if not _is_new_order_status(order.status):
        raise HTTPException(status_code=400, detail="Отменить позицию можно только в новом заказе")

    item = next((it for it in order.items if it.id == item_id), None)
    if not item:
        raise HTTPException(status_code=404, detail="Позиция не найдена")
    if _item_line_status(item) == "cancelled":
        return order

    item.line_status = "cancelled"
    _recalc_order_total(order)

    if not _active_items(order):
        order.status = STATUS_CANCELLED
        order.cancellation_reason_code = schemas.CancellationReasonCode.out_of_stock.value
        order.cancellation_comment = "Все позиции отменены на складе"
        order.cancelled_by_user_id = current_user.id
        order.cancelled_at = datetime.now(timezone.utc)
        try:
            notify_order_cancelled(db, order)
        except Exception:
            pass

    write_audit_log(
        db,
        user_id=current_user.id,
        action="CANCEL_ORDER_ITEM",
        entity_type="order",
        entity_id=order_id,
        payload={"item_id": item_id, "product_name": item.product_name},
    )
    db.commit()
    return _load_order(db, order_id)


@router.post("/{order_id}/notifications/retry")
def retry_order_notification(order_id: int, db: Session = Depends(get_db)):
    order = _load_order(db, order_id)
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    ok = resend_order_notification(db, order)
    if not ok:
        raise HTTPException(status_code=503, detail="Telegram не настроен или отправка не удалась")
    return {"ok": True, "order_id": order_id}


@router.post("/notifications/retry")
def retry_order_notifications(
    db: Session = Depends(get_db),
    reserve_id: Optional[int] = Query(None),
):
    sent = retry_failed_notifications(db, reserve_id=reserve_id)
    return {"ok": True, "sent": sent}

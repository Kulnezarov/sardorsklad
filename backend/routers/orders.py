from datetime import datetime
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
    order = db.query(models.Reserve).filter(models.Reserve.id == order_id).first()
    if not order:
        raise HTTPException(status_code=404, detail="Order not found")
    prev = order.status
    order.status = payload.status.strip()
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
    db.refresh(order)
    return order


@router.post("/notifications/retry")
def retry_order_notifications(db: Session = Depends(get_db)):
    sent = retry_failed_notifications(db)
    return {"ok": True, "sent": sent}

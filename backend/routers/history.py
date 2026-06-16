from datetime import UTC, datetime, timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import String, cast, desc, or_
from sqlalchemy.orm import Session, joinedload

import models
import schemas
from database import get_db
from dependencies import require_manager_or_admin

router = APIRouter(
    prefix="/api/v1/history",
    tags=["history"],
    dependencies=[Depends(require_manager_or_admin)],
)


@router.get("/", response_model=List[schemas.HistoryResponse])
def list_history(
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    operation_type: Optional[str] = Query(None),
    product_id: Optional[int] = Query(None),
    reference_type: Optional[str] = Query(None),
    search: Optional[str] = Query(None, min_length=1, max_length=200),
):
    query = db.query(models.History).options(joinedload(models.History.product))

    if operation_type:
        query = query.filter(models.History.operation_type == operation_type)
    if product_id:
        query = query.filter(models.History.product_id == product_id)
    if reference_type:
        query = query.filter(models.History.reference_type == reference_type)

    if search and search.strip():
        term = f"%{search.strip()}%"
        product_match = (
            db.query(models.Product.id)
            .filter(
                or_(
                    models.Product.name.ilike(term),
                    models.Product.sku.ilike(term),
                    models.Product.barcode.ilike(term),
                )
            )
            .subquery()
        )
        query = query.filter(
            or_(
                models.History.product_id.in_(product_match),
                cast(models.History.details, String).ilike(term),
            )
        )

    return query.order_by(desc(models.History.created_at)).offset(skip).limit(limit).all()


@router.delete("/{history_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_history(history_id: int, db: Session = Depends(get_db)):
    record = db.query(models.History).filter(models.History.id == history_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="History record not found")
    db.delete(record)
    db.commit()
    return None


@router.delete("/")
def clear_all_history(db: Session = Depends(get_db)):
    count = db.query(models.History).count()
    db.query(models.History).delete()
    db.commit()
    return {"message": f"Deleted {count} history records"}


@router.post("/cleanup")
def cleanup_old_history(db: Session = Depends(get_db)):
    settings = db.query(models.Settings).first()
    retention_days = settings.history_auto_clean_days if settings else 30
    cutoff_date = datetime.now(UTC) - timedelta(days=retention_days)

    count = db.query(models.History).filter(models.History.created_at < cutoff_date).count()
    db.query(models.History).filter(models.History.created_at < cutoff_date).delete()
    db.commit()

    return {
        "message": f"Deleted {count} old records",
        "retention_days": retention_days,
        "cutoff_date": cutoff_date.isoformat(),
    }

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import desc, and_
from datetime import UTC, datetime
from typing import List, Optional
from decimal import Decimal
import time

import models
import schemas
from database import get_db
from dependencies import require_manager_or_admin

router = APIRouter(
    prefix="/api/v1/reserves",
    tags=["reserves"],
    dependencies=[Depends(require_manager_or_admin)],
)


# ============================================================================
# HELPER: Get CNY exchange rate from settings
# ============================================================================
def get_cny_rate(db: Session) -> float:
    """Get current CNY to KZT exchange rate."""
    settings = db.query(models.Settings).first()
    return settings.cny_exchange_rate if settings else 1.0


# ============================================================================
# GET OPERATIONS
# ============================================================================
@router.get("/", response_model=List[schemas.ReserveResponse])
def list_reserves(
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    status: Optional[str] = Query(None),
    customer: Optional[str] = Query(None),
):
    """List reserves/orders with filters."""
    query = db.query(models.Reserve)

    if status:
        query = query.filter(models.Reserve.status == status)

    if customer:
        query = query.filter(models.Reserve.customer_name.ilike(f"%{customer}%"))

    query = query.order_by(desc(models.Reserve.created_at))
    return query.offset(skip).limit(limit).all()


@router.get("/{reserve_id}", response_model=schemas.ReserveResponse)
def get_reserve(reserve_id: int, db: Session = Depends(get_db)):
    """Get reserve with all items."""
    reserve = db.query(models.Reserve).filter(models.Reserve.id == reserve_id).first()
    if not reserve:
        raise HTTPException(status_code=404, detail="Reserve not found")
    return reserve


@router.get("/status/{status}")
def list_by_status(
    status: str,
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
):
    """Get reserves by status."""
    valid_statuses = [s.value for s in models.ReserveStatus]
    if status not in valid_statuses:
        raise HTTPException(status_code=400, detail=f"Invalid status. Must be one of {valid_statuses}")

    query = db.query(models.Reserve).filter(
        models.Reserve.status == status
    ).order_by(desc(models.Reserve.created_at))

    return query.offset(skip).limit(limit).all()


# ============================================================================
# CREATE OPERATIONS
# ============================================================================
@router.post("/", response_model=schemas.ReserveResponse, status_code=status.HTTP_201_CREATED)
def create_reserve(
    reserve: schemas.ReserveCreate,
    db: Session = Depends(get_db),
):
    """
    Create a new reserve/order.

    - Auto-generates order code: ORD-{timestamp}
    - Converts CNY to KZT using current rate
    - Creates reserve items
    - Logs in history
    """
    if not reserve.items:
        raise HTTPException(status_code=400, detail="Reserve must have at least one item")

    # Get exchange rate
    cny_rate = get_cny_rate(db)

    # Calculate totals
    total_cny = Decimal('0')
    items_to_create = []

    for item in reserve.items:
        total_cny += item.price_cny * item.quantity_ordered
        items_to_create.append(item)

    # Convert to KZT
    total_kzt = total_cny * Decimal(str(cny_rate))

    # Generate order code
    order_code = f"ORD-{int(datetime.now(UTC).timestamp())}"

    # Create reserve
    db_reserve = models.Reserve(
        order_code=order_code,
        customer_name=reserve.customer_name,
        customer_phone=reserve.customer_phone,
        status=models.ReserveStatus.PENDING,
        total_amount_cny=total_cny,
        total_amount_kzt=total_kzt,
        cny_rate=cny_rate,
        expected_arrival=reserve.expected_arrival,
        notes=reserve.notes,
    )
    db.add(db_reserve)
    db.flush()

    # Create reserve items
    for item in items_to_create:
        price_kzt = item.price_cny * Decimal(str(cny_rate))

        reserve_item = models.ReserveItem(
            reserve_id=db_reserve.id,
            product_id=item.product_id,
            product_name=item.product_name,
            quantity_ordered=item.quantity_ordered,
            price_cny=item.price_cny,
            price_kzt=price_kzt,
        )
        db.add(reserve_item)

        # Log in history
        history = models.History(
            product_id=item.product_id,
            operation_type=models.OperationType.ORDERED,
            reference_type='reserve',
            reference_id=db_reserve.id,
            description=f"Order created: {item.quantity_ordered}x {item.product_name}",
        )
        db.add(history)

    db.commit()
    db.refresh(db_reserve)

    return db_reserve


# ============================================================================
# UPDATE OPERATIONS
# ============================================================================
@router.put("/{reserve_id}", response_model=schemas.ReserveResponse)
def update_reserve(
    reserve_id: int,
    reserve_update: schemas.ReserveUpdate,
    db: Session = Depends(get_db),
):
    """Update reserve details."""
    db_reserve = db.query(models.Reserve).filter(models.Reserve.id == reserve_id).first()
    if not db_reserve:
        raise HTTPException(status_code=404, detail="Reserve not found")

    update_data = reserve_update.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        setattr(db_reserve, field, value)

    db.commit()
    db.refresh(db_reserve)

    return db_reserve


@router.post("/{reserve_id}/to-stock")
def move_to_stock(
    reserve_id: int,
    db: Session = Depends(get_db),
):
    """
    Move reserve items to stock.

    - Creates products if they don't exist
    - Sets reserve status to 'in_stock'
    - Logs operation in history
    """
    db_reserve = db.query(models.Reserve).filter(models.Reserve.id == reserve_id).first()
    if not db_reserve:
        raise HTTPException(status_code=404, detail="Reserve not found")

    if db_reserve.status == models.ReserveStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Reserve already completed")

    # Process items
    for item in db_reserve.items:
        if item.product_id:
            # Update existing product
            product = db.query(models.Product).filter(
                models.Product.id == item.product_id
            ).first()
            if product:
                old_quantity = product.quantity
                product.quantity += item.quantity_received
                history = models.History(
                    product_id=product.id,
                    operation_type=models.OperationType.TO_STOCK,
                    quantity_before=old_quantity,
                    quantity_after=product.quantity,
                    reference_type='reserve',
                    reference_id=db_reserve.id,
                    description=f"Added {item.quantity_received}x {item.product_name} from order {db_reserve.order_code}",
                )
                db.add(history)
        else:
            # Create new product
            new_product = models.Product(
                name=item.product_name,
                sku=f"SKU-{int(time.time())}",  # Temporary SKU
                quantity=item.quantity_received,
                price=item.price_kzt,
            )
            db.add(new_product)
            db.flush()

            history = models.History(
                product_id=new_product.id,
                operation_type=models.OperationType.TO_STOCK,
                quantity_after=item.quantity_received,
                reference_type='reserve',
                reference_id=db_reserve.id,
                description=f"Created product from order: {item.product_name}",
            )
            db.add(history)
            item.product_id = new_product.id

    db_reserve.status = models.ReserveStatus.IN_STOCK
    db.commit()

    return {"message": "Reserve moved to stock", "reserve_id": reserve_id}


@router.post("/{reserve_id}/complete")
def complete_reserve(reserve_id: int, db: Session = Depends(get_db)):
    """Mark reserve as completed."""
    db_reserve = db.query(models.Reserve).filter(models.Reserve.id == reserve_id).first()
    if not db_reserve:
        raise HTTPException(status_code=404, detail="Reserve not found")

    db_reserve.status = models.ReserveStatus.COMPLETED
    db_reserve.completed_at = datetime.now(UTC)
    db.commit()

    return {"message": "Reserve completed"}


@router.post("/{reserve_id}/cancel")
def cancel_reserve(reserve_id: int, db: Session = Depends(get_db)):
    """Cancel a reserve."""
    db_reserve = db.query(models.Reserve).filter(models.Reserve.id == reserve_id).first()
    if not db_reserve:
        raise HTTPException(status_code=404, detail="Reserve not found")

    if db_reserve.status == models.ReserveStatus.COMPLETED:
        raise HTTPException(status_code=400, detail="Cannot cancel completed reserve")

    db_reserve.status = models.ReserveStatus.CANCELLED

    history = models.History(
        product_id=None,
        operation_type=models.OperationType.CANCELLED,
        reference_type='reserve',
        reference_id=reserve_id,
        description=f"Order cancelled: {db_reserve.order_code}",
    )
    db.add(history)
    db.commit()

    return {"message": "Reserve cancelled"}


@router.post("/{reserve_id}/restore")
def restore_reserve(reserve_id: int, db: Session = Depends(get_db)):
    """Restore a cancelled reserve."""
    db_reserve = db.query(models.Reserve).filter(models.Reserve.id == reserve_id).first()
    if not db_reserve:
        raise HTTPException(status_code=404, detail="Reserve not found")

    if db_reserve.status != models.ReserveStatus.CANCELLED:
        raise HTTPException(status_code=400, detail="Can only restore cancelled reserves")

    db_reserve.status = models.ReserveStatus.PENDING

    history = models.History(
        product_id=None,
        operation_type=models.OperationType.RESTORED,
        reference_type='reserve',
        reference_id=reserve_id,
        description=f"Order restored: {db_reserve.order_code}",
    )
    db.add(history)
    db.commit()

    return {"message": "Reserve restored"}


# ============================================================================
# DELETE OPERATIONS
# ============================================================================
@router.delete("/{reserve_id}")
def delete_reserve(reserve_id: int, db: Session = Depends(get_db)):
    """Hard delete a reserve."""
    db_reserve = db.query(models.Reserve).filter(models.Reserve.id == reserve_id).first()
    if not db_reserve:
        raise HTTPException(status_code=404, detail="Reserve not found")

    db.delete(db_reserve)
    db.commit()

    return {"message": "Reserve deleted"}


# ============================================================================
# UTILITIES
# ============================================================================
@router.get("/exchange/cny-rate")
def get_exchange_rate(db: Session = Depends(get_db)):
    """Get current CNY to KZT exchange rate."""
    rate = get_cny_rate(db)
    return {"cny_rate": rate, "timestamp": datetime.now(UTC).isoformat()}

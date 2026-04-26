from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session
from sqlalchemy import desc, and_
from datetime import UTC, datetime
from typing import List, Optional

import models
import schemas
from database import get_db
from dependencies import require_manager_or_admin

router = APIRouter(
    prefix="/api/v1/revisions",
    tags=["revisions"],
    dependencies=[Depends(require_manager_or_admin)],
)


@router.get("/", response_model=List[schemas.RevisionSessionResponse])
def list_revisions(
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
    status: Optional[str] = Query(None),
):
    """Get revision sessions."""
    query = db.query(models.RevisionSession)

    if status:
        query = query.filter(models.RevisionSession.status == status)

    query = query.order_by(desc(models.RevisionSession.created_at))
    return query.offset(skip).limit(limit).all()


@router.get("/{session_id}", response_model=schemas.RevisionSessionResponse)
def get_revision(session_id: int, db: Session = Depends(get_db)):
    """Get revision session with all items."""
    session = db.query(models.RevisionSession).filter(
        models.RevisionSession.id == session_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Revision session not found")
    return session


# ============================================================================
# START NEW REVISION SESSION
# ============================================================================
@router.post("/start", response_model=schemas.RevisionSessionResponse)
def start_revision(
    revision: schemas.RevisionSessionCreate,
    db: Session = Depends(get_db),
):
    """
    Start a new inventory revision session.

    - Loads all active products
    - Creates revision items with expected quantities
    """
    existing = db.query(models.RevisionSession).filter(
        models.RevisionSession.status == "in_progress"
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Уже есть активная ревизия")

    # Generate session code
    session_code = f"REV-{int(datetime.now(UTC).timestamp())}"

    # Create session
    db_session = models.RevisionSession(
        session_code=session_code,
        status="in_progress",
        notes=revision.notes,
    )
    db.add(db_session)
    db.flush()

    # Load all active products and create revision items
    products = db.query(models.Product).filter(models.Product.is_active == True).all()

    for product in products:
        revision_item = models.RevisionItem(
            session_id=db_session.id,
            product_id=product.id,
            quantity_expected=product.quantity,
            quantity_actual=None,  # Not counted yet
        )
        db.add(revision_item)

    db.commit()
    db.refresh(db_session)

    return db_session


# ============================================================================
# UPDATE REVISION ITEM
# ============================================================================
@router.put("/{session_id}/item/{product_id}")
def update_revision_item(
    session_id: int,
    product_id: int,
    item_update: schemas.RevisionItemUpdate,
    db: Session = Depends(get_db),
):
    """
    Update actual quantity for a product in revision.

    - Doesn't apply correction yet
    - Just records what was physically counted
    """
    session = db.query(models.RevisionSession).filter(
        models.RevisionSession.id == session_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Revision session not found")

    if session.status != "in_progress":
        raise HTTPException(status_code=400, detail="Revision is not in progress")

    revision_item = db.query(models.RevisionItem).filter(
        and_(
            models.RevisionItem.session_id == session_id,
            models.RevisionItem.product_id == product_id,
        )
    ).first()

    if not revision_item:
        raise HTTPException(status_code=404, detail="Revision item not found")

    # Update actual quantity
    revision_item.quantity_actual = item_update.quantity_actual
    revision_item.correction_notes = item_update.correction_notes

    # Calculate discrepancy
    revision_item.discrepancy = (
        item_update.quantity_actual - revision_item.quantity_expected
    )

    db.commit()
    db.refresh(revision_item)

    return revision_item


# ============================================================================
# COMPLETE REVISION
# ============================================================================
@router.post("/{session_id}/complete")
def complete_revision(
    session_id: int,
    apply_corrections: bool = Query(True),
    db: Session = Depends(get_db),
):
    """
    Complete revision and apply all corrections.

    - Updates product quantities to actual values
    - Logs all corrections in history
    - Marks session as completed
    """
    session = db.query(models.RevisionSession).filter(
        models.RevisionSession.id == session_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Revision session not found")

    if session.status != "in_progress":
        raise HTTPException(status_code=400, detail="Revision is not in progress")

    # Auto-fill uncounted items with expected values (no change)
    uncounted_items = db.query(models.RevisionItem).filter(
        and_(
            models.RevisionItem.session_id == session_id,
            models.RevisionItem.quantity_actual == None,
        )
    ).all()
    for item in uncounted_items:
        item.quantity_actual = item.quantity_expected
        item.discrepancy = 0

    # Apply corrections for items with discrepancies
    corrections_count = 0
    matched_items = []
    shortage_items = []
    surplus_items = []

    for revision_item in session.items:
        if revision_item.quantity_actual is None:
            continue
        disc = revision_item.quantity_actual - revision_item.quantity_expected
        revision_item.discrepancy = disc
        product = revision_item.product
        product_name = product.name if product else f"#{revision_item.product_id}"

        row = {
            "product_id": revision_item.product_id,
            "name": product_name,
            "expected": revision_item.quantity_expected,
            "actual": revision_item.quantity_actual,
            "difference": disc,
        }
        if disc < 0:
            shortage_items.append(row)
        elif disc > 0:
            surplus_items.append(row)
        else:
            matched_items.append(row)

        if disc != 0:
            if product and apply_corrections:
                old_quantity = product.quantity
                product.quantity = revision_item.quantity_actual
                revision_item.is_corrected = True

                history = models.History(
                    product_id=product.id,
                    operation_type=models.OperationType.REVISION,
                    quantity_change=disc,
                    reference_type='revision',
                    reference_id=session_id,
                    details={
                        "message": f"Ревизия: {product.name} ({old_quantity} → {revision_item.quantity_actual})",
                        "product_name": product.name,
                        "old_values": {"quantity": old_quantity},
                        "new_values": {"quantity": revision_item.quantity_actual},
                    },
                )
                db.add(history)
                corrections_count += 1

    # Complete session
    session.status = "completed"
    session.completed_at = datetime.now(UTC)

    db.commit()

    return {
        "session_id": session_id,
        "message": "Revision completed" if apply_corrections else "Revision completed (без изменений остатков)",
        "apply_corrections": apply_corrections,
        "corrections_applied": corrections_count,
        "checked_items": len(matched_items) + len(shortage_items) + len(surplus_items),
        "matched_items": matched_items,
        "shortage_items": shortage_items,
        "surplus_items": surplus_items,
    }


# ============================================================================
# CANCEL REVISION
# ============================================================================
@router.post("/{session_id}/cancel")
def cancel_revision(session_id: int, db: Session = Depends(get_db)):
    """Cancel a revision session without applying corrections."""
    session = db.query(models.RevisionSession).filter(
        models.RevisionSession.id == session_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Revision session not found")

    session.status = "cancelled"
    db.commit()

    return {"message": "Revision cancelled"}


# ============================================================================
# DELETE REVISION
# ============================================================================
@router.delete("/{session_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_revision(session_id: int, db: Session = Depends(get_db)):
    """Delete a revision session."""
    session = db.query(models.RevisionSession).filter(
        models.RevisionSession.id == session_id
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Revision session not found")

    db.delete(session)
    db.commit()

    return None

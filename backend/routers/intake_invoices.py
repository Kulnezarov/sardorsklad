"""Накладные поступления (мобильное приложение) — хранение на сервере."""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from typing import List

import models
import schemas
from database import get_db
from dependencies import require_manager_or_admin

router = APIRouter(
    tags=["intake_invoices"],
    dependencies=[Depends(require_manager_or_admin)],
)


def _to_response(row: models.IntakeInvoice) -> schemas.IntakeInvoiceResponse:
    return schemas.IntakeInvoiceResponse(
        id=row.client_id,
        server_id=row.id,
        number=row.number,
        date=row.date_str,
        lines=row.lines if isinstance(row.lines, list) else [],
        uploaded=bool(row.uploaded),
        pending_warehouse_upload=bool(row.pending_warehouse_upload),
        uploaded_at=row.uploaded_at,
        updated_at=row.updated_at,
    )


@router.get("/api/v1/intake-invoices/", response_model=List[schemas.IntakeInvoiceResponse])
def list_intake_invoices(
    db: Session = Depends(get_db),
    user: models.User = Depends(require_manager_or_admin),
):
    rows = (
        db.query(models.IntakeInvoice)
        .filter(models.IntakeInvoice.user_id == user.id)
        .order_by(desc(models.IntakeInvoice.number))
        .all()
    )
    return [_to_response(r) for r in rows]


@router.get("/api/v1/intake-invoices/next-number", response_model=schemas.IntakeInvoiceNextNumberResponse)
def next_intake_number(
    db: Session = Depends(get_db),
    user: models.User = Depends(require_manager_or_admin),
):
    max_num = (
        db.query(func.max(models.IntakeInvoice.number))
        .filter(models.IntakeInvoice.user_id == user.id)
        .scalar()
    )
    return schemas.IntakeInvoiceNextNumberResponse(next=int(max_num or 0) + 1)


@router.post(
    "/api/v1/intake-invoices/",
    response_model=schemas.IntakeInvoiceResponse,
    status_code=status.HTTP_200_OK,
)
def upsert_intake_invoice(
    payload: schemas.IntakeInvoiceUpsert,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_manager_or_admin),
):
    client_id = payload.id.strip()
    if not client_id:
        raise HTTPException(status_code=400, detail="id is required")

    row = (
        db.query(models.IntakeInvoice)
        .filter(
            models.IntakeInvoice.user_id == user.id,
            models.IntakeInvoice.client_id == client_id,
        )
        .first()
    )
    data = {
        "number": payload.number,
        "date_str": payload.date.strip(),
        "lines": payload.lines,
        "uploaded": payload.uploaded,
        "pending_warehouse_upload": payload.pending_warehouse_upload,
        "uploaded_at": payload.uploaded_at,
    }
    if row:
        for k, v in data.items():
            setattr(row, k, v)
    else:
        row = models.IntakeInvoice(
            client_id=client_id,
            user_id=user.id,
            **data,
        )
        db.add(row)
    db.commit()
    db.refresh(row)
    return _to_response(row)


@router.delete("/api/v1/intake-invoices/client/{client_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_intake_invoice(
    client_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_manager_or_admin),
):
    row = (
        db.query(models.IntakeInvoice)
        .filter(
            models.IntakeInvoice.user_id == user.id,
            models.IntakeInvoice.client_id == client_id.strip(),
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Invoice not found")
    db.delete(row)
    db.commit()

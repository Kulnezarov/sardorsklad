"""Накладные поступления (мобильное приложение) — хранение на сервере."""
import logging

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile, status
from PIL import UnidentifiedImageError
from sqlalchemy.orm import Session
from sqlalchemy import desc, func
from typing import List

import models
import schemas
from database import get_db
from dependencies import require_manager_or_admin
from services.intake_images import (
    MAX_IMAGE_SIZE_BYTES,
    MAX_INTAKE_LINE_IMAGES,
    save_intake_line_image,
)
from services.intake_warehouse_revert import revert_intake_warehouse_upload

router = APIRouter(
    tags=["intake_invoices"],
    dependencies=[Depends(require_manager_or_admin)],
)


def _find_line_index(lines: list, line_local_id: str) -> int:
    key = line_local_id.strip()
    for i, raw in enumerate(lines):
        if not isinstance(raw, dict):
            continue
        lid = str(raw.get("local_id") or "").strip()
        if lid and lid == key:
            return i
        if not lid and str(raw.get("barcode") or "").strip() == key:
            return i
    return -1


def _line_image_urls(line: dict) -> list[str]:
    urls = line.get("warehouse_image_urls")
    if isinstance(urls, list):
        return [str(u).strip() for u in urls if str(u or "").strip()]
    return []


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


@router.post(
    "/api/v1/intake-invoices/client/{client_id}/revert-warehouse",
    response_model=schemas.IntakeInvoiceRevertWarehouseResponse,
)
def revert_intake_invoice_warehouse(
    client_id: str,
    db: Session = Depends(get_db),
    user: models.User = Depends(require_manager_or_admin),
):
    """Снять загруженные позиции со склада и вернуть накладную в редактирование."""
    cid = client_id.strip()
    row = (
        db.query(models.IntakeInvoice)
        .filter(
            models.IntakeInvoice.user_id == user.id,
            models.IntakeInvoice.client_id == cid,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Invoice not found")
    try:
        report = revert_intake_warehouse_upload(db, row, user.id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    return schemas.IntakeInvoiceRevertWarehouseResponse(
        removed=report.get("removed", 0),
        updated=report.get("updated", 0),
        skipped=report.get("skipped", 0),
        warnings=list(report.get("warnings") or []),
        errors=list(report.get("errors") or []),
        invoice=_to_response(row),
    )


@router.post("/api/v1/intake-invoices/client/{client_id}/lines/{line_local_id}/image")
async def upload_intake_line_image(
    client_id: str,
    line_local_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    user: models.User = Depends(require_manager_or_admin),
):
    """Фото позиции накладной на сервере — видно на сайте до «В склад»."""
    cid = client_id.strip()
    lid = line_local_id.strip()
    if not cid or not lid:
        raise HTTPException(status_code=400, detail="client_id and line_local_id required")

    row = (
        db.query(models.IntakeInvoice)
        .filter(
            models.IntakeInvoice.user_id == user.id,
            models.IntakeInvoice.client_id == cid,
        )
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Invoice not found — save invoice first")

    lines = list(row.lines) if isinstance(row.lines, list) else []
    idx = _find_line_index(lines, lid)
    if idx < 0:
        raise HTTPException(status_code=404, detail="Line not found in invoice")

    line = dict(lines[idx]) if isinstance(lines[idx], dict) else {}
    cur = _line_image_urls(line)
    if len(cur) >= MAX_INTAKE_LINE_IMAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Не больше {MAX_INTAKE_LINE_IMAGES} фото на позицию",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Файл пустой")
    if len(data) > MAX_IMAGE_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="Файл слишком большой (макс. 5 МБ)")

    content_type = (file.content_type or "").lower()
    if content_type and not content_type.startswith("image/") and content_type != "application/octet-stream":
        raise HTTPException(status_code=400, detail="Ожидается изображение")

    try:
        new_url = save_intake_line_image(
            user_id=user.id,
            client_id=cid,
            line_local_id=lid,
            data=data,
        )
    except UnidentifiedImageError as e:
        logging.getLogger(__name__).error("intake image decode failed: %s", e)
        raise HTTPException(status_code=400, detail="Неподдерживаемый формат изображения") from e
    except Exception as e:
        logging.getLogger(__name__).error("intake image save failed: %s", e, exc_info=True)
        raise HTTPException(status_code=400, detail="Не удалось обработать изображение") from e

    gallery = cur + [new_url]
    line["warehouse_image_urls"] = gallery
    line.pop("local_photo_paths", None)
    line.pop("local_photo_path", None)
    line.pop("intake_photo_data", None)
    lines[idx] = line
    row.lines = lines
    db.commit()
    db.refresh(row)
    return {
        "ok": True,
        "image_url": gallery[0] if gallery else None,
        "image_urls": gallery,
    }


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

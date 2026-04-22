import asyncio
import json
import logging
import os
import re
import threading
import uuid
from io import BytesIO
from datetime import datetime, timedelta
from decimal import Decimal
from pathlib import Path
from typing import List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse, StreamingResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
import schemas
from database import SessionLocal, get_db
from dependencies import require_manager_or_admin
from services.audit import write_audit_log
from services.excel_products import export_products_xlsx, import_products_from_xlsx

router = APIRouter(
    prefix="/api/v1/products",
    tags=["products"],
    dependencies=[Depends(require_manager_or_admin)],
)


def build_generated_sku(db: Session) -> str:
    last_id = db.query(func.max(models.Product.id)).scalar() or 0
    return f"AUTO-{last_id + 1:06d}"


UPLOAD_DIR = Path(os.getenv("UPLOAD_DIR", "uploads")).resolve()
PRODUCT_IMAGE_DIR = UPLOAD_DIR / "products"
MAX_IMAGE_SIZE_BYTES = 5 * 1024 * 1024
ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp"}
MAX_IMAGE_DIMENSION = 1600
WEBP_QUALITY = 78


def _delete_old_product_image_file(old_url: str | None) -> None:
    """Удаляет WebP с диска по image_url: /uploads/products/... или /api/v1/media/product-images/..."""
    if not old_url or not isinstance(old_url, str):
        return
    p = (old_url or "").strip()
    if p.startswith("/uploads/products/"):
        name = p.rsplit("/", 1)[-1]
    elif p.startswith("/api/v1/media/product-images/"):
        name = p.rsplit("/", 1)[-1]
    else:
        return
    if not re.match(r"^\d+_[0-9a-f]{32}\.webp$", name, re.IGNORECASE):
        return
    path = (PRODUCT_IMAGE_DIR / name).resolve()
    try:
        path.relative_to(PRODUCT_IMAGE_DIR.resolve())
    except ValueError:
        return
    if path.is_file():
        try:
            path.unlink()
        except OSError:
            pass


def _prepare_for_webp(img: Image.Image) -> Image.Image:
    """JPEG/PNG/WebP → режим, с которым Pillow стабильно пишет WEBP."""
    mode = img.mode
    if mode == "CMYK":
        return img.convert("RGB")
    if mode == "P":
        # Палитра: с прозрачностью → RGBA, иначе RGB
        if "transparency" in img.info:
            return img.convert("RGBA")
        return img.convert("RGB")
    if mode == "PA":
        return img.convert("RGBA")
    if mode == "L":
        return img.convert("RGB")
    if mode == "LA":
        return img.convert("RGBA")
    if mode in ("RGB", "RGBA"):
        return img
    has_a = "A" in (img.getbands() or ())
    tr = bool(getattr(img, "has_transparency_data", False) or has_a)
    return img.convert("RGBA" if tr else "RGB")


@router.get("/", response_model=List[schemas.ProductResponse])
def list_products(
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(50_000, ge=1, le=200_000),
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(True),
    low_stock: bool = Query(False),
):
    query = db.query(models.Product)

    if is_active is not None:
        query = query.filter(models.Product.is_active == is_active)

    if category:
        query = query.filter(models.Product.category == category)

    if search:
        terms = [term.strip() for term in search.split() if term.strip()]
        for term in terms:
            query = query.filter(
                or_(
                    models.Product.name.ilike(f"%{term}%"),
                    models.Product.sku.ilike(f"%{term}%"),
                    models.Product.barcode.ilike(f"%{term}%"),
                    models.Product.brand.ilike(f"%{term}%"),
                    models.Product.category.ilike(f"%{term}%"),
                )
            )

    if low_stock:
        settings = db.query(models.Settings).first()
        threshold = settings.low_stock_threshold if settings else 5
        query = query.filter(models.Product.quantity <= threshold)

    return query.order_by(models.Product.created_at.desc()).offset(skip).limit(limit).all()


@router.get("/barcode/{barcode}", response_model=schemas.ProductResponse)
def get_product_by_barcode(barcode: str, db: Session = Depends(get_db)):
    code = (barcode or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Barcode required")
    product = (
        db.query(models.Product)
        .filter(
            models.Product.is_active.is_(True),
            or_(models.Product.barcode == code, models.Product.sku == code),
        )
        .first()
    )
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.post("/import/excel", response_model=schemas.ImportExcelResponse)
async def import_excel_products(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Нужен файл Excel в формате .xlsx")
    raw = await file.read()
    if len(raw) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Файл слишком большой (макс. 15 МБ)")
    settings = db.query(models.Settings).first()
    rate = Decimal(str(settings.cny_rate)) if settings and settings.cny_rate is not None else Decimal("65")
    created, skipped = import_products_from_xlsx(db, raw, rate)
    return schemas.ImportExcelResponse(created=created, skipped=[schemas.ImportExcelSkipItem(**s) for s in skipped])


@router.post("/import/excel/stream")
async def import_excel_products_stream(file: UploadFile = File(...)):
    """
    Потоковый импорт: ответ application/x-ndjson.
    Строки JSON: {"type":"progress","current":n,"total":m}, затем {"type":"complete","created":..,"skipped":[...]}
    или {"type":"error","message":"..."}.
    """
    if not file.filename or not file.filename.lower().endswith((".xlsx", ".xlsm")):
        raise HTTPException(status_code=400, detail="Нужен файл Excel в формате .xlsx")
    raw = await file.read()
    if len(raw) > 15 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="Файл слишком большой (макс. 15 МБ)")

    db_settings = SessionLocal()
    try:
        settings = db_settings.query(models.Settings).first()
        rate = Decimal(str(settings.cny_rate)) if settings and settings.cny_rate is not None else Decimal("65")
    finally:
        db_settings.close()

    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def worker() -> None:
        db = SessionLocal()
        try:

            def progress_cb(cur: int, tot: int) -> None:
                line = json.dumps({"type": "progress", "current": cur, "total": tot}, ensure_ascii=False) + "\n"
                asyncio.run_coroutine_threadsafe(queue.put(line.encode("utf-8")), loop)

            created, skipped = import_products_from_xlsx(db, raw, rate, progress_cb=progress_cb)
            payload = json.dumps(
                {"type": "complete", "created": created, "skipped": skipped},
                ensure_ascii=False,
            ) + "\n"
            asyncio.run_coroutine_threadsafe(queue.put(payload.encode("utf-8")), loop)
        except Exception as e:
            err_line = json.dumps({"type": "error", "message": str(e)[:1200]}, ensure_ascii=False) + "\n"
            asyncio.run_coroutine_threadsafe(queue.put(err_line.encode("utf-8")), loop)
        finally:
            db.close()
            asyncio.run_coroutine_threadsafe(queue.put(None), loop)

    threading.Thread(target=worker, daemon=True).start()

    async def ndjson_body():
        while True:
            chunk = await queue.get()
            if chunk is None:
                break
            yield chunk

    return StreamingResponse(
        ndjson_body(),
        media_type="application/x-ndjson; charset=utf-8",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/export/excel")
def export_excel_products(
    db: Session = Depends(get_db),
    is_active: bool = Query(True),
):
    products = (
        db.query(models.Product)
        .filter(models.Product.is_active == is_active)
        .order_by(models.Product.id.asc())
        .all()
    )
    buf, fname = export_products_xlsx(products)
    ascii_name = fname.encode("ascii", "replace").decode("ascii").replace("?", "_")
    cd = f'attachment; filename="{ascii_name}"; filename*=UTF-8\'\'{quote(fname)}'
    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": cd},
    )


@router.get("/categories/list", response_model=List[str])
def list_categories(
    db: Session = Depends(get_db),
    limit: int = Query(30, ge=1, le=200),
    search: Optional[str] = Query(None),
):
    query = db.query(models.Product.category).filter(
        models.Product.category.isnot(None),
        models.Product.is_active.is_(True),
    )
    if search:
        query = query.filter(models.Product.category.ilike(f"%{search.strip()}%"))
    categories = query.distinct().order_by(models.Product.category.asc()).limit(limit).all()
    return [category[0] for category in categories if category[0]]


@router.get("/stats/summary")
def get_product_stats(db: Session = Depends(get_db)):
    total = db.query(func.count(models.Product.id)).filter(models.Product.is_active == True).scalar() or 0
    settings = db.query(models.Settings).first()
    low_threshold = settings.low_stock_threshold if settings else 5

    low_stock = db.query(func.count(models.Product.id)).filter(
        models.Product.is_active == True,
        models.Product.quantity <= low_threshold,
    ).scalar() or 0

    cutoff_date = datetime.utcnow() - timedelta(days=30)
    stale = db.query(func.count(models.Product.id)).filter(
        models.Product.is_active == True,
        models.Product.quantity > 0,
        or_(
            models.Product.received_at.isnot(None) & (models.Product.received_at < cutoff_date),
            models.Product.received_at.is_(None) & (models.Product.created_at < cutoff_date),
        ),
    ).scalar() or 0

    total_value = db.query(
        func.sum(models.Product.purchase_price * models.Product.quantity)
    ).filter(models.Product.is_active == True).scalar() or 0

    return {
        "total_products": total,
        "low_stock_count": low_stock,
        "stale_count": stale,
        "warehouse_value": float(total_value),
    }


@router.get("/{product_id}", response_model=schemas.ProductResponse)
def get_product(product_id: int, db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return product


@router.post("/", response_model=schemas.ProductResponse, status_code=status.HTTP_201_CREATED)
def create_product(
    product: schemas.ProductCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_manager_or_admin),
):
    payload = product.model_dump()
    payload["sku"] = payload.get("sku") or build_generated_sku(db)

    if payload.get("barcode"):
        existing_barcode = db.query(models.Product).filter(models.Product.barcode == payload["barcode"]).first()
        if existing_barcode:
            raise HTTPException(status_code=400, detail="Barcode already exists")

    existing_sku = db.query(models.Product).filter(models.Product.sku == payload["sku"]).first()
    if existing_sku:
        raise HTTPException(status_code=400, detail="SKU already exists")

    payload.pop("profit_percent", None)
    payload["received_at"] = datetime.utcnow()

    db_product = models.Product(**payload)
    db.add(db_product)
    db.flush()

    db.add(
        models.History(
            product_id=db_product.id,
            operation_type=models.OperationType.ADDED,
            quantity_change=db_product.quantity,
            reference_type="product",
            reference_id=db_product.id,
            details={
                "message": f"Товар {db_product.name} добавлен",
                "sku": db_product.sku,
                "barcode": db_product.barcode,
            },
        )
    )
    write_audit_log(
        db,
        user_id=current_user.id,
        action="CREATE_PRODUCT",
        entity_type="product",
        entity_id=db_product.id,
        payload={"name": db_product.name, "sku": db_product.sku},
    )

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Конфликт уникальных данных (SKU/Barcode)")
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Не удалось сохранить товар в базе")
    db.refresh(db_product)
    return db_product


@router.put("/{product_id}", response_model=schemas.ProductResponse)
def update_product(
    product_id: int,
    product_update: schemas.ProductUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_manager_or_admin),
):
    db_product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")

    update_data = product_update.model_dump(exclude_unset=True)

    if "sku" in update_data and update_data["sku"] and update_data["sku"] != db_product.sku:
        existing = db.query(models.Product).filter(
            models.Product.sku == update_data["sku"],
            models.Product.id != product_id,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="SKU already exists")

    if "barcode" in update_data and update_data["barcode"] and update_data["barcode"] != db_product.barcode:
        existing = db.query(models.Product).filter(
            models.Product.barcode == update_data["barcode"],
            models.Product.id != product_id,
        ).first()
        if existing:
            raise HTTPException(status_code=400, detail="Barcode already exists")

    before = {
        "quantity": db_product.quantity,
        "purchase_price": str(db_product.purchase_price or 0),
        "sale_price": str(db_product.sale_price or 0),
    }

    for field, value in update_data.items():
        setattr(db_product, field, value)

    db.add(
        models.History(
            product_id=product_id,
            operation_type=models.OperationType.EDITED,
            quantity_change=(db_product.quantity or 0) - (before["quantity"] or 0),
            reference_type="product",
            reference_id=product_id,
            details={
                "message": f"Товар {db_product.name} обновлён",
                "before": before,
                "after": {
                    "quantity": db_product.quantity,
                    "purchase_price": str(db_product.purchase_price or 0),
                    "sale_price": str(db_product.sale_price or 0),
                },
            },
        )
    )
    write_audit_log(
        db,
        user_id=current_user.id,
        action="UPDATE_PRODUCT",
        entity_type="product",
        entity_id=product_id,
        payload=update_data,
    )

    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Конфликт уникальных данных (SKU/Barcode)")
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Не удалось обновить товар в базе")
    db.refresh(db_product)
    return db_product


@router.post("/{product_id}/image")
async def upload_product_image(
    product_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    db_product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Файл пустой")
    if len(data) > MAX_IMAGE_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="Файл слишком большой (макс. 5 МБ)")

    # Content-Type у браузера иногда пустой или application/octet-stream.
    # Разрешаем любой image/*, финальная проверка и декодирование — через Pillow.
    content_type = (file.content_type or "").lower()
    if content_type and not content_type.startswith("image/") and content_type != "application/octet-stream":
        logging.error("Unsupported upload content type: %s", content_type)
        raise HTTPException(status_code=400, detail="Ожидается изображение JPG, PNG или WEBP")

    try:
        with Image.open(BytesIO(data)) as img:
            img = ImageOps.exif_transpose(img)
            img = _prepare_for_webp(img)
            img.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)
            out = BytesIO()
            # Универсальный конвертер: любой распознанный Pillow формат -> WebP.
            img.save(
                out,
                format="WEBP",
                quality=78,
                method=6,
                lossless=False,
                optimize=True,
            )
            encoded = out.getvalue()
    except UnidentifiedImageError as e:
        logging.error("Unsupported image format for product %s: %s", product_id, e, exc_info=True)
        raise HTTPException(status_code=400, detail="Неподдерживаемый формат изображения")
    except Exception as e:
        logging.getLogger(__name__).error("image upload failed: %s", e, exc_info=True)
        raise HTTPException(status_code=400, detail="Не удалось обработать изображение (проверьте формат PNG/JPEG/WebP)")

    PRODUCT_IMAGE_DIR.mkdir(parents=True, exist_ok=True)
    file_name = f"{product_id}_{uuid.uuid4().hex}.webp"
    file_path = PRODUCT_IMAGE_DIR / file_name
    file_path.write_bytes(encoded)

    # Удаляем старый локальный WebP (старые записи: /uploads/products/; новые: /api/v1/media/...).
    _delete_old_product_image_file((db_product.image_url or "").strip())

    # Публичный URL под тем же /api/v1, что и REST — Caddy: handle /api* → backend (браузер в <img> без JWT).
    db_product.image_url = f"/api/v1/media/product-images/{file_name}"
    db.commit()
    db.refresh(db_product)
    return {"ok": True, "image_url": db_product.image_url}


@router.delete("/{product_id}")
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_manager_or_admin),
):
    db_product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Уже скрыт из каталога — повторное «удаление» без ошибки (удобно при двойном клике / устаревшем UI)
    if not db_product.is_active:
        return JSONResponse({"ok": True, "already_inactive": True})

    # При архивировании удаляем связанный файл изображения (если это наш uploads/products WebP).
    _delete_old_product_image_file((db_product.image_url or "").strip())

    db_product.is_active = False
    write_audit_log(
        db,
        user_id=current_user.id,
        action="DELETE_PRODUCT",
        entity_type="product",
        entity_id=product_id,
        payload={"soft_delete": True},
    )
    db.add(
        models.History(
            product_id=product_id,
            operation_type=models.OperationType.DELETED.value,
            quantity_change=0,
            reference_type="product",
            reference_id=product_id,
            details={"message": f"Товар {db_product.name} архивирован"},
        )
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Не удалось сохранить удаление в базе")
    return JSONResponse({"ok": True})

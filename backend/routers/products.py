import asyncio
import json
import threading
from datetime import datetime, timedelta
from decimal import Decimal
from typing import List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
import schemas
from database import SessionLocal, get_db
from services.excel_products import export_products_xlsx, import_products_from_xlsx

router = APIRouter(prefix="/api/v1/products", tags=["products"])


def build_generated_sku(db: Session) -> str:
    last_id = db.query(func.max(models.Product.id)).scalar() or 0
    return f"AUTO-{last_id + 1:06d}"


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
def create_product(product: schemas.ProductCreate, db: Session = Depends(get_db)):
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
def update_product(product_id: int, product_update: schemas.ProductUpdate, db: Session = Depends(get_db)):
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


@router.delete("/{product_id}")
def delete_product(product_id: int, db: Session = Depends(get_db)):
    db_product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Уже скрыт из каталога — повторное «удаление» без ошибки (удобно при двойном клике / устаревшем UI)
    if not db_product.is_active:
        return JSONResponse({"ok": True, "already_inactive": True})

    db_product.is_active = False
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

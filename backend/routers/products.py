import asyncio
import json
import logging
import os
import re
import threading
import uuid
from io import BytesIO
from datetime import UTC, datetime, timedelta
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
from services.cny_price_history import record_cny_price_history
from services.product_compatibility import (
    apply_product_compatibility,
    build_car_compatibility_from_model_ids,
    build_compatibility_extra_counts,
    build_compatibility_out,
    compatibility_extra_model_count,
    resolve_car_compatibility_to_model_ids,
)
from services.product_search import search_products
from services.product_sku import find_product_by_sku, normalize_sku, sku_conflict_detail
from services.category_attributes import (
    get_category_schema,
    needs_category_refresh,
    normalize_attributes,
    sync_category_text,
    validate_attributes_for_category,
)
from services.form_layout import display_layout_from_form_layout, normalize_form_layout
from services.product_display import sync_custom_fields_to_attributes

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
MAX_PRODUCT_IMAGES = 12
_SAFE_WEBP_BASENAME = re.compile(r"^\d+_[0-9a-f]{32}\.webp$", re.IGNORECASE)


def _normalize_vehicle_text(value: str | None) -> str | None:
    if value is None:
        return None
    s = re.sub(r"[,+/;]+", " ", str(value))
    s = re.sub(r"[^0-9A-Za-zА-Яа-яЁё\- ]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if not s:
        return None
    parts: list[str] = []
    for part in s.split(" "):
        if re.fullmatch(r"[A-Z0-9-]{2,}", part) or re.fullmatch(r"[А-ЯЁ0-9-]{2,}", part):
            parts.append(part)
        else:
            parts.append(part[:1].upper() + part[1:].lower())
    return " ".join(parts)


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
    if not _SAFE_WEBP_BASENAME.match(name):
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


def _category_meta(db: Session, p: models.Product) -> dict:
    is_legacy = p.category_id is None
    group_name = None
    if p.category_id:
        cat = getattr(p, "category_rel", None) or db.query(models.Category).filter(models.Category.id == p.category_id).first()
        if cat and cat.parent_id:
            parent = db.query(models.Category).filter(models.Category.id == cat.parent_id).first()
            group_name = parent.name if parent else None
    return {
        "is_legacy_category": is_legacy,
        "category_group_name": group_name,
        "needs_category_refresh": needs_category_refresh(db, p),
    }


def _apply_product_category_fields(db: Session, payload: dict, *, strict: bool = False) -> None:
    payload.pop("display_layout", None)

    has_attrs = "attributes" in payload
    attrs = payload.get("attributes") if has_attrs else None
    cid = payload.get("category_id")
    if has_attrs or cid is not None:
        validated = validate_attributes_for_category(db, cid, attrs, strict=strict)
        if has_attrs or cid is not None:
            payload["attributes"] = validated
    sync_category_text(db, payload)

    if cid:
        schema = get_category_schema(db, cid) or {}
        form_layout = normalize_form_layout(schema.get("form_layout"), schema)
        payload["display_layout"] = display_layout_from_form_layout(form_layout, schema)
        merged_attrs = sync_custom_fields_to_attributes(payload["display_layout"], payload.get("attributes"))
        if merged_attrs is not None and has_attrs:
            payload["attributes"] = validate_attributes_for_category(db, cid, merged_attrs, strict=False)


def _product_to_response_lite(
    db: Session,
    p: models.Product,
    *,
    extra_counts: dict[int, int] | None = None,
) -> schemas.ProductResponse:
    """Список товаров: кэш brand/model + счётчик доп. совместимостей."""
    r = schemas.ProductResponse.model_validate(p, from_attributes=True)
    r = _inject_product_gallery(r, p)
    meta = _category_meta(db, p)
    extra = (extra_counts or {}).get(p.id, 0)
    return r.model_copy(update={
        "compatibility": schemas.ProductCompatibilityOut(),
        "compatibility_extra_count": extra,
        **meta,
    })


def _product_to_response(db: Session, p: models.Product) -> schemas.ProductResponse:
    comp = build_compatibility_out(db, p.id)
    r = schemas.ProductResponse.model_validate(p, from_attributes=True)
    r = _inject_product_gallery(r, p)
    engine_code = None
    if p.engine_code_id:
        ec = db.query(models.EngineCode).filter(models.EngineCode.id == p.engine_code_id).first()
        if ec:
            engine_code = schemas.EngineCodeBrief.model_validate(ec, from_attributes=True)
    meta = _category_meta(db, p)
    return r.model_copy(update={
        "compatibility": comp,
        "engine_code": engine_code,
        "compatibility_extra_count": compatibility_extra_model_count(comp),
        **meta,
    })


def _apply_engine_code_defaults(db: Session, payload: dict) -> None:
    """Legacy: подстановка марки/модели из кода двигателя (если ещё используется)."""
    if payload.get("compatibility_vehicle_model_ids"):
        return
    engine_code_id = payload.get("engine_code_id")
    if not engine_code_id:
        return
    first_match = (
        db.query(models.Compatibility)
        .filter(models.Compatibility.engine_code_id == engine_code_id)
        .order_by(models.Compatibility.id.asc())
        .first()
    )
    if first_match:
        payload["brand"] = _normalize_vehicle_text(first_match.brand)
        payload["model"] = _normalize_vehicle_text(first_match.model)


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


def _product_gallery_urls(p: models.Product) -> list[str]:
    raw = getattr(p, "image_urls", None)
    urls: list[str] = []
    if isinstance(raw, list):
        for u in raw:
            s = (str(u) if u is not None else "").strip().split("?")[0].strip()
            if s:
                urls.append(s)
    seen: set[str] = set()
    out: list[str] = []
    for u in urls:
        if u not in seen:
            seen.add(u)
            out.append(u)
    legacy = (getattr(p, "image_url", None) or "").strip().split("?")[0].strip()
    if not out and legacy:
        out = [legacy]
    return out


def _persist_product_gallery(db_product: models.Product, urls: list[str]) -> None:
    clean: list[str] = []
    seen: set[str] = set()
    for u in urls:
        s = (u or "").strip().split("?")[0].strip()
        if not s or s in seen:
            continue
        seen.add(s)
        clean.append(s)
    db_product.image_urls = clean if clean else None
    db_product.image_url = clean[0] if clean else None


def _bytes_to_webp(data: bytes) -> tuple[bytes, int, int]:
    with Image.open(BytesIO(data)) as img:
        img = ImageOps.exif_transpose(img)
        img = _prepare_for_webp(img)
        img.thumbnail((MAX_IMAGE_DIMENSION, MAX_IMAGE_DIMENSION), Image.Resampling.LANCZOS)
        w, h = int(img.size[0] or 0), int(img.size[1] or 0)
        out = BytesIO()
        img.save(
            out,
            format="WEBP",
            quality=WEBP_QUALITY,
            method=6,
            lossless=False,
            optimize=True,
        )
        return out.getvalue(), w, h


def _inject_product_gallery(r: schemas.ProductResponse, p: models.Product) -> schemas.ProductResponse:
    urls = _product_gallery_urls(p)
    return r.model_copy(update={"image_urls": urls, "image_url": urls[0] if urls else None})


@router.get("/", response_model=List[schemas.ProductResponse])
def list_products(
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(50_000, ge=1, le=200_000),
    search: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    category_id: Optional[int] = Query(None, ge=1),
    legacy_only: Optional[bool] = Query(None, description="Только товары без новой категории"),
    is_active: Optional[bool] = Query(True),
    show_on_storefront: Optional[bool] = Query(None, description="Фильтр витрины CHPARTS"),
    low_stock: bool = Query(False),
):
    query = db.query(models.Product)

    if is_active is not None:
        query = query.filter(models.Product.is_active == is_active)

    if show_on_storefront is not None:
        query = query.filter(models.Product.show_on_storefront == show_on_storefront)

    if category_id is not None:
        query = query.filter(models.Product.category_id == category_id)
    elif category:
        query = query.filter(models.Product.category == category)

    if legacy_only is True:
        query = query.filter(models.Product.category_id.is_(None))
    elif legacy_only is False:
        query = query.filter(models.Product.category_id.isnot(None))

    if low_stock:
        settings = db.query(models.Settings).first()
        threshold = settings.low_stock_threshold if settings else 5
        query = query.filter(models.Product.quantity <= threshold)

    if search and str(search).strip():
        rows = search_products(query, str(search).strip(), limit=limit, skip=skip)
    else:
        rows = query.order_by(models.Product.created_at.desc()).offset(skip).limit(limit).all()
    pids = [p.id for p in rows]
    extra_counts = build_compatibility_extra_counts(db, pids)
    return [_product_to_response_lite(db, p, extra_counts=extra_counts) for p in rows]


@router.post("/storefront/bulk", response_model=schemas.StorefrontBulkResponse)
def bulk_update_storefront(
    body: schemas.StorefrontBulkUpdate,
    db: Session = Depends(get_db),
):
    """Включить/скрыть выбранные товары на клиентской витрине."""
    ids = [int(x) for x in (body.product_ids or []) if int(x) > 0]
    if not ids:
        return schemas.StorefrontBulkResponse(updated=0)
    rows = db.query(models.Product).filter(models.Product.id.in_(ids)).all()
    for p in rows:
        p.show_on_storefront = bool(body.show_on_storefront)
    db.commit()
    return schemas.StorefrontBulkResponse(updated=len(rows))


@router.post("/storefront/publish-all", response_model=schemas.StorefrontBulkResponse)
def publish_all_products_to_storefront(db: Session = Depends(get_db)):
    """Все активные товары снова видны на витрине (по умолчанию так и задумано)."""
    n = (
        db.query(models.Product)
        .filter(models.Product.is_active.is_(True))
        .update({models.Product.show_on_storefront: True}, synchronize_session=False)
    )
    db.commit()
    return schemas.StorefrontBulkResponse(updated=int(n or 0))


@router.get("/barcode/{barcode}", response_model=schemas.ProductResponse)
def get_product_by_barcode(
    barcode: str,
    include_inactive: bool = False,
    db: Session = Depends(get_db),
):
    code = (barcode or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Barcode required")
    query = db.query(models.Product).filter(
        or_(models.Product.barcode == code, models.Product.sku == code),
    )
    if not include_inactive:
        query = query.filter(models.Product.is_active.is_(True))
    product = query.first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return _product_to_response(db, product)


@router.get("/sku/{sku}", response_model=schemas.ProductResponse)
def get_product_by_sku(
    sku: str,
    exclude_id: Optional[int] = Query(None, ge=1),
    include_inactive: bool = True,
    db: Session = Depends(get_db),
):
    norm = normalize_sku(sku)
    if not norm:
        raise HTTPException(status_code=400, detail="SKU required")
    product = find_product_by_sku(db, norm, exclude_id=exclude_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if not include_inactive and not product.is_active:
        raise HTTPException(status_code=404, detail="Product not found")
    return _product_to_response(db, product)


@router.get("/cny-history/{barcode}", response_model=List[schemas.CnyPriceHistoryItem])
def list_cny_price_history(
    barcode: str,
    limit: int = Query(30, ge=1, le=100),
    db: Session = Depends(get_db),
):
    code = (barcode or "").strip()
    if not code:
        raise HTTPException(status_code=400, detail="Barcode required")
    rows = (
        db.query(models.ProductCnyPriceHistory)
        .filter(models.ProductCnyPriceHistory.barcode == code)
        .order_by(models.ProductCnyPriceHistory.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        schemas.CnyPriceHistoryItem(
            id=r.id,
            product_id=r.product_id,
            barcode=r.barcode,
            cny_price=float(r.cny_price),
            delivery_cost_kzt=float(r.delivery_cost_kzt) if r.delivery_cost_kzt is not None else None,
            created_at=r.created_at,
        )
        for r in rows
    ]


@router.post("/cny-history", response_model=schemas.CnyPriceHistoryItem, status_code=status.HTTP_201_CREATED)
def add_cny_price_history(
    payload: schemas.CnyPriceHistoryCreate,
    db: Session = Depends(get_db),
):
    code = payload.barcode.strip()
    row = record_cny_price_history(
        db,
        barcode=code,
        cny_price=payload.cny_price,
        delivery_cost_kzt=payload.delivery_cost_kzt,
        product_id=payload.product_id,
    )
    if row is None:
        raise HTTPException(status_code=400, detail="Укажите штрих-код и цену в ¥")
    db.commit()
    db.refresh(row)
    return schemas.CnyPriceHistoryItem(
        id=row.id,
        product_id=row.product_id,
        barcode=row.barcode,
        cny_price=float(row.cny_price),
        delivery_cost_kzt=float(row.delivery_cost_kzt) if row.delivery_cost_kzt is not None else None,
        created_at=row.created_at,
    )


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
    limit: int = Query(500, ge=1, le=1000),
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

    cutoff_date = datetime.now(UTC) - timedelta(days=30)
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


@router.get("/images/health")
def product_images_health(
    db: Session = Depends(get_db),
    limit: int = Query(5000, ge=1, le=20_000),
):
    """
    Проверка, что file:// для image_url (локальный WebP) существует на диске.
    Возвращает список битых ссылок для диагностики.
    """
    rows = (
        db.query(models.Product)
        .filter(
            models.Product.is_active.is_(True),
            or_(
                models.Product.image_url.isnot(None),
                models.Product.image_urls.isnot(None),
            ),
        )
        .order_by(models.Product.id)
        .limit(limit)
        .all()
    )
    broken: list[dict] = []
    ok_count = 0
    for p in rows:
        gallery = _product_gallery_urls(p)
        if not gallery:
            ok_count += 1
            continue
        for u in gallery:
            u = u.strip()
            if not u or not (u.startswith("/api/v1/media/product-images/") or u.startswith("/uploads/products/")):
                ok_count += 1
                continue
            name = u.rsplit("/", 1)[-1]
            if not _SAFE_WEBP_BASENAME.match(name):
                ok_count += 1
                continue
            path = (PRODUCT_IMAGE_DIR / name).resolve()
            if path.is_file():
                ok_count += 1
            else:
                broken.append(
                    {
                        "product_id": p.id,
                        "image_url": u,
                        "reason": "file_not_found",
                    }
                )
    return {
        "total_checked": len(rows),
        "ok_count": ok_count,
        "broken": broken,
    }


@router.get("/{product_id}", response_model=schemas.ProductResponse)
def get_product(product_id: int, db: Session = Depends(get_db)):
    product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    return _product_to_response(db, product)


@router.post("/", response_model=schemas.ProductResponse, status_code=status.HTTP_201_CREATED)
def create_product(
    product: schemas.ProductCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_manager_or_admin),
):
    payload = product.model_dump()
    allow_duplicate_sku = bool(payload.pop("allow_duplicate_sku", False))
    payload.pop("image_url", None)
    payload.pop("image_urls", None)
    payload["sku"] = payload.get("sku") or build_generated_sku(db)

    if payload.get("barcode"):
        existing_barcode = db.query(models.Product).filter(models.Product.barcode == payload["barcode"]).first()
        if existing_barcode:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "BARCODE_EXISTS",
                    "message": "Barcode already exists",
                    "product_id": existing_barcode.id,
                    "is_active": bool(existing_barcode.is_active),
                    "barcode": existing_barcode.barcode,
                },
            )

    existing_sku = find_product_by_sku(db, payload["sku"])
    if existing_sku and not allow_duplicate_sku:
        raise HTTPException(status_code=400, detail=sku_conflict_detail(existing_sku))

    payload.pop("profit_percent", None)
    v_ids = payload.pop("compatibility_vehicle_model_ids", None)
    e_ids = payload.pop("compatibility_engine_family_ids", None)
    _apply_product_category_fields(db, payload, strict=False)
    payload["received_at"] = datetime.now(UTC)
    _apply_engine_code_defaults(db, payload)

    db_product = models.Product(**payload)
    db.add(db_product)
    db.flush()

    apply_product_compatibility(db, db_product, vehicle_model_ids=v_ids, engine_family_ids=e_ids)

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

    if db_product.cny_price and float(db_product.cny_price) > 0:
        record_cny_price_history(
            db,
            barcode=db_product.barcode,
            cny_price=db_product.cny_price,
            delivery_cost_kzt=db_product.delivery_cost_kzt,
            product_id=db_product.id,
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
    return _product_to_response(db, db_product)


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
    allow_duplicate_sku = bool(update_data.pop("allow_duplicate_sku", False))
    update_data.pop("image_url", None)
    update_data.pop("image_urls", None)

    if "sku" in update_data and update_data["sku"] and update_data["sku"] != db_product.sku:
        existing = find_product_by_sku(db, update_data["sku"], exclude_id=product_id)
        if existing and not allow_duplicate_sku:
            raise HTTPException(status_code=400, detail=sku_conflict_detail(existing))

    if "barcode" in update_data and update_data["barcode"] and update_data["barcode"] != db_product.barcode:
        existing = db.query(models.Product).filter(
            models.Product.barcode == update_data["barcode"],
            models.Product.id != product_id,
        ).first()
        if existing:
            raise HTTPException(
                status_code=400,
                detail={
                    "code": "BARCODE_EXISTS",
                    "message": "Barcode already exists",
                    "product_id": existing.id,
                    "is_active": bool(existing.is_active),
                    "barcode": existing.barcode,
                },
            )

    vkey = "compatibility_vehicle_model_ids" in update_data
    ekey = "compatibility_engine_family_ids" in update_data
    v_ids = update_data.pop("compatibility_vehicle_model_ids", None) if vkey else None
    e_ids = update_data.pop("compatibility_engine_family_ids", None) if ekey else None

    if "category_id" in update_data or "attributes" in update_data:
        merged = {
            "category_id": update_data.get("category_id", db_product.category_id),
            "attributes": update_data.get("attributes", db_product.attributes),
        }
        _apply_product_category_fields(db, merged, strict=False)
        if "category_id" in update_data:
            update_data["category_id"] = merged.get("category_id")
        if "attributes" in update_data:
            update_data["attributes"] = merged.get("attributes")
        if merged.get("display_layout") is not None:
            update_data["display_layout"] = merged["display_layout"]
        if "category_id" in update_data:
            sync_category_text(db, update_data)

    before = {
        "quantity": db_product.quantity,
        "purchase_price": str(db_product.purchase_price or 0),
        "sale_price": str(db_product.sale_price or 0),
    }

    for field, value in update_data.items():
        setattr(db_product, field, value)
    if "engine_code_id" in update_data:
        _apply_engine_code_defaults(db, update_data)
        if "brand" in update_data:
            db_product.brand = update_data["brand"]
        if "model" in update_data:
            db_product.model = update_data["model"]

    if vkey or ekey:
        cur_vm = [
            r[0]
            for r in db.query(models.ProductVehicleModelLink.vehicle_model_id)
            .filter(models.ProductVehicleModelLink.product_id == product_id)
            .all()
        ]
        cur_ef = [
            r[0]
            for r in db.query(models.ProductEngineFamilyLink.engine_family_id)
            .filter(models.ProductEngineFamilyLink.product_id == product_id)
            .all()
        ]
        nvm = v_ids if vkey else cur_vm
        nef = e_ids if ekey else cur_ef
        apply_product_compatibility(db, db_product, vehicle_model_ids=nvm, engine_family_ids=nef)

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

    if db_product.cny_price and float(db_product.cny_price) > 0:
        record_cny_price_history(
            db,
            barcode=db_product.barcode,
            cny_price=db_product.cny_price,
            delivery_cost_kzt=db_product.delivery_cost_kzt,
            product_id=db_product.id,
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
    return _product_to_response(db, db_product)


@router.patch("/{product_id}/update-category", response_model=schemas.ProductResponse)
@router.patch("/{product_id}/update-category/", response_model=schemas.ProductResponse)
def update_product_category(
    product_id: int,
    payload: schemas.ProductCategoryUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_manager_or_admin),
):
    """Обновить подкатегорию, attributes и совместимость без изменения цен/остатка."""
    db_product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")

    sub = db.query(models.Category).filter(models.Category.id == payload.subcategory_id).first()
    if not sub or not sub.parent_id:
        raise HTTPException(status_code=400, detail="Выберите подкатегорию, а не группу")

    prev_cat = db_product.category_id
    if payload.subcategory_id != prev_cat:
        attrs = payload.attributes if payload.attributes is not None else {}
    else:
        attrs = payload.attributes if payload.attributes is not None else db_product.attributes

    merged = {"category_id": payload.subcategory_id, "attributes": attrs}
    _apply_product_category_fields(db, merged, strict=True)
    db_product.category_id = merged.get("category_id")
    db_product.attributes = merged.get("attributes")
    if merged.get("display_layout") is not None:
        db_product.display_layout = merged["display_layout"]
    db_product.category = sub.name
    db_product.needs_category_refresh = False

    v_ids = payload.compatibility_vehicle_model_ids
    if v_ids is None and payload.car_compatibility:
        v_ids = resolve_car_compatibility_to_model_ids(db, payload.car_compatibility)
    if payload.car_compatibility is not None:
        db_product.car_compatibility = payload.car_compatibility
    elif v_ids:
        db_product.car_compatibility = build_car_compatibility_from_model_ids(db, v_ids)

    if v_ids is not None:
        apply_product_compatibility(db, db_product, vehicle_model_ids=v_ids, engine_family_ids=None)

    write_audit_log(
        db,
        user_id=current_user.id,
        action="UPDATE_PRODUCT_CATEGORY",
        entity_type="product",
        entity_id=product_id,
        payload={"subcategory_id": payload.subcategory_id},
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Не удалось обновить категорию товара")
    db.refresh(db_product)
    return _product_to_response(db, db_product)


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

    cur = _product_gallery_urls(db_product)
    if len(cur) >= MAX_PRODUCT_IMAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Не больше {MAX_PRODUCT_IMAGES} фото на товар",
        )

    try:
        encoded, w, h = _bytes_to_webp(data)
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

    # Публичный URL под тем же /api/v1, что и REST — Caddy: handle /api* → backend (браузер в <img> без JWT).
    new_url = f"/api/v1/media/product-images/{file_name}"
    _persist_product_gallery(db_product, cur + [new_url])
    db.commit()
    db.refresh(db_product)
    gallery = _product_gallery_urls(db_product)
    return {
        "ok": True,
        "image_url": gallery[0] if gallery else None,
        "image_urls": gallery,
        "size_bytes": len(encoded),
        "width": w,
        "height": h,
    }


@router.delete("/{product_id}/image")
def delete_product_image(
    product_id: int,
    db: Session = Depends(get_db),
):
    db_product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")

    for u in _product_gallery_urls(db_product):
        _delete_old_product_image_file(u)
    _persist_product_gallery(db_product, [])
    db.commit()
    db.refresh(db_product)
    return {"ok": True, "image_url": None, "image_urls": []}


@router.delete("/{product_id}/images/{file_name}")
def delete_product_gallery_image(
    product_id: int,
    file_name: str,
    db: Session = Depends(get_db),
):
    """Удалить одно фото галереи по имени файла (напр. 12_a1b2....webp)."""
    base = (file_name or "").strip().rsplit("/", 1)[-1]
    if not _SAFE_WEBP_BASENAME.match(base) or not base.lower().startswith(f"{product_id}_".lower()):
        raise HTTPException(status_code=400, detail="Некорректное имя файла")
    db_product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")
    gallery = _product_gallery_urls(db_product)
    to_remove: str | None = None
    for u in gallery:
        if u.rsplit("/", 1)[-1].lower() == base.lower():
            to_remove = u
            break
    if not to_remove:
        raise HTTPException(status_code=404, detail="Фото не найдено у этого товара")
    _delete_old_product_image_file(to_remove)
    _persist_product_gallery(db_product, [u for u in gallery if u != to_remove])
    db.commit()
    db.refresh(db_product)
    urls = _product_gallery_urls(db_product)
    return {"ok": True, "image_url": urls[0] if urls else None, "image_urls": urls}


@router.delete("/{product_id}")
def delete_product(
    product_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_manager_or_admin),
):
    db_product = db.query(models.Product).filter(models.Product.id == product_id).first()
    if not db_product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Уже скрыт из каталога. Для старых архивных записей освобождаем уникальные поля (barcode/sku),
    # если они еще заняты, чтобы можно было создать новый товар с тем же штрих-кодом.
    if not db_product.is_active:
        changed = False
        old_sku = db_product.sku
        old_barcode = db_product.barcode
        if db_product.barcode:
            db_product.barcode = None
            changed = True
        if db_product.sku and "-archived-" not in db_product.sku:
            archived_suffix = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
            db_product.sku = f"{db_product.sku}-archived-{db_product.id}-{archived_suffix}"[:100]
            changed = True
        if changed:
            write_audit_log(
                db,
                user_id=current_user.id,
                action="RELEASE_ARCHIVED_PRODUCT_UNIQUES",
                entity_type="product",
                entity_id=product_id,
                payload={"old_sku": old_sku, "old_barcode": old_barcode},
            )
            db.add(
                models.History(
                    product_id=product_id,
                    operation_type=models.OperationType.DELETED.value,
                    quantity_change=0,
                    reference_type="product",
                    reference_id=product_id,
                    details={
                        "message": f"Для архивного товара {db_product.name} освобождены уникальные поля",
                        "old_sku": old_sku,
                        "old_barcode": old_barcode,
                    },
                )
            )
            try:
                db.commit()
            except Exception:
                db.rollback()
                raise HTTPException(status_code=500, detail="Не удалось освободить barcode/sku у архивного товара")
        return JSONResponse({"ok": True, "already_inactive": True, "released_unique_fields": changed})

    # При архивировании удаляем локальные WebP галереи.
    for u in _product_gallery_urls(db_product):
        _delete_old_product_image_file(u)
    _persist_product_gallery(db_product, [])

    old_sku = db_product.sku
    old_barcode = db_product.barcode
    # Освобождаем уникальные поля, чтобы удалённый товар не блокировал создание нового.
    archived_suffix = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    archived_sku = f"{old_sku}-archived-{db_product.id}-{archived_suffix}"
    db_product.sku = archived_sku[:100]
    db_product.barcode = None
    db_product.is_active = False
    write_audit_log(
        db,
        user_id=current_user.id,
        action="DELETE_PRODUCT",
        entity_type="product",
        entity_id=product_id,
        payload={
            "soft_delete": True,
            "released_unique_fields": True,
            "old_sku": old_sku,
            "old_barcode": old_barcode,
        },
    )
    db.add(
        models.History(
            product_id=product_id,
            operation_type=models.OperationType.DELETED.value,
            quantity_change=0,
            reference_type="product",
            reference_id=product_id,
            details={
                "message": f"Товар {db_product.name} архивирован",
                "old_sku": old_sku,
                "old_barcode": old_barcode,
            },
        )
    )
    try:
        db.commit()
    except Exception:
        db.rollback()
        raise HTTPException(status_code=500, detail="Не удалось сохранить удаление в базе")
    return JSONResponse({"ok": True})


@router.post("/refresh-display-layout")
def refresh_product_display_layouts(
    category_id: Optional[int] = Query(None, ge=1, description="Только для указанной категории"),
    db: Session = Depends(get_db),
    _current_user: models.User = Depends(require_manager_or_admin),
):
    """Пересобрать display_layout для товаров по категории (или всех)."""
    from sqlalchemy import update as sa_update

    q = db.query(models.Product)
    if category_id:
        q = q.filter(models.Product.category_id == category_id)
    products = q.all()

    updated = 0
    for p in products:
        schema = get_category_schema(db, p.category_id)
        if not schema:
            continue
        form_layout = normalize_form_layout(schema.get("form_layout"), schema)
        new_layout = display_layout_from_form_layout(form_layout, schema)
        if p.display_layout == new_layout:
            continue
        db.execute(
            sa_update(models.Product)
            .where(models.Product.id == p.id)
            .values(display_layout=new_layout)
        )
        updated += 1

    if updated:
        db.commit()

    return {"ok": True, "updated": updated, "total": len(products)}

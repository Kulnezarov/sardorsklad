from datetime import datetime
from decimal import Decimal
import os

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import asc, desc, func, or_
from sqlalchemy.orm import Session, joinedload

import models
import schemas
from database import get_db
from services.public_rate_limit import check_public_order_rate_limit
from services.telegram_orders import send_new_order_notification

router = APIRouter(prefix="/api/v1/public", tags=["public"])

SITE_NEW_ORDER_STATUS = "Новый заказ с сайта"

# Синтетические id для категорий/брендов только из текстовых полей товара (без FK в справочники)
LEGACY_CATEGORY_ID_BASE = 10_000_000
LEGACY_BRAND_ID_BASE = 20_000_000
LEGACY_ID_SLOT_MAX = 9_999


def _strip_or_none(val) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return s or None


def _client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for") or request.headers.get("X-Forwarded-For")
    if fwd:
        return fwd.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def product_to_public(p: models.Product) -> schemas.PublicProductResponse:
    cat = getattr(p, "category_rel", None)
    br = getattr(p, "brand_rel", None)
    category_name = _strip_or_none(cat.name if cat else None) or _strip_or_none(getattr(p, "category", None))
    brand_name = _strip_or_none(br.name if br else None) or _strip_or_none(getattr(p, "brand", None))
    return schemas.PublicProductResponse(
        id=p.id,
        name=p.name,
        sale_price=p.sale_price,
        quantity=int(p.quantity or 0),
        category_id=p.category_id,
        image_url=p.image_url,
        category_name=category_name,
        brand_id=p.brand_id,
        brand_name=brand_name,
        article=p.sku,
        oem=p.barcode,
    )


def _compose_order_notes(payload: schemas.PublicOrderCreate) -> str | None:
    parts: list[str] = []
    if payload.comment and payload.comment.strip():
        parts.append(payload.comment.strip())
    extra: list[str] = []
    if payload.delivery_type:
        extra.append(f"Доставка: {payload.delivery_type}")
    if payload.delivery_city:
        extra.append(f"Город: {payload.delivery_city}")
    if payload.delivery_address:
        extra.append(f"Адрес: {payload.delivery_address}")
    if payload.delivery_details:
        extra.append(f"Детали доставки: {payload.delivery_details}")
    if payload.payment_type:
        extra.append(f"Оплата: {payload.payment_type}")
    if extra:
        parts.append("\n".join(extra))
    return "\n\n".join(parts) if parts else None


def _distinct_legacy_category_names(db: Session) -> list[str]:
    rows = (
        db.query(models.Product.category)
        .filter(
            models.Product.is_active.is_(True),
            models.Product.category.isnot(None),
            models.Product.category != "",
        )
        .distinct()
        .all()
    )
    return sorted({_strip_or_none(r[0]) for r in rows if _strip_or_none(r[0])}, key=str.casefold)


def _distinct_legacy_brand_names(db: Session) -> list[str]:
    rows = (
        db.query(models.Product.brand)
        .filter(
            models.Product.is_active.is_(True),
            models.Product.brand.isnot(None),
            models.Product.brand != "",
        )
        .distinct()
        .all()
    )
    return sorted({_strip_or_none(r[0]) for r in rows if _strip_or_none(r[0])}, key=str.casefold)


def _legacy_only_category_names(db: Session, normalized_names: set[str]) -> list[str]:
    return [n for n in _distinct_legacy_category_names(db) if n.casefold() not in normalized_names]


def _legacy_only_brand_names(db: Session, normalized_names: set[str]) -> list[str]:
    return [n for n in _distinct_legacy_brand_names(db) if n.casefold() not in normalized_names]


def _apply_product_filters(
    query,
    db: Session,
    *,
    q: str | None,
    category_id: int | None,
    brand_id: int | None,
    model: str | None,
    year: str | None,
    in_stock: bool | None,
):
    if q:
        term = q.strip()
        if term:
            like = f"%{term}%"
            query = query.filter(
                or_(
                    models.Product.name.ilike(like),
                    models.Product.sku.ilike(like),
                    models.Product.barcode.ilike(like),
                    models.Product.category.ilike(like),
                    models.Product.brand.ilike(like),
                    models.Category.name.ilike(like),
                    models.Brand.name.ilike(like),
                    models.Product.description.ilike(like),
                )
            )
    if category_id is not None:
        if LEGACY_CATEGORY_ID_BASE <= category_id < LEGACY_CATEGORY_ID_BASE + LEGACY_ID_SLOT_MAX + 1:
            legacy_names = _legacy_only_category_names(
                db,
                {c.name.casefold() for c in db.query(models.Category).filter(models.Category.is_active.is_(True)).all()},
            )
            idx = category_id - LEGACY_CATEGORY_ID_BASE
            if 0 <= idx < len(legacy_names):
                nm = legacy_names[idx]
                query = query.filter(
                    or_(
                        func.lower(models.Product.category) == nm.casefold(),
                        func.lower(models.Category.name) == nm.casefold(),
                    )
                )
            else:
                query = query.filter(models.Product.id == -1)
        else:
            query = query.filter(models.Product.category_id == category_id)
    if brand_id is not None:
        if LEGACY_BRAND_ID_BASE <= brand_id < LEGACY_BRAND_ID_BASE + LEGACY_ID_SLOT_MAX + 1:
            legacy_names = _legacy_only_brand_names(
                db,
                {b.name.casefold() for b in db.query(models.Brand).filter(models.Brand.is_active.is_(True)).all()},
            )
            idx = brand_id - LEGACY_BRAND_ID_BASE
            if 0 <= idx < len(legacy_names):
                nm = legacy_names[idx]
                query = query.filter(
                    or_(
                        func.lower(models.Product.brand) == nm.casefold(),
                        func.lower(models.Brand.name) == nm.casefold(),
                    )
                )
            else:
                query = query.filter(models.Product.id == -1)
        else:
            query = query.filter(models.Product.brand_id == brand_id)
    if model and model.strip():
        m = f"%{model.strip()}%"
        query = query.filter(
            or_(models.Product.name.ilike(m), models.Product.description.ilike(m))
        )
    if year and str(year).strip():
        y = f"%{str(year).strip()}%"
        query = query.filter(
            or_(models.Product.name.ilike(y), models.Product.description.ilike(y))
        )
    if in_stock is True:
        query = query.filter(models.Product.quantity > 0)
    elif in_stock is False:
        query = query.filter(models.Product.quantity <= 0)
    return query


def _sort_clause(sort: str | None):
    if sort == "price_asc":
        return asc(models.Product.sale_price)
    if sort == "price_desc":
        return desc(models.Product.sale_price)
    if sort == "name_asc":
        return asc(models.Product.name)
    if sort == "name_desc":
        return desc(models.Product.name)
    return desc(models.Product.id)


@router.get("/products", response_model=schemas.PublicProductListResponse)
def list_public_products(
    db: Session = Depends(get_db),
    q: str | None = Query(None, description="Поиск по названию, артикулу, штрихкоду, категории, бренду"),
    category_id: int | None = Query(
        None,
        description="ID из справочника или синтетический 10000000+N (только текстовая категория на товаре)",
    ),
    brand_id: int | None = Query(
        None,
        description="ID из справочника или синтетический 20000000+N (только текстовый бренд на товаре)",
    ),
    model: str | None = Query(None),
    year: str | None = Query(None, description="Подстрока в названии/описании (отдельных полей года в БД нет)"),
    in_stock: bool | None = Query(None),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    sort: str | None = Query(
        None,
        description="price_asc, price_desc, name_asc, name_desc; иначе по id убыв.",
    ),
):
    def _filtered():
        q0 = (
            db.query(models.Product)
            .outerjoin(models.Category, models.Product.category_id == models.Category.id)
            .outerjoin(models.Brand, models.Product.brand_id == models.Brand.id)
            .filter(models.Product.is_active.is_(True))
        )
        return _apply_product_filters(
            q0,
            db,
            q=q,
            category_id=category_id,
            brand_id=brand_id,
            model=model,
            year=year,
            in_stock=in_stock,
        )

    total = _filtered().with_entities(func.count(models.Product.id.distinct())).scalar() or 0

    order = _sort_clause(sort)
    rows = (
        _filtered()
        .options(
            joinedload(models.Product.category_rel),
            joinedload(models.Product.brand_rel),
        )
        .order_by(order)
        .offset(offset)
        .limit(limit)
        .all()
    )
    items = [product_to_public(p) for p in rows]
    return schemas.PublicProductListResponse(items=items, total=total)


@router.get("/products/{product_id}", response_model=schemas.PublicProductResponse)
def get_public_product(product_id: int, db: Session = Depends(get_db)):
    p = (
        db.query(models.Product)
        .options(
            joinedload(models.Product.category_rel),
            joinedload(models.Product.brand_rel),
        )
        .filter(models.Product.id == product_id, models.Product.is_active.is_(True))
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    return product_to_public(p)


@router.get("/categories", response_model=list[schemas.PublicCategoryItem])
def list_public_categories(db: Session = Depends(get_db)):
    """Справочник + уникальные строки category с товаров, для которых нет совпадения по имени со справочником."""
    normalized = (
        db.query(models.Category)
        .filter(models.Category.is_active.is_(True))
        .order_by(asc(models.Category.name))
        .all()
    )
    norm_names = {c.name.casefold() for c in normalized}
    items = [schemas.PublicCategoryItem(id=c.id, name=c.name) for c in normalized]
    for idx, name in enumerate(_legacy_only_category_names(db, norm_names)):
        if idx > LEGACY_ID_SLOT_MAX:
            break
        items.append(schemas.PublicCategoryItem(id=LEGACY_CATEGORY_ID_BASE + idx, name=name))
    items.sort(key=lambda x: x.name.casefold())
    return items


@router.get("/brands", response_model=list[schemas.PublicBrandItem])
def list_public_brands(db: Session = Depends(get_db)):
    normalized = (
        db.query(models.Brand)
        .filter(models.Brand.is_active.is_(True))
        .order_by(asc(models.Brand.name))
        .all()
    )
    norm_names = {b.name.casefold() for b in normalized}
    items = [schemas.PublicBrandItem(id=b.id, name=b.name) for b in normalized]
    for idx, name in enumerate(_legacy_only_brand_names(db, norm_names)):
        if idx > LEGACY_ID_SLOT_MAX:
            break
        items.append(schemas.PublicBrandItem(id=LEGACY_BRAND_ID_BASE + idx, name=name))
    items.sort(key=lambda x: x.name.casefold())
    return items


@router.post(
    "/orders",
    response_model=schemas.PublicOrderCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_public_order(
    request: Request,
    payload: schemas.PublicOrderCreate,
    db: Session = Depends(get_db),
):
    if not check_public_order_rate_limit(_client_ip(request)):
        raise HTTPException(
            status_code=429,
            detail="Too many requests. Please try again later.",
        )

    if not payload.items:
        raise HTTPException(status_code=400, detail="invalid payload: empty items")

    reserve_stock = os.getenv("PUBLIC_ORDER_RESERVE_STOCK_IMMEDIATELY", "false").lower() in ("1", "true", "yes")
    product_ids = {i.product_id for i in payload.items}
    products = (
        db.query(models.Product)
        .filter(models.Product.id.in_(product_ids), models.Product.is_active.is_(True))
        .with_for_update()
        .all()
    )
    by_id = {p.id: p for p in products}
    missing = [pid for pid in product_ids if pid not in by_id]
    if missing:
        raise HTTPException(status_code=404, detail=f"product not found: {missing[0]}")

    total = Decimal("0")
    for item in payload.items:
        p = by_id[item.product_id]
        if item.quantity <= 0:
            raise HTTPException(status_code=400, detail="invalid payload: quantity must be > 0")
        if item.quantity > (p.quantity or 0):
            raise HTTPException(status_code=409, detail=f"not enough stock for product_id={p.id}")
        total += Decimal(str(p.sale_price or 0)) * item.quantity

    order_code = f"WEB-{int(datetime.utcnow().timestamp())}"
    notes = _compose_order_notes(payload)
    reserve = models.Reserve(
        order_code=order_code,
        customer_name=payload.customer_name.strip(),
        customer_phone=payload.customer_phone.strip(),
        source="website",
        status=SITE_NEW_ORDER_STATUS,
        total_amount_cny=Decimal("0"),
        total_amount_kzt=total,
        total_amount=total,
        cny_rate=1.0,
        notes=notes,
    )
    db.add(reserve)
    db.flush()

    for item in payload.items:
        p = by_id[item.product_id]
        line_total = Decimal(str(p.sale_price or 0)) * item.quantity
        reserve_item = models.ReserveItem(
            reserve_id=reserve.id,
            product_id=p.id,
            product_name=p.name,
            quantity_ordered=item.quantity,
            quantity_received=0,
            quantity=item.quantity,
            price_cny=Decimal("0"),
            price_kzt=Decimal(str(p.sale_price or 0)),
            sale_price_snapshot=Decimal(str(p.sale_price or 0)),
            line_total=line_total,
        )
        db.add(reserve_item)
        if reserve_stock:
            p.quantity = max(0, (p.quantity or 0) - item.quantity)

    db.add(
        models.History(
            product_id=None,
            operation_type=models.OperationType.ORDERED.value,
            reference_type="reserve",
            reference_id=reserve.id,
            details={"source": "website", "status": SITE_NEW_ORDER_STATUS},
        )
    )
    db.commit()
    db.refresh(reserve)
    reserve = (
        db.query(models.Reserve)
        .options(joinedload(models.Reserve.items))
        .filter(models.Reserve.id == reserve.id)
        .first()
    )
    try:
        send_new_order_notification(db, reserve)
    except Exception:
        pass
    return schemas.PublicOrderCreateResponse(ok=True, reserve_id=reserve.id)

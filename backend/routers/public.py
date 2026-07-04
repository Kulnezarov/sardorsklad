from datetime import UTC, datetime
from decimal import Decimal
import os
import re

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_, asc, desc, func, or_
from sqlalchemy.orm import Session, joinedload

import models
import schemas
from database import get_db
from services.product_compatibility import (
    build_compatibility_map,
    build_compatibility_out,
    compatibility_storefront_meta,
    vehicle_brand_to_response,
)
from services.category_attributes import attribute_labels_from_product
from services.product_display import (
    auto_description_from_product,
    card_highlights_from_product,
    product_purpose_from_product,
    storefront_fields_from_product,
)
from services.public_rate_limit import check_public_order_rate_limit, check_rate_limit, client_ip
from services.telegram_orders import send_new_order_notification
from config.logger import setup_logger
from sqlalchemy.exc import SQLAlchemyError

router = APIRouter(prefix="/api/v1/public", tags=["public"])
logger = setup_logger("public_api")

SITE_NEW_ORDER_STATUS = "Новый заказ"

PUBLIC_CANCELLATION_REASON_TITLES: dict[str, str] = {
    "wrong_product": "неверно указан товар",
    "not_paid": "неоплата / неподтверждение оплаты",
    "invalid_contact_data": "некорректные контакты",
    "not_reachable": "не удалось связаться",
    "out_of_stock": "нет в наличии",
    "client_refused": "клиент отказался",
    "duplicate": "дубль заказа",
    "other": "другое",
}

# Синтетические id для категорий/брендов только из текстовых полей товара (без FK в справочники)
LEGACY_CATEGORY_ID_BASE = 10_000_000
LEGACY_BRAND_ID_BASE = 20_000_000
LEGACY_ID_SLOT_MAX = 9_999

_PUBLIC_ORDER_NOT_FOUND = "Заказ не найден. Проверьте номер заказа и телефон."


def _public_product_gallery(p: models.Product) -> list[str]:
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


def _normalize_phone_digits(s: str) -> str:
    return re.sub(r"\D+", "", s or "")


def _phones_match_order(stored: str | None, provided: str) -> bool:
    """Совпадение телефона: полное совпадение цифр или последние 10 цифр (формат +7 / 8)."""
    a = _normalize_phone_digits(stored or "")
    b = _normalize_phone_digits(provided or "")
    if not a or not b:
        return False
    if a == b:
        return True
    if len(a) >= 10 and len(b) >= 10 and a[-10:] == b[-10:]:
        return True
    return False


def _public_cancellation_fields(reserve: models.Reserve, cancelled: bool) -> tuple[str | None, str | None, str | None]:
    if not cancelled:
        return None, None, None
    code = (reserve.cancellation_reason_code or "").strip() or None
    title = PUBLIC_CANCELLATION_REASON_TITLES.get(code, code) if code else None
    comment = None
    cmt = (getattr(reserve, "cancellation_comment", None) or "").strip()
    if cmt:
        comment = cmt[:500]
    return code, title, comment


def build_public_order_status_response(reserve: models.Reserve) -> schemas.PublicOrderStatusResponse:
    st = (reserve.status or "").strip()
    cancelled = st == "Отменен"
    fulfilled = st == "Выдано"
    if cancelled:
        title = "Заказ отменён магазином"
    elif fulfilled:
        title = "Заказ выполнен"
    elif st in ("Новый заказ", "Новый заказ с сайта"):
        title = "Заказ принят, обрабатывается"
    else:
        title = st
    reason_code, reason_title, reason_comment = _public_cancellation_fields(reserve, cancelled)
    return schemas.PublicOrderStatusResponse(
        reserve_id=reserve.id,
        order_code=reserve.order_code,
        status=st,
        status_title=title,
        is_cancelled=cancelled,
        is_fulfilled=fulfilled,
        created_at=reserve.created_at,
        cancellation_reason_code=reason_code,
        cancellation_reason_title=reason_title,
        cancellation_comment=reason_comment,
    )


def _decimal_str(v) -> str:
    if v is None:
        return "0.00"
    d = v if isinstance(v, Decimal) else Decimal(str(v))
    return f"{d:.2f}"


def _public_line_status_from_header(header: schemas.PublicOrderStatusResponse) -> tuple[str, str]:
    """Код и подпись для позиций, если нет статуса по строке."""
    if header.is_fulfilled:
        return "fulfilled", "Выдано"
    if header.is_cancelled:
        return "cancelled", "Отменено"
    return "pending", "В обработке"


def _public_line_status_for_item(
    it: models.ReserveItem,
    header: schemas.PublicOrderStatusResponse,
) -> tuple[str, str]:
    st = (getattr(it, "line_status", None) or "pending").strip() or "pending"
    if st == "cancelled":
        return "cancelled", "Отменено"
    if st == "fulfilled":
        return "fulfilled", "Выдано"
    return _public_line_status_from_header(header)


def _reserve_line_product_meta(it: models.ReserveItem) -> tuple[str | None, str | None, str | None, str | None]:
    p = getattr(it, "product", None)
    if p is None:
        return None, None, None, None
    barcode = _strip_or_none(getattr(p, "barcode", None))
    sku = _strip_or_none(getattr(p, "sku", None))
    br = getattr(p, "brand_rel", None)
    cat = getattr(p, "category_rel", None)
    brand_name = _strip_or_none(br.name if br else None) or _strip_or_none(getattr(p, "brand", None))
    category_name = _strip_or_none(cat.name if cat else None) or _strip_or_none(getattr(p, "category", None))
    return barcode, sku, brand_name, category_name


def build_public_reserve_detail_response(reserve: models.Reserve) -> schemas.PublicReserveDetailResponse:
    header = build_public_order_status_response(reserve)
    rows = sorted(reserve.items or [], key=lambda x: x.id or 0)
    items_out: list[schemas.PublicReserveLineItem] = []
    for it in rows:
        code, line_title = _public_line_status_for_item(it, header)
        qty = it.quantity if it.quantity is not None else it.quantity_ordered
        price = it.sale_price_snapshot if it.sale_price_snapshot is not None else it.price_kzt
        barcode, sku, brand_name, category_name = _reserve_line_product_meta(it)
        items_out.append(
            schemas.PublicReserveLineItem(
                id=it.id,
                product_id=it.product_id,
                product_name=it.product_name,
                quantity=int(qty or 0),
                unit_price=_decimal_str(price),
                line_total=_decimal_str(it.line_total) if it.line_total is not None else None,
                line_status=code,
                line_status_title=line_title,
                barcode=barcode,
                sku=sku,
                brand_name=brand_name,
                category_name=category_name,
            )
        )
    total = reserve.total_amount_kzt
    if total is None:
        total = reserve.total_amount
    return schemas.PublicReserveDetailResponse(
        reserve_id=header.reserve_id,
        order_code=header.order_code,
        status=header.status,
        status_title=header.status_title,
        is_cancelled=header.is_cancelled,
        is_fulfilled=header.is_fulfilled,
        created_at=header.created_at,
        total_amount=_decimal_str(total),
        cancellation_reason_code=header.cancellation_reason_code,
        cancellation_reason_title=header.cancellation_reason_title,
        cancellation_comment=header.cancellation_comment,
        items=items_out,
    )


def _strip_or_none(val) -> str | None:
    if val is None:
        return None
    s = str(val).strip()
    return s or None


def _client_ip(request: Request) -> str:
    return client_ip(request)


def _storefront_compatibility(comp: schemas.ProductCompatibilityOut) -> schemas.ProductCompatibilityOut:
    """
    Витрина (chparts): без внутренних кодов двигателя — они только в складе.
    Клиенту отдаём привязки к маркам/моделям авто.
    """
    vms = list(comp.vehicle_models) if comp else []
    ecs = list(comp.engine_code_compatibility) if comp else []
    return schemas.ProductCompatibilityOut(
        engine_families=[],
        vehicle_models=vms,
        engine_code_compatibility=ecs,
    )


def _storefront_model_text(p: models.Product, comp: schemas.ProductCompatibilityOut) -> str | None:
    """Текст «применимости» для витрины: без сегмента «Коды: …» из кэша склада."""
    if comp and comp.vehicle_models:
        labels: list[str] = []
        for v in comp.vehicle_models:
            b = (v.brand_name or "").strip()
            n = (v.name or "").strip()
            s = f"{b} {n}".strip() if b else n
            if s:
                labels.append(s)
        if labels:
            return ", ".join(dict.fromkeys(labels))
    if comp and comp.engine_code_compatibility:
        labels = [f"{x.brand} {x.model}".strip() for x in comp.engine_code_compatibility]
        labels = [x for x in labels if x]
        if labels:
            return ", ".join(dict.fromkeys(labels))
    raw = _strip_or_none(getattr(p, "model", None))
    if not raw:
        return None
    parts = [x.strip() for x in raw.split("·") if x.strip() and not x.strip().startswith("Коды:")]
    if not parts:
        return None
    out = " · ".join(parts)
    if out.startswith("Совм.:"):
        out = out.replace("Совм.:", "", 1).strip()
    return out or None


def product_to_public(
    p: models.Product,
    db: Session | None = None,
    *,
    compatibility: schemas.ProductCompatibilityOut | None = None,
) -> schemas.PublicProductResponse:
    cat = getattr(p, "category_rel", None)
    br = getattr(p, "brand_rel", None)
    category_name = _strip_or_none(cat.name if cat else None) or _strip_or_none(getattr(p, "category", None))
    brand_name = _strip_or_none(br.name if br else None) or _strip_or_none(getattr(p, "brand", None))
    if compatibility is not None:
        comp = compatibility
    elif db is not None:
        comp = build_compatibility_out(db, p.id)
    else:
        comp = schemas.ProductCompatibilityOut()
    comp = _storefront_compatibility(comp)
    model_public = _storefront_model_text(p, comp)
    gallery = _public_product_gallery(p)
    compat_labels: list[str] = []
    compat_primary: str | None = None
    compat_more_brands = 0
    compat_groups: list[schemas.CompatibilityBrandGroup] = []
    if comp and comp.vehicle_models:
        compat_primary, compat_more_brands, compat_labels, compat_groups = compatibility_storefront_meta(comp)
    elif comp and comp.engine_code_compatibility:
        for x in comp.engine_code_compatibility:
            s = f"{x.brand} {x.model}".strip()
            if s and s not in compat_labels:
                compat_labels.append(s)
        compat_primary = compat_labels[0] if compat_labels else None
        compat_more_brands = max(0, len(compat_labels) - 1)
    compat_text = ", ".join(compat_labels) if compat_labels else model_public
    attr_labels = attribute_labels_from_product(db, p) if db is not None else []
    storefront_fields = storefront_fields_from_product(db, p) if db is not None else []
    if not storefront_fields and attr_labels:
        for line in attr_labels:
            if ": " in line:
                lbl, val = line.split(": ", 1)
                storefront_fields.append({"label": lbl, "value": val})
            else:
                storefront_fields.append({"label": line, "value": ""})
    schema = None
    if db is not None:
        from services.category_attributes import get_category_schema

        schema = get_category_schema(db, getattr(p, "category_id", None))
    purpose = product_purpose_from_product(p, schema, storefront_fields)
    card_highlights = card_highlights_from_product(p, schema, storefront_fields)
    auto_desc = auto_description_from_product(p, schema, storefront_fields, purpose)
    raw_attrs = p.attributes if isinstance(getattr(p, "attributes", None), dict) else None
    return schemas.PublicProductResponse(
        id=p.id,
        name=p.name,
        sale_price=p.sale_price,
        quantity=int(p.quantity or 0),
        category_id=p.category_id,
        image_url=gallery[0] if gallery else None,
        image_urls=gallery,
        category_name=category_name,
        brand_id=p.brand_id,
        brand_name=brand_name,
        model=model_public,
        article=p.sku,
        oem=p.barcode,
        attributes=raw_attrs,
        attribute_labels=attr_labels,
        storefront_fields=storefront_fields,
        purpose=purpose,
        card_highlights=card_highlights,
        description=auto_desc,
        compatibility=comp,
        compatibility_text=compat_text,
        compatibility_labels=compat_labels,
        compatibility_primary=compat_primary,
        compatibility_more_count=compat_more_brands,
        compatibility_more_brands=compat_more_brands,
        compatibility_groups=compat_groups,
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


def _category_with_descendant_ids(db: Session, category_id: int) -> list[int]:
    rows = (
        db.query(models.Category.id, models.Category.parent_id)
        .filter(models.Category.is_active.is_(True))
        .all()
    )
    children_by_parent: dict[int, list[int]] = {}
    known_ids: set[int] = set()
    for row_id, parent_id in rows:
        known_ids.add(row_id)
        if parent_id is not None:
            children_by_parent.setdefault(parent_id, []).append(row_id)

    if category_id not in known_ids:
        return [category_id]

    result: set[int] = set()
    stack = [category_id]
    while stack:
        current = stack.pop()
        if current in result:
            continue
        result.add(current)
        stack.extend(children_by_parent.get(current, []))
    return sorted(result)


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
    vehicle_brand_id: int | None = None,
    vehicle_model_id: int | None = None,
    engine_family_id: int | None = None,
):
    if q:
        term = q.strip()
        if term:
            like = f"%{term}%"
            compat_pid_q = (
                db.query(models.ProductVehicleModelLink.product_id)
                .join(
                    models.VehicleModel,
                    models.VehicleModel.id == models.ProductVehicleModelLink.vehicle_model_id,
                )
                .join(
                    models.VehicleBrand,
                    models.VehicleBrand.id == models.VehicleModel.vehicle_brand_id,
                )
                .filter(
                    or_(
                        models.VehicleBrand.name.ilike(like),
                        models.VehicleModel.name.ilike(like),
                    )
                )
            )
            query = query.filter(
                or_(
                    models.Product.name.ilike(like),
                    models.Product.sku.ilike(like),
                    models.Product.barcode.ilike(like),
                    models.Product.category.ilike(like),
                    models.Product.brand.ilike(like),
                    models.Product.model.ilike(like),
                    models.Category.name.ilike(like),
                    models.Brand.name.ilike(like),
                    models.Product.description.ilike(like),
                    models.Product.id.in_(compat_pid_q),
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
            category_ids = _category_with_descendant_ids(db, category_id)
            query = query.filter(models.Product.category_id.in_(category_ids))
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
        compat_pid_m = (
            db.query(models.ProductVehicleModelLink.product_id)
            .join(
                models.VehicleModel,
                models.VehicleModel.id == models.ProductVehicleModelLink.vehicle_model_id,
            )
            .join(
                models.VehicleBrand,
                models.VehicleBrand.id == models.VehicleModel.vehicle_brand_id,
            )
            .filter(
                or_(
                    models.VehicleModel.name.ilike(m),
                    models.VehicleBrand.name.ilike(m),
                )
            )
        )
        query = query.filter(
            or_(
                models.Product.model.ilike(m),
                models.Product.name.ilike(m),
                models.Product.description.ilike(m),
                models.Product.id.in_(compat_pid_m),
            )
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

    if engine_family_id is not None:
        pids = db.query(models.ProductEngineFamilyLink.product_id).filter(
            models.ProductEngineFamilyLink.engine_family_id == engine_family_id
        )
        query = query.filter(models.Product.id.in_(pids))

    if vehicle_model_id is not None:
        direct = db.query(models.ProductVehicleModelLink.product_id).filter(
            models.ProductVehicleModelLink.vehicle_model_id == vehicle_model_id
        )
        via_ef = (
            db.query(models.ProductEngineFamilyLink.product_id)
            .join(
                models.EngineFamilyModel,
                and_(
                    models.EngineFamilyModel.engine_family_id
                    == models.ProductEngineFamilyLink.engine_family_id,
                    models.EngineFamilyModel.vehicle_model_id == vehicle_model_id,
                ),
            )
        )
        query = query.filter(
            or_(
                models.Product.id.in_(direct),
                models.Product.id.in_(via_ef),
            )
        )

    if vehicle_brand_id is not None:
        mids = [
            r[0]
            for r in db.query(models.VehicleModel.id)
            .filter(models.VehicleModel.vehicle_brand_id == vehicle_brand_id)
            .all()
        ]
        if not mids:
            query = query.filter(models.Product.id == -1)
        else:
            direct = (
                db.query(models.ProductVehicleModelLink.product_id).filter(
                    models.ProductVehicleModelLink.vehicle_model_id.in_(mids)
                )
            )
            via_ef = (
                db.query(models.ProductEngineFamilyLink.product_id)
                .join(
                    models.EngineFamilyModel,
                    and_(
                        models.EngineFamilyModel.engine_family_id
                        == models.ProductEngineFamilyLink.engine_family_id,
                        models.EngineFamilyModel.vehicle_model_id.in_(mids),
                    ),
                )
            )
            query = query.filter(
                or_(
                    models.Product.id.in_(direct),
                    models.Product.id.in_(via_ef),
                )
            )
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
    vehicle_brand_id: int | None = Query(
        None, description="Марка авто (таблица vehicle_brands) для совместимости"
    ),
    vehicle_model_id: int | None = Query(
        None, description="Модель авто (таблица vehicle_models) — прямая или через код"
    ),
    engine_family_id: int | None = Query(
        None, description="Код совместимости (двигатель, engine_families.id)"
    ),
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
            .filter(models.Product.show_on_storefront.is_(True))
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
            vehicle_brand_id=vehicle_brand_id,
            vehicle_model_id=vehicle_model_id,
            engine_family_id=engine_family_id,
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
    cmap = build_compatibility_map(db, [p.id for p in rows])
    items = [
        product_to_public(p, compatibility=cmap.get(p.id) or schemas.ProductCompatibilityOut()) for p in rows
    ]
    return schemas.PublicProductListResponse(items=items, total=total)


@router.get("/products/{product_id}", response_model=schemas.PublicProductResponse)
def get_public_product(product_id: int, db: Session = Depends(get_db)):
    p = (
        db.query(models.Product)
        .options(
            joinedload(models.Product.category_rel),
            joinedload(models.Product.brand_rel),
        )
        .filter(
            models.Product.id == product_id,
            models.Product.is_active.is_(True),
            models.Product.show_on_storefront.is_(True),
        )
        .first()
    )
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    return product_to_public(p, db)


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
    items = [
        schemas.PublicCategoryItem(
            id=c.id,
            name=c.name,
            parent_id=c.parent_id,
            sort_order=c.sort_order or 0,
        )
        for c in normalized
    ]
    for idx, name in enumerate(_legacy_only_category_names(db, norm_names)):
        if idx > LEGACY_ID_SLOT_MAX:
            break
        items.append(schemas.PublicCategoryItem(id=LEGACY_CATEGORY_ID_BASE + idx, name=name))
    items.sort(key=lambda x: x.name.casefold())
    return items


@router.get("/compatibility/vehicle-brands", response_model=list[schemas.VehicleBrandResponse])
def list_public_vehicle_brands(db: Session = Depends(get_db)):
    rows = (
        db.query(models.VehicleBrand)
        .filter(models.VehicleBrand.is_active.is_(True))
        .order_by(asc(models.VehicleBrand.name))
        .all()
    )
    return [vehicle_brand_to_response(b) for b in rows]


@router.get("/compatibility/vehicle-models", response_model=list[schemas.VehicleModelResponse])
def list_public_vehicle_models(
    db: Session = Depends(get_db),
    vehicle_brand_id: int | None = None,
):
    qry = (
        db.query(models.VehicleModel)
        .options(joinedload(models.VehicleModel.vehicle_brand))
        .filter(models.VehicleModel.is_active.is_(True))
    )
    if vehicle_brand_id is not None:
        qry = qry.filter(models.VehicleModel.vehicle_brand_id == vehicle_brand_id)
    rows = qry.order_by(asc(models.VehicleModel.name)).all()
    out: list[schemas.VehicleModelResponse] = []
    for r in rows:
        d = schemas.VehicleModelResponse.model_validate(r, from_attributes=True)
        if r.vehicle_brand:
            d = d.model_copy(
                update={"brand": vehicle_brand_to_response(r.vehicle_brand)}
            )
        out.append(d)
    return out


@router.get("/compatibility/engine-families", response_model=list[schemas.EngineFamilyResponse])
def list_public_engine_families(db: Session = Depends(get_db)):
    rows = (
        db.query(models.EngineFamily)
        .options(
            joinedload(models.EngineFamily.product_links),
            joinedload(models.EngineFamily.model_links)
            .joinedload(models.EngineFamilyModel.vehicle_model)
            .joinedload(models.VehicleModel.vehicle_brand),
        )
        .filter(models.EngineFamily.is_active.is_(True))
        .order_by(asc(models.EngineFamily.code))
        .all()
    )
    out: list[schemas.EngineFamilyResponse] = []
    for row in rows:
        vehicle_models: list[schemas.VehicleModelResponse] = []
        for link in row.model_links or []:
            vm = link.vehicle_model
            if not vm or not vm.is_active:
                continue
            item = schemas.VehicleModelResponse.model_validate(vm, from_attributes=True)
            if vm.vehicle_brand:
                item = item.model_copy(
                    update={"brand": vehicle_brand_to_response(vm.vehicle_brand)}
                )
            vehicle_models.append(item)
        out.append(
            schemas.EngineFamilyResponse(
                id=row.id,
                code=row.code,
                name=row.name,
                displacement_l=row.displacement_l,
                fuel_type=row.fuel_type,
                power=row.power,
                manufacturer=row.manufacturer,
                notes=None,
                summary=row.name,
                is_active=row.is_active,
                product_count=len(row.product_links or []),
                created_at=row.created_at,
                updated_at=row.updated_at,
                vehicle_models=vehicle_models,
            )
        )
    return out


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
    not_on_site = [pid for pid in product_ids if not getattr(by_id[pid], "show_on_storefront", True)]
    if not_on_site:
        raise HTTPException(status_code=404, detail=f"product not available on storefront: {not_on_site[0]}")

    total = Decimal("0")
    for item in payload.items:
        p = by_id[item.product_id]
        if item.quantity <= 0:
            raise HTTPException(status_code=400, detail="invalid payload: quantity must be > 0")
        if item.quantity > (p.quantity or 0):
            raise HTTPException(status_code=409, detail=f"not enough stock for product_id={p.id}")
        total += Decimal(str(p.sale_price or 0)) * item.quantity

    order_code = f"WEB-{int(datetime.now(UTC).timestamp())}"
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

    try:
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
    except SQLAlchemyError as exc:
        db.rollback()
        logger.exception("create_public_order failed: %s", exc)
        raise HTTPException(
            status_code=500,
            detail=(
                "Не удалось сохранить заказ. На сервере нужно применить миграцию "
                "backend/migrations/006_public_order_schema.sql и перезапустить backend."
            ),
        ) from exc

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


_LOOKUP_RATE = int(os.getenv("PUBLIC_LOOKUP_RATE_LIMIT", "20"))
_LOOKUP_WINDOW = int(os.getenv("PUBLIC_LOOKUP_RATE_WINDOW_SEC", "60"))


def _guard_lookup_rate(request: Request) -> None:
    if not check_rate_limit("order_lookup", _client_ip(request), _LOOKUP_RATE, _LOOKUP_WINDOW):
        raise HTTPException(status_code=429, detail="Слишком много запросов, попробуйте позже")


@router.get("/orders/{reserve_id}", response_model=schemas.PublicOrderStatusResponse)
def get_public_order_status(
    reserve_id: int,
    request: Request,
    phone: str = Query(
        ...,
        min_length=5,
        max_length=30,
        description="Телефон, указанный при оформлении заказа",
    ),
    db: Session = Depends(get_db),
):
    """
    Статус заказа для клиента витрины. Телефон должен совпадать с заказом (защита от просмотра чужих заказов).
    После отмены в админке `is_cancelled=true`, `status_title` поясняет результат.
    """
    _guard_lookup_rate(request)
    r = db.query(models.Reserve).filter(models.Reserve.id == reserve_id).first()
    if not r or (r.source or "") != "website":
        raise HTTPException(status_code=404, detail=_PUBLIC_ORDER_NOT_FOUND)
    if not _phones_match_order(r.customer_phone, phone):
        raise HTTPException(status_code=404, detail=_PUBLIC_ORDER_NOT_FOUND)
    return build_public_order_status_response(r)


@router.get("/reserves/{reserve_id}", response_model=schemas.PublicReserveDetailResponse)
def get_public_reserve_detail(
    reserve_id: int,
    request: Request,
    phone: str = Query(
        ...,
        min_length=5,
        max_length=30,
        description="Телефон, указанный при оформлении заказа",
    ),
    db: Session = Depends(get_db),
):
    """
    Позиции и статусы (по заказу) для «Мои заказы» на витрине.
    Тот же `phone`, что и у GET /public/orders/{id} — без просмотра чужих заказов.
    """
    _guard_lookup_rate(request)
    r = (
        db.query(models.Reserve)
        .options(
            joinedload(models.Reserve.items)
            .joinedload(models.ReserveItem.product)
            .joinedload(models.Product.brand_rel),
            joinedload(models.Reserve.items)
            .joinedload(models.ReserveItem.product)
            .joinedload(models.Product.category_rel),
        )
        .filter(models.Reserve.id == reserve_id)
        .first()
    )
    if not r or (r.source or "") != "website":
        raise HTTPException(status_code=404, detail=_PUBLIC_ORDER_NOT_FOUND)
    if not _phones_match_order(r.customer_phone, phone):
        raise HTTPException(status_code=404, detail=_PUBLIC_ORDER_NOT_FOUND)
    return build_public_reserve_detail_response(r)

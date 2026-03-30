from datetime import date, datetime, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import desc, func
from sqlalchemy.orm import Session, joinedload

import models
import schemas
from database import get_db

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


def get_or_create_settings(db: Session):
    settings = db.query(models.Settings).first()
    if settings:
        return settings

    settings = models.Settings()
    db.add(settings)
    db.commit()
    db.refresh(settings)
    return settings


@router.get("/dashboard", response_model=schemas.DashboardStatsResponse)
def get_dashboard_stats(db: Session = Depends(get_db)):
    settings = get_or_create_settings(db)

    total_products = db.query(func.count(models.Product.id)).filter(models.Product.is_active == True).scalar() or 0
    low_stock_count = db.query(func.count(models.Product.id)).filter(
        models.Product.is_active == True,
        models.Product.quantity <= settings.low_stock_threshold,
    ).scalar() or 0

    cutoff = datetime.utcnow() - timedelta(days=30)
    stale_count = db.query(func.count(models.Product.id)).filter(
        models.Product.is_active == True,
        (models.Product.last_sale_date.is_(None)) | (models.Product.last_sale_date < cutoff),
    ).scalar() or 0

    today = date.today()
    month_start = today.replace(day=1)

    today_revenue, today_sales_count = db.query(
        func.sum(models.Sale.total_amount),
        func.count(models.Sale.id),
    ).filter(func.date(models.Sale.created_at) == today).first()

    mtd_revenue = db.query(func.sum(models.Sale.total_amount)).filter(
        func.date(models.Sale.created_at) >= month_start
    ).scalar() or Decimal("0")

    mtd_sales_count = (
        db.query(func.count(models.Sale.id)).filter(func.date(models.Sale.created_at) >= month_start).scalar()
        or 0
    )

    warehouse_value_sale = (
        db.query(func.sum(models.Product.sale_price * models.Product.quantity))
        .filter(models.Product.is_active == True)
        .scalar()
        or Decimal("0")
    )

    total_units = (
        db.query(func.coalesce(func.sum(models.Product.quantity), 0))
        .filter(models.Product.is_active == True)
        .scalar()
        or 0
    )

    low_stock_positions_lte5 = (
        db.query(func.count(models.Product.id))
        .filter(
            models.Product.is_active == True,
            models.Product.quantity <= 5,
        )
        .scalar()
        or 0
    )

    pending_reserves = db.query(func.count(models.Reserve.id)).filter(
        models.Reserve.status == models.ReserveStatus.PENDING
    ).scalar() or 0

    in_stock_reserves = db.query(func.count(models.Reserve.id)).filter(
        models.Reserve.status == models.ReserveStatus.IN_STOCK
    ).scalar() or 0

    warehouse_value = db.query(
        func.sum(models.Product.purchase_price * models.Product.quantity)
    ).filter(models.Product.is_active == True).scalar() or Decimal("0")

    notifications = []
    if low_stock_count:
        notifications.append({
            "type": "low_stock",
            "title": "Малый остаток",
            "message": f"{low_stock_count} товаров требуют пополнения",
        })
    if stale_count:
        notifications.append({
            "type": "stale_stock",
            "title": "Залежавшиеся товары",
            "message": f"{stale_count} товаров давно не продавались",
        })

    alert_limit = 14
    out_rows = (
        db.query(models.Product)
        .filter(models.Product.is_active == True, models.Product.quantity == 0)
        .order_by(models.Product.name)
        .limit(alert_limit)
        .all()
    )
    low_rows = (
        db.query(models.Product)
        .filter(
            models.Product.is_active == True,
            models.Product.quantity >= 1,
            models.Product.quantity <= 5,
        )
        .order_by(models.Product.name)
        .limit(alert_limit)
        .all()
    )
    stale_rows = (
        db.query(models.Product)
        .filter(
            models.Product.is_active == True,
            models.Product.quantity > 0,
            (models.Product.last_sale_date.is_(None)) | (models.Product.last_sale_date < cutoff),
        )
        .order_by(models.Product.name)
        .limit(alert_limit)
        .all()
    )

    alert_out_of_stock = [
        schemas.DashboardAlertItem(id=p.id, name=p.name, quantity=p.quantity, kind="out_of_stock")
        for p in out_rows
    ]
    alert_low_stock = [
        schemas.DashboardAlertItem(id=p.id, name=p.name, quantity=p.quantity, kind="low_stock")
        for p in low_rows
    ]
    alert_stale = [
        schemas.DashboardAlertItem(id=p.id, name=p.name, quantity=p.quantity, kind="stale")
        for p in stale_rows
    ]

    recent_sales = []
    sales_recent = (
        db.query(models.Sale)
        .options(joinedload(models.Sale.items).joinedload(models.SaleItem.product))
        .order_by(desc(models.Sale.created_at))
        .limit(5)
        .all()
    )
    for s in sales_recent:
        names = []
        for it in sorted(s.items, key=lambda x: x.id):
            if it.product_id and it.product:
                names.append(it.product.name)
            else:
                names.append("Товар")
        recent_sales.append(
            schemas.DashboardRecentSaleRow(
                id=s.id,
                receipt_number=s.receipt_number,
                total_amount=s.total_amount,
                created_at=s.created_at,
                product_names=", ".join(names) if names else "—",
            )
        )

    return schemas.DashboardStatsResponse(
        total_products=total_products,
        low_stock_count=low_stock_count,
        stale_stock_count=stale_count,
        total_sales_today=today_revenue or Decimal("0"),
        total_sales_mtd=mtd_revenue,
        sales_count_today=today_sales_count or 0,
        sales_count_mtd=mtd_sales_count,
        pending_reserves=pending_reserves,
        in_stock_reserves=in_stock_reserves,
        warehouse_value=warehouse_value,
        warehouse_value_sale=warehouse_value_sale,
        total_units=int(total_units),
        low_stock_positions_lte5=low_stock_positions_lte5,
        notifications=notifications,
        alert_out_of_stock=alert_out_of_stock,
        alert_low_stock=alert_low_stock,
        alert_stale=alert_stale,
        recent_sales=recent_sales,
    )


@router.get("/", response_model=schemas.SettingsResponse)
def get_settings(db: Session = Depends(get_db)):
    return get_or_create_settings(db)


@router.put("/", response_model=schemas.SettingsResponse)
def update_settings(update: schemas.SettingsUpdate, db: Session = Depends(get_db)):
    settings = get_or_create_settings(db)
    update_data = update.model_dump(exclude_unset=True)

    for field, value in update_data.items():
        if hasattr(settings, field):
            setattr(settings, field, value)

    db.commit()
    db.refresh(settings)
    return settings


@router.get("/exchange/cny-rate")
def get_cny_rate(db: Session = Depends(get_db)):
    settings = get_or_create_settings(db)
    return {
        "rate": float(settings.cny_rate),
        "currency_from": "CNY",
        "currency_to": "KZT",
        "updated_at": settings.updated_at.isoformat() if settings.updated_at else None,
    }


@router.put("/exchange/cny-rate")
def update_cny_rate(rate: float, db: Session = Depends(get_db)):
    if rate <= 0:
        raise HTTPException(status_code=400, detail="Rate must be positive")

    settings = get_or_create_settings(db)
    settings.cny_rate = rate
    db.commit()
    db.refresh(settings)

    return {
        "rate": float(settings.cny_rate),
        "currency_from": "CNY",
        "currency_to": "KZT",
        "updated_at": settings.updated_at.isoformat() if settings.updated_at else None,
    }


@router.get("/{setting_key}")
def get_setting(setting_key: str, db: Session = Depends(get_db)):
    settings = get_or_create_settings(db)
    value = getattr(settings, setting_key, None)
    if value is None:
        raise HTTPException(status_code=404, detail=f"Setting '{setting_key}' not found")
    return {setting_key: value}

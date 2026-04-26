from datetime import UTC, date, datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from dependencies import require_manager_or_admin

router = APIRouter(
    prefix="/api/v1/sales",
    tags=["sales"],
    dependencies=[Depends(require_manager_or_admin)],
)


@router.get("/", response_model=List[schemas.SaleResponse])
def list_sales(
    db: Session = Depends(get_db),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=1000),
):
    return db.query(models.Sale).order_by(models.Sale.created_at.desc()).offset(skip).limit(limit).all()


@router.get("/{sale_id}", response_model=schemas.SaleResponse)
def get_sale(sale_id: int, db: Session = Depends(get_db)):
    sale = db.query(models.Sale).filter(models.Sale.id == sale_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")
    return sale


@router.post("/", response_model=schemas.SaleResponse, status_code=status.HTTP_201_CREATED)
def create_sale(sale: schemas.SaleCreate, db: Session = Depends(get_db)):
    receipt_number = f"RCPT-{int(datetime.now(UTC).timestamp())}"
    total_amount = Decimal("0")
    items_to_create = []

    for item in sale.items:
        product = db.query(models.Product).filter(models.Product.id == item.product_id).first()
        if not product:
            raise HTTPException(status_code=404, detail=f"Product {item.product_id} not found")
        if product.quantity < item.quantity:
            raise HTTPException(status_code=400, detail=f"Insufficient stock for {product.name}")

        subtotal = Decimal(str(item.unit_price)) * item.quantity
        total_amount += subtotal
        items_to_create.append((product, item, subtotal))

    db_sale = models.Sale(
        receipt_number=receipt_number,
        total_amount=total_amount,
        payment_method=sale.payment_method,
        customer_info=sale.customer_info,
        notes=sale.notes,
    )
    db.add(db_sale)
    db.flush()

    for product, item, subtotal in items_to_create:
        product.quantity -= item.quantity
        product.last_sale_date = datetime.now(UTC)
        db.add(
            models.SaleItem(
                sale_id=db_sale.id,
                product_id=product.id,
                quantity=item.quantity,
                unit_price=item.unit_price,
                subtotal=subtotal,
            )
        )
        db.add(
            models.History(
                product_id=product.id,
                operation_type=models.OperationType.SOLD,
                quantity_change=-item.quantity,
                reference_type="sale",
                reference_id=db_sale.id,
                details={"message": f"Продажа {product.name}", "receipt_number": receipt_number},
            )
        )

    db.commit()
    db.refresh(db_sale)
    return db_sale


@router.get("/today/revenue", response_model=schemas.TodayRevenue)
def get_today_revenue(db: Session = Depends(get_db)):
    today = date.today()
    result = db.query(
        func.sum(models.Sale.total_amount),
        func.count(models.Sale.id),
    ).filter(func.date(models.Sale.created_at) == today).first()

    total_revenue = result[0] or Decimal("0")
    sales_count = result[1] or 0

    return schemas.TodayRevenue(
        total_revenue=total_revenue,
        sales_count=sales_count,
        average_check=total_revenue / sales_count if sales_count else Decimal("0"),
    )


@router.delete("/{sale_id}")
def delete_sale(sale_id: int, db: Session = Depends(get_db)):
    sale = db.query(models.Sale).filter(models.Sale.id == sale_id).first()
    if not sale:
        raise HTTPException(status_code=404, detail="Sale not found")

    for item in sale.items:
        product = db.query(models.Product).filter(models.Product.id == item.product_id).first()
        if product:
            product.quantity += item.quantity
            db.add(
                models.History(
                    product_id=product.id,
                    operation_type=models.OperationType.CANCELLED,
                    quantity_change=item.quantity,
                    reference_type="sale",
                    reference_id=sale_id,
                    details={"message": f"Продажа {sale.receipt_number} удалена"},
                )
            )

    db.query(models.SaleItem).filter(models.SaleItem.sale_id == sale_id).delete()
    db.delete(sale)
    db.commit()
    return {"message": "Sale deleted"}


@router.delete("/")
def clear_all_sales(db: Session = Depends(get_db)):
    count = db.query(models.Sale).count()
    db.query(models.SaleItem).delete()
    db.query(models.Sale).delete()
    db.commit()
    return {"message": f"Deleted {count} sales"}

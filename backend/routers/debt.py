"""Продажи в долг: клиенты, чеки, частичные оплаты."""

from datetime import UTC, datetime
from decimal import Decimal
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

import models
import schemas
from database import get_db
from dependencies import require_manager_or_admin

router = APIRouter(
    prefix="/api/v1/debt",
    tags=["debt"],
    dependencies=[Depends(require_manager_or_admin)],
)


def _balance(debt_sale: models.DebtSale) -> Decimal:
    return Decimal(str(debt_sale.total_amount)) - Decimal(str(debt_sale.paid_amount or 0))


def _debt_status(debt_sale: models.DebtSale) -> str:
    return "paid" if _balance(debt_sale) <= 0 else "open"


def _customer_open_balance(db: Session, customer_id: int) -> Decimal:
    rows = (
        db.query(
            func.coalesce(func.sum(models.DebtSale.total_amount - models.DebtSale.paid_amount), 0),
        )
        .filter(models.DebtSale.customer_id == customer_id)
        .filter(models.DebtSale.paid_amount < models.DebtSale.total_amount)
        .scalar()
    )
    return Decimal(str(rows or 0))


def _customer_to_response(db: Session, customer: models.DebtCustomer) -> schemas.DebtCustomerResponse:
    open_count = (
        db.query(func.count(models.DebtSale.id))
        .filter(
            models.DebtSale.customer_id == customer.id,
            models.DebtSale.paid_amount < models.DebtSale.total_amount,
        )
        .scalar()
        or 0
    )
    return schemas.DebtCustomerResponse(
        id=customer.id,
        name=customer.name,
        phone=customer.phone,
        notes=customer.notes,
        open_balance=_customer_open_balance(db, customer.id),
        open_sales_count=int(open_count),
        created_at=customer.created_at,
        updated_at=customer.updated_at,
    )


def _sale_item_lines(db: Session, sale: models.Sale) -> List[schemas.DebtSaleItemLine]:
    lines: List[schemas.DebtSaleItemLine] = []
    for item in sale.items:
        name = "Товар"
        if item.product_id:
            product = db.query(models.Product).filter(models.Product.id == item.product_id).first()
            if product:
                name = product.name
        lines.append(
            schemas.DebtSaleItemLine(
                product_id=item.product_id,
                product_name=name,
                quantity=item.quantity,
                unit_price=item.unit_price,
                subtotal=item.subtotal,
            )
        )
    return lines


def _title_name(name: str) -> str:
    return " ".join(w[:1].upper() + w[1:].lower() if w else "" for w in name.strip().split())


def _customer_receipt_seq_map(db: Session, customer_id: int) -> dict[int, int]:
    rows = (
        db.query(models.DebtSale.id)
        .filter(models.DebtSale.customer_id == customer_id)
        .order_by(models.DebtSale.created_at.asc())
        .all()
    )
    return {row[0]: i + 1 for i, row in enumerate(rows)}


def _debt_sale_to_response(
    db: Session,
    debt_sale: models.DebtSale,
    *,
    receipt_seq: Optional[int] = None,
) -> schemas.DebtSaleResponse:
    sale = debt_sale.sale
    if not sale:
        sale = db.query(models.Sale).filter(models.Sale.id == debt_sale.sale_id).first()
    customer = debt_sale.customer
    if not customer:
        customer = db.query(models.DebtCustomer).filter(models.DebtCustomer.id == debt_sale.customer_id).first()
    payments = sorted(debt_sale.payments or [], key=lambda p: p.created_at)
    bal = _balance(debt_sale)
    return schemas.DebtSaleResponse(
        id=debt_sale.id,
        customer_id=debt_sale.customer_id,
        sale_id=debt_sale.sale_id,
        receipt_number=sale.receipt_number if sale else "",
        receipt_seq=receipt_seq or 0,
        total_amount=debt_sale.total_amount,
        paid_amount=debt_sale.paid_amount or Decimal("0"),
        balance=bal if bal > 0 else Decimal("0"),
        status=_debt_status(debt_sale),
        created_at=debt_sale.created_at,
        customer_name=customer.name if customer else "",
        customer_phone=customer.phone if customer else "",
        customer_notes=customer.notes if customer else None,
        items=_sale_item_lines(db, sale) if sale else [],
        payments=[schemas.DebtPaymentResponse.model_validate(p) for p in payments],
    )


def _commit_sale(
    db: Session,
    items: List[schemas.SaleItemCreate],
    *,
    payment_method: str,
    customer_info: Optional[dict] = None,
    notes: Optional[str] = None,
) -> models.Sale:
    receipt_number = f"RCPT-{int(datetime.now(UTC).timestamp())}"
    total_amount = Decimal("0")
    items_to_create = []

    for item in items:
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
        payment_method=payment_method,
        customer_info=customer_info,
        notes=notes,
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
                details={
                    "message": f"Продажа в долг {product.name}",
                    "receipt_number": receipt_number,
                },
            )
        )

    return db_sale


@router.get("/customers", response_model=List[schemas.DebtCustomerResponse])
def list_debt_customers(
    search: Optional[str] = Query(None, max_length=120),
    db: Session = Depends(get_db),
):
    q = db.query(models.DebtCustomer).order_by(models.DebtCustomer.name.asc())
    if search and search.strip():
        s = f"%{search.strip().lower()}%"
        q = q.filter(
            (func.lower(models.DebtCustomer.name).like(s))
            | (func.lower(models.DebtCustomer.phone).like(s))
        )
    return [_customer_to_response(db, c) for c in q.all()]


@router.post("/customers", response_model=schemas.DebtCustomerResponse, status_code=status.HTTP_201_CREATED)
def create_debt_customer(
    payload: schemas.DebtCustomerCreate,
    db: Session = Depends(get_db),
):
    customer = models.DebtCustomer(
        name=_title_name(payload.name),
        phone=payload.phone.strip(),
        notes=(payload.notes or "").strip() or None,
    )
    db.add(customer)
    db.commit()
    db.refresh(customer)
    return _customer_to_response(db, customer)


@router.get("/customers/{customer_id}", response_model=schemas.DebtCustomerResponse)
def get_debt_customer(customer_id: int, db: Session = Depends(get_db)):
    customer = db.query(models.DebtCustomer).filter(models.DebtCustomer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    return _customer_to_response(db, customer)


@router.put("/customers/{customer_id}", response_model=schemas.DebtCustomerResponse)
def update_debt_customer(
    customer_id: int,
    payload: schemas.DebtCustomerUpdate,
    db: Session = Depends(get_db),
):
    customer = db.query(models.DebtCustomer).filter(models.DebtCustomer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    data = payload.model_dump(exclude_unset=True)
    if "name" in data and data["name"]:
        customer.name = _title_name(data["name"])
    if "phone" in data and data["phone"]:
        customer.phone = data["phone"].strip()
    if "notes" in data:
        customer.notes = (data["notes"] or "").strip() or None
    db.commit()
    db.refresh(customer)
    return _customer_to_response(db, customer)


@router.delete("/customers/{customer_id}")
def delete_debt_customer(customer_id: int, db: Session = Depends(get_db)):
    customer = db.query(models.DebtCustomer).filter(models.DebtCustomer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    open_count = (
        db.query(func.count(models.DebtSale.id))
        .filter(
            models.DebtSale.customer_id == customer_id,
            models.DebtSale.paid_amount < models.DebtSale.total_amount,
        )
        .scalar()
        or 0
    )
    if open_count > 0:
        raise HTTPException(
            status_code=400,
            detail="Нельзя удалить клиента с непогашенным долгом",
        )
    db.delete(customer)
    db.commit()
    return {"message": "Customer deleted"}


@router.get("/customers/{customer_id}/sales", response_model=List[schemas.DebtSaleResponse])
def list_customer_debt_sales(customer_id: int, db: Session = Depends(get_db)):
    customer = db.query(models.DebtCustomer).filter(models.DebtCustomer.id == customer_id).first()
    if not customer:
        raise HTTPException(status_code=404, detail="Customer not found")
    sales = (
        db.query(models.DebtSale)
        .options(
            joinedload(models.DebtSale.sale),
            joinedload(models.DebtSale.customer),
            joinedload(models.DebtSale.payments),
        )
        .filter(models.DebtSale.customer_id == customer_id)
        .order_by(models.DebtSale.created_at.desc())
        .all()
    )
    seq_map = _customer_receipt_seq_map(db, customer_id)
    return [_debt_sale_to_response(db, ds, receipt_seq=seq_map.get(ds.id, 0)) for ds in sales]


@router.post("/sales", response_model=schemas.DebtSaleResponse, status_code=status.HTTP_201_CREATED)
def create_debt_sale(payload: schemas.DebtSaleCreate, db: Session = Depends(get_db)):
    if not payload.customer_id and not payload.customer:
        raise HTTPException(status_code=400, detail="Укажите клиента (customer_id или customer)")

    if payload.customer_id:
        customer = db.query(models.DebtCustomer).filter(models.DebtCustomer.id == payload.customer_id).first()
        if not customer:
            raise HTTPException(status_code=404, detail="Customer not found")
    else:
        c = payload.customer
        customer = models.DebtCustomer(
            name=_title_name(c.name),
            phone=c.phone.strip(),
            notes=(c.notes or "").strip() or None,
        )
        db.add(customer)
        db.flush()

    customer_info = {
        "debt_customer_id": customer.id,
        "name": customer.name,
        "phone": customer.phone,
    }
    db_sale = _commit_sale(
        db,
        payload.items,
        payment_method="credit",
        customer_info=customer_info,
        notes=payload.notes,
    )

    debt_sale = models.DebtSale(
        customer_id=customer.id,
        sale_id=db_sale.id,
        total_amount=db_sale.total_amount,
        paid_amount=Decimal("0"),
    )
    db.add(debt_sale)
    db.commit()

    debt_sale = (
        db.query(models.DebtSale)
        .options(
            joinedload(models.DebtSale.sale),
            joinedload(models.DebtSale.customer),
            joinedload(models.DebtSale.payments),
        )
        .filter(models.DebtSale.id == debt_sale.id)
        .first()
    )
    seq_map = _customer_receipt_seq_map(db, customer.id)
    return _debt_sale_to_response(db, debt_sale, receipt_seq=seq_map.get(debt_sale.id, 0))


@router.get("/sales/{debt_sale_id}", response_model=schemas.DebtSaleResponse)
def get_debt_sale(debt_sale_id: int, db: Session = Depends(get_db)):
    debt_sale = (
        db.query(models.DebtSale)
        .options(
            joinedload(models.DebtSale.sale),
            joinedload(models.DebtSale.customer),
            joinedload(models.DebtSale.payments),
        )
        .filter(models.DebtSale.id == debt_sale_id)
        .first()
    )
    if not debt_sale:
        raise HTTPException(status_code=404, detail="Debt sale not found")
    seq_map = _customer_receipt_seq_map(db, debt_sale.customer_id)
    return _debt_sale_to_response(db, debt_sale, receipt_seq=seq_map.get(debt_sale.id, 0))


@router.post("/sales/{debt_sale_id}/payments", response_model=schemas.DebtSaleResponse)
def add_debt_payment(
    debt_sale_id: int,
    payload: schemas.DebtPaymentCreate,
    db: Session = Depends(get_db),
):
    debt_sale = (
        db.query(models.DebtSale)
        .options(
            joinedload(models.DebtSale.sale),
            joinedload(models.DebtSale.customer),
            joinedload(models.DebtSale.payments),
        )
        .filter(models.DebtSale.id == debt_sale_id)
        .first()
    )
    if not debt_sale:
        raise HTTPException(status_code=404, detail="Debt sale not found")

    balance = _balance(debt_sale)
    if balance <= 0:
        raise HTTPException(status_code=400, detail="Долг уже погашен")

    amount = Decimal(str(payload.amount))
    if amount > balance:
        raise HTTPException(
            status_code=400,
            detail=f"Сумма больше остатка ({balance})",
        )

    db.add(
        models.DebtPayment(
            debt_sale_id=debt_sale.id,
            amount=amount,
            note=(payload.note or "").strip() or None,
        )
    )
    debt_sale.paid_amount = Decimal(str(debt_sale.paid_amount or 0)) + amount
    db.commit()
    db.refresh(debt_sale)
    seq_map = _customer_receipt_seq_map(db, debt_sale.customer_id)
    return _debt_sale_to_response(db, debt_sale, receipt_seq=seq_map.get(debt_sale.id, 0))

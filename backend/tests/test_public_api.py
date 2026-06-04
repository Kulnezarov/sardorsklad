from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

import models
from database import get_db
from routers.public import build_public_order_status_response, build_public_reserve_detail_response, router as public_router


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows

    def outerjoin(self, *args, **kwargs):
        return self

    def join(self, *args, **kwargs):
        return self

    def filter(self, *args, **kwargs):
        return self

    def with_for_update(self):
        return self

    def with_entities(self, *args, **kwargs):
        return self

    def scalar(self):
        return len(self.rows)

    def order_by(self, *args, **kwargs):
        return self

    def options(self, *args, **kwargs):
        return self

    def offset(self, v):
        return self

    def limit(self, v):
        return self

    def all(self):
        return self.rows

    def first(self):
        return self.rows[0] if self.rows else None


class FakeDB:
    def __init__(self):
        self.products = [
            SimpleNamespace(
                id=1,
                name="Амортизатор",
                sku="ART-1",
                barcode=None,
                sale_price=Decimal("1000"),
                quantity=5,
                category_id=2,
                brand_id=None,
                image_url="https://img/1.jpg",
                image_urls=None,
                is_active=True,
                show_on_storefront=True,
                category_rel=None,
                brand_rel=None,
            )
        ]
        self._reserves = []
        self._added = []

    def query(self, *entities):
        if len(entities) > 1:
            return FakeQuery([])
        model = entities[0] if entities else None
        if model is models.Product:
            return FakeQuery(self.products)
        if model is models.Reserve:
            return FakeQuery(self._reserves)
        return FakeQuery([])

    def add(self, obj):
        if isinstance(obj, models.Reserve):
            obj.id = len(self._reserves) + 1
            obj.items = []
            self._reserves.append(obj)
        if isinstance(obj, models.ReserveItem) and self._reserves:
            self._reserves[-1].items.append(obj)
        self._added.append(obj)

    def flush(self):
        return None

    def commit(self):
        return None

    def refresh(self, obj):
        return None


def make_client(fake_db: FakeDB) -> TestClient:
    app = FastAPI()
    app.include_router(public_router)
    app.dependency_overrides[get_db] = lambda: fake_db
    return TestClient(app)


def test_public_products_returns_safe_fields():
    db = FakeDB()
    client = make_client(db)
    res = client.get("/api/v1/public/products")
    assert res.status_code == 200
    body = res.json()
    assert "items" in body and "total" in body
    assert body["total"] == 1
    row = body["items"][0]
    assert "purchase_price" not in row and "cny_price" not in row
    assert sorted(row.keys()) == sorted(
        [
            "id",
            "name",
            "sale_price",
            "quantity",
            "category_id",
            "image_url",
            "image_urls",
            "category_name",
            "brand_id",
            "brand_name",
            "model",
            "article",
            "oem",
            "compatibility",
        ]
    )


def test_public_order_create_success():
    db = FakeDB()
    client = make_client(db)
    payload = {
        "customer_name": "Иван",
        "customer_phone": "+77001234567",
        "items": [{"product_id": 1, "quantity": 2}],
    }
    res = client.post("/api/v1/public/orders", json=payload)
    assert res.status_code == 201
    body = res.json()
    assert body["ok"] is True
    assert body["reserve_id"] == 1


def test_public_order_status_cancelled_payload():
    r = SimpleNamespace(
        id=1,
        order_code="WEB-1",
        status="Отменен",
        created_at=datetime.now(timezone.utc),
    )
    p = build_public_order_status_response(r)
    assert p.is_cancelled is True
    assert p.is_fulfilled is False
    assert "отмен" in p.status_title.lower()


def test_public_reserve_detail_maps_lines():
    line = SimpleNamespace(
        id=9,
        product_id=2,
        product_name="Test",
        quantity_ordered=1,
        quantity=1,
        price_kzt=Decimal("500"),
        sale_price_snapshot=Decimal("500"),
        line_total=Decimal("500"),
    )
    r = SimpleNamespace(
        id=1,
        order_code="WEB-1",
        status="Новый заказ",
        created_at=datetime.now(timezone.utc),
        items=[line],
        total_amount_kzt=Decimal("500"),
        total_amount=None,
    )
    d = build_public_reserve_detail_response(r)
    assert len(d.items) == 1
    assert d.items[0].line_status == "pending"
    assert d.items[0].unit_price == "500.00"
    assert d.total_amount == "500.00"


def test_public_order_not_enough_stock():
    db = FakeDB()
    client = make_client(db)
    payload = {
        "customer_name": "Иван",
        "customer_phone": "+77001234567",
        "items": [{"product_id": 1, "quantity": 99}],
    }
    res = client.post("/api/v1/public/orders", json=payload)
    assert res.status_code == 409

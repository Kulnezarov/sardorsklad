from decimal import Decimal
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

import models
from database import get_db
from routers.public import router as public_router


class FakeQuery:
    def __init__(self, rows):
        self.rows = rows

    def filter(self, *args, **kwargs):
        return self

    def with_for_update(self):
        return self

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
                sale_price=Decimal("1000"),
                quantity=5,
                category_id=2,
                image_url="https://img/1.jpg",
                is_active=True,
            )
        ]
        self._reserves = []
        self._added = []

    def query(self, model):
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
    row = res.json()[0]
    assert sorted(row.keys()) == ["category_id", "id", "image_url", "name", "quantity", "sale_price"]


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

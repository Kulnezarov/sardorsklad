from types import SimpleNamespace

from services.product_sku import normalize_sku, sku_conflict_detail


def test_normalize_sku_trims():
    assert normalize_sku("  ABC-1  ") == "ABC-1"
    assert normalize_sku(None) == ""
    assert normalize_sku("") == ""


def test_sku_conflict_detail_shape():
    product = SimpleNamespace(
        id=42,
        sku="PART-001",
        name="Фильтр",
        brand="Toyota",
        barcode="4601234567890",
        is_active=True,
    )
    detail = sku_conflict_detail(product)
    assert detail["code"] == "SKU_EXISTS"
    assert detail["product_id"] == 42
    assert detail["sku"] == "PART-001"
    assert detail["name"] == "Фильтр"
    assert detail["is_active"] is True

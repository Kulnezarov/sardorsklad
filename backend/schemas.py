from datetime import datetime
from decimal import Decimal
from enum import Enum
from typing import Any, List, Optional

from pydantic import BaseModel, Field, condecimal, field_validator


class OperationType(str, Enum):
    ADDED = "added"
    SOLD = "sold"
    EDITED = "edited"
    DISCOUNT = "discount"
    DELETED = "deleted"
    ORDERED = "ordered"
    TO_STOCK = "to_stock"
    CANCELLED = "cancelled"
    RESTORED = "restored"
    REVISION = "revision"


class ReserveStatus(str, Enum):
    PENDING = "pending"
    IN_STOCK = "in_stock"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


Money10_2 = condecimal(max_digits=10, decimal_places=2)
Percent5_2 = condecimal(max_digits=5, decimal_places=2)


class ProductBase(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    sku: Optional[str] = Field(None, max_length=100)
    barcode: Optional[str] = Field(None, max_length=50)
    brand: Optional[str] = Field(None, max_length=100)
    category: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
    purchase_price: Money10_2
    sale_price: Money10_2
    cny_price: Optional[Money10_2] = None
    delivery_cost_kzt: Optional[Money10_2] = None
    profit_percent: Optional[Percent5_2] = None
    quantity: int = Field(0, ge=0)
    min_quantity: Optional[int] = Field(0, ge=0)
    max_quantity: Optional[int] = Field(None, ge=0)
    location_row: Optional[str] = Field(None, max_length=10)
    location_shelf: Optional[str] = Field(None, max_length=10)
    location_position: Optional[str] = Field(None, max_length=10)
    location_zone: Optional[str] = Field(None, max_length=50)
    supplier: Optional[str] = Field(None, max_length=255)

    @field_validator('purchase_price', 'sale_price', 'cny_price', 'delivery_cost_kzt', 'profit_percent', mode='before')
    @classmethod
    def convert_decimal(cls, value):
        if value is None or value == "":
            return None
        return Decimal(str(value))


class ProductCreate(ProductBase):
    pass


class ProductUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    sku: Optional[str] = Field(None, max_length=100)
    barcode: Optional[str] = Field(None, max_length=50)
    brand: Optional[str] = Field(None, max_length=100)
    category: Optional[str] = Field(None, max_length=100)
    description: Optional[str] = None
    purchase_price: Optional[Money10_2] = None
    sale_price: Optional[Money10_2] = None
    cny_price: Optional[Money10_2] = None
    delivery_cost_kzt: Optional[Money10_2] = None
    profit_percent: Optional[Percent5_2] = None
    quantity: Optional[int] = Field(None, ge=0)
    min_quantity: Optional[int] = Field(None, ge=0)
    max_quantity: Optional[int] = Field(None, ge=0)
    location_row: Optional[str] = Field(None, max_length=10)
    location_shelf: Optional[str] = Field(None, max_length=10)
    location_position: Optional[str] = Field(None, max_length=10)
    location_zone: Optional[str] = Field(None, max_length=50)
    supplier: Optional[str] = Field(None, max_length=255)
    is_active: Optional[bool] = None

    @field_validator('purchase_price', 'sale_price', 'cny_price', 'delivery_cost_kzt', 'profit_percent', mode='before')
    @classmethod
    def convert_decimal(cls, value):
        if value is None or value == "":
            return None
        return Decimal(str(value))


class ProductResponse(ProductBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: Optional[datetime]
    last_sale_date: Optional[datetime]
    received_at: Optional[datetime] = None

    model_config = {"from_attributes": True}


class ImportExcelSkipItem(BaseModel):
    row: int
    reason: str
    raw: Optional[str] = None


class ImportExcelResponse(BaseModel):
    created: int
    skipped: List[ImportExcelSkipItem]


class SaleItemCreate(BaseModel):
    product_id: int
    quantity: int = Field(..., gt=0)
    unit_price: Money10_2

    @field_validator('unit_price', mode='before')
    @classmethod
    def convert_decimal(cls, value):
        return Decimal(str(value))


class SaleItemResponse(BaseModel):
    id: int
    sale_id: int
    product_id: Optional[int]
    quantity: int
    unit_price: Decimal
    subtotal: Decimal
    created_at: Optional[datetime]

    model_config = {"from_attributes": True}


class SaleCreate(BaseModel):
    items: List[SaleItemCreate] = Field(..., min_length=1)
    payment_method: Optional[str] = Field(None, max_length=20)
    customer_info: Optional[Any] = None
    notes: Optional[str] = None


class SaleResponse(BaseModel):
    id: int
    receipt_number: str
    total_amount: Decimal
    payment_method: Optional[str]
    customer_info: Optional[Any]
    notes: Optional[str]
    created_at: datetime
    items: List[SaleItemResponse] = []

    model_config = {"from_attributes": True}


class ReserveItemCreate(BaseModel):
    product_id: Optional[int] = None
    product_name: str
    quantity_ordered: int = Field(..., gt=0)
    price_cny: Money10_2

    @field_validator('price_cny', mode='before')
    @classmethod
    def convert_decimal(cls, value):
        return Decimal(str(value))


class ReserveItemResponse(ReserveItemCreate):
    id: int
    reserve_id: int
    quantity_received: int = 0
    price_kzt: Decimal

    model_config = {"from_attributes": True}


class ReserveCreate(BaseModel):
    customer_name: str = Field(..., min_length=1, max_length=255)
    customer_phone: Optional[str] = Field(None, max_length=20)
    items: List[ReserveItemCreate] = Field(..., min_length=1)
    expected_arrival: Optional[datetime] = None
    notes: Optional[str] = None


class ReserveUpdate(BaseModel):
    customer_name: Optional[str] = None
    customer_phone: Optional[str] = None
    status: Optional[ReserveStatus] = None
    expected_arrival: Optional[datetime] = None
    notes: Optional[str] = None


class ReserveResponse(BaseModel):
    id: int
    order_code: str
    customer_name: str
    customer_phone: Optional[str]
    status: str
    items: List[ReserveItemResponse]
    total_amount_cny: Decimal
    total_amount_kzt: Decimal
    cny_rate: float
    created_at: datetime
    expected_arrival: Optional[datetime]
    completed_at: Optional[datetime]
    notes: Optional[str]

    model_config = {"from_attributes": True}


# ── WishItem schemas ──────────────────────────────────────────────────────────
class WishItemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    brand: Optional[str] = Field(None, max_length=100)
    category: Optional[str] = Field(None, max_length=100)
    notes: Optional[str] = None
    photo_data: Optional[str] = None   # base64


class WishItemUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    brand: Optional[str] = None
    category: Optional[str] = None
    notes: Optional[str] = None
    photo_data: Optional[str] = None


class WishItemResponse(BaseModel):
    id: int
    name: str
    brand: Optional[str]
    category: Optional[str]
    notes: Optional[str]
    photo_data: Optional[str]
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


# ── PurchaseOrder schemas ─────────────────────────────────────────────────────
class PurchaseOrderCreate(BaseModel):
    wish_item_id: Optional[int] = None
    name: str = Field(..., min_length=1, max_length=255)
    brand: Optional[str] = None
    category: Optional[str] = None
    photo_data: Optional[str] = None
    barcode: Optional[str] = None
    supplier: Optional[str] = None
    price_cny: Optional[Decimal] = None
    price_kzt: Optional[Decimal] = None
    cny_rate: Optional[float] = None
    quantity_ordered: int = Field(1, gt=0)
    notes: Optional[str] = None

    @field_validator('price_cny', 'price_kzt', mode='before')
    @classmethod
    def convert_decimal(cls, value):
        if value is None or value == '':
            return None
        return Decimal(str(value))


class PurchaseOrderUpdate(BaseModel):
    supplier: Optional[str] = None
    price_cny: Optional[Decimal] = None
    price_kzt: Optional[Decimal] = None
    quantity_ordered: Optional[int] = Field(None, gt=0)
    notes: Optional[str] = None
    status: Optional[str] = None

    @field_validator('price_cny', 'price_kzt', mode='before')
    @classmethod
    def convert_decimal(cls, value):
        if value is None or value == '':
            return None
        return Decimal(str(value))


class PurchaseOrderResponse(BaseModel):
    id: int
    wish_item_id: Optional[int]
    name: str
    brand: Optional[str]
    category: Optional[str]
    photo_data: Optional[str]
    barcode: Optional[str]
    supplier: Optional[str]
    price_cny: Optional[Decimal]
    price_kzt: Optional[Decimal]
    cny_rate: Optional[float]
    quantity_ordered: int
    quantity_received: int
    notes: Optional[str]
    status: str
    ordered_at: datetime
    completed_at: Optional[datetime]

    model_config = {"from_attributes": True}


class AcceptToStockPayload(BaseModel):
    quantity_received: int = Field(..., gt=0)
    purchase_price_kzt: Decimal
    delivery_cost_kzt: Optional[Decimal] = Decimal('0')
    sale_price_kzt: Decimal
    storage_location: Optional[str] = None
    keep_remainder: bool = True
    notes: Optional[str] = None

    @field_validator('purchase_price_kzt', 'delivery_cost_kzt', 'sale_price_kzt', mode='before')
    @classmethod
    def convert_decimal(cls, value):
        if value is None or value == '':
            return Decimal('0')
        return Decimal(str(value))


# ── HistoryResponse ───────────────────────────────────────────────────────────
class HistoryResponse(BaseModel):
    id: int
    product_id: Optional[int]
    operation_type: str
    quantity_change: Optional[int]
    reference_type: Optional[str]
    reference_id: Optional[int]
    details: Optional[Any]
    created_at: datetime

    model_config = {"from_attributes": True}


class RevisionItemCreate(BaseModel):
    product_id: int
    quantity_expected: int = Field(..., ge=0)
    quantity_actual: Optional[int] = Field(None, ge=0)
    correction_notes: Optional[str] = None


class RevisionItemResponse(RevisionItemCreate):
    id: int
    session_id: int
    discrepancy: Optional[int]
    is_corrected: bool

    model_config = {"from_attributes": True}


class RevisionSessionCreate(BaseModel):
    notes: Optional[str] = None


class RevisionSessionUpdate(BaseModel):
    notes: Optional[str] = None


class RevisionSessionResponse(BaseModel):
    id: int
    session_code: str
    status: str
    items: List[RevisionItemResponse]
    notes: Optional[str]
    created_at: datetime
    completed_at: Optional[datetime]

    model_config = {"from_attributes": True}


class RevisionItemUpdate(BaseModel):
    quantity_actual: int = Field(..., ge=0)
    correction_notes: Optional[str] = None


class SettingsUpdate(BaseModel):
    store_name: Optional[str] = Field(None, max_length=255)
    scan_auto_increment: Optional[bool] = None
    history_auto_clean_days: Optional[int] = Field(None, ge=0)
    label_size: Optional[str] = Field(None, max_length=20)
    dark_mode: Optional[bool] = None
    cny_rate: Optional[float] = Field(None, gt=0)
    low_stock_threshold: Optional[int] = Field(None, gt=0)


class SettingsResponse(BaseModel):
    id: int
    store_name: str
    scan_auto_increment: bool
    history_auto_clean_days: int
    label_size: str
    dark_mode: bool
    cny_rate: float
    low_stock_threshold: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DashboardAlertItem(BaseModel):
    id: int
    name: str
    quantity: int
    kind: str  # out_of_stock | low_stock | stale


class DashboardRecentSaleRow(BaseModel):
    id: int
    receipt_number: str
    total_amount: Decimal
    created_at: datetime
    product_names: str


class DashboardStatsResponse(BaseModel):
    total_products: int
    low_stock_count: int
    stale_stock_count: int
    total_sales_today: Decimal
    total_sales_mtd: Decimal
    sales_count_today: int
    sales_count_mtd: int = 0
    pending_reserves: int
    in_stock_reserves: int
    warehouse_value: Decimal
    warehouse_value_sale: Decimal = Decimal("0")
    total_units: int = 0
    low_stock_positions_lte5: int = 0
    notifications: List[dict] = []
    alert_out_of_stock: List[DashboardAlertItem] = []
    alert_low_stock: List[DashboardAlertItem] = []
    alert_stale: List[DashboardAlertItem] = []
    recent_sales: List[DashboardRecentSaleRow] = []


class TodayRevenue(BaseModel):
    total_revenue: Decimal
    sales_count: int
    average_check: Decimal


class ImportResult(BaseModel):
    success_count: int
    error_count: int
    errors: List[dict]

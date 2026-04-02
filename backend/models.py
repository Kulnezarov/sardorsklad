from sqlalchemy import (
    Column, Integer, String, Float, DateTime, Boolean, ForeignKey, Text,
    Numeric, Date, Enum, Index, CheckConstraint, UniqueConstraint, Computed,
)
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from sqlalchemy.dialects.postgresql import JSONB
from database import Base
from datetime import datetime
import enum


class OperationType(str, enum.Enum):
    """Enum for history operation types."""
    ADDED = "added"
    SOLD = "sold"
    EDITED = "edited"
    DISCOUNT = "discount"
    DELETED = "deleted"
    ORDERED = "ordered"  # Reserved/Ordered
    TO_STOCK = "to_stock"  # Moved from reserve to stock
    CANCELLED = "cancelled"  # Cancelled reserve
    RESTORED = "restored"  # Restored cancelled
    REVISION = "revision"  # Inventory correction


class ReserveStatus(str, enum.Enum):
    """Enum for reserve/order status."""
    PENDING = "pending"  # Waiting to process
    IN_STOCK = "in_stock"  # Moved to warehouse
    COMPLETED = "completed"  # All items received
    CANCELLED = "cancelled"  # Order cancelled


# ============================================================================
# TABLE 1: PRODUCTS
# ============================================================================
class Product(Base):
    __tablename__ = "products"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False, index=True)
    sku = Column(String(100), unique=True, nullable=False, index=True)
    barcode = Column(String(50), unique=True, nullable=True, index=True)
    category = Column(String(100), nullable=True, index=True)
    brand = Column(String(100), nullable=True, index=True)
    description = Column(Text, nullable=True)
    purchase_price = Column(Numeric(10, 2), nullable=False, default=0)
    sale_price = Column(Numeric(10, 2), nullable=False, default=0)
    cny_price = Column(Numeric(10, 2), nullable=True)
    delivery_cost_kzt = Column(Numeric(10, 2), nullable=True)
    # В PostgreSQL колонка может быть GENERATED — не передаём значение из приложения
    profit_percent = Column(
        Numeric(5, 2),
        Computed(
            "(CASE WHEN purchase_price IS NULL OR purchase_price = 0 THEN NULL "
            "ELSE ROUND((((sale_price - purchase_price) / purchase_price) * 100)::numeric, 2) END)",
            persisted=True,
        ),
    )
    quantity = Column(Integer, default=0, nullable=False)
    min_quantity = Column(Integer, default=0, nullable=True)
    max_quantity = Column(Integer, nullable=True)
    location_row = Column(String(10), nullable=True)
    location_shelf = Column(String(10), nullable=True)
    location_position = Column(String(10), nullable=True)
    location_zone = Column(String(50), nullable=True)
    supplier = Column(String(255), nullable=True)

    # Tracking
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now(), nullable=True)
    last_sale_date = Column(DateTime(timezone=True), nullable=True)
    received_at = Column(DateTime(timezone=True), nullable=True)

    # Status flags
    is_active = Column(Boolean, default=True, nullable=False)
    # Relationships
    sales_items = relationship("SaleItem", back_populates="product", cascade="all, delete-orphan")
    reserve_items = relationship("ReserveItem", back_populates="product", cascade="all, delete-orphan")
    history = relationship("History", back_populates="product", cascade="all, delete-orphan")
    revision_items = relationship("RevisionItem", back_populates="product", cascade="all, delete-orphan")

    # Indexes
    __table_args__ = (
        Index('idx_products_category', 'category'),
        Index('idx_products_is_active', 'is_active'),
        Index('idx_products_created_at', 'created_at'),
    )


# ============================================================================
# TABLE 2: SALES (Чеки/Квитанции)
# ============================================================================
class Sale(Base):
    __tablename__ = "sales"

    id = Column(Integer, primary_key=True, index=True)
    receipt_number = Column(String(50), unique=True, nullable=False, index=True)
    total_amount = Column(Numeric(10, 2), nullable=False)
    payment_method = Column(String(20), nullable=True)
    customer_info = Column(JSONB, nullable=True)
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    items = relationship("SaleItem", back_populates="sale", cascade="all, delete-orphan")

    __table_args__ = (
        Index('idx_sales_created_at', 'created_at'),
        Index('idx_sales_receipt_number', 'receipt_number'),
    )


class SaleItem(Base):
    __tablename__ = "sale_items"

    id = Column(Integer, primary_key=True, index=True)
    sale_id = Column(Integer, ForeignKey("sales.id", ondelete="CASCADE"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="SET NULL"), nullable=True)

    quantity = Column(Integer, nullable=False)
    unit_price = Column(Numeric(10, 2), nullable=False)
    subtotal = Column(Numeric(10, 2), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    sale = relationship("Sale", back_populates="items")
    product = relationship("Product", back_populates="sales_items")

    __table_args__ = (
        Index('idx_sale_items_sale_id', 'sale_id'),
        Index('idx_sale_items_product_id', 'product_id'),
    )


# ============================================================================
# TABLE 3: RESERVES (Заказы/Резервы)
# ============================================================================
class Reserve(Base):
    __tablename__ = "reserves"

    id = Column(Integer, primary_key=True, index=True)
    order_code = Column(String(50), unique=True, nullable=False, index=True)  # ORD-{timestamp}

    # Заказчик
    customer_name = Column(String(255), nullable=False)
    customer_phone = Column(String(20), nullable=True)

    # Статус
    status = Column(String(20), default=ReserveStatus.PENDING, nullable=False, index=True)

    # Деньги
    total_amount_cny = Column(Numeric(12, 2), nullable=False)  # Сумма в юанях
    total_amount_kzt = Column(Numeric(12, 2), nullable=False)  # Сумма в тенге
    cny_rate = Column(Float, nullable=False)  # Текущий курс на момент заказа

    # Сроки
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    expected_arrival = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    notes = Column(Text, nullable=True)

    # Relationships
    items = relationship("ReserveItem", back_populates="reserve", cascade="all, delete-orphan")

    __table_args__ = (
        Index('idx_reserves_status', 'status'),
        Index('idx_reserves_created_at', 'created_at'),
        Index('idx_reserves_customer_name', 'customer_name'),
    )


class ReserveItem(Base):
    __tablename__ = "reserve_items"

    id = Column(Integer, primary_key=True, index=True)
    reserve_id = Column(Integer, ForeignKey("reserves.id", ondelete="CASCADE"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="SET NULL"), nullable=True)

    product_name = Column(String(255), nullable=False)
    quantity_ordered = Column(Integer, nullable=False)
    quantity_received = Column(Integer, default=0, nullable=False)

    price_cny = Column(Numeric(10, 2), nullable=False)
    price_kzt = Column(Numeric(10, 2), nullable=False)

    # Relationships
    reserve = relationship("Reserve", back_populates="items")
    product = relationship("Product", back_populates="reserve_items")

    __table_args__ = (
        Index('idx_reserve_items_reserve_id', 'reserve_id'),
        Index('idx_reserve_items_product_id', 'product_id'),
    )


# ============================================================================
# TABLE 4: HISTORY (Логистика/Аудит)
# ============================================================================
class History(Base):
    __tablename__ = "history"

    id = Column(Integer, primary_key=True, index=True)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="SET NULL"), nullable=True)

    operation_type = Column(String(50), nullable=False, index=True)  # See OperationType enum

    quantity_change = Column(Integer, nullable=True)
    reference_type = Column(String(20), nullable=True)
    reference_id = Column(Integer, nullable=True)
    details = Column(JSONB, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    product = relationship("Product", back_populates="history")

    __table_args__ = (
        Index('idx_history_product_id', 'product_id'),
        Index('idx_history_operation_type', 'operation_type'),
        Index('idx_history_created_at', 'created_at'),
        Index('idx_history_reference', 'reference_type', 'reference_id'),
    )


# ============================================================================
# TABLE 5: REVISIONS (Ревизия/Инвентаризация)
# ============================================================================
class RevisionSession(Base):
    __tablename__ = "revision_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_code = Column(String(50), unique=True, nullable=False, index=True)

    status = Column(String(20), default="in_progress", nullable=False)  # in_progress, completed, cancelled

    notes = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    items = relationship("RevisionItem", back_populates="session", cascade="all, delete-orphan")

    __table_args__ = (
        Index('idx_revision_sessions_status', 'status'),
        Index('idx_revision_sessions_created_at', 'created_at'),
    )


class RevisionItem(Base):
    __tablename__ = "revision_items"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(Integer, ForeignKey("revision_sessions.id", ondelete="CASCADE"), nullable=False)
    product_id = Column(Integer, ForeignKey("products.id", ondelete="CASCADE"), nullable=False)

    quantity_expected = Column(Integer, nullable=False)
    quantity_actual = Column(Integer, nullable=True)  # NULL if not counted yet

    discrepancy = Column(Integer, nullable=True)  # actual - expected
    is_corrected = Column(Boolean, default=False, nullable=False)

    correction_notes = Column(Text, nullable=True)

    # Relationships
    session = relationship("RevisionSession", back_populates="items")
    product = relationship("Product", back_populates="revision_items")

    __table_args__ = (
        Index('idx_revision_items_session_id', 'session_id'),
        Index('idx_revision_items_product_id', 'product_id'),
    )


# ============================================================================
# TABLE 6: SETTINGS (Настройки)
# ============================================================================
class Settings(Base):
    __tablename__ = "settings"

    id = Column(Integer, primary_key=True, index=True)
    
    # Основные настройки
    store_name = Column(String(255), default='SkladPro', nullable=False)
    scan_auto_increment = Column(Boolean, default=True, nullable=False)
    history_auto_clean_days = Column(Integer, default=30, nullable=False)
    label_size = Column(String(20), default='small', nullable=False)
    dark_mode = Column(Boolean, default=False, nullable=False)
    
    # Финансы
    cny_rate = Column(Numeric(10, 2), default=65.0, nullable=False)
    low_stock_threshold = Column(Integer, default=5, nullable=False)
    
    # Метаданные
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)
    
    # Constraint для одной записи и проверки
    __table_args__ = (
        CheckConstraint('id = 1', name='single_settings'),
        CheckConstraint('low_stock_threshold > 0', name='positive_low_stock'),
    )


# ============================================================================
# TABLE 7: WISH ITEMS (Список желаемых товаров — "Нужно заказать")
# ============================================================================
class WishItem(Base):
    __tablename__ = "wish_items"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String(255), nullable=False)
    brand = Column(String(100), nullable=True)
    category = Column(String(100), nullable=True)
    notes = Column(Text, nullable=True)
    photo_data = Column(Text, nullable=True)   # base64 compressed image
    status = Column(String(20), default='pending', nullable=False, index=True)
    # pending → ordered (when a PurchaseOrder is created from it)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    # Relationships
    purchase_orders = relationship("PurchaseOrder", back_populates="wish_item")

    __table_args__ = (
        Index('idx_wish_items_status', 'status'),
        Index('idx_wish_items_created_at', 'created_at'),
    )


# ============================================================================
# TABLE 8: PURCHASE ORDERS (Заказы у поставщиков — "В пути")
# ============================================================================
class PurchaseOrder(Base):
    __tablename__ = "purchase_orders"

    id = Column(Integer, primary_key=True, index=True)
    wish_item_id = Column(Integer, ForeignKey("wish_items.id", ondelete="SET NULL"), nullable=True)

    name = Column(String(255), nullable=False)
    brand = Column(String(100), nullable=True)
    category = Column(String(100), nullable=True)
    photo_data = Column(Text, nullable=True)     # inherited from WishItem
    barcode = Column(String(50), nullable=True)  # auto-generated unique code
    supplier = Column(String(255), nullable=True)

    price_cny = Column(Numeric(10, 2), nullable=True)
    price_kzt = Column(Numeric(10, 2), nullable=True)
    cny_rate = Column(Float, nullable=True)

    quantity_ordered = Column(Integer, nullable=False, default=1)
    quantity_received = Column(Integer, nullable=False, default=0)

    notes = Column(Text, nullable=True)

    # in_transit, partial, completed, cancelled
    status = Column(String(20), default='in_transit', nullable=False, index=True)

    ordered_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    # Relationships
    wish_item = relationship("WishItem", back_populates="purchase_orders")

    __table_args__ = (
        Index('idx_purchase_orders_status', 'status'),
        Index('idx_purchase_orders_ordered_at', 'ordered_at'),
        Index('idx_purchase_orders_wish_item', 'wish_item_id'),
    )


# ============================================================================
# TABLE 9: DASHBOARD STATS (Вычисляемые статистики)
# ============================================================================
class DashboardStats(Base):
    __tablename__ = "dashboard_stats"

    id = Column(Integer, primary_key=True, index=True)
    stat_date = Column(Date, nullable=False, index=True, unique=True)

    # Товары
    total_products = Column(Integer, default=0)
    low_stock_count = Column(Integer, default=0)
    stale_stock_count = Column(Integer, default=0)

    # Продажи
    total_sales_today = Column(Numeric(12, 2), default=0)
    total_sales_mtd = Column(Numeric(12, 2), default=0)  # Month-to-date
    sales_count_today = Column(Integer, default=0)

    # Резервы
    pending_reserves = Column(Integer, default=0)
    in_stock_reserves = Column(Integer, default=0)

    # Финансы
    warehouse_value = Column(Numeric(14, 2), default=0)  # Стоимость товаров

    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        Index('idx_dashboard_stats_stat_date', 'stat_date'),
    )


# ============================================================================
# TABLE 8: NOTIFICATIONS (Уведомления)
# ============================================================================
class Notification(Base):
    __tablename__ = "notifications"

    id = Column(Integer, primary_key=True, index=True)

    notification_type = Column(String(50), nullable=False, index=True)  # low_stock, stale, etc
    title = Column(String(255), nullable=False)
    message = Column(Text, nullable=False)

    severity = Column(String(20), nullable=False)  # info, warning, critical

    reference_type = Column(String(50), nullable=True)  # product, reserve, etc
    reference_id = Column(Integer, nullable=True)

    is_read = Column(Boolean, default=False, nullable=False, index=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    read_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (
        Index('idx_notifications_type', 'notification_type'),
        Index('idx_notifications_is_read', 'is_read'),
        Index('idx_notifications_created_at', 'created_at'),
        Index('idx_notifications_reference', 'reference_type', 'reference_id'),
    )

import logging
import os
from sqlalchemy import create_engine, event, pool, text
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from contextlib import asynccontextmanager
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()


# Database configuration
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    DATABASE_URL = "postgresql://user:password@localhost:5432/skladpro"

# Connection pool settings
POOL_SIZE = int(os.getenv("DB_POOL_SIZE", 20))
MAX_OVERFLOW = int(os.getenv("DB_MAX_OVERFLOW", 40))
POOL_TIMEOUT = int(os.getenv("DB_POOL_TIMEOUT", 30))
POOL_RECYCLE = int(os.getenv("DB_POOL_RECYCLE", 3600))

# Create engine with connection pooling
engine = create_engine(
    DATABASE_URL,
    poolclass=pool.QueuePool,
    pool_size=POOL_SIZE,
    max_overflow=MAX_OVERFLOW,
    pool_timeout=POOL_TIMEOUT,
    pool_recycle=POOL_RECYCLE,
    pool_pre_ping=True,  # Test connection before use
    echo=os.getenv("SQL_ECHO", "false").lower() == "true",
)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine,
    expire_on_commit=False
)

Base = declarative_base()

# Connection event listeners
@event.listens_for(engine, "connect")
def receive_connect(dbapi_conn, connection_record):
    """Только для PostgreSQL: иначе SQLite и др. падают на «SET jit»."""
    if engine.dialect.name != "postgresql":
        return
    cursor = dbapi_conn.cursor()
    cursor.execute("SET jit = off")  # Disable JIT for faster queries
    cursor.close()


def get_db() -> Session:
    """Get database session dependency."""
    db = SessionLocal()
    try:
        yield db
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


async def init_db():
    """Initialize database: create all tables."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)


async def close_db():
    """Close database connection pool."""
    await engine.dispose()


def create_tables():
    """Create all tables (synchronous)."""
    Base.metadata.create_all(bind=engine)


def _exec_schema_sql(sql: str, label: str = "") -> None:
    """Выполняет один DDL в отдельной транзакции — сбой одного шага не откатывает остальные."""
    try:
        with engine.begin() as conn:
            conn.execute(text(sql))
    except Exception as e:
        logger.warning("ensure_schema_updates%s: %s", f" [{label}]" if label else "", e)


def ensure_schema_updates():
    """Idempotent ALTERs for databases created before new columns (PostgreSQL)."""
    if not DATABASE_URL or "postgresql" not in DATABASE_URL.lower():
        return

    # Старая схема БД: sales(id, product_id, quantity, total_price, ...) — не совместима с моделью Sale (receipt_number, sale_items).
    # Переименовываем, чтобы create_tables() создал новые sales + sale_items.
    _exec_schema_sql(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'sales'
          ) AND EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'product_id'
          ) AND NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'sales' AND column_name = 'receipt_number'
          ) THEN
            EXECUTE 'ALTER TABLE sales RENAME TO sales_legacy_old_schema';
          END IF;
        END $$;
        """,
        "sales.rename_legacy",
    )

    # Старая схема products(id, name, sku, category, quantity, price, description, created_at, updated_at)
    # Нужно привести к модели Product (колонки по одной, отдельные транзакции).
    product_alters = [
        ("products.barcode", "ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(50)"),
        ("products.brand", "ALTER TABLE products ADD COLUMN IF NOT EXISTS brand VARCHAR(100)"),
        ("products.model", "ALTER TABLE products ADD COLUMN IF NOT EXISTS model VARCHAR(120)"),
        ("products.category_id", "ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INTEGER"),
        ("products.brand_id", "ALTER TABLE products ADD COLUMN IF NOT EXISTS brand_id INTEGER"),
        ("products.image_url", "ALTER TABLE products ADD COLUMN IF NOT EXISTS image_url TEXT"),
        ("products.purchase_price", "ALTER TABLE products ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(10, 2) DEFAULT 0 NOT NULL"),
        ("products.sale_price", "ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_price NUMERIC(10, 2) DEFAULT 0 NOT NULL"),
        ("products.cny_price", "ALTER TABLE products ADD COLUMN IF NOT EXISTS cny_price NUMERIC(10, 2)"),
        ("products.delivery_cost_kzt", "ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_cost_kzt NUMERIC(10, 2)"),
        ("products.delivery_weight_kg", "ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_weight_kg NUMERIC(12, 4)"),
        ("products.min_quantity", "ALTER TABLE products ADD COLUMN IF NOT EXISTS min_quantity INTEGER DEFAULT 0"),
        ("products.max_quantity", "ALTER TABLE products ADD COLUMN IF NOT EXISTS max_quantity INTEGER"),
        ("products.location_row", "ALTER TABLE products ADD COLUMN IF NOT EXISTS location_row VARCHAR(10)"),
        ("products.location_shelf", "ALTER TABLE products ADD COLUMN IF NOT EXISTS location_shelf VARCHAR(10)"),
        ("products.location_position", "ALTER TABLE products ADD COLUMN IF NOT EXISTS location_position VARCHAR(10)"),
        ("products.location_zone", "ALTER TABLE products ADD COLUMN IF NOT EXISTS location_zone VARCHAR(50)"),
        ("products.supplier", "ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier VARCHAR(255)"),
        ("products.last_sale_date", "ALTER TABLE products ADD COLUMN IF NOT EXISTS last_sale_date TIMESTAMPTZ"),
        ("products.received_at", "ALTER TABLE products ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ"),
        ("products.is_active", "ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE NOT NULL"),
        ("products.engine_code_id", "ALTER TABLE products ADD COLUMN IF NOT EXISTS engine_code_id INTEGER"),
    ]
    for label, sql in product_alters:
        _exec_schema_sql(sql, label)

    _exec_schema_sql("CREATE INDEX IF NOT EXISTS idx_products_category_id ON products(category_id)", "products.idx_category_id")
    _exec_schema_sql("CREATE INDEX IF NOT EXISTS idx_products_brand_id ON products(brand_id)", "products.idx_brand_id")
    _exec_schema_sql("CREATE INDEX IF NOT EXISTS idx_products_engine_code_id ON products(engine_code_id)", "products.idx_engine_code_id")

    _exec_schema_sql(
        """
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'fk_products_category_id'
          ) THEN
            ALTER TABLE products
            ADD CONSTRAINT fk_products_category_id
            FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL;
          END IF;
        EXCEPTION WHEN undefined_table THEN
          NULL;
        END $$;
        """,
        "products.fk_category_id",
    )
    _exec_schema_sql(
        """
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'fk_products_brand_id'
          ) THEN
            ALTER TABLE products
            ADD CONSTRAINT fk_products_brand_id
            FOREIGN KEY (brand_id) REFERENCES brands(id) ON DELETE SET NULL;
          END IF;
        EXCEPTION WHEN undefined_table THEN
          NULL;
        END $$;
        """,
        "products.fk_brand_id",
    )
    _exec_schema_sql(
        """
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'fk_products_engine_code_id'
          ) THEN
            ALTER TABLE products
            ADD CONSTRAINT fk_products_engine_code_id
            FOREIGN KEY (engine_code_id) REFERENCES engine_codes(id) ON DELETE SET NULL;
          END IF;
        EXCEPTION WHEN undefined_table THEN
          NULL;
        END $$;
        """,
        "products.fk_engine_code_id",
    )

    # Старая схема: одна колонка price → purchase_price и sale_price
    _exec_schema_sql(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'price'
          ) THEN
            UPDATE products SET purchase_price = price::numeric, sale_price = price::numeric;
          END IF;
        END $$;
        """,
        "products.migrate_price",
    )

    # image_url: старые пути /uploads/products/... -> новый публичный путь /api/v1/media/product-images/...
    _exec_schema_sql(
        """
        UPDATE products
        SET image_url = regexp_replace(
          image_url,
          '^/uploads/products/',
          '/api/v1/media/product-images/'
        )
        WHERE image_url LIKE '/uploads/products/%';
        """,
        "products.migrate_image_url_to_api_media",
    )

    # GENERATED profit_percent (как в модели SQLAlchemy)
    _exec_schema_sql(
        """
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'profit_percent'
          ) THEN
            ALTER TABLE products ADD COLUMN profit_percent NUMERIC(5, 2) GENERATED ALWAYS AS (
              CASE WHEN purchase_price IS NULL OR purchase_price = 0 THEN NULL
              ELSE ROUND((((sale_price - purchase_price) / purchase_price) * 100)::numeric, 2) END
            ) STORED;
          END IF;
        END $$;
        """,
        "products.profit_percent",
    )

    # history — только если таблица есть (в старой схеме мог быть product_history вместо history)
    _exec_schema_sql(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'history'
          ) THEN
            ALTER TABLE history DROP CONSTRAINT IF EXISTS history_operation_type_check;
          END IF;
        END $$;
        """,
        "history.drop_check",
    )
    _exec_schema_sql(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'history'
          ) THEN
            BEGIN
              ALTER TABLE history ADD CONSTRAINT history_operation_type_check CHECK (
                operation_type IN (
                  'sale', 'purchase', 'adjustment', 'reserve_to_stock', 'revision',
                  'added', 'sold', 'edited', 'discount', 'deleted', 'ordered',
                  'to_stock', 'cancelled', 'restored'
                )
              );
            EXCEPTION
              WHEN duplicate_object THEN NULL;
            END;
          END IF;
        END $$;
        """,
        "history.add_check",
    )

    reserve_alters = [
        ("reserves.source", "ALTER TABLE reserves ADD COLUMN IF NOT EXISTS source VARCHAR(30) DEFAULT 'manual' NOT NULL"),
        ("reserves.total_amount", "ALTER TABLE reserves ADD COLUMN IF NOT EXISTS total_amount NUMERIC(12, 2)"),
        ("reserves.updated_at", "ALTER TABLE reserves ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now() NOT NULL"),
    ]
    for label, sql in reserve_alters:
        _exec_schema_sql(sql, label)
    _exec_schema_sql("CREATE INDEX IF NOT EXISTS idx_reserves_source ON reserves(source)", "reserves.idx_source")

    # Длинные статусы резерва («Новый заказ с сайта») и отмена с причиной
    _exec_schema_sql(
        "ALTER TABLE reserves ALTER COLUMN status TYPE VARCHAR(80)",
        "reserves.status_widen",
    )
    _exec_schema_sql(
        "ALTER TABLE reserves ADD COLUMN IF NOT EXISTS cancellation_reason_code VARCHAR(40)",
        "reserves.cancellation_reason_code",
    )
    _exec_schema_sql(
        "ALTER TABLE reserves ADD COLUMN IF NOT EXISTS cancellation_comment TEXT",
        "reserves.cancellation_comment",
    )
    _exec_schema_sql(
        "ALTER TABLE reserves ADD COLUMN IF NOT EXISTS cancelled_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL",
        "reserves.cancelled_by_user_id",
    )
    _exec_schema_sql(
        "ALTER TABLE reserves ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ",
        "reserves.cancelled_at",
    )
    _exec_schema_sql(
        "CREATE INDEX IF NOT EXISTS idx_reserves_cancellation_reason ON reserves(cancellation_reason_code)",
        "reserves.idx_cancellation_reason",
    )
    _exec_schema_sql(
        "CREATE INDEX IF NOT EXISTS idx_reserves_cancelled_by ON reserves(cancelled_by_user_id)",
        "reserves.idx_cancelled_by",
    )

    reserve_item_alters = [
        ("reserve_items.quantity", "ALTER TABLE reserve_items ADD COLUMN IF NOT EXISTS quantity INTEGER"),
        ("reserve_items.sale_price_snapshot", "ALTER TABLE reserve_items ADD COLUMN IF NOT EXISTS sale_price_snapshot NUMERIC(10, 2)"),
        ("reserve_items.line_total", "ALTER TABLE reserve_items ADD COLUMN IF NOT EXISTS line_total NUMERIC(12, 2)"),
    ]
    for label, sql in reserve_item_alters:
        _exec_schema_sql(sql, label)
    _exec_schema_sql(
        "UPDATE reserve_items SET quantity = quantity_ordered WHERE quantity IS NULL",
        "reserve_items.fill_quantity",
    )

    _exec_schema_sql(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'manager' NOT NULL",
        "users.role",
    )
    _exec_schema_sql(
        "CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)",
        "users.idx_role",
    )

    _exec_schema_sql(
        """
        DO $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM information_schema.tables
            WHERE table_schema = 'public' AND table_name = 'settings'
          ) THEN
            ALTER TABLE settings ADD COLUMN IF NOT EXISTS delivery_kzt_per_kg NUMERIC(10, 2) DEFAULT 800 NOT NULL;
          END IF;
        END $$;
        """,
        "settings.delivery_kzt_per_kg",
    )

    ensure_compatibility_tables()
    ensure_compatibility_table_columns()


def ensure_compatibility_tables() -> None:
    """Создать таблицы справочника авто/кодов, если БД ещё без них (старые деплои)."""
    if not DATABASE_URL or "postgresql" not in DATABASE_URL.lower():
        return
    try:
        from models import (
            Compatibility,
            EngineCode,
            EngineFamily,
            EngineFamilyModel,
            ProductEngineFamilyLink,
            ProductVehicleModelLink,
            VehicleBrand,
            VehicleModel,
        )

        VehicleBrand.__table__.create(engine, checkfirst=True)
        EngineCode.__table__.create(engine, checkfirst=True)
        Compatibility.__table__.create(engine, checkfirst=True)
        EngineFamily.__table__.create(engine, checkfirst=True)
        VehicleModel.__table__.create(engine, checkfirst=True)
        EngineFamilyModel.__table__.create(engine, checkfirst=True)
        ProductEngineFamilyLink.__table__.create(engine, checkfirst=True)
        ProductVehicleModelLink.__table__.create(engine, checkfirst=True)
    except Exception as e:
        logger.warning("ensure_compatibility_tables: %s", e)


def ensure_compatibility_table_columns() -> None:
    """Починить старые таблицы без created_at/updated_at (иначе 500 на POST и ответе API)."""
    if not DATABASE_URL or "postgresql" not in DATABASE_URL.lower():
        return
    _exec_schema_sql(
        """
        DO $$
        BEGIN
          IF to_regclass('public.vehicle_brands') IS NOT NULL THEN
            ALTER TABLE vehicle_brands
              ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
            ALTER TABLE vehicle_brands
              ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
            ALTER TABLE vehicle_brands ADD COLUMN IF NOT EXISTS slug VARCHAR(160);
            ALTER TABLE vehicle_brands ADD COLUMN IF NOT EXISTS is_active BOOLEAN;
            UPDATE vehicle_brands SET is_active = COALESCE(is_active, true) WHERE is_active IS NULL;
            UPDATE vehicle_brands
              SET created_at = COALESCE(created_at, now() AT TIME ZONE 'utc'),
                  updated_at = COALESCE(updated_at, created_at, now() AT TIME ZONE 'utc');
            UPDATE vehicle_brands
              SET slug = 'vb-' || id::text
              WHERE slug IS NULL OR btrim(COALESCE(slug::text, '')) = '';
            BEGIN
              ALTER TABLE vehicle_brands ALTER COLUMN is_active SET DEFAULT true;
            EXCEPTION WHEN OTHERS THEN
              PERFORM 1;
            END;
            BEGIN
              ALTER TABLE vehicle_brands ALTER COLUMN is_active SET NOT NULL;
            EXCEPTION WHEN OTHERS THEN
              PERFORM 1;
            END;
            -- INSERT без явных дат: иначе NOT NULL + отсутствие DEFAULT в БД → 500 на POST
            BEGIN
              ALTER TABLE vehicle_brands
                ALTER COLUMN created_at SET DEFAULT (timezone('utc', now()));
            EXCEPTION WHEN OTHERS THEN
              PERFORM 1;
            END;
            BEGIN
              ALTER TABLE vehicle_brands
                ALTER COLUMN updated_at SET DEFAULT (timezone('utc', now()));
            EXCEPTION WHEN OTHERS THEN
              PERFORM 1;
            END;
          END IF;
        END $$;
        """,
        "vehicle_brands.ts_fix",
    )
    _exec_schema_sql(
        """
        DO $$
        BEGIN
          IF to_regclass('public.vehicle_models') IS NOT NULL THEN
            ALTER TABLE vehicle_models
              ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;
            ALTER TABLE vehicle_models
              ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
            ALTER TABLE vehicle_models ADD COLUMN IF NOT EXISTS slug VARCHAR(200);
            ALTER TABLE vehicle_models ADD COLUMN IF NOT EXISTS is_active BOOLEAN;
            UPDATE vehicle_models SET is_active = COALESCE(is_active, true) WHERE is_active IS NULL;
            UPDATE vehicle_models
              SET created_at = COALESCE(created_at, now() AT TIME ZONE 'utc'),
                  updated_at = COALESCE(updated_at, created_at, now() AT TIME ZONE 'utc');
            UPDATE vehicle_models
              SET slug = 'vm-' || id::text
              WHERE slug IS NULL OR btrim(COALESCE(slug::text, '')) = '';
            BEGIN
              ALTER TABLE vehicle_models ALTER COLUMN is_active SET DEFAULT true;
            EXCEPTION WHEN OTHERS THEN
              PERFORM 1;
            END;
            BEGIN
              ALTER TABLE vehicle_models ALTER COLUMN is_active SET NOT NULL;
            EXCEPTION WHEN OTHERS THEN
              PERFORM 1;
            END;
            BEGIN
              ALTER TABLE vehicle_models
                ALTER COLUMN created_at SET DEFAULT (timezone('utc', now()));
            EXCEPTION WHEN OTHERS THEN
              PERFORM 1;
            END;
            BEGIN
              ALTER TABLE vehicle_models
                ALTER COLUMN updated_at SET DEFAULT (timezone('utc', now()));
            EXCEPTION WHEN OTHERS THEN
              PERFORM 1;
            END;
          END IF;
        END $$;
        """,
        "vehicle_models.ts_fix",
    )


def drop_tables():
    """Drop all tables (synchronous, for testing)."""
    Base.metadata.drop_all(bind=engine)


@asynccontextmanager
async def get_async_db():
    """Get async database session."""
    async_session = sessionmaker(
        engine,
        class_=Session,
        expire_on_commit=False
    )
    async with async_session() as session:
        try:
            yield session
        finally:
            await session.close()

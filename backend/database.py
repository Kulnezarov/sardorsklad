import logging
import os
from sqlalchemy import create_engine, event, pool, text
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from contextlib import asynccontextmanager
from dotenv import load_dotenv

logger = logging.getLogger(__name__)

load_dotenv()


def _ensure_supabase_ssl(url: str) -> str:
    """Supabase Postgres requires SSL; append sslmode if missing."""
    if not url or "sslmode=" in url:
        return url
    # Direct host db.*.supabase.co and pooler aws-*.pooler.supabase.com
    if "supabase.co" not in url and "pooler.supabase.com" not in url:
        return url
    sep = "&" if "?" in url else "?"
    return f"{url}{sep}sslmode=require"


# Database configuration
DATABASE_URL = os.getenv("DATABASE_URL")
if not DATABASE_URL:
    # Fallback for local development
    DATABASE_URL = "postgresql://user:password@localhost:5432/skladpro"
else:
    DATABASE_URL = _ensure_supabase_ssl(DATABASE_URL)

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
    """Set PostgreSQL specific settings on connect."""
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

    # Старая supabase_schema.sql: products(id, name, sku, category, quantity, price, description, created_at, updated_at)
    # Нужно привести к модели Product (колонки по одной, отдельные транзакции).
    product_alters = [
        ("products.barcode", "ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(50)"),
        ("products.brand", "ALTER TABLE products ADD COLUMN IF NOT EXISTS brand VARCHAR(100)"),
        ("products.purchase_price", "ALTER TABLE products ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(10, 2) DEFAULT 0 NOT NULL"),
        ("products.sale_price", "ALTER TABLE products ADD COLUMN IF NOT EXISTS sale_price NUMERIC(10, 2) DEFAULT 0 NOT NULL"),
        ("products.cny_price", "ALTER TABLE products ADD COLUMN IF NOT EXISTS cny_price NUMERIC(10, 2)"),
        ("products.delivery_cost_kzt", "ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_cost_kzt NUMERIC(10, 2)"),
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
    ]
    for label, sql in product_alters:
        _exec_schema_sql(sql, label)

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

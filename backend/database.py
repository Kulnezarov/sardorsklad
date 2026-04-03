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


def ensure_schema_updates():
    """Idempotent ALTERs for databases created before new columns (PostgreSQL)."""
    if not DATABASE_URL or "postgresql" not in DATABASE_URL.lower():
        return
    try:
        with engine.begin() as conn:
            conn.execute(
                text(
                    "ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(50)"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE products ADD COLUMN IF NOT EXISTS delivery_cost_kzt NUMERIC(10, 2)"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier VARCHAR(255)"
                )
            )
            conn.execute(
                text(
                    "ALTER TABLE products ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ"
                )
            )
            # Legacy DBs may have CHECK (operation_type) without app enum values → DELETE/ADD history fails with 500.
            conn.execute(text("ALTER TABLE history DROP CONSTRAINT IF EXISTS history_operation_type_check"))
            conn.execute(
                text(
                    """
                    ALTER TABLE history ADD CONSTRAINT history_operation_type_check CHECK (
                        operation_type IN (
                            'sale', 'purchase', 'adjustment', 'reserve_to_stock', 'revision',
                            'added', 'sold', 'edited', 'discount', 'deleted', 'ordered',
                            'to_stock', 'cancelled', 'restored'
                        )
                    )
                    """
                )
            )
    except Exception as e:
        logger.warning("ensure_schema_updates: %s", e)


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

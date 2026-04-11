import os
import json
from decimal import Decimal
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from datetime import date, datetime
from enum import Enum
from sqlalchemy.exc import OperationalError

import database
import models
import bootstrap_admin
from fastapi.middleware.cors import CORSMiddleware
from routers import auth, products, sales, reserve, history, revision, settings
from routers import wish_orders
from config.logger import setup_logger

# ============================================================================
# LOGGING CONFIGURATION
# ============================================================================
logger = setup_logger("skladpro")


# ============================================================================
# LIFESPAN - Startup/Shutdown
# ============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manage application lifecycle.

    Startup:
    - Create database tables
    - Initialize default settings
    - Telegram: ежедневный отчёт (если заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID)

    Shutdown:
    - Close database connections
    - Clean up resources
    """
    # STARTUP
    logger.info("Starting SkladPro API...")
    telegram_sched = None

    try:
        # Сначала миграции (в т.ч. переименование legacy sales), затем create_all для новых таблиц
        database.ensure_schema_updates()
        database.create_tables()
        logger.info("✓ Database tables created")

        # Initialize default settings if not exist
        db = next(database.get_db())
        settings_check = db.query(models.Settings).first()
        if not settings_check:
            default_settings = models.Settings()
            db.add(default_settings)
            db.commit()
            logger.info("✓ Default settings initialized")
        db.close()

        bootstrap_admin.ensure_default_admin()

        try:
            from services.telegram_daily import setup_telegram_scheduler

            telegram_sched = setup_telegram_scheduler()
        except Exception as te:
            logger.warning("Telegram scheduler не запущен: %s", te)

        logger.info("✓ SkladPro API startup complete")

    except OperationalError as e:
        err = str(e).lower()
        if "could not translate host name" in err or "nodename nor servname" in err:
            logger.error(
                "✗ База данных: не удаётся разрешить имя хоста (DNS). "
                "Проверьте DATABASE_URL (хост PostgreSQL доступен из контейнера/сервера), "
                "VPN и сеть. Пример: DATABASE_URL=postgresql://USER:PASS@postgresql:5432/skladpro "
                "в Docker или postgresql://USER:PASS@localhost:5432/skladpro локально."
            )
        logger.error(f"✗ Startup failed (БД): {e}")
        raise
    except Exception as e:
        logger.error(f"✗ Startup failed: {str(e)}")
        raise

    yield

    # SHUTDOWN
    logger.info("Shutting down SkladPro API...")

    try:
        from services.telegram_daily import shutdown_telegram_scheduler

        shutdown_telegram_scheduler(telegram_sched)
    except Exception as e:
        logger.warning("Telegram scheduler shutdown: %s", e)

    try:
        database.engine.dispose()
        logger.info("✓ Database connections closed")
        logger.info("✓ SkladPro API shutdown complete")

    except Exception as e:
        logger.error(f"✗ Shutdown error: {str(e)}")


# ============================================================================
# APP INITIALIZATION
# ============================================================================
def sanitize_json_for_response(obj):
    """
    Рекурсивно приводит тело ответа к JSON-совместимым типам.
    Decimal из PostgreSQL/SQLAlchemy и Pydantic иначе дают «not JSON serializable»
    даже при default= в json.dumps (вложенные структуры / особые объекты).
    """
    if obj is None:
        return None
    if isinstance(obj, (str, int, float, bool)):
        return obj
    if isinstance(obj, Decimal):
        return float(obj)
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, Enum):
        v = obj.value
        return sanitize_json_for_response(v)
    if isinstance(obj, dict):
        return {str(k): sanitize_json_for_response(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple, set, frozenset)):
        return [sanitize_json_for_response(v) for v in obj]
    if isinstance(obj, bytes):
        return obj.decode("utf-8", errors="replace")
    if hasattr(obj, "model_dump") and callable(obj.model_dump):
        return sanitize_json_for_response(obj.model_dump(mode="python"))
    # pydantic v1
    if hasattr(obj, "dict") and callable(obj.dict):
        try:
            return sanitize_json_for_response(obj.dict())
        except Exception:
            pass
    return str(obj)


class DecimalJSONResponse(JSONResponse):
    """Все JSON-ответы приложения: Decimal, даты, enum — безопасно для json.dumps."""
    def render(self, content) -> bytes:
        safe = sanitize_json_for_response(content)
        return json.dumps(
            safe,
            ensure_ascii=False,
            allow_nan=False,
            separators=(",", ":"),
        ).encode("utf-8")


app = FastAPI(
    title="SkladPro API",
    description="Smart inventory management system for warehouse management",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan,
    default_response_class=DecimalJSONResponse,
)

# ============================================================================
# CORS MIDDLEWARE
# ============================================================================
ORIGINS = [
    o.strip()
    for o in os.getenv(
        "ORIGINS",
        "http://localhost:5173,http://localhost:3000,http://127.0.0.1:5173,"
        "http://194.32.142.253,http://194.32.142.253:5173",
    ).split(",")
    if o.strip()
]

logger.info(f"ORIGINS (для логов/будущего CORS_STRICT): {', '.join(ORIGINS)}")


# ============================================================================
# EXCEPTION HANDLERS
# ============================================================================
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    """Handle validation errors."""
    return DecimalJSONResponse(
        status_code=422,
        content={
            "detail": "Validation error",
            "errors": exc.errors(),
            "timestamp": datetime.utcnow().isoformat(),
        },
    )


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Handle unexpected errors."""
    logger.error(f"Unhandled exception: {str(exc)}", exc_info=True)

    return DecimalJSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "detail": str(exc) if not isinstance(exc, str) else exc,
            "timestamp": datetime.utcnow().isoformat(),
            "path": str(request.url),
        },
    )


# ============================================================================
# MIDDLEWARE - REQUEST LOGGING
# ============================================================================
@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log incoming requests."""
    start_time = datetime.utcnow()

    response = await call_next(request)

    duration = (datetime.utcnow() - start_time).total_seconds()

    logger.info(
        f"{request.method} {request.url.path} - "
        f"Status: {response.status_code} - "
        f"Duration: {duration:.3f}s"
    )

    return response


# ============================================================================
# ROUTERS
# ============================================================================
# Include all routers with versioned API prefixes
app.include_router(auth.router)
app.include_router(products.router)
app.include_router(sales.router)
app.include_router(reserve.router)
app.include_router(history.router)
app.include_router(revision.router)
app.include_router(settings.router)
app.include_router(wish_orders.router)


# ============================================================================
# ROOT ENDPOINTS
# ============================================================================
@app.get("/")
def read_root():
    """Root endpoint with API info."""
    return {
        "name": "SkladPro",
        "description": "Smart inventory management system",
        "version": "1.0.0",
        "status": "operational",
        "endpoints": {
            "docs": "/api/docs",
            "redoc": "/api/redoc",
            "openapi": "/api/openapi.json",
        },
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.get("/health")
def health_check():
    """Health check endpoint."""
    try:
        # Try database connection
        db = next(database.get_db())
        db.query(models.Product).first()
        db.close()
        db_status = "healthy"
    except Exception as e:
        logger.error(f"Database health check failed: {str(e)}")
        db_status = "unhealthy"

    return {
        "status": "healthy" if db_status == "healthy" else "degraded",
        "database": db_status,
        "timestamp": datetime.utcnow().isoformat(),
    }


@app.get("/api/v1/info")
def api_info():
    """Get API information."""
    return {
        "app_name": "SkladPro API",
        "version": "1.0.0",
        "environment": os.getenv("ENVIRONMENT", "development"),
        "database_url": os.getenv("DATABASE_URL", "").split("@")[1] if "@" in os.getenv("DATABASE_URL", "") else "configured",
        "cache_enabled": os.getenv("CACHE_ENABLED", "true").lower() == "true",
        "notifications_enabled": os.getenv("NOTIFICATIONS_ENABLED", "true").lower() == "true",
    }


# ============================================================================
# CORS: стандартный CORSMiddleware (BaseHTTPMiddleware/ForceCors давали пустые заголовки
# на части ответов). JWT в Authorization — allow_credentials=False.
# ============================================================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)


# ============================================================================
# RUN
# ============================================================================
if __name__ == "__main__":
    import uvicorn

    host = os.getenv("API_HOST", "0.0.0.0")
    port = int(os.getenv("PORT", os.getenv("API_PORT", 8000)))
    reload = os.getenv("ENVIRONMENT", "development") == "development"

    uvicorn.run(
        "main:app",
        host=host,
        port=port,
        reload=reload,
        log_level="info",
    )

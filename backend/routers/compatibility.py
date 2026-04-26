"""CRUD для марок/моделей авто и кодов совместимости (двигательные семьи)."""

import re
from datetime import UTC, datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import asc, func, or_
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.exc import IntegrityError, OperationalError, ProgrammingError

import models
import schemas
from database import get_db
from dependencies import require_manager_or_admin
from config.logger import setup_logger
from services.product_compatibility import slugify_label, vehicle_brand_to_response

logger = setup_logger("compatibility")


def _vb_to_response(row: models.VehicleBrand) -> schemas.VehicleBrandResponse:
    return vehicle_brand_to_response(row)


router = APIRouter(
    prefix="/api/v1/compatibility",
    tags=["compatibility"],
    dependencies=[Depends(require_manager_or_admin)],
)


def _unique_vehicle_brand_slug(db: Session, base: str, exclude_id: Optional[int] = None) -> str:
    s = base or "brand"
    n = 0
    while True:
        cand = s if n == 0 else f"{s}-{n}"
        q = db.query(models.VehicleBrand).filter(models.VehicleBrand.slug == cand)
        if exclude_id is not None:
            q = q.filter(models.VehicleBrand.id != exclude_id)
        if not q.first():
            return cand
        n += 1
        if n > 2000:
            raise HTTPException(500, detail="Не удалось сформировать slug")


def _unique_vehicle_model_slug(db: Session, base: str, exclude_id: Optional[int] = None) -> str:
    s = base or "model"
    n = 0
    while True:
        cand = s if n == 0 else f"{s}-{n}"
        q = db.query(models.VehicleModel).filter(models.VehicleModel.slug == cand)
        if exclude_id is not None:
            q = q.filter(models.VehicleModel.id != exclude_id)
        if not q.first():
            return cand
        n += 1
        if n > 2000:
            raise HTTPException(500, detail="Не удалось сформировать slug")


def _ef_set_models(db: Session, family: models.EngineFamily, model_ids: Optional[List[int]]) -> None:
    db.query(models.EngineFamilyModel).filter(
        models.EngineFamilyModel.engine_family_id == family.id
    ).delete(synchronize_session=False)
    for mid in set(model_ids or []):
        if not mid:
            continue
        vm = db.query(models.VehicleModel).filter(models.VehicleModel.id == int(mid)).first()
        if not vm:
            continue
        db.add(
            models.EngineFamilyModel(
                engine_family_id=family.id, vehicle_model_id=vm.id
            )
        )


# ── Vehicle brands ──────────────────────────────────────────────────────────


@router.get("/vehicle-brands", response_model=List[schemas.VehicleBrandResponse])
def list_vehicle_brands(
    db: Session = Depends(get_db),
    q: Optional[str] = None,
    include_inactive: bool = False,
):
    try:
        qry = db.query(models.VehicleBrand)
        if not include_inactive:
            qry = qry.filter(models.VehicleBrand.is_active.is_(True))
        if q and q.strip():
            term = f"%{q.strip()}%"
            qry = qry.filter(
                or_(models.VehicleBrand.name.ilike(term), models.VehicleBrand.slug.ilike(term))
            )
        rows = qry.order_by(asc(models.VehicleBrand.name)).all()
        return [_vb_to_response(r) for r in rows]
    except (ProgrammingError, OperationalError) as e:
        logger.exception("list_vehicle_brands: %s", e)
        raise HTTPException(
            status_code=503,
            detail="Таблица справочника марок не готова или БД недоступна. Перезапустите API после обновления.",
        ) from e


@router.post(
    "/vehicle-brands",
    response_model=schemas.VehicleBrandResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_vehicle_brand(payload: schemas.VehicleBrandCreate, db: Session = Depends(get_db)):
    try:
        slug = (payload.slug or "").strip() or slugify_label(payload.name)
        slug = _unique_vehicle_brand_slug(db, slug)
        # Явные даты: на старых БД у колонок мог не быть DEFAULT → NOT NULL ломал INSERT
        now = datetime.now(UTC)
        row = models.VehicleBrand(
            name=payload.name.strip(),
            slug=slug,
            is_active=payload.is_active,
            created_at=now,
            updated_at=now,
        )
        db.add(row)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            raise HTTPException(400, detail="Конфликт: марка с таким именем/slug")
        db.refresh(row)
        return _vb_to_response(row)
    except HTTPException:
        raise
    except (ProgrammingError, OperationalError) as e:
        db.rollback()
        logger.exception("create_vehicle_brand: db %s", e)
        raise HTTPException(
            status_code=503,
            detail="Таблица справочника не готова или БД недоступна. Перезапустите API после обновления.",
        ) from e
    except Exception as e:
        db.rollback()
        logger.exception("create_vehicle_brand: %s", e)
        raise HTTPException(
            status_code=500, detail="Не удалось создать марку. Проверьте логи сервера."
        ) from e


@router.put("/vehicle-brands/{brand_id}", response_model=schemas.VehicleBrandResponse)
def update_vehicle_brand(
    brand_id: int, payload: schemas.VehicleBrandUpdate, db: Session = Depends(get_db)
):
    row = db.query(models.VehicleBrand).filter(models.VehicleBrand.id == brand_id).first()
    if not row:
        raise HTTPException(404, detail="Марка не найдена")
    if payload.name is not None:
        row.name = payload.name.strip()
    if payload.slug is not None:
        row.slug = _unique_vehicle_brand_slug(db, payload.slug.strip(), exclude_id=row.id)
    if payload.is_active is not None:
        row.is_active = payload.is_active
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, detail="Конфликт данных")
    db.refresh(row)
    return _vb_to_response(row)


@router.delete("/vehicle-brands/{brand_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vehicle_brand(brand_id: int, db: Session = Depends(get_db)):
    row = db.query(models.VehicleBrand).filter(models.VehicleBrand.id == brand_id).first()
    if not row:
        raise HTTPException(404, detail="Марка не найдена")
    model_ids = [m[0] for m in db.query(models.VehicleModel.id).filter(models.VehicleModel.vehicle_brand_id == brand_id).all()]
    if model_ids and (
        db.query(models.ProductVehicleModelLink)
        .filter(models.ProductVehicleModelLink.vehicle_model_id.in_(model_ids))
        .first()
    ):
        raise HTTPException(400, detail="Марка используется в товарах — снимите привязки")
    db.delete(row)
    db.commit()
    return None


# ── Vehicle models ─────────────────────────────────────────────────────────


@router.get("/vehicle-models", response_model=List[schemas.VehicleModelResponse])
def list_vehicle_models(
    db: Session = Depends(get_db),
    vehicle_brand_id: Optional[int] = None,
    q: Optional[str] = None,
    include_inactive: bool = False,
):
    qry = db.query(models.VehicleModel).options(joinedload(models.VehicleModel.vehicle_brand))
    if vehicle_brand_id is not None:
        qry = qry.filter(models.VehicleModel.vehicle_brand_id == vehicle_brand_id)
    if not include_inactive:
        qry = qry.filter(models.VehicleModel.is_active.is_(True))
    if q and q.strip():
        term = f"%{q.strip()}%"
        qry = qry.filter(
            or_(
                models.VehicleModel.name.ilike(term),
                models.VehicleModel.slug.ilike(term),
            )
        )
    rows = qry.order_by(asc(models.VehicleModel.name)).all()
    out: List[schemas.VehicleModelResponse] = []
    for r in rows:
        d = schemas.VehicleModelResponse.model_validate(r, from_attributes=True)
        d = d.model_copy(
            update={"brand": _vb_to_response(r.vehicle_brand)}
        )
        out.append(d)
    return out


@router.post(
    "/vehicle-models",
    response_model=schemas.VehicleModelResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_vehicle_model(payload: schemas.VehicleModelCreate, db: Session = Depends(get_db)):
    b = (
        db.query(models.VehicleBrand)
        .filter(models.VehicleBrand.id == payload.vehicle_brand_id)
        .first()
    )
    if not b:
        raise HTTPException(400, detail="Марка не найдена")
    name = payload.name.strip()
    slug = (payload.slug or "").strip() or slugify_label(f"{b.slug}-{name}")
    slug = _unique_vehicle_model_slug(db, slug)
    now = datetime.now(UTC)
    row = models.VehicleModel(
        vehicle_brand_id=payload.vehicle_brand_id,
        name=name,
        slug=slug,
        is_active=payload.is_active,
        created_at=now,
        updated_at=now,
    )
    db.add(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, detail="Модель с таким именем у марки уже есть")
    db.refresh(row)
    row = (
        db.query(models.VehicleModel)
        .options(joinedload(models.VehicleModel.vehicle_brand))
        .filter(models.VehicleModel.id == row.id)
        .first()
    )
    d = schemas.VehicleModelResponse.model_validate(row, from_attributes=True)
    return d.model_copy(
        update={"brand": _vb_to_response(row.vehicle_brand)}
    )


@router.put("/vehicle-models/{model_id}", response_model=schemas.VehicleModelResponse)
def update_vehicle_model(
    model_id: int, payload: schemas.VehicleModelUpdate, db: Session = Depends(get_db)
):
    row = (
        db.query(models.VehicleModel)
        .options(joinedload(models.VehicleModel.vehicle_brand))
        .filter(models.VehicleModel.id == model_id)
        .first()
    )
    if not row:
        raise HTTPException(404, detail="Модель не найдена")
    if payload.name is not None:
        row.name = payload.name.strip()
    if payload.slug is not None:
        row.slug = _unique_vehicle_model_slug(db, payload.slug.strip(), exclude_id=row.id)
    if payload.is_active is not None:
        row.is_active = payload.is_active
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, detail="Конфликт данных")
    db.refresh(row)
    row = (
        db.query(models.VehicleModel)
        .options(joinedload(models.VehicleModel.vehicle_brand))
        .filter(models.VehicleModel.id == model_id)
        .first()
    )
    d = schemas.VehicleModelResponse.model_validate(row, from_attributes=True)
    return d.model_copy(
        update={"brand": _vb_to_response(row.vehicle_brand)}
    )


@router.delete("/vehicle-models/{model_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vehicle_model(model_id: int, db: Session = Depends(get_db)):
    row = db.query(models.VehicleModel).filter(models.VehicleModel.id == model_id).first()
    if not row:
        raise HTTPException(404, detail="Модель не найдена")
    if (
        db.query(models.ProductVehicleModelLink)
        .filter(models.ProductVehicleModelLink.vehicle_model_id == model_id)
        .first()
    ):
        raise HTTPException(400, detail="Модель привязана к товарам")
    db.delete(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, detail="Нельзя удалить: есть связи")
    return None


# ── Engine families ────────────────────────────────────────────────────────


@router.get("/engine-families", response_model=List[schemas.EngineFamilyResponse])
def list_engine_families(
    db: Session = Depends(get_db),
    code: Optional[str] = None,
    q: Optional[str] = None,
    include_inactive: bool = False,
):
    qry = db.query(models.EngineFamily)
    if not include_inactive:
        qry = qry.filter(models.EngineFamily.is_active.is_(True))
    if code and code.strip():
        qry = qry.filter(models.EngineFamily.code.ilike(code.strip()))
    if q and q.strip():
        term = f"%{q.strip()}%"
        qry = qry.filter(
            or_(models.EngineFamily.code.ilike(term), models.EngineFamily.name.ilike(term))
        )
    fams: List[models.EngineFamily] = qry.order_by(asc(models.EngineFamily.code)).all()
    return [_engine_family_to_schema(db, f) for f in fams]


@router.get("/engine-families/by-code/{code}", response_model=schemas.EngineFamilyResponse)
def get_engine_family_by_code(code: str, db: Session = Depends(get_db)):
    c = (code or "").strip()
    if not c:
        raise HTTPException(400, detail="code required")
    f = (
        db.query(models.EngineFamily)
        .filter(func.lower(models.EngineFamily.code) == c.lower())
        .first()
    )
    if not f:
        raise HTTPException(404, detail="Код не найден")
    return _engine_family_to_schema(db, f)


@router.get("/engine-families/{family_id}", response_model=schemas.EngineFamilyResponse)
def get_engine_family(family_id: int, db: Session = Depends(get_db)):
    f = (
        db.query(models.EngineFamily)
        .filter(models.EngineFamily.id == family_id)
        .options(
            joinedload(models.EngineFamily.model_links)
            .joinedload(models.EngineFamilyModel.vehicle_model)
            .joinedload(models.VehicleModel.vehicle_brand)
        )
        .first()
    )
    if not f:
        raise HTTPException(404, detail="Код не найден")
    return _engine_family_to_schema(db, f)


def _engine_family_to_schema(db: Session, f: models.EngineFamily) -> schemas.EngineFamilyResponse:
    f = (
        db.query(models.EngineFamily)
        .filter(models.EngineFamily.id == f.id)
        .options(
            joinedload(models.EngineFamily.model_links)
            .joinedload(models.EngineFamilyModel.vehicle_model)
            .joinedload(models.VehicleModel.vehicle_brand)
        )
        .first()
    )
    vms: List[schemas.VehicleModelResponse] = []
    for link in f.model_links or []:
        vm = link.vehicle_model
        if not vm:
            continue
        row = (
            db.query(models.VehicleModel)
            .options(joinedload(models.VehicleModel.vehicle_brand))
            .filter(models.VehicleModel.id == vm.id)
            .first()
        )
        if not row:
            continue
        d = schemas.VehicleModelResponse.model_validate(row, from_attributes=True)
        d = d.model_copy(
            update={"brand": _vb_to_response(row.vehicle_brand)}
        )
        vms.append(d)
    vms.sort(key=lambda x: (x.brand.name.casefold() if x.brand else "", x.name.casefold(), x.id))
    base = schemas.EngineFamilyResponse.model_validate(f, from_attributes=True)
    return base.model_copy(update={"vehicle_models": vms})


@router.post(
    "/engine-families",
    response_model=schemas.EngineFamilyResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_engine_family(payload: schemas.EngineFamilyCreate, db: Session = Depends(get_db)):
    code = re.sub(r"\s+", "", (payload.code or "").strip()) or "code"
    row = models.EngineFamily(
        code=code,
        name=(payload.name or "").strip() or None,
        is_active=payload.is_active,
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, detail="Код уже существует")
    _ef_set_models(db, row, payload.vehicle_model_ids)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, detail="Ошибка сохранения")
    return _engine_family_to_schema(
        db, db.query(models.EngineFamily).filter(models.EngineFamily.id == row.id).first()
    )


@router.put("/engine-families/{family_id}", response_model=schemas.EngineFamilyResponse)
def update_engine_family(
    family_id: int, payload: schemas.EngineFamilyUpdate, db: Session = Depends(get_db)
):
    row = db.query(models.EngineFamily).filter(models.EngineFamily.id == family_id).first()
    if not row:
        raise HTTPException(404, detail="Код не найден")
    if payload.code is not None:
        row.code = re.sub(r"\s+", "", payload.code.strip()) or row.code
    if payload.name is not None:
        row.name = payload.name.strip() or None
    if payload.is_active is not None:
        row.is_active = payload.is_active
    if payload.vehicle_model_ids is not None:
        _ef_set_models(db, row, payload.vehicle_model_ids)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, detail="Конфликт: код уникален")
    return _engine_family_to_schema(
        db, db.query(models.EngineFamily).filter(models.EngineFamily.id == family_id).first()
    )


@router.delete("/engine-families/{family_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_engine_family(family_id: int, db: Session = Depends(get_db)):
    row = db.query(models.EngineFamily).filter(models.EngineFamily.id == family_id).first()
    if not row:
        raise HTTPException(404, detail="Код не найден")
    if (
        db.query(models.ProductEngineFamilyLink)
        .filter(models.ProductEngineFamilyLink.engine_family_id == family_id)
        .first()
    ):
        raise HTTPException(400, detail="Код привязан к товарам")
    db.delete(row)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(400, detail="Нельзя удалить: есть зависимости")
    return None


@router.get("/autocomplete", response_model=List[schemas.EngineFamilyResponse])
def autocomplete_families(
    q: str = Query(..., min_length=1), db: Session = Depends(get_db)
):
    term = f"%{q.strip()}%"
    fams = (
        db.query(models.EngineFamily)
        .filter(
            models.EngineFamily.is_active.is_(True),
            or_(models.EngineFamily.code.ilike(term), models.EngineFamily.name.ilike(term)),
        )
        .order_by(asc(models.EngineFamily.code))
        .limit(30)
        .all()
    )
    return [_engine_family_to_schema(db, f) for f in fams]

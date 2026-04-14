import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from dependencies import require_manager_or_admin, require_roles
from services.audit import write_audit_log

router = APIRouter(prefix="/api/v1/categories", tags=["categories"], dependencies=[Depends(require_manager_or_admin)])
brands_router = APIRouter(prefix="/api/v1/brands", tags=["brands"], dependencies=[Depends(require_manager_or_admin)])


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9а-яё]+", "-", value.lower()).strip("-")
    return slug or "item"


@router.get("/", response_model=list[schemas.CategoryResponse])
def list_categories(db: Session = Depends(get_db), active_only: bool = Query(False)):
    q = db.query(models.Category)
    if active_only:
        q = q.filter(models.Category.is_active.is_(True))
    return q.order_by(models.Category.name.asc()).all()


@router.post("/", response_model=schemas.CategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: schemas.CategoryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_manager_or_admin),
):
    slug = payload.slug or slugify(payload.name)
    if db.query(models.Category).filter(models.Category.slug == slug).first():
        raise HTTPException(status_code=400, detail="Category slug already exists")
    category = models.Category(name=payload.name.strip(), slug=slug, is_active=payload.is_active)
    db.add(category)
    db.flush()
    write_audit_log(db, user_id=current_user.id, action="CREATE_CATEGORY", entity_type="category", entity_id=category.id, payload={"name": category.name, "slug": category.slug})
    db.commit()
    db.refresh(category)
    return category


@router.put("/{category_id}", response_model=schemas.CategoryResponse)
def update_category(
    category_id: int,
    payload: schemas.CategoryUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_manager_or_admin),
):
    category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    update = payload.model_dump(exclude_unset=True)
    if "name" in update and update["name"]:
        category.name = update["name"].strip()
    if "slug" in update and update["slug"]:
        slug = slugify(update["slug"])
        exists = db.query(models.Category).filter(models.Category.slug == slug, models.Category.id != category_id).first()
        if exists:
            raise HTTPException(status_code=400, detail="Category slug already exists")
        category.slug = slug
    if "is_active" in update:
        category.is_active = bool(update["is_active"])
    write_audit_log(db, user_id=current_user.id, action="UPDATE_CATEGORY", entity_type="category", entity_id=category.id, payload=update)
    db.commit()
    db.refresh(category)
    return category


@router.delete("/{category_id}")
def delete_category(
    category_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin")),
):
    category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    linked = db.query(models.Product).filter(models.Product.category_id == category_id, models.Product.is_active.is_(True)).count()
    if linked > 0:
        raise HTTPException(status_code=400, detail="Нельзя удалить категорию: есть привязанные товары")
    db.delete(category)
    write_audit_log(db, user_id=current_user.id, action="DELETE_CATEGORY", entity_type="category", entity_id=category_id)
    db.commit()
    return {"ok": True}


@brands_router.get("/", response_model=list[schemas.BrandResponse])
def list_brands(db: Session = Depends(get_db), active_only: bool = Query(False)):
    q = db.query(models.Brand)
    if active_only:
        q = q.filter(models.Brand.is_active.is_(True))
    return q.order_by(models.Brand.name.asc()).all()


@brands_router.post("/", response_model=schemas.BrandResponse, status_code=status.HTTP_201_CREATED)
def create_brand(
    payload: schemas.BrandCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_manager_or_admin),
):
    slug = payload.slug or slugify(payload.name)
    if db.query(models.Brand).filter(models.Brand.slug == slug).first():
        raise HTTPException(status_code=400, detail="Brand slug already exists")
    brand = models.Brand(name=payload.name.strip(), slug=slug, is_active=payload.is_active)
    db.add(brand)
    db.flush()
    write_audit_log(db, user_id=current_user.id, action="CREATE_BRAND", entity_type="brand", entity_id=brand.id, payload={"name": brand.name, "slug": brand.slug})
    db.commit()
    db.refresh(brand)
    return brand


@brands_router.put("/{brand_id}", response_model=schemas.BrandResponse)
def update_brand(
    brand_id: int,
    payload: schemas.BrandUpdate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_manager_or_admin),
):
    brand = db.query(models.Brand).filter(models.Brand.id == brand_id).first()
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    update = payload.model_dump(exclude_unset=True)
    if "name" in update and update["name"]:
        brand.name = update["name"].strip()
    if "slug" in update and update["slug"]:
        slug = slugify(update["slug"])
        exists = db.query(models.Brand).filter(models.Brand.slug == slug, models.Brand.id != brand_id).first()
        if exists:
            raise HTTPException(status_code=400, detail="Brand slug already exists")
        brand.slug = slug
    if "is_active" in update:
        brand.is_active = bool(update["is_active"])
    write_audit_log(db, user_id=current_user.id, action="UPDATE_BRAND", entity_type="brand", entity_id=brand.id, payload=update)
    db.commit()
    db.refresh(brand)
    return brand


@brands_router.delete("/{brand_id}")
def delete_brand(
    brand_id: int,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin")),
):
    brand = db.query(models.Brand).filter(models.Brand.id == brand_id).first()
    if not brand:
        raise HTTPException(status_code=404, detail="Brand not found")
    linked = db.query(models.Product).filter(models.Product.brand_id == brand_id, models.Product.is_active.is_(True)).count()
    if linked > 0:
        raise HTTPException(status_code=400, detail="Нельзя удалить бренд: есть привязанные товары")
    db.delete(brand)
    write_audit_log(db, user_id=current_user.id, action="DELETE_BRAND", entity_type="brand", entity_id=brand_id)
    db.commit()
    return {"ok": True}

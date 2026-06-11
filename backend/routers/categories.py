import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

import models
import schemas
from database import get_db
from dependencies import require_manager_or_admin, require_roles
from services.audit import write_audit_log
from services.form_layout import has_custom_form_layout, normalize_attribute_schema

router = APIRouter(prefix="/api/v1/categories", tags=["categories"], dependencies=[Depends(require_manager_or_admin)])
brands_router = APIRouter(prefix="/api/v1/brands", tags=["brands"], dependencies=[Depends(require_manager_or_admin)])
product_groups_router = APIRouter(
    prefix="/api/v1/product-groups",
    tags=["product-groups"],
    dependencies=[Depends(require_manager_or_admin)],
)


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9а-яё]+", "-", value.lower()).strip("-")
    return slug or "item"


def _build_tree(db: Session, active_only: bool) -> list[schemas.CategoryTreeGroup]:
    q = db.query(models.Category)
    if active_only:
        q = q.filter(models.Category.is_active.is_(True))
    rows = q.order_by(models.Category.sort_order.asc(), models.Category.name.asc()).all()
    groups = [c for c in rows if c.parent_id is None]
    children_by_parent: dict[int, list[models.Category]] = {}
    for c in rows:
        if c.parent_id:
            children_by_parent.setdefault(c.parent_id, []).append(c)
    out: list[schemas.CategoryTreeGroup] = []
    for g in groups:
        kids = children_by_parent.get(g.id, [])
        out.append(
            schemas.CategoryTreeGroup(
                id=g.id,
                name=g.name,
                slug=g.slug,
                icon=g.icon,
                sort_order=g.sort_order or 0,
                is_active=bool(g.is_active),
                children=[
                    schemas.CategoryTreeChild(
                        id=c.id,
                        name=c.name,
                        slug=c.slug,
                        icon=c.icon,
                        sort_order=c.sort_order or 0,
                        attribute_schema=c.attribute_schema if isinstance(c.attribute_schema, dict) else None,
                        has_form_layout=has_custom_form_layout(
                            c.attribute_schema if isinstance(c.attribute_schema, dict) else None
                        ),
                        is_active=bool(c.is_active),
                    )
                    for c in sorted(kids, key=lambda x: (x.sort_order or 0, x.name))
                ],
            )
        )
    return out


@router.get("/tree", response_model=list[schemas.CategoryTreeGroup])
def category_tree(db: Session = Depends(get_db), active_only: bool = Query(True)):
    return _build_tree(db, active_only)


@product_groups_router.get("", response_model=list[schemas.CategoryTreeGroup])
@product_groups_router.get("/", response_model=list[schemas.CategoryTreeGroup])
def list_product_groups(db: Session = Depends(get_db), active_only: bool = Query(True)):
    """Алиас дерева категорий (группы → подкатегории с attribute_schema)."""
    return _build_tree(db, active_only)


@product_groups_router.get("/{group_id}", response_model=schemas.CategoryTreeGroup)
def get_product_group(group_id: int, db: Session = Depends(get_db), active_only: bool = Query(True)):
    tree = _build_tree(db, active_only)
    hit = next((g for g in tree if g.id == group_id), None)
    if not hit:
        raise HTTPException(status_code=404, detail="Группа не найдена")
    return hit


@router.post("/seed-defaults")
def seed_categories_defaults(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin")),
):
    from services.category_seed import seed_default_categories

    count = seed_default_categories(db)
    write_audit_log(
        db,
        user_id=current_user.id,
        action="SEED_CATEGORIES",
        entity_type="category",
        entity_id=None,
        payload={"groups": count},
    )
    return {"ok": True, "groups": count}


@router.post("/normalize-profiles")
def normalize_category_profiles(
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_roles("admin")),
):
    """Идемпотентная миграция pricing_mode/vehicle_mode для всех подкатегорий."""
    from services.catalog_migrate import normalize_catalog_profiles

    result = normalize_catalog_profiles(db)
    write_audit_log(
        db,
        user_id=current_user.id,
        action="NORMALIZE_CATEGORY_PROFILES",
        entity_type="category",
        entity_id=None,
        payload=result,
    )
    return {"ok": True, **result}


@router.get("/", response_model=list[schemas.CategoryResponse])
def list_categories(db: Session = Depends(get_db), active_only: bool = Query(False)):
    q = db.query(models.Category)
    if active_only:
        q = q.filter(models.Category.is_active.is_(True))
    return q.order_by(models.Category.sort_order.asc(), models.Category.name.asc()).all()


@router.post("/", response_model=schemas.CategoryResponse, status_code=status.HTTP_201_CREATED)
def create_category(
    payload: schemas.CategoryCreate,
    db: Session = Depends(get_db),
    current_user: models.User = Depends(require_manager_or_admin),
):
    slug = payload.slug or slugify(payload.name)
    if payload.parent_id:
        slug = f"{payload.parent_id}-{slugify(payload.name)}"
    if db.query(models.Category).filter(models.Category.slug == slug).first():
        raise HTTPException(status_code=400, detail="Category slug already exists")
    attr_schema = (
        normalize_attribute_schema(payload.attribute_schema)
        if payload.attribute_schema is not None
        else None
    )
    category = models.Category(
        name=payload.name.strip(),
        slug=slug,
        parent_id=payload.parent_id,
        icon=payload.icon,
        sort_order=payload.sort_order or 0,
        attribute_schema=attr_schema,
        is_active=payload.is_active,
    )
    db.add(category)
    db.flush()
    write_audit_log(
        db,
        user_id=current_user.id,
        action="CREATE_CATEGORY",
        entity_type="category",
        entity_id=category.id,
        payload={"name": category.name, "slug": category.slug, "parent_id": category.parent_id},
    )
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
    if "parent_id" in update:
        category.parent_id = update["parent_id"]
    if "icon" in update:
        category.icon = update["icon"]
    if "sort_order" in update and update["sort_order"] is not None:
        category.sort_order = int(update["sort_order"])
    if "attribute_schema" in update:
        category.attribute_schema = normalize_attribute_schema(update["attribute_schema"])
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
    current_user: models.User = Depends(require_manager_or_admin),
):
    category = db.query(models.Category).filter(models.Category.id == category_id).first()
    if not category:
        raise HTTPException(status_code=404, detail="Category not found")
    child_count = db.query(models.Category).filter(models.Category.parent_id == category_id).count()
    if child_count > 0:
        raise HTTPException(status_code=400, detail="Нельзя удалить группу: есть подкатегории")
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

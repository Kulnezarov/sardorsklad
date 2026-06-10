"""Связи товара с марками/моделями и кодами совместимости + кэш поля model."""

from __future__ import annotations

import re
import unicodedata
from datetime import UTC, datetime
from typing import Iterable, List, Optional, Set

from sqlalchemy import func, or_
from sqlalchemy.orm import Session, joinedload

import models
import schemas


# maketrans требует строки равной длины; ж/sh/ch — многосимвольно → мапа посимвольно/подстроки
_CYR_TO_LAT = {
    "а": "a",
    "б": "b",
    "в": "v",
    "г": "g",
    "д": "d",
    "е": "e",
    "ё": "e",
    "ж": "zh",
    "з": "z",
    "и": "i",
    "й": "j",
    "к": "k",
    "л": "l",
    "м": "m",
    "н": "n",
    "о": "o",
    "п": "p",
    "р": "r",
    "с": "s",
    "т": "t",
    "у": "u",
    "ф": "f",
    "х": "h",
    "ц": "c",
    "ч": "ch",
    "ш": "sh",
    "щ": "shch",
    "ъ": "",
    "ы": "y",
    "ь": "",
    "э": "e",
    "ю": "yu",
    "я": "ya",
}


def slugify_label(s: str, fallback: str = "item") -> str:
    """URL-safe slug: латиница, цифры, дефис; кириллица транслитеруется грубо."""
    raw = (s or "").strip().lower()
    if not raw:
        raw = fallback
    t = "".join(_CYR_TO_LAT.get(c, c) for c in raw)
    t = unicodedata.normalize("NFKD", t)
    t = re.sub(r"[^a-z0-9]+", "-", t, flags=re.I)
    t = t.strip("-")[:150] or fallback
    return t


def vehicle_brand_to_response(row: models.VehicleBrand) -> schemas.VehicleBrandResponse:
    """
    ORM → API: NULL в created_at/updated_at и naive-UTC (старые БД) — без этого Pydantic даёт 500.
    """
    now = datetime.now(UTC)
    ca = row.created_at
    ua = row.updated_at
    if ca is not None and getattr(ca, "tzinfo", None) is None:
        ca = ca.replace(tzinfo=UTC)
    if ua is not None and getattr(ua, "tzinfo", None) is None:
        ua = ua.replace(tzinfo=UTC)
    ca = ca or now
    ua = ua or ca
    return schemas.VehicleBrandResponse(
        id=row.id,
        name=(row.name or "").strip() or "—",
        slug=(row.slug or "brand").strip() or "brand",
        is_active=bool(row.is_active) if row.is_active is not None else True,
        created_at=ca,
        updated_at=ua,
    )


def _sync_link_rows(
    db: Session,
    product_id: int,
    new_vm_ids: Optional[Iterable[int]],
    new_ef_ids: Optional[Iterable[int]],
) -> None:
    db.query(models.ProductVehicleModelLink).filter(
        models.ProductVehicleModelLink.product_id == product_id
    ).delete(synchronize_session=False)
    db.query(models.ProductEngineFamilyLink).filter(
        models.ProductEngineFamilyLink.product_id == product_id
    ).delete(synchronize_session=False)

    seen_vm: Set[int] = set()
    for vid in new_vm_ids or ():
        if not vid or vid in seen_vm:
            continue
        seen_vm.add(int(vid))
        db.add(
            models.ProductVehicleModelLink(
                product_id=product_id,
                vehicle_model_id=int(vid),
            )
        )

    seen_ef: Set[int] = set()
    for eid in new_ef_ids or ():
        if not eid or eid in seen_ef:
            continue
        seen_ef.add(int(eid))
        db.add(
            models.ProductEngineFamilyLink(
                product_id=product_id,
                engine_family_id=int(eid),
            )
        )


def apply_product_compatibility(
    db: Session,
    product: models.Product,
    *,
    vehicle_model_ids: Optional[List[int]] = None,
    engine_family_ids: Optional[List[int]] = None,
) -> None:
    _sync_link_rows(db, product.id, vehicle_model_ids, engine_family_ids)
    db.flush()
    refresh_product_model_field_cache(db, product)


def refresh_product_model_field_cache(db: Session, product: models.Product) -> None:
    """Кэширует краткое описание в product.model и product.brand (первая марка/модель)."""
    p = (
        db.query(models.Product)
        .options(
            joinedload(models.Product.compatibility_vehicle_models)
            .joinedload(models.ProductVehicleModelLink.vehicle_model)
            .joinedload(models.VehicleModel.vehicle_brand),
        )
        .filter(models.Product.id == product.id)
        .first()
    )
    if not p:
        return

    model_labels: List[str] = []
    primary_brand: str | None = None
    primary_model: str | None = None
    for link in p.compatibility_vehicle_models or []:
        vm = link.vehicle_model
        if not vm:
            continue
        bname = (vm.vehicle_brand.name if vm.vehicle_brand else "") or ""
        label = f"{bname} {vm.name}".strip() if bname else vm.name
        if label and label not in model_labels:
            model_labels.append(label)
        if primary_brand is None and bname:
            primary_brand = bname.strip()
        if primary_model is None and vm.name:
            primary_model = str(vm.name).strip()

    if model_labels:
        summary = ", ".join(model_labels[:8])[:120]
        p.model = summary
        if primary_brand:
            p.brand = primary_brand
        if product is not p:
            product.model = p.model
            if primary_brand:
                product.brand = primary_brand
        return

    if product is not p:
        product.model = p.model


def build_compatibility_map(db: Session, product_ids: List[int]) -> dict[int, schemas.ProductCompatibilityOut]:
    """Пакетная загрузка совместимости для витрины/списков."""
    if not product_ids:
        return {}
    ef_by_p: dict[int, dict[int, schemas.CompatibilityEngineFamilyBrief]] = {}
    vm_by_p: dict[int, dict[int, schemas.CompatibilityVehicleModelBrief]] = {}
    ec_by_p: dict[int, list[schemas.EngineCompatibilityItem]] = {}
    for pid in product_ids:
        ef_by_p[pid] = {}
        vm_by_p[pid] = {}
        ec_by_p[pid] = []
    ef_rows = (
        db.query(
            models.ProductEngineFamilyLink.product_id,
            models.EngineFamily,
        )
        .join(
            models.EngineFamily,
            models.EngineFamily.id == models.ProductEngineFamilyLink.engine_family_id,
        )
        .filter(models.ProductEngineFamilyLink.product_id.in_(product_ids))
        .all()
    )
    vm_rows = (
        db.query(
            models.ProductVehicleModelLink.product_id,
            models.VehicleModel,
            models.VehicleBrand,
        )
        .join(
            models.VehicleModel,
            models.VehicleModel.id == models.ProductVehicleModelLink.vehicle_model_id,
        )
        .join(
            models.VehicleBrand,
            models.VehicleBrand.id == models.VehicleModel.vehicle_brand_id,
        )
        .filter(models.ProductVehicleModelLink.product_id.in_(product_ids))
        .all()
    )
    ec_rows = (
        db.query(
            models.Product.id,
            models.Compatibility.id,
            models.Compatibility.brand,
            models.Compatibility.model,
        )
        .join(models.EngineCode, models.EngineCode.id == models.Product.engine_code_id)
        .join(models.Compatibility, models.Compatibility.engine_code_id == models.EngineCode.id)
        .filter(models.Product.id.in_(product_ids))
        .all()
    )
    for pid, ef in ef_rows:
        ef_by_p[pid][ef.id] = schemas.CompatibilityEngineFamilyBrief(
            id=ef.id, code=ef.code, name=ef.name
        )
    for pid, vm, vb in vm_rows:
        vm_by_p[pid][vm.id] = schemas.CompatibilityVehicleModelBrief(
            id=vm.id,
            name=vm.name,
            vehicle_brand_id=vm.vehicle_brand_id,
            brand_name=vb.name if vb else "",
        )
    for pid, cid, brand, model in ec_rows:
        ec_by_p[pid].append(schemas.EngineCompatibilityItem(id=cid, brand=brand, model=model))
    out: dict[int, schemas.ProductCompatibilityOut] = {}
    for pid in product_ids:
        efs = sorted(ef_by_p[pid].values(), key=lambda x: (x.code.casefold(), x.id))
        vms = sorted(
            vm_by_p[pid].values(),
            key=lambda x: (x.brand_name.casefold(), x.name.casefold(), x.id),
        )
        ecs = sorted(ec_by_p[pid], key=lambda x: (x.brand.casefold(), x.model.casefold(), x.id))
        out[pid] = schemas.ProductCompatibilityOut(
            engine_families=efs,
            vehicle_models=vms,
            engine_code_compatibility=ecs,
        )
    return out


def build_compatibility_brand_groups(
    comp: schemas.ProductCompatibilityOut,
) -> list[schemas.CompatibilityBrandGroup]:
    """Группировка моделей по марке для витрины."""
    order: list[int] = []
    by_brand: dict[int, dict] = {}
    for vm in comp.vehicle_models or []:
        bid = int(vm.vehicle_brand_id)
        if bid not in by_brand:
            by_brand[bid] = {
                "brand_id": bid,
                "brand_name": (vm.brand_name or "").strip() or "—",
                "models": [],
            }
            order.append(bid)
        name = (vm.name or "").strip()
        if name and name not in by_brand[bid]["models"]:
            by_brand[bid]["models"].append(name)
    out: list[schemas.CompatibilityBrandGroup] = []
    for bid in order:
        g = by_brand[bid]
        out.append(
            schemas.CompatibilityBrandGroup(
                brand_id=g["brand_id"],
                brand_name=g["brand_name"],
                models=g["models"],
            )
        )
    return out


def compatibility_storefront_meta(
    comp: schemas.ProductCompatibilityOut,
) -> tuple[str | None, int, list[str], list[schemas.CompatibilityBrandGroup]]:
    """
    primary preview, extra brands count, flat labels, grouped by brand.
    primary: «FAW Bestune X40»
    more_brands: число доп. марок (не моделей)
    """
    groups = build_compatibility_brand_groups(comp)
    labels: list[str] = []
    for g in groups:
        for mn in g.models:
            s = f"{g.brand_name} {mn}".strip()
            if s and s not in labels:
                labels.append(s)
    primary: str | None = None
    if groups:
        g0 = groups[0]
        if g0.models:
            primary = f"{g0.brand_name} {g0.models[0]}".strip()
        else:
            primary = g0.brand_name
    more_brands = max(0, len(groups) - 1)
    return primary, more_brands, labels, groups


def build_compatibility_out(db: Session, product_id: int) -> schemas.ProductCompatibilityOut:
    p = (
        db.query(models.Product)
        .options(
            joinedload(models.Product.compatibility_engine_families).joinedload(
                models.ProductEngineFamilyLink.engine_family
            ),
            joinedload(models.Product.compatibility_vehicle_models)
            .joinedload(models.ProductVehicleModelLink.vehicle_model)
            .joinedload(models.VehicleModel.vehicle_brand),
        )
        .filter(models.Product.id == product_id)
        .first()
    )
    if not p:
        return schemas.ProductCompatibilityOut()
    efs: List[schemas.CompatibilityEngineFamilyBrief] = []
    seen_ef: Set[int] = set()
    for link in p.compatibility_engine_families or []:
        ef = link.engine_family
        if not ef or ef.id in seen_ef:
            continue
        seen_ef.add(ef.id)
        efs.append(
            schemas.CompatibilityEngineFamilyBrief(id=ef.id, code=ef.code, name=ef.name)
        )
    efs.sort(key=lambda x: (x.code.casefold(), x.id))
    vms: List[schemas.CompatibilityVehicleModelBrief] = []
    seen_v: Set[int] = set()
    for link in p.compatibility_vehicle_models or []:
        vm = link.vehicle_model
        if not vm or vm.id in seen_v:
            continue
        seen_v.add(vm.id)
        bname = vm.vehicle_brand.name if vm.vehicle_brand else ""
        vms.append(
            schemas.CompatibilityVehicleModelBrief(
                id=vm.id,
                name=vm.name,
                vehicle_brand_id=vm.vehicle_brand_id,
                brand_name=bname,
            )
        )
    ecs: List[schemas.EngineCompatibilityItem] = []
    if p.engine_code_id:
        rows = (
            db.query(models.Compatibility)
            .filter(models.Compatibility.engine_code_id == p.engine_code_id)
            .order_by(models.Compatibility.brand.asc(), models.Compatibility.model.asc())
            .all()
        )
        ecs = [schemas.EngineCompatibilityItem.model_validate(r, from_attributes=True) for r in rows]
    return schemas.ProductCompatibilityOut(
        engine_families=efs,
        vehicle_models=vms,
        engine_code_compatibility=ecs,
    )


def build_car_compatibility_from_model_ids(db: Session, model_ids: list[int]) -> dict[str, list[str]]:
    """{slug марки: [имена моделей]} для API car_compatibility."""
    if not model_ids:
        return {}
    rows = (
        db.query(models.VehicleModel)
        .options(joinedload(models.VehicleModel.vehicle_brand))
        .filter(models.VehicleModel.id.in_(model_ids))
        .all()
    )
    out: dict[str, list[str]] = {}
    for vm in rows:
        brand = vm.vehicle_brand
        if not brand:
            continue
        key = brand.slug or slugify_label(brand.name)
        out.setdefault(key, [])
        if vm.name and vm.name not in out[key]:
            out[key].append(vm.name)
    return out


def resolve_car_compatibility_to_model_ids(db: Session, car_compatibility: dict | None) -> list[int]:
    """Разрешает car_compatibility в список vehicle_model.id."""
    if not car_compatibility or not isinstance(car_compatibility, dict):
        return []
    ids: list[int] = []
    for brand_key, model_names in car_compatibility.items():
        if not brand_key:
            continue
        brand = (
            db.query(models.VehicleBrand)
            .filter(
                or_(
                    models.VehicleBrand.slug == str(brand_key).strip(),
                    func.lower(models.VehicleBrand.name) == str(brand_key).strip().lower(),
                )
            )
            .first()
        )
        if not brand:
            continue
        names = model_names if isinstance(model_names, list) else []
        for name in names:
            if not name:
                continue
            vm = (
                db.query(models.VehicleModel)
                .filter(
                    models.VehicleModel.vehicle_brand_id == brand.id,
                    models.VehicleModel.name == str(name).strip(),
                )
                .first()
            )
            if vm:
                ids.append(vm.id)
    return list(dict.fromkeys(ids))

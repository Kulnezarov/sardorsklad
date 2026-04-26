"""Связи товара с марками/моделями и кодами совместимости + кэш поля model."""

from __future__ import annotations

import re
import unicodedata
from datetime import UTC, datetime
from typing import Iterable, List, Optional, Set

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
    """Кэширует краткое описание в product.model (до 120 симв.)."""
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
        .filter(models.Product.id == product.id)
        .first()
    )
    if not p:
        return

    codes: List[str] = []
    for link in p.compatibility_engine_families or []:
        if link.engine_family and link.engine_family.code:
            codes.append(link.engine_family.code)
    codes = sorted(set(codes), key=str.casefold)

    model_labels: List[str] = []
    for link in p.compatibility_vehicle_models or []:
        vm = link.vehicle_model
        if not vm:
            continue
        bname = (vm.vehicle_brand.name if vm.vehicle_brand else "") or ""
        model_labels.append(f"{bname} {vm.name}".strip())
    model_labels = list(dict.fromkeys(model_labels))  # order-preserving unique

    parts: List[str] = []
    if codes:
        parts.append("Коды: " + ", ".join(codes[:12]))
    if model_labels:
        parts.append("Совм.: " + ", ".join(model_labels[:8]))
    summary = " · ".join(parts)[:120]
    if summary:
        p.model = summary
    if product is not p:
        product.model = p.model


def build_compatibility_map(db: Session, product_ids: List[int]) -> dict[int, schemas.ProductCompatibilityOut]:
    """Пакетная загрузка совместимости для витрины/списков."""
    if not product_ids:
        return {}
    ef_by_p: dict[int, dict[int, schemas.CompatibilityEngineFamilyBrief]] = {}
    vm_by_p: dict[int, dict[int, schemas.CompatibilityVehicleModelBrief]] = {}
    for pid in product_ids:
        ef_by_p[pid] = {}
        vm_by_p[pid] = {}
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
    out: dict[int, schemas.ProductCompatibilityOut] = {}
    for pid in product_ids:
        efs = sorted(ef_by_p[pid].values(), key=lambda x: (x.code.casefold(), x.id))
        vms = sorted(
            vm_by_p[pid].values(),
            key=lambda x: (x.brand_name.casefold(), x.name.casefold(), x.id),
        )
        out[pid] = schemas.ProductCompatibilityOut(engine_families=efs, vehicle_models=vms)
    return out


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
    vms.sort(key=lambda x: (x.brand_name.casefold(), x.name.casefold(), x.id))
    return schemas.ProductCompatibilityOut(engine_families=efs, vehicle_models=vms)

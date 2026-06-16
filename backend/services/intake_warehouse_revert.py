"""Отмена загрузки накладной на склад: убрать товары со склада, оставить в накладной."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from sqlalchemy.orm import Session

import models
from services.audit import write_audit_log


def _line_qty(line: dict) -> int:
    try:
        return max(0, int(line.get("quantity") or 0))
    except (TypeError, ValueError):
        return 0


def _lines_to_revert(invoice: models.IntakeInvoice, lines: list) -> list[dict]:
    """Какие строки считать загруженными на склад."""
    if bool(invoice.uploaded):
        return [dict(x) for x in lines if isinstance(x, dict)]
    synced = [dict(x) for x in lines if isinstance(x, dict) and x.get("warehouse_synced") is True]
    if synced:
        return synced
    if bool(invoice.pending_warehouse_upload):
        return [dict(x) for x in lines if isinstance(x, dict)]
    return []


def _archive_product(db: Session, product: models.Product, user_id: int, *, invoice_number: int) -> None:
    """Мягкое удаление товара (как DELETE /products/{id})."""
    if not product.is_active:
        return
    old_sku = product.sku
    old_barcode = product.barcode
    archived_suffix = datetime.now(UTC).strftime("%Y%m%d%H%M%S")
    if product.sku:
        product.sku = f"{product.sku}-archived-{product.id}-{archived_suffix}"[:100]
    product.barcode = None
    product.is_active = False
    write_audit_log(
        db,
        user_id=user_id,
        action="INTAKE_REVERT_ARCHIVE_PRODUCT",
        entity_type="product",
        entity_id=product.id,
        payload={
            "invoice_number": invoice_number,
            "old_sku": old_sku,
            "old_barcode": old_barcode,
        },
    )
    db.add(
        models.History(
            product_id=product.id,
            operation_type=models.OperationType.DELETED.value,
            quantity_change=0,
            reference_type="intake_invoice",
            reference_id=invoice_number,
            details={
                "message": f"Товар {product.name} снят со склада (отмена накладной №{invoice_number})",
                "old_sku": old_sku,
                "old_barcode": old_barcode,
            },
        )
    )


def revert_intake_warehouse_upload(
    db: Session,
    invoice: models.IntakeInvoice,
    user_id: int,
) -> dict[str, Any]:
    """
    Убрать загруженные позиции со склада и вернуть накладную в режим редактирования.
    """
    lines = list(invoice.lines) if isinstance(invoice.lines, list) else []
    to_revert = _lines_to_revert(invoice, lines)
    if not to_revert:
        raise ValueError("Нет загруженных позиций для отмены")

    report: dict[str, Any] = {
        "removed": 0,
        "updated": 0,
        "skipped": 0,
        "warnings": [],
        "errors": [],
    }

    for line in to_revert:
        name = str(line.get("name") or "Позиция").strip()
        barcode = str(line.get("barcode") or "").strip()
        subtract = _line_qty(line)
        if not barcode:
            report["skipped"] += 1
            report["errors"].append(f"{name}: нет штрих-кода — пропущено")
            continue
        if subtract <= 0:
            report["skipped"] += 1
            report["warnings"].append(f"{name}: количество 0 — только снята отметка")
            continue

        product = (
            db.query(models.Product)
            .filter(models.Product.barcode == barcode, models.Product.is_active.is_(True))
            .first()
        )
        if not product:
            report["skipped"] += 1
            report["warnings"].append(f"{name}: на складе не найден (штрих-код {barcode})")
            continue

        current = int(product.quantity or 0)
        if current <= 0:
            _archive_product(db, product, user_id, invoice_number=int(invoice.number or 0))
            report["removed"] += 1
            continue

        if current >= subtract:
            new_qty = current - subtract
            if new_qty <= 0:
                _archive_product(db, product, user_id, invoice_number=int(invoice.number or 0))
                report["removed"] += 1
            else:
                product.quantity = new_qty
                db.add(
                    models.History(
                        product_id=product.id,
                        operation_type=models.OperationType.EDITED.value,
                        quantity_change=-subtract,
                        reference_type="intake_invoice",
                        reference_id=int(invoice.number or 0),
                        details={
                            "message": f"Отмена накладной №{invoice.number}: −{subtract} шт",
                            "barcode": barcode,
                            "quantity_before": current,
                            "quantity_after": new_qty,
                        },
                    )
                )
                report["updated"] += 1
        else:
            product.quantity = 0
            _archive_product(db, product, user_id, invoice_number=int(invoice.number or 0))
            report["removed"] += 1
            report["warnings"].append(
                f"{name}: на складе было {current} шт, снято {current} (ожидалось {subtract})"
            )

    next_lines: list[Any] = []
    for raw in lines:
        if not isinstance(raw, dict):
            next_lines.append(raw)
            continue
        cleaned = dict(raw)
        cleaned.pop("warehouse_synced", None)
        next_lines.append(cleaned)

    invoice.lines = next_lines
    invoice.uploaded = False
    invoice.pending_warehouse_upload = False
    invoice.uploaded_at = None

    write_audit_log(
        db,
        user_id=user_id,
        action="INTAKE_REVERT_WAREHOUSE",
        entity_type="intake_invoice",
        entity_id=invoice.id,
        payload={
            "client_id": invoice.client_id,
            "number": invoice.number,
            **{k: report[k] for k in ("removed", "updated", "skipped")},
        },
    )

    db.commit()
    db.refresh(invoice)
    return report

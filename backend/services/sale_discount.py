"""Расчёт скидки от суммы чека (процент от subtotal)."""

from decimal import Decimal
from typing import Optional, Tuple


def apply_sale_discount(
    subtotal: Decimal,
    discount_percent: Optional[Decimal],
) -> Tuple[Decimal, Decimal, Optional[Decimal]]:
    """
    Возвращает (total_amount, discount_amount, normalized_percent).
  """
    subtotal = Decimal(str(subtotal or 0))
    if discount_percent is None:
        return subtotal, Decimal("0"), None
    pct = Decimal(str(discount_percent))
    if pct <= 0:
        return subtotal, Decimal("0"), None
    pct = min(Decimal("100"), pct).quantize(Decimal("0.01"))
    discount_amount = (subtotal * pct / Decimal("100")).quantize(Decimal("0.01"))
    total = (subtotal - discount_amount).quantize(Decimal("0.01"))
    if total < 0:
        total = Decimal("0")
    return total, discount_amount, pct

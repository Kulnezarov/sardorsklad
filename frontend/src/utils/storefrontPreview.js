import { generateProductName } from './productNameUtils';

/**
 * Превью карточки CHPARTS из черновика формы склада.
 */
export function buildStorefrontPreview({
  formData,
  schema,
  categoryName = '',
  vehicleModels = [],
  compatibilityIds = [],
}) {
  const name = String(formData?.name || '').trim()
    || generateProductName(
      categoryName,
      formData?.attributes || {},
      schema,
      { brand: formData?.brand, model: formData?.model },
    )
    || 'Название товара';

  const highlights = [];
  (schema?.fields || []).forEach((f) => {
    const key = f.key?.trim();
    if (!key) return;
    const val = (formData?.attributes || {})[key];
    if (val != null && String(val).trim()) highlights.push(String(val).trim());
  });

  const labels = [];
  const seen = new Set();
  (compatibilityIds || []).forEach((id) => {
    const m = (vehicleModels || []).find((x) => x.id === id);
    if (!m) return;
    const brandObj = m.brand;
    const bname = brandObj?.name || m.brand_name || '';
    const label = `${bname} ${m.name || ''}`.trim();
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  });

  const compatPrimary = labels[0] || null;
  const compatMore = Math.max(0, labels.length - 1);

  const purpose = highlights.slice(0, 2).join(' · ') || categoryName || null;

  return {
    name,
    highlights: highlights.slice(0, 4),
    compatPrimary,
    compatMore,
    compatLabels: labels,
    purpose,
    salePrice: Number(formData?.sale_price) || 0,
    inStock: Number(formData?.quantity) > 0,
  };
}

export function formatCompatibilityTableCell(row) {
  const brand = String(row?.brand || '').trim();
  const model = String(row?.model || '').trim();
  const extra = Number(row?.compatibility_extra_count) || 0;
  if (!brand && !model && extra <= 0) return null;
  const primary = [brand, model].filter(Boolean).join(' ');
  if (!primary && extra > 0) return `+${extra} авто`;
  if (extra > 0) return { primary, extra };
  return { primary: primary || '—', extra: 0 };
}

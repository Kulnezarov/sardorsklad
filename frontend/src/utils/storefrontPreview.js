import { generateProductName } from './productNameUtils';

function engineCodesFromRow(row, engineFamilies = []) {
  const fromCompat = (row?.compatibility?.engine_families || [])
    .map((ef) => String(ef?.code || '').trim())
    .filter(Boolean);
  if (fromCompat.length) return fromCompat;

  const ids = row?.compatibility_engine_family_ids || [];
  if (ids.length && engineFamilies.length) {
    const codes = [];
    ids.forEach((id) => {
      const ef = engineFamilies.find((x) => Number(x.id) === Number(id));
      const code = String(ef?.code || '').trim();
      if (code && !codes.includes(code)) codes.push(code);
    });
    if (codes.length) return codes;
  }
  return [];
}

/**
 * Превью карточки CHPARTS из черновика формы склада.
 */
export function buildStorefrontPreview({
  formData,
  schema,
  categoryName = '',
  vehicleModels = [],
  compatibilityIds = [],
  engineFamilyIds = [],
  engineFamilies = [],
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

  let compatPrimary = labels[0] || null;
  let compatMore = Math.max(0, labels.length - 1);

  if (!compatPrimary && (engineFamilyIds || []).length) {
    const engineLabels = [];
    (engineFamilyIds || []).forEach((id) => {
      const ef = (engineFamilies || []).find((x) => Number(x.id) === Number(id));
      const code = String(ef?.code || '').trim();
      if (code && !engineLabels.includes(code)) engineLabels.push(code);
    });
    compatPrimary = engineLabels[0] || null;
    compatMore = Math.max(0, engineLabels.length - 1);
  }

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

/**
 * Подпись совместимости для сетки/таблицы: марка+модель авто или код мотора.
 * @returns {{ primary: string, extra: number, kind: 'vehicle'|'engine' } | null}
 */
export function formatCompatibilityTableCell(row, engineFamilies = []) {
  const brand = String(row?.brand || '').trim();
  const model = String(row?.model || '').trim();
  const extra = Number(row?.compatibility_extra_count) || 0;

  const vehiclePrimary = [brand, model].filter(Boolean).join(' ');
  if (vehiclePrimary) {
    const hasVehicle = Boolean(brand) || (row?.compatibility?.vehicle_models || []).length > 0;
    const kind = hasVehicle ? 'vehicle' : 'engine';
    if (extra > 0) return { primary: vehiclePrimary, extra, kind };
    return { primary: vehiclePrimary, extra: 0, kind };
  }

  const engineCodes = engineCodesFromRow(row, engineFamilies);
  if (engineCodes.length) {
    return {
      primary: engineCodes[0],
      extra: Math.max(0, engineCodes.length - 1, extra),
      kind: 'engine',
    };
  }

  if (model) {
    if (extra > 0) return { primary: model, extra, kind: 'engine' };
    return { primary: model, extra: 0, kind: 'engine' };
  }

  if (extra > 0) return { primary: `+${extra} авто`, extra, kind: 'vehicle' };
  return null;
}

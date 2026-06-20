/** Утилиты порядка полей товара для склада и витрины. */

export const BUILTIN_FIELD_DEFS = [
  { id: 'name', kind: 'builtin', key: 'name', label: 'Название' },
  { id: 'brand', kind: 'builtin', key: 'brand', label: 'Марка авто' },
  { id: 'model', kind: 'builtin', key: 'model', label: 'Модель авто' },
  { id: 'sku', kind: 'builtin', key: 'sku', label: 'Артикул' },
];

export function slugFieldKey(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '_')
    .replace(/^_|_$/g, '') || `field_${Date.now()}`;
}

export function defaultDisplayLayout(schema = null) {
  const layout = BUILTIN_FIELD_DEFS.map((x) => ({ ...x }));
  const fields = schema?.fields || [];
  const seen = new Set(layout.map((x) => x.id));
  fields.forEach((f) => {
    const key = f.key?.trim();
    if (!key) return;
    const id = `attr:${key}`;
    if (seen.has(id)) return;
    seen.add(id);
    layout.push({
      id,
      kind: 'attribute',
      key,
      label: f.label || key,
    });
  });
  return layout;
}

export function normalizeDisplayLayout(raw, schema = null) {
  if (!Array.isArray(raw) || !raw.length) return defaultDisplayLayout(schema);
  const out = [];
  const seen = new Set();
  raw.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const id = String(item.id || item.key || '').trim();
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      kind: item.kind || 'custom',
      key: item.key || (item.kind === 'custom' ? id : undefined),
      label: item.label || item.key || id,
      ...(item.kind === 'custom' && item.value != null ? { value: String(item.value) } : {}),
    });
  });
  return out.length ? out : defaultDisplayLayout(schema);
}

export function mergeLayoutWithSchema(layout, schema) {
  const base = normalizeDisplayLayout(layout, schema);
  const existing = new Set(
    base.filter((x) => x.kind === 'attribute').map((x) => x.key),
  );
  (schema?.fields || []).forEach((f) => {
    const key = f.key?.trim();
    if (!key || existing.has(key)) return;
    base.push({
      id: `attr:${key}`,
      kind: 'attribute',
      key,
      label: f.label || key,
    });
  });
  return base;
}

export function duplicateFieldEntry(entry) {
  const id = `custom:${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const key = slugFieldKey(entry?.label || 'поле');
  return {
    id,
    kind: 'custom',
    key,
    label: entry?.label ? `${entry.label} (копия)` : 'Новое поле',
    value: '',
  };
}

export function builtinValue(formData, key) {
  if (!formData) return '';
  if (key === 'name') return formData.name || '';
  if (key === 'brand') return formData.brand || '';
  if (key === 'model') return formData.model || '';
  if (key === 'sku') return formData.sku || '';
  if (key === 'description') return formData.description || '';
  return '';
}

export function setBuiltinValue(formData, key, value) {
  if (key === 'name') return { ...formData, name: value };
  if (key === 'brand') return { ...formData, brand: value };
  if (key === 'model') return { ...formData, model: value };
  if (key === 'sku') return { ...formData, sku: value };
  if (key === 'description') return { ...formData, description: value };
  return formData;
}

export function fieldValue(formData, entry, schema) {
  if (entry.kind === 'builtin') return builtinValue(formData, entry.key);
  if (entry.kind === 'attribute') return (formData.attributes || {})[entry.key] ?? '';
  if (entry.kind === 'custom') {
    if (entry.value != null) return entry.value;
    return (formData.attributes || {})[entry.key] ?? '';
  }
  return '';
}

export function applyFieldValue(formData, entry, value, layout, setLayout) {
  if (entry.kind === 'builtin') {
    return setBuiltinValue(formData, entry.key, value);
  }
  if (entry.kind === 'attribute') {
    return {
      ...formData,
      attributes: { ...(formData.attributes || {}), [entry.key]: value },
    };
  }
  if (entry.kind === 'custom') {
    const nextLayout = (layout || []).map((x) =>
      x.id === entry.id ? { ...x, value, key: x.key || entry.key } : x,
    );
    setLayout?.(nextLayout);
    return {
      ...formData,
      attributes: { ...(formData.attributes || {}), [entry.key || entry.id]: value },
      display_layout: nextLayout,
    };
  }
  return formData;
}

export function reorderLayout(list, fromIdx, toIdx) {
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return list;
  const next = [...list];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

export function removeLayoutEntry(list, id) {
  return (list || []).filter((x) => x.id !== id);
}

import { formatEngineFamilySummary } from './engineFamilyUtils';

/** Все метки совместимости для карточки товара. */
export function compatibilityLabelsFromProduct(product) {
  const labels = [];
  (product?.compatibility?.vehicle_models || []).forEach((vm) => {
    const s = `${vm.brand_name || ''} ${vm.name || ''}`.trim();
    if (s && !labels.includes(s)) labels.push(s);
  });
  (product?.compatibility?.engine_code_compatibility || []).forEach((ec) => {
    const s = `${ec.brand || ''} ${ec.model || ''}`.trim();
    if (s && !labels.includes(s)) labels.push(s);
  });
  (product?.compatibility?.engine_families || []).forEach((ef) => {
    const summary = formatEngineFamilySummary(ef);
    const code = String(ef.code || '').trim();
    const s = summary && summary !== code ? `${code} (${summary})` : code;
    if (s && !labels.includes(s)) labels.push(s);
  });
  return labels;
}

export function syncPrimaryVehicleFromSelection(formData, selectedModels) {
  if (!selectedModels?.length) return formData;
  const byBrand = new Map();
  selectedModels.forEach((m) => {
    const bid = m.vehicle_brand_id;
    const bname = m?.brand?.name || m?.brand_name || '';
    if (!byBrand.has(bid)) byBrand.set(bid, { brand: bname, models: [] });
    if (m.name) byBrand.get(bid).models.push(m.name);
  });
  const firstGroup = [...byBrand.values()][0];
  if (!firstGroup) return formData;
  const brand = firstGroup.brand || formData.brand;
  const model = firstGroup.models[0] || formData.model;
  return {
    ...formData,
    brand: brand || formData.brand,
    model: model || formData.model,
  };
}
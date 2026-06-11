/** Утилиты form_layout — шаблон карточки товара из настроек категории. */

export const LOCKED_ROWS = [
  { id: 'photos', kind: 'locked', key: 'gallery', width: 'full', label: 'Фото' },
  { id: 'barcode', kind: 'locked', key: 'barcode', width: 'full', label: 'Штрих-код' },
];

export const BUILTIN_LABELS = {
  name: 'Название',
  brand: 'Марка авто',
  model: 'Модель авто',
  sku: 'Артикул',
  description: 'Описание',
  cny_price: 'Закуп (¥)',
  delivery_block: 'Доставка (₸, кг)',
  purchase_block: 'Закуп и доставка',
  sale_price: 'Цена продажи',
  quantity: 'Количество',
  supplier: 'Поставщик',
  gallery: 'Фото',
  barcode: 'Штрих-код',
};

/** Поля цен/склада в хвосте form_layout (после артикула). */
export const PRICE_BUILTIN_KEYS = new Set([
  'cny_price',
  'delivery_block',
  'purchase_block',
  'sale_price',
  'quantity',
  'supplier',
  'description',
]);

export const ADDABLE_BUILTIN = [
  { id: 'name', kind: 'builtin', key: 'name', width: 'full', label: 'Название' },
  { id: 'cny', kind: 'builtin', key: 'cny_price', width: 'half', label: 'Закуп (¥)' },
  { id: 'delivery', kind: 'builtin', key: 'delivery_block', width: 'full', label: 'Доставка (₸, кг)' },
  { id: 'sale', kind: 'builtin', key: 'sale_price', width: 'half', label: 'Цена продажи' },
  { id: 'qty', kind: 'builtin', key: 'quantity', width: 'half', label: 'Количество' },
  { id: 'supplier', kind: 'builtin', key: 'supplier', width: 'full', label: 'Поставщик' },
  { id: 'description', kind: 'builtin', key: 'description', width: 'full', label: 'Описание' },
];

function splitLegacyPurchaseRow(row) {
  const width = row.width === 'half' ? 'half' : 'full';
  return [
    { id: 'cny', kind: 'builtin', key: 'cny_price', width, label: BUILTIN_LABELS.cny_price },
    { id: 'delivery', kind: 'builtin', key: 'delivery_block', width: 'full', label: BUILTIN_LABELS.delivery_block },
  ];
}

export function expandLayoutPurchaseRows(rows) {
  const out = [];
  (rows || []).forEach((row) => {
    if (row?.key === 'purchase_block') {
      out.push(...splitLegacyPurchaseRow(row));
    } else {
      out.push(row);
    }
  });
  return out;
}

export function slugFieldKey(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '_')
    .replace(/^_|_$/g, '') || `field_${Date.now()}`;
}

export function defaultFormLayout(schema = null) {
  const showCompat = Boolean(schema?.show_compatibility);
  const layout = LOCKED_ROWS.map((x) => ({ ...x }));
  layout.push({ id: 'name', kind: 'builtin', key: 'name', width: 'full', placeholder: 'Название товара' });
  if (showCompat) {
    layout.push({ id: 'compat', kind: 'compatibility', width: 'full', label: 'Совместим с авто' });
  }
  (schema?.fields || []).forEach((f) => {
    const key = f.key?.trim();
    if (!key) return;
    layout.push({
      id: `attr:${key}`,
      kind: 'attribute',
      key,
      width: f.width === 'half' ? 'half' : 'full',
      placeholder: f.placeholder || f.label || key,
    });
  });
  layout.push({ id: 'sku', kind: 'locked', key: 'sku', width: 'full', label: 'Артикул' });
  ADDABLE_BUILTIN.filter((b) => b.id !== 'name').forEach((row) => layout.push({ ...row }));
  return layout;
}

export function normalizeFormLayout(raw, schema = null) {
  if (!Array.isArray(raw) || !raw.length) return defaultFormLayout(schema);
  const fieldKeys = new Set((schema?.fields || []).map((f) => f.key?.trim()).filter(Boolean));
  const out = [];
  const seen = new Set();
  raw.forEach((item) => {
    if (!item || typeof item !== 'object') return;
    const id = String(item.id || item.key || '').trim();
    if (!id || seen.has(id)) return;
    const kind = item.kind || 'builtin';
    if (kind === 'attribute' && item.key && !fieldKeys.has(item.key)) return;
    if (kind === 'builtin' && item.key === 'purchase_block') {
      splitLegacyPurchaseRow(item).forEach((splitRow) => {
        if (seen.has(splitRow.id)) return;
        seen.add(splitRow.id);
        out.push({ ...splitRow, width: splitRow.width === 'half' ? 'half' : 'full' });
      });
      return;
    }
    if (kind === 'builtin' && item.key && !BUILTIN_LABELS[item.key]) return;
    seen.add(id);
    out.push({
      id,
      kind,
      key: item.key,
      width: item.width === 'half' ? 'half' : 'full',
      placeholder: item.placeholder || '',
      label: item.label || BUILTIN_LABELS[item.key] || item.key || id,
    });
  });
  return out.length ? out : defaultFormLayout(schema);
}

/** Группирует соседние half-строки в пары для сетки (редактор и форма). */
export function groupLayoutRowsForDisplay(rows) {
  const blocks = [];
  let halfBuffer = [];
  const flushHalf = () => {
    if (halfBuffer.length) {
      blocks.push({ type: 'half-row', items: [...halfBuffer] });
      halfBuffer = [];
    }
  };
  (rows || []).forEach((row) => {
    if (row.width === 'half') {
      halfBuffer.push(row);
      if (halfBuffer.length === 2) flushHalf();
    } else {
      flushHalf();
      blocks.push({ type: 'full', row });
    }
  });
  flushHalf();
  return blocks;
}

export function priceLayoutRows(schema) {
  const layout = expandLayoutPurchaseRows(normalizeFormLayout(schema?.form_layout, schema));
  return layout.filter((r) => r.kind === 'builtin' && PRICE_BUILTIN_KEYS.has(r.key));
}

export function layoutRowLabel(row, schema) {
  if (row.kind === 'attribute' && row.key) {
    const f = (schema?.fields || []).find((x) => x.key === row.key);
    return f?.label || row.key;
  }
  if (row.kind === 'compatibility') return 'Совместим с авто';
  return row.label || BUILTIN_LABELS[row.key] || row.key || row.id;
}

export function isLockedRow(row) {
  return row.kind === 'locked';
}

export function reorderFormLayout(list, fromIdx, toIdx) {
  if (fromIdx === toIdx || fromIdx < 0 || toIdx < 0) return list;
  const next = [...list];
  const [moved] = next.splice(fromIdx, 1);
  next.splice(toIdx, 0, moved);
  return next;
}

export function toggleRowWidth(row) {
  return { ...row, width: row.width === 'half' ? 'full' : 'half' };
}

export function fieldsToFullSchema(fields, showCompatibility, formLayout) {
  const out = (fields || [])
    .filter((f) => f.label?.trim())
    .map((f) => {
      const key = f.key?.trim() || slugFieldKey(f.label);
      const row = { key, label: f.label.trim(), type: f.type || 'text' };
      if (f.unit?.trim()) row.unit = f.unit.trim();
      if (f.required) row.required = true;
      if (f.placeholder?.trim()) row.placeholder = f.placeholder.trim();
      if (f.width === 'half') row.width = 'half';
      if ((f.type === 'select' || f.type === 'chip') && f.options) {
        row.options = String(f.options)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      }
      return row;
    });
  const base = { fields: out, show_compatibility: Boolean(showCompatibility) };
  return {
    ...base,
    form_layout: formLayout || defaultFormLayout(base),
  };
}

export function schemaToEditorState(schema) {
  const fields = (schema?.fields || []).map((f) => ({
    key: f.key || '',
    label: f.label || '',
    type: f.type || 'text',
    options: Array.isArray(f.options) ? f.options.join(', ') : '',
    unit: f.unit || '',
    required: Boolean(f.required),
    placeholder: f.placeholder || '',
    width: f.width === 'half' ? 'half' : 'full',
  }));
  return {
    show_compatibility: Boolean(schema?.show_compatibility),
    fields: fields.length ? fields : [{ key: '', label: '', type: 'text', options: '', unit: '', required: false, placeholder: '', width: 'full' }],
    form_layout: normalizeFormLayout(schema?.form_layout, schema),
  };
}

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

export const VALID_PRICING_MODES = ['import_cny', 'local_kzt'];
export const VALID_VEHICLE_MODES = ['compatibility', 'brand_model', 'none'];
export const VALID_ENGINE_CODE_MODES = ['none', 'required', 'required_single'];

export function isEngineCodeRequired(mode) {
  return mode === 'required' || mode === 'required_single';
}

export function isEngineCodeSingle(mode) {
  return mode === 'required_single';
}

export function resolveCategoryProfile(schema) {
  const s = schema && typeof schema === 'object' ? schema : {};

  let pm = s.pricing_mode;
  if (!VALID_PRICING_MODES.includes(pm)) pm = 'import_cny';

  let vm = s.vehicle_mode;
  if (!VALID_VEHICLE_MODES.includes(vm)) {
    vm = s.show_compatibility ? 'compatibility' : 'none';
  }

  let ecm = s.engine_code_mode;
  if (!VALID_ENGINE_CODE_MODES.includes(ecm)) ecm = 'none';

  return { pricing_mode: pm, vehicle_mode: vm, engine_code_mode: ecm };
}

/** Схема категории для формы товара (с профилем и legacy show_compatibility). */
export function resolveCategorySchemaForProduct(cat) {
  if (!cat) return null;
  const raw = cat.attribute_schema && typeof cat.attribute_schema === 'object'
    ? cat.attribute_schema
    : {};
  const profile = resolveCategoryProfile(raw);
  return {
    ...raw,
    ...profile,
    show_compatibility: profile.vehicle_mode === 'compatibility',
  };
}

/** Обновить только engine_code_mode, сохранив fields и form_layout. */
export function patchEngineCodeModeInSchema(schema, engineCodeMode) {
  const existing = schema && typeof schema === 'object' ? schema : {};
  const ecm = VALID_ENGINE_CODE_MODES.includes(engineCodeMode) ? engineCodeMode : 'none';
  const profile = resolveCategoryProfile({ ...existing, engine_code_mode: ecm });
  return {
    ...existing,
    pricing_mode: profile.pricing_mode,
    vehicle_mode: profile.vehicle_mode,
    engine_code_mode: profile.engine_code_mode,
    show_compatibility: profile.vehicle_mode === 'compatibility',
    fields: Array.isArray(existing.fields) ? existing.fields : [],
    form_layout: existing.form_layout || defaultFormLayout({
      ...existing,
      ...profile,
      show_compatibility: profile.vehicle_mode === 'compatibility',
    }),
  };
}

export function categoryTreeQueryKey(activeOnly = true) {
  return ['categories', 'tree', { activeOnly: Boolean(activeOnly) }];
}

export function mergeEngineCodeModeIntoCategoryTree(tree, updatesById) {
  if (!Array.isArray(tree) || !updatesById || typeof updatesById !== 'object') return tree;
  return tree.map((group) => ({
    ...group,
    children: (group.children || []).map((cat) => {
      const patch = updatesById[cat.id];
      if (!patch) return cat;
      return {
        ...cat,
        attribute_schema: patch.attribute_schema ?? patchEngineCodeModeInSchema(
          cat.attribute_schema,
          patch.engine_code_mode,
        ),
      };
    }),
  }));
}

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

/** Поля авто-блока (brand_model mode). */
export const VEHICLE_BUILTIN_ROWS = [
  { id: 'brand', kind: 'builtin', key: 'brand', width: 'half', label: 'Марка авто' },
  { id: 'model', kind: 'builtin', key: 'model', width: 'half', label: 'Модель авто' },
];

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
  const profile = resolveCategoryProfile(schema);
  const { vehicle_mode: vm, pricing_mode: pm } = profile;

  const layout = LOCKED_ROWS.map((x) => ({ ...x }));
  layout.push({ id: 'name', kind: 'builtin', key: 'name', width: 'full', placeholder: 'Название товара' });

  if (vm === 'compatibility') {
    layout.push({ id: 'compat', kind: 'compatibility', width: 'full', label: 'Совместим с авто' });
  } else if (vm === 'brand_model') {
    VEHICLE_BUILTIN_ROWS.forEach((r) => layout.push({ ...r }));
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

  const priceTail = pm === 'import_cny'
    ? ADDABLE_BUILTIN.filter((b) => b.id !== 'name')
    : ADDABLE_BUILTIN.filter((b) => b.id !== 'name' && b.key !== 'cny_price' && b.key !== 'delivery_block');
  priceTail.forEach((row) => layout.push({ ...row }));

  return layout;
}

/** Хвост цен/склада после артикула — всегда в форме товара. */
const STOCK_TAIL_BUILTINS = ADDABLE_BUILTIN.filter((b) => b.id !== 'name');

export function ensureLayoutStockTail(rows) {
  const out = [...(rows || [])];
  const tailKeySet = new Set(STOCK_TAIL_BUILTINS.map((r) => r.key));
  const existing = new Set(
    out.filter((r) => r.kind === 'builtin' && tailKeySet.has(r.key)).map((r) => r.key),
  );
  let skuIdx = out.findIndex((r) => r.kind === 'locked' && r.key === 'sku');
  if (skuIdx < 0) skuIdx = out.length;
  let insertAt = skuIdx + 1;
  STOCK_TAIL_BUILTINS.forEach((row) => {
    if (existing.has(row.key)) return;
    out.splice(insertAt, 0, {
      ...row,
      kind: 'builtin',
      width: row.width === 'half' ? 'half' : 'full',
      label: row.label || BUILTIN_LABELS[row.key],
    });
    insertAt += 1;
  });
  return out;
}

export function ensureLayoutCompatibility(rows, schema) {
  const { vehicle_mode: vm } = resolveCategoryProfile(schema);
  const out = [...(rows || [])];

  if (vm === 'compatibility') {
    if (!out.some((r) => r.kind === 'compatibility')) {
      const nameIdx = out.findIndex((r) => r.key === 'name');
      const at = nameIdx >= 0 ? nameIdx + 1 : Math.min(1, out.length);
      out.splice(at, 0, { id: 'compat', kind: 'compatibility', width: 'full', label: 'Совместим с авто' });
    }
  } else if (vm === 'brand_model') {
    const hasBrand = out.some((r) => r.kind === 'builtin' && r.key === 'brand');
    const hasModel = out.some((r) => r.kind === 'builtin' && r.key === 'model');
    if (!hasBrand || !hasModel) {
      const nameIdx = out.findIndex((r) => r.key === 'name');
      let at = nameIdx >= 0 ? nameIdx + 1 : Math.min(1, out.length);
      if (!hasBrand) { out.splice(at, 0, { ...VEHICLE_BUILTIN_ROWS[0] }); at += 1; }
      if (!hasModel) { out.splice(at, 0, { ...VEHICLE_BUILTIN_ROWS[1] }); }
    }
  }

  return out;
}

export function normalizeFormLayout(raw, schema = null) {
  if (!Array.isArray(raw) || !raw.length) return defaultFormLayout(schema);
  const { pricing_mode: pm } = resolveCategoryProfile(schema);
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
    // local_kzt — пропускаем ¥ и доставку
    if (pm === 'local_kzt' && kind === 'builtin' && (item.key === 'cny_price' || item.key === 'delivery_block')) return;
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
  if (!out.length) return defaultFormLayout(schema);
  return ensureLayoutStockTail(ensureLayoutCompatibility(out, schema));
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
  const base = schema && typeof schema === 'object' ? schema : {};
  const { pricing_mode: pm } = resolveCategoryProfile(base);
  const layout = expandLayoutPurchaseRows(
    ensureLayoutStockTail(normalizeFormLayout(base.form_layout, base)),
  );
  const rows = layout.filter((r) => r.kind === 'builtin' && PRICE_BUILTIN_KEYS.has(r.key));
  const have = new Set(rows.map((r) => r.key));

  const required = pm === 'import_cny'
    ? [
        { id: 'cny', kind: 'builtin', key: 'cny_price', width: 'half', label: BUILTIN_LABELS.cny_price },
        { id: 'delivery', kind: 'builtin', key: 'delivery_block', width: 'full', label: BUILTIN_LABELS.delivery_block },
        { id: 'sale', kind: 'builtin', key: 'sale_price', width: 'half', label: BUILTIN_LABELS.sale_price },
        { id: 'qty', kind: 'builtin', key: 'quantity', width: 'half', label: BUILTIN_LABELS.quantity },
      ]
    : [
        { id: 'sale', kind: 'builtin', key: 'sale_price', width: 'half', label: BUILTIN_LABELS.sale_price },
        { id: 'qty', kind: 'builtin', key: 'quantity', width: 'half', label: BUILTIN_LABELS.quantity },
      ];

  const missing = required.filter((r) => !have.has(r.key));
  // Для local_kzt фильтруем ¥/доставку из rows тоже
  const filteredRows = pm === 'local_kzt'
    ? rows.filter((r) => r.key !== 'cny_price' && r.key !== 'delivery_block')
    : rows;
  return missing.length ? [...missing, ...filteredRows] : filteredRows;
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

export function fieldsToFullSchema(fields, showCompatibility, formLayout, opts = {}) {
  const out = (fields || [])
    .filter((f) => f.label?.trim())
    .map((f) => {
      const key = f.key?.trim() || slugFieldKey(f.label);
      const row = { key, label: f.label.trim(), type: f.type || 'text' };
      if (f.unit?.trim()) row.unit = f.unit.trim();
      if (f.required) row.required = true;
      if (f.use_in_name) row.use_in_name = true;
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
  const vehicleMode = opts.vehicle_mode || (showCompatibility ? 'compatibility' : 'none');
  const pricingMode = opts.pricing_mode || 'import_cny';
  const engineCodeMode = VALID_ENGINE_CODE_MODES.includes(opts.engine_code_mode)
    ? opts.engine_code_mode
    : 'none';
  const base = {
    fields: out,
    show_compatibility: vehicleMode === 'compatibility',
    vehicle_mode: vehicleMode,
    pricing_mode: pricingMode,
    engine_code_mode: engineCodeMode,
  };
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

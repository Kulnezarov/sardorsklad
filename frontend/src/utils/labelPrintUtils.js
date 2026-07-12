/** Этикетки Xprinter 6×4 см и режимы состава. */

export const LABEL_PAPER = {
  wmm: 60,
  hmm: 40,
  label: '6×4 см',
  previewW: 300,
  previewH: 200,
};

export const LABEL_LAYOUT_MODES = {
  barcode_only: 'barcode_only',
  barcode_name: 'barcode_name',
  barcode_name_compat: 'barcode_name_compat',
};

export const LABEL_LAYOUT_OPTIONS = [
  { value: LABEL_LAYOUT_MODES.barcode_only, label: 'Только штрих-код' },
  { value: LABEL_LAYOUT_MODES.barcode_name, label: 'Код + название' },
  { value: LABEL_LAYOUT_MODES.barcode_name_compat, label: 'Код + название + авто' },
];

const STORAGE_KEY = 'label_layout';

export function readStoredLabelLayout() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw && Object.values(LABEL_LAYOUT_MODES).includes(raw)) return raw;
  return LABEL_LAYOUT_MODES.barcode_name;
}

export function storeLabelLayout(mode) {
  if (!Object.values(LABEL_LAYOUT_MODES).includes(mode)) return;
  localStorage.setItem(STORAGE_KEY, mode);
}

/** Первая марка и все её модели: «Dongfeng: AX7, CS35». */
export function labelCompatOneBrand(product) {
  const vms = product?.compatibility?.vehicle_models || [];
  if (vms.length) {
    const byBrand = new Map();
    vms.forEach((vm) => {
      const bid = vm.vehicle_brand_id;
      if (!byBrand.has(bid)) {
        byBrand.set(bid, {
          name: (vm.brand_name || '').trim(),
          models: [],
        });
      }
      const group = byBrand.get(bid);
      const modelName = (vm.name || '').trim();
      if (modelName && !group.models.includes(modelName)) {
        group.models.push(modelName);
      }
    });
    const first = [...byBrand.values()][0];
    if (first?.name && first.models.length) {
      return `${first.name}: ${first.models.join(', ')}`;
    }
    if (first?.name) return first.name;
  }

  const brand = String(product?.brand || '').trim();
  const model = String(product?.model || '').trim();
  if (brand && model) return `${brand}: ${model}`;
  return brand || model || '';
}

export function getLabelLayoutFlags(layoutMode) {
  return {
    showName: layoutMode === LABEL_LAYOUT_MODES.barcode_name
      || layoutMode === LABEL_LAYOUT_MODES.barcode_name_compat,
    showCompat: layoutMode === LABEL_LAYOUT_MODES.barcode_name_compat,
  };
}

export function normalizeLabelLayout(value) {
  if (value && Object.values(LABEL_LAYOUT_MODES).includes(value)) return value;
  return readStoredLabelLayout();
}

export function formatLabelPrice(product) {
  const price = Number(product?.sale_price ?? 0);
  if (!price || price <= 0) return '';
  return `${price.toLocaleString('ru-RU')} ₸`;
}

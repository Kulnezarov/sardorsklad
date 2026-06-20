export const FUEL_TYPE_OPTIONS = [
  { value: '', label: '— не указано —' },
  { value: 'petrol', label: 'Бензин' },
  { value: 'diesel', label: 'Дизель' },
  { value: 'hybrid', label: 'Гибрид' },
  { value: 'lpg', label: 'Газ (LPG)' },
  { value: 'electric', label: 'Электро' },
];

const FUEL_TYPE_LABELS = Object.fromEntries(
  FUEL_TYPE_OPTIONS.filter((o) => o.value).map((o) => [o.value, o.label]),
);

export function fuelTypeLabel(value) {
  if (!value) return '';
  return FUEL_TYPE_LABELS[value] || value;
}

function fmtDisplacement(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  const s = n.toFixed(2).replace(/\.?0+$/, '');
  return `${s} л`;
}

/** Краткая строка: 1.5 л · Бензин · 98 л.с. · Changan */
export function formatEngineFamilySummary(family) {
  if (!family) return null;
  if (family.summary) return family.summary;
  const parts = [];
  const disp = fmtDisplacement(family.displacement_l);
  if (disp) parts.push(disp);
  const fuel = fuelTypeLabel(family.fuel_type);
  if (fuel) parts.push(fuel);
  const power = String(family.power || '').trim();
  if (power) parts.push(power);
  const manufacturer = String(family.manufacturer || '').trim();
  if (manufacturer) parts.push(manufacturer);
  const name = String(family.name || '').trim();
  if (name && !parts.includes(name)) parts.push(name);
  const notes = String(family.notes || '').trim();
  if (notes && parts.length < 2) {
    parts.push(notes.length > 80 ? `${notes.slice(0, 80)}…` : notes);
  }
  return parts.length ? parts.join(' · ') : null;
}

export const EMPTY_ENGINE_FAMILY_DETAILS = {
  name: '',
  displacement_l: '',
  fuel_type: '',
  power: '',
  manufacturer: '',
  notes: '',
};

export function engineFamilyDetailsFromFamily(family) {
  if (!family) return { ...EMPTY_ENGINE_FAMILY_DETAILS };
  return {
    name: family.name || '',
    displacement_l: family.displacement_l != null ? String(family.displacement_l) : '',
    fuel_type: family.fuel_type || '',
    power: family.power || '',
    manufacturer: family.manufacturer || '',
    notes: family.notes || '',
  };
}

export function buildEngineFamilyPayload({ code, is_active = true, vehicle_model_ids, ...details }) {
  const payload = { code, is_active };
  if (vehicle_model_ids != null) payload.vehicle_model_ids = vehicle_model_ids;

  const name = String(details.name ?? '').trim();
  payload.name = name || null;

  const dispRaw = String(details.displacement_l ?? '').trim().replace(',', '.');
  payload.displacement_l = dispRaw || null;

  const fuel = String(details.fuel_type ?? '').trim();
  payload.fuel_type = fuel || null;

  const power = String(details.power ?? '').trim();
  payload.power = power || null;

  const manufacturer = String(details.manufacturer ?? '').trim();
  payload.manufacturer = manufacturer || null;

  const notes = String(details.notes ?? '').trim();
  payload.notes = notes || null;

  return payload;
}

export function engineFamilySearchHaystack(family) {
  return [
    family?.code,
    family?.name,
    family?.summary,
    formatEngineFamilySummary(family),
    family?.power,
    family?.manufacturer,
    family?.notes,
    fuelTypeLabel(family?.fuel_type),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

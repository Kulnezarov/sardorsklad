const STORAGE_KEY = 'skladpro:recent-compat-brands';
const MAX = 6;
const DEFAULTS = ['Dongfeng', 'Changan', 'FAW', 'Wuling'];

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'number') : [];
  } catch {
    return [];
  }
}

export function getRecentBrandIds(brands = []) {
  const recent = readAll();
  const byId = new Map((brands || []).map((b) => [b.id, b]));
  const out = [];
  recent.forEach((id) => {
    if (byId.has(id) && !out.includes(id)) out.push(id);
  });
  return out;
}

export function getSuggestedBrandIds(brands = [], recentIds = []) {
  const byName = new Map(
    (brands || []).map((b) => [String(b.name || '').trim().toLowerCase(), b.id]),
  );
  const out = [...recentIds];
  DEFAULTS.forEach((name) => {
    const id = byName.get(name.toLowerCase());
    if (id && !out.includes(id)) out.push(id);
  });
  return out.slice(0, MAX);
}

export function rememberCompatBrand(brandId) {
  if (!brandId) return;
  const prev = readAll().filter((id) => id !== brandId);
  prev.unshift(brandId);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prev.slice(0, MAX)));
  } catch {
    /* ignore */
  }
}

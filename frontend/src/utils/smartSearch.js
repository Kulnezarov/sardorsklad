/**
 * Умный поиск (клиент): нормализация, синонимы, нечёткое совпадение.
 * Для накладных и офлайн-фильтров; каталог — через API с тем же алгоритмом на сервере.
 */

const SYNONYM_GROUPS = [
  ['амортизатор', 'мартезатор', 'аморт', 'стойка', 'амортиз'],
  ['фара', 'фонарь', 'headlight', 'фары'],
  ['правая', 'прав', 'правый', 'pr', 'r', 'п', 'rh'],
  ['левая', 'лев', 'левый', 'pl', 'l', 'л', 'lh'],
  ['свеча', 'свечи', 'spark', 'свечка'],
  ['зажигания', 'зажигание', 'ignition', 'зажиг'],
  ['камри', 'camry', 'камри70', 'камри75'],
  ['тормоз', 'колодк', 'колодки', 'brake'],
  ['масло', 'oil', 'моторное'],
  ['фильтр', 'filter', 'фильтра'],
  ['подшипник', 'подшип', 'bearing'],
  ['оригинал', 'oem', 'original'],
];

const LATIN_TO_CYR = {
  a: 'а', b: 'в', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', r: 'р', t: 'т', x: 'х', y: 'у',
};

export function normalizeSearchText(value) {
  let s = String(value || '').toLowerCase().trim();
  s = s.replace(/[a-z]/g, (ch) => LATIN_TO_CYR[ch] || ch);
  return s.replace(/[^a-zа-яё0-9]/gi, '');
}

function tokenize(query) {
  return String(query || '')
    .trim()
    .toLowerCase()
    .split(/[\s,;/|+]+/)
    .filter(Boolean);
}

export function expandTermVariants(term) {
  const out = new Set([term]);
  const norm = normalizeSearchText(term);
  if (norm) out.add(norm);
  for (const group of SYNONYM_GROUPS) {
    const groupNorm = group.map((g) => normalizeSearchText(g));
    if (group.includes(term) || groupNorm.includes(norm)) {
      group.forEach((g) => out.add(g));
      groupNorm.forEach((g) => { if (g) out.add(g); });
    }
  }
  return [...out];
}

export function subsequenceMatch(needle, haystack) {
  const a = normalizeSearchText(needle);
  const b = normalizeSearchText(haystack);
  if (!a) return true;
  if (!b) return false;
  if (b.includes(a)) return true;
  let i = 0;
  for (const ch of b) {
    if (ch === a[i]) i += 1;
    if (i === a.length) return true;
  }
  return false;
}

function charSimilarity(a, b) {
  if (!a.length || !b.length) return 0;
  const maxLen = Math.max(a.length, b.length);
  let matches = 0;
  const used = new Set();
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (used.has(j)) continue;
      if (a[i] === b[j]) {
        matches++;
        used.add(j);
        break;
      }
    }
  }
  return matches / maxLen;
}

export function fuzzyScore(needle, haystack) {
  const a = normalizeSearchText(needle);
  const b = normalizeSearchText(haystack);
  if (!a) return 1;
  if (!b) return 0;
  if (b.includes(a)) return 1;
  if (subsequenceMatch(a, b)) {
    const ratio = a.length / Math.max(b.length, 1);
    return Math.max(0.72, Math.min(0.95, 0.75 + ratio * 0.2));
  }
  return charSimilarity(a, b);
}

export function scoreQueryAgainstHaystack(query, haystack) {
  const tokens = tokenize(query);
  if (!tokens.length) return 1;
  const scores = tokens.map((t) => fuzzyScore(t, haystack));
  return scores.reduce((s, x) => s + x, 0) / scores.length;
}

const FUZZY_MIN = 0.52;

/** Строка совпадает с запросом (подстрока, синонимы или опечатка). */
export function matchesSmartSearch(haystack, query, { minScore = FUZZY_MIN } = {}) {
  const q = String(query || '').trim();
  if (!q) return true;
  const hay = String(haystack || '');
  const qNorm = normalizeSearchText(q);
  const hayNorm = normalizeSearchText(hay);
  if (qNorm && hayNorm.includes(qNorm)) return true;
  for (const token of tokenize(q)) {
    for (const variant of expandTermVariants(token)) {
      if (hay.toLowerCase().includes(variant)) return true;
      if (normalizeSearchText(hay).includes(normalizeSearchText(variant))) return true;
    }
  }
  return scoreQueryAgainstHaystack(q, hay) >= minScore;
}

export function productHaystack(product) {
  const p = product || {};
  return [
    p.name, p.sku, p.barcode, p.brand, p.model, p.category, p.description, p.supplier,
  ]
    .filter(Boolean)
    .join(' ');
}

export function productMatchesSearch(product, query, options) {
  return matchesSmartSearch(productHaystack(product), query, options);
}

export function intakeLineHaystack(line) {
  const l = line || {};
  return [
    l.name, l.barcode, l.sku, l.brand, l.model, l.category, l.manufacturer, l.extra_info,
  ]
    .filter(Boolean)
    .join(' ');
}

export function intakeLineMatchesSearch(line, query, options) {
  return matchesSmartSearch(intakeLineHaystack(line), query, options);
}

export function rankBySmartSearch(items, query, haystackFn, { limit } = {}) {
  const q = String(query || '').trim();
  if (!q) return items;
  const scored = items
    .map((item) => ({ item, score: scoreQueryAgainstHaystack(q, haystackFn(item)) }))
    .filter((x) => x.score >= FUZZY_MIN)
    .sort((a, b) => b.score - a.score);
  const list = scored.map((x) => x.item);
  return limit ? list.slice(0, limit) : list;
}

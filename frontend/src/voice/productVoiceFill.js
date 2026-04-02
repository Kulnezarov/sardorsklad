/**
 * Web Speech API helpers + rule-based Russian slot parsing for product form.
 */

export function getSpeechRecognitionConstructor() {
  if (typeof window === 'undefined') return null;
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

export function isSpeechRecognitionSupported() {
  return Boolean(getSpeechRecognitionConstructor());
}

/** Phrases that mean "open add product" (normalized, no punctuation). */
const ADD_PRODUCT_PATTERNS = [
  /добавить\s+товар/,
  /новый\s+товар/,
  /создать\s+товар/,
  /добавь\s+товар/,
];

export function isAddProductCommand(text) {
  if (!text || typeof text !== 'string') return false;
  const n = text.toLowerCase().replace(/[.,!?;:«»""]/g, ' ').replace(/\s+/g, ' ').trim();
  return ADD_PRODUCT_PATTERNS.some((re) => re.test(n));
}

const TYPO_MAP = {
  'каличевство': 'количество', 'каличество': 'количество', 'колличество': 'количество',
  'каличесво': 'количество', 'колличесво': 'количество', 'колличевство': 'количество',
  'колчество': 'количество', 'количесво': 'количество',
  'стоимость': 'продажа', 'цена': 'продажа', 'ценна': 'продажа', 'прайс': 'продажа',
  'названия': 'название', 'наименование': 'название', 'имя': 'название',
  'категории': 'категория', 'катигория': 'категория', 'катигории': 'категория',
  'бренд': 'марка', 'брэнд': 'марка', 'производитель': 'марка',
  'кол-во': 'количество', 'остаток': 'количество', 'штук': 'количество',
};

function normalizeTypos(text) {
  let result = text;
  for (const [typo, correct] of Object.entries(TYPO_MAP)) {
    result = result.replace(new RegExp('\\b' + typo + '\\b', 'gi'), correct);
  }
  return result;
}

const RUSSIAN_NUMBERS = {
  'ноль': 0, 'один': 1, 'одна': 1, 'одно': 1, 'два': 2, 'две': 2, 'три': 3,
  'четыре': 4, 'пять': 5, 'шесть': 6, 'семь': 7, 'восемь': 8, 'девять': 9,
  'десять': 10, 'одиннадцать': 11, 'двенадцать': 12, 'тринадцать': 13,
  'четырнадцать': 14, 'пятнадцать': 15, 'шестнадцать': 16, 'семнадцать': 17,
  'восемнадцать': 18, 'девятнадцать': 19, 'двадцать': 20, 'тридцать': 30,
  'сорок': 40, 'пятьдесят': 50, 'шестьдесят': 60, 'семьдесят': 70,
  'восемьдесят': 80, 'девяносто': 90, 'сто': 100, 'двести': 200, 'триста': 300,
  'четыреста': 400, 'пятьсот': 500, 'шестьсот': 600, 'семьсот': 700,
  'восемьсот': 800, 'девятьсот': 900, 'тысяча': 1000, 'тысячи': 1000, 'тысяч': 1000,
};

function parseRussianNumber(text) {
  const t = text.trim().toLowerCase();
  if (RUSSIAN_NUMBERS[t] !== undefined) return RUSSIAN_NUMBERS[t];
  return null;
}

function parseNumberLoose(raw) {
  if (raw == null) return null;
  const s = String(raw).replace(/\s/g, '').replace(',', '.');
  const m = s.match(/(\d+(?:\.\d+)?)/);
  if (!m) {
    const wordNum = parseRussianNumber(String(raw).trim());
    if (wordNum !== null) return wordNum;
    return null;
  }
  const v = parseFloat(m[1]);
  return Number.isFinite(v) ? v : null;
}

/**
 * Extract slots from a single Russian utterance.
 * Handles full multi-field phrases like:
 * "название тормоза категория тормоз марка чанган количество 10 стоимость 2000"
 * @returns {Partial<{ name, category, brand, cny_price, delivery_cost_kzt, sale_price, quantity }>}
 */
export function parseProductSlots(text) {
  if (!text || typeof text !== 'string') return {};
  const normalized = normalizeTypos(text.toLowerCase().replace(/[.,!?;:«»""]/g, ' ').replace(/\s+/g, ' ').trim());
  const out = {};

  const markers = [
    { re: /\bназвание\b/i, field: 'name' },
    { re: /\bкатегори[яи]\b/i, field: 'category' },
    { re: /\bмарка\b/i, field: 'brand' },
    { re: /\bколичеств[оа]\b/i, field: 'quantity' },
    { re: /\bдоставк[аи]\b/i, field: 'delivery_cost_kzt' },
    { re: /\bпродаж[аи]\b/i, field: 'sale_price' },
    { re: /\bсебестоимость\b|\bв\s+юан/i, field: '_cny_ctx' },
    { re: /\bюан/i, field: '_cny_ctx' },
    { re: /\bместо\b|\bячейк[аи]\b/i, field: 'storage_location' },
    { re: /\bпоставщик\b/i, field: 'supplier' },
  ];

  const positions = [];
  for (const { re, field } of markers) {
    const globalRe = new RegExp(re.source, 'gi');
    let match;
    while ((match = globalRe.exec(normalized)) !== null) {
      const alreadyTaken = positions.some(
        (p) => match.index >= p.start && match.index < p.end
      );
      if (!alreadyTaken) {
        positions.push({ field, start: match.index, end: match.index + match[0].length });
        break;
      }
    }
  }
  positions.sort((a, b) => a.start - b.start);

  for (let i = 0; i < positions.length; i++) {
    const cur = positions[i];
    const next = positions[i + 1];
    const slice = normalized.slice(cur.end, next ? next.start : undefined).trim();
    if (!slice) continue;

    if (cur.field === '_cny_ctx') {
      const n = parseNumberLoose(slice);
      if (n != null) out.cny_price = n;
      continue;
    }
    if (cur.field === 'quantity') {
      const n = parseNumberLoose(slice);
      if (n != null) out.quantity = Math.round(n);
      continue;
    }
    if (cur.field === 'delivery_cost_kzt' || cur.field === 'sale_price') {
      const n = parseNumberLoose(slice);
      if (n != null) out[cur.field] = n;
      continue;
    }
    if (cur.field === 'storage_location') {
      out.storage_location = slice.toUpperCase();
      continue;
    }
    const words = slice.replace(/\d+[\d\s.,]*/g, ' ').replace(/\s+/g, ' ').trim();
    if (words) out[cur.field] = words;
  }

  // Fallback: number + юань / тг / шт without explicit marker
  const cnyM = normalized.match(/(\d[\d\s.,]*)\s*юан/);
  if (cnyM && out.cny_price == null) {
    const n = parseNumberLoose(cnyM[1]);
    if (n != null) out.cny_price = n;
  }
  const delM = normalized.match(/доставк[аи]\s+(\d[\d\s.,]*)\s*(?:тг|тенге|т\.?\s*г\.?)/);
  if (delM && out.delivery_cost_kzt == null) {
    const n = parseNumberLoose(delM[1]);
    if (n != null) out.delivery_cost_kzt = n;
  }
  const saleM = normalized.match(/продаж[аи]\s+(\d[\d\s.,]*)\s*(?:тг|тенге|т\.?\s*г\.?)/);
  if (saleM && out.sale_price == null) {
    const n = parseNumberLoose(saleM[1]);
    if (n != null) out.sale_price = n;
  }
  const qtyM = normalized.match(/(\d[\d\s.,]*)\s*(?:шт|штук|штуки)/);
  if (qtyM && out.quantity == null) {
    const n = parseNumberLoose(qtyM[1]);
    if (n != null) out.quantity = Math.round(n);
  }

  return out;
}

/** Stop listening / cancel dictation (Russian). */
export function isVoiceStopCommand(text) {
  if (!text || typeof text !== 'string') return false;
  const n = text.toLowerCase().replace(/[.,!?;:«»""]/g, ' ').replace(/\s+/g, ' ').trim();
  return /^(отмена|стоп|хватит|закрой|закрыть|выключи\s+микрофон|без\s+микрофона)\b/.test(n);
}

export function isVoiceSaveCommand(text) {
  if (!text || typeof text !== 'string') return false;
  const n = text.toLowerCase().replace(/[.,!?;:«»""]/g, ' ').replace(/\s+/g, ' ').trim();
  return /^сохранить(\s+товар)?\b/.test(n);
}

/**
 * One phrase → one or more field updates.
 * Tries multi-field extraction first (e.g. "название тормоза категория тормоз марка чанган количество 10 стоимость 2000").
 * Falls back to single-field patterns for short commands.
 * @returns {{ updates?: object, command?: 'stop'|'save' }}
 */
export function parseVoiceSmart(text) {
  if (!text || typeof text !== 'string') return {};
  const raw = text.trim();
  if (isVoiceStopCommand(raw)) return { command: 'stop' };
  if (isVoiceSaveCommand(raw)) return { command: 'save' };

  const normalizedRaw = normalizeTypos(raw);

  // Try multi-field extraction first — this handles full phrases
  const bulk = parseProductSlots(normalizedRaw);
  if (Object.keys(bulk).length >= 2) return { updates: bulk };

  // Single-field patterns for short commands
  const tryPatterns = [
    { re: /^название\s+(.+)/i, field: 'name', map: (m) => m[1].trim() },
    { re: /^называется\s+(.+)/i, field: 'name', map: (m) => m[1].trim() },
    { re: /^марка\s+(.+)/i, field: 'brand', map: (m) => m[1].trim() },
    { re: /^категори[яи]\s+(.+)/i, field: 'category', map: (m) => m[1].trim() },
    { re: /^место\s+(.+)/i, field: 'storage_location', map: (m) => m[1].trim().toUpperCase() },
    { re: /^ячейк[аи]\s+(.+)/i, field: 'storage_location', map: (m) => m[1].trim().toUpperCase() },
    { re: /^поставщик\s+(.+)/i, field: 'supplier', map: (m) => m[1].trim() },
    { re: /^закуп\s+(.+)/i, field: 'cny_price', map: (m) => parseNumberLoose(m[1]) },
    { re: /^в\s+юан[ях]?\s+(.+)/i, field: 'cny_price', map: (m) => parseNumberLoose(m[1]) },
    { re: /^доставк[аи]\s+(.+)/i, field: 'delivery_cost_kzt', map: (m) => parseNumberLoose(m[1]) },
    { re: /^продаж[аи]\s+(.+)/i, field: 'sale_price', map: (m) => parseNumberLoose(m[1]) },
    { re: /^(?:стоимость|цена)\s+(.+)/i, field: 'sale_price', map: (m) => parseNumberLoose(m[1]) },
    { re: /^количеств[оа]\s+(.+)/i, field: 'quantity', map: (m) => Math.round(parseNumberLoose(m[1]) || 0) },
  ];

  for (const { re, field, map } of tryPatterns) {
    const m = normalizedRaw.match(re);
    if (m) {
      const val = map(m);
      if (val === null || val === undefined || val === '') continue;
      if (field === 'quantity' && (!Number.isFinite(val) || val < 0)) continue;
      if (['cny_price', 'delivery_cost_kzt', 'sale_price'].includes(field)) {
        if (val == null || !Number.isFinite(val)) continue;
        return { updates: { [field]: String(val) } };
      }
      return { updates: { [field]: val } };
    }
  }

  // Single-field bulk extraction if only 1 slot found
  if (Object.keys(bulk).length) return { updates: bulk };
  return {};
}

/**
 * @param {object} options
 * @param {(text: string) => void} options.onResult — final transcript
 * @param {(text: string) => void} [options.onInterim]
 * @param {(err: string) => void} [options.onError]
 */
export function startListening({ onResult, onInterim, onError, continuous = false, lang = 'ru-RU' }) {
  const Ctor = getSpeechRecognitionConstructor();
  if (!Ctor) {
    onError?.('Распознавание речи не поддерживается в этом браузере');
    return { stop: () => {}, abort: () => {} };
  }

  const rec = new Ctor();
  rec.lang = lang;
  rec.interimResults = Boolean(onInterim);
  rec.continuous = continuous;
  rec.maxAlternatives = 1;

  rec.onerror = (ev) => {
    onError?.(ev.error || 'Ошибка микрофона');
  };

  rec.onresult = (ev) => {
    let finalText = '';
    let interimText = '';
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      const r = ev.results[i];
      const t = r[0]?.transcript || '';
      if (r.isFinal) finalText += t;
      else interimText += t;
    }
    if (interimText && onInterim) onInterim(interimText);
    if (finalText.trim() && onResult) onResult(finalText.trim());
  };

  try {
    rec.start();
  } catch (e) {
    onError?.(e?.message || 'Не удалось запустить распознавание');
  }

  return {
    stop: () => {
      try {
        rec.stop();
      } catch (_) {}
    },
    abort: () => {
      try {
        rec.abort();
      } catch (_) {}
    },
  };
}

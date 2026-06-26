/** Слияние строк накладной — зеркало backend/services/intake_line_merge.py */

function lineKey(line) {
  const lid = String(line?.local_id || '').trim();
  if (lid) return lid;
  return String(line?.barcode || '').trim();
}

function unionStrList(...sources) {
  const out = [];
  const seen = new Set();
  for (const source of sources) {
    if (!Array.isArray(source)) continue;
    for (const item of source) {
      const s = String(item || '').trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function isEmpty(value) {
  if (value == null) return true;
  if (typeof value === 'string') return !value.trim();
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return Object.keys(value).length === 0;
  }
  return false;
}

export function mergeIntakeLine(existing, incoming) {
  const base = existing && typeof existing === 'object' ? { ...existing } : {};
  const inc = incoming && typeof incoming === 'object' ? incoming : {};
  const out = { ...base, ...inc };

  out.warehouse_image_urls = unionStrList(
    base.warehouse_image_urls,
    inc.warehouse_image_urls,
  );
  out.intake_photo_data = unionStrList(
    base.intake_photo_data,
    inc.intake_photo_data,
  );

  if (base.warehouse_synced === true && inc.warehouse_synced !== true) {
    if (!('warehouse_synced' in inc) || inc.warehouse_synced == null) {
      out.warehouse_synced = true;
    }
  }

  if (isEmpty(inc.product_id) && !isEmpty(base.product_id)) {
    out.product_id = base.product_id;
  }

  return out;
}

export function mergeIntakeLines(existingLines, incomingLines) {
  const existing = Array.isArray(existingLines) ? existingLines : [];
  const incoming = Array.isArray(incomingLines) ? incomingLines : [];

  const byKey = new Map();
  for (const raw of existing) {
    if (!raw || typeof raw !== 'object') continue;
    const key = lineKey(raw);
    if (key) byKey.set(key, raw);
  }

  const merged = [];
  for (const raw of incoming) {
    if (!raw || typeof raw !== 'object') continue;
    const key = lineKey(raw);
    if (!key) {
      merged.push(raw);
      continue;
    }
    merged.push(mergeIntakeLine(byKey.get(key), raw));
  }
  return merged;
}

export function mergeInvoiceLinesWithServer(serverInvoice, clientLines) {
  const serverLines = Array.isArray(serverInvoice?.lines) ? serverInvoice.lines : [];
  return mergeIntakeLines(serverLines, clientLines);
}

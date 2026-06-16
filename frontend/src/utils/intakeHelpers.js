import apiClient, { productApi, getApiErrorMessage, resolveUploadedAssetUrl } from '../api/client';
import { generateEAN13 } from './barcodeGen';
import { productGalleryFromApi, uploadPendingPhotosForLine, MAX_INTAKE_PHOTOS } from './intakePhotoUtils';

export { MAX_INTAKE_PHOTOS, productGalleryFromApi };

export const num = (v) => {
  const n = parseFloat(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

export const roundMoney2 = (v) => Math.round(v * 100) / 100;
export const roundWeight2 = (v) => Math.round(v * 100) / 100;
export const roundKg3 = (v) => Math.round(v * 1000) / 1000;

export function invoiceDateLabel() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${dd}.${mm}.${d.getFullYear()}`;
}

export function newClientId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `inv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function normalizeIntakeLine(line, cnyRate = 65) {
  const l = { ...line };
  if (l.sku != null && String(l.sku).trim() === '') l.sku = null;
  l.purchase_kzt = computeLinePurchase(l.cny_price, l.delivery_kzt, cnyRate);
  return l;
}

export function computeLinePurchase(cny, deliveryKzt, cnyRate) {
  const c = num(cny);
  const d = num(deliveryKzt);
  if (c <= 0 && d <= 0) return 0;
  return roundMoney2(c * num(cnyRate) + d);
}

export function intakeLineQty(line) {
  const qty = parseInt(line?.quantity, 10);
  return Number.isFinite(qty) && qty > 0 ? qty : 0;
}

/** Суммы по строке: цена за 1 шт × количество (без кол-ва в итог не входят). */
export function lineMoneyTotals(line) {
  const qty = intakeLineQty(line);
  const unitPurchase = num(line?.purchase_kzt);
  const unitSale = num(line?.sale_price);
  return {
    qty,
    unitPurchase,
    unitSale,
    purchaseTotal: qty > 0 ? roundMoney2(unitPurchase * qty) : 0,
    saleTotal: qty > 0 ? roundMoney2(unitSale * qty) : 0,
  };
}

export function isLineWarehouseSynced(line) {
  return line?.warehouse_synced === true;
}

export function isLineWarehouseReady(line) {
  if (isLineWarehouseSynced(line)) return true;
  const name = (line.name || '').trim();
  const qty = intakeLineQty(line);
  const sale = num(line.sale_price);
  const categoryOk = Boolean(line.category_id);
  const catalogOk = !line.needs_catalog_update || line.catalog_updated;
  return Boolean(name && qty > 0 && sale > 0 && categoryOk && catalogOk);
}

/** Можно ли загрузить накладную на склад (все позиции готовы, ничего не загружено ранее). */
export function canUploadInvoiceToWarehouse(lines, { uploaded = false } = {}) {
  if (uploaded) {
    return { ok: false, message: 'Накладная уже на складе — сначала отмените загрузку' };
  }
  if (!lines.length) {
    return { ok: false, message: 'Накладная пуста' };
  }
  if (lines.some(isLineWarehouseSynced)) {
    return { ok: false, message: 'Часть позиций уже на складе — нажмите «Отменить загрузку»' };
  }
  const notReady = lines.filter((l) => !isLineWarehouseReady(l)).length;
  if (notReady > 0) {
    return {
      ok: false,
      message: `Не все позиции готовы к складу (${notReady} из ${lines.length})`,
    };
  }
  return { ok: true };
}

/** Накладная была загружена (полностью или частично) — можно отменить. */
export function canRevertInvoiceWarehouse(invoice, lines) {
  if (!invoice) return false;
  if (invoice.uploaded === true) return true;
  if (invoice.pending_warehouse_upload === true) return true;
  return lines.some(isLineWarehouseSynced);
}

export function computeInvoiceSummary(lines) {
  let purchaseKzt = 0;
  let saleKzt = 0;
  let notReady = 0;
  let synced = 0;
  for (const l of lines) {
    const t = lineMoneyTotals(l);
    purchaseKzt += t.purchaseTotal;
    saleKzt += t.saleTotal;
    if (isLineWarehouseSynced(l)) synced += 1;
    else if (!isLineWarehouseReady(l)) notReady += 1;
  }
  return {
    positions: lines.length,
    purchaseKzt: roundMoney2(purchaseKzt),
    saleKzt: roundMoney2(saleKzt),
    notReadyCount: notReady,
    syncedCount: synced,
  };
}

export function lineToProductForPrint(line) {
  return {
    name: line.name || 'Товар',
    barcode: line.barcode || '',
    sku: line.sku || '',
    brand: line.brand || '',
  };
}

/** Источники превью: сохранённые URL, data URL с сайта, подгрузка со склада. */
export function getLineImageSources(line, productUrls) {
  if (productUrls?.length) return productUrls;
  const wh = Array.isArray(line?.warehouse_image_urls)
    ? line.warehouse_image_urls.map((u) => String(u || '').trim()).filter(Boolean)
    : [];
  if (wh.length) return wh;
  const pending = Array.isArray(line?.intake_photo_data)
    ? line.intake_photo_data.filter((u) => String(u || '').startsWith('data:'))
    : [];
  if (pending.length) return pending;
  return [];
}

export function getLineThumbSrc(line, productUrls) {
  const first = getLineImageSources(line, productUrls)[0];
  if (!first) return '';
  if (String(first).startsWith('data:')) return first;
  return resolveUploadedAssetUrl(first);
}

/** Подтянуть фото со склада для строк без превью (накладная с телефона). */
export async function fetchLinePhotoUrlsByBarcode(lines) {
  const map = {};
  const cache = {};
  for (const line of lines) {
    if (getLineImageSources(line).length) continue;
    const bc = String(line.barcode || '').trim();
    if (bc.length < 4) continue;
    const key = line.local_id || bc;
    if (cache[bc]) {
      map[key] = cache[bc];
      continue;
    }
    try {
      const res = await productApi.getByBarcode(bc, { allow404: true });
      if (res.status === 200 && res.data) {
        const urls = productGalleryFromApi(res.data);
        if (urls.length) {
          cache[bc] = urls;
          map[key] = urls;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return map;
}

export async function fetchCnyHistory(barcode) {
  const code = String(barcode || '').trim();
  if (code.length < 4) return [];
  try {
    const r = await apiClient.get(`/api/v1/products/cny-history/${encodeURIComponent(code)}`);
    return Array.isArray(r.data) ? r.data : [];
  } catch {
    return [];
  }
}

export async function addCnyHistory({ barcode, cny, deliveryKzt, productId }) {
  const code = String(barcode || '').trim();
  if (!code || num(cny) <= 0) return;
  await apiClient.post('/api/v1/products/cny-history', {
    barcode: code,
    cny_price: roundMoney2(num(cny)),
    ...(num(deliveryKzt) > 0 ? { delivery_cost_kzt: roundMoney2(num(deliveryKzt)) } : {}),
    ...(productId != null ? { product_id: productId } : {}),
  });
}

/** Загрузка позиций накладной на склад — только если все строки готовы. */
export async function uploadInvoiceLinesToWarehouse(lines, cnyRate) {
  const check = canUploadInvoiceToWarehouse(lines);
  if (!check.ok) {
    throw new Error(check.message);
  }

  const report = { created: 0, updated: 0, photosUploaded: 0, errors: [] };
  const updatedLines = [];
  for (const raw of lines) {
    const l = raw;
    const name = (l.name || '').trim();
    try {
      const barcode = String(l.barcode || '').trim();
      const body = {
        name,
        barcode: barcode || null,
        sku: l.sku || null,
        brand: l.brand || null,
        model: l.model || null,
        category: l.category || null,
        category_id: l.category_id || null,
        attributes: l.attributes && typeof l.attributes === 'object' ? l.attributes : null,
        ...(Array.isArray(l.compatibility_vehicle_model_ids) && l.compatibility_vehicle_model_ids.length
          ? { compatibility_vehicle_model_ids: l.compatibility_vehicle_model_ids }
          : {}),
        supplier: l.manufacturer || null,
        description: l.extra_info || null,
        cny_price: num(l.cny_price) > 0 ? roundMoney2(num(l.cny_price)) : null,
        delivery_weight_kg: num(l.delivery_kg) > 0 ? roundWeight2(num(l.delivery_kg)) : null,
        delivery_cost_kzt: num(l.delivery_kzt) > 0 ? roundMoney2(num(l.delivery_kzt)) : null,
      };
      const sale = roundMoney2(num(l.sale_price));
      if (sale > 0) body.sale_price = sale;
      const purchase = roundMoney2(num(l.purchase_kzt));
      if (purchase > 0) body.purchase_price = purchase;

      let existing = null;
      if (barcode) {
        const res = await productApi.getByBarcode(barcode, { allow404: true });
        if (res.status === 200 && res.data) existing = res.data;
      }

      let product;
      if (existing) {
        const addQty = parseInt(l.quantity, 10) || 0;
        if (addQty > 0) {
          const oldQty = parseInt(existing.quantity, 10) || 0;
          body.quantity = oldQty + addQty;
        }
        const r = await productApi.update(existing.id, body);
        product = r.data;
        report.updated += 1;
      } else {
        body.quantity = parseInt(l.quantity, 10) || 1;
        const r = await productApi.create(body);
        product = r.data;
        report.created += 1;
      }

      if (num(l.cny_price) > 0 && barcode) {
        await addCnyHistory({
          barcode,
          cny: l.cny_price,
          deliveryKzt: l.delivery_kzt,
          productId: product?.id,
        });
      }

      let nextLine = { ...l, warehouse_synced: true };
      const productId = product?.id;
      if (productId) {
        try {
          const photoResult = await uploadPendingPhotosForLine(l, productId);
          if (photoResult.error) {
            report.errors.push(`${name}: ${photoResult.error}`);
          } else if (photoResult.uploaded > 0) {
            report.photosUploaded += photoResult.uploaded;
            nextLine = {
              ...nextLine,
              warehouse_image_urls: photoResult.urls,
            };
            delete nextLine.intake_photo_data;
          } else if (photoResult.urls?.length && !nextLine.warehouse_image_urls?.length) {
            nextLine = { ...nextLine, warehouse_image_urls: photoResult.urls };
          }
        } catch (e) {
          report.errors.push(`${name} (фото): ${getApiErrorMessage(e)}`);
        }
      }
      updatedLines.push(nextLine);
    } catch (e) {
      report.errors.push(`${name}: ${getApiErrorMessage(e)}`);
      updatedLines.push(l);
    }
  }
  return { ...report, lines: updatedLines };
}

export function newIntakeLineId() {
  return `line_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/** Строка накладной из товара склада (без количества). */
export function warehouseProductToIntakeLine(p) {
  const gallery = productGalleryFromApi(p);
  const cny = num(p.cny_price);
  const delKzt = num(p.delivery_cost_kzt);
  const delKg = num(p.delivery_weight_kg);
  const purchase = num(p.purchase_price);
  const sale = num(p.sale_price);
  return {
    local_id: newIntakeLineId(),
    barcode: String(p.barcode || '').trim() || null,
    sku: p.sku ? String(p.sku).trim() : null,
    name: String(p.name || '').trim(),
    brand: p.brand ? String(p.brand).trim() : null,
    model: p.model ? String(p.model).trim() : null,
    category: p.category ? String(p.category).trim() : null,
    category_id: p.category_id || null,
    category_group_id: null,
    attributes: p.attributes && typeof p.attributes === 'object' ? { ...p.attributes } : {},
    manufacturer: p.supplier ? String(p.supplier).trim() : null,
    extra_info: p.description ? String(p.description).trim() : null,
    cny_price: cny > 0 ? roundMoney2(cny) : null,
    delivery_kg: delKg > 0 ? roundWeight2(delKg) : null,
    delivery_kzt: delKzt > 0 ? roundMoney2(delKzt) : null,
    purchase_kzt: purchase > 0 ? roundMoney2(purchase) : null,
    sale_price: sale > 0 ? roundMoney2(sale) : null,
    quantity: null,
    ...(gallery.length ? { warehouse_image_urls: gallery } : {}),
  };
}

export { intakeLineMatchesSearch, productMatchesSearch, matchesSmartSearch } from './smartSearch';

export function copyIntakeLine(src) {
  const copy = { ...src };
  copy.local_id = `line_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  copy.barcode = generateEAN13();
  copy.sku = null;
  delete copy.local_photo_paths;
  delete copy.warehouse_image_urls;
  delete copy.intake_photo_data;
  delete copy.warehouse_synced;
  // category_id, attributes, category_group_id сохраняются — как в мобильном _copyLine
  return copy;
}

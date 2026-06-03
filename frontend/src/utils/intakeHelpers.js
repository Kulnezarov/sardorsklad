import apiClient, { productApi, getApiErrorMessage } from '../api/client';
import { generateEAN13 } from './barcodeGen';

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

export function computeInvoiceSummary(lines) {
  let purchaseKzt = 0;
  let saleKzt = 0;
  let notReady = 0;
  for (const l of lines) {
    purchaseKzt += num(l.purchase_kzt);
    saleKzt += num(l.sale_price);
    const qty = parseInt(l.quantity, 10) || 0;
    const sale = num(l.sale_price);
    const name = (l.name || '').trim();
    if (!name || qty <= 0 || sale <= 0) notReady += 1;
  }
  return {
    positions: lines.length,
    purchaseKzt: roundMoney2(purchaseKzt),
    saleKzt: roundMoney2(saleKzt),
    notReadyCount: notReady,
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

/** Загрузка позиций накладной на склад (как в мобильном приложении). */
export async function uploadInvoiceLinesToWarehouse(lines, cnyRate) {
  const report = { created: 0, updated: 0, errors: [] };
  for (const raw of lines) {
    const l = raw;
    const name = (l.name || '').trim();
    if (!name) {
      report.errors.push('Пустое название позиции');
      continue;
    }
    try {
      const barcode = String(l.barcode || '').trim();
      const body = {
        name,
        barcode: barcode || null,
        sku: l.sku || null,
        brand: l.brand || null,
        model: l.model || null,
        category: l.category || null,
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
    } catch (e) {
      report.errors.push(`${name}: ${getApiErrorMessage(e)}`);
    }
  }
  return report;
}

export function copyIntakeLine(src) {
  const copy = { ...src };
  copy.local_id = `line_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  copy.barcode = generateEAN13();
  copy.sku = null;
  delete copy.local_photo_paths;
  delete copy.warehouse_image_urls;
  return copy;
}

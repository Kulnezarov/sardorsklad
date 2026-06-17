import { findGroupIdForCategory } from '../components/CategoryPicker';
import { productGalleryFromApi } from './intakePhotoUtils';
import { generateEAN13 } from './barcodeGen';

export function formatProductId(id) {
  if (id == null || id === '') return '';
  return `ID-${String(id).padStart(7, '0')}`;
}

function vehicleCompatIds(product) {
  if (product.compatibility?.vehicle_models?.length) {
    return product.compatibility.vehicle_models.map((m) => m.id);
  }
  if (Array.isArray(product.compatibility_vehicle_model_ids)) {
    return product.compatibility_vehicle_model_ids;
  }
  return [];
}

function engineCompatIds(product) {
  if (product.compatibility?.engine_families?.length) {
    return product.compatibility.engine_families.map((x) => x.id);
  }
  if (Array.isArray(product.compatibility_engine_family_ids)) {
    return product.compatibility_engine_family_ids;
  }
  return [];
}

/**
 * Подставить данные существующего товара в форму каталога (новый товар).
 * Артикул сохраняем введённый; штрих-код — новый; остаток склада не копируем.
 */
export function applyCatalogProductTemplate(baseForm, product, categoryTree, { keepSku } = {}) {
  const gallery = productGalleryFromApi(product);
  const sku = keepSku ?? (String(baseForm.sku || '').trim() || product.sku || '');
  const barcode = String(baseForm.barcode || '').trim() || generateEAN13();

  return {
    ...baseForm,
    id: null,
    name: product.name || '',
    sku,
    barcode,
    brand: product.brand || '',
    model: product.model || '',
    category: product.category || '',
    category_id: product.category_id || null,
    category_group_id: findGroupIdForCategory(categoryTree, product.category_id),
    attributes: product.attributes && typeof product.attributes === 'object' ? { ...product.attributes } : {},
    purchase_price: product.purchase_price != null ? Number(product.purchase_price) : 0,
    sale_price: product.sale_price != null ? Number(product.sale_price) : 0,
    cny_price: product.cny_price != null ? String(product.cny_price) : '',
    delivery_cost_kzt: product.delivery_cost_kzt != null ? String(product.delivery_cost_kzt) : '',
    delivery_weight_kg: product.delivery_weight_kg != null ? String(product.delivery_weight_kg) : '',
    quantity: baseForm.quantity ?? 0,
    min_quantity: product.min_quantity != null ? product.min_quantity : 0,
    description: product.description || '',
    supplier: product.supplier || '',
    storage_location: product.location_zone || '',
    image_urls: gallery,
    image_url: gallery[0] || '',
    engine_code_id: product.engine_code?.id || null,
    compatibility_vehicle_model_ids: vehicleCompatIds(product),
    compatibility_engine_family_ids: engineCompatIds(product),
    show_on_storefront: product.show_on_storefront !== false,
  };
}

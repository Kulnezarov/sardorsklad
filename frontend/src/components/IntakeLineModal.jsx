import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  FiTag,
  FiPrinter,
  FiImage,
  FiX,
  FiRefreshCw,
  FiCamera,
  FiStar,
  FiCheckCircle,
} from 'react-icons/fi';
import { Button, Modal, TextArea } from './ui';
import LabelPrint from './LabelPrint';
import { readStoredLabelLayout } from '../utils/labelPrintUtils';
import CameraBarcodeScanner from './CameraBarcodeScanner';
import { productApi, categoryApi, compatibilityApi, resolveUploadedAssetUrl } from '../api/client';
import CategoryPicker, { findGroupIdForCategory, findCategoryInTree } from './CategoryPicker';
import { resolveCategoryProfile } from '../utils/formLayoutUtils';
import ProductFormByLayout from './ProductFormByLayout';
import VehicleCompatibilityPicker from './VehicleCompatibilityPicker';
import { syncPrimaryVehicleFromSelection } from '../utils/productDisplayUtils';

const EMPTY_COMPAT_IDS = Object.freeze([]);
import { generateEAN13 } from '../utils/barcodeGen';
import {
  addCnyHistory,
  computeLinePurchase,
  fetchCnyHistory,
  lineToProductForPrint,
  newIntakeLineId,
  MAX_INTAKE_PHOTOS,
  num,
  productGalleryFromApi,
  roundKg3,
  roundMoney2,
  roundWeight2,
} from '../utils/intakeHelpers';
import { compressImageFile } from '../utils/intakePhotoUtils';

const DELIVERY_MODES = [
  { key: 'custom', label: 'Своя цена', sub: () => '₸/кг' },
  { key: 'normal', label: 'Обычная', sub: (rate) => `${rate.toLocaleString('ru-RU')} ₸/кг` },
  { key: 'express', label: 'Экспресс', sub: () => '2 000 ₸/кг' },
];

function capitalizeWords(value) {
  const s = String(value || '').trim();
  if (!s) return s;
  return s.replace(/[^\s-]+/g, (word) => {
    if (!word) return word;
    return word.charAt(0).toLocaleUpperCase('ru-RU') + word.slice(1).toLocaleLowerCase('ru-RU');
  });
}

function emptyForm() {
  return {
    barcode: generateEAN13(),
    sku: '',
    name: '',
    brand: '',
    model: '',
    category: '',
    category_id: null,
    category_group_id: null,
    attributes: {},
    compatibility_vehicle_model_ids: [],
    manufacturer: '',
    extra_info: '',
    cny_price: '',
    delivery_kg: '',
    delivery_kzt: '',
    sale_price: '',
    quantity: '',
  };
}

function lineToForm(line) {
  if (!line) return emptyForm();
  return {
    barcode: line.barcode || '',
    sku: line.sku || '',
    name: line.name || '',
    brand: line.brand || '',
    model: line.model || '',
    category: line.category || '',
    category_id: line.category_id || null,
    category_group_id: line.category_group_id || null,
    attributes: line.attributes && typeof line.attributes === 'object' ? { ...line.attributes } : {},
    compatibility_vehicle_model_ids: Array.isArray(line.compatibility_vehicle_model_ids)
      ? [...line.compatibility_vehicle_model_ids]
      : [],
    manufacturer: line.manufacturer || '',
    extra_info: line.extra_info || '',
    cny_price: num(line.cny_price) > 0 ? String(line.cny_price) : '',
    delivery_kg: num(line.delivery_kg) > 0 ? String(line.delivery_kg) : '',
    delivery_kzt: num(line.delivery_kzt) > 0 ? String(line.delivery_kzt) : '',
    sale_price: num(line.sale_price) > 0 ? String(line.sale_price) : '',
    quantity: line.quantity != null && parseInt(line.quantity, 10) > 0 ? String(line.quantity) : '',
  };
}

function photosFromLine(line) {
  if (!line) return [];
  const items = [];
  const pending = Array.isArray(line.intake_photo_data)
    ? line.intake_photo_data.filter((u) => String(u || '').startsWith('data:'))
    : [];
  pending.forEach((src, i) => {
    items.push({ id: `pending-${i}-${src.slice(0, 24)}`, kind: 'pending', src });
  });
  const wh = Array.isArray(line.warehouse_image_urls)
    ? line.warehouse_image_urls.map((u) => String(u || '').trim()).filter(Boolean)
    : [];
  wh.forEach((url, i) => {
    items.push({ id: `wh-${i}-${url}`, kind: 'warehouse', url });
  });
  return items;
}

import { IosFormBlock, IosFormGroup } from './IosForm';

function IntakeFormCard({ title, children, className = '', footer }) {
  return (
    <IosFormBlock title={title} footer={footer} className={`intake-form-card-wrap${className ? ` ${className}` : ''}`}>
      <IosFormGroup padded className="intake-form-card">
        {children}
      </IosFormGroup>
    </IosFormBlock>
  );
}

export default function IntakeLineModal({
  isOpen,
  onClose,
  line,
  seedLine = null,
  onSave,
  readonly = false,
  cnyRate = 65,
  deliveryPerKg = 800,
  labelSize = 'small',
}) {
  const [form, setForm] = useState(emptyForm);
  const [deliveryMode, setDeliveryMode] = useState('normal');
  const [customRate, setCustomRate] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [knownOnWarehouse, setKnownOnWarehouse] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [cnyHistory, setCnyHistory] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [compatPickerKey, setCompatPickerKey] = useState(0);
  const [compatInitialIds, setCompatInitialIds] = useState(EMPTY_COMPAT_IDS);

  const resetCompatPicker = useCallback((ids = EMPTY_COMPAT_IDS) => {
    setCompatInitialIds(ids?.length ? [...ids] : EMPTY_COMPAT_IDS);
    setCompatPickerKey((k) => k + 1);
  }, []);

  const { data: categoryTree = [] } = useQuery({
    queryKey: ['categories', 'tree'],
    queryFn: () => categoryApi.getTree({ active_only: true }).then((r) => r.data),
    staleTime: 120_000,
  });

  const selectedSubcategorySchema = useMemo(() => {
    const cat = findCategoryInTree(categoryTree, form.category_id);
    const raw = cat?.attribute_schema || null;
    if (!raw) return null;
    const profile = resolveCategoryProfile(raw);
    return { ...raw, ...profile, show_compatibility: profile.vehicle_mode === 'compatibility' };
  }, [categoryTree, form.category_id]);

  const selectedCategoryGroup = useMemo(() => {
    if (form.category_group_id) {
      return categoryTree.find((g) => g.id === form.category_group_id) || null;
    }
    if (form.category_id) {
      return categoryTree.find((g) => (g.children || []).some((c) => c.id === form.category_id)) || null;
    }
    return null;
  }, [categoryTree, form.category_group_id, form.category_id]);

  const vehicleMode = selectedSubcategorySchema?.vehicle_mode || 'none';
  const liquidsGroup = /жидкост/i.test(selectedCategoryGroup?.name || '');
  const showCompatibilityBlock = !liquidsGroup || vehicleMode !== 'none';
  const showBrandModelBlock = false;

  const { data: vehicleBrands = [] } = useQuery({
    queryKey: ['compatibility', 'vehicle-brands'],
    queryFn: () => compatibilityApi.vehicleBrands().then((r) => r.data),
    staleTime: 60_000,
    enabled: isOpen && showCompatibilityBlock,
  });

  const { data: vehicleModels = [] } = useQuery({
    queryKey: ['compatibility', 'vehicle-models'],
    queryFn: () => compatibilityApi.vehicleModels().then((r) => r.data),
    staleTime: 60_000,
    enabled: isOpen && showCompatibilityBlock,
  });

  const localPhotoCount = photos.filter((p) => p.kind === 'pending').length;
  const warehousePhotoCount = photos.filter((p) => p.kind === 'warehouse').length;

  const deliveryRate = useMemo(() => {
    if (deliveryMode === 'express') return 2000;
    if (deliveryMode === 'custom') {
      const c = num(customRate);
      if (c > 0) return c;
      const del = num(form.delivery_kzt);
      const kg = num(form.delivery_kg);
      if (del > 0 && kg > 0) return del / kg;
      return 0;
    }
    return num(deliveryPerKg) || 800;
  }, [deliveryMode, customRate, form.delivery_kzt, form.delivery_kg, deliveryPerKg]);

  const purchasePreview = useMemo(
    () => computeLinePurchase(form.cny_price, form.delivery_kzt, cnyRate),
    [form.cny_price, form.delivery_kzt, cnyRate],
  );

  const positionTotalsPreview = useMemo(() => {
    const qty = parseInt(form.quantity, 10) || 0;
    if (qty <= 0) return null;
    const unitSale = num(form.sale_price);
    const unitPurchase = purchasePreview;
    if (unitPurchase <= 0 && unitSale <= 0) return null;
    return {
      qty,
      unitPurchase: roundMoney2(unitPurchase),
      unitSale: roundMoney2(unitSale),
      saleTotal: unitSale > 0 ? roundMoney2(unitSale * qty) : 0,
    };
  }, [form.quantity, form.sale_price, purchasePreview]);

  useEffect(() => {
    if (!isOpen) return;
    setDeliveryMode('normal');
    setCustomRate('');
    setKnownOnWarehouse(false);
    setShowPrint(false);
    if (line) {
      setForm(lineToForm(line));
      setPhotos(photosFromLine(line));
      if (line.barcode) fetchCnyHistory(line.barcode).then(setCnyHistory);
      else setCnyHistory([]);
      return;
    }
    const draft = {
      local_id: seedLine?.local_id || newIntakeLineId(),
      barcode: seedLine?.barcode || generateEAN13(),
      ...seedLine,
      quantity: null,
    };
    const nextForm = lineToForm(draft);
    setForm(nextForm);
    resetCompatPicker(nextForm.compatibility_vehicle_model_ids);
    setPhotos(photosFromLine(draft));
    const bc = String(draft.barcode || '').trim();
    if (bc.length >= 4) fetchCnyHistory(bc).then(setCnyHistory);
    else setCnyHistory([]);
  }, [isOpen, line, seedLine, resetCompatPicker]);

  useEffect(() => {
    if (!isOpen || !form.category_id || form.category_group_id) return;
    const gid = findGroupIdForCategory(categoryTree, form.category_id);
    if (gid) setForm((f) => ({ ...f, category_group_id: gid }));
  }, [isOpen, form.category_id, form.category_group_id, categoryTree]);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  const handleCompatibilityChange = useCallback((ids) => {
    const idList = Array.isArray(ids) ? ids : [];
    setForm((f) => {
      const selected = (vehicleModels || []).filter((m) => idList.includes(m.id));
      return syncPrimaryVehicleFromSelection(
        { ...f, compatibility_vehicle_model_ids: idList },
        selected,
      );
    });
  }, [vehicleModels]);

  const compatibilityPickerSlot = useMemo(() => {
    if (!showCompatibilityBlock) return null;
    return (
      <VehicleCompatibilityPicker
        key={`compat-${compatPickerKey}`}
        initialSelectedIds={compatInitialIds}
        brands={vehicleBrands}
        models={vehicleModels}
        onChange={handleCompatibilityChange}
        disabled={readonly}
      />
    );
  }, [
    showCompatibilityBlock,
    compatPickerKey,
    compatInitialIds,
    vehicleBrands,
    vehicleModels,
    handleCompatibilityChange,
    readonly,
  ]);

  const intakeFormData = useMemo(() => ({
    name: form.name,
    attributes: form.attributes || {},
    brand: form.brand,
    model: form.model,
  }), [form.name, form.attributes, form.brand, form.model]);

  const setIntakeFormData = useCallback((next) => {
    setForm((f) => ({
      ...f,
      name: next.name ?? f.name,
      attributes: next.attributes ?? f.attributes,
      brand: next.brand ?? f.brand,
      model: next.model ?? f.model,
    }));
  }, []);

  const capField = (key) => {
    setForm((f) => ({ ...f, [key]: capitalizeWords(f[key]) }));
  };

  const formatDeliveryKzt = (v) => {
    const r = roundMoney2(v);
    return r === Math.round(r) ? String(Math.round(r)) : String(r);
  };

  const onKgChanged = useCallback(
    (kgText, rate = deliveryRate) => {
      const kg = num(kgText);
      setForm((f) => {
        const next = { ...f };
        if (kg > 0 && rate > 0) {
          next.delivery_kzt = formatDeliveryKzt(kg * rate);
        } else if (!String(kgText).trim()) {
          next.delivery_kzt = '';
        }
        return next;
      });
    },
    [deliveryRate],
  );

  const onKztChanged = useCallback(
    (kztText, rate = deliveryRate) => {
      const v = num(kztText);
      setForm((f) => {
        const next = { ...f };
        if (v > 0 && rate > 0) {
          const kg = roundKg3(v / rate);
          next.delivery_kg =
            kg === Math.round(kg)
              ? String(Math.round(kg))
              : String(kg)
                  .replace(/0+$/, '')
                  .replace(/\.$/, '');
        } else if (!String(kztText).trim()) {
          next.delivery_kg = '';
        }
        return next;
      });
    },
    [deliveryRate],
  );

  const setDeliveryModeAndRecalc = (key) => {
    setDeliveryMode(key);
    if (key === 'custom' && !customRate.trim()) {
      const del = num(form.delivery_kzt);
      const kg = num(form.delivery_kg);
      if (del > 0 && kg > 0) {
        const implied = del / kg;
        setCustomRate(
          implied === Math.round(implied) ? String(Math.round(implied)) : String(roundMoney2(implied)),
        );
      }
    }
    if (num(form.delivery_kg) > 0) onKgChanged(form.delivery_kg);
  };

  const clearWarehouseLookup = useCallback(() => {
    setKnownOnWarehouse(false);
    setPhotos((prev) => prev.filter((p) => p.kind === 'pending'));
  }, []);

  const applyWarehouseProduct = useCallback(
    async (p, { updateBarcode = false, force = false } = {}) => {
      const bc = updateBarcode && p.barcode ? p.barcode : form.barcode;
      if (updateBarcode && p.barcode) setField('barcode', p.barcode);
      const history = await fetchCnyHistory(bc);
      setCnyHistory(history);
      setKnownOnWarehouse(true);
      let syncDelKzt = null;
      setForm((f) => {
        const next = { ...f };
        const fill = (key, val) => {
          if (force || !String(next[key] ?? '').trim()) next[key] = val;
        };
        fill('sku', capitalizeWords(p.sku || ''));
        fill('name', capitalizeWords(p.name || ''));
        fill('brand', capitalizeWords(p.brand || ''));
        fill('model', capitalizeWords(p.model || ''));
        fill('category', capitalizeWords(p.category || ''));
        if (p.category_id) next.category_id = p.category_id;
        if (p.attributes) next.attributes = { ...p.attributes };
        if (p.compatibility?.vehicle_models?.length) {
          next.compatibility_vehicle_model_ids = p.compatibility.vehicle_models.map((m) => m.id);
        }
        next.category_group_id = findGroupIdForCategory(categoryTree, p.category_id);
        fill('manufacturer', capitalizeWords(p.supplier || ''));
        fill('extra_info', p.description || '');
        if (force || !next.cny_price.trim()) {
          const latest = history[0];
          if (latest?.cny > 0) {
            next.cny_price = String(latest.cny);
            if (latest.delivery_kzt > 0) {
              syncDelKzt = String(Math.round(latest.delivery_kzt));
              next.delivery_kzt = syncDelKzt;
            }
          } else if (num(p.cny_price) > 0) {
            next.cny_price = String(p.cny_price);
          }
        }
        if (force || (!next.delivery_kzt.trim() && num(p.delivery_cost_kzt) > 0)) {
          syncDelKzt = String(Math.round(num(p.delivery_cost_kzt)));
          next.delivery_kzt = syncDelKzt;
        }
        const delKg = num(p.delivery_weight_kg);
        if (delKg > 0 && (force || !next.delivery_kg.trim())) {
          next.delivery_kg = String(delKg);
        }
        if (force || (!next.sale_price.trim() && num(p.sale_price) > 0)) {
          next.sale_price = String(p.sale_price);
        }
        next.quantity = '';
        return next;
      });
      if (syncDelKzt) onKztChanged(syncDelKzt);
      const urls = productGalleryFromApi(p);
      setPhotos((prev) => {
        const pending = prev.filter((p) => p.kind === 'pending');
        const remote = urls.slice(0, MAX_INTAKE_PHOTOS - pending.length).map((url, i) => ({
          id: `wh-${url}-${i}`,
          kind: 'warehouse',
          url,
        }));
        return [...pending, ...remote];
      });
    },
    [form.barcode, form.delivery_kzt, onKztChanged],
  );

  useEffect(() => {
    if (!isOpen || line) return;
    const bc = String(seedLine?.barcode || form.barcode || '').trim();
    if (bc.length < 4) return;
    let cancelled = false;
    (async () => {
      setLookingUp(true);
      try {
        const res = await productApi.getByBarcode(bc, { allow404: true });
        if (cancelled) return;
        if (res.status === 200 && res.data) {
          await applyWarehouseProduct(res.data, { force: true });
        }
      } catch {
        /* ignore */
      } finally {
        if (!cancelled) setLookingUp(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isOpen, line, seedLine?.barcode, applyWarehouseProduct]);

  const lookupBarcode = useCallback(async () => {
    const code = String(form.barcode || '').trim();
    if (code.length < 4) {
      setKnownOnWarehouse(false);
      return;
    }
    setLookingUp(true);
    try {
      const res = await productApi.getByBarcode(code, { allow404: true });
      if (res.status === 200 && res.data) {
        await applyWarehouseProduct(res.data);
      } else {
        clearWarehouseLookup();
      }
    } catch {
      clearWarehouseLookup();
    } finally {
      setLookingUp(false);
    }
  }, [form.barcode, applyWarehouseProduct, clearWarehouseLookup]);

  const lookupSku = useCallback(async () => {
    const sku = String(form.sku || '').trim();
    if (sku.length < 2) {
      setKnownOnWarehouse(false);
      return;
    }
    setLookingUp(true);
    try {
      const res = await productApi.getBySku(sku, { allow404: true });
      if (res.status === 200 && res.data) {
        await applyWarehouseProduct(res.data, { updateBarcode: true });
      } else {
        clearWarehouseLookup();
      }
    } catch {
      clearWarehouseLookup();
    } finally {
      setLookingUp(false);
    }
  }, [form.sku, applyWarehouseProduct, clearWarehouseLookup]);

  useEffect(() => {
    if (!isOpen || readonly) return undefined;
    const t = setTimeout(() => {
      if (form.barcode.trim().length >= 4) lookupBarcode();
    }, 450);
    return () => clearTimeout(t);
  }, [form.barcode, isOpen, readonly, lookupBarcode]);

  useEffect(() => {
    if (!isOpen || readonly) return undefined;
    const t = setTimeout(() => {
      if (form.sku.trim().length >= 2) lookupSku();
    }, 450);
    return () => clearTimeout(t);
  }, [form.sku, isOpen, readonly, lookupSku]);

  const handleAddPhotos = async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length || readonly) return;
    const bad = files.find((f) => !f.type.startsWith('image/'));
    if (bad) {
      toast.error('Выберите файлы изображений');
      return;
    }
    const slots = MAX_INTAKE_PHOTOS - photos.length;
    if (slots <= 0) {
      toast.error(`Не больше ${MAX_INTAKE_PHOTOS} фото`);
      return;
    }
    const queue = files.slice(0, slots);
    setPhotoBusy(true);
    try {
      const added = [];
      for (const file of queue) {
        const src = await compressImageFile(file);
        added.push({ id: `pending-${Date.now()}-${Math.random()}`, kind: 'pending', src });
      }
      setPhotos((prev) => [...prev, ...added]);
      if (files.length > queue.length) {
        toast.error(`Максимум ${MAX_INTAKE_PHOTOS} фото на позицию`);
      }
    } catch (e) {
      toast.error(e?.message || 'Не удалось обработать фото');
    } finally {
      setPhotoBusy(false);
    }
  };

  const removePhoto = (id) => setPhotos((prev) => prev.filter((p) => p.id !== id));

  const setMainPhoto = (index) => {
    if (index <= 0) return;
    setPhotos((prev) => {
      const next = [...prev];
      const [picked] = next.splice(index, 1);
      next.unshift(picked);
      return next;
    });
  };

  const applyCnyHistoryEntry = (entry) => {
    if (!entry?.cny) return;
    setField('cny_price', String(entry.cny));
    if (entry.delivery_kzt > 0) {
      setField('delivery_kzt', String(Math.round(entry.delivery_kzt)));
      onKztChanged(String(Math.round(entry.delivery_kzt)));
    }
  };

  const handleSave = async () => {
    if (readonly) {
      onClose();
      return;
    }
    capField('name');
    capField('brand');
    capField('model');
    capField('category');
    capField('sku');
    const name = form.name.trim();
    if (!name) {
      toast.error('Укажите название');
      return;
    }
    const barcode = form.barcode.trim() || generateEAN13();
    const cnyV = roundMoney2(num(form.cny_price));
    const prevCny = line ? num(line.cny_price) : 0;
    const prevDel = line ? num(line.delivery_kzt) : 0;

    if (barcode && prevCny > 0 && Math.abs(prevCny - cnyV) > 0.01) {
      await addCnyHistory({ barcode, cny: prevCny, deliveryKzt: prevDel > 0 ? prevDel : null });
    }
    if (barcode && cnyV > 0) {
      await addCnyHistory({ barcode, cny: cnyV, deliveryKzt: num(form.delivery_kzt) > 0 ? form.delivery_kzt : null });
    }

    const saved = {
      local_id: line?.local_id || seedLine?.local_id || newIntakeLineId(),
      barcode,
      sku: form.sku.trim() || null,
      name,
      brand: form.brand.trim() || null,
      model: form.model.trim() || null,
      category: form.category.trim() || null,
      category_id: form.category_id || null,
      category_group_id: form.category_group_id || null,
      attributes: Object.keys(form.attributes || {}).length ? form.attributes : null,
      compatibility_vehicle_model_ids: (form.compatibility_vehicle_model_ids || []).length
        ? form.compatibility_vehicle_model_ids
        : null,
      manufacturer: form.manufacturer.trim() || null,
      extra_info: form.extra_info.trim() || null,
      cny_price: cnyV > 0 ? cnyV : null,
      delivery_kg: roundWeight2(num(form.delivery_kg)) > 0 ? roundWeight2(num(form.delivery_kg)) : null,
      delivery_kzt: roundMoney2(num(form.delivery_kzt)) > 0 ? roundMoney2(num(form.delivery_kzt)) : null,
      purchase_kzt: roundMoney2(purchasePreview),
      sale_price: roundMoney2(num(form.sale_price)) > 0 ? roundMoney2(num(form.sale_price)) : null,
      quantity: form.quantity.trim() ? parseInt(form.quantity, 10) || null : null,
    };
    const wh = photos.filter((p) => p.kind === 'warehouse').map((p) => p.url);
    const pending = photos.filter((p) => p.kind === 'pending').map((p) => p.src);
    if (wh.length) saved.warehouse_image_urls = wh;
    if (pending.length) saved.intake_photo_data = pending;
    onSave(saved);
    onClose();
  };

  const printProduct = lineToProductForPrint({
    name: form.name,
    barcode: form.barcode,
    sku: form.sku,
    brand: form.brand,
  });

  const photoPreview = (p) =>
    p.kind === 'pending' ? p.src : resolveUploadedAssetUrl(p.url);

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={readonly ? 'Просмотр позиции' : line ? 'Редактировать товар' : 'Новый товар'}
        size="intake"
        actions={
          readonly ? (
            <>
              <Button variant="secondary" icon={FiTag} onClick={() => setShowPrint(true)}>
                Печать этикетки
              </Button>
              <Button variant="secondary" onClick={onClose}>
                Закрыть
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="secondary"
                icon={FiPrinter}
                onClick={() => setShowPrint(true)}
                disabled={!form.barcode.trim()}
              >
                Печать
              </Button>
              <Button variant="secondary" onClick={onClose}>
                Отмена
              </Button>
              <Button variant="primary" icon={FiCheckCircle} onClick={handleSave}>
                {line ? 'Сохранить' : 'Добавить в накладную'}
              </Button>
            </>
          )
        }
      >
        <div className="intake-line-form">
          {readonly && (
            <div className="intake-form-banner intake-form-banner--readonly">
              Накладная на складе — только просмотр
            </div>
          )}

          <IntakeFormCard title="Фото">
            <p className="intake-form-hint">
              {photos.length} из {MAX_INTAKE_PHOTOS} · ⭐ первое фото = главное
              {!readonly && ' · при «В склад» загрузятся на сервер'}
            </p>
            <div className="intake-form-photo-meta">
              <span className="intake-form-photo-chip intake-form-photo-chip--local">
                Локально: {localPhotoCount}
              </span>
              <span className="intake-form-photo-chip intake-form-photo-chip--wh">
                Склад: {warehousePhotoCount}
              </span>
            </div>
            {photos.length > 0 && (
              <div className="intake-form-photo-strip">
                {photos.map((p, idx) => (
                  <div key={p.id} className="intake-form-photo-item">
                    <img src={photoPreview(p)} alt="" />
                    {idx === 0 && <span className="intake-form-photo-main">Главное</span>}
                    {p.kind === 'warehouse' && <span className="intake-form-photo-badge">Склад</span>}
                    {!readonly && (
                      <>
                        <button
                          type="button"
                          className="intake-form-photo-star"
                          title={idx === 0 ? 'Главное фото' : 'Сделать главным'}
                          onClick={() => setMainPhoto(idx)}
                        >
                          <FiStar size={14} fill={idx === 0 ? 'currentColor' : 'none'} />
                        </button>
                        <button
                          type="button"
                          className="intake-form-photo-remove"
                          onClick={() => removePhoto(p.id)}
                          aria-label="Удалить"
                        >
                          <FiX size={14} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
            {!readonly && photos.length < MAX_INTAKE_PHOTOS && (
              <div className="intake-form-photo-actions">
                <label className="intake-form-photo-btn">
                  <FiImage size={18} />
                  {photoBusy ? 'Обработка…' : 'Загрузить с компьютера'}
                  <input type="file" accept="image/*" multiple disabled={photoBusy} onChange={handleAddPhotos} />
                </label>
              </div>
            )}
          </IntakeFormCard>

          <IntakeFormCard title="Штрих-код">
            <div className="intake-form-barcode-row">
              <input
                className="ios-input intake-form-input-mono"
                value={form.barcode}
                onChange={(e) => setField('barcode', e.target.value)}
                placeholder="EAN-13"
                readOnly={readonly}
              />
              {!readonly && (
                <>
                  <button
                    type="button"
                    className="intake-form-tool-btn"
                    title="Новый штрих-код"
                    onClick={() => {
                      setField('barcode', generateEAN13());
                      clearWarehouseLookup();
                    }}
                  >
                    <FiRefreshCw size={18} />
                  </button>
                  <button
                    type="button"
                    className="intake-form-tool-btn intake-form-tool-btn--primary"
                    title="Сканировать камерой"
                    onClick={() => setShowScanner(true)}
                  >
                    <FiCamera size={18} />
                  </button>
                </>
              )}
            </div>
            {lookingUp && <div className="intake-form-progress" />}
            {knownOnWarehouse && !lookingUp && !readonly && (
              <div className="intake-form-banner intake-form-banner--success">
                Товар найден на складе — поля заполнены
              </div>
            )}
          </IntakeFormCard>

          <IntakeFormCard title="Категория">
            <CategoryPicker
              tree={categoryTree}
              groupId={form.category_group_id}
              categoryId={form.category_id}
              legacyCategoryText={!form.category_id ? (form.category || '') : ''}
              disabled={readonly}
              onChange={({ groupId, categoryId }) => {
                const sub = findCategoryInTree(categoryTree, categoryId);
                setForm((prev) => {
                  const catChanged = categoryId && categoryId !== prev.category_id;
                  if (catChanged) resetCompatPicker([]);
                  return {
                    ...prev,
                    category_group_id: groupId,
                    category_id: categoryId,
                    category: sub?.name || prev.category,
                    attributes: catChanged && prev.category_id ? {} : (prev.attributes || {}),
                    compatibility_vehicle_model_ids: catChanged && prev.category_id ? [] : prev.compatibility_vehicle_model_ids,
                    brand: catChanged && prev.category_id ? '' : prev.brand,
                    model: catChanged && prev.category_id ? '' : prev.model,
                  };
                });
              }}
            />
            {!form.category_id && !readonly && (
              <p className="product-form-category-gate" style={{ marginTop: 12, marginBottom: 0 }}>
                Выберите подкатегорию — ниже появятся поля по шаблону. Цены и артикул можно заполнить уже сейчас.
              </p>
            )}
          </IntakeFormCard>

          {form.category_id && selectedSubcategorySchema && (
            <IntakeFormCard title="Карточка товара">
              <ProductFormByLayout
                schema={selectedSubcategorySchema}
                formData={intakeFormData}
                onFormDataChange={setIntakeFormData}
                disabled={readonly}
                categoryGroupName={selectedCategoryGroup?.name || ''}
                categoryName={findCategoryInTree(categoryTree, form.category_id)?.name || form.category || ''}
                compatibilitySlot={compatibilityPickerSlot}
              />
            </IntakeFormCard>
          )}

          {(showBrandModelBlock || (!showCompatibilityBlock && form.category_id)) && (
            <div className="intake-form-row-2">
              <IntakeFormCard title="Марка">
                <input
                  className="ios-input"
                  value={form.brand}
                  onChange={(e) => setField('brand', e.target.value)}
                  onBlur={() => capField('brand')}
                  placeholder="FAW, Changan…"
                  readOnly={readonly}
                />
              </IntakeFormCard>
              <IntakeFormCard title="Модель">
                <input
                  className="ios-input"
                  value={form.model}
                  onChange={(e) => setField('model', e.target.value)}
                  onBlur={() => capField('model')}
                  placeholder="Bestune T77…"
                  readOnly={readonly}
                />
              </IntakeFormCard>
            </div>
          )}

          <div className="intake-form-prices-block">
          <IntakeFormCard title="Артикул">
            <input
              className="ios-input"
              value={form.sku}
              onChange={(e) => setField('sku', e.target.value)}
              onBlur={() => capField('sku')}
              placeholder="OEM / внутренний код — подставит данные со склада"
              readOnly={readonly}
            />
          </IntakeFormCard>

          <IntakeFormCard title="Закуп (¥)">
            <input
              className="ios-input"
              type="number"
              value={form.cny_price}
              onChange={(e) => setField('cny_price', e.target.value)}
              placeholder="Цена в юанях"
              readOnly={readonly}
            />
            {cnyHistory.length > 0 && !readonly && (
              <div className="intake-form-cny-history">
                <span className="intake-form-cny-history-label">История закупа:</span>
                <div className="intake-form-cny-chips">
                  {cnyHistory.slice(0, 5).map((h, i) => (
                    <button
                      key={`${h.cny}-${h.added_at || i}`}
                      type="button"
                      className="intake-form-cny-chip"
                      onClick={() => applyCnyHistoryEntry(h)}
                    >
                      ¥{h.cny}
                      {h.delivery_kzt > 0 ? ` · ${Math.round(h.delivery_kzt)} ₸ доставка` : ''}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </IntakeFormCard>

          <IntakeFormCard title="Доставка">
            {!readonly && (
              <div className="intake-form-delivery-chips">
                {DELIVERY_MODES.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    className={`intake-form-delivery-chip${deliveryMode === m.key ? ' intake-form-delivery-chip--active' : ''}`}
                    onClick={() => setDeliveryModeAndRecalc(m.key)}
                  >
                    <span>{m.label}</span>
                    <small>{m.sub(deliveryPerKg)}</small>
                  </button>
                ))}
              </div>
            )}
            {deliveryMode === 'custom' && !readonly && (
              <input
                className="ios-input intake-form-custom-rate"
                placeholder="Своя цена, ₸/кг"
                value={customRate}
                onChange={(e) => {
                  setCustomRate(e.target.value);
                  if (num(form.delivery_kg) > 0) onKgChanged(form.delivery_kg);
                }}
              />
            )}
            <div className="intake-form-row-2 intake-form-row-2--tight">
              <label className="intake-form-inline-field">
                <span>Доставка (кг)</span>
                <input
                  className="ios-input"
                  type="number"
                  value={form.delivery_kg}
                  onChange={(e) => {
                    setField('delivery_kg', e.target.value);
                    if (!readonly) onKgChanged(e.target.value);
                  }}
                  readOnly={readonly}
                />
              </label>
              <label className="intake-form-inline-field">
                <span>Доставка (₸)</span>
                <input
                  className="ios-input"
                  type="number"
                  value={form.delivery_kzt}
                  onChange={(e) => {
                    setField('delivery_kzt', e.target.value);
                    if (!readonly) onKztChanged(e.target.value);
                  }}
                  readOnly={readonly}
                />
              </label>
            </div>
          </IntakeFormCard>

          <div className="intake-form-row-2">
            <IntakeFormCard title="Стоимость (₸)" className="intake-form-card--accent">
              <input
                className="ios-input intake-form-input-large"
                type="number"
                value={form.sale_price}
                onChange={(e) => setField('sale_price', e.target.value)}
                placeholder="Перед загрузкой на склад"
                readOnly={readonly}
              />
            </IntakeFormCard>
            <IntakeFormCard title="Количество">
              <input
                className="ios-input intake-form-input-large"
                type="number"
                value={form.quantity}
                onChange={(e) => setField('quantity', e.target.value)}
                placeholder="Перед загрузкой на склад"
                readOnly={readonly}
              />
            </IntakeFormCard>
          </div>

          {positionTotalsPreview && (
            <div className="intake-form-position-totals">
              <div className="intake-form-position-totals-head">
                <span className="intake-form-position-totals-title">По позиции</span>
                <span className="intake-form-position-totals-qty">{positionTotalsPreview.qty} шт</span>
              </div>
              <div className="intake-form-position-totals-cols">
                <div className="intake-form-position-stat intake-form-position-stat--purchase">
                  <span className="intake-form-position-stat-label">Закуп</span>
                  <span className="intake-form-position-stat-value">
                    {positionTotalsPreview.unitPurchase.toLocaleString('ru-RU')} ₸
                  </span>
                  <span className="intake-form-position-stat-unit">за 1 шт</span>
                </div>
                <div className="intake-form-position-stat intake-form-position-stat--sale">
                  <span className="intake-form-position-stat-label">Продажа</span>
                  <span className="intake-form-position-stat-value">
                    {positionTotalsPreview.unitSale > 0
                      ? `${positionTotalsPreview.unitSale.toLocaleString('ru-RU')} ₸`
                      : '—'}
                  </span>
                  <span className="intake-form-position-stat-unit">
                    {positionTotalsPreview.unitSale > 0 && positionTotalsPreview.saleTotal > 0
                      ? `всего ${positionTotalsPreview.saleTotal.toLocaleString('ru-RU')} ₸`
                      : 'за 1 шт'}
                  </span>
                </div>
              </div>
            </div>
          )}

          <IntakeFormCard title="Производитель">
            <input
              className="ios-input"
              value={form.manufacturer}
              onChange={(e) => setField('manufacturer', e.target.value)}
              onBlur={() => capField('manufacturer')}
              placeholder="Завод, бренд OEM…"
              readOnly={readonly}
            />
          </IntakeFormCard>

          <IntakeFormCard title="Доп. информация">
            <TextArea
              value={form.extra_info}
              onChange={(e) => setField('extra_info', e.target.value)}
              placeholder="Примечание, комплектация…"
              readOnly={readonly}
              rows={3}
            />
          </IntakeFormCard>
          </div>


        </div>
      </Modal>

      <CameraBarcodeScanner
        isOpen={showScanner}
        onClose={() => setShowScanner(false)}
        onDetected={(code) => {
          setShowScanner(false);
          const normalized = String(code || '').trim();
          if (normalized) {
            setField('barcode', normalized);
            lookupBarcode();
          }
        }}
      />

      <LabelPrint
        isOpen={showPrint}
        onClose={() => setShowPrint(false)}
        product={printProduct}
        initialLabelLayout={readStoredLabelLayout()}
        labelSize="medium"
      />
    </>
  );
}

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
import CameraBarcodeScanner from './CameraBarcodeScanner';
import { productApi, resolveUploadedAssetUrl } from '../api/client';
import { generateEAN13 } from '../utils/barcodeGen';
import {
  addCnyHistory,
  computeLinePurchase,
  fetchCnyHistory,
  lineToProductForPrint,
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

function IntakeFormCard({ title, children, className = '' }) {
  return (
    <section className={`intake-form-card${className ? ` ${className}` : ''}`}>
      <div className="intake-form-card-label">{title}</div>
      {children}
    </section>
  );
}

export default function IntakeLineModal({
  isOpen,
  onClose,
  line,
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
  const [printType, setPrintType] = useState('barcode');
  const [cnyHistory, setCnyHistory] = useState([]);
  const [photos, setPhotos] = useState([]);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [showScanner, setShowScanner] = useState(false);

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const r = await productApi.getCategories({ limit: 500 });
      const data = r.data;
      if (Array.isArray(data?.categories)) return data.categories;
      if (Array.isArray(data)) return data;
      return [];
    },
    staleTime: 60_000,
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

  useEffect(() => {
    if (!isOpen) return;
    setForm(lineToForm(line));
    setDeliveryMode('normal');
    setCustomRate('');
    setKnownOnWarehouse(false);
    setShowPrint(false);
    setPhotos(photosFromLine(line));
    if (line?.barcode) {
      fetchCnyHistory(line.barcode).then(setCnyHistory);
    } else {
      setCnyHistory([]);
    }
  }, [isOpen, line]);

  const setField = (key, value) => setForm((f) => ({ ...f, [key]: value }));

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
    async (p, { updateBarcode = false } = {}) => {
      const bc = updateBarcode && p.barcode ? p.barcode : form.barcode;
      if (updateBarcode && p.barcode) setField('barcode', p.barcode);
      const history = await fetchCnyHistory(bc);
      setCnyHistory(history);
      setKnownOnWarehouse(true);
      let syncDelKzt = null;
      setForm((f) => {
        const next = { ...f };
        if (!next.sku.trim()) next.sku = capitalizeWords(p.sku || '');
        if (!next.name.trim()) next.name = capitalizeWords(p.name || '');
        if (!next.brand.trim()) next.brand = capitalizeWords(p.brand || '');
        if (!next.model.trim()) next.model = capitalizeWords(p.model || '');
        if (!next.category.trim()) next.category = capitalizeWords(p.category || '');
        if (!next.manufacturer.trim()) next.manufacturer = capitalizeWords(p.supplier || '');
        if (!next.extra_info.trim()) next.extra_info = p.description || '';
        if (!next.cny_price.trim()) {
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
        if (!next.delivery_kzt.trim() && num(p.delivery_cost_kzt) > 0) {
          syncDelKzt = String(Math.round(num(p.delivery_cost_kzt)));
          next.delivery_kzt = syncDelKzt;
        }
        if (!next.sale_price.trim() && num(p.sale_price) > 0) {
          next.sale_price = String(p.sale_price);
        }
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
      local_id: line?.local_id || `line_${Date.now()}`,
      barcode,
      sku: form.sku.trim() || null,
      name,
      brand: form.brand.trim() || null,
      model: form.model.trim() || null,
      category: form.category.trim() || null,
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

          <IntakeFormCard title="Название *">
            <input
              className="ios-input"
              value={form.name}
              onChange={(e) => setField('name', e.target.value)}
              onBlur={() => capField('name')}
              placeholder="Название товара"
              readOnly={readonly}
            />
          </IntakeFormCard>

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

          <IntakeFormCard title="Категория">
            <input
              className="ios-input"
              list="intake-category-list"
              value={form.category}
              onChange={(e) => setField('category', e.target.value)}
              onBlur={() => capField('category')}
              placeholder="Выберите или введите"
              readOnly={readonly}
            />
            <datalist id="intake-category-list">
              {categories.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
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

          {purchasePreview > 0 && (
            <p className="intake-form-purchase-total">
              Закуп итого: <strong>{purchasePreview.toLocaleString('ru-RU')} ₸</strong>
            </p>
          )}

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

          {!readonly && (
            <IntakeFormCard title="Печать этикетки">
              <div className="intake-form-print-type">
                {['barcode', 'qrcode'].map((t) => (
                  <button
                    key={t}
                    type="button"
                    className={`intake-form-delivery-chip${printType === t ? ' intake-form-delivery-chip--active' : ''}`}
                    onClick={() => setPrintType(t)}
                  >
                    {t === 'barcode' ? 'Штрих-код' : 'QR-код'}
                  </button>
                ))}
              </div>
            </IntakeFormCard>
          )}

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
        initialLabelType={printType}
        labelSize={labelSize}
      />
    </>
  );
}

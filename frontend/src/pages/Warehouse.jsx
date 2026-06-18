import React, { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import LabelPrint from '../components/LabelPrint';
import { readStoredLabelLayout } from '../utils/labelPrintUtils';
import SkuConflictModal from '../components/SkuConflictModal';
import { applyWarehouseFormTemplate } from '../utils/productTemplateCopy';
import { productsApi } from '../api/products';
import { resolveUploadedAssetUrl, getApiErrorMessage } from '../api/client';
import { settingsApi } from '../api/settings';
import { Button, Modal, Input, Badge } from '../components/ui';
import { FiCamera, FiPlus, FiTrash2, FiX } from 'react-icons/fi';
import CameraBarcodeScanner from '../components/CameraBarcodeScanner';

const MAX_PRODUCT_PHOTOS = 12;

function normalizeProductGallery(p) {
  const raw = Array.isArray(p?.image_urls) ? p.image_urls : [];
  const urls = [...new Set(raw.map((u) => String(u || '').split('?')[0].trim()).filter(Boolean))];
  const legacy = String(p?.image_url || '').split('?')[0].trim();
  if (!urls.length && legacy) return [legacy];
  return urls;
}

function basenameFromProductImageUrl(url) {
  const base = String(url || '').split('?')[0].trim();
  return base.split('/').pop() || '';
}

const emptyForm = {
  id: null,
  name: '',
  sku: '',
  barcode: '',
  brand: '',
  model: '',
  category: '',
  purchase_price: 0,
  sale_price: 0,
  cny_price: 0,
  quantity: 0,
  min_quantity: 0,
  location_row: '',
  location_shelf: '',
  location_position: '',
  location_zone: '',
  description: '',
  image_url: '',
  image_urls: [],
};

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^a-zа-я0-9]/gi, '');

const fuzzyMatch = (needle, haystack) => {
  const a = normalize(needle);
  const b = normalize(haystack);
  if (!a) return true;
  if (b.includes(a)) return true;

  let i = 0;
  for (const char of b) {
    if (char === a[i]) i += 1;
    if (i === a.length) return true;
  }
  return false;
};

const normalizeScanCode = (s) => String(s ?? '').replaceAll('\u0000', '').replace(/[\s\r\n\t]+/g, '').trim();

const Warehouse = () => {
  const [search, setSearch] = useState('');
  const [, setSelectedProduct] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [barcodeLocked, setBarcodeLocked] = useState(true);
  const [formData, setFormData] = useState(emptyForm);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadPct, setImageUploadPct] = useState(null);
  const [imagePreviewBust, setImagePreviewBust] = useState(0);
  const [imageBlobUrl, setImageBlobUrl] = useState('');
  const [galleryFocusIdx, setGalleryFocusIdx] = useState(0);
  const [showCameraScanner, setShowCameraScanner] = useState(false);
  const [skuConflictOpen, setSkuConflictOpen] = useState(false);
  const [skuConflictExisting, setSkuConflictExisting] = useState(null);
  const [skuConflictSku, setSkuConflictSku] = useState('');
  const [skuConflictPayload, setSkuConflictPayload] = useState(null);
  const skuOpenAfterSaveRef = useRef(null);
  const templateGallerySourceIdRef = useRef(null);
  const queryClient = useQueryClient();

  const { data: products = [], isLoading } = useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const response = await productsApi.getProducts();
      return response.data;
    },
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const response = await settingsApi.getSettings();
      return response.data;
    },
  });

  const saveMutation = useMutation({
    mutationFn: (payload) => {
      const body = { ...payload };
      delete body.id;
      return payload.id
        ? productsApi.updateProduct(payload.id, body)
        : productsApi.createProduct(body);
    },
    onSuccess: (response) => {
      const saved = response.data;
      const urls = normalizeProductGallery(saved);
      toast.success(formData.id ? 'Товар обновлён' : 'Товар создан');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      templateGallerySourceIdRef.current = null;
      const openAfter = skuOpenAfterSaveRef.current;
      skuOpenAfterSaveRef.current = null;
      if (openAfter?.id) {
        openProduct(openAfter);
        return;
      }
      setSelectedProduct(saved);
      setFormData({ ...saved, image_urls: urls, image_url: urls[0] || '' });
    },
    onError: (error) => {
      const detail = error.response?.data?.detail;
      if (detail && typeof detail === 'object' && detail.code === 'SKU_EXISTS') {
        setSkuConflictSku(String(detail.sku || formData.sku || '').trim());
        setSkuConflictExisting(detail);
        setSkuConflictOpen(true);
        return;
      }
      toast.error(getApiErrorMessage(error, 'Не удалось сохранить товар'));
    },
  });

  const filteredProducts = useMemo(() => {
    if (!search.trim()) return products;

    return products.filter((product) =>
      [
        product.name,
        product.sku,
        product.barcode,
        product.brand,
        product.model,
        product.category,
        `${product.location_zone} ${product.location_row} ${product.location_shelf} ${product.location_position}`,
      ].some((field) => fuzzyMatch(search, field))
    );
  }, [products, search]);

  const closeEditor = () => {
    setGalleryFocusIdx(0);
    setImageBlobUrl((p) => {
      if (p) URL.revokeObjectURL(p);
      return '';
    });
    setShowEditor(false);
  };

  const openNewProduct = () => {
    setGalleryFocusIdx(0);
    setImageBlobUrl((p) => {
      if (p) URL.revokeObjectURL(p);
      return '';
    });
    setSelectedProduct(null);
    setFormData(emptyForm);
    setBarcodeLocked(false);
    setPrintType('barcode');
    setShowEditor(true);
  };

  const openProduct = (product) => {
    setGalleryFocusIdx(0);
    setImageBlobUrl((p) => {
      if (p) URL.revokeObjectURL(p);
      return '';
    });
    const urls = normalizeProductGallery(product);
    setSelectedProduct(product);
    setFormData({
      ...emptyForm,
      ...product,
      cny_price: product.cny_price || 0,
      min_quantity: product.min_quantity || 0,
      image_urls: urls,
      image_url: urls[0] || '',
    });
    setBarcodeLocked(true);
    setPrintType('barcode');
    setShowEditor(true);
  };

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const buildSavePayload = (allowDuplicateSku = false) => {
    const payload = {
      ...formData,
      quantity: Number(formData.quantity) || 0,
      min_quantity: Number(formData.min_quantity) || 0,
      purchase_price: Number(formData.purchase_price) || 0,
      sale_price: Number(formData.sale_price) || 0,
      cny_price: Number(formData.cny_price) || 0,
    };
    if (allowDuplicateSku) payload.allow_duplicate_sku = true;
    if (!formData.id && templateGallerySourceIdRef.current) {
      payload.copy_gallery_from_product_id = templateGallerySourceIdRef.current;
    }
    return payload;
  };

  const closeSkuConflict = () => {
    setSkuConflictOpen(false);
    setSkuConflictExisting(null);
    setSkuConflictSku('');
    setSkuConflictPayload(null);
    skuOpenAfterSaveRef.current = null;
  };

  const handleSave = async () => {
    if (!formData.name || Number(formData.purchase_price) <= 0 || Number(formData.sale_price) <= 0) {
      toast.error('Укажите название, себестоимость и стоимость продажи');
      return;
    }

    const payload = buildSavePayload();
    const sku = String(formData.sku || '').trim();
    if (sku) {
      try {
        const r = await productsApi.getBySku(sku, {
          allow404: true,
          excludeId: formData.id || undefined,
        });
        if (r?.status === 200 && r?.data) {
          setSkuConflictSku(sku);
          setSkuConflictExisting(r.data);
          setSkuConflictPayload(payload);
          skuOpenAfterSaveRef.current = null;
          setSkuConflictOpen(true);
          return;
        }
      } catch {
        /* fallback: API вернёт SKU_EXISTS */
      }
    }
    saveMutation.mutate(payload);
  };

  const handleSkuConflictSaveAnyway = () => {
    if (!skuConflictPayload) {
      closeSkuConflict();
      return;
    }
    saveMutation.mutate(buildSavePayload(true));
    closeSkuConflict();
  };

  const handleSkuConflictShowExisting = () => {
    const existing = skuConflictExisting;
    // #region agent log
    fetch('http://127.0.0.1:7415/ingest/64fc1600-807a-4c4b-afeb-2d3cf2e15696',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'91a77d'},body:JSON.stringify({sessionId:'91a77d',runId:'post-fix',hypothesisId:'H1',location:'Warehouse.jsx:handleSkuConflictShowExisting',message:'show existing clicked',data:{existingId:existing?.id,willSaveDuplicate:false},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    closeSkuConflict();
    if (existing?.id) {
      openProduct(existing);
    }
  };

  const handleSkuConflictCopyTemplate = () => {
    const existing = skuConflictExisting;
    if (!existing) {
      closeSkuConflict();
      return;
    }
    const sku = skuConflictSku || String(formData.sku || '').trim();
    setFormData((prev) => applyWarehouseFormTemplate(prev, existing, { keepSku: sku }));
    templateGallerySourceIdRef.current = existing?.id ?? null;
    closeSkuConflict();
    toast.success('Данные скопированы');
  };

  const productImageDisplaySrc = (url) => {
    const base = (url || '').split('?')[0].trim();
    if (!base) return '';
    return `${resolveUploadedAssetUrl(base)}?v=${imagePreviewBust}`;
  };

  const productImageThumbSrc = () => {
    if (imageBlobUrl) return imageBlobUrl;
    const urls = formData.image_urls || [];
    const u = urls[galleryFocusIdx] ?? urls[0];
    if (u) return productImageDisplaySrc(u);
    return '';
  };

  const handleUploadImage = async (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    if (!files.length) return;
    if (!formData.id) {
      toast.error('Сначала сохраните товар, потом загрузите фото');
      return;
    }
    const bad = files.find((f) => !f.type.startsWith('image/'));
    if (bad) {
      toast.error('Выберите файлы изображений');
      return;
    }
    let slots = MAX_PRODUCT_PHOTOS - (formData.image_urls || []).length;
    if (slots <= 0) {
      toast.error(`Не больше ${MAX_PRODUCT_PHOTOS} фото`);
      return;
    }
    const queue = files.slice(0, slots);
    if (files.length > queue.length) {
      toast.error(`Максимум ${MAX_PRODUCT_PHOTOS} фото на товар`);
    }
    setImageBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return queue[0] ? URL.createObjectURL(queue[0]) : '';
    });
    setImageUploading(true);
    setImageUploadPct(0);
    try {
      let lastResponse = null;
      for (let i = 0; i < queue.length; i += 1) {
        const file = queue[i];
        const response = await productsApi.uploadProductImage(formData.id, file, {
          onUploadProgress: (ev) => {
            const slice = 100 / queue.length;
            const base = (i / queue.length) * 100;
            if (ev.total) {
              const local = Math.min(100, Math.round((ev.loaded * 100) / ev.total));
              setImageUploadPct(Math.min(100, Math.round(base + (local / 100) * slice)));
            } else {
              setImageUploadPct((p) => (p == null ? Math.round(base + slice * 0.1) : Math.min(99, (p || 0) + 2)));
            }
          },
        });
        lastResponse = response;
        const urls = response?.data?.image_urls;
        if (!Array.isArray(urls) || !urls.length) {
          toast.error('Сервер не вернул список фото');
          return;
        }
        setFormData((prev) => ({ ...prev, image_urls: urls, image_url: urls[0] || '' }));
        setSelectedProduct((prev) => (prev ? { ...prev, image_urls: urls, image_url: urls[0] || '' } : prev));
        setGalleryFocusIdx(urls.length - 1);
      }
      setImagePreviewBust(Date.now());
      setImageBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return '';
      });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      const w = lastResponse?.data?.width;
      const h = lastResponse?.data?.height;
      const b = lastResponse?.data?.size_bytes;
      const dim = w && h ? ` ${w}×${h} px` : '';
      const sz = b != null ? `, ${(b / 1024).toFixed(1)} КБ` : '';
      const n = queue.length;
      toast.success(n > 1 ? `Загружено фото: ${n}${dim}${sz}` : `Фото сохранено${dim}${sz}`);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось загрузить фото'));
    } finally {
      setImageUploading(false);
      setImageUploadPct(null);
    }
  };

  const handleDeleteGalleryOne = async (url) => {
    if (!formData.id) {
      toast.error('Сначала сохраните товар');
      return;
    }
    const base = basenameFromProductImageUrl(url);
    if (!base) return;
    try {
      const { data } = await productsApi.deleteProductGalleryImage(formData.id, base);
      const urls = Array.isArray(data?.image_urls) ? data.image_urls : [];
      setFormData((prev) => ({ ...prev, image_urls: urls, image_url: urls[0] || '' }));
      setSelectedProduct((prev) => (prev ? { ...prev, image_urls: urls, image_url: urls[0] || '' } : prev));
      setGalleryFocusIdx((idx) => {
        if (!urls.length) return 0;
        return Math.min(idx, urls.length - 1);
      });
      setImagePreviewBust(Date.now());
      setImageBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return '';
      });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Фото удалено');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось удалить фото'));
    }
  };

  const handleDeleteImage = async () => {
    if (!formData.id) {
      toast.error('Сначала сохраните товар');
      return;
    }
    if (!(formData.image_urls || []).length) return;
    try {
      await productsApi.deleteProductImage(formData.id);
      setFormData((prev) => ({ ...prev, image_url: '', image_urls: [] }));
      setSelectedProduct((prev) => (prev ? { ...prev, image_url: '', image_urls: [] } : prev));
      setGalleryFocusIdx(0);
      setImagePreviewBust(Date.now());
      setImageBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return '';
      });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Все фото удалены');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Не удалось удалить фото'));
    }
  };

  return (
    <div className="page-stack">
      <section className="hero-panel">
        <div>
          <div className="eyebrow">Catalog</div>
          <h1 className="page-title">Складской каталог</h1>
          <p className="page-subtitle">
            Таблица товаров с быстрым поиском, редактированием карточки и печатью штрих-кодов или QR-кодов.
          </p>
        </div>
        <div className="hero-actions">
          <Button onClick={openNewProduct}>Добавить товар</Button>
        </div>
      </section>

      <section className="surface-card">
        <div className="section-header">
          <div>
            <h2 className="section-title">Товары</h2>
            <p className="section-note">Умный поиск ищет по названию, бренду, SKU, штрих-коду и ячейке хранения.</p>
          </div>
          <div className="warehouse-toolbar">
            <input
              className="form-input search-input"
              placeholder="Поиск по любой зацепке: oil, bos, 123, a11..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <button
              type="button"
              className="button button-secondary"
              onClick={() => setShowCameraScanner(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
            >
              <FiCamera size={16} /> Камера
            </button>
          </div>
        </div>

        <div className="warehouse-table-wrap">
          <table className="table warehouse-table">
            <thead>
              <tr>
                <th>Товар</th>
                <th>Код</th>
                <th>Остаток</th>
                <th>Себест.</th>
                <th>Цена</th>
                <th>Локация</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {filteredProducts.map((product) => {
                const low = Number(product.quantity) <= Number(product.min_quantity || 0);
                return (
                  <tr key={product.id} className="clickable-row" onClick={() => openProduct(product)}>
                    <td>
                      <div style={{ fontWeight: 700 }}>{product.name}</div>
                      <div className="muted-text">{product.brand || 'Без бренда'} {product.category ? `· ${product.category}` : ''}</div>
                    </td>
                    <td>
                      <div>{product.sku}</div>
                      <div className="muted-text">{product.barcode || 'Без штрих-кода'}</div>
                    </td>
                    <td>{Number(product.quantity).toLocaleString('ru-RU')} шт.</td>
                    <td>{Number(product.purchase_price).toLocaleString('ru-RU')} тг.</td>
                    <td>{Number(product.sale_price).toLocaleString('ru-RU')} тг.</td>
                    <td>{[product.location_zone, product.location_row, product.location_shelf, product.location_position].filter(Boolean).join('-') || 'Не задана'}</td>
                    <td>
                      <Badge variant={low ? 'warning' : 'success'}>
                        {low ? 'Низкий остаток' : 'В норме'}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!filteredProducts.length && !isLoading && <div className="empty-grid-state">Товары не найдены.</div>}
        </div>
      </section>

      <Modal
        isOpen={showEditor}
        onClose={closeEditor}
        title={formData.id ? `Карточка товара #${formData.id}` : 'Новый товар'}
        size="lg"
      >
        <div className="details-stack">
          <div className="details-grid">
            <div className="detail-block">
              <span className="detail-label">ID товара</span>
              <strong>{formData.id || 'Будет присвоен автоматически'}</strong>
            </div>
          </div>

          <div className="form-grid-two">
            <Input
              label="Название"
              value={formData.name}
              onChange={(event) => handleChange('name', event.target.value)}
            />
            <Input
              label="Бренд"
              value={formData.brand}
              onChange={(event) => handleChange('brand', event.target.value)}
            />
            <Input
              label="Модель"
              value={formData.model || ''}
              onChange={(event) => handleChange('model', event.target.value)}
              placeholder="Например: CS35, V80"
            />
          </div>

          <div className="form-grid-two">
            <Input
              label="SKU"
              value={formData.sku}
              onChange={(event) => handleChange('sku', event.target.value)}
              placeholder="Если пусто, создастся автоматически"
            />
            <div>
              <label className="form-label">Штрих-код</label>
              <div className="barcode-lock-row">
                <input
                  className="form-input"
                  value={formData.barcode}
                  disabled={barcodeLocked}
                  onChange={(event) => handleChange('barcode', event.target.value)}
                  placeholder="Можно изменить после разблокировки"
                />
                <button
                  type="button"
                  className="lock-button"
                  onClick={() => setBarcodeLocked((prev) => !prev)}
                  title={barcodeLocked ? 'Разблокировать штрих-код' : 'Заблокировать штрих-код'}
                >
                  {barcodeLocked ? '🔒' : '🔓'}
                </button>
              </div>
            </div>
          </div>

          <div className="form-grid-two">
            <Input
              label="Категория"
              value={formData.category}
              onChange={(event) => handleChange('category', event.target.value)}
            />
            <Input
              label="Количество"
              type="number"
              min="0"
              value={formData.quantity}
              onChange={(event) => handleChange('quantity', event.target.value)}
            />
          </div>

          <div className="form-grid-three">
            <Input
              label="Себестоимость"
              type="number"
              min="0"
              step="0.01"
              value={formData.purchase_price}
              onChange={(event) => handleChange('purchase_price', event.target.value)}
            />
            <Input
              label="Стоимость"
              type="number"
              min="0"
              step="0.01"
              value={formData.sale_price}
              onChange={(event) => handleChange('sale_price', event.target.value)}
            />
            <Input
              label="Мин. остаток"
              type="number"
              min="0"
              value={formData.min_quantity}
              onChange={(event) => handleChange('min_quantity', event.target.value)}
            />
          </div>

          <div className="form-grid-three">
            <Input label="Зона" value={formData.location_zone} onChange={(event) => handleChange('location_zone', event.target.value)} />
            <Input label="Ряд" value={formData.location_row} onChange={(event) => handleChange('location_row', event.target.value)} />
            <Input label="Полка/позиция" value={`${formData.location_shelf || ''}${formData.location_position ? ` / ${formData.location_position}` : ''}`} readOnly />
          </div>

          <div className="form-grid-two">
            <Input label="Полка" value={formData.location_shelf} onChange={(event) => handleChange('location_shelf', event.target.value)} />
            <Input label="Позиция" value={formData.location_position} onChange={(event) => handleChange('location_position', event.target.value)} />
          </div>

          <label className="ui-label">
            Описание
            <textarea
              className="ui-textarea"
              rows="4"
              value={formData.description}
              onChange={(event) => handleChange('description', event.target.value)}
            />
          </label>

          <div className="surface-card" style={{ padding: 12 }}>
            <div className="section-note" style={{ marginBottom: 4 }}>
              Фото товара
            </div>
            <div className="muted-text" style={{ fontSize: 12, marginBottom: 10 }}>
              До {MAX_PRODUCT_PHOTOS} снимков · на сервере AVIF · сначала сохраните карточку
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 440 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div
                  style={{
                    width: 112,
                    height: 112,
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--surface)',
                    flexShrink: 0,
                  }}
                >
                  {productImageThumbSrc() ? (
                    <img
                      src={productImageThumbSrc()}
                      alt={formData.name || 'product'}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span className="muted-text" style={{ fontSize: 12 }}>Нет фото</span>
                  )}
                </div>
                <div style={{ flex: 1, minWidth: 180, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <label
                      className="button button-secondary"
                      style={{
                        cursor: formData.id && !imageUploading ? 'pointer' : 'not-allowed',
                        opacity: formData.id && !imageUploading ? 1 : 0.6,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      <FiPlus size={16} />
                      {imageUploading ? `Загрузка${imageUploadPct != null ? ` ${imageUploadPct}%` : '…'}` : 'Добавить фото'}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={handleUploadImage}
                        disabled={!formData.id || imageUploading || (formData.image_urls || []).length >= MAX_PRODUCT_PHOTOS}
                        style={{ display: 'none' }}
                      />
                    </label>
                    {(formData.image_urls || []).length > 0 && (
                      <button
                        type="button"
                        className="button button-secondary"
                        onClick={handleDeleteImage}
                        disabled={imageUploading}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, opacity: imageUploading ? 0.6 : 1 }}
                        title="Удалить все фотографии"
                      >
                        <FiTrash2 size={16} />
                        Удалить все
                      </button>
                    )}
                  </div>
                  {imageUploading && imageUploadPct != null && (
                    <div style={{ height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
                      <div
                        style={{
                          height: '100%',
                          width: `${imageUploadPct}%`,
                          background: 'linear-gradient(90deg, #6366f1, #7c3aed)',
                          transition: 'width 0.12s ease',
                        }}
                      />
                    </div>
                  )}
                  <div className="muted-text" style={{ fontSize: 11 }}>
                    {(formData.image_urls || []).length}/{MAX_PRODUCT_PHOTOS} · миниатюра — крупный просмотр
                  </div>
                </div>
              </div>
              {(formData.image_urls || []).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {(formData.image_urls || []).map((url, idx) => (
                    <div
                      key={`${url}-${idx}`}
                      style={{
                        position: 'relative',
                        width: 64,
                        height: 64,
                        borderRadius: 10,
                        border: galleryFocusIdx === idx ? '2px solid var(--primary)' : '1px solid var(--border)',
                        overflow: 'hidden',
                        background: 'var(--surface)',
                      }}
                    >
                      <button
                        type="button"
                        onClick={() => setGalleryFocusIdx(idx)}
                        style={{ width: '100%', height: '100%', padding: 0, border: 'none', cursor: 'pointer', display: 'block' }}
                        title="Крупный просмотр"
                      >
                        <img src={productImageDisplaySrc(url)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); handleDeleteGalleryOne(url); }}
                        disabled={imageUploading || !formData.id}
                        title="Удалить"
                        style={{
                          position: 'absolute',
                          top: 2,
                          right: 2,
                          width: 24,
                          height: 24,
                          borderRadius: 8,
                          padding: 0,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: 'rgba(0,0,0,0.55)',
                          color: '#fff',
                          border: 'none',
                          cursor: imageUploading ? 'not-allowed' : 'pointer',
                          opacity: imageUploading ? 0.5 : 1,
                        }}
                      >
                        <FiX size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="modal-actions-bar">
            {formData.id && (
              <Button variant="secondary" onClick={() => setShowPrint(true)}>
                Печать кода
              </Button>
            )}
            <Button variant="secondary" onClick={closeEditor}>
              Закрыть
            </Button>
            <Button onClick={handleSave} loading={saveMutation.isPending}>
              Сохранить
            </Button>
          </div>
        </div>
      </Modal>

      <SkuConflictModal
        isOpen={skuConflictOpen}
        sku={skuConflictSku}
        existing={skuConflictExisting}
        saving={saveMutation.isPending}
        onCancel={closeSkuConflict}
        onSaveAnyway={handleSkuConflictSaveAnyway}
        onShowExisting={handleSkuConflictShowExisting}
        onCopyTemplate={handleSkuConflictCopyTemplate}
      />

      <LabelPrint
        isOpen={showPrint}
        onClose={() => setShowPrint(false)}
        product={formData.id ? formData : null}
        initialLabelLayout={readStoredLabelLayout()}
        labelSize="medium"
      />
      <CameraBarcodeScanner
        isOpen={showCameraScanner}
        onClose={() => setShowCameraScanner(false)}
        onDetected={(code) => {
          const normalized = normalizeScanCode(code);
          if (!normalized) return;
          const found = products.find((p) => {
            const pb = normalizeScanCode(p.barcode);
            const ps = normalizeScanCode(p.sku);
            return (pb && pb === normalized) || (ps && ps === normalized);
          });
          if (found) {
            openProduct(found);
            return;
          }
          setSearch(normalized);
          toast.error('Товар с таким кодом не найден');
        }}
      />
    </div>
  );
};

export default Warehouse;

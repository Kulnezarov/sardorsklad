import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import LabelPrint from '../components/LabelPrint';
import { productsApi } from '../api/products';
import { resolveUploadedAssetUrl } from '../api/client';
import { settingsApi } from '../api/settings';
import { Button, Modal, Input, Badge } from '../components/ui';

const emptyForm = {
  id: null,
  name: '',
  sku: '',
  barcode: '',
  brand: '',
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

const Warehouse = () => {
  const [search, setSearch] = useState('');
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [showEditor, setShowEditor] = useState(false);
  const [showPrint, setShowPrint] = useState(false);
  const [barcodeLocked, setBarcodeLocked] = useState(true);
  const [printType, setPrintType] = useState('barcode');
  const [formData, setFormData] = useState(emptyForm);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageUploadPct, setImageUploadPct] = useState(null);
  const [imagePreviewBust, setImagePreviewBust] = useState(0);
  const [imageBlobUrl, setImageBlobUrl] = useState('');
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
    mutationFn: (payload) =>
      payload.id
        ? productsApi.updateProduct(payload.id, payload)
        : productsApi.createProduct(payload),
    onSuccess: (response) => {
      const saved = response.data;
      toast.success(formData.id ? 'Товар обновлён' : 'Товар создан');
      queryClient.invalidateQueries({ queryKey: ['products'] });
      setSelectedProduct(saved);
      setFormData(saved);
    },
    onError: (error) => {
      toast.error(error.response?.data?.detail || 'Не удалось сохранить товар');
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
        product.category,
        `${product.location_zone} ${product.location_row} ${product.location_shelf} ${product.location_position}`,
      ].some((field) => fuzzyMatch(search, field))
    );
  }, [products, search]);

  const closeEditor = () => {
    setImageBlobUrl((p) => {
      if (p) URL.revokeObjectURL(p);
      return '';
    });
    setShowEditor(false);
  };

  const openNewProduct = () => {
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
    setImageBlobUrl((p) => {
      if (p) URL.revokeObjectURL(p);
      return '';
    });
    setSelectedProduct(product);
    setFormData({
      ...emptyForm,
      ...product,
      cny_price: product.cny_price || 0,
      min_quantity: product.min_quantity || 0,
    });
    setBarcodeLocked(true);
    setPrintType('barcode');
    setShowEditor(true);
  };

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    if (!formData.name || Number(formData.purchase_price) <= 0 || Number(formData.sale_price) <= 0) {
      toast.error('Укажите название, себестоимость и стоимость продажи');
      return;
    }

    saveMutation.mutate({
      ...formData,
      quantity: Number(formData.quantity) || 0,
      min_quantity: Number(formData.min_quantity) || 0,
      purchase_price: Number(formData.purchase_price) || 0,
      sale_price: Number(formData.sale_price) || 0,
      cny_price: Number(formData.cny_price) || 0,
    });
  };

  const productImageDisplaySrc = (url) => {
    const base = (url || '').split('?')[0].trim();
    if (!base) return '';
    return `${resolveUploadedAssetUrl(base)}?v=${imagePreviewBust}`;
  };

  const productImageThumbSrc = () => {
    if (imageBlobUrl) return imageBlobUrl;
    if (formData.image_url) return productImageDisplaySrc(formData.image_url);
    return '';
  };

  const handleUploadImage = async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!formData.id) {
      toast.error('Сначала сохраните товар, потом загрузите фото');
      return;
    }
    if (!file.type.startsWith('image/')) {
      toast.error('Выберите файл изображения');
      return;
    }
    setImageBlobUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
    setImageUploading(true);
    setImageUploadPct(0);
    try {
      const response = await productsApi.uploadProductImage(formData.id, file, {
        onUploadProgress: (ev) => {
          if (ev.total) {
            setImageUploadPct(Math.min(100, Math.round((ev.loaded * 100) / ev.total)));
          } else {
            setImageUploadPct((p) => (p == null ? 5 : Math.min(95, (p || 0) + 8)));
          }
        },
      });
      const imageUrl = (response?.data?.image_url || '').split('?')[0].trim();
      if (!imageUrl) {
        toast.error('Сервер не вернул путь к фото');
        return;
      }
      setFormData((prev) => ({ ...prev, image_url: imageUrl }));
      setImagePreviewBust(Date.now());
      setImageBlobUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return '';
      });
      setSelectedProduct((prev) => (prev ? { ...prev, image_url: imageUrl } : prev));
      queryClient.invalidateQueries({ queryKey: ['products'] });
      toast.success('Фото товара обновлено');
    } catch (error) {
      toast.error(error.response?.data?.detail || 'Не удалось загрузить фото');
    } finally {
      setImageUploading(false);
      setImageUploadPct(null);
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
            <div className="detail-block">
              <span className="detail-label">Формат печати</span>
              <select
                className="form-select"
                value={printType}
                onChange={(event) => setPrintType(event.target.value)}
              >
                <option value="barcode">Штрих-код</option>
                <option value="qrcode">QR-код</option>
              </select>
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
            <div className="section-note" style={{ marginBottom: 8 }}>
              Фото товара
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 360 }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                <div
                  style={{
                    width: 96,
                    height: 96,
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--surface)',
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
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label className="button button-secondary" style={{ cursor: formData.id && !imageUploading ? 'pointer' : 'not-allowed', opacity: formData.id && !imageUploading ? 1 : 0.6, display: 'inline-block' }}>
                    {imageUploading ? `Загрузка${imageUploadPct != null ? ` ${imageUploadPct}%` : '...'}` : formData.image_url ? 'Заменить фото' : 'Загрузить фото'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={handleUploadImage}
                      disabled={!formData.id || imageUploading}
                      style={{ display: 'none' }}
                    />
                  </label>
                  {imageUploading && imageUploadPct != null && (
                    <div style={{ marginTop: 8, height: 6, borderRadius: 4, background: 'var(--border)', overflow: 'hidden' }}>
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
                </div>
              </div>
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

      <LabelPrint
        isOpen={showPrint}
        onClose={() => setShowPrint(false)}
        product={formData.id ? formData : null}
        settings={settings}
        initialLabelType={printType}
      />
    </div>
  );
};

export default Warehouse;

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import * as XLSX from 'xlsx';
import {
  FiPlus, FiX, FiPackage, FiTruck, FiShoppingCart, FiCheck,
  FiCamera, FiTrash2, FiEdit2, FiRefreshCw,
  FiChevronDown, FiChevronRight, FiAlertTriangle, FiRotateCcw, FiSearch,
  FiDownload, FiBox,
} from 'react-icons/fi';
import { wishApi, poApi } from '../api/reserve';
import { settingsApi } from '../api/settings';
import { categoryApi, compatibilityApi, fetchAllProducts, getApiErrorMessage } from '../api/client';
import { generateEAN13 } from '../utils/barcodeGen';
import CategoryPicker, { findCategoryInTree, findGroupIdForCategory } from '../components/CategoryPicker';
import ProductFormByLayout from '../components/ProductFormByLayout';
import VehicleCompatibilityPicker from '../components/VehicleCompatibilityPicker';
import EngineFamilyPicker from '../components/EngineFamilyPicker';
import {
  categoryTreeQueryKey,
  isEngineCodeRequired,
  isEngineCodeSingle,
  layoutHasCompatibility,
  layoutHasEngineCode,
  normalizeFormLayout,
  resolveCategorySchemaForProduct,
} from '../utils/formLayoutUtils';

function normalizeCompatIds(ids) {
  if (!ids?.length) return [];
  return [...new Set(ids.map((x) => Number(x)).filter((n) => Number.isFinite(n) && n > 0))];
}

/* ── helpers ── */
const num = (v) => { const n = parseFloat(String(v || 0).replace(',', '.')); return Number.isFinite(n) ? n : 0; };
const money = (v) => Number(v || 0).toLocaleString('ru-RU');
const daysSince = (dateStr) => {
  if (!dateStr) return 0;
  const diff = Date.now() - new Date(dateStr).getTime();
  return Math.floor(diff / 86_400_000);
};
const daysLabel = (n) => {
  if (n === 0) return 'сегодня';
  if (n === 1) return '1 день';
  if (n <= 4) return `${n} дня`;
  return `${n} дней`;
};
const asArray = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.data)) return data.data;
  return [];
};

/* Resize image to max 700px wide, JPEG 70% */
async function resizePhoto(file) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 700;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.7));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

const CAT_COLORS = [
  { bg: 'rgba(99,102,241,0.14)', color: '#4338ca' },
  { bg: 'rgba(16,185,129,0.14)', color: '#047857' },
  { bg: 'rgba(245,158,11,0.14)', color: '#b45309' },
  { bg: 'rgba(239,68,68,0.14)', color: '#b91c1c' },
  { bg: 'rgba(6,182,212,0.14)', color: '#0e7490' },
  { bg: 'rgba(168,85,247,0.14)', color: '#7e22ce' },
];
function getCatColor(cat) {
  if (!cat) return CAT_COLORS[0];
  let h = 0;
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) & 0xfffff;
  return CAT_COLORS[h % CAT_COLORS.length];
}

function categoryLabelForItem(item, categoryTree) {
  if (item?.category_id) {
    const sub = findCategoryInTree(categoryTree, item.category_id);
    if (sub) {
      const group = categoryTree.find((g) => (g.children || []).some((c) => c.id === item.category_id));
      return group ? `${group.name} · ${sub.name}` : sub.name;
    }
  }
  return item?.category || '';
}

function normalizeSearch(s) {
  return String(s || '').trim().toLowerCase();
}

/* ── Photo Upload Zone ── */
function PhotoZone({ photoData, onPhoto, onRemove }) {
  const inputRef = useRef(null);

  const handleFile = async (file) => {
    if (!file || !file.type.startsWith('image/')) { toast.error('Только изображения (jpg, png, webp)'); return; }
    const resized = await resizePhoto(file);
    onPhoto(resized);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  if (photoData) {
    return (
      <div style={{ position: 'relative', borderRadius: 16, overflow: 'hidden', height: 160, background: '#000' }}>
        <img src={photoData} alt="preview" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
        <button
          type="button"
          onClick={onRemove}
          style={{ position: 'absolute', top: 8, right: 8, width: 30, height: 30, borderRadius: '50%', background: 'rgba(0,0,0,0.55)', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <FiX size={15} />
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      style={{ height: 160, borderRadius: 16, border: '2px dashed var(--border)', background: 'var(--ios-grouped-bg)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, cursor: 'pointer', transition: 'border-color 0.15s' }}
    >
      <FiCamera size={28} style={{ color: 'var(--text-muted)' }} />
      <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 600 }}>Нажмите чтобы загрузить фото</div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>jpg, png, webp</div>
      <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
    </div>
  );
}

/* ── Wish Card ── */
function WishCard({ item, categoryLabel, stockProduct, carsLabel, onOrder, onEdit, onDelete, index = 0 }) {
  const cat = getCatColor(categoryLabel || item.category);
  const qty = item.quantity || 1;
  return (
    <article className="wish-card" style={{ '--card-i': Math.min(index, 8) }}>
      <div className="wish-card-photo">
        {item.photo_data
          ? <img src={item.photo_data} alt={item.name} />
          : <div className="wish-card-photo-placeholder"><FiPackage size={26} /><span>Нет фото</span></div>
        }
        <span className="wish-card-qty-pill">{qty} шт.</span>
      </div>
      <div className="wish-card-body">
        <div className="wish-card-top">
          <h3 className="wish-card-title">{item.name}</h3>
          <div className="wish-card-actions">
            <button type="button" onClick={() => onEdit(item)} className="wish-icon-btn" aria-label="Редактировать"><FiEdit2 size={13} /></button>
            <button type="button" onClick={() => onDelete(item)} className="wish-icon-btn wish-icon-btn-danger" aria-label="Удалить"><FiTrash2 size={13} /></button>
          </div>
        </div>
        <div className="wish-card-meta">
          {categoryLabel && (
            <span className="wish-pill" style={{ background: cat.bg, color: cat.color }}>{categoryLabel}</span>
          )}
          {stockProduct && (
            <span className="wish-pill wish-pill--stock">
              <FiBox size={11} /> Склад: {stockProduct.quantity ?? 0}
            </span>
          )}
        </div>
        {carsLabel && <p className="wish-card-cars">Авто: {carsLabel}</p>}
        {item.notes && <p className="wish-card-notes">{item.notes}</p>}
        <button type="button" onClick={() => onOrder(item)} className="wish-order-btn">
          Заказать
        </button>
      </div>
    </article>
  );
}

/* ── PO Card (mobile + compact) ── */
function PoCard({
  po, categoryLabel, stockQty, onAccept, onCancel, onRestore, onDelete, cancelled = false, index = 0,
}) {
  const days = daysSince(po.ordered_at);
  const remaining = po.quantity_ordered - po.quantity_received;
  const isPartial = po.status === 'partial';
  const pct = po.quantity_ordered ? po.quantity_received / po.quantity_ordered : 0;
  const daysTone = days > 30 ? 'red' : days > 14 ? 'amber' : 'green';

  return (
    <article
      className={`po-card${isPartial ? ' po-card--partial' : ''}${cancelled ? ' po-card--cancelled' : ''}`}
      style={{ '--card-i': Math.min(index, 8) }}
    >
      <div className="po-card-head">
        <div className="po-thumb">
          {po.photo_data
            ? <img src={po.photo_data} alt={po.name} />
            : <FiPackage size={20} />
          }
        </div>
        <div className="po-card-head-text">
          <div className="po-card-title">{po.name}</div>
          <div className="po-card-sub">
            {[categoryLabel, stockQty != null ? `склад ${stockQty}` : null].filter(Boolean).join(' · ') || '—'}
          </div>
        </div>
        {!cancelled && (
          <span className={`po-status-badge ${isPartial ? 'po-status-partial' : 'po-status-transit'}`}>
            {isPartial ? 'Частично' : 'В пути'}
          </span>
        )}
        {cancelled && <span className="po-status-badge po-status-cancelled">Отменён</span>}
      </div>

      <div className="po-card-grid">
        <div className="po-card-cell">
          <span className="po-card-label">Кол-во</span>
          <span className="po-card-value">
            {isPartial ? `${remaining} / ${po.quantity_ordered}` : `${po.quantity_ordered} шт.`}
          </span>
          {isPartial && (
            <div className="po-progress-bar">
              <div className="po-progress-fill" style={{ width: `${pct * 100}%` }} />
            </div>
          )}
        </div>
        <div className="po-card-cell">
          <span className="po-card-label">Цена ¥</span>
          <span className="po-card-value">
            {po.price_cny != null ? `¥ ${money(po.price_cny)}` : '—'}
          </span>
          {po.price_kzt != null && (
            <span className="po-card-hint">≈ ₸ {money(po.price_kzt)}</span>
          )}
        </div>
        <div className="po-card-cell">
          <span className="po-card-label">В пути</span>
          <span className={`days-badge days-badge-${daysTone}`}>{daysLabel(days)}</span>
        </div>
        {po.barcode && (
          <div className="po-card-cell po-card-cell--wide">
            <span className="po-card-label">Штрих-код</span>
            <span className="po-card-value po-card-mono">{po.barcode}</span>
          </div>
        )}
      </div>

      <div className="po-card-actions">
        {cancelled ? (
          <>
            <button type="button" onClick={onRestore} className="po-action-btn po-action-amber">
              <FiRotateCcw size={13} /> Восстановить
            </button>
            <button type="button" onClick={onDelete} className="po-action-btn po-action-red">
              <FiTrash2 size={13} />
            </button>
          </>
        ) : (
          <>
            <button type="button" onClick={onAccept} className="po-action-btn po-action-green">
              <FiCheck size={13} /> {isPartial ? 'Принять ещё' : 'Принять'}
            </button>
            <button type="button" onClick={onCancel} className="po-action-btn po-action-red">
              <FiX size={13} /> Отменить
            </button>
          </>
        )}
      </div>
    </article>
  );
}

/* ── Modal wrapper ── */
function Modal({ isOpen, onClose, title, children, maxWidth = 480, tall = false }) {
  if (!isOpen) return null;
  return createPortal(
    <div className="reserve-modal-overlay" onClick={onClose}>
      <div
        className={`reserve-modal-box${tall ? ' reserve-modal-box--tall' : ''}`}
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth }}
      >
        <div className="reserve-modal-grab" aria-hidden="true" />
        <div className="reserve-modal-header">
          <div className="reserve-modal-title">{title}</div>
          <button type="button" onClick={onClose} className="reserve-modal-close" aria-label="Закрыть">
            <FiX size={16} />
          </button>
        </div>
        <div className="reserve-modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/* ── Field ── */
function Field({ label, children, required }) {
  return (
    <div className="reserve-field">
      <label className="reserve-field-label">
        {label}{required && <span className="reserve-field-req">*</span>}
      </label>
      {children}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════
   MAIN PAGE COMPONENT
══════════════════════════════════════════════════════════════════════════════ */
const Reserve = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const prefillApplied = useRef(false);

  // ── Tabs ──
  const [mainTab, setMainTab] = useState('wish');      // 'wish' | 'orders'
  const [partialFilter, setPartialFilter] = useState(false);
  const [showCancelledBlock, setShowCancelledBlock] = useState(false);
  const [wishSearch, setWishSearch] = useState('');
  const [wishCategoryFilter, setWishCategoryFilter] = useState(null); // null | groupId | categoryId (negative group = -groupId)

  // ── Modal state ──
  const [showWishModal, setShowWishModal] = useState(false);
  const [editWish, setEditWish] = useState(null);       // WishItem being edited
  const [orderWish, setOrderWish] = useState(null);     // WishItem being ordered → PO modal
  const [acceptPO, setAcceptPO] = useState(null);       // PurchaseOrder being accepted
  const [showNameSuggestions, setShowNameSuggestions] = useState(false);

  // ── Wish form ──
  const emptyWish = () => ({
    name: '', brand: '', category: '', category_group_id: null, category_id: null,
    product_id: null, quantity: 1, compatibility_vehicle_model_ids: [],
    notes: '', photo_data: '',
  });
  const [wishForm, setWishForm] = useState(emptyWish());
  const [wishCompatKey, setWishCompatKey] = useState(0);

  // ── Order (PurchaseOrder) form ──
  const [poForm, setPoForm] = useState({
    barcode: '', supplier: '', price_cny: '', quantity_ordered: 1, notes: '',
    name: '', category_group_id: null, category_id: null, category: '',
  });

  // ── Accept form ──
  const emptyAccept = () => ({
    quantity_received: 1, purchase_price_kzt: '', delivery_cost_kzt: '', sale_price_kzt: '',
    storage_location: '', keep_remainder: true, notes: '', showExtra: false,
    brand: '', model: '', attributes: {},
    compatibility_vehicle_model_ids: [],
    compatibility_engine_family_ids: [],
  });
  const [acceptForm, setAcceptForm] = useState(emptyAccept());
  const [acceptCompatKey, setAcceptCompatKey] = useState(0);
  const [acceptEngineKey, setAcceptEngineKey] = useState(0);

  // ── Data queries ──
  const { data: wishItems = [], isLoading: wishLoading } = useQuery({
    queryKey: ['wish-items'],
    queryFn: () => wishApi.list().then((r) => asArray(r.data)),
    staleTime: 30_000,
  });

  const { data: purchaseOrders = [], isLoading: poLoading } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => poApi.list().then((r) => asArray(r.data)),
    staleTime: 30_000,
  });

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.getSettings().then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products'],
    queryFn: () => fetchAllProducts(),
    staleTime: 60_000,
  });

  const { data: categoryTree = [] } = useQuery({
    queryKey: categoryTreeQueryKey(true),
    queryFn: () => categoryApi.getTree({ active_only: true }).then((r) => r.data),
    staleTime: 120_000,
  });

  const { data: vehicleBrands = [] } = useQuery({
    queryKey: ['compatibility', 'vehicle-brands'],
    queryFn: () => compatibilityApi.vehicleBrands().then((r) => r.data),
    staleTime: 60_000,
  });

  const { data: vehicleModels = [] } = useQuery({
    queryKey: ['compatibility', 'vehicle-models'],
    queryFn: () => compatibilityApi.vehicleModels().then((r) => r.data),
    staleTime: 60_000,
  });

  const cnyRate = Number(settings?.cny_rate || 67);

  const productsById = useMemo(() => {
    const map = new Map();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const carsLabelsForIds = useCallback((ids, { full = false } = {}) => {
    const list = normalizeCompatIds(ids);
    if (!list.length) return '';
    const labels = list
      .map((id) => {
        const m = vehicleModels.find((x) => Number(x.id) === id);
        if (!m) return null;
        const brand = vehicleBrands.find((b) => b.id === m.vehicle_brand_id);
        return brand ? `${brand.name} ${m.name}` : m.name;
      })
      .filter(Boolean);
    if (!labels.length) return `${list.length} мод.`;
    if (full || labels.length <= 2) return labels.join(', ');
    return `${labels.slice(0, 2).join(', ')} +${labels.length - 2}`;
  }, [vehicleModels, vehicleBrands]);

  const carsLabelForIds = useCallback(
    (ids) => carsLabelsForIds(ids, { full: false }),
    [carsLabelsForIds],
  );

  const categoryFilterOptions = useMemo(() => {
    const opts = [{ id: null, label: 'Все категории', count: wishItems.length }];
    categoryTree.forEach((g) => {
      const childIds = new Set((g.children || []).map((c) => c.id));
      const count = wishItems.filter((w) => w.category_id && childIds.has(w.category_id)).length;
      if (count > 0) {
        opts.push({ id: -g.id, label: g.name, count, groupId: g.id });
        (g.children || []).forEach((c) => {
          const cCount = wishItems.filter((w) => w.category_id === c.id).length;
          if (cCount > 0) opts.push({ id: c.id, label: `${g.name} · ${c.name}`, count: cCount });
        });
      }
    });
    return opts;
  }, [categoryTree, wishItems]);

  const filterWishItems = useCallback((items) => {
    let list = items;
    const q = normalizeSearch(wishSearch);
    if (q) {
      list = list.filter((w) => {
        const hay = `${w.name || ''} ${w.brand || ''} ${categoryLabelForItem(w, categoryTree)}`.toLowerCase();
        return hay.includes(q);
      });
    }
    if (wishCategoryFilter != null) {
      if (wishCategoryFilter < 0) {
        const groupId = -wishCategoryFilter;
        const group = categoryTree.find((g) => g.id === groupId);
        const childIds = new Set((group?.children || []).map((c) => c.id));
        list = list.filter((w) => w.category_id && childIds.has(w.category_id));
      } else {
        list = list.filter((w) => w.category_id === wishCategoryFilter);
      }
    }
    return list;
  }, [wishSearch, wishCategoryFilter, categoryTree]);

  const pendingWishItems = useMemo(
    () => filterWishItems(wishItems.filter((w) => w.status === 'pending')),
    [wishItems, filterWishItems],
  );

  const orderedWishItems = useMemo(
    () => filterWishItems(wishItems.filter((w) => w.status === 'ordered')),
    [wishItems, filterWishItems],
  );

  const nameSuggestions = useMemo(() => {
    const q = normalizeSearch(wishForm.name);
    if (q.length < 2) return [];
    return products
      .filter((p) => {
        const hay = `${p.name || ''} ${p.brand || ''} ${p.sku || ''}`.toLowerCase();
        return hay.includes(q);
      })
      .slice(0, 8);
  }, [wishForm.name, products]);

  const selectedWishSubcategory = useMemo(
    () => findCategoryInTree(categoryTree, wishForm.category_id),
    [categoryTree, wishForm.category_id],
  );

  const selectedWishSubcategorySchema = useMemo(
    () => resolveCategorySchemaForProduct(selectedWishSubcategory),
    [selectedWishSubcategory],
  );

  const selectedWishCategoryGroup = useMemo(() => {
    if (wishForm.category_group_id) {
      return categoryTree.find((g) => g.id === wishForm.category_group_id) || null;
    }
    if (wishForm.category_id) {
      return categoryTree.find((g) => (g.children || []).some((c) => c.id === wishForm.category_id)) || null;
    }
    return null;
  }, [categoryTree, wishForm.category_group_id, wishForm.category_id]);

  const acceptSubcategory = useMemo(
    () => (acceptPO ? findCategoryInTree(categoryTree, acceptPO.category_id) : null),
    [acceptPO, categoryTree],
  );

  const acceptSubcategorySchema = useMemo(
    () => resolveCategorySchemaForProduct(acceptSubcategory),
    [acceptSubcategory],
  );

  const acceptCategoryGroup = useMemo(() => {
    if (!acceptPO?.category_id) return null;
    return categoryTree.find((g) => (g.children || []).some((c) => c.id === acceptPO.category_id)) || null;
  }, [acceptPO, categoryTree]);

  const acceptProductLayout = useMemo(
    () => normalizeFormLayout(acceptSubcategorySchema?.form_layout, acceptSubcategorySchema),
    [acceptSubcategorySchema],
  );

  const showAcceptCompat = acceptPO?.category_id && layoutHasCompatibility(acceptProductLayout);
  const showAcceptEngine = acceptPO?.category_id && layoutHasEngineCode(acceptProductLayout)
    && isEngineCodeRequired(acceptSubcategorySchema?.engine_code_mode);
  const acceptEngineSingle = isEngineCodeSingle(acceptSubcategorySchema?.engine_code_mode);

  // ── Profit calc ──
  const acceptProfit = useMemo(() => {
    const cost = num(acceptForm.purchase_price_kzt) + num(acceptForm.delivery_cost_kzt);
    const sale = num(acceptForm.sale_price_kzt);
    if (!cost || !sale) return null;
    return ((sale - cost) / cost * 100).toFixed(1);
  }, [acceptForm.purchase_price_kzt, acceptForm.delivery_cost_kzt, acceptForm.sale_price_kzt]);

  // CNY → KZT live price
  const cnyKzt = useMemo(() => {
    const cny = num(poForm.price_cny);
    if (!cny) return null;
    return Math.round(cny * cnyRate);
  }, [poForm.price_cny, cnyRate]);

  // ── Filtered orders ──
  const activeOrders = useMemo(() =>
    purchaseOrders.filter((o) => {
      if (partialFilter) return o.status === 'partial';
      return o.status === 'in_transit' || o.status === 'partial';
    }), [purchaseOrders, partialFilter]);

  const cancelledOrders = useMemo(() =>
    purchaseOrders.filter((o) => o.status === 'cancelled'), [purchaseOrders]);

  const completedOrders = useMemo(() =>
    purchaseOrders.filter((o) => o.status === 'completed'), [purchaseOrders]);

  // ── Stats ──
  const totalExpected = useMemo(() =>
    activeOrders.reduce((s, o) => s + o.quantity_ordered - o.quantity_received, 0), [activeOrders]);

  const partialCount = useMemo(() =>
    activeOrders.filter((o) => o.status === 'partial').length, [activeOrders]);

  // ── Wish mutations ──
  const createWish = useMutation({
    mutationFn: (data) => wishApi.create(data),
    onSuccess: () => { queryClient.invalidateQueries(['wish-items']); toast.success('Добавлено в список'); setShowWishModal(false); setWishForm(emptyWish()); },
    onError: () => toast.error('Ошибка сохранения'),
  });

  const updateWish = useMutation({
    mutationFn: ({ id, data }) => wishApi.update(id, data),
    onSuccess: () => { queryClient.invalidateQueries(['wish-items']); toast.success('Сохранено'); setEditWish(null); setShowWishModal(false); setWishForm(emptyWish()); },
    onError: () => toast.error('Ошибка'),
  });

  const deleteWish = useMutation({
    mutationFn: (id) => wishApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries(['wish-items']); toast.success('Удалено'); },
    onError: () => toast.error('Ошибка удаления'),
  });

  // ── PO mutations ──
  const createPO = useMutation({
    mutationFn: (data) => poApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries(['purchase-orders']);
      queryClient.invalidateQueries(['wish-items']);
      toast.success('Заказ оформлен!');
      setOrderWish(null);
      setMainTab('orders');
    },
    onError: () => toast.error('Ошибка оформления заказа'),
  });

  const acceptMutation = useMutation({
    mutationFn: ({ id, data }) => poApi.accept(id, data),
    onSuccess: (res) => {
      queryClient.invalidateQueries(['purchase-orders']);
      queryClient.invalidateQueries(['products']);
      queryClient.invalidateQueries(['wish-items']);
      toast.success(res?.data?.merged ? 'Количество добавлено к товару на складе' : 'Товар добавлен в склад');
      setAcceptPO(null);
      setAcceptForm(emptyAccept());
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Ошибка приёмки')),
  });

  const cancelPO = useMutation({
    mutationFn: (id) => poApi.cancel(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['purchase-orders']);
      queryClient.invalidateQueries(['wish-items']);
      toast.success('Заказ отменён — позиция снова в «Нужно заказать»');
    },
  });

  const restorePO = useMutation({
    mutationFn: (id) => poApi.restore(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['purchase-orders']);
      queryClient.invalidateQueries(['wish-items']);
      toast.success('Заказ восстановлен');
    },
  });

  const deletePO = useMutation({
    mutationFn: (id) => poApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries(['purchase-orders']);
      queryClient.invalidateQueries(['wish-items']);
      toast.success('Удалено');
    },
  });

  const ordersBySupplier = useMemo(() => {
    const groups = new Map();
    activeOrders.forEach((po) => {
      const key = (po.supplier || '').trim() || 'Без поставщика';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(po);
    });
    return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ru'));
  }, [activeOrders]);

  const linkedProductForWish = useCallback((item) => {
    if (!item?.product_id) return null;
    return productsById.get(item.product_id) || null;
  }, [productsById]);

  const exportWishExcel = () => {
    const rows = pendingWishItems.map((w) => ({
      'Название': w.name || '',
      'Марка / модель': carsLabelsForIds(w.compatibility_vehicle_model_ids, { full: true }) || '',
      'Количество': w.quantity || 1,
      'Доп. информация': w.notes || '',
    }));
    if (!rows.length) {
      toast.error('Нет позиций для выгрузки');
      return;
    }
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Нужно заказать');
    const stamp = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `nuzhno_zakazat_${stamp}.xlsx`);
    toast.success('Excel скачан');
  };

  /** Дашборд / ссылка → открыть форму «Нужно заказать» с автозаполнением */
  useEffect(() => {
    const prefill = location.state?.prefillWish;
    if (!prefill || prefillApplied.current) return;
    prefillApplied.current = true;
    navigate('/reserve', { replace: true, state: {} });
    const categoryId = prefill.category_id ? Number(prefill.category_id) : null;
    setWishForm({
      name: prefill.name || '',
      brand: prefill.brand || '',
      category: prefill.category || '',
      category_group_id: findGroupIdForCategory(categoryTree, categoryId),
      category_id: Number.isFinite(categoryId) && categoryId > 0 ? categoryId : null,
      product_id: prefill.product_id || null,
      quantity: prefill.quantity || 1,
      compatibility_vehicle_model_ids: normalizeCompatIds(prefill.compatibility_vehicle_model_ids),
      notes: prefill.notes || '',
      photo_data: prefill.photo_data || '',
    });
    setWishCompatKey((k) => k + 1);
    setEditWish(null);
    setShowWishModal(true);
    setMainTab('wish');
    setShowNameSuggestions(false);
  }, [location.state, navigate, categoryTree]);

  /** Legacy URL ?autoWish=1 → форма, не автосохранение */
  useEffect(() => {
    if (searchParams.get('autoWish') !== '1') return;
    const name = (searchParams.get('name') || '').trim();
    if (!name) {
      navigate('/reserve', { replace: true });
      return;
    }
    const category = searchParams.get('category') || '';
    const categoryIdRaw = searchParams.get('category_id');
    const category_id = categoryIdRaw ? Number(categoryIdRaw) : null;
    const brand = searchParams.get('brand') || null;
    setWishForm({
      name,
      brand: brand || '',
      category,
      category_group_id: findGroupIdForCategory(categoryTree, category_id),
      category_id: Number.isFinite(category_id) && category_id > 0 ? category_id : null,
      product_id: null,
      quantity: 1,
      compatibility_vehicle_model_ids: [],
      notes: '',
      photo_data: '',
    });
    setWishCompatKey((k) => k + 1);
    setEditWish(null);
    setShowWishModal(true);
    setMainTab('wish');
    setShowNameSuggestions(false);
    navigate('/reserve', { replace: true });
  }, [searchParams, navigate, categoryTree]);

  useEffect(() => {
    if (!showWishModal || !wishForm.category_id || wishForm.category_group_id) return;
    const gid = findGroupIdForCategory(categoryTree, wishForm.category_id);
    if (gid) setWishForm((f) => ({ ...f, category_group_id: gid }));
  }, [showWishModal, wishForm.category_id, wishForm.category_group_id, categoryTree]);

  // ── Handlers ──
  const openAddWish = () => {
    setWishForm(emptyWish());
    setWishCompatKey((k) => k + 1);
    setEditWish(null);
    setShowWishModal(true);
    setShowNameSuggestions(false);
  };

  const openEditWish = (item) => {
    setEditWish(item);
    setWishForm({
      name: item.name,
      brand: item.brand || '',
      category: item.category || '',
      category_group_id: findGroupIdForCategory(categoryTree, item.category_id),
      category_id: item.category_id || null,
      product_id: item.product_id || null,
      quantity: item.quantity || 1,
      compatibility_vehicle_model_ids: normalizeCompatIds(item.compatibility_vehicle_model_ids),
      notes: item.notes || '',
      photo_data: item.photo_data || '',
    });
    setWishCompatKey((k) => k + 1);
    setShowWishModal(true);
    setShowNameSuggestions(false);
  };

  const handleWishCategoryChange = ({ groupId, categoryId }) => {
    const sub = findCategoryInTree(categoryTree, categoryId);
    setWishForm((prev) => ({
      ...prev,
      category_group_id: groupId,
      category_id: categoryId,
      category: sub?.name || prev.category,
      // смена категории сбрасывает привязку к складу, если выбрали другую
      product_id: prev.category_id && categoryId !== prev.category_id ? null : prev.product_id,
    }));
  };

  const applyProductSuggestion = (product) => {
    const gid = findGroupIdForCategory(categoryTree, product.category_id);
    const compatIds = (product.compatibility?.vehicle_models || []).map((x) => x.id);
    setWishForm((prev) => ({
      ...prev,
      name: product.name || prev.name,
      brand: product.brand || prev.brand,
      category_id: product.category_id || prev.category_id,
      category_group_id: gid || prev.category_group_id,
      category: product.category || prev.category,
      product_id: product.id,
      photo_data: product.image_url || prev.photo_data,
      compatibility_vehicle_model_ids: compatIds.length ? normalizeCompatIds(compatIds) : prev.compatibility_vehicle_model_ids,
    }));
    setWishCompatKey((k) => k + 1);
    setShowNameSuggestions(false);
  };

  const openOrderWish = (item) => {
    const linked = linkedProductForWish(item);
    setOrderWish(item);
    if (linked) {
      setPoForm({
        barcode: linked.barcode || '',
        supplier: linked.supplier || '',
        price_cny: linked.cny_price != null ? String(linked.cny_price) : '',
        quantity_ordered: item.quantity || 1,
        notes: item.notes || '',
        name: linked.name || item.name,
        category_group_id: findGroupIdForCategory(categoryTree, linked.category_id || item.category_id),
        category_id: linked.category_id || item.category_id || null,
        category: linked.category || item.category || '',
      });
    } else {
      setPoForm({
        barcode: generateEAN13(),
        supplier: '',
        price_cny: '',
        quantity_ordered: item.quantity || 1,
        notes: item.notes || '',
        name: item.name || '',
        category_group_id: findGroupIdForCategory(categoryTree, item.category_id),
        category_id: item.category_id || null,
        category: item.category || '',
      });
    }
  };

  const openAccept = (po) => {
    setAcceptPO(po);
    const remaining = po.quantity_ordered - po.quantity_received;
    const linked = po.product_id ? productsById.get(po.product_id) : null;
    const barcodeMatch = !linked && po.barcode
      ? products.find((p) => p.barcode && p.barcode === po.barcode)
      : null;
    const existing = linked || barcodeMatch;
    setAcceptForm({
      ...emptyAccept(),
      quantity_received: remaining,
      purchase_price_kzt: po.price_kzt
        ? String(Math.round(Number(po.price_kzt)))
        : (existing?.purchase_price != null ? String(Math.round(Number(existing.purchase_price))) : ''),
      sale_price_kzt: existing?.sale_price != null ? String(Math.round(Number(existing.sale_price))) : '',
      delivery_cost_kzt: existing?.delivery_cost_kzt != null ? String(Math.round(Number(existing.delivery_cost_kzt))) : '',
      notes: po.notes || '',
      brand: po.brand || existing?.brand || '',
      compatibility_vehicle_model_ids: [],
    });
    setAcceptCompatKey((k) => k + 1);
    setAcceptEngineKey((k) => k + 1);
  };

  const acceptExistingProduct = useMemo(() => {
    if (!acceptPO) return null;
    if (acceptPO.product_id) return productsById.get(acceptPO.product_id) || null;
    if (acceptPO.barcode) return products.find((p) => p.barcode && p.barcode === acceptPO.barcode) || null;
    return null;
  }, [acceptPO, productsById, products]);

  const orderLinkedProduct = useMemo(() => {
    if (!orderWish?.product_id) return null;
    return productsById.get(orderWish.product_id) || null;
  }, [orderWish, productsById]);

  const saveWish = () => {
    if (!wishForm.category_id) { toast.error('Выберите категорию'); return; }
    if (!wishForm.name.trim()) { toast.error('Введите название'); return; }
    const data = {
      name: wishForm.name.trim(),
      brand: wishForm.brand || null,
      category_id: wishForm.category_id,
      product_id: wishForm.product_id || null,
      quantity: Number(wishForm.quantity) || 1,
      compatibility_vehicle_model_ids: normalizeCompatIds(wishForm.compatibility_vehicle_model_ids),
      notes: wishForm.notes || null,
      photo_data: wishForm.photo_data || null,
    };
    if (editWish) updateWish.mutate({ id: editWish.id, data });
    else createWish.mutate(data);
  };

  const saveOrder = () => {
    if (!orderWish) return;
    const isExisting = Boolean(orderWish.product_id && orderLinkedProduct);
    if (!isExisting) {
      if (!poForm.category_id) { toast.error('Выберите категорию'); return; }
      if (!poForm.name.trim()) { toast.error('Введите название'); return; }
    }
    if (!poForm.price_cny) { toast.error('Укажите цену закупки (¥)'); return; }
    const data = {
      wish_item_id: orderWish.id,
      product_id: isExisting ? orderWish.product_id : null,
      name: isExisting ? orderLinkedProduct.name : poForm.name.trim(),
      brand: isExisting ? (orderLinkedProduct.brand || null) : (orderWish.brand || null),
      category_id: isExisting
        ? (orderLinkedProduct.category_id || null)
        : (poForm.category_id || null),
      photo_data: orderWish.photo_data || (isExisting ? orderLinkedProduct.image_url : null),
      barcode: isExisting
        ? (orderLinkedProduct.barcode || null)
        : (poForm.barcode || null),
      supplier: poForm.supplier || null,
      price_cny: Number(poForm.price_cny),
      price_kzt: cnyKzt || null,
      cny_rate: cnyRate,
      quantity_ordered: Number(poForm.quantity_ordered) || 1,
      notes: poForm.notes || null,
    };
    createPO.mutate(data);
  };

  const saveAccept = () => {
    if (!acceptPO) return;
    if (!acceptForm.sale_price_kzt) { toast.error('Укажите продажную цену'); return; }
    const merging = Boolean(acceptExistingProduct);
    if (!merging && showAcceptEngine) {
      const efs = normalizeCompatIds(acceptForm.compatibility_engine_family_ids);
      if (acceptEngineSingle && efs.length !== 1) {
        toast.error('Укажите ровно один код мотора');
        return;
      }
      if (!acceptEngineSingle && !efs.length) {
        toast.error('Выберите хотя бы один код мотора');
        return;
      }
    }
    const vIds = normalizeCompatIds(acceptForm.compatibility_vehicle_model_ids);
    const eIds = normalizeCompatIds(acceptForm.compatibility_engine_family_ids);
    acceptMutation.mutate({
      id: acceptPO.id,
      data: {
        quantity_received: Number(acceptForm.quantity_received),
        purchase_price_kzt: num(acceptForm.purchase_price_kzt),
        delivery_cost_kzt: num(acceptForm.delivery_cost_kzt),
        sale_price_kzt: num(acceptForm.sale_price_kzt),
        storage_location: acceptForm.storage_location || null,
        keep_remainder: acceptForm.keep_remainder,
        notes: acceptForm.notes || null,
        brand: merging ? null : (acceptForm.brand || null),
        model: merging ? null : (acceptForm.model || null),
        attributes: !merging && acceptForm.attributes && Object.keys(acceptForm.attributes).length
          ? acceptForm.attributes
          : null,
        compatibility_vehicle_model_ids: !merging && vIds.length ? vIds : null,
        compatibility_engine_family_ids: !merging && eIds.length ? eIds : null,
        product_id: acceptExistingProduct?.id || null,
      },
    });
  };

  const acceptCompatSlot = showAcceptCompat ? (
    <VehicleCompatibilityPicker
      key={`accept-compat-${acceptCompatKey}`}
      brands={vehicleBrands}
      models={vehicleModels}
      initialSelectedIds={acceptForm.compatibility_vehicle_model_ids}
      onChange={(ids) => setAcceptForm((f) => ({ ...f, compatibility_vehicle_model_ids: normalizeCompatIds(ids) }))}
    />
  ) : null;

  const wishLinkedStock = wishForm.product_id ? productsById.get(wishForm.product_id) : null;

  const acceptEngineSlot = showAcceptEngine ? (
    <EngineFamilyPicker
      key={`accept-engine-${acceptEngineKey}`}
      initialSelectedIds={acceptForm.compatibility_engine_family_ids}
      vehicleModelIds={acceptForm.compatibility_vehicle_model_ids}
      singleSelect={acceptEngineSingle}
      onChange={(ids) => setAcceptForm((f) => ({ ...f, compatibility_engine_family_ids: normalizeCompatIds(ids) }))}
    />
  ) : null;

  const pendingCount = wishItems.filter((w) => w.status === 'pending').length;

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="reserve-shell">
      <div className="reserve-content">
        <div className="reserve-segment" role="tablist" aria-label="Разделы резерва">
          <button
            type="button"
            role="tab"
            aria-selected={mainTab === 'wish'}
            className={`reserve-segment-btn${mainTab === 'wish' ? ' is-active' : ''}`}
            onClick={() => setMainTab('wish')}
          >
            <FiShoppingCart size={16} />
            <span>Нужно заказать</span>
            {pendingCount > 0 && <span className="reserve-seg-badge">{pendingCount}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mainTab === 'orders'}
            className={`reserve-segment-btn${mainTab === 'orders' ? ' is-active' : ''}`}
            onClick={() => setMainTab('orders')}
          >
            <FiTruck size={16} />
            <span>Заказано</span>
            {activeOrders.length > 0 && <span className="reserve-seg-badge">{activeOrders.length}</span>}
          </button>
        </div>

        {/* ── TAB 1: Нужно заказать ── */}
        {mainTab === 'wish' && (
          <>
            <div className="reserve-header">
              <div className="reserve-header-text">
                <h1 className="reserve-title">Нужно заказать</h1>
                <p className="reserve-subtitle">
                  {pendingWishItems.length} позиций ожидают заказа
                </p>
              </div>
              <div className="reserve-header-actions">
                <button
                  type="button"
                  onClick={exportWishExcel}
                  className="reserve-secondary-btn"
                  disabled={!pendingWishItems.length}
                >
                  <FiDownload size={15} /> Excel
                </button>
                <button type="button" onClick={openAddWish} className="reserve-primary-btn">
                  <FiPlus size={16} /> Добавить
                </button>
              </div>
            </div>

            <div className="reserve-toolbar">
              <div className="reserve-search">
                <FiSearch size={15} className="reserve-search-icon" />
                <input
                  className="ios-input reserve-search-input"
                  placeholder="Поиск по названию…"
                  value={wishSearch}
                  onChange={(e) => setWishSearch(e.target.value)}
                />
              </div>
            </div>

            {categoryFilterOptions.length > 1 && (
              <div className="reserve-category-chips">
                {categoryFilterOptions.map((opt) => (
                  <button
                    key={opt.id ?? 'all'}
                    type="button"
                    onClick={() => setWishCategoryFilter(opt.id)}
                    className={`reserve-chip${wishCategoryFilter === opt.id ? ' is-active' : ''}`}
                  >
                    {opt.label} · {opt.count}
                  </button>
                ))}
              </div>
            )}

            {wishLoading ? (
              <div className="reserve-loading">Загрузка…</div>
            ) : pendingWishItems.length === 0 ? (
              <div className="reserve-empty">
                <div className="reserve-empty-icon"><FiShoppingCart size={28} /></div>
                <div className="reserve-empty-title">Список пуст</div>
                <div className="reserve-empty-text">Добавьте товары, которые нужно заказать</div>
                <button type="button" onClick={openAddWish} className="reserve-primary-btn">
                  <FiPlus size={16} /> Добавить товар
                </button>
              </div>
            ) : (
              <div className="wish-grid">
                {pendingWishItems.map((item, index) => (
                  <WishCard
                    key={item.id}
                    item={item}
                    index={index}
                    categoryLabel={categoryLabelForItem(item, categoryTree)}
                    stockProduct={linkedProductForWish(item)}
                    carsLabel={carsLabelForIds(item.compatibility_vehicle_model_ids)}
                    onOrder={openOrderWish}
                    onEdit={openEditWish}
                    onDelete={(it) => { if (window.confirm(`Удалить "${it.name}"?`)) deleteWish.mutate(it.id); }}
                  />
                ))}
              </div>
            )}

            {orderedWishItems.length > 0 && (
              <section className="reserve-section reserve-section--muted">
                <h2 className="reserve-section-title">Уже заказаны · {orderedWishItems.length}</h2>
                <div className="wish-grid">
                  {orderedWishItems.map((item, index) => (
                    <WishCard
                      key={item.id}
                      item={item}
                      index={index}
                      categoryLabel={categoryLabelForItem(item, categoryTree)}
                      stockProduct={linkedProductForWish(item)}
                      carsLabel={carsLabelForIds(item.compatibility_vehicle_model_ids)}
                      onOrder={openOrderWish}
                      onEdit={openEditWish}
                      onDelete={(it) => { if (window.confirm(`Удалить "${it.name}"?`)) deleteWish.mutate(it.id); }}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {/* ── TAB 2: Заказано / В пути ── */}
        {mainTab === 'orders' && (
          <>
            <div className="reserve-header">
              <div className="reserve-header-text">
                <h1 className="reserve-title">Заказано</h1>
                <p className="reserve-subtitle">Заказы у поставщиков в пути</p>
              </div>
            </div>

            {activeOrders.length > 0 && (
              <div className="reserve-stats-bar">
                <div className="reserve-stat">
                  <span className="reserve-stat-label">В пути</span>
                  <span className="reserve-stat-value">{activeOrders.length}</span>
                </div>
                <div className="reserve-stat">
                  <span className="reserve-stat-label">Ожидается</span>
                  <span className="reserve-stat-value">{totalExpected} шт.</span>
                </div>
                {partialCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setPartialFilter((v) => !v)}
                    className={`reserve-stat reserve-stat--btn${partialFilter ? ' is-active' : ''}`}
                  >
                    <span className="reserve-stat-label">Частично</span>
                    <span className="reserve-stat-value">{partialCount}</span>
                  </button>
                )}
              </div>
            )}

            {poLoading ? (
              <div className="reserve-loading">Загрузка…</div>
            ) : activeOrders.length === 0 && !partialFilter ? (
              <div className="reserve-empty">
                <div className="reserve-empty-icon"><FiTruck size={28} /></div>
                <div className="reserve-empty-title">Нет активных заказов</div>
                <div className="reserve-empty-text">Перейдите в «Нужно заказать» и оформите заказ</div>
              </div>
            ) : (
              <div className="po-groups">
                {ordersBySupplier.map(([supplier, orders]) => (
                  <section key={supplier} className="po-group">
                    <div className="po-group-head">
                      <h2 className="po-group-title">{supplier}</h2>
                      <span className="po-group-count">{orders.length}</span>
                    </div>

                    {/* Mobile cards */}
                    <div className="po-cards">
                      {orders.map((po, index) => (
                        <PoCard
                          key={po.id}
                          po={po}
                          index={index}
                          categoryLabel={categoryLabelForItem(po, categoryTree) || po.category}
                          stockQty={po.product_id ? productsById.get(po.product_id)?.quantity : null}
                          onAccept={() => openAccept(po)}
                          onCancel={() => {
                            if (window.confirm('Отменить заказ? Позиция вернётся в «Нужно заказать».')) {
                              cancelPO.mutate(po.id);
                            }
                          }}
                        />
                      ))}
                    </div>

                    {/* Laptop / desktop table */}
                    <div className="po-table-wrap">
                      <table className="po-table">
                        <thead>
                          <tr>
                            <th style={{ width: 56 }} />
                            <th>Товар</th>
                            <th>Штрих-код</th>
                            <th>Кол-во</th>
                            <th>Цена ¥</th>
                            <th>В пути</th>
                            <th>Статус</th>
                            <th style={{ width: 180 }}>Действия</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orders.map((po) => {
                            const days = daysSince(po.ordered_at);
                            const remaining = po.quantity_ordered - po.quantity_received;
                            const isPartial = po.status === 'partial';
                            const pct = po.quantity_ordered ? po.quantity_received / po.quantity_ordered : 0;
                            const stock = po.product_id ? productsById.get(po.product_id) : null;
                            return (
                              <tr key={po.id} className={`po-row${isPartial ? ' po-row-partial' : ''}`}>
                                <td>
                                  <div className="po-thumb">
                                    {po.photo_data
                                      ? <img src={po.photo_data} alt={po.name} />
                                      : <FiPackage size={20} />
                                    }
                                  </div>
                                </td>
                                <td>
                                  <div className="po-table-name">{po.name}</div>
                                  <div className="po-table-sub">
                                    {[categoryLabelForItem(po, categoryTree) || po.category, stock ? `склад ${stock.quantity ?? 0}` : null].filter(Boolean).join(' · ')}
                                  </div>
                                </td>
                                <td><span className="po-card-mono">{po.barcode || '—'}</span></td>
                                <td>
                                  {isPartial ? (
                                    <div>
                                      <div className="po-table-warn">{remaining} / {po.quantity_ordered}</div>
                                      <div className="po-progress-bar">
                                        <div className="po-progress-fill" style={{ width: `${pct * 100}%` }} />
                                      </div>
                                    </div>
                                  ) : (
                                    <span className="po-table-qty">{po.quantity_ordered} шт.</span>
                                  )}
                                </td>
                                <td>
                                  {po.price_cny != null
                                    ? <><b>¥ {money(po.price_cny)}</b><div className="po-card-hint">≈ ₸ {money(po.price_kzt)}</div></>
                                    : '—'}
                                </td>
                                <td>
                                  <span className={`days-badge ${days > 30 ? 'days-badge-red' : days > 14 ? 'days-badge-amber' : 'days-badge-green'}`}>
                                    {daysLabel(days)}
                                  </span>
                                </td>
                                <td>
                                  <span className={`po-status-badge ${isPartial ? 'po-status-partial' : 'po-status-transit'}`}>
                                    {isPartial ? 'Частично' : 'В пути'}
                                  </span>
                                </td>
                                <td>
                                  <div className="po-card-actions po-card-actions--inline">
                                    <button type="button" onClick={() => openAccept(po)} className="po-action-btn po-action-green">
                                      <FiCheck size={13} /> {isPartial ? 'Ещё' : 'Принять'}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        if (window.confirm('Отменить заказ? Позиция вернётся в «Нужно заказать».')) {
                                          cancelPO.mutate(po.id);
                                        }
                                      }}
                                      className="po-action-btn po-action-red"
                                    >
                                      <FiX size={13} />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </section>
                ))}
              </div>
            )}

            {completedOrders.length > 0 && (
              <div className="reserve-section reserve-section--muted">
                <h2 className="reserve-section-title">Принято в склад · {completedOrders.length}</h2>
              </div>
            )}

            {cancelledOrders.length > 0 && (
              <div className="reserve-section">
                <button
                  type="button"
                  onClick={() => setShowCancelledBlock((v) => !v)}
                  className="reserve-collapse-btn"
                >
                  {showCancelledBlock ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
                  Отменённые · {cancelledOrders.length}
                </button>
                {showCancelledBlock && (
                  <div className="po-cards">
                    {cancelledOrders.map((po, index) => (
                      <PoCard
                        key={po.id}
                        po={po}
                        index={index}
                        categoryLabel={po.supplier || ''}
                        cancelled
                        onRestore={() => restorePO.mutate(po.id)}
                        onDelete={() => {
                          if (window.confirm('Удалить навсегда?')) deletePO.mutate(po.id);
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════════════════════════════ */}

      {/* ── Add / Edit Wish Item ── */}
      <Modal isOpen={showWishModal || Boolean(editWish)} onClose={() => { setShowWishModal(false); setEditWish(null); setShowNameSuggestions(false); }} title={editWish ? 'Редактировать товар' : 'Добавить в список'} maxWidth={560} tall>
        <Field label="Категория" required>
          <CategoryPicker
            tree={categoryTree}
            groupId={wishForm.category_group_id}
            categoryId={wishForm.category_id}
            onChange={handleWishCategoryChange}
            stepCaption="Нужно заказать"
            legacyCategoryText={wishForm.category}
          />
        </Field>

        <Field label="Фото товара">
          <PhotoZone photoData={wishForm.photo_data} onPhoto={(d) => setWishForm((f) => ({ ...f, photo_data: d }))} onRemove={() => setWishForm((f) => ({ ...f, photo_data: '' }))} />
        </Field>

        <Field label="Название" required>
          <div style={{ position: 'relative' }}>
            <input
              className="ios-input"
              placeholder="Название товара"
              value={wishForm.name}
              onChange={(e) => {
                setWishForm((f) => ({ ...f, name: e.target.value, product_id: null }));
                setShowNameSuggestions(true);
              }}
              onFocus={() => setShowNameSuggestions(true)}
              onBlur={() => setTimeout(() => setShowNameSuggestions(false), 150)}
              autoComplete="off"
            />
            {showNameSuggestions && nameSuggestions.length > 0 && (
              <div style={{ position: 'absolute', left: 0, right: 0, top: '100%', marginTop: 4, zIndex: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 8px 24px rgba(0,0,0,0.12)', overflow: 'hidden' }}>
                {nameSuggestions.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => applyProductSuggestion(p)}
                    style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13 }}
                  >
                    <div style={{ fontWeight: 700, color: 'var(--text)' }}>{p.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                      {[p.sku, p.barcode, `склад ${p.quantity ?? 0}`].filter(Boolean).join(' · ') || 'Из каталога'}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
          {wishLinkedStock && (
            <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.25)', fontSize: 12, fontWeight: 600, color: '#047857' }}>
              Связь со складом: {wishLinkedStock.name}
              {wishLinkedStock.sku ? ` · арт. ${wishLinkedStock.sku}` : ''}
              {' · '}остаток {wishLinkedStock.quantity ?? 0} шт.
              <button
                type="button"
                onClick={() => setWishForm((f) => ({ ...f, product_id: null }))}
                style={{ marginLeft: 8, background: 'none', border: 'none', color: 'var(--danger)', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}
              >
                отвязать
              </button>
            </div>
          )}
        </Field>

        <Field label="Для каких авто (марка–модель)">
          <VehicleCompatibilityPicker
            key={`wish-compat-${wishCompatKey}`}
            brands={vehicleBrands}
            models={vehicleModels}
            initialSelectedIds={wishForm.compatibility_vehicle_model_ids}
            onChange={(ids) => setWishForm((f) => ({ ...f, compatibility_vehicle_model_ids: normalizeCompatIds(ids) }))}
          />
        </Field>

        <Field label="Количество" required>
          <input
            className="ios-input"
            type="number"
            min="1"
            value={wishForm.quantity}
            onChange={(e) => setWishForm((f) => ({ ...f, quantity: e.target.value }))}
          />
        </Field>

        <Field label="Доп. информация">
          <textarea className="ios-input" rows={3} placeholder="Артикул, особые характеристики, примечания..." value={wishForm.notes} onChange={(e) => setWishForm((f) => ({ ...f, notes: e.target.value }))} style={{ resize: 'vertical', minHeight: 70 }} />
        </Field>

        <div className="reserve-modal-actions">
          <button type="button" onClick={() => { setShowWishModal(false); setEditWish(null); }} className="reserve-btn-ghost">Отмена</button>
          <button type="button" onClick={saveWish} disabled={createWish.isPending || updateWish.isPending} className="reserve-btn-primary">
            {createWish.isPending || updateWish.isPending ? 'Сохранение…' : editWish ? 'Сохранить' : 'Добавить в список'}
          </button>
        </div>
      </Modal>

      {/* ── Place Order (PO) modal ── */}
      <Modal isOpen={Boolean(orderWish)} onClose={() => setOrderWish(null)} title="Оформить заказ" maxWidth={480}>
        {orderWish && (
          <>
            {orderLinkedProduct ? (
              <>
                <div style={{ padding: '12px 14px', borderRadius: 16, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)', marginBottom: 16 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#047857', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                    Существующий товар — данные не меняются
                  </div>
                  <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
                    {(orderWish.photo_data || orderLinkedProduct.image_url)
                      ? <img src={orderWish.photo_data || orderLinkedProduct.image_url} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }} />
                      : <div style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><FiPackage size={22} style={{ color: 'var(--text-muted)' }} /></div>
                    }
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>{orderLinkedProduct.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.45 }}>
                        {[
                          orderLinkedProduct.sku ? `Арт. ${orderLinkedProduct.sku}` : null,
                          orderLinkedProduct.barcode ? `ШК ${orderLinkedProduct.barcode}` : null,
                          `Склад: ${orderLinkedProduct.quantity ?? 0} шт.`,
                        ].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                  </div>
                </div>

                <Field label="Закуп за 1 шт. (юань ¥)" required>
                  <input className="ios-input" type="number" min="0" step="0.01" placeholder="0.00" value={poForm.price_cny} onChange={(e) => setPoForm((f) => ({ ...f, price_cny: e.target.value }))} />
                  {cnyKzt !== null && (
                    <div style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 700, marginTop: 4 }}>≈ ₸ {money(cnyKzt)} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>курс {cnyRate}</span></div>
                  )}
                </Field>

                <div className="reserve-form-row">
                  <Field label="Количество">
                    <input className="ios-input" type="number" min="1" value={poForm.quantity_ordered} onChange={(e) => setPoForm((f) => ({ ...f, quantity_ordered: e.target.value }))} />
                  </Field>
                  <Field label="Поставщик">
                    <input className="ios-input" placeholder="Имя или компания" value={poForm.supplier} onChange={(e) => setPoForm((f) => ({ ...f, supplier: e.target.value }))} />
                  </Field>
                </div>
              </>
            ) : (
              <>
                <Field label="Категория" required>
                  <CategoryPicker
                    tree={categoryTree}
                    groupId={poForm.category_group_id}
                    categoryId={poForm.category_id}
                    onChange={({ groupId, categoryId }) => {
                      const sub = findCategoryInTree(categoryTree, categoryId);
                      setPoForm((f) => ({
                        ...f,
                        category_group_id: groupId,
                        category_id: categoryId,
                        category: sub?.name || f.category,
                      }));
                    }}
                    stepCaption="Заказ"
                    legacyCategoryText={poForm.category}
                  />
                </Field>

                <Field label="Название" required>
                  <input className="ios-input" value={poForm.name} onChange={(e) => setPoForm((f) => ({ ...f, name: e.target.value }))} />
                </Field>

                <div style={{ height: 1, background: 'var(--border)', margin: '6px 0 14px' }} />

                <Field label="Стоимость за 1 товар (юань ¥)" required>
                  <input className="ios-input" type="number" min="0" step="0.01" placeholder="0.00" value={poForm.price_cny} onChange={(e) => setPoForm((f) => ({ ...f, price_cny: e.target.value }))} />
                  {cnyKzt !== null && (
                    <div style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 700, marginTop: 4 }}>≈ ₸ {money(cnyKzt)} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>курс {cnyRate}</span></div>
                  )}
                </Field>

                <Field label="Поставщик">
                  <input className="ios-input" placeholder="Имя или компания" value={poForm.supplier} onChange={(e) => setPoForm((f) => ({ ...f, supplier: e.target.value }))} />
                </Field>

                <Field label="Штрих-код">
                  <div style={{ position: 'relative' }}>
                    <input className="ios-input" value={poForm.barcode} onChange={(e) => setPoForm((f) => ({ ...f, barcode: e.target.value }))} style={{ paddingRight: 44 }} />
                    <button type="button" onClick={() => setPoForm((f) => ({ ...f, barcode: generateEAN13() }))} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)' }}>
                      <FiRefreshCw size={16} />
                    </button>
                  </div>
                </Field>

                <Field label="Количество">
                  <input className="ios-input" type="number" min="1" value={poForm.quantity_ordered} onChange={(e) => setPoForm((f) => ({ ...f, quantity_ordered: e.target.value }))} />
                </Field>
              </>
            )}

            <Field label="Доп. информация">
              <textarea className="ios-input" rows={2} value={poForm.notes} onChange={(e) => setPoForm((f) => ({ ...f, notes: e.target.value }))} style={{ resize: 'vertical' }} />
            </Field>

            <div className="reserve-modal-actions">
              <button type="button" onClick={() => setOrderWish(null)} className="reserve-btn-ghost">Отмена</button>
              <button type="button" onClick={saveOrder} disabled={createPO.isPending} className="reserve-btn-primary">
                {createPO.isPending ? 'Оформление…' : 'Заказать'}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Accept to Stock modal ── */}
      <Modal isOpen={Boolean(acceptPO)} onClose={() => { setAcceptPO(null); setAcceptForm(emptyAccept()); }} title="Приёмка товара" maxWidth={560} tall>
        {acceptPO && (
          <>
            {/* Product preview */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '12px 14px', borderRadius: 16, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)', marginBottom: 20 }}>
              {acceptPO.photo_data
                ? <img src={acceptPO.photo_data} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }} />
                : <div style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><FiPackage size={22} style={{ color: 'var(--text-muted)' }} /></div>
              }
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>{acceptPO.name}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                  {categoryLabelForItem(acceptPO, categoryTree) && <>{categoryLabelForItem(acceptPO, categoryTree)} · </>}
                  Заказано: <b>{acceptPO.quantity_ordered} шт.</b>
                  {acceptPO.quantity_received > 0 && <> · Принято: <b style={{ color: 'var(--success)' }}>{acceptPO.quantity_received} шт.</b></>}
                </div>
                {acceptExistingProduct && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#047857', marginTop: 6 }}>
                    Приёмка в существующий товар · остаток {acceptExistingProduct.quantity ?? 0} шт.
                    {acceptExistingProduct.sku ? ` · арт. ${acceptExistingProduct.sku}` : ''}
                  </div>
                )}
              </div>
            </div>

            {/* Quantity */}
            <div style={{ marginBottom: 14 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 7 }}>
                Количество
              </label>
              <div className="reserve-form-row">
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Пришло</div>
                  <input className="ios-input" type="number" min="1" max={acceptPO.quantity_ordered - acceptPO.quantity_received} value={acceptForm.quantity_received} onChange={(e) => setAcceptForm((f) => ({ ...f, quantity_received: e.target.value }))} />
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Заказано (ост.)</div>
                  <input className="ios-input" value={acceptPO.quantity_ordered - acceptPO.quantity_received} disabled style={{ color: 'var(--text-muted)', background: 'var(--ios-grouped-bg)' }} />
                </div>
              </div>
              {/* Partial warning */}
              {Number(acceptForm.quantity_received) < (acceptPO.quantity_ordered - acceptPO.quantity_received) && (
                <div style={{ marginTop: 8, padding: '8px 12px', borderRadius: 10, background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <FiAlertTriangle size={14} style={{ color: 'var(--warning)', marginTop: 1, flexShrink: 0 }} />
                  <div style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 600 }}>
                    Принимаете {acceptForm.quantity_received} из {acceptPO.quantity_ordered - acceptPO.quantity_received} — остаток {(acceptPO.quantity_ordered - acceptPO.quantity_received) - Number(acceptForm.quantity_received)} шт.
                    {acceptForm.keep_remainder ? ' останется в ожидании' : ' — заказ закроется'}
                  </div>
                </div>
              )}
              {Number(acceptForm.quantity_received) < (acceptPO.quantity_ordered - acceptPO.quantity_received) && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
                  <input type="checkbox" checked={acceptForm.keep_remainder} onChange={(e) => setAcceptForm((f) => ({ ...f, keep_remainder: e.target.checked }))} />
                  Оставить остаток в пути
                </label>
              )}
            </div>

            {/* Prices */}
            <div className="reserve-form-row">
              <Field label="Закупочная цена (₸)" required>
                <input className="ios-input" type="number" min="0" placeholder="0" value={acceptForm.purchase_price_kzt} onChange={(e) => setAcceptForm((f) => ({ ...f, purchase_price_kzt: e.target.value }))} />
              </Field>
              <Field label="Доставка (₸)">
                <input className="ios-input" type="number" min="0" placeholder="0" value={acceptForm.delivery_cost_kzt} onChange={(e) => setAcceptForm((f) => ({ ...f, delivery_cost_kzt: e.target.value }))} />
              </Field>
            </div>

            <Field label="Продажная цена (₸)" required>
              <input className="ios-input" type="number" min="0" placeholder="0" value={acceptForm.sale_price_kzt} onChange={(e) => setAcceptForm((f) => ({ ...f, sale_price_kzt: e.target.value }))} />
              {acceptProfit !== null && (
                <div style={{ marginTop: 6, fontSize: 13, fontWeight: 700, color: Number(acceptProfit) >= 20 ? 'var(--success)' : 'var(--warning)' }}>
                  Прибыль: {acceptProfit}%
                </div>
              )}
            </Field>

            {!acceptExistingProduct && acceptPO.category_id && acceptSubcategorySchema && (
              <div style={{ marginBottom: 16, padding: '12px 0', borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 12 }}>
                  Характеристики категории
                </div>
                <ProductFormByLayout
                  schema={acceptSubcategorySchema}
                  formData={acceptForm}
                  onFormDataChange={setAcceptForm}
                  layoutSection="main"
                  categoryGroupName={acceptCategoryGroup?.name || ''}
                  categoryName={acceptSubcategory?.name || acceptPO.category || ''}
                  compatibilitySlot={acceptCompatSlot}
                  engineCompatibilitySlot={acceptEngineSlot}
                  showEngineFamilies={showAcceptEngine}
                />
                <ProductFormByLayout
                  schema={acceptSubcategorySchema}
                  formData={acceptForm}
                  onFormDataChange={setAcceptForm}
                  layoutSection="attributes"
                  categoryGroupName={acceptCategoryGroup?.name || ''}
                  categoryName={acceptSubcategory?.name || acceptPO.category || ''}
                />
              </div>
            )}

            {/* Extra fields toggle */}
            <button type="button" onClick={() => setAcceptForm((f) => ({ ...f, showExtra: !f.showExtra }))} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: 'var(--primary)', padding: '4px 0 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
              {acceptForm.showExtra ? <FiChevronDown size={15} /> : <FiChevronRight size={15} />}
              Дополнительно
            </button>
            {acceptForm.showExtra && (
              <div style={{ marginBottom: 14 }}>
                <Field label="Место на складе">
                  <input className="ios-input" placeholder="Полка / ряд / зона" value={acceptForm.storage_location} onChange={(e) => setAcceptForm((f) => ({ ...f, storage_location: e.target.value }))} />
                </Field>
                <Field label="Заметки">
                  <textarea className="ios-input" rows={2} value={acceptForm.notes} onChange={(e) => setAcceptForm((f) => ({ ...f, notes: e.target.value }))} style={{ resize: 'vertical' }} />
                </Field>
              </div>
            )}

            <div className="reserve-modal-actions">
              <button type="button" onClick={() => { setAcceptPO(null); setAcceptForm(emptyAccept()); }} className="reserve-btn-ghost">Отмена</button>
              <button type="button" onClick={saveAccept} disabled={acceptMutation.isPending} className="reserve-btn-success">
                {acceptMutation.isPending
                  ? 'Сохранение…'
                  : (acceptExistingProduct ? 'Добавить к товару' : 'Добавить в склад')}
              </button>
            </div>
          </>
        )}
      </Modal>

      {mainTab === 'wish' && (
        <div className="reserve-add-fab-root">
          <button type="button" className="reserve-add-fab-btn" aria-label="Добавить в список" onClick={openAddWish}>
            <FiPlus size={26} />
          </button>
        </div>
      )}

    </div>
  );
};

export default Reserve;

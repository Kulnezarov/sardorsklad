import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  FiPlus, FiX, FiPackage, FiTruck, FiShoppingCart, FiCheck, FiClock,
  FiUpload, FiDownload, FiCamera, FiTrash2, FiEdit2, FiRefreshCw,
  FiChevronDown, FiChevronRight, FiAlertTriangle, FiRotateCcw,
} from 'react-icons/fi';
import { wishApi, poApi } from '../api/reserve';
import { settingsApi } from '../api/settings';
import { fetchAllProducts } from '../api/client';
import { generateEAN13 } from '../utils/barcodeGen';

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
function WishCard({ item, categories, onOrder, onEdit, onDelete }) {
  const cat = getCatColor(item.category);
  return (
    <div className="wish-card">
      <div className="wish-card-photo">
        {item.photo_data
          ? <img src={item.photo_data} alt={item.name} />
          : <div className="wish-card-photo-placeholder"><FiPackage size={28} /><span>Нет фото</span></div>
        }
      </div>
      <div className="wish-card-body">
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)', lineHeight: 1.25, flex: 1 }}>{item.name}</div>
          <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
            <button type="button" onClick={() => onEdit(item)} className="wish-icon-btn"><FiEdit2 size={13} /></button>
            <button type="button" onClick={() => onDelete(item)} className="wish-icon-btn wish-icon-btn-danger"><FiTrash2 size={13} /></button>
          </div>
        </div>
        {item.brand && <div style={{ fontSize: 12, color: 'var(--text-muted)', fontWeight: 500, marginBottom: 6 }}>{item.brand}</div>}
        {item.category && (
          <span style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 100, fontSize: 11, fontWeight: 700, background: cat.bg, color: cat.color, marginBottom: 8 }}>
            {item.category}
          </span>
        )}
        {item.notes && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', marginBottom: 8 }}>
            {item.notes}
          </div>
        )}
        <button type="button" onClick={() => onOrder(item)} className="wish-order-btn">
          Заказать →
        </button>
      </div>
    </div>
  );
}

/* ── Modal wrapper ── */
function Modal({ isOpen, onClose, title, children, maxWidth = 480 }) {
  if (!isOpen) return null;
  return createPortal(
    <div
      className="reserve-modal-overlay"
      onClick={onClose}
    >
      <div
        className="reserve-modal-box"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth }}
      >
        <div className="reserve-modal-header">
          <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--text)' }}>{title}</div>
          <button type="button" onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', flexShrink: 0 }}>
            <FiX size={16} />
          </button>
        </div>
        <div className="reserve-modal-body">
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}

/* ── Field ── */
function Field({ label, children, required }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 7 }}>
        {label}{required && <span style={{ color: 'var(--danger)', marginLeft: 2 }}>*</span>}
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

  // ── Tabs ──
  const [mainTab, setMainTab] = useState('wish');      // 'wish' | 'orders'
  const [orderSub, setOrderSub] = useState('in_transit'); // 'in_transit' | 'cancelled'
  const [partialFilter, setPartialFilter] = useState(false);
  const [showCancelledBlock, setShowCancelledBlock] = useState(false);

  // ── Modal state ──
  const [showWishModal, setShowWishModal] = useState(false);
  const [editWish, setEditWish] = useState(null);       // WishItem being edited
  const [orderWish, setOrderWish] = useState(null);     // WishItem being ordered → PO modal
  const [acceptPO, setAcceptPO] = useState(null);       // PurchaseOrder being accepted

  // ── Wish form ──
  const emptyWish = () => ({ name: '', brand: '', category: '', notes: '', photo_data: '' });
  const [wishForm, setWishForm] = useState(emptyWish());

  // ── Order (PurchaseOrder) form ──
  const [poForm, setPoForm] = useState({
    barcode: '', supplier: '', price_cny: '', quantity_ordered: 1, notes: '',
  });

  // ── Accept form ──
  const emptyAccept = () => ({
    quantity_received: 1, purchase_price_kzt: '', delivery_cost_kzt: '', sale_price_kzt: '',
    storage_location: '', keep_remainder: true, notes: '', showExtra: false,
  });
  const [acceptForm, setAcceptForm] = useState(emptyAccept());

  // ── Data queries ──
  const { data: wishItems = [], isLoading: wishLoading } = useQuery({
    queryKey: ['wish-items'],
    queryFn: () => wishApi.list().then((r) => r.data),
    staleTime: 30_000,
  });

  const { data: purchaseOrders = [], isLoading: poLoading } = useQuery({
    queryKey: ['purchase-orders'],
    queryFn: () => poApi.list().then((r) => r.data),
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

  const cnyRate = Number(settings?.cny_rate || 67);

  // ── Derived categories ──
  const categories = useMemo(() => {
    const cats = new Set();
    products.forEach((p) => p.category && cats.add(p.category));
    wishItems.forEach((w) => w.category && cats.add(w.category));
    return [...cats].sort();
  }, [products, wishItems]);

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
    onSuccess: () => { queryClient.invalidateQueries(['wish-items']); toast.success('Сохранено'); setEditWish(null); setWishForm(emptyWish()); },
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
      toast.success('Товар добавлен в склад! ✅');
      setAcceptPO(null);
      setAcceptForm(emptyAccept());
    },
    onError: (e) => toast.error(e?.response?.data?.detail || 'Ошибка приёмки'),
  });

  const cancelPO = useMutation({
    mutationFn: (id) => poApi.cancel(id),
    onSuccess: () => { queryClient.invalidateQueries(['purchase-orders']); toast.success('Заказ отменён'); },
  });

  const restorePO = useMutation({
    mutationFn: (id) => poApi.restore(id),
    onSuccess: () => { queryClient.invalidateQueries(['purchase-orders']); toast.success('Заказ восстановлен'); },
  });

  const deletePO = useMutation({
    mutationFn: (id) => poApi.delete(id),
    onSuccess: () => { queryClient.invalidateQueries(['purchase-orders']); toast.success('Удалено'); },
  });

  // ── Handlers ──
  const openAddWish = () => { setWishForm(emptyWish()); setEditWish(null); setShowWishModal(true); };
  const openEditWish = (item) => { setEditWish(item); setWishForm({ name: item.name, brand: item.brand || '', category: item.category || '', notes: item.notes || '', photo_data: item.photo_data || '' }); setShowWishModal(true); };
  const openOrderWish = (item) => { setOrderWish(item); setPoForm({ barcode: generateEAN13(), supplier: '', price_cny: '', quantity_ordered: 1, notes: item.notes || '' }); };
  const openAccept = (po) => {
    setAcceptPO(po);
    const remaining = po.quantity_ordered - po.quantity_received;
    setAcceptForm({ ...emptyAccept(), quantity_received: remaining, purchase_price_kzt: po.price_kzt ? String(Math.round(Number(po.price_kzt))) : '', notes: po.notes || '' });
  };

  const saveWish = () => {
    if (!wishForm.name.trim()) { toast.error('Введите название'); return; }
    const data = { name: wishForm.name.trim(), brand: wishForm.brand || null, category: wishForm.category || null, notes: wishForm.notes || null, photo_data: wishForm.photo_data || null };
    if (editWish) updateWish.mutate({ id: editWish.id, data });
    else createWish.mutate(data);
  };

  const saveOrder = () => {
    if (!orderWish) return;
    const data = {
      wish_item_id: orderWish.id,
      name: orderWish.name,
      brand: orderWish.brand,
      category: orderWish.category,
      photo_data: orderWish.photo_data,
      barcode: poForm.barcode || null,
      supplier: poForm.supplier || null,
      price_cny: poForm.price_cny ? Number(poForm.price_cny) : null,
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
      },
    });
  };

  // ────────────────────────────────────────────────────────────────────────────
  return (
    <div className="reserve-shell">

      {/* ══ BOTTOM TAB BAR ══ */}
      <nav className="reserve-dock">
        <button type="button" className={`reserve-dock-tab ${mainTab === 'wish' ? 'active' : ''}`} onClick={() => setMainTab('wish')}>
          <FiShoppingCart size={20} />
          <span>Нужно заказать</span>
          {wishItems.filter((w) => w.status === 'pending').length > 0 && (
            <span className="dock-badge">{wishItems.filter((w) => w.status === 'pending').length}</span>
          )}
        </button>
        <button type="button" className={`reserve-dock-tab ${mainTab === 'orders' ? 'active' : ''}`} onClick={() => setMainTab('orders')}>
          <FiTruck size={20} />
          <span>Заказано</span>
          {activeOrders.length > 0 && <span className="dock-badge">{activeOrders.length}</span>}
        </button>
      </nav>

      {/* ══ MAIN CONTENT ══ */}
      <div className="reserve-content">

        {/* ── TAB 1: Нужно заказать ── */}
        {mainTab === 'wish' && (
          <>
            {/* Header */}
            <div className="reserve-header">
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)' }}>Нужно заказать</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500, marginTop: 2 }}>
                  {wishItems.filter((w) => w.status === 'pending').length} позиций ожидают заказа
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="reserve-ghost-btn" title="Экспорт"><FiDownload size={15} /></button>
                <button type="button" className="reserve-ghost-btn" title="Импорт"><FiUpload size={15} /></button>
                <button type="button" onClick={openAddWish} className="reserve-primary-btn">
                  <FiPlus size={16} /> Добавить
                </button>
              </div>
            </div>

            {/* Cards grid */}
            {wishLoading ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Загрузка…</div>
            ) : wishItems.filter((w) => w.status === 'pending').length === 0 ? (
              <div className="reserve-empty">
                <FiShoppingCart size={40} />
                <div style={{ fontWeight: 700, fontSize: 17, marginTop: 12 }}>Список пуст</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>Добавьте товары, которые нужно заказать</div>
              </div>
            ) : (
              <div className="wish-grid">
                {wishItems.filter((w) => w.status === 'pending').map((item) => (
                  <WishCard key={item.id} item={item} categories={categories} onOrder={openOrderWish} onEdit={openEditWish} onDelete={(it) => { if (window.confirm(`Удалить "${it.name}"?`)) deleteWish.mutate(it.id); }} />
                ))}
              </div>
            )}

            {/* Already ordered */}
            {wishItems.filter((w) => w.status === 'ordered').length > 0 && (
              <div style={{ marginTop: 20, opacity: 0.6 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10, paddingLeft: 2 }}>
                  Уже заказаны · {wishItems.filter((w) => w.status === 'ordered').length}
                </div>
                <div className="wish-grid">
                  {wishItems.filter((w) => w.status === 'ordered').map((item) => (
                    <WishCard key={item.id} item={item} categories={categories} onOrder={openOrderWish} onEdit={openEditWish} onDelete={(it) => { if (window.confirm(`Удалить "${it.name}"?`)) deleteWish.mutate(it.id); }} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── TAB 2: Заказано / В пути ── */}
        {mainTab === 'orders' && (
          <>
            {/* Header */}
            <div className="reserve-header">
              <div>
                <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--text)' }}>Заказано</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500, marginTop: 2 }}>
                  Отслеживание заказов у поставщиков
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="reserve-ghost-btn" title="Экспорт"><FiDownload size={15} /></button>
                <button type="button" className="reserve-ghost-btn" title="Импорт"><FiUpload size={15} /></button>
              </div>
            </div>

            {/* Stats bar */}
            {activeOrders.length > 0 && (
              <div className="reserve-stats-bar">
                <span>🚚 В пути: <b>{activeOrders.length}</b> заказа</span>
                <span className="stats-dot">·</span>
                <span>Ожидается: <b>{totalExpected} шт.</b></span>
                {partialCount > 0 && (
                  <>
                    <span className="stats-dot">·</span>
                    <button type="button" onClick={() => setPartialFilter((v) => !v)} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 600, color: partialFilter ? 'var(--primary)' : 'var(--warning)', padding: 0, textDecoration: partialFilter ? 'underline' : 'none' }}>
                      Частично принято: {partialCount}
                    </button>
                  </>
                )}
              </div>
            )}

            {/* Table */}
            {poLoading ? (
              <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)' }}>Загрузка…</div>
            ) : activeOrders.length === 0 && !partialFilter ? (
              <div className="reserve-empty">
                <FiTruck size={40} />
                <div style={{ fontWeight: 700, fontSize: 17, marginTop: 12 }}>Нет активных заказов</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
                  Перейдите в «Нужно заказать» и нажмите «Заказать →»
                </div>
              </div>
            ) : (
              <div className="po-table-wrap">
                <table className="po-table">
                  <thead>
                    <tr>
                      <th style={{ width: 56 }}></th>
                      <th>Товар</th>
                      <th>Штрих-код</th>
                      <th>Кол-во</th>
                      <th>Цена (юань)</th>
                      <th>Поставщик</th>
                      <th>Дней в пути</th>
                      <th>Статус</th>
                      <th style={{ width: 180 }}>Действия</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeOrders.map((po) => {
                      const days = daysSince(po.ordered_at);
                      const remaining = po.quantity_ordered - po.quantity_received;
                      const isPartial = po.status === 'partial';
                      const pct = po.quantity_received / po.quantity_ordered;
                      return (
                        <tr key={po.id} className={`po-row ${isPartial ? 'po-row-partial' : ''}`}>
                          <td>
                            <div className="po-thumb">
                              {po.photo_data
                                ? <img src={po.photo_data} alt={po.name} />
                                : <FiPackage size={20} style={{ color: 'var(--text-muted)' }} />
                              }
                            </div>
                          </td>
                          <td>
                            <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)' }}>{po.name}</div>
                            {(po.brand || po.category) && (
                              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                                {[po.brand, po.category].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </td>
                          <td><span style={{ fontFamily: 'ui-monospace,monospace', fontSize: 12, color: 'var(--text-muted)' }}>{po.barcode || '—'}</span></td>
                          <td>
                            {isPartial ? (
                              <div>
                                <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--warning)' }}>
                                  {remaining} / {po.quantity_ordered}
                                </div>
                                <div className="po-progress-bar">
                                  <div className="po-progress-fill" style={{ width: `${pct * 100}%` }} />
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                                  {po.quantity_received} принято
                                </div>
                              </div>
                            ) : (
                              <span style={{ fontWeight: 700, fontSize: 14 }}>{po.quantity_ordered} шт.</span>
                            )}
                          </td>
                          <td>
                            {po.price_cny
                              ? <><b>¥ {money(po.price_cny)}</b><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>≈ ₸ {money(po.price_kzt)}</div></>
                              : <span style={{ color: 'var(--text-muted)' }}>—</span>
                            }
                          </td>
                          <td style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{po.supplier || '—'}</td>
                          <td>
                            <div className={`days-badge ${days > 30 ? 'days-badge-red' : days > 14 ? 'days-badge-amber' : 'days-badge-green'}`}>
                              🕒 {daysLabel(days)}
                            </div>
                          </td>
                          <td>
                            {isPartial
                              ? <span className="po-status-badge po-status-partial">Частично 🔄</span>
                              : <span className="po-status-badge po-status-transit">В пути 🚚</span>
                            }
                          </td>
                          <td>
                            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                              <button type="button" onClick={() => openAccept(po)} className="po-action-btn po-action-green">
                                <FiCheck size={13} /> {isPartial ? 'Принять ещё' : 'Принять'}
                              </button>
                              <button type="button" onClick={() => { if (window.confirm('Отменить заказ?')) cancelPO.mutate(po.id); }} className="po-action-btn po-action-red">
                                <FiX size={13} /> Отменить
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Completed (hidden, recent) */}
            {completedOrders.length > 0 && (
              <div style={{ marginTop: 20, opacity: 0.5 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', paddingLeft: 2 }}>
                  Принято в склад · {completedOrders.length} заказов
                </div>
              </div>
            )}

            {/* Cancelled block */}
            {cancelledOrders.length > 0 && (
              <div style={{ marginTop: 20 }}>
                <button
                  type="button"
                  onClick={() => setShowCancelledBlock((v) => !v)}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 700, color: 'var(--text-muted)', padding: '0 0 10px' }}
                >
                  {showCancelledBlock ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
                  Отменённые · {cancelledOrders.length}
                </button>
                {showCancelledBlock && (
                  <div className="po-table-wrap">
                    <table className="po-table">
                      <tbody>
                        {cancelledOrders.map((po) => (
                          <tr key={po.id} style={{ opacity: 0.6 }}>
                            <td><div className="po-thumb">{po.photo_data ? <img src={po.photo_data} alt="" /> : <FiPackage size={20} />}</div></td>
                            <td><div style={{ fontWeight: 700, fontSize: 14, textDecoration: 'line-through', color: 'var(--text-muted)' }}>{po.name}</div></td>
                            <td colSpan={5}><span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{po.supplier || ''} · {po.quantity_ordered} шт.</span></td>
                            <td><span className="po-status-badge po-status-cancelled">Отменён</span></td>
                            <td>
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button type="button" onClick={() => restorePO.mutate(po.id)} className="po-action-btn po-action-amber">
                                  <FiRotateCcw size={13} /> Восстановить
                                </button>
                                <button type="button" onClick={() => { if (window.confirm('Удалить навсегда?')) deletePO.mutate(po.id); }} className="po-action-btn po-action-red">
                                  <FiTrash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>{/* /reserve-content */}

      {/* ══════════════════════════════════════════════════════════════════════
          MODALS
      ══════════════════════════════════════════════════════════════════════ */}

      {/* ── Add / Edit Wish Item ── */}
      <Modal isOpen={showWishModal || Boolean(editWish)} onClose={() => { setShowWishModal(false); setEditWish(null); }} title={editWish ? 'Редактировать товар' : 'Добавить в список'}>
        <Field label="Фото товара">
          <PhotoZone photoData={wishForm.photo_data} onPhoto={(d) => setWishForm((f) => ({ ...f, photo_data: d }))} onRemove={() => setWishForm((f) => ({ ...f, photo_data: '' }))} />
        </Field>
        <Field label="Название" required>
          <input className="ios-input" placeholder="Название товара" value={wishForm.name} onChange={(e) => setWishForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <div className="reserve-form-row">
          <Field label="Марка">
            <input className="ios-input" placeholder="Бренд / марка" value={wishForm.brand} onChange={(e) => setWishForm((f) => ({ ...f, brand: e.target.value }))} />
          </Field>
          <Field label="Категория">
            <input className="ios-input" list="wish-categories" placeholder="Выберите или введите" value={wishForm.category} onChange={(e) => setWishForm((f) => ({ ...f, category: e.target.value }))} />
            <datalist id="wish-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>
        </div>
        <Field label="Доп. информация">
          <textarea className="ios-input" rows={3} placeholder="Артикул, особые характеристики, примечания..." value={wishForm.notes} onChange={(e) => setWishForm((f) => ({ ...f, notes: e.target.value }))} style={{ resize: 'vertical', minHeight: 70 }} />
        </Field>
        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button type="button" onClick={() => { setShowWishModal(false); setEditWish(null); }} style={{ flex: 1, padding: 13, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text-secondary)' }}>Отмена</button>
          <button type="button" onClick={saveWish} disabled={createWish.isPending || updateWish.isPending} style={{ flex: 2, padding: 13, borderRadius: 14, border: 'none', background: 'linear-gradient(135deg,#6366f1,#7c3aed)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
            {createWish.isPending || updateWish.isPending ? 'Сохранение…' : editWish ? 'Сохранить' : 'Добавить в список'}
          </button>
        </div>
      </Modal>

      {/* ── Place Order (PO) modal ── */}
      <Modal isOpen={Boolean(orderWish)} onClose={() => setOrderWish(null)} title="Оформить заказ" maxWidth={460}>
        {orderWish && (
          <>
            {/* Product preview */}
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', padding: '12px 14px', borderRadius: 16, background: 'var(--ios-grouped-bg)', border: '1px solid var(--border)', marginBottom: 20 }}>
              {orderWish.photo_data
                ? <img src={orderWish.photo_data} alt="" style={{ width: 56, height: 56, borderRadius: 12, objectFit: 'cover', flexShrink: 0 }} />
                : <div style={{ width: 56, height: 56, borderRadius: 12, background: 'var(--bg-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><FiPackage size={22} style={{ color: 'var(--text-muted)' }} /></div>
              }
              <div>
                <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>{orderWish.name}</div>
                {orderWish.brand && <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{orderWish.brand}</div>}
              </div>
            </div>

            <Field label="Штрих-код (авто)">
              <div style={{ position: 'relative' }}>
                <input className="ios-input" value={poForm.barcode} onChange={(e) => setPoForm((f) => ({ ...f, barcode: e.target.value }))} style={{ paddingRight: 44 }} />
                <button type="button" onClick={() => setPoForm((f) => ({ ...f, barcode: generateEAN13() }))} style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--primary)' }}>
                  <FiRefreshCw size={16} />
                </button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, fontWeight: 500 }}>
                Сгенерирован автоматически — не совпадает с товарами на складе
              </div>
            </Field>

            <Field label="Поставщик">
              <input className="ios-input" placeholder="Имя или компания" value={poForm.supplier} onChange={(e) => setPoForm((f) => ({ ...f, supplier: e.target.value }))} />
            </Field>

            <div className="reserve-form-row">
              <Field label="Цена (юань ¥)">
                <input className="ios-input" type="number" min="0" step="0.01" placeholder="0.00" value={poForm.price_cny} onChange={(e) => setPoForm((f) => ({ ...f, price_cny: e.target.value }))} />
                {cnyKzt !== null && (
                  <div style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 700, marginTop: 4 }}>≈ ₸ {money(cnyKzt)} <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>курс {cnyRate}</span></div>
                )}
              </Field>
              <Field label="Количество">
                <input className="ios-input" type="number" min="1" value={poForm.quantity_ordered} onChange={(e) => setPoForm((f) => ({ ...f, quantity_ordered: e.target.value }))} />
              </Field>
            </div>

            <Field label="Доп. информация">
              <textarea className="ios-input" rows={2} value={poForm.notes} onChange={(e) => setPoForm((f) => ({ ...f, notes: e.target.value }))} style={{ resize: 'vertical' }} />
            </Field>

            <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
              <button type="button" onClick={() => setOrderWish(null)} style={{ flex: 1, padding: 13, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text-secondary)' }}>Отмена</button>
              <button type="button" onClick={saveOrder} disabled={createPO.isPending} style={{ flex: 2, padding: 13, borderRadius: 14, border: 'none', background: 'linear-gradient(135deg,#6366f1,#7c3aed)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {createPO.isPending ? 'Оформление…' : '🚚 Заказать'}
              </button>
            </div>
          </>
        )}
      </Modal>

      {/* ── Accept to Stock modal ── */}
      <Modal isOpen={Boolean(acceptPO)} onClose={() => { setAcceptPO(null); setAcceptForm(emptyAccept()); }} title="Приёмка товара" maxWidth={500}>
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
                  Заказано: <b>{acceptPO.quantity_ordered} шт.</b>
                  {acceptPO.quantity_received > 0 && <> · Принято: <b style={{ color: 'var(--success)' }}>{acceptPO.quantity_received} шт.</b></>}
                </div>
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

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" onClick={() => { setAcceptPO(null); setAcceptForm(emptyAccept()); }} style={{ flex: 1, padding: 13, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: 'var(--text-secondary)' }}>Отмена</button>
              <button type="button" onClick={saveAccept} disabled={acceptMutation.isPending} style={{ flex: 2, padding: 13, borderRadius: 14, border: 'none', background: 'linear-gradient(135deg,#10b981,#059669)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {acceptMutation.isPending ? 'Добавление…' : '✅ Добавить в склад'}
              </button>
            </div>
          </>
        )}
      </Modal>

    </div>/* /reserve-shell */
  );
};

export default Reserve;

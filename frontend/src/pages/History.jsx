import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  FiPlus, FiEdit2, FiTrash2, FiPackage, FiDownload,
  FiX, FiRotateCcw, FiTag, FiDollarSign, FiClipboard,
  FiSearch, FiCheck, FiChevronDown, FiAlertTriangle,
  FiClock, FiArchive, FiShoppingBag, FiExternalLink,
} from 'react-icons/fi';
import { historyApi } from '../api/history';
import { salesApi } from '../api/sales';
import { resolveUploadedAssetUrl } from '../api/client';

/* ── operation config ── */
const OP = {
  added:     { label: 'Добавлено',     emoji: '✅', color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  Icon: FiPlus },
  edited:    { label: 'Изменено',      emoji: '✏️', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)', Icon: FiEdit2 },
  deleted:   { label: 'Удалено',       emoji: '🗑️', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  Icon: FiTrash2 },
  ordered:   { label: 'Заказано',      emoji: '📦', color: '#f59e0b', bg: 'rgba(245,158,11,0.12)', Icon: FiPackage },
  to_stock:  { label: 'В склад',       emoji: '📥', color: '#6366f1', bg: 'rgba(99,102,241,0.12)', Icon: FiDownload },
  cancelled: { label: 'Отменено',      emoji: '❌', color: '#ef4444', bg: 'rgba(239,68,68,0.12)',  Icon: FiX },
  restored:  { label: 'Восстановлено', emoji: '🔄', color: '#0ea5e9', bg: 'rgba(14,165,233,0.12)', Icon: FiRotateCcw },
  discount:  { label: 'Скидка',        emoji: '🏷️', color: '#8b5cf6', bg: 'rgba(139,92,246,0.12)', Icon: FiTag },
  sold:      { label: 'Продано',       emoji: '💰', color: '#22c55e', bg: 'rgba(34,197,94,0.12)',  Icon: FiDollarSign },
  revision:  { label: 'Ревизия',       emoji: '📋', color: '#6366f1', bg: 'rgba(99,102,241,0.12)', Icon: FiClipboard },
};

const FILTERS = [
  { key: 'all',       label: 'Все' },
  { key: 'added',     label: 'Добавлено ✅' },
  { key: 'edited',    label: 'Изменено ✏️' },
  { key: 'deleted',   label: 'Удалено 🗑️' },
  { key: 'ordered',   label: 'Заказано 📦' },
  { key: 'to_stock',  label: 'В склад 📥' },
  { key: 'cancelled', label: 'Отменено ❌' },
  { key: 'restored',  label: 'Восстановлено 🔄' },
  { key: 'discount',  label: 'Скидка 🏷️' },
];

const PERIODS = [
  { key: 'today', label: 'Сегодня' },
  { key: 'week',  label: 'Неделя' },
  { key: 'month', label: 'Месяц' },
  { key: 'all',   label: 'Всё время' },
];

/* ── helpers ── */
const money = (v) => Number(v || 0).toLocaleString('ru-RU');

const formatTime = (d) =>
  new Date(d).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });

const formatDateTime = (d) => new Date(d).toLocaleString('ru-RU');

function getDateKey(dateStr) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getDateLabel(dateStr) {
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = (today - target) / 86_400_000;
  if (diff === 0) return 'Сегодня';
  if (diff === 1) return 'Вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function groupByDate(items) {
  const map = new Map();
  for (const item of items) {
    const key = getDateKey(item.created_at);
    if (!map.has(key)) map.set(key, { label: getDateLabel(item.created_at), items: [] });
    map.get(key).items.push(item);
  }
  return [...map.values()];
}

function isInPeriod(dateStr, period) {
  if (period === 'all') return true;
  const d = new Date(dateStr);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (period === 'today') return d >= today;
  if (period === 'week') { const w = new Date(today); w.setDate(w.getDate() - 7); return d >= w; }
  if (period === 'month') { const m = new Date(today); m.setMonth(m.getMonth() - 1); return d >= m; }
  return true;
}

function downloadCSV(filename, headers, rows) {
  const csv = [
    headers.join(','),
    ...rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')),
  ].join('\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function getEditDiff(details) {
  if (!details) return null;
  const oldValues = details.old_values || details.before;
  const newValues = details.new_values || details.after;
  if (!oldValues || !newValues) return null;
  return { oldValues, newValues };
}

const FIELD_LABELS = {
  name: 'Название',
  sku: 'Артикул',
  barcode: 'Штрих-код',
  quantity: 'Количество',
  sale_price: 'Продажа',
  purchase_price: 'Закуп',
  cny_price: 'Закуп ¥',
  delivery_cost_kzt: 'Доставка',
};

function humanFieldLabel(key) {
  return FIELD_LABELS[key] || key.replace(/_/g, ' ');
}

function getOpDescription(item) {
  if (item.details?.message) return item.details.message;
  const op = OP[item.operation_type];
  const name = item.product?.name || item.details?.product_name || item.details?.name || '';
  if (name) return `${op?.label || item.operation_type}: ${name}`;
  return op?.label || item.operation_type;
}

const inputStyle = {
  width: '100%', padding: '10px 14px', borderRadius: 12,
  border: '1px solid var(--border)', background: 'var(--bg-secondary)',
  fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
};

/* ── Modal ── */
function Modal({ isOpen, onClose, title, children, maxWidth = 480 }) {
  if (!isOpen) return null;
  return createPortal(
    <div className="reserve-modal-overlay" onClick={onClose}>
      <div className="reserve-modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth }}>
        <div className="reserve-modal-header">
          <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--text)' }}>{title}</div>
          <button type="button" onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
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
function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 7 }}>
        {label}
      </label>
      {children}
    </div>
  );
}

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════ */
const History = () => {
  const qc = useQueryClient();
  const navigate = useNavigate();

  /* ── state ── */
  const [mainTab, setMainTab] = useState('logistics');
  const [opFilter, setOpFilter] = useState('all');
  const [logisticsSearchInput, setLogisticsSearchInput] = useState('');
  const [logisticsSearch, setLogisticsSearch] = useState('');
  const [salesPeriod, setSalesPeriod] = useState('today');
  const [salesSearch, setSalesSearch] = useState('');
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [selectedSaleIds, setSelectedSaleIds] = useState(new Set());
  const [sideItem, setSideItem] = useState(null);
  const [expandedReceipts, setExpandedReceipts] = useState(new Set());
  const [showExportModal, setShowExportModal] = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [exportType, setExportType] = useState('logistics');
  const [exportPeriod, setExportPeriod] = useState('all');

  useEffect(() => {
    const timer = setTimeout(() => setLogisticsSearch(logisticsSearchInput.trim()), 300);
    return () => clearTimeout(timer);
  }, [logisticsSearchInput]);

  /* ── queries ── */
  const { data: historyItems = [], isLoading: hLoading } = useQuery({
    queryKey: ['history', logisticsSearch],
    queryFn: async () => {
      const params = { limit: 500 };
      if (logisticsSearch) params.search = logisticsSearch;
      const r = await historyApi.getHistory(params);
      return r.data;
    },
  });

  const { data: sales = [], isLoading: sLoading } = useQuery({
    queryKey: ['sales'],
    queryFn: async () => {
      const r = await salesApi.getSales();
      return r.data;
    },
  });

  /* ── mutations ── */
  const clearHistoryMut = useMutation({
    mutationFn: () => historyApi.clearHistory(),
    onSuccess: () => {
      toast.success('История очищена');
      setShowClearConfirm(false);
      qc.invalidateQueries({ queryKey: ['history'] });
    },
    onError: () => toast.error('Не удалось очистить'),
  });

  const clearSalesMut = useMutation({
    mutationFn: () => salesApi.clearSales(),
    onSuccess: () => {
      toast.success('Продажи очищены');
      setShowClearConfirm(false);
      qc.invalidateQueries({ queryKey: ['sales'] });
    },
    onError: () => toast.error('Не удалось очистить'),
  });

  const deleteSaleMut = useMutation({
    mutationFn: (id) => salesApi.deleteSale(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sales'] }),
  });

  /* ── computed ── */
  const filteredHistory = useMemo(() => {
    if (opFilter === 'all') return historyItems;
    return historyItems.filter((i) => i.operation_type === opFilter);
  }, [historyItems, opFilter]);

  const groupedHistory = useMemo(() => groupByDate(filteredHistory), [filteredHistory]);

  const filteredSales = useMemo(() => {
    let items = sales.filter((s) => isInPeriod(s.created_at, salesPeriod));
    if (salesSearch.trim()) {
      const q = salesSearch.toLowerCase();
      items = items.filter(
        (s) =>
          (s.receipt_number || '').toLowerCase().includes(q) ||
          (s.items || []).some((i) => String(i.product_id).includes(q)),
      );
    }
    return items;
  }, [sales, salesPeriod, salesSearch]);

  const salesStats = useMemo(() => {
    const count = filteredSales.length;
    const total = filteredSales.reduce((s, sale) => s + Number(sale.total_amount || 0), 0);
    const avg = count > 0 ? Math.round(total / count) : 0;
    return { count, total, avg };
  }, [filteredSales]);

  /* ── handlers ── */
  const toggleSelect = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleSaleSelect = useCallback((id) => {
    setSelectedSaleIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const bulkDeleteHistory = async () => {
    const ids = [...selectedIds];
    for (const id of ids) {
      try {
        await historyApi.deleteHistoryItem(id);
      } catch { /* skip */ }
    }
    toast.success(`Удалено ${ids.length} записей`);
    setSelectedIds(new Set());
    qc.invalidateQueries({ queryKey: ['history'] });
  };

  const bulkDeleteSales = async () => {
    const ids = [...selectedSaleIds];
    for (const id of ids) {
      try {
        await salesApi.deleteSale(id);
      } catch { /* skip */ }
    }
    toast.success(`Удалено ${ids.length} чеков`);
    setSelectedSaleIds(new Set());
    qc.invalidateQueries({ queryKey: ['sales'] });
  };

  const handleExport = () => {
    if (exportType === 'logistics') {
      const items = historyItems.filter((i) => isInPeriod(i.created_at, exportPeriod));
      downloadCSV(
        'logistics_export.csv',
        ['ID', 'Дата', 'Тип', 'Описание', 'Изменение', 'Источник'],
        items.map((i) => [
          i.id,
          formatDateTime(i.created_at),
          OP[i.operation_type]?.label || i.operation_type,
          getOpDescription(i),
          i.quantity_change || 0,
          i.reference_type || '',
        ]),
      );
    } else {
      const items = sales.filter((s) => isInPeriod(s.created_at, exportPeriod));
      const rows = [];
      items.forEach((s) => {
        (s.items || []).forEach((it) => {
          rows.push([
            s.receipt_number,
            formatDateTime(s.created_at),
            it.product_id,
            it.quantity,
            it.unit_price,
            it.subtotal,
            s.payment_method || '',
            s.total_amount,
          ]);
        });
      });
      downloadCSV(
        'sales_export.csv',
        ['Чек', 'Дата', 'Товар ID', 'Количество', 'Цена', 'Сумма позиции', 'Оплата', 'Итого чека'],
        rows,
      );
    }
    setShowExportModal(false);
    toast.success('Экспорт скачан');
  };

  const toggleReceipt = (id) => {
    setExpandedReceipts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /* ═══════ JSX ═══════ */
  return (
    <div className="history-shell">
      <div className="history-content">

        {/* ━━━━━━━ LOGISTICS TAB ━━━━━━━ */}
        {mainTab === 'logistics' && (
          <>
            <div className="reserve-header">
              <div>
                <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--text)' }}>Логистика</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="reserve-ghost-btn"
                  onClick={() => { setExportType('logistics'); setShowExportModal(true); }}
                  title="Экспорт"
                >
                  <FiDownload size={18} />
                </button>
                <button
                  className="reserve-ghost-btn"
                  onClick={() => setShowClearConfirm('history')}
                  title="Очистить"
                  style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                >
                  <FiTrash2 size={18} />
                </button>
              </div>
            </div>

            {/* Filter chips */}
            <div className="history-filter-bar">
              {FILTERS.map((f) => {
                const active = opFilter === f.key;
                const opConf = OP[f.key];
                return (
                  <button
                    key={f.key}
                    onClick={() => setOpFilter(f.key)}
                    className={`history-chip ${active ? 'active' : ''}`}
                    style={
                      active && opConf
                        ? { background: opConf.bg, color: opConf.color, borderColor: `${opConf.color}44` }
                        : {}
                    }
                  >
                    {f.label}
                  </button>
                );
              })}
            </div>

            <div className="history-sales-toolbar" style={{ marginBottom: 16 }}>
              <div style={{ position: 'relative', flex: 1 }}>
                <FiSearch
                  size={15}
                  style={{
                    position: 'absolute', left: 12, top: '50%',
                    transform: 'translateY(-50%)', color: 'var(--text-muted)',
                  }}
                />
                <input
                  placeholder="Поиск по товару, артикулу, штрих-коду..."
                  value={logisticsSearchInput}
                  onChange={(e) => setLogisticsSearchInput(e.target.value)}
                  style={{ ...inputStyle, paddingLeft: 36 }}
                />
              </div>
            </div>

            {/* Timeline */}
            {hLoading ? (
              <div className="reserve-empty">
                <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>Загрузка...
              </div>
            ) : filteredHistory.length === 0 ? (
              <div className="reserve-empty">
                <div style={{ fontSize: 40, marginBottom: 12 }}>📋</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Нет записей</div>
                <div style={{ fontSize: 13 }}>Все операции будут отображаться здесь</div>
              </div>
            ) : (
              <div className="history-timeline">
                {groupedHistory.map((group, gi) => (
                  <div key={gi}>
                    <div className="history-day-divider">
                      <span>{group.label}</span>
                    </div>
                    {group.items.map((item) => {
                      const op = OP[item.operation_type] || {
                        label: item.operation_type, color: '#888',
                        bg: 'rgba(0,0,0,0.06)', Icon: FiClock, emoji: '•',
                      };
                      const isSelected = selectedIds.has(item.id);
                      return (
                        <div
                          key={item.id}
                          className={`history-entry ${isSelected ? 'selected' : ''}`}
                          onClick={() => setSideItem(item)}
                        >
                          <div className="history-dot" style={{ background: op.color }} />
                          <div className="history-icon" style={{ color: op.color, background: op.bg }}>
                            <op.Icon size={14} />
                          </div>
                          <div className="history-entry-body">
                            <div className="history-entry-text">{getOpDescription(item)}</div>
                            {item.product?.name && item.product.name !== getOpDescription(item) && (
                              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                                {item.product.sku ? `${item.product.sku} · ` : ''}{item.product.name}
                              </div>
                            )}
                            {item.quantity_change != null && item.quantity_change !== 0 && (
                              <span
                                className="history-qty-badge"
                                style={{ color: item.quantity_change > 0 ? '#22c55e' : '#ef4444' }}
                              >
                                {item.quantity_change > 0 ? '+' : ''}
                                {item.quantity_change} шт.
                              </span>
                            )}
                          </div>
                          <div className="history-entry-time">{formatTime(item.created_at)}</div>
                          <label className="history-checkbox" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(item.id)}
                            />
                            <span className="history-check-mark">
                              {isSelected && <FiCheck size={11} />}
                            </span>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ━━━━━━━ SALES TAB ━━━━━━━ */}
        {mainTab === 'sales' && (
          <>
            <div className="reserve-header">
              <div>
                <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--text)' }}>Продажи</div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="reserve-ghost-btn"
                  onClick={() => { setExportType('sales'); setShowExportModal(true); }}
                  title="Экспорт"
                >
                  <FiDownload size={18} />
                </button>
                <button
                  className="reserve-ghost-btn"
                  onClick={() => setShowClearConfirm('sales')}
                  title="Очистить"
                  style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                >
                  <FiTrash2 size={18} />
                </button>
              </div>
            </div>

            {/* Summary stats bar */}
            <div className="reserve-stats-bar">
              <span>📊</span>
              <span>
                {salesPeriod === 'today'
                  ? 'Сегодня'
                  : salesPeriod === 'week'
                    ? 'За неделю'
                    : salesPeriod === 'month'
                      ? 'За месяц'
                      : 'Всё время'}
                :
              </span>
              <b>{salesStats.count} продаж</b>
              <span className="stats-dot">·</span>
              <span>
                Выручка: <b>₸ {money(salesStats.total)}</b>
              </span>
              <span className="stats-dot">·</span>
              <span>
                Средний чек: <b>₸ {money(salesStats.avg)}</b>
              </span>
            </div>

            {/* Period filters + search */}
            <div className="history-sales-toolbar">
              <div className="history-filter-bar" style={{ marginBottom: 0, flex: 1 }}>
                {PERIODS.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => setSalesPeriod(p.key)}
                    className={`history-chip ${salesPeriod === p.key ? 'active' : ''}`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <div style={{ position: 'relative', minWidth: 200 }}>
                <FiSearch
                  size={15}
                  style={{
                    position: 'absolute', left: 12, top: '50%',
                    transform: 'translateY(-50%)', color: 'var(--text-muted)',
                  }}
                />
                <input
                  placeholder="Поиск по чеку или товару..."
                  value={salesSearch}
                  onChange={(e) => setSalesSearch(e.target.value)}
                  style={{ ...inputStyle, paddingLeft: 36 }}
                />
              </div>
            </div>

            {/* Receipt cards */}
            {sLoading ? (
              <div className="reserve-empty">
                <div style={{ fontSize: 24, marginBottom: 8 }}>⏳</div>Загрузка...
              </div>
            ) : filteredSales.length === 0 ? (
              <div className="reserve-empty">
                <div style={{ fontSize: 40, marginBottom: 12 }}>🧾</div>
                <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 6 }}>Нет продаж</div>
                <div style={{ fontSize: 13 }}>Чеки будут отображаться здесь</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {filteredSales.map((sale) => {
                  const expanded = expandedReceipts.has(sale.id);
                  const isSelected = selectedSaleIds.has(sale.id);
                  return (
                    <div
                      key={sale.id}
                      className={`receipt-card ${expanded ? 'expanded' : ''} ${isSelected ? 'selected' : ''}`}
                    >
                      <div className="receipt-card-header" onClick={() => toggleReceipt(sale.id)}>
                        <label className="history-checkbox always-visible" onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSaleSelect(sale.id)}
                          />
                          <span className="history-check-mark">
                            {isSelected && <FiCheck size={11} />}
                          </span>
                        </label>
                        <div className="receipt-card-main">
                          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)' }}>
                            {sale.receipt_number || 'Чек'}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                            {formatDateTime(sale.created_at)}
                          </div>
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', fontWeight: 500 }}>
                          {sale.items?.length || 0} товаров
                        </div>
                        <div
                          style={{
                            fontWeight: 800, fontSize: 16, color: 'var(--primary)',
                            minWidth: 90, textAlign: 'right',
                          }}
                        >
                          ₸ {money(sale.total_amount)}
                        </div>
                        <div
                          style={{
                            color: 'var(--text-muted)', transition: 'transform 0.2s',
                            transform: expanded ? 'rotate(180deg)' : 'none',
                          }}
                        >
                          <FiChevronDown size={18} />
                        </div>
                      </div>
                      {expanded && (
                        <div className="receipt-card-body">
                          {(sale.items || []).map((it) => (
                            <div key={it.id} className="receipt-item-row">
                              <div style={{ flex: 1, fontWeight: 500, color: 'var(--text)' }}>
                                Товар #{it.product_id}
                              </div>
                              <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>
                                {it.quantity} × ₸ {money(it.unit_price)}
                              </div>
                              <div style={{ fontWeight: 700, minWidth: 80, textAlign: 'right' }}>
                                ₸ {money(it.subtotal)}
                              </div>
                            </div>
                          ))}
                          <div className="receipt-total-row">
                            <span>ИТОГО</span>
                            <span>₸ {money(sale.total_amount)}</span>
                          </div>
                          <div style={{ display: 'flex', gap: 8, paddingTop: 10 }}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                deleteSaleMut.mutate(sale.id);
                              }}
                              className="po-action-btn po-action-red"
                              style={{ fontSize: 12 }}
                            >
                              <FiTrash2 size={13} /> Удалить чек
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Bulk action bar ── */}
      {selectedIds.size > 0 && mainTab === 'logistics' && (
        <div className="history-bulk-bar">
          <span>
            Выбрано: <b>{selectedIds.size}</b> записей
          </span>
          <button onClick={bulkDeleteHistory} className="po-action-btn po-action-red">
            <FiTrash2 size={14} /> Удалить выбранные
          </button>
        </div>
      )}
      {selectedSaleIds.size > 0 && mainTab === 'sales' && (
        <div className="history-bulk-bar">
          <span>
            Выбрано: <b>{selectedSaleIds.size}</b> чеков
          </span>
          <button onClick={bulkDeleteSales} className="po-action-btn po-action-red">
            <FiTrash2 size={14} /> Удалить выбранные
          </button>
        </div>
      )}

      {/* ── Side Sheet ── */}
      {sideItem &&
        createPortal(
          <div className="history-sheet-overlay" onClick={() => setSideItem(null)}>
            <div className="history-sheet" onClick={(e) => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--text)' }}>Детали операции</div>
                <button
                  onClick={() => setSideItem(null)}
                  style={{
                    width: 32, height: 32, borderRadius: 10,
                    border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                    justifyContent: 'center', color: 'var(--text-muted)',
                  }}
                >
                  <FiX size={16} />
                </button>
              </div>

              {(() => {
                const op = OP[sideItem.operation_type] || {
                  label: sideItem.operation_type, color: '#888',
                  bg: 'rgba(0,0,0,0.06)', emoji: '•',
                };
                const product = sideItem.product;
                const editDiff = sideItem.operation_type === 'edited'
                  ? getEditDiff(sideItem.details)
                  : null;
                const productImage = product?.image_url
                  ? resolveUploadedAssetUrl(String(product.image_url).split('?')[0].trim())
                  : '';

                return (
                  <>
                    {/* Type badge */}
                    <div
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 8,
                        padding: '6px 14px', borderRadius: 100,
                        background: op.bg, color: op.color,
                        fontWeight: 700, fontSize: 14, marginBottom: 16,
                      }}
                    >
                      {op.emoji} {op.label}
                    </div>

                    {/* Timestamp */}
                    <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
                      {formatDateTime(sideItem.created_at)}
                    </div>

                    {/* Description */}
                    <div style={{ fontWeight: 700, fontSize: 17, color: 'var(--text)', marginBottom: 20 }}>
                      {getOpDescription(sideItem)}
                    </div>

                    {/* Product card */}
                    {product && (
                      <div
                        style={{
                          display: 'flex', gap: 14, padding: 14, marginBottom: 20,
                          borderRadius: 16, border: '1px solid var(--border)',
                          background: 'var(--bg-secondary)',
                        }}
                      >
                        {productImage ? (
                          <img
                            src={productImage}
                            alt={product.name}
                            style={{
                              width: 72, height: 72, borderRadius: 12,
                              objectFit: 'cover', flexShrink: 0,
                              border: '1px solid var(--border)',
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 72, height: 72, borderRadius: 12,
                              background: 'var(--surface)', flexShrink: 0,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              fontSize: 28, border: '1px solid var(--border)',
                            }}
                          >
                            📦
                          </div>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)', marginBottom: 6 }}>
                            {product.name}
                          </div>
                          {product.sku && (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}>
                              Артикул: {product.sku}
                            </div>
                          )}
                          {product.barcode && (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                              Штрих-код: {product.barcode}
                            </div>
                          )}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 13 }}>
                            <span>Остаток: <b>{product.quantity ?? 0} шт.</b></span>
                            {product.sale_price != null && (
                              <span>Продажа: <b>₸ {money(product.sale_price)}</b></span>
                            )}
                            {product.purchase_price != null && (
                              <span>Закуп: <b>₸ {money(product.purchase_price)}</b></span>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {(product?.id || sideItem.product_id) && (
                      <button
                        type="button"
                        onClick={() => {
                          const pid = product?.id || sideItem.product_id;
                          setSideItem(null);
                          navigate(`/products?product=${pid}`);
                        }}
                        className="reserve-primary-btn"
                        style={{ width: '100%', marginBottom: 20, justifyContent: 'center' }}
                      >
                        <FiExternalLink size={16} /> Открыть товар
                      </button>
                    )}

                    {/* Properties grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 20 }}>
                      <div style={{ background: 'var(--bg-secondary)', padding: 12, borderRadius: 14 }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>ID</div>
                        <div style={{ fontWeight: 700, color: 'var(--text)' }}>{sideItem.id}</div>
                      </div>
                      {sideItem.product_id && (
                        <div style={{ background: 'var(--bg-secondary)', padding: 12, borderRadius: 14 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Товар ID</div>
                          <div style={{ fontWeight: 700, color: 'var(--text)' }}>#{sideItem.product_id}</div>
                        </div>
                      )}
                      {sideItem.reference_type && (
                        <div style={{ background: 'var(--bg-secondary)', padding: 12, borderRadius: 14 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Источник</div>
                          <div style={{ fontWeight: 700, color: 'var(--text)' }}>{sideItem.reference_type}</div>
                        </div>
                      )}
                      {sideItem.quantity_change != null && (
                        <div style={{ background: 'var(--bg-secondary)', padding: 12, borderRadius: 14 }}>
                          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Изменение</div>
                          <div
                            style={{
                              fontWeight: 700,
                              color:
                                sideItem.quantity_change > 0
                                  ? '#22c55e'
                                  : sideItem.quantity_change < 0
                                    ? '#ef4444'
                                    : 'var(--text)',
                            }}
                          >
                            {sideItem.quantity_change > 0 ? '+' : ''}
                            {sideItem.quantity_change} шт.
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Diff view for edited items */}
                    {editDiff && (
                        <div style={{ marginBottom: 20 }}>
                          <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 10, color: 'var(--text)' }}>
                            Было / Стало
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                            <div
                              style={{
                                background: 'rgba(239,68,68,0.06)', padding: 12,
                                borderRadius: 14, border: '1px solid rgba(239,68,68,0.15)',
                              }}
                            >
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#ef4444', marginBottom: 8 }}>БЫЛО</div>
                              {Object.entries(editDiff.oldValues).map(([k, v]) => (
                                <div key={k} style={{ fontSize: 13, marginBottom: 4 }}>
                                  <span style={{ color: 'var(--text-muted)' }}>{humanFieldLabel(k)}: </span>
                                  <span style={{ textDecoration: 'line-through', color: '#ef4444' }}>{String(v)}</span>
                                </div>
                              ))}
                            </div>
                            <div
                              style={{
                                background: 'rgba(34,197,94,0.06)', padding: 12,
                                borderRadius: 14, border: '1px solid rgba(34,197,94,0.15)',
                              }}
                            >
                              <div style={{ fontSize: 11, fontWeight: 700, color: '#22c55e', marginBottom: 8 }}>СТАЛО</div>
                              {Object.entries(editDiff.newValues).map(([k, v]) => (
                                <div key={k} style={{ fontSize: 13, marginBottom: 4 }}>
                                  <span style={{ color: 'var(--text-muted)' }}>{humanFieldLabel(k)}: </span>
                                  <span style={{ fontWeight: 600, color: '#22c55e' }}>{String(v)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                  </>
                );
              })()}
            </div>
          </div>,
          document.body,
        )}

      {/* ── Export Modal ── */}
      <Modal isOpen={showExportModal} onClose={() => setShowExportModal(false)} title="Экспорт данных">
        <Field label="Тип данных">
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              { k: 'logistics', l: 'Логистика' },
              { k: 'sales', l: 'Продажи' },
            ].map((t) => (
              <button
                key={t.k}
                onClick={() => setExportType(t.k)}
                className={`history-chip ${exportType === t.k ? 'active' : ''}`}
                style={{ flex: 1, justifyContent: 'center' }}
              >
                {t.l}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Период">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {PERIODS.map((p) => (
              <button
                key={p.key}
                onClick={() => setExportPeriod(p.key)}
                className={`history-chip ${exportPeriod === p.key ? 'active' : ''}`}
              >
                {p.label}
              </button>
            ))}
          </div>
        </Field>
        <button
          onClick={handleExport}
          className="reserve-primary-btn"
          style={{ width: '100%', marginTop: 10, justifyContent: 'center' }}
        >
          <FiDownload size={16} /> Скачать
        </button>
      </Modal>

      {/* ── Clear confirmation ── */}
      <Modal
        isOpen={!!showClearConfirm}
        onClose={() => setShowClearConfirm(false)}
        title="Очистить данные"
        maxWidth={400}
      >
        <div style={{ padding: '12px 0' }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: 14,
              borderRadius: 14, background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.2)', marginBottom: 20,
            }}
          >
            <FiAlertTriangle size={20} style={{ color: '#f59e0b', flexShrink: 0 }} />
            <div style={{ fontSize: 13, color: '#b45309', fontWeight: 500 }}>
              Это действие удалит{' '}
              {showClearConfirm === 'history' ? 'всю историю операций' : 'все чеки продаж'} и не может
              быть отменено.
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button
              onClick={() => setShowClearConfirm(false)}
              style={{
                flex: 1, padding: '12px', borderRadius: 14,
                border: '1px solid var(--border)', background: 'var(--surface)',
                color: 'var(--text)', fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}
            >
              Отмена
            </button>
            <button
              onClick={() =>
                showClearConfirm === 'history'
                  ? clearHistoryMut.mutate()
                  : clearSalesMut.mutate()
              }
              style={{
                flex: 1, padding: '12px', borderRadius: 14,
                border: 'none', background: 'var(--danger)', color: '#fff',
                fontWeight: 700, fontSize: 14, cursor: 'pointer',
              }}
            >
              Удалить
            </button>
          </div>
        </div>
      </Modal>

      {/* ── Bottom dock ── */}
      <div className="history-dock">
        <button
          className={`reserve-dock-tab ${mainTab === 'logistics' ? 'active' : ''}`}
          onClick={() => {
            setMainTab('logistics');
            setSelectedSaleIds(new Set());
          }}
        >
          <FiArchive size={20} />
          <span>Логистика · {historyItems.length}</span>
        </button>
        <button
          className={`reserve-dock-tab ${mainTab === 'sales' ? 'active' : ''}`}
          onClick={() => {
            setMainTab('sales');
            setSelectedIds(new Set());
          }}
        >
          <FiShoppingBag size={20} />
          <span>Продажи · {sales.length}</span>
        </button>
      </div>
    </div>
  );
};

export default History;

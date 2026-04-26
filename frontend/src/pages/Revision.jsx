import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  FiX, FiSearch, FiCheck, FiAlertTriangle,
  FiChevronDown, FiChevronRight, FiDownload, FiPlay,
  FiRefreshCw, FiClipboard,
} from 'react-icons/fi';
import { revisionApi, fetchAllProducts } from '../api/client';

/* ── helpers ── */
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

const inputStyle = {
  width: '100%', padding: '10px 14px', borderRadius: 12,
  border: '1px solid var(--border)', background: 'var(--bg-secondary)',
  fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
};

/* ── Modal ── */
function Modal({ isOpen, onClose, title, children, maxWidth = 520 }) {
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

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════ */
const Revision = () => {
  const qc = useQueryClient();

  /* ── state ── */
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [quantities, setQuantities] = useState({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [applyCorrections, setApplyCorrections] = useState(true);
  const [showPastSessions, setShowPastSessions] = useState(false);
  const [detailSession, setDetailSession] = useState(null);
  const [selectedSessionId, setSelectedSessionId] = useState(null);
  const [completionReport, setCompletionReport] = useState(null);

  /* ── queries ── */
  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ['revisions'],
    queryFn: async () => {
      try {
        const r = await revisionApi.getAll();
        return (r.data || []).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      } catch { return []; }
    },
  });

  const { data: products = [] } = useQuery({
    queryKey: ['products-revision'],
    queryFn: async () => {
      try { return await fetchAllProducts(); }
      catch { return []; }
    },
  });

  const serverActiveSession = useMemo(
    () => sessions.find((s) => s.status === 'in_progress'),
    [sessions],
  );
  const activeSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) || null,
    [sessions, selectedSessionId],
  );

  const pastSessions = useMemo(
    () => sessions.filter((s) => s.status !== 'in_progress'),
    [sessions],
  );

  const productMap = useMemo(() => {
    const m = {};
    products.forEach((p) => { m[p.id] = p; });
    return m;
  }, [products]);

  const categories = useMemo(() => {
    const set = new Set();
    products.forEach((p) => { if (p.category) set.add(p.category); });
    return [...set].sort();
  }, [products]);

  /* Items to display: products from catalog, cross-referenced with session items if active */
  const displayItems = useMemo(() => {
    let items = products
      .filter((p) => p.is_active !== false)
      .map((p) => ({
        productId: p.id,
        name: p.name,
        category: p.category,
        brand: p.brand,
        barcode: p.barcode,
        expected: p.quantity,
        actual: quantities[p.id] ?? null,
      }));

    if (catFilter !== 'all') {
      items = items.filter((i) => i.category === catFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      items = items.filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.barcode || '').toLowerCase().includes(q) ||
          (i.brand || '').toLowerCase().includes(q),
      );
    }
    return items;
  }, [products, quantities, catFilter, search]);

  /* Stats */
  const stats = useMemo(() => {
    const total = products.filter((p) => p.is_active !== false).length;
    const checked = Object.keys(quantities).length;
    let discrepancies = 0;
    let shortage = 0;
    let surplus = 0;
    for (const [pid, actual] of Object.entries(quantities)) {
      const p = productMap[pid];
      if (!p) continue;
      const diff = actual - p.quantity;
      if (diff !== 0) {
        discrepancies++;
        if (diff < 0) shortage += Math.abs(diff);
        else surplus += diff;
      }
    }
    return { total, checked, discrepancies, shortage, surplus };
  }, [quantities, products, productMap]);

  /* ── mutations ── */
  const startMut = useMutation({
    mutationFn: () => revisionApi.start({}),
    onSuccess: (res) => {
      toast.success('Ревизия начата');
      setQuantities({});
      setSelectedSessionId(res?.data?.id || null);
      qc.invalidateQueries({ queryKey: ['revisions'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail || 'Ошибка'),
  });

  const completeMut = useMutation({
    mutationFn: async () => {
      if (!activeSession) return;
      const sid = activeSession.id;
      for (const [pid, actual] of Object.entries(quantities)) {
        try {
          await revisionApi.updateItem(sid, parseInt(pid), {
            quantity_actual: actual,
            correction_notes: null,
          });
        } catch { /* best effort */ }
      }
      return revisionApi.complete(sid, applyCorrections);
    },
    onSuccess: (res) => {
      toast.success('Ревизия завершена');
      setQuantities({});
      setShowConfirm(false);
      setSelectedSessionId(null);
      setCompletionReport(res?.data || null);
      qc.invalidateQueries({ queryKey: ['revisions'] });
      qc.invalidateQueries({ queryKey: ['products-revision'] });
      qc.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) => toast.error(err.response?.data?.detail || 'Ошибка завершения'),
  });

  const cancelMut = useMutation({
    mutationFn: () => activeSession && revisionApi.cancel(activeSession.id),
    onSuccess: () => {
      toast.success('Ревизия отменена');
      setQuantities({});
      setSelectedSessionId(null);
      qc.invalidateQueries({ queryKey: ['revisions'] });
    },
  });

  /* ── handlers ── */
  const setActual = (productId, value) => {
    const n = parseInt(value);
    setQuantities((prev) => {
      const next = { ...prev };
      if (value === '' || isNaN(n)) delete next[productId];
      else next[productId] = Math.max(0, n);
      return next;
    });
  };

  const exportSession = (session) => {
    if (!session?.items) return;
    downloadCSV(
      `revision_${session.session_code}.csv`,
      ['Товар', 'Категория', 'Ожидалось', 'Фактически', 'Разница', 'Статус'],
      session.items.map((it) => {
        const p = productMap[it.product_id];
        const diff = (it.quantity_actual ?? it.quantity_expected) - it.quantity_expected;
        return [
          p?.name || `#${it.product_id}`,
          p?.category || '',
          it.quantity_expected,
          it.quantity_actual ?? '—',
          diff,
          diff === 0 ? 'OK' : diff > 0 ? 'Излишек' : 'Недостача',
        ];
      }),
    );
    toast.success('Экспорт скачан');
  };

  /* CAT badge colors */
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

  /* ═══════ JSX ═══════ */
  return (
    <div className="revision-shell">
      <div className="revision-content">

        {/* Header */}
        <div className="reserve-header">
          <div>
            <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--text)' }}>Ревизия</div>
            {activeSession && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                Начата: {new Date(activeSession.created_at).toLocaleString('ru-RU')}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {!activeSession ? (
              <button
                className="reserve-primary-btn"
                onClick={() => startMut.mutate()}
                disabled={startMut.isPending}
              >
                <FiPlay size={16} />
                {startMut.isPending ? 'Запуск...' : 'Начать ревизию +'}
              </button>
            ) : (
              <>
                <button
                  className="reserve-primary-btn"
                  style={{ background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}
                  onClick={() => {/* already active, just a label */}}
                >
                  <FiRefreshCw size={16} /> Ревизия в процессе
                </button>
              </>
            )}
          </div>
        </div>

        {/* Orphan active revision on server (not auto-opened) */}
        {!activeSession && serverActiveSession && (
          <div
            style={{
              marginBottom: 14,
              padding: '12px 14px',
              borderRadius: 12,
              border: '1px solid rgba(245,158,11,0.25)',
              background: 'rgba(245,158,11,0.08)',
              color: '#b45309',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 600 }}>
              Найдена незавершенная ревизия {serverActiveSession.session_code}. Она не запускается автоматически.
            </div>
            <button
              type="button"
              onClick={() => setSelectedSessionId(serverActiveSession.id)}
              className="reserve-primary-btn"
              style={{ padding: '8px 14px', fontSize: 13 }}
            >
              Продолжить
            </button>
          </div>
        )}

        {/* Active session content */}
        {activeSession && (
          <>
            {/* Search + category filter */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                <FiSearch size={15} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  placeholder="Поиск по названию, штрих-коду..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ ...inputStyle, paddingLeft: 36 }}
                />
              </div>
            </div>

            <div className="history-filter-bar" style={{ marginBottom: 14 }}>
              <button
                className={`history-chip ${catFilter === 'all' ? 'active' : ''}`}
                onClick={() => setCatFilter('all')}
              >
                Все
              </button>
              {categories.map((c) => (
                <button
                  key={c}
                  className={`history-chip ${catFilter === c ? 'active' : ''}`}
                  onClick={() => setCatFilter(c)}
                >
                  {c}
                </button>
              ))}
            </div>

            {/* Summary bar */}
            <div className="reserve-stats-bar" style={{ marginBottom: 14 }}>
              <span>📊</span>
              <span>Проверено: <b>{stats.checked} / {stats.total}</b></span>
              <span className="stats-dot">·</span>
              <span>Расхождений: <b style={{ color: stats.discrepancies > 0 ? '#f59e0b' : 'inherit' }}>{stats.discrepancies}</b></span>
              <span className="stats-dot">·</span>
              <span>Недостача: <b style={{ color: stats.shortage > 0 ? '#ef4444' : 'inherit' }}>−{stats.shortage} шт.</b></span>
              <span className="stats-dot">·</span>
              <span>Излишек: <b style={{ color: stats.surplus > 0 ? '#22c55e' : 'inherit' }}>+{stats.surplus} шт.</b></span>
            </div>

            {/* Revision table */}
            <div className="revision-table-wrap">
              <table className="revision-table">
                <thead>
                  <tr>
                    <th>Товар</th>
                    <th>Категория</th>
                    <th style={{ textAlign: 'center' }}>В системе</th>
                    <th style={{ textAlign: 'center' }}>Фактически</th>
                    <th style={{ textAlign: 'center' }}>Разница</th>
                  </tr>
                </thead>
                <tbody>
                  {displayItems.map((item) => {
                    const diff = item.actual !== null ? item.actual - item.expected : null;
                    let rowBg = 'transparent';
                    if (diff !== null && diff < 0) rowBg = 'rgba(239,68,68,0.05)';
                    if (diff !== null && diff > 0) rowBg = 'rgba(34,197,94,0.05)';
                    const cat = getCatColor(item.category);

                    return (
                      <tr key={item.productId} style={{ background: rowBg }}>
                        <td>
                          <div style={{ fontWeight: 600, color: 'var(--text)' }}>{item.name}</div>
                          {item.brand && (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{item.brand}</div>
                          )}
                        </td>
                        <td>
                          {item.category && (
                            <span style={{
                              display: 'inline-block', padding: '2px 10px', borderRadius: 100,
                              fontSize: 11, fontWeight: 700, background: cat.bg, color: cat.color,
                            }}>
                              {item.category}
                            </span>
                          )}
                        </td>
                        <td style={{ textAlign: 'center', color: 'var(--text-muted)', fontWeight: 600, fontSize: 15 }}>
                          {item.expected}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          <input
                            type="number"
                            min="0"
                            placeholder="—"
                            value={item.actual ?? ''}
                            onChange={(e) => setActual(item.productId, e.target.value)}
                            className="revision-input"
                          />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {diff !== null ? (
                            <span
                              style={{
                                fontWeight: 800, fontSize: 15,
                                color: diff === 0 ? 'var(--text-muted)' : diff > 0 ? '#22c55e' : '#ef4444',
                              }}
                            >
                              {diff > 0 ? '+' : ''}{diff}
                            </span>
                          ) : (
                            <span style={{ color: 'var(--border)', fontSize: 13 }}>—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {displayItems.length === 0 && (
                    <tr>
                      <td colSpan={5} style={{ textAlign: 'center', padding: 40, color: 'var(--text-muted)' }}>
                        Нет товаров по заданным фильтрам
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
              <button
                onClick={() => cancelMut.mutate()}
                style={{
                  padding: '12px 20px', borderRadius: 14,
                  border: '1px solid var(--border)', background: 'var(--surface)',
                  color: 'var(--text)', fontWeight: 700, fontSize: 14, cursor: 'pointer',
                }}
              >
                Отмена
              </button>
              <button
                onClick={() => {
                  if (stats.checked === 0) {
                    toast.error('Проверьте хотя бы один товар');
                    return;
                  }
                  setShowConfirm(true);
                }}
                className="reserve-primary-btn"
                style={{ flex: 1, justifyContent: 'center' }}
                disabled={stats.checked === 0}
              >
                <FiCheck size={16} /> Завершить ревизию
              </button>
            </div>
          </>
        )}

        {/* No active session info */}
        {!activeSession && !sessionsLoading && (
          <div className="reserve-empty" style={{ marginTop: 20 }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
            <div style={{ fontWeight: 700, fontSize: 18, marginBottom: 8, color: 'var(--text)' }}>
              Нет активной ревизии
            </div>
            <div style={{ fontSize: 14, maxWidth: 400, margin: '0 auto' }}>
              Начните новую ревизию чтобы сверить остатки товаров на складе. Сканируйте или вводите количество вручную.
            </div>
          </div>
        )}

        {/* Past revisions */}
        {pastSessions.length > 0 && (
          <div style={{ marginTop: 30 }}>
            <button
              onClick={() => setShowPastSessions(!showPastSessions)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '12px 16px',
                borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)',
                cursor: 'pointer', fontWeight: 700, fontSize: 14, color: 'var(--text)', width: '100%',
              }}
            >
              {showPastSessions ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
              Прошлые ревизии · {pastSessions.length}
            </button>

            {showPastSessions && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 10 }}>
                {pastSessions.map((session) => {
                  const discCount = (session.items || []).filter(
                    (it) => it.quantity_actual != null && it.quantity_actual !== it.quantity_expected,
                  ).length;
                  return (
                    <div
                      key={session.id}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '14px 16px', borderRadius: 16,
                        background: 'var(--surface)', border: '1px solid var(--border)',
                      }}
                    >
                      <div>
                        <div style={{ fontWeight: 700, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>
                          {session.session_code}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {new Date(session.created_at).toLocaleString('ru-RU')} · {session.items?.length || 0} товаров
                          {discCount > 0 && (
                            <span style={{ color: '#f59e0b', marginLeft: 8 }}>
                              ⚠️ {discCount} расхождений
                            </span>
                          )}
                          {discCount === 0 && (
                            <span style={{ color: '#22c55e', marginLeft: 8 }}>✓ Всё совпало</span>
                          )}
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button
                          onClick={() => exportSession(session)}
                          className="reserve-ghost-btn"
                          title="Экспорт"
                        >
                          <FiDownload size={16} />
                        </button>
                        <button
                          onClick={() => setDetailSession(session)}
                          className="reserve-ghost-btn"
                          title="Просмотр"
                        >
                          <FiClipboard size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Completion confirmation modal ── */}
      <Modal isOpen={showConfirm} onClose={() => setShowConfirm(false)} title="Завершить ревизию">
        <div style={{ marginBottom: 16 }}>
          <div className="reserve-stats-bar" style={{ marginBottom: 14 }}>
            <span>Проверено: <b>{stats.checked} / {stats.total}</b></span>
            <span className="stats-dot">·</span>
            <span>Расхождений: <b>{stats.discrepancies}</b></span>
          </div>

          {stats.discrepancies > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14, maxHeight: 200, overflowY: 'auto' }}>
              {Object.entries(quantities)
                .filter(([pid, actual]) => {
                  const p = productMap[pid];
                  return p && actual !== p.quantity;
                })
                .map(([pid, actual]) => {
                  const p = productMap[pid];
                  const diff = actual - p.quantity;
                  return (
                    <div
                      key={pid}
                      style={{
                        display: 'flex', justifyContent: 'space-between', padding: '8px 12px',
                        borderRadius: 10, background: diff < 0 ? 'rgba(239,68,68,0.06)' : 'rgba(34,197,94,0.06)',
                        border: `1px solid ${diff < 0 ? 'rgba(239,68,68,0.15)' : 'rgba(34,197,94,0.15)'}`,
                        fontSize: 13,
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{p.name}</span>
                      <span style={{ fontWeight: 700, color: diff < 0 ? '#ef4444' : '#22c55e' }}>
                        {p.quantity} → {actual} ({diff > 0 ? '+' : ''}{diff})
                      </span>
                    </div>
                  );
                })}
            </div>
          )}

          {stats.checked < stats.total && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12,
              background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)',
              marginBottom: 14, fontSize: 13, color: '#b45309',
            }}>
              <FiAlertTriangle size={16} style={{ flexShrink: 0 }} />
              Не все товары проверены ({stats.total - stats.checked} осталось). Непроверенные останутся без изменений.
            </div>
          )}

          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', padding: '10px 0' }}>
            <input
              type="checkbox"
              checked={applyCorrections}
              onChange={(e) => setApplyCorrections(e.target.checked)}
              style={{ width: 18, height: 18, accentColor: 'var(--primary)' }}
            />
            <span style={{ fontWeight: 600, fontSize: 14, color: 'var(--text)' }}>
              Применить корректировки к остаткам
            </span>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={() => setShowConfirm(false)}
            style={{
              flex: 1, padding: '12px', borderRadius: 14,
              border: '1px solid var(--border)', background: 'var(--surface)',
              color: 'var(--text)', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            }}
          >
            Отмена
          </button>
          <button
            onClick={() => completeMut.mutate()}
            disabled={completeMut.isPending}
            style={{
              flex: 1, padding: '12px', borderRadius: 14, border: 'none',
              background: '#22c55e', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer',
            }}
          >
            {completeMut.isPending ? 'Сохранение...' : 'Подтвердить и закрыть'}
          </button>
        </div>
      </Modal>

      {/* ── Completion report modal ── */}
      <Modal isOpen={!!completionReport} onClose={() => setCompletionReport(null)} title="Отчёт ревизии" maxWidth={720}>
        {completionReport && (
          <div style={{ display: 'grid', gap: 12 }}>
            <div className="reserve-stats-bar" style={{ marginBottom: 0 }}>
              <span>Проверено: <b>{completionReport.checked_items || 0}</b></span>
              <span className="stats-dot">·</span>
              <span>Совпало: <b style={{ color: '#22c55e' }}>{completionReport.matched_items?.length || 0}</b></span>
              <span className="stats-dot">·</span>
              <span>Недостача: <b style={{ color: '#ef4444' }}>{completionReport.shortage_items?.length || 0}</b></span>
              <span className="stats-dot">·</span>
              <span>Излишек: <b style={{ color: '#16a34a' }}>{completionReport.surplus_items?.length || 0}</b></span>
            </div>

            {[
              { key: 'shortage_items', title: 'Не вышли (недостача)', color: '#ef4444' },
              { key: 'surplus_items', title: 'Пробили больше (излишек)', color: '#16a34a' },
            ].map((group) => (
              <div key={group.key}>
                <div style={{ fontWeight: 800, fontSize: 14, color: group.color, marginBottom: 8 }}>{group.title}</div>
                {(completionReport[group.key] || []).length === 0 ? (
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>Нет</div>
                ) : (
                  <div style={{ display: 'grid', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                    {(completionReport[group.key] || []).map((it) => (
                      <div
                        key={`${group.key}-${it.product_id}`}
                        style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)', background: 'var(--surface)' }}
                      >
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{it.name}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap' }}>
                          нужно: {it.expected} · вышло: {it.actual} · разница: {it.difference > 0 ? `+${it.difference}` : it.difference}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Modal>

      {/* ── Session detail sheet ── */}
      {detailSession && createPortal(
        <div className="history-sheet-overlay" onClick={() => setDetailSession(null)}>
          <div className="history-sheet" onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <div>
                <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--text)' }}>{detailSession.session_code}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                  {new Date(detailSession.created_at).toLocaleString('ru-RU')}
                </div>
              </div>
              <button
                onClick={() => setDetailSession(null)}
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

            {/* Stats */}
            {(() => {
              const items = detailSession.items || [];
              const disc = items.filter((i) => i.quantity_actual != null && i.quantity_actual !== i.quantity_expected);
              return (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 20 }}>
                    <div style={{ background: 'var(--bg-secondary)', padding: 12, borderRadius: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Товаров</div>
                      <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--text)' }}>{items.length}</div>
                    </div>
                    <div style={{ background: 'var(--bg-secondary)', padding: 12, borderRadius: 14 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Расхождений</div>
                      <div style={{ fontWeight: 800, fontSize: 18, color: disc.length > 0 ? '#f59e0b' : '#22c55e' }}>{disc.length}</div>
                    </div>
                  </div>
                  <div style={{ maxHeight: 400, overflowY: 'auto' }}>
                    {items.map((it) => {
                      const p = productMap[it.product_id];
                      const diff = (it.quantity_actual ?? it.quantity_expected) - it.quantity_expected;
                      return (
                        <div
                          key={it.id}
                          style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '10px 12px', borderRadius: 10, marginBottom: 6,
                            background: diff !== 0
                              ? diff < 0
                                ? 'rgba(239,68,68,0.05)'
                                : 'rgba(34,197,94,0.05)'
                              : 'transparent',
                          }}
                        >
                          <div style={{ fontWeight: 500, fontSize: 13, color: 'var(--text)' }}>
                            {p?.name || `#${it.product_id}`}
                          </div>
                          <div style={{ display: 'flex', gap: 14, alignItems: 'center', fontSize: 13 }}>
                            <span style={{ color: 'var(--text-muted)' }}>{it.quantity_expected}</span>
                            <span style={{ color: 'var(--text-muted)' }}>→</span>
                            <span style={{ fontWeight: 700, color: diff === 0 ? 'var(--text)' : diff < 0 ? '#ef4444' : '#22c55e' }}>
                              {it.quantity_actual ?? '—'}
                            </span>
                            {diff !== 0 && (
                              <span style={{ fontWeight: 800, fontSize: 12, color: diff < 0 ? '#ef4444' : '#22c55e' }}>
                                ({diff > 0 ? '+' : ''}{diff})
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              );
            })()}

            <button
              onClick={() => { exportSession(detailSession); }}
              className="reserve-primary-btn"
              style={{ width: '100%', justifyContent: 'center', marginTop: 16 }}
            >
              <FiDownload size={16} /> Экспорт в CSV
            </button>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

export default Revision;

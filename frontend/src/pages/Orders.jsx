import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  FiList,
  FiRefreshCw,
  FiPhone,
  FiCalendar,
  FiHash,
  FiShoppingBag,
  FiLayers,
  FiCheck,
  FiX,
  FiCopy,
  FiMessageCircle,
  FiArrowLeft,
  FiSend,
} from 'react-icons/fi';
import { orderApi } from '../api/client';

/** Фильтр по точному статусу в API (старые заказы могут иметь «Новый заказ с сайта») */
const FILTER_STATUSES = ['', 'Новый заказ', 'Новый заказ с сайта', 'Выдано', 'Отменен'];

const ALMATY_TZ = 'Asia/Almaty';

const money = (v) => Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const fmtWhen = (d) =>
  d
    ? new Date(d).toLocaleString('ru-RU', {
        timeZone: ALMATY_TZ,
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

const lineStatusOf = (it) => it?.line_status || 'pending';

const isActiveLine = (it) => lineStatusOf(it) !== 'cancelled';

const sourceLabel = (s) => {
  if (s === 'website') return 'Сайт';
  if (s === 'manual') return 'Склад';
  return s || '—';
};

/** В интерфейсе старый статус показываем как «Новый заказ» */
const displayStatus = (s) => (s === 'Новый заказ с сайта' ? 'Новый заказ' : s);

const isPendingOrder = (o) => o && (o.status === 'Новый заказ' || o.status === 'Новый заказ с сайта');

function statusClass(status) {
  if (status === 'Новый заказ' || status === 'Новый заказ с сайта') return 'orders-status--new';
  if (status === 'Выдано') return 'orders-status--done';
  if (status === 'Отменен') return 'orders-status--cancel';
  return 'orders-status--muted';
}

function errMessage(err) {
  const d = err?.response?.data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => x.msg || x).join(', ');
  return 'Не удалось выполнить действие';
}

function lineAmountItem(it) {
  if (it.line_total != null && it.line_total !== '') return Number(it.line_total);
  const q = it.quantity ?? it.quantity_ordered ?? 0;
  const p = it.sale_price_snapshot ?? it.price_kzt ?? 0;
  return Number(p) * Number(q);
}

/** Для wa.me: только цифры, 10-значный KZ/РФ — добавляем 7 */
function digitsForWhatsApp(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10) return `7${d}`;
  if (d.length === 11 && d.startsWith('8')) return `7${d.slice(1)}`;
  return d;
}

function buildItemsLines(order) {
  return (order.items || [])
    .filter(isActiveLine)
    .map((it) => {
    const n = it.product_name || it.name || 'Товар';
    const q = it.quantity ?? it.quantity_ordered ?? 0;
    const a = lineAmountItem(it);
    return `• ${n} × ${q} = ${money(a)} ₸`;
  });
}

function buildWhatsappText(order) {
  const code = order.order_code || `#${order.id}`;
  const sum = money(order.total_amount || order.total_amount_kzt);
  const name = (order.customer_name || 'клиент').trim();
  const phone = (order.customer_phone || '').trim() || 'не указан';
  const when = fmtWhen(order.created_at);
  const src = sourceLabel(order.source);
  const lines = buildItemsLines(order);
  const block = [
    'Здравствуйте!',
    `Вы оформили заказ ${code} на сайте (источник: ${src}).`,
    `Дата: ${when}.`,
    `Сумма заказа: ${sum} ₸.`,
    lines.length ? `Позиции:\n${lines.join('\n')}` : null,
    order.notes && String(order.notes).trim() ? `Комментарий и доставка:\n${String(order.notes).trim()}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
  return block;
}

/** Один блок для вставки в мессенджер / Excel */
function buildManagerClipboardText(order) {
  const code = order.order_code || `#${order.id}`;
  const sum = money(order.total_amount || order.total_amount_kzt);
  const name = (order.customer_name || '—').trim();
  const phone = (order.customer_phone || '—').trim();
  const when = fmtWhen(order.created_at);
  const src = sourceLabel(order.source);
  const st = displayStatus(order.status);
  const lines = buildItemsLines(order);
  return [
    `Заказ ${code} · ${st}`,
    `Создан: ${when}`,
    `Источник: ${src}`,
    `Сумма: ${sum} ₸`,
    `Имя: ${name}`,
    `Телефон: ${phone}`,
    lines.length ? `Позиции:\n${lines.join('\n')}` : 'Позиции: —',
    order.notes && String(order.notes).trim() ? `Комментарий / доставка:\n${String(order.notes).trim()}` : null,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export default function Orders() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);
  const [selectedLine, setSelectedLine] = useState(null);
  const [mobileDetail, setMobileDetail] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState('out_of_stock');
  const [cancelComment, setCancelComment] = useState('');

  const CANCEL_REASONS = [
    { value: 'wrong_product', label: 'Неверный товар' },
    { value: 'not_paid', label: 'Не оплачен' },
    { value: 'invalid_contact_data', label: 'Некорректные контакты' },
    { value: 'not_reachable', label: 'Не дозвонились' },
    { value: 'out_of_stock', label: 'Нет в наличии' },
    { value: 'client_refused', label: 'Клиент отказался' },
    { value: 'duplicate', label: 'Дубль' },
    { value: 'other', label: 'Другое' },
  ];

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders', status, source, search],
    queryFn: () =>
      orderApi
        .getAll({ status: status || undefined, source: source || undefined, customer: search || undefined, limit: 200 })
        .then((r) => r.data),
  });
  const { data: ordersForStats = [] } = useQuery({
    queryKey: ['orders', 'quick-stats'],
    queryFn: () => orderApi.getAll({ limit: 200 }).then((r) => r.data),
  });

  const selectedOrder = useMemo(() => orders.find((o) => o.id === selected) || null, [orders, selected]);

  useEffect(() => {
    setSelectedLine(null);
  }, [selected]);

  useEffect(() => {
    const onResize = () => {
      if (window.innerWidth > 900) setMobileDetail(false);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const pickOrder = (id) => {
    setSelected(id);
    if (typeof window !== 'undefined' && window.innerWidth <= 900) setMobileDetail(true);
  };

  const backToList = () => setMobileDetail(false);

  const stats = useMemo(() => {
    const list = orders;
    const sum = list.reduce((a, o) => a + Number(o.total_amount ?? o.total_amount_kzt ?? 0), 0);
    const site = list.filter((o) => o.source === 'website').length;
    return { count: list.length, sum, site };
  }, [orders]);
  const quickStatusStats = useMemo(() => {
    const src = Array.isArray(ordersForStats) ? ordersForStats : [];
    const get = (st) => src.filter((o) => o.status === st).length;
    return {
      all: src.length,
      new: get('Новый заказ') + get('Новый заказ с сайта'),
      done: get('Выдано'),
      cancel: get('Отменен'),
    };
  }, [ordersForStats]);

  const copyText = async (text, successMsg) => {
    if (!text) {
      toast.error('Нечего копировать');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMsg || 'Скопировано');
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const statusMut = useMutation({
    mutationFn: ({ id, nextStatus, cancellation_reason, cancellation_comment }) =>
      orderApi.updateStatus(id, {
        status: nextStatus,
        cancellation_reason: cancellation_reason || null,
        cancellation_comment: cancellation_comment || null,
      }),
    onSuccess: (_, vars) => {
      toast.success(
        vars.nextStatus === 'Выдано' ? 'Заказ выдан, товар списан со склада' : 'Заказ отменён',
      );
      if (vars.nextStatus === 'Отменен') setCancelOpen(false);
      setSelectedLine(null);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-stats'] });
    },
    onError: (err) => toast.error(errMessage(err)),
  });

  const cancelItemMut = useMutation({
    mutationFn: ({ orderId, itemId }) => orderApi.cancelItem(orderId, itemId),
    onSuccess: () => {
      toast.success('Позиция отменена');
      setSelectedLine(null);
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: (err) => toast.error(errMessage(err)),
  });

  const retryTelegramMut = useMutation({
    mutationFn: (orderId) => orderApi.retryNotification(orderId),
    onSuccess: () => toast.success('Уведомление отправлено в Telegram'),
    onError: (err) => toast.error(errMessage(err)),
  });

  const lineAmount = (it) => lineAmountItem(it);

  const handleIssue = () => {
    if (!selectedOrder) return;
    statusMut.mutate({ id: selectedOrder.id, nextStatus: 'Выдано' });
  };

  const handleCancel = () => {
    if (!selectedOrder) return;
    setCancelReason('out_of_stock');
    setCancelComment('');
    setCancelOpen(true);
  };

  const submitCancel = () => {
    if (!selectedOrder) return;
    if (cancelReason === 'other' && !cancelComment.trim()) {
      toast.error('Для «Другое» укажите комментарий');
      return;
    }
    statusMut.mutate({
      id: selectedOrder.id,
      nextStatus: 'Отменен',
      cancellation_reason: cancelReason,
      cancellation_comment: cancelComment,
    });
  };

  const handleCancelLine = () => {
    if (!selectedOrder || !selectedLine) return;
    const item = (selectedOrder.items || []).find((it) => it.id === selectedLine);
    if (!item || !isActiveLine(item)) return;
    if (!window.confirm(`Отменить позицию «${item.product_name}»?`)) return;
    cancelItemMut.mutate({ orderId: selectedOrder.id, itemId: selectedLine });
  };

  const openWhatsApp = (order) => {
    const d = digitsForWhatsApp(order.customer_phone);
    if (!d || d.length < 10) {
      toast.error('Номер для WhatsApp не распознан — проверьте телефон');
      return;
    }
    const text = buildWhatsappText(order);
    const url = `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const clearFilters = () => {
    setStatus('');
    setSource('');
    setSearch('');
    setSelected(null);
  };

  return (
    <div className="page-ios orders-page">
      <header className="orders-header">
        <div>
          <h1 className="ios-mega-title orders-title">
            <FiList className="orders-title-icon" aria-hidden />
            Заказы
          </h1>
          <p className="orders-subtitle">
            Выберите заказ слева. Позицию можно отменить отдельно — нажмите строку в таблице и «Отменить позицию».
          </p>
        </div>
      </header>

      <div className="orders-stats">
        <div className="orders-stat-card">
          <span className="orders-stat-label">В списке</span>
          <span className="orders-stat-value">{isLoading ? '…' : stats.count}</span>
        </div>
        <div className="orders-stat-card">
          <span className="orders-stat-label">С сайта</span>
          <span className="orders-stat-value">{isLoading ? '…' : stats.site}</span>
        </div>
        <div className="orders-stat-card orders-stat-card--accent">
          <span className="orders-stat-label">Сумма (на экране)</span>
          <span className="orders-stat-value">{isLoading ? '…' : `${money(stats.sum)} ₸`}</span>
        </div>
      </div>

      <div className="ios-card orders-filters">
        <div className="orders-quick-tabs">
          <button type="button" className={`orders-quick-tab ${status === '' ? 'orders-quick-tab--active' : ''}`} onClick={() => setStatus('')}>
            Все ({quickStatusStats.all})
          </button>
          <button type="button" className={`orders-quick-tab ${status === 'Новый заказ' ? 'orders-quick-tab--active' : ''}`} onClick={() => setStatus('Новый заказ')}>
            Новые ({quickStatusStats.new})
          </button>
          <button type="button" className={`orders-quick-tab ${status === 'Выдано' ? 'orders-quick-tab--active' : ''}`} onClick={() => setStatus('Выдано')}>
            Выдано ({quickStatusStats.done})
          </button>
          <button type="button" className={`orders-quick-tab ${status === 'Отменен' ? 'orders-quick-tab--active' : ''}`} onClick={() => setStatus('Отменен')}>
            Отменено ({quickStatusStats.cancel})
          </button>
        </div>
        <div className="orders-filters-grid">
          <label className="orders-field">
            <span className="orders-field-label">Поиск клиента</span>
            <input
              className="ios-input"
              placeholder="Имя или телефон"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              autoComplete="off"
            />
          </label>
          <label className="orders-field">
            <span className="orders-field-label">Статус</span>
            <select className="ios-input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Все</option>
              {FILTER_STATUSES.filter(Boolean).map((s) => (
                <option key={s} value={s}>
                  {s === 'Новый заказ с сайта' ? 'Новый заказ (старые)' : s}
                </option>
              ))}
            </select>
          </label>
          <label className="orders-field">
            <span className="orders-field-label">Источник</span>
            <select className="ios-input" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="">Все</option>
              <option value="website">Сайт (витрина)</option>
              <option value="manual">Склад (вручную)</option>
            </select>
          </label>
        </div>
      </div>

      <div className={`orders-layout ${mobileDetail ? 'orders-layout--detail' : ''}`}>
        <section
          className={`ios-card orders-list-card ${mobileDetail ? 'orders-list-card--hidden' : ''}`}
          aria-label="Список заказов"
        >
          {isLoading && (
            <div className="orders-empty">
              <div className="ui-skeleton-line" style={{ height: 14, width: '70%', marginBottom: 8 }} />
              <div className="ui-skeleton-line" style={{ height: 14, width: '55%' }} />
            </div>
          )}
          {!isLoading && orders.length === 0 && (
            <div className="orders-empty">
              Нет заказов по текущим фильтрам
              <button type="button" className="orders-btn-ghost" style={{ marginTop: 10 }} onClick={clearFilters}>
                Сбросить фильтры
              </button>
            </div>
          )}
          {!isLoading &&
            orders.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`orders-list-item ${selected === o.id ? 'orders-list-item--active' : ''}`}
                onClick={() => pickOrder(o.id)}
              >
                <div className="orders-list-item-top">
                  <span className="orders-list-code">
                    <FiHash size={14} aria-hidden />
                    {o.order_code || `#${o.id}`}
                  </span>
                  <span className={`orders-status-pill ${statusClass(o.status)}`}>{displayStatus(o.status)}</span>
                </div>
                <div className="orders-list-name">{o.customer_name}</div>
                <div className="orders-list-meta">
                  <span>
                    <FiPhone size={12} aria-hidden /> {o.customer_phone || '—'}
                  </span>
                  <span>{sourceLabel(o.source)}</span>
                </div>
                <div className="orders-list-sum">{money(o.total_amount || o.total_amount_kzt)} ₸</div>
              </button>
            ))}
        </section>

        <section
          className={`ios-card orders-detail ${mobileDetail ? 'orders-detail--mobile' : ''}`}
          aria-label="Детали заказа"
        >
          {mobileDetail && selectedOrder ? (
            <button type="button" className="orders-back-btn" onClick={backToList}>
              <FiArrowLeft size={18} aria-hidden />
              К списку
            </button>
          ) : null}
          {!selectedOrder ? (
            <div className="orders-detail-placeholder">
              <FiShoppingBag size={40} strokeWidth={1.25} aria-hidden />
              <p>Выберите заказ в списке слева</p>
            </div>
          ) : (
            <>
              <div className="orders-detail-head">
                <div>
                  <h2 className="orders-detail-title">
                    Заказ <span className="orders-v-name">{selectedOrder.order_code || `#${selectedOrder.id}`}</span>
                  </h2>
                  <div className="orders-detail-sub">
                    <span>
                      <FiCalendar size={14} aria-hidden /> {fmtWhen(selectedOrder.created_at)}
                    </span>
                    <span className={`orders-status-pill ${statusClass(selectedOrder.status)}`}>
                      {displayStatus(selectedOrder.status)}
                    </span>
                  </div>
                </div>
              </div>

              <div className="orders-contact-btns">
                <button
                  type="button"
                  className="orders-wa-btn"
                  onClick={() => openWhatsApp(selectedOrder)}
                >
                  <FiMessageCircle size={16} aria-hidden />
                  WhatsApp
                </button>
                <button
                  type="button"
                  className="orders-copy-btn"
                  onClick={() => copyText(buildManagerClipboardText(selectedOrder), 'Все реквизиты заказа скопированы')}
                >
                  <FiCopy size={16} aria-hidden />
                  Скопировать
                </button>
                <button
                  type="button"
                  className="orders-btn-ghost"
                  onClick={() => retryTelegramMut.mutate(selectedOrder.id)}
                  disabled={retryTelegramMut.isPending}
                >
                  {retryTelegramMut.isPending ? (
                    <FiRefreshCw size={16} className="orders-spin" aria-hidden />
                  ) : (
                    <FiSend size={16} aria-hidden />
                  )}
                  Telegram
                </button>
              </div>

              <div className="orders-detail-grid">
                <div className="orders-kv orders-kv--block">
                  <span className="orders-k">Контактное имя</span>
                  <div className="orders-v-name">{selectedOrder.customer_name || '—'}</div>
                </div>
                <div className="orders-kv orders-kv--block">
                  <span className="orders-k">Телефон</span>
                  <div className="orders-phone-line">
                    <span>{selectedOrder.customer_phone || '—'}</span>
                    {selectedOrder.customer_phone && (
                      <button
                        type="button"
                        className="orders-copy-btn"
                        onClick={() =>
                          copyText(
                            String(selectedOrder.customer_phone).replace(/\s/g, ''),
                            'Номер скопирован',
                          )
                        }
                      >
                        <FiCopy size={14} aria-hidden />
                        Скопировать номер
                      </button>
                    )}
                  </div>
                </div>
                <div className="orders-kv">
                  <span className="orders-k">Источник</span>
                  <span className="orders-v orders-v-strong">{sourceLabel(selectedOrder.source)}</span>
                </div>
                <div className="orders-kv">
                  <span className="orders-k">Сумма</span>
                  <span className="orders-v orders-v-strong">{money(selectedOrder.total_amount || selectedOrder.total_amount_kzt)} ₸</span>
                </div>
              </div>

              {selectedOrder.notes ? (
                <div className="orders-notes notes-block-emphasis">
                  <div className="orders-notes-label">Комментарий и доставка</div>
                  <pre className="orders-notes-body">{selectedOrder.notes}</pre>
                </div>
              ) : null}

              <div className="orders-items-head">
                <div className="orders-items-head-row">
                  <span>
                    <FiLayers size={16} aria-hidden />
                    Позиции
                  </span>
                  {isPendingOrder(selectedOrder) && selectedLine ? (
                    <button
                      type="button"
                      className="orders-btn-line-cancel"
                      onClick={handleCancelLine}
                      disabled={cancelItemMut.isPending}
                    >
                      <FiX size={14} aria-hidden />
                      Отменить позицию
                    </button>
                  ) : null}
                </div>
                {isPendingOrder(selectedOrder) ? (
                  <p className="orders-items-hint">Нажмите строку, чтобы выбрать позицию для отмены</p>
                ) : null}
              </div>
              <div className="orders-table-wrap">
                <table className="orders-table">
                  <thead>
                    <tr>
                      <th>Наименование</th>
                      <th className="orders-table-num">Кол-во</th>
                      <th className="orders-table-num">Цена</th>
                      <th className="orders-table-num">Сумма</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selectedOrder.items || []).map((it) => {
                      const cancelled = !isActiveLine(it);
                      const fulfilled = lineStatusOf(it) === 'fulfilled';
                      return (
                        <tr
                          key={it.id}
                          className={[
                            cancelled ? 'orders-table-row--cancelled' : '',
                            selectedLine === it.id ? 'orders-table-row--selected' : '',
                            isPendingOrder(selectedOrder) && !cancelled ? 'orders-table-row--pickable' : '',
                          ]
                            .filter(Boolean)
                            .join(' ')}
                          onClick={() => {
                            if (!isPendingOrder(selectedOrder) || cancelled) return;
                            setSelectedLine((prev) => (prev === it.id ? null : it.id));
                          }}
                        >
                          <td>
                            <strong>{it.product_name}</strong>
                            {cancelled ? <span className="orders-line-badge orders-line-badge--cancel">Отменено</span> : null}
                            {fulfilled ? <span className="orders-line-badge orders-line-badge--done">Выдано</span> : null}
                          </td>
                          <td className="orders-table-num">{it.quantity ?? it.quantity_ordered}</td>
                          <td className="orders-table-num">{money(it.sale_price_snapshot ?? it.price_kzt)}</td>
                          <td className="orders-table-num">
                            <strong>{money(lineAmount(it))}</strong>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {isPendingOrder(selectedOrder) && (
                <div className="orders-actions orders-actions--sticky">
                  <button
                    type="button"
                    className="orders-btn-issue"
                    onClick={handleIssue}
                    disabled={statusMut.isPending || !(selectedOrder.items || []).some(isActiveLine)}
                  >
                    <FiCheck size={18} aria-hidden />
                    Выдано
                  </button>
                  <button
                    type="button"
                    className="orders-btn-cancel-outline"
                    onClick={handleCancel}
                    disabled={statusMut.isPending}
                  >
                    <FiX size={18} aria-hidden />
                    Отменить заказ
                  </button>
                </div>
              )}
            </>
          )}
        </section>
      </div>
      {cancelOpen &&
        createPortal(
          <div
            className="reserve-modal-overlay"
            onClick={() => setCancelOpen(false)}
            role="presentation"
          >
            <div
              className="reserve-modal-box"
              onClick={(e) => e.stopPropagation()}
              style={{ maxWidth: 400 }}
            >
              <div className="reserve-modal-header" style={{ fontWeight: 800 }}>
                Отмена заказа
              </div>
              <div className="reserve-modal-body" style={{ display: 'grid', gap: 10 }}>
                <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                  Причина
                  <select
                    className="ios-input"
                    value={cancelReason}
                    onChange={(e) => setCancelReason(e.target.value)}
                  >
                    {CANCEL_REASONS.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>
                {cancelReason === 'other' && (
                  <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>
                    Комментарий
                    <textarea
                      className="ios-input"
                      rows={3}
                      value={cancelComment}
                      onChange={(e) => setCancelComment(e.target.value)}
                    />
                  </label>
                )}
                <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                  <button type="button" className="ios-btn" onClick={() => setCancelOpen(false)}>
                    Назад
                  </button>
                  <button
                    type="button"
                    className="orders-btn-confirm-cancel"
                    onClick={submitCancel}
                    disabled={statusMut.isPending}
                  >
                    Подтвердить отмену
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

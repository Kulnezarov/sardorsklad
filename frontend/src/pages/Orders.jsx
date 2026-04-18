import React, { useMemo, useState } from 'react';
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
} from 'react-icons/fi';
import { orderApi } from '../api/client';

/** Фильтр по точному статусу в API (старые заказы могут иметь «Новый заказ с сайта») */
const FILTER_STATUSES = ['', 'Новый заказ', 'Новый заказ с сайта', 'Выдано', 'Отменен'];

const money = (v) => Number(v || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

const fmtWhen = (d) =>
  d ? new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

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

export default function Orders() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [source, setSource] = useState('');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState(null);

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['orders', status, source, search],
    queryFn: () =>
      orderApi
        .getAll({ status: status || undefined, source: source || undefined, customer: search || undefined, limit: 200 })
        .then((r) => r.data),
  });

  const selectedOrder = useMemo(() => orders.find((o) => o.id === selected) || null, [orders, selected]);

  const stats = useMemo(() => {
    const list = orders;
    const sum = list.reduce((a, o) => a + Number(o.total_amount ?? o.total_amount_kzt ?? 0), 0);
    const site = list.filter((o) => o.source === 'website').length;
    return { count: list.length, sum, site };
  }, [orders]);

  const statusMut = useMutation({
    mutationFn: ({ id, nextStatus }) => orderApi.updateStatus(id, { status: nextStatus }),
    onSuccess: (_, vars) => {
      toast.success(
        vars.nextStatus === 'Выдано' ? 'Заказ выдан, товар списан со склада' : 'Заказ отменён',
      );
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      queryClient.invalidateQueries({ queryKey: ['products'] });
      queryClient.invalidateQueries({ queryKey: ['products-stats'] });
    },
    onError: (err) => toast.error(errMessage(err)),
  });

  const retryTelegram = () => {
    orderApi
      .retryNotifications()
      .then(() => toast.success('Повторная отправка в Telegram запущена'))
      .catch(() => toast.error('Не удалось запустить повтор'));
  };

  const lineAmount = (it) => {
    if (it.line_total != null && it.line_total !== '') return Number(it.line_total);
    const q = it.quantity ?? it.quantity_ordered ?? 0;
    const p = it.sale_price_snapshot ?? it.price_kzt ?? 0;
    return Number(p) * Number(q);
  };

  const handleIssue = () => {
    if (!selectedOrder) return;
    statusMut.mutate({ id: selectedOrder.id, nextStatus: 'Выдано' });
  };

  const handleCancel = () => {
    if (!selectedOrder) return;
    if (!window.confirm('Отменить заказ? Со склада ничего не списывается.')) return;
    statusMut.mutate({ id: selectedOrder.id, nextStatus: 'Отменен' });
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
            Новые заказы обрабатывайте кнопками «Выдано» (списание со склада) или «Отменить».
          </p>
        </div>
        <button type="button" className="orders-btn-ghost" onClick={retryTelegram}>
          <FiRefreshCw size={16} aria-hidden />
          Повторить Telegram
        </button>
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

      <div className="orders-layout">
        <section className="ios-card orders-list-card" aria-label="Список заказов">
          {isLoading && <div className="orders-empty">Загрузка…</div>}
          {!isLoading && orders.length === 0 && <div className="orders-empty">Нет заказов по текущим фильтрам</div>}
          {!isLoading &&
            orders.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`orders-list-item ${selected === o.id ? 'orders-list-item--active' : ''}`}
                onClick={() => setSelected(o.id)}
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

        <section className="ios-card orders-detail" aria-label="Детали заказа">
          {!selectedOrder ? (
            <div className="orders-detail-placeholder">
              <FiShoppingBag size={40} strokeWidth={1.25} aria-hidden />
              <p>Выберите заказ в списке слева</p>
            </div>
          ) : (
            <>
              <div className="orders-detail-head">
                <div>
                  <h2 className="orders-detail-title">Заказ {selectedOrder.order_code || `#${selectedOrder.id}`}</h2>
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

              {isPendingOrder(selectedOrder) && (
                <div className="orders-actions">
                  <button
                    type="button"
                    className="orders-btn-issue"
                    onClick={handleIssue}
                    disabled={statusMut.isPending}
                  >
                    <FiCheck size={18} aria-hidden />
                    Выдано
                  </button>
                  <button
                    type="button"
                    className="orders-btn-cancel"
                    onClick={handleCancel}
                    disabled={statusMut.isPending}
                  >
                    <FiX size={18} aria-hidden />
                    Отменить
                  </button>
                </div>
              )}

              <div className="orders-detail-grid">
                <div className="orders-kv">
                  <span className="orders-k">Клиент</span>
                  <span className="orders-v">{selectedOrder.customer_name}</span>
                </div>
                <div className="orders-kv">
                  <span className="orders-k">Телефон</span>
                  <span className="orders-v">{selectedOrder.customer_phone || '—'}</span>
                </div>
                <div className="orders-kv">
                  <span className="orders-k">Источник</span>
                  <span className="orders-v">{sourceLabel(selectedOrder.source)}</span>
                </div>
                <div className="orders-kv">
                  <span className="orders-k">Сумма</span>
                  <span className="orders-v orders-v-strong">{money(selectedOrder.total_amount || selectedOrder.total_amount_kzt)} ₸</span>
                </div>
              </div>

              {selectedOrder.notes ? (
                <div className="orders-notes">
                  <div className="orders-notes-label">Комментарий / доставка</div>
                  <pre className="orders-notes-body">{selectedOrder.notes}</pre>
                </div>
              ) : null}

              <div className="orders-items-head">
                <FiLayers size={16} aria-hidden />
                Позиции
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
                    {(selectedOrder.items || []).map((it) => (
                      <tr key={it.id}>
                        <td>{it.product_name}</td>
                        <td className="orders-table-num">{it.quantity ?? it.quantity_ordered}</td>
                        <td className="orders-table-num">{money(it.sale_price_snapshot ?? it.price_kzt)}</td>
                        <td className="orders-table-num">{money(lineAmount(it))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

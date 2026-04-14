import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { orderApi } from '../api/client';

const STATUSES = [
  'Новый заказ с сайта',
  'В обработке',
  'Подтвержден',
  'Отгружен',
  'Завершен',
  'Отменен',
];

const money = (v) => Number(v || 0).toLocaleString('ru-RU');

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

  const updateStatus = useMutation({
    mutationFn: ({ id, nextStatus }) => orderApi.updateStatus(id, { status: nextStatus }),
    onSuccess: () => {
      toast.success('Статус обновлен');
      queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
    onError: () => toast.error('Не удалось обновить статус'),
  });

  return (
    <div className="page-ios">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
        <h1 className="ios-mega-title">Заказы</h1>
        <button type="button" className="ios-button secondary" onClick={() => orderApi.retryNotifications().then(() => toast.success('Повтор отправки запущен')).catch(() => toast.error('Ошибка ретрая'))}>
          Повторить Telegram уведомления
        </button>
      </div>

      <div className="ios-card" style={{ marginBottom: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10 }}>
        <input className="ios-input" placeholder="Имя/телефон" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="ios-input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Все статусы</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="ios-input" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">Все источники</option>
          <option value="website">website</option>
          <option value="manual">manual</option>
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(320px, 1fr) minmax(320px, 1fr)', gap: 12 }}>
        <div className="ios-card" style={{ maxHeight: '70vh', overflowY: 'auto' }}>
          {isLoading ? 'Загрузка...' : orders.length === 0 ? 'Нет заказов' : orders.map((o) => (
            <button key={o.id} type="button" onClick={() => setSelected(o.id)} style={{ width: '100%', textAlign: 'left', padding: 12, borderRadius: 12, border: selected === o.id ? '1px solid var(--primary)' : '1px solid var(--border)', background: selected === o.id ? 'var(--primary-light)' : 'var(--surface)', marginBottom: 8 }}>
              <div style={{ fontWeight: 700 }}>#{o.id} · {o.customer_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{o.customer_phone || '-'} · {o.source || '-'} · {o.status}</div>
              <div style={{ marginTop: 6, fontWeight: 700 }}>{money(o.total_amount || o.total_amount_kzt)} ₸</div>
            </button>
          ))}
        </div>

        <div className="ios-card">
          {!selectedOrder ? (
            <div style={{ color: 'var(--text-muted)' }}>Выберите заказ слева</div>
          ) : (
            <>
              <h3 style={{ marginTop: 0 }}>Заказ #{selectedOrder.id}</h3>
              <div style={{ marginBottom: 8 }}><b>Клиент:</b> {selectedOrder.customer_name}</div>
              <div style={{ marginBottom: 8 }}><b>Телефон:</b> {selectedOrder.customer_phone || '-'}</div>
              <div style={{ marginBottom: 8 }}><b>Источник:</b> {selectedOrder.source || '-'}</div>
              <div style={{ marginBottom: 8 }}><b>Сумма:</b> {money(selectedOrder.total_amount || selectedOrder.total_amount_kzt)} ₸</div>
              <div style={{ marginBottom: 8 }}><b>Комментарий:</b> {selectedOrder.notes || '-'}</div>
              <div style={{ margin: '12px 0' }}>
                <select className="ios-input" value={selectedOrder.status} onChange={(e) => updateStatus.mutate({ id: selectedOrder.id, nextStatus: e.target.value })} disabled={updateStatus.isPending}>
                  {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>Позиции</div>
              {(selectedOrder.items || []).map((it) => (
                <div key={it.id} style={{ padding: 8, border: '1px solid var(--border)', borderRadius: 10, marginBottom: 6 }}>
                  {it.product_name} · {it.quantity || it.quantity_ordered} шт · {money(it.sale_price_snapshot || it.price_kzt)} ₸
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

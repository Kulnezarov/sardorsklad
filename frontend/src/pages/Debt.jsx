import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FiPlus, FiTrash2, FiChevronRight } from 'react-icons/fi';
import { debtApi, getApiErrorMessage } from '../api/client';
import { Button, Input, Modal } from '../components/ui';
import DebtReceiptModal from '../components/DebtReceiptModal';
import { buildDebtReceiptText, formatDebtDateTime } from '../utils/debtReceipt';
import { openWhatsApp } from '../utils/whatsapp';

const num = (v) => {
  const n = parseFloat(String(v ?? 0).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const formatMoney = (v) => Number(v || 0).toLocaleString('ru-RU');

export default function Debt() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', notes: '' });
  const [saleDetail, setSaleDetail] = useState(null);
  const [receiptSale, setReceiptSale] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');

  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['debt-customers', search],
    queryFn: async () => {
      const r = await debtApi.listCustomers(search);
      return r.data || [];
    },
  });

  const { data: sales = [], refetch: refetchSales } = useQuery({
    queryKey: ['debt-customer-sales', selectedId],
    queryFn: async () => {
      if (!selectedId) return [];
      const r = await debtApi.listCustomerSales(selectedId);
      return r.data || [];
    },
    enabled: Boolean(selectedId),
  });

  const selected = customers.find((c) => c.id === selectedId);

  const createCustomer = useMutation({
    mutationFn: () => debtApi.createCustomer({
      name: form.name.trim(),
      phone: form.phone.trim(),
      notes: form.notes.trim() || undefined,
    }),
    onSuccess: () => {
      toast.success('Клиент добавлен');
      setAddOpen(false);
      setForm({ name: '', phone: '', notes: '' });
      qc.invalidateQueries({ queryKey: ['debt-customers'] });
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });

  const deleteCustomer = useMutation({
    mutationFn: (id) => debtApi.deleteCustomer(id),
    onSuccess: () => {
      toast.success('Клиент удалён');
      setSelectedId(null);
      qc.invalidateQueries({ queryKey: ['debt-customers'] });
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });

  const addPayment = useMutation({
    mutationFn: ({ id, amount, note }) => debtApi.addPayment(id, { amount, note: note || undefined }),
    onSuccess: (r) => {
      toast.success('Оплата записана');
      setSaleDetail(r.data);
      setPayAmount('');
      setPayNote('');
      refetchSales();
      qc.invalidateQueries({ queryKey: ['debt-customers'] });
    },
    onError: (e) => toast.error(getApiErrorMessage(e)),
  });

  const openSale = async (id) => {
    try {
      const r = await debtApi.getSale(id);
      setSaleDetail(r.data);
      const bal = num(r.data.balance);
      setPayAmount(bal > 0 ? String(Math.round(bal)) : '');
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  return (
    <div className="page-ios" style={{ padding: '16px 16px 100px', maxWidth: 1200, margin: '0 auto' }}>
      <h1 style={{ fontSize: 26, fontWeight: 800, margin: '0 0 12px' }}>В долг</h1>
      <p style={{ color: 'var(--text-muted)', margin: '0 0 16px', fontSize: 14 }}>
        Клиенты, история покупок и частичные оплаты. Чек можно отправить в WhatsApp.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(280px, 1.2fr)', gap: 16 }}>
        <div>
          <input
            className="input-ios"
            placeholder="Поиск"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', marginBottom: 10 }}
          />
          <Button variant="primary" icon={FiPlus} onClick={() => setAddOpen(true)} style={{ width: '100%', marginBottom: 12 }}>
            Добавить клиента
          </Button>
          {isLoading ? (
            <div>Загрузка…</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {customers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedId(c.id)}
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    borderRadius: 14,
                    border: `2px solid ${selectedId === c.id ? 'var(--primary)' : 'var(--border)'}`,
                    background: 'var(--surface)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 700 }}>{c.name}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{c.phone}</div>
                  {num(c.open_balance) > 0 && (
                    <div style={{ marginTop: 6, fontWeight: 700, color: 'var(--danger)' }}>
                      Долг: {formatMoney(c.open_balance)} ₸
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div style={{ border: '1px solid var(--border)', borderRadius: 16, padding: 16, background: 'var(--surface)', minHeight: 280 }}>
          {!selected ? (
            <div style={{ color: 'var(--text-muted)', padding: 40, textAlign: 'center' }}>Выберите клиента</div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 18, fontWeight: 800 }}>{selected.name}</div>
                  <div style={{ color: 'var(--text-muted)' }}>{selected.phone}</div>
                  {selected.notes && <div style={{ marginTop: 8, fontSize: 13 }}>{selected.notes}</div>}
                </div>
                {num(selected.open_balance) === 0 && (
                  <Button
                    variant="danger"
                    icon={FiTrash2}
                    onClick={() => {
                      if (window.confirm('Удалить клиента?')) deleteCustomer.mutate(selected.id);
                    }}
                  >
                    Удалить
                  </Button>
                )}
              </div>
              <div style={{ fontWeight: 700, marginBottom: 10 }}>История покупок</div>
              {sales.length === 0 ? (
                <div style={{ color: 'var(--text-muted)' }}>Покупок нет</div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {sales.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => openSale(s.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '12px',
                        borderRadius: 12,
                        border: '1px solid var(--border)',
                        background: 'var(--ios-grouped-bg)',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600 }}>{formatDebtDateTime(s.created_at)}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                          {formatMoney(s.total_amount)} ₸
                          {num(s.balance) > 0 ? ` · остаток ${formatMoney(s.balance)} ₸` : ' · оплачен'}
                        </div>
                      </div>
                      <FiChevronRight />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Modal
        isOpen={addOpen}
        title="Новый клиент"
        onClose={() => setAddOpen(false)}
        actions={(
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)}>Отмена</Button>
            <Button variant="primary" loading={createCustomer.isPending} onClick={() => createCustomer.mutate()}>Сохранить</Button>
          </>
        )}
      >
        <Input label="Имя *" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <Input label="Телефон *" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
        <Input label="Доп. информация" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      </Modal>

      <Modal
        isOpen={Boolean(saleDetail)}
        title="Чек в долг"
        onClose={() => setSaleDetail(null)}
        size="lg"
        actions={(
          <>
            <Button variant="secondary" onClick={() => setReceiptSale(saleDetail)}>Показать чек</Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (!openWhatsApp(saleDetail?.customer_phone, buildDebtReceiptText(saleDetail))) {
                  toast.error('Не удалось открыть WhatsApp');
                }
              }}
            >
              WhatsApp
            </Button>
            <Button variant="primary" onClick={() => setSaleDetail(null)}>Закрыть</Button>
          </>
        )}
      >
        {saleDetail && (
          <div>
            <div style={{ marginBottom: 12, fontSize: 14, color: 'var(--text-muted)' }}>
              {formatDebtDateTime(saleDetail.created_at)}
            </div>
            <table style={{ width: '100%', fontSize: 14, marginBottom: 12 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                  <th>Товар</th>
                  <th>Кол-во</th>
                  <th>Цена</th>
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {(saleDetail.items || []).map((it, i) => (
                  <tr key={i}>
                    <td>{it.product_name}</td>
                    <td>{it.quantity}</td>
                    <td>{formatMoney(it.unit_price)}</td>
                    <td>{formatMoney(it.subtotal)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ display: 'grid', gap: 4, marginBottom: 16 }}>
              <div>Итого: <strong>{formatMoney(saleDetail.total_amount)} ₸</strong></div>
              <div>Оплачено: <strong>{formatMoney(saleDetail.paid_amount)} ₸</strong></div>
              <div>Остаток: <strong style={{ color: num(saleDetail.balance) > 0 ? 'var(--danger)' : 'var(--success)' }}>{formatMoney(saleDetail.balance)} ₸</strong></div>
            </div>
            {num(saleDetail.balance) > 0 && (
              <>
                <Input
                  label="Сумма оплаты (₸)"
                  type="number"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
                <Input
                  label="Комментарий"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                />
                <Button
                  variant="primary"
                  loading={addPayment.isPending}
                  onClick={() => addPayment.mutate({
                    id: saleDetail.id,
                    amount: num(payAmount),
                    note: payNote,
                  })}
                >
                  Записать оплату
                </Button>
              </>
            )}
            {(saleDetail.payments || []).length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>История оплат</div>
                {saleDetail.payments.map((p) => (
                  <div key={p.id} style={{ fontSize: 13, marginBottom: 4 }}>
                    {formatDebtDateTime(p.created_at)} — {formatMoney(p.amount)} ₸
                    {p.note ? ` (${p.note})` : ''}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      <DebtReceiptModal sale={receiptSale} onClose={() => setReceiptSale(null)} />
    </div>
  );
}

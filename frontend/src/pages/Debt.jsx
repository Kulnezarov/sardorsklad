import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FiPlus, FiTrash2, FiChevronRight, FiArrowLeft, FiUser } from 'react-icons/fi';
import { debtApi, getApiErrorMessage } from '../api/client';
import { Button, Input, Modal } from '../components/ui';
import PhoneInput from '../components/PhoneInput';
import DebtReceiptModal from '../components/DebtReceiptModal';
import { buildDebtReceiptText, debtReceiptLabel, formatDebtDateTime, capitalizeWords } from '../utils/debtReceipt';
import { formatPhoneDisplay, normalizePhoneDigits } from '../utils/phoneMask';
import { openWhatsApp } from '../utils/whatsapp';

const num = (v) => {
  const n = parseFloat(String(v ?? 0).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const formatMoney = (v) => Number(v || 0).toLocaleString('ru-RU');

export default function Debt({ onBack }) {
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
    mutationFn: () => {
      const digits = normalizePhoneDigits(form.phone);
      if (digits.length < 11) throw new Error('Укажите полный номер телефона');
      return debtApi.createCustomer({
        name: capitalizeWords(form.name),
        phone: `+${digits}`,
        notes: form.notes.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Клиент добавлен');
      setAddOpen(false);
      setForm({ name: '', phone: '', notes: '' });
      qc.invalidateQueries({ queryKey: ['debt-customers'] });
    },
    onError: (e) => toast.error(getApiErrorMessage(e, e.message)),
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

  const openSaleReceipt = async (id) => {
    try {
      const r = await debtApi.getSale(id);
      setReceiptSale(r.data);
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const openSalePayment = async (id) => {
    try {
      const r = await debtApi.getSale(id);
      setSaleDetail(r.data);
      const bal = num(r.data.balance);
      setPayAmount(bal > 0 ? String(Math.round(bal)) : '');
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const selectCustomer = (id) => {
    setSelectedId(id);
  };

  return (
    <div className="page-ios" style={{ padding: '16px 16px 100px', maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            style={{
              width: 40,
              height: 40,
              borderRadius: 12,
              border: '1px solid var(--border)',
              background: 'var(--surface)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
            aria-label="Назад к кассе"
          >
            <FiArrowLeft size={20} />
          </button>
        )}
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 800, margin: 0 }}>Клиенты в долг</h1>
          <p style={{ color: 'var(--text-muted)', margin: '6px 0 0', fontSize: 14 }}>
            История, оплаты и чеки. При выборе клиента открывается последний чек.
          </p>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
          gap: 16,
          alignItems: 'start',
        }}
      >
        <div
          style={{
            background: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 18,
            padding: 14,
          }}
        >
          <input
            className="input-ios"
            placeholder="Поиск по имени или телефону"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', marginBottom: 10 }}
          />
          <Button variant="primary" icon={FiPlus} onClick={() => setAddOpen(true)} style={{ width: '100%', marginBottom: 12 }}>
            Добавить клиента
          </Button>
          {isLoading ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Загрузка…</div>
          ) : customers.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)' }}>
              <FiUser size={32} style={{ opacity: 0.35, marginBottom: 8 }} />
              <div>Клиентов пока нет</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 8, maxHeight: 'min(70vh, 520px)', overflowY: 'auto' }}>
              {customers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => selectCustomer(c.id)}
                  style={{
                    textAlign: 'left',
                    padding: '14px 16px',
                    borderRadius: 14,
                    border: `2px solid ${selectedId === c.id ? '#d97706' : 'var(--border)'}`,
                    background: selectedId === c.id ? '#fff7ed' : 'var(--ios-grouped-bg)',
                    cursor: 'pointer',
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                >
                  <div style={{ fontWeight: 800, fontSize: 15 }}>{capitalizeWords(c.name)}</div>
                  <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                    {formatPhoneDisplay(c.phone)}
                  </div>
                  {num(c.open_balance) > 0 && (
                    <div style={{ marginTop: 8, fontWeight: 800, color: 'var(--danger)', fontSize: 14 }}>
                      Долг: {formatMoney(c.open_balance)} ₸
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            border: '1px solid var(--border)',
            borderRadius: 18,
            padding: 18,
            background: 'var(--surface)',
            minHeight: 320,
            boxShadow: '0 4px 24px rgba(0,0,0,0.04)',
          }}
        >
          {!selected ? (
            <div style={{ color: 'var(--text-muted)', padding: 48, textAlign: 'center' }}>
              Выберите клиента слева — откроется чек или история
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 16 }}>
                <div
                  style={{
                    width: 48,
                    height: 48,
                    borderRadius: 14,
                    background: '#fff7ed',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#d97706',
                    flexShrink: 0,
                  }}
                >
                  <FiUser size={24} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{capitalizeWords(selected.name)}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>
                    {formatPhoneDisplay(selected.phone)}
                  </div>
                  {selected.notes && (
                    <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                      {selected.notes}
                    </div>
                  )}
                  {num(selected.open_balance) > 0 && (
                    <div style={{ marginTop: 10, fontWeight: 800, fontSize: 18, color: 'var(--danger)' }}>
                      Общий долг: {formatMoney(selected.open_balance)} ₸
                    </div>
                  )}
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
              <div style={{ fontWeight: 800, marginBottom: 10, fontSize: 15 }}>История покупок</div>
              {sales.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', padding: '12px 0' }}>Покупок пока нет</div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {sales.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => openSaleReceipt(s.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '14px 16px',
                        borderRadius: 14,
                        border: '1px solid var(--border)',
                        background: 'var(--ios-grouped-bg)',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 800, color: 'var(--primary)' }}>{debtReceiptLabel(s)}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>{formatDebtDateTime(s.created_at)}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                          {formatMoney(s.total_amount)} ₸
                          {num(s.balance) > 0 ? ` · остаток ${formatMoney(s.balance)} ₸` : ' · оплачен'}
                        </div>
                      </div>
                      {num(s.balance) > 0 && (
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); openSalePayment(s.id); }}
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            padding: '6px 10px',
                            borderRadius: 8,
                            border: '1px solid var(--border)',
                            background: 'var(--surface)',
                            cursor: 'pointer',
                          }}
                        >
                          Оплата
                        </button>
                      )}
                      <span style={{ fontSize: 12, fontWeight: 700, color: num(s.balance) > 0 ? 'var(--warning)' : 'var(--success)' }}>
                        Чек
                      </span>
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
        <PhoneInput value={form.phone} onChange={(phone) => setForm((f) => ({ ...f, phone }))} />
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

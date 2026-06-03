import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  FiPlus,
  FiTrash2,
  FiChevronRight,
  FiArrowLeft,
  FiUser,
  FiEdit2,
  FiCreditCard,
} from 'react-icons/fi';
import { debtApi, getApiErrorMessage } from '../api/client';
import { Button, Input, Modal } from '../components/ui';
import PhoneInput from '../components/PhoneInput';
import DebtReceiptModal from '../components/DebtReceiptModal';
import {
  buildDebtReceiptText,
  debtReceiptLabel,
  formatDebtDateTime,
  capitalizeWords,
} from '../utils/debtReceipt';
import { formatPhoneDisplay, normalizePhoneDigits } from '../utils/phoneMask';
import { openWhatsApp } from '../utils/whatsapp';

const num = (v) => {
  const n = parseFloat(String(v ?? 0).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const formatMoney = (v) => Number(v || 0).toLocaleString('ru-RU');

function customerInitials(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function DebtQuickPayChips({ balance, amount, onPick }) {
  if (balance <= 0) return null;
  const presets = [balance];
  if (balance >= 5000) presets.push(5000);
  if (balance >= 10000) presets.push(10000);
  const half = Math.round(balance / 2);
  if (half > 0 && half < balance && !presets.includes(half)) presets.push(half);
  const unique = [...new Set(presets.filter((p) => p > 0 && p <= balance))].sort((a, b) => b - a);

  return (
    <div className="debt-quick-pay">
      {unique.map((p) => {
        const isFull = Math.abs(p - balance) < 0.01;
        const active = Math.abs(num(amount) - p) < 0.01;
        return (
          <button
            key={p}
            type="button"
            className={`debt-quick-pay-btn${active ? ' debt-quick-pay-btn--active' : ''}`}
            onClick={() => onPick(String(Math.round(p)))}
          >
            {isFull ? 'Весь долг' : `${formatMoney(p)} ₸`}
          </button>
        );
      })}
    </div>
  );
}

export default function Debt({ onBack }) {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', notes: '' });
  const [saleDetail, setSaleDetail] = useState(null);
  const [receiptSale, setReceiptSale] = useState(null);
  const [payAmount, setPayAmount] = useState('');
  const [payNote, setPayNote] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const [onlyUnpaid, setOnlyUnpaid] = useState(false);

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

  const stats = useMemo(() => {
    let withDebt = 0;
    let debtSum = 0;
    for (const c of customers) {
      const b = num(c.open_balance);
      if (b > 0) {
        withDebt += 1;
        debtSum += b;
      }
    }
    return { total: customers.length, withDebt, debtSum };
  }, [customers]);

  const unpaidCount = useMemo(
    () => (sales || []).filter((s) => num(s.balance) > 0).length,
    [sales],
  );

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
    onSuccess: (r) => {
      toast.success('Клиент добавлен на сервер');
      setAddOpen(false);
      setForm({ name: '', phone: '', notes: '' });
      qc.invalidateQueries({ queryKey: ['debt-customers'] });
      if (r.data?.id) setSelectedId(r.data.id);
    },
    onError: (e) => toast.error(getApiErrorMessage(e, e.message)),
  });

  const updateCustomer = useMutation({
    mutationFn: () => {
      if (!selectedId) throw new Error('Клиент не выбран');
      const digits = normalizePhoneDigits(form.phone);
      if (digits.length < 11) throw new Error('Укажите полный номер телефона');
      return debtApi.updateCustomer(selectedId, {
        name: capitalizeWords(form.name),
        phone: `+${digits}`,
        notes: form.notes.trim() || undefined,
      });
    },
    onSuccess: () => {
      toast.success('Данные сохранены');
      setEditOpen(false);
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
      const bal = num(r.data.balance);
      setPayAmount(bal > 0 ? String(Math.round(bal)) : '');
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
      setPayNote('');
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  const selectCustomer = (id) => {
    setSelectedId(id);
    setHistorySearch('');
    setOnlyUnpaid(false);
    setSaleDetail(null);
  };

  const openEdit = () => {
    if (!selected) return;
    setForm({
      name: selected.name || '',
      phone: selected.phone || '',
      notes: selected.notes || '',
    });
    setEditOpen(true);
  };

  const filteredSales = (sales || []).filter((s) => {
    if (onlyUnpaid && num(s.balance) <= 0) return false;
    const q = historySearch.trim().toLowerCase();
    if (!q) return true;
    const label = debtReceiptLabel(s).toLowerCase();
    const date = formatDebtDateTime(s.created_at).toLowerCase();
    const total = formatMoney(s.total_amount).toLowerCase();
    return label.includes(q) || date.includes(q) || total.includes(q);
  });

  const customerFormFields = (
    <>
      <Input
        label="Имя *"
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        placeholder="Иван Иванов"
      />
      <PhoneInput value={form.phone} onChange={(phone) => setForm((f) => ({ ...f, phone }))} />
      <Input
        label="Заметка"
        value={form.notes}
        onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
        placeholder="Kaspi, знакомый…"
      />
    </>
  );

  return (
    <div className="page-ios debt-page">
      <div className="debt-page-header">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="intake-back-btn"
            aria-label="Назад"
          >
            <FiArrowLeft size={20} />
          </button>
        )}
        <div>
          <h1 className="debt-page-title">Клиенты в долг</h1>
          <p className="debt-page-sub">
            Данные на сервере · добавление, правка, оплата остатка по чекам
          </p>
        </div>
      </div>

      <div className="debt-layout">
        <div className="debt-panel">
          {customers.length > 0 && (
            <div className="debt-stats">
              <div className="debt-stat">
                <div className="debt-stat-label">Всего</div>
                <div className="debt-stat-value">{stats.total}</div>
              </div>
              <div className={`debt-stat${stats.withDebt > 0 ? ' debt-stat--warn' : ''}`}>
                <div className="debt-stat-label">С долгом</div>
                <div className="debt-stat-value">{stats.withDebt}</div>
              </div>
              {stats.debtSum > 0 && (
                <div className="debt-stat debt-stat--warn">
                  <div className="debt-stat-label">Сумма</div>
                  <div className="debt-stat-value">{formatMoney(stats.debtSum)} ₸</div>
                </div>
              )}
            </div>
          )}
          <input
            className="input-ios"
            placeholder="Поиск по имени или телефону"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', marginBottom: 10 }}
          />
          <Button
            variant="primary"
            icon={FiPlus}
            onClick={() => {
              setForm({ name: '', phone: '', notes: '' });
              setAddOpen(true);
            }}
            style={{ width: '100%', marginBottom: 12, background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}
          >
            Добавить клиента
          </Button>
          {isLoading ? (
            <div className="debt-empty">Загрузка…</div>
          ) : customers.length === 0 ? (
            <div className="debt-empty">
              <FiUser size={40} className="debt-empty-icon" />
              <div style={{ fontWeight: 700 }}>Клиентов пока нет</div>
              <div style={{ fontSize: 13, marginTop: 6 }}>Создайте первого — сохранится на сервере</div>
            </div>
          ) : (
            <div className="debt-customer-list">
              {customers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`debt-customer-card${selectedId === c.id ? ' debt-customer-card--active' : ''}`}
                  onClick={() => selectCustomer(c.id)}
                >
                  <span className="debt-customer-avatar">{customerInitials(c.name)}</span>
                  <span className="debt-customer-body">
                    <div className="debt-customer-name">{capitalizeWords(c.name)}</div>
                    <div className="debt-customer-phone">{formatPhoneDisplay(c.phone)}</div>
                  </span>
                  {num(c.open_balance) > 0 ? (
                    <span className="debt-customer-balance">{formatMoney(c.open_balance)} ₸</span>
                  ) : (
                    <span className="debt-customer-balance debt-customer-balance--ok">OK</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="debt-panel" style={{ minHeight: 360 }}>
          {!selected ? (
            <div className="debt-empty" style={{ padding: 64 }}>
              <FiUser size={48} className="debt-empty-icon" />
              <div style={{ fontWeight: 700, fontSize: 16 }}>Выберите клиента</div>
              <div style={{ fontSize: 13, marginTop: 8 }}>Справа — долг, чеки и оплата остатка</div>
            </div>
          ) : (
            <>
              <div className="debt-detail-head">
                <span className="debt-customer-avatar" style={{ width: 52, height: 52, fontSize: 18 }}>
                  {customerInitials(selected.name)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 20, fontWeight: 800 }}>{capitalizeWords(selected.name)}</div>
                  <div style={{ color: 'var(--text-muted)', fontSize: 15 }}>
                    {formatPhoneDisplay(selected.phone)}
                  </div>
                  {selected.notes && (
                    <div style={{ marginTop: 6, fontSize: 13, color: 'var(--text-secondary)' }}>
                      {selected.notes}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  <button
                    type="button"
                    className="intake-icon-btn"
                    title="Изменить"
                    onClick={openEdit}
                  >
                    <FiEdit2 size={16} />
                  </button>
                  {num(selected.open_balance) === 0 && (
                    <button
                      type="button"
                      className="intake-icon-btn intake-icon-btn-danger"
                      title="Удалить"
                      onClick={() => {
                        if (window.confirm('Удалить клиента?')) deleteCustomer.mutate(selected.id);
                      }}
                    >
                      <FiTrash2 size={16} />
                    </button>
                  )}
                </div>
              </div>

              <div
                className={`debt-balance-hero${num(selected.open_balance) <= 0 ? ' debt-balance-hero--paid' : ''}`}
              >
                <div className="debt-balance-label">
                  {num(selected.open_balance) > 0 ? 'Остаток долга' : 'Долг погашен'}
                </div>
                <div
                  className={`debt-balance-value${num(selected.open_balance) > 0 ? ' debt-balance-value--debt' : ' debt-balance-value--ok'}`}
                >
                  {formatMoney(selected.open_balance)} ₸
                </div>
                {unpaidCount > 0 && (
                  <div style={{ marginTop: 8, fontSize: 13, fontWeight: 600, color: '#b45309' }}>
                    Непогашенных чеков: {unpaidCount}
                  </div>
                )}
              </div>

              <div style={{ fontWeight: 800, marginBottom: 10, fontSize: 15 }}>История покупок</div>
              {sales.length > 0 && (
                <>
                  <div className="debt-filter-row">
                    <button
                      type="button"
                      className={`debt-filter-chip${!onlyUnpaid ? ' debt-filter-chip--active' : ''}`}
                      onClick={() => setOnlyUnpaid(false)}
                    >
                      Все
                    </button>
                    <button
                      type="button"
                      className={`debt-filter-chip${onlyUnpaid ? ' debt-filter-chip--active' : ''}`}
                      onClick={() => setOnlyUnpaid(true)}
                    >
                      С остатком
                    </button>
                  </div>
                  <input
                    className="input-ios"
                    placeholder="Поиск по №, дате, сумме…"
                    value={historySearch}
                    onChange={(e) => setHistorySearch(e.target.value)}
                    style={{ width: '100%', marginBottom: 10 }}
                  />
                </>
              )}
              {sales.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', padding: '12px 0' }}>Покупок пока нет</div>
              ) : filteredSales.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', padding: '12px 0' }}>Ничего не найдено</div>
              ) : (
                <div style={{ display: 'grid', gap: 8 }}>
                  {filteredSales.map((s) => (
                    <div key={s.id} className="debt-sale-row" style={{ cursor: 'default' }}>
                      <button
                        type="button"
                        style={{
                          flex: 1,
                          border: 'none',
                          background: 'none',
                          textAlign: 'left',
                          cursor: 'pointer',
                          padding: 0,
                        }}
                        onClick={() => openSaleReceipt(s.id)}
                      >
                        <div style={{ fontWeight: 800, color: 'var(--primary)' }}>{debtReceiptLabel(s)}</div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                          {formatDebtDateTime(s.created_at)}
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>
                          {formatMoney(s.total_amount)} ₸
                          {num(s.balance) > 0 ? ` · остаток ${formatMoney(s.balance)} ₸` : ' · оплачен'}
                        </div>
                      </button>
                      {num(s.balance) > 0 && (
                        <button
                          type="button"
                          onClick={() => openSalePayment(s.id)}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                            fontSize: 13,
                            fontWeight: 700,
                            padding: '8px 12px',
                            borderRadius: 10,
                            border: '1px solid #d97706',
                            background: '#fff7ed',
                            color: '#b45309',
                            cursor: 'pointer',
                          }}
                        >
                          <FiCreditCard size={14} />
                          Оплата
                        </button>
                      )}
                      <FiChevronRight color="var(--text-muted)" />
                    </div>
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
            <Button variant="primary" loading={createCustomer.isPending} onClick={() => createCustomer.mutate()}>
              Сохранить
            </Button>
          </>
        )}
      >
        {customerFormFields}
      </Modal>

      <Modal
        isOpen={editOpen}
        title="Изменить клиента"
        onClose={() => setEditOpen(false)}
        actions={(
          <>
            <Button variant="secondary" onClick={() => setEditOpen(false)}>Отмена</Button>
            <Button variant="primary" loading={updateCustomer.isPending} onClick={() => updateCustomer.mutate()}>
              Сохранить
            </Button>
          </>
        )}
      >
        {customerFormFields}
      </Modal>

      <Modal
        isOpen={Boolean(saleDetail)}
        title={`Чек ${saleDetail ? debtReceiptLabel(saleDetail) : ''}`}
        onClose={() => setSaleDetail(null)}
        size="lg"
        actions={(
          <>
            <Button variant="secondary" onClick={() => setReceiptSale(saleDetail)}>Чек</Button>
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
                  <th>Сумма</th>
                </tr>
              </thead>
              <tbody>
                {(saleDetail.items || []).map((it, i) => (
                  <tr key={i}>
                    <td>{it.product_name}</td>
                    <td>{it.quantity}</td>
                    <td>{formatMoney(it.subtotal)} ₸</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 10,
                marginBottom: 16,
              }}
            >
              <div style={{ padding: 12, borderRadius: 12, background: 'var(--ios-grouped-bg)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>ИТОГО</div>
                <div style={{ fontWeight: 800 }}>{formatMoney(saleDetail.total_amount)} ₸</div>
              </div>
              <div style={{ padding: 12, borderRadius: 12, background: 'var(--ios-grouped-bg)' }}>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>ОПЛАЧЕНО</div>
                <div style={{ fontWeight: 800 }}>{formatMoney(saleDetail.paid_amount)} ₸</div>
              </div>
              <div style={{ padding: 12, borderRadius: 12, background: '#fff7ed' }}>
                <div style={{ fontSize: 11, color: '#b45309', fontWeight: 700 }}>ОСТАТОК</div>
                <div style={{ fontWeight: 800, color: 'var(--danger)' }}>
                  {formatMoney(saleDetail.balance)} ₸
                </div>
              </div>
            </div>
            {num(saleDetail.balance) > 0 && (
              <div className="debt-pay-panel">
                <div style={{ fontWeight: 800, fontSize: 16, marginBottom: 4 }}>Внести оплату</div>
                <DebtQuickPayChips
                  balance={num(saleDetail.balance)}
                  amount={payAmount}
                  onPick={setPayAmount}
                />
                <Input
                  label="Сумма (₸)"
                  type="number"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
                <Input
                  label="Комментарий"
                  value={payNote}
                  onChange={(e) => setPayNote(e.target.value)}
                  placeholder="Kaspi, наличные…"
                />
                <Button
                  variant="primary"
                  loading={addPayment.isPending}
                  style={{ width: '100%', marginTop: 10, background: 'linear-gradient(135deg, #f59e0b, #d97706)' }}
                  onClick={() => {
                    const amount = num(payAmount);
                    if (amount <= 0) {
                      toast.error('Укажите сумму');
                      return;
                    }
                    if (amount > num(saleDetail.balance)) {
                      toast.error(`Максимум ${formatMoney(saleDetail.balance)} ₸`);
                      return;
                    }
                    addPayment.mutate({ id: saleDetail.id, amount, note: payNote });
                  }}
                >
                  Записать оплату
                </Button>
              </div>
            )}
            {(saleDetail.payments || []).length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>История оплат</div>
                {saleDetail.payments.map((p) => (
                  <div key={p.id} style={{ fontSize: 13, marginBottom: 6, padding: '8px 10px', borderRadius: 10, background: 'var(--ios-grouped-bg)' }}>
                    {formatDebtDateTime(p.created_at)} — <strong>{formatMoney(p.amount)} ₸</strong>
                    {p.note ? ` · ${p.note}` : ''}
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

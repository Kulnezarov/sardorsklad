import React, { useEffect, useState } from 'react';
import { FiX, FiPlus, FiUser } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { debtApi, getApiErrorMessage } from '../api/client';
import { Button, Input, Modal } from './ui';
import PhoneInput from './PhoneInput';
import { formatPhoneDisplay, normalizePhoneDigits } from '../utils/phoneMask';

const num = (v) => {
  const n = parseFloat(String(v ?? 0).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

const formatMoney = (v) => Number(v || 0).toLocaleString('ru-RU');

export default function DebtCustomerPickModal({ isOpen, onClose, onSelect }) {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: '', phone: '', notes: '' });

  const load = async () => {
    setLoading(true);
    try {
      const r = await debtApi.listCustomers(search);
      setCustomers(r.data || []);
    } catch (e) {
      toast.error(getApiErrorMessage(e));
      setCustomers([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) load();
  }, [isOpen, search]);

  const createAndSelect = async () => {
    const digits = normalizePhoneDigits(form.phone);
    if (!form.name.trim() || digits.length < 11) {
      toast.error('Укажите имя и полный номер телефона');
      return;
    }
    try {
      const r = await debtApi.createCustomer({
        name: form.name.trim(),
        phone: `+${digits}`,
        notes: form.notes.trim() || undefined,
      });
      onSelect(r.data);
      onClose();
    } catch (e) {
      toast.error(getApiErrorMessage(e));
    }
  };

  if (!isOpen) return null;

  return (
    <>
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.45)',
          zIndex: 650,
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'center',
        }}
        onClick={onClose}
        role="presentation"
      >
        <div
          style={{
            width: '100%',
            maxWidth: 520,
            maxHeight: '80vh',
            background: 'var(--surface)',
            borderRadius: '24px 24px 0 0',
            padding: '18px 20px 24px',
            overflow: 'auto',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
            <h3 style={{ margin: 0, flex: 1, fontSize: 18, fontWeight: 800 }}>Клиент в долг</h3>
            <button type="button" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
              <FiX size={22} />
            </button>
          </div>
          <input
            className="input-ios"
            placeholder="Поиск по имени или телефону"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ width: '100%', marginBottom: 10 }}
          />
          <Button variant="secondary" icon={FiPlus} onClick={() => setShowNew(true)} style={{ width: '100%', marginBottom: 12 }}>
            Новый клиент
          </Button>
          {loading ? (
            <div style={{ textAlign: 'center', padding: 24 }}>Загрузка…</div>
          ) : customers.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 20 }}>Клиенты не найдены</div>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {customers.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onSelect(c); onClose(); }}
                  style={{
                    textAlign: 'left',
                    padding: '12px 14px',
                    borderRadius: 14,
                    border: '1px solid var(--border)',
                    background: 'var(--ios-grouped-bg)',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <FiUser />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700 }}>{c.name}</div>
                      <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                        {formatPhoneDisplay(c.phone)}
                      </div>
                    </div>
                    {num(c.open_balance) > 0 && (
                      <span style={{ fontWeight: 700, color: 'var(--warning)' }}>
                        {formatMoney(c.open_balance)} ₸
                      </span>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <Modal
        isOpen={showNew}
        title="Новый клиент"
        onClose={() => setShowNew(false)}
        size="sm"
        actions={(
          <>
            <Button variant="secondary" onClick={() => setShowNew(false)}>Отмена</Button>
            <Button variant="primary" onClick={createAndSelect}>Сохранить</Button>
          </>
        )}
      >
        <Input label="Имя *" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        <PhoneInput value={form.phone} onChange={(phone) => setForm((f) => ({ ...f, phone }))} />
        <Input label="Доп. информация" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
      </Modal>
    </>
  );
}

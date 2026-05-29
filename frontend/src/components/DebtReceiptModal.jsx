import React from 'react';
import { FiX, FiCopy } from 'react-icons/fi';
import toast from 'react-hot-toast';
import { buildDebtReceiptText, debtReceiptLabel, formatDebtDateTime, capitalizeWords } from '../utils/debtReceipt';
import { formatPhoneDisplay } from '../utils/phoneMask';
import { openWhatsApp } from '../utils/whatsapp';
import { Button } from './ui';

export default function DebtReceiptModal({ sale, onClose }) {
  if (!sale) return null;
  const text = buildDebtReceiptText(sale);
  const phone = sale.customer_phone || '';

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Чек скопирован');
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const whatsapp = () => {
    if (!openWhatsApp(phone, text)) toast.error('Проверьте номер телефона');
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.45)',
        zIndex: 700,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={onClose}
      role="presentation"
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--surface)',
          borderRadius: 24,
          border: '1px solid var(--border)',
          padding: '20px 22px',
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 12, gap: 8 }}>
          <div style={{ flex: 1 }}>
            <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800 }}>Чек в долг</h3>
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--primary)', marginTop: 4 }}>
              {debtReceiptLabel(sale)}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {formatDebtDateTime(sale.created_at)}
            </div>
            <div style={{ marginTop: 8, fontWeight: 700 }}>{capitalizeWords(sale.customer_name)}</div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {formatPhoneDisplay(sale.customer_phone)}
            </div>
          </div>
          <button type="button" onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer' }}>
            <FiX size={22} />
          </button>
        </div>
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            fontSize: 13,
            lineHeight: 1.45,
            background: 'var(--ios-grouped-bg)',
            padding: 14,
            borderRadius: 12,
            maxHeight: 300,
            overflow: 'auto',
            margin: '0 0 16px',
          }}
        >
          {text}
        </pre>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <Button variant="secondary" icon={FiCopy} onClick={copy} style={{ fontSize: 14 }}>
            Копия
          </Button>
          <Button variant="primary" onClick={whatsapp} style={{ fontSize: 14, background: '#25D366' }}>
            WhatsApp
          </Button>
        </div>
      </div>
    </div>
  );
}

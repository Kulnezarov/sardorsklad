import React, { useState } from 'react';

const num = (v) => {
  const n = parseFloat(String(v ?? 0).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const formatMoney = (v) => Number(v || 0).toLocaleString('ru-RU');

const PRESETS = [10, 15, 20];

export default function SaleDiscountBar({ subtotal, discountPercent, onChange, accentDebt = false }) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customVal, setCustomVal] = useState('');

  const accent = accentDebt ? '#d97706' : 'var(--primary)';
  const discAmt = discountPercent > 0 ? (subtotal * discountPercent) / 100 : 0;
  const payable = subtotal - discAmt;
  const isCustom = discountPercent > 0 && !PRESETS.includes(Math.round(discountPercent));

  const chip = (label, selected, onClick) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '6px 12px',
        borderRadius: 10,
        border: `2px solid ${selected ? accent : 'var(--border)'}`,
        background: selected ? (accentDebt ? '#fff7ed' : 'var(--primary-light)') : 'var(--surface)',
        fontWeight: 700,
        fontSize: 13,
        cursor: 'pointer',
        color: selected ? accent : 'var(--text)',
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, textTransform: 'uppercase' }}>
        Скидка от суммы
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {chip('Нет', !discountPercent, () => onChange(0))}
        {PRESETS.map((p) => chip(`${p}%`, discountPercent === p, () => onChange(p)))}
        {chip(isCustom ? `${discountPercent}%` : 'Своя', isCustom, () => setCustomOpen(true))}
      </div>
      {customOpen && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input
            className="input-ios"
            type="number"
            min={0}
            max={100}
            placeholder="%"
            value={customVal}
            onChange={(e) => setCustomVal(e.target.value)}
            style={{ width: 80 }}
          />
          <button
            type="button"
            className="btn-ios btn-ios-primary"
            style={{ padding: '8px 14px' }}
            onClick={() => {
              const n = num(customVal);
              if (n > 0 && n <= 100) {
                onChange(n);
                setCustomOpen(false);
              }
            }}
          >
            OK
          </button>
        </div>
      )}
      {discAmt > 0 && (
        <div style={{ marginTop: 8, fontSize: 13, display: 'flex', justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--text-muted)' }}>Скидка {discountPercent}%</span>
          <span style={{ fontWeight: 700, color: accent }}>−{formatMoney(discAmt)} ₸</span>
        </div>
      )}
      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
        К оплате: <strong style={{ color: 'var(--text)' }}>{formatMoney(payable)} ₸</strong>
      </div>
    </div>
  );
}

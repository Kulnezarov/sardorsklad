import React from 'react';
import { Input } from './ui';

export default function CategoryAttributeFields({
  schema = null,
  values = {},
  onChange,
  disabled = false,
}) {
  const fields = schema?.fields || [];
  if (!fields.length) return null;

  const setVal = (key, val) => {
    onChange?.({ ...values, [key]: val });
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>Характеристики</span>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
        {fields.map((f) => {
          const key = f.key;
          const label = f.unit ? `${f.label} (${f.unit})` : f.label;
          const val = values[key] ?? '';

          if (f.type === 'select' && Array.isArray(f.options) && f.options.length) {
            return (
              <label key={key} style={{ display: 'grid', gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>{label}</span>
                <select
                  className="ios-input"
                  value={val}
                  disabled={disabled}
                  onChange={(e) => setVal(key, e.target.value)}
                >
                  <option value="">—</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </label>
            );
          }

          if (f.type === 'textarea') {
            return (
              <label key={key} style={{ display: 'grid', gap: 6, gridColumn: '1 / -1' }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>{label}</span>
                <textarea
                  className="ios-input"
                  rows={3}
                  value={val}
                  disabled={disabled}
                  onChange={(e) => setVal(key, e.target.value)}
                />
              </label>
            );
          }

          return (
            <Input
              key={key}
              label={label}
              type={f.type === 'number' ? 'number' : 'text'}
              value={val}
              disabled={disabled}
              onChange={(e) => setVal(key, e.target.value)}
            />
          );
        })}
      </div>
    </div>
  );
}

export function formatAttributePreview(schema, values = {}) {
  const fields = schema?.fields || [];
  const out = [];
  for (const f of fields) {
    const v = values[f.key];
    if (v == null || v === '') continue;
    const unit = f.unit ? ` ${f.unit}` : '';
    out.push(`${f.label}: ${v}${unit}`);
  }
  return out;
}

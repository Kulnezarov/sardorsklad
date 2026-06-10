import React from 'react';
import { layoutRowLabel, normalizeFormLayout } from '../utils/formLayoutUtils';
import { IosFormRow } from './IosForm';

function ChipField({ field, value, onChange, disabled, label }) {
  const opts = Array.isArray(field.options)
    ? field.options
    : String(field.options || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!opts.length) {
    return (
      <p className="product-form-field-hint">Добавьте варианты в настройках категории</p>
    );
  }
  return (
    <div className="chip-field-group chip-field-group--large chip-field-group--ios">
      {label && <div className="form-layout-field-label">{label}</div>}
      <div className="chip-field-group__row ios-segment-row">
        {opts.map((opt) => (
          <button
            key={opt}
            type="button"
            className={`catalog-chip chip-field-btn${value === opt ? ' catalog-chip-active chip-field-option--active' : ''}`}
            disabled={disabled}
            onClick={() => onChange(value === opt ? '' : opt)}
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function AttributeField({ fieldDef, value, onChange, disabled, placeholder }) {
  const type = fieldDef?.type || 'text';
  if (type === 'chip') {
    const chipLabel = fieldDef?.label || placeholder;
    return <ChipField field={fieldDef} value={value} onChange={onChange} disabled={disabled} label={chipLabel} />;
  }
  if (type === 'select') {
    const opts = fieldDef.options || [];
    return (
      <select className="ios-input ios-input--inset" value={value || ''} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
        <option value="">{placeholder || 'Выберите…'}</option>
        {opts.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (type === 'textarea') {
    return (
      <textarea
        className="ios-input ios-input--inset ios-input--stacked"
        rows={3}
        value={value || ''}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }
  return (
    <input
      className="ios-input ios-input--inset"
      type={type === 'number' ? 'number' : 'text'}
      value={value || ''}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

/**
 * Рендер полей товара по form_layout категории (только ввод значений).
 * Секции gallery/barcode/prices передаются через renderSlot.
 */
export default function ProductFormByLayout({
  schema,
  formData,
  onFormDataChange,
  disabled = false,
  compatibilitySlot,
}) {
  const layout = normalizeFormLayout(schema?.form_layout, schema);
  const fieldByKey = {};
  (schema?.fields || []).forEach((f) => {
    if (f?.key) fieldByKey[f.key] = f;
  });

  const setAttr = (key, val) => {
    onFormDataChange?.({
      ...formData,
      attributes: { ...(formData.attributes || {}), [key]: val },
    });
  };

  const rows = [];
  let halfBuffer = null;

  const flushHalf = () => {
    if (halfBuffer) {
      rows.push({ type: 'half-row', items: halfBuffer });
      halfBuffer = null;
    }
  };

  layout.forEach((row) => {
    if (row.kind === 'locked') return;
    if (row.kind === 'builtin' && row.key !== 'name') return;
    if (row.kind === 'compatibility') {
      flushHalf();
      rows.push({ type: 'compat', row });
      return;
    }
    if (row.width === 'half') {
      if (!halfBuffer) halfBuffer = [];
      halfBuffer.push(row);
      if (halfBuffer.length === 2) flushHalf();
      return;
    }
    flushHalf();
    rows.push({ type: 'full', row });
  });
  flushHalf();

  return (
    <>
      {rows.map((block, idx) => {
        if (block.type === 'compat') {
          return (
            <IosFormRow key={`compat-${idx}`} label="Совместим с авто" stacked>
              {compatibilitySlot}
            </IosFormRow>
          );
        }
        if (block.type === 'half-row') {
          return (
            <div key={`half-${idx}`} className="ios-form-row-pair">
              {block.items.map((row) => (
                <IosFormRow key={row.id} label={layoutRowLabel(row, schema)} stacked className="ios-form-row--half">
                  {row.kind === 'builtin' && row.key === 'name' && (
                    <input
                      className="ios-input ios-input--inset ios-input--stacked"
                      value={formData.name || ''}
                      disabled={disabled}
                      placeholder={row.placeholder || 'Название'}
                      onChange={(e) => onFormDataChange?.({ ...formData, name: e.target.value })}
                    />
                  )}
                  {row.kind === 'attribute' && (
                    <AttributeField
                      fieldDef={fieldByKey[row.key]}
                      value={(formData.attributes || {})[row.key]}
                      onChange={(v) => setAttr(row.key, v)}
                      disabled={disabled}
                      placeholder={row.placeholder || layoutRowLabel(row, schema)}
                    />
                  )}
                </IosFormRow>
              ))}
            </div>
          );
        }
        const row = block.row;
        const attrType = row.kind === 'attribute' ? fieldByKey[row.key]?.type : null;
        const stacked = attrType === 'chip' || attrType === 'textarea';
        return (
          <IosFormRow key={row.id} label={layoutRowLabel(row, schema)} stacked={stacked}>
            {row.kind === 'builtin' && row.key === 'name' && (
              <input
                className="ios-input ios-input--inset"
                value={formData.name || ''}
                disabled={disabled}
                placeholder={row.placeholder || 'Название'}
                onChange={(e) => onFormDataChange?.({ ...formData, name: e.target.value })}
              />
            )}
            {row.kind === 'attribute' && (
              <AttributeField
                fieldDef={fieldByKey[row.key]}
                value={(formData.attributes || {})[row.key]}
                onChange={(v) => setAttr(row.key, v)}
                disabled={disabled}
                placeholder={row.placeholder || layoutRowLabel(row, schema)}
              />
            )}
          </IosFormRow>
        );
      })}
    </>
  );
}

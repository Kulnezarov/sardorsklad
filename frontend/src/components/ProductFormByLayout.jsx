import React, { useCallback, useRef } from 'react';
import { groupLayoutRowsForDisplay, layoutRowLabel, normalizeFormLayout, resolveCategoryProfile } from '../utils/formLayoutUtils';
import { generateProductName } from '../utils/productNameUtils';

function ProductAttrField({ label, children, prominent = false, className = '', error }) {
  return (
    <div
      className={`product-attr-field${prominent ? ' product-attr-field--name' : ''}${error ? ' product-attr-field--error' : ''}${className ? ` ${className}` : ''}`}
    >
      {label && <span className="product-attr-field__label">{label}</span>}
      <div className="product-attr-field__control">{children}</div>
      {error && <span className="product-attr-field__error">{error}</span>}
    </div>
  );
}

function ChipField({ field, value, onChange, disabled }) {
  const opts = Array.isArray(field.options)
    ? field.options
    : String(field.options || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!opts.length) {
    return <p className="product-form-field-hint">Добавьте варианты в настройках категории</p>;
  }
  return (
    <div className="product-attr-chips">
      {opts.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`product-attr-chip${value === opt ? ' product-attr-chip--active' : ''}`}
          disabled={disabled}
          onClick={() => onChange(value === opt ? '' : opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function AttributeField({ fieldDef, value, onChange, disabled, placeholder }) {
  const type = fieldDef?.type || 'text';
  if (type === 'chip') {
    return <ChipField field={fieldDef} value={value} onChange={onChange} disabled={disabled} />;
  }
  if (type === 'select') {
    const opts = fieldDef.options || [];
    return (
      <select
        className="product-attr-field__input product-attr-field__select"
        value={value || ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
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
        className="product-attr-field__input product-attr-field__textarea"
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
      className="product-attr-field__input"
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
 */
export default function ProductFormByLayout({
  schema,
  formData,
  onFormDataChange,
  disabled = false,
  compatibilitySlot,
  fieldErrors = {},
  categoryName = '',
  categoryGroupName = '',
}) {
  const nameTouchedRef = useRef(false);
  const layout = normalizeFormLayout(schema?.form_layout, schema);
  const fieldByKey = {};
  (schema?.fields || []).forEach((f) => {
    if (f?.key) fieldByKey[f.key] = f;
  });

  const applyChange = useCallback((updater) => {
    if (!onFormDataChange) return;
    onFormDataChange((prev) => (typeof updater === 'function' ? updater(prev) : { ...prev, ...updater }));
  }, [onFormDataChange]);

  const setAttr = useCallback((key, val) => {
    applyChange((prev) => ({
      ...prev,
      attributes: { ...(prev.attributes || {}), [key]: val },
    }));
  }, [applyChange]);

  const { vehicle_mode: vm } = resolveCategoryProfile(schema);
  const liquidsGroup = /жидкост/i.test(String(categoryGroupName || '').trim());
  const wantsCompatibility = !liquidsGroup || vm !== 'none';
  const wantsBrandModel = false;

  const renderFieldControl = (row) => {
    if (row.kind === 'builtin' && row.key === 'name') {
      const canGenerate = (schema?.fields || []).some((f) => f.use_in_name) && categoryName;
      const handleGenerate = () => {
        const generated = generateProductName(
          categoryName,
          formData.attributes,
          schema,
          { brand: formData.brand, model: formData.model },
        );
        if (generated) {
          nameTouchedRef.current = false;
          applyChange((prev) => ({ ...prev, name: generated }));
        }
      };
      return (
        <div className="product-name-field-wrap">
          <input
            className="product-attr-field__input"
            value={formData.name || ''}
            disabled={disabled}
            placeholder={row.placeholder || 'Название товара'}
            autoComplete="off"
            onChange={(e) => {
              nameTouchedRef.current = true;
              const val = e.target.value;
              applyChange((prev) => ({ ...prev, name: val }));
            }}
          />
          {canGenerate && !disabled && (
            <button
              type="button"
              className="product-name-generate-btn"
              title="Сгенерировать название из категории и атрибутов"
              onClick={handleGenerate}
            >
              ✨ Авто
            </button>
          )}
        </div>
      );
    }
    if (row.kind === 'builtin' && row.key === 'brand') {
      return (
        <input
          className="product-attr-field__input"
          value={formData.brand || ''}
          disabled={disabled}
          placeholder="Dongfeng, Changan…"
          data-vehicle="brand"
          onChange={(e) => applyChange((prev) => ({ ...prev, brand: e.target.value }))}
        />
      );
    }
    if (row.kind === 'builtin' && row.key === 'model') {
      return (
        <input
          className="product-attr-field__input"
          value={formData.model || ''}
          disabled={disabled}
          placeholder="H30, CS35…"
          data-vehicle="model"
          onChange={(e) => applyChange((prev) => ({ ...prev, model: e.target.value }))}
        />
      );
    }
    if (row.kind === 'attribute') {
      return (
        <AttributeField
          fieldDef={fieldByKey[row.key]}
          value={(formData.attributes || {})[row.key]}
          onChange={(v) => setAttr(row.key, v)}
          disabled={disabled}
          placeholder={row.placeholder || layoutRowLabel(row, schema)}
        />
      );
    }
    return null;
  };

  const contentRows = [];
  layout.forEach((row) => {
    if (row.kind === 'locked') return;
    if (row.kind === 'builtin') {
      if (!['name', 'brand', 'model'].includes(row.key)) return;
      if ((row.key === 'brand' || row.key === 'model') && !wantsBrandModel) return;
    }
    if (row.kind === 'compatibility') {
      contentRows.push({ type: 'compat', row });
      return;
    }
    contentRows.push({ type: 'field', row });
  });

  const rows = [];
  let fieldBatch = [];
  const flushFields = () => {
    if (!fieldBatch.length) return;
    groupLayoutRowsForDisplay(fieldBatch).forEach((block) => {
      if (block.type === 'half-row') rows.push({ type: 'half-row', items: block.items });
      else rows.push({ type: 'full', row: block.row });
    });
    fieldBatch = [];
  };
  contentRows.forEach((item) => {
    if (item.type === 'compat') {
      flushFields();
      rows.push(item);
      return;
    }
    fieldBatch.push(item.row);
  });
  flushFields();

  if (compatibilitySlot && wantsCompatibility && !rows.some((b) => b.type === 'compat')) {
    let insertAt = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const block = rows[i];
      if (block.type === 'full' && block.row?.key === 'name') {
        insertAt = i + 1;
        break;
      }
      if (block.type === 'half-row' && block.items?.some((r) => r.key === 'name')) {
        insertAt = i + 1;
        break;
      }
    }
    rows.splice(insertAt, 0, { type: 'compat', row: { id: 'compat', kind: 'compatibility' } });
  }

  const fieldLabel = (row) => layoutRowLabel(row, schema);
  const isNameRow = (row) => row.kind === 'builtin' && row.key === 'name';

  return (
    <div className="product-form-by-layout">
      {rows.map((block, idx) => {
        if (block.type === 'compat') {
          return (
            <ProductAttrField key="vehicle-compat-block" label="Совместим с авто" className="product-attr-field--compat">
              {compatibilitySlot}
            </ProductAttrField>
          );
        }
        if (block.type === 'half-row') {
          return (
            <div key={`half-${idx}`} className="product-attr-row-pair">
              {block.items.map((row) => {
                const errKey = row.kind === 'attribute' ? `attr:${row.key}` : row.key;
                const errMsg = fieldErrors[errKey];
                return (
                  <ProductAttrField
                    key={row.id}
                    label={fieldLabel(row)}
                    prominent={isNameRow(row)}
                    error={errMsg}
                  >
                    {renderFieldControl(row)}
                  </ProductAttrField>
                );
              })}
            </div>
          );
        }
        const row = block.row;
        const errKey = row.kind === 'attribute' ? `attr:${row.key}` : row.key;
        const errMsg = fieldErrors[errKey];
        return (
          <ProductAttrField
            key={row.id}
            label={fieldLabel(row)}
            prominent={isNameRow(row)}
            error={errMsg}
          >
            {renderFieldControl(row)}
          </ProductAttrField>
        );
      })}
    </div>
  );
}

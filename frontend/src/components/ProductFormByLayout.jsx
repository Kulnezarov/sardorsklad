import React, { useCallback, useRef } from 'react';
import { groupLayoutRowsForDisplay, layoutRowLabel, normalizeFormLayout, resolveCategoryProfile } from '../utils/formLayoutUtils';
import { suggestProductName, generateProductName } from '../utils/productNameUtils';

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

function renderFieldControl(row, schema, fieldByKey, formData, onFormDataChange, disabled, setAttr) {
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
        onFormDataChange?.({ ...formData, name: generated });
      }
    };
    return (
      <div className="product-name-field-wrap">
        <input
          className="product-attr-field__input"
          value={formData.name || ''}
          disabled={disabled}
          placeholder={row.placeholder || 'Название товара'}
          onChange={(e) => {
            nameTouchedRef.current = true;
            onFormDataChange?.({ ...formData, name: e.target.value });
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
        onChange={(e) => onFormDataChange?.({ ...formData, brand: e.target.value })}
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
        onChange={(e) => onFormDataChange?.({ ...formData, model: e.target.value })}
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
}) {
  const nameTouchedRef = useRef(false);
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

  const { vehicle_mode: vm } = resolveCategoryProfile(schema);
  const catLower = String(categoryName || '').trim().toLowerCase();
  const wantsBrandModel =
    vm === 'brand_model'
    || (vm === 'none' && (catLower.includes('трос') || catLower.includes('тяга')));

  const contentRows = [];
  layout.forEach((row) => {
    if (row.kind === 'locked') return;
    if (row.kind === 'builtin') {
      // name, brand, model — показываем в форме
      if (!['name', 'brand', 'model'].includes(row.key)) return;
      // brand/model — brand_model или тросы/тяги
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

  if (wantsBrandModel && vm !== 'brand_model') {
    const hasBrand = rows.some((b) =>
      (b.type === 'full' && b.row?.key === 'brand')
      || (b.type === 'half-row' && b.items?.some((r) => r.key === 'brand')),
    );
    const hasModel = rows.some((b) =>
      (b.type === 'full' && b.row?.key === 'model')
      || (b.type === 'half-row' && b.items?.some((r) => r.key === 'model')),
    );
    let insertAt = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const block = rows[i];
      if (block.type === 'full' && block.row?.key === 'name') {
        insertAt = i + 1;
        break;
      }
    }
    if (!hasBrand) {
      rows.splice(insertAt, 0, {
        type: 'full',
        row: { id: 'brand', kind: 'builtin', key: 'brand', width: 'half', label: 'Марка авто' },
      });
      insertAt += 1;
    }
    if (!hasModel) {
      rows.splice(insertAt, 0, {
        type: 'full',
        row: { id: 'model', kind: 'builtin', key: 'model', width: 'half', label: 'Модель авто' },
      });
    }
  }

  if (compatibilitySlot && vm === 'compatibility' && !rows.some((b) => b.type === 'compat')) {
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
            <ProductAttrField key={`compat-${idx}`} label="Совместим с авто" className="product-attr-field--compat">
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
                    {renderFieldControl(row, schema, fieldByKey, formData, onFormDataChange, disabled, setAttr)}
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
            {renderFieldControl(row, schema, fieldByKey, formData, onFormDataChange, disabled, setAttr)}
          </ProductAttrField>
        );
      })}
    </div>
  );
}

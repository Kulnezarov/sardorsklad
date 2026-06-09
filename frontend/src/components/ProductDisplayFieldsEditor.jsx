import React, { useCallback, useMemo, useState } from 'react';
import { FiCopy, FiMinus, FiMove } from 'react-icons/fi';
import {
  duplicateFieldEntry,
  fieldValue,
  reorderLayout,
  removeLayoutEntry,
  setBuiltinValue,
} from '../utils/productDisplayUtils';

function FieldMinusButton({ onClick, title = 'Удалить поле' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className="product-field-minus"
    >
      <FiMinus size={14} />
    </button>
  );
}

export default function ProductDisplayFieldsEditor({
  layout = [],
  onLayoutChange,
  formData,
  onFormDataChange,
  schema = null,
  disabled = false,
}) {
  const [dragIdx, setDragIdx] = useState(null);

  const schemaFieldByKey = useMemo(() => {
    const map = {};
    (schema?.fields || []).forEach((f) => {
      if (f?.key) map[f.key] = f;
    });
    return map;
  }, [schema]);

  const updateLayout = useCallback(
    (next) => onLayoutChange?.(next),
    [onLayoutChange],
  );

  const handleDrop = (toIdx) => {
    if (dragIdx == null || dragIdx === toIdx) return;
    updateLayout(reorderLayout(layout, dragIdx, toIdx));
    setDragIdx(null);
  };

  const handleRemove = (id) => {
    updateLayout(removeLayoutEntry(layout, id));
  };

  const handleDuplicate = (entry) => {
    updateLayout([...(layout || []), duplicateFieldEntry(entry)]);
  };

  const handleLabelChange = (id, label) => {
    updateLayout((layout || []).map((x) => (x.id === id ? { ...x, label } : x)));
  };

  const handleValueChange = (entry, value) => {
    if (entry.kind === 'builtin') {
      onFormDataChange?.(setBuiltinValue(formData, entry.key, value));
      return;
    }
    if (entry.kind === 'attribute') {
      onFormDataChange?.({
        ...formData,
        attributes: { ...(formData.attributes || {}), [entry.key]: value },
      });
      return;
    }
    if (entry.kind === 'custom') {
      const nextLayout = (layout || []).map((x) =>
        x.id === entry.id ? { ...x, value } : x,
      );
      updateLayout(nextLayout);
      onFormDataChange?.({
        ...formData,
        display_layout: nextLayout,
        attributes: { ...(formData.attributes || {}), [entry.key || entry.id]: value },
      });
    }
  };

  if (!layout?.length) return null;

  return (
    <div className="product-display-fields">
      <div className="product-display-fields__head">
        <span className="product-display-fields__title">Поля для витрины</span>
        <span className="product-display-fields__hint">Перетащите ⋮⋮ для порядка · − удалить · 📋 копия</span>
      </div>
      <div className="product-display-fields__list">
        {layout.map((entry, idx) => {
          const val = fieldValue(formData, entry, schema);
          const attrDef = entry.kind === 'attribute' ? schemaFieldByKey[entry.key] : null;
          const labelEditable = entry.kind === 'custom' || entry.kind === 'builtin';
          const inputType = attrDef?.type === 'number' ? 'number' : 'text';

          return (
            <div
              key={entry.id}
              className={`product-display-field-row ${dragIdx === idx ? 'product-display-field-row--drag' : ''}`}
              draggable={!disabled}
              onDragStart={() => setDragIdx(idx)}
              onDragEnd={() => setDragIdx(null)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(idx)}
            >
              <button
                type="button"
                className="product-display-field-row__handle"
                draggable={!disabled}
                onDragStart={() => setDragIdx(idx)}
                title="Перетащить"
                tabIndex={-1}
              >
                <FiMove size={15} />
              </button>
              <div className="product-display-field-row__body">
                {labelEditable ? (
                  <input
                    className="ios-input product-display-field-row__label"
                    value={entry.label || ''}
                    disabled={disabled}
                    placeholder="Название поля"
                    onChange={(e) => handleLabelChange(entry.id, e.target.value)}
                  />
                ) : (
                  <span className="product-display-field-row__label-static">{entry.label}</span>
                )}
                {attrDef?.type === 'select' && Array.isArray(attrDef.options) ? (
                  <select
                    className="ios-input"
                    value={val}
                    disabled={disabled}
                    onChange={(e) => handleValueChange(entry, e.target.value)}
                  >
                    <option value="">—</option>
                    {attrDef.options.map((o) => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                ) : attrDef?.type === 'textarea' ? (
                  <textarea
                    className="ios-input"
                    rows={2}
                    value={val}
                    disabled={disabled}
                    onChange={(e) => handleValueChange(entry, e.target.value)}
                  />
                ) : (
                  <input
                    className="ios-input"
                    type={inputType}
                    value={val}
                    disabled={disabled}
                    placeholder={entry.kind === 'custom' ? 'Значение' : ''}
                    onChange={(e) => handleValueChange(entry, e.target.value)}
                  />
                )}
              </div>
              <button
                type="button"
                className="product-field-copy"
                title="Копия поля"
                onClick={() => handleDuplicate(entry)}
                disabled={disabled}
              >
                <FiCopy size={13} />
              </button>
              <FieldMinusButton onClick={() => handleRemove(entry.id)} />
            </div>
          );
        })}
      </div>
      <button
        type="button"
        className="catalog-chip"
        disabled={disabled}
        onClick={() =>
          updateLayout([
            ...(layout || []),
            duplicateFieldEntry({ label: 'Новое поле' }),
          ])
        }
      >
        + Своё поле
      </button>
    </div>
  );
}

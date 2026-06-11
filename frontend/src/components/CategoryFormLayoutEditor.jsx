import React, { useMemo, useState } from 'react';
import { FiLock, FiMinus, FiMove } from 'react-icons/fi';
import {
  ADDABLE_BUILTIN,
  BUILTIN_LABELS,
  defaultFormLayout,
  fieldsToFullSchema,
  isLockedRow,
  layoutRowLabel,
  groupLayoutRowsForDisplay,
  normalizeFormLayout,
  reorderFormLayout,
  slugFieldKey,
  toggleRowWidth,
} from '../utils/formLayoutUtils';

const emptyField = () => ({
  key: '',
  label: '',
  type: 'text',
  options: '',
  unit: '',
  required: false,
  placeholder: '',
  width: 'full',
});

function FieldsTab({ state, setState }) {
  return (
    <div className="form-layout-editor-fields">
      <label className="form-layout-compat-toggle">
        <input
          type="checkbox"
          checked={state.show_compatibility}
          onChange={(e) => {
            const show_compatibility = e.target.checked;
            const base = { fields: state.fields, show_compatibility };
            setState({
              ...state,
              show_compatibility,
              form_layout: normalizeFormLayout(state.form_layout, base),
            });
          }}
        />
        Показывать «Совместим с авто» в форме товара
      </label>
      <div className="form-layout-editor-hint">Поля характеристик</div>
      {(state.fields || []).map((field, idx) => (
        <div key={idx} className="form-layout-field-card">
          <div className="form-layout-field-toolbar">
            <span className="form-layout-field-num">#{idx + 1}</span>
            <button
              type="button"
              className="product-field-minus"
              onClick={() => {
                const fields = [...state.fields];
                if (fields.length <= 1) return;
                fields.splice(idx, 1);
                const base = { fields, show_compatibility: state.show_compatibility };
                setState({ ...state, fields, form_layout: defaultFormLayout(base) });
              }}
            >
              −
            </button>
            {idx > 0 && (
              <button
                type="button"
                className="catalog-chip"
                onClick={() => {
                  const fields = [...state.fields];
                  [fields[idx - 1], fields[idx]] = [fields[idx], fields[idx - 1]];
                  const base = { fields, show_compatibility: state.show_compatibility };
                  setState({ ...state, fields, form_layout: defaultFormLayout(base) });
                }}
              >
                ↑
              </button>
            )}
            {idx < state.fields.length - 1 && (
              <button
                type="button"
                className="catalog-chip"
                onClick={() => {
                  const fields = [...state.fields];
                  [fields[idx + 1], fields[idx]] = [fields[idx], fields[idx + 1]];
                  const base = { fields, show_compatibility: state.show_compatibility };
                  setState({ ...state, fields, form_layout: defaultFormLayout(base) });
                }}
              >
                ↓
              </button>
            )}
          </div>
          <input
            className="ios-input"
            placeholder="Название поля (Объём)"
            value={field.label}
            onChange={(e) => {
              const fields = [...state.fields];
              fields[idx] = {
                ...fields[idx],
                label: e.target.value,
                key: fields[idx].key || slugFieldKey(e.target.value),
              };
              const base = { fields, show_compatibility: state.show_compatibility };
              setState({ ...state, fields, form_layout: defaultFormLayout(base) });
            }}
          />
          <select
            className="ios-input"
            value={field.type}
            onChange={(e) => {
              const fields = [...state.fields];
              fields[idx] = { ...fields[idx], type: e.target.value };
              setState({ ...state, fields });
            }}
          >
            <option value="text">Текст</option>
            <option value="number">Число</option>
            <option value="select">Выбор (список)</option>
            <option value="chip">Кнопки (chip)</option>
            <option value="textarea">Многострочный</option>
          </select>
          {(field.type === 'select' || field.type === 'chip') && (
            <input
              className="ios-input"
              placeholder="Варианты: 1.1, 1.3, 1.5"
              value={field.options}
              onChange={(e) => {
                const fields = [...state.fields];
                fields[idx] = { ...fields[idx], options: e.target.value };
                setState({ ...state, fields });
              }}
            />
          )}
          <input
            className="ios-input"
            placeholder="Подсказка в поле (placeholder)"
            value={field.placeholder}
            onChange={(e) => {
              const fields = [...state.fields];
              fields[idx] = { ...fields[idx], placeholder: e.target.value };
              setState({ ...state, fields });
            }}
          />
          <input
            className="ios-input"
            placeholder="Единица (л, мм, А)"
            value={field.unit}
            onChange={(e) => {
              const fields = [...state.fields];
              fields[idx] = { ...fields[idx], unit: e.target.value };
              setState({ ...state, fields });
            }}
          />
        </div>
      ))}
      <button
        type="button"
        className="catalog-chip"
        onClick={() => setState({ ...state, fields: [...state.fields, emptyField()] })}
      >
        + Поле
      </button>
    </div>
  );
}

function CardTab({ state, setState }) {
  const schema = useMemo(
    () => ({ fields: state.fields, show_compatibility: state.show_compatibility }),
    [state.fields, state.show_compatibility],
  );
  const [dragIdx, setDragIdx] = useState(null);

  const addBuiltin = (row) => {
    const exists = state.form_layout.some((x) => x.id === row.id);
    if (exists) return;
    const skuIdx = state.form_layout.findIndex((x) => x.key === 'sku');
    const insertAt = skuIdx >= 0 ? skuIdx : state.form_layout.length;
    const next = [...state.form_layout];
    next.splice(insertAt, 0, { ...row });
    setState({ ...state, form_layout: next });
  };

  const addAttribute = (key) => {
    const id = `attr:${key}`;
    if (state.form_layout.some((x) => x.id === id)) return;
    const f = state.fields.find((x) => x.key === key);
    const skuIdx = state.form_layout.findIndex((x) => x.key === 'sku');
    const insertAt = skuIdx >= 0 ? skuIdx : state.form_layout.length;
    const next = [...state.form_layout];
    next.splice(insertAt, 0, {
      id,
      kind: 'attribute',
      key,
      width: f?.width === 'half' ? 'half' : 'full',
      placeholder: f?.placeholder || f?.label || key,
    });
    setState({ ...state, form_layout: next });
  };

  const rows = normalizeFormLayout(state.form_layout, schema);
  const rowIndex = (id) => rows.findIndex((r) => r.id === id);
  const availableAttrs = (state.fields || []).filter(
    (f) => f.key && !rows.some((r) => r.key === f.key && r.kind === 'attribute'),
  );

  const renderLayoutRow = (row) => {
    const idx = rowIndex(row.id);
    return (
      <div
        key={row.id}
        className={`form-layout-row form-layout-row--${row.width}${isLockedRow(row) ? ' form-layout-row--locked' : ''}`}
        draggable={!isLockedRow(row)}
        onDragStart={() => setDragIdx(idx)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={() => {
          if (dragIdx == null || isLockedRow(rows[dragIdx])) return;
          setState({ ...state, form_layout: reorderFormLayout(rows, dragIdx, idx) });
          setDragIdx(null);
        }}
      >
        <div className="form-layout-row-head">
          {!isLockedRow(row) ? (
            <button type="button" className="form-layout-drag" aria-label="Переместить">
              <FiMove size={14} />
            </button>
          ) : (
            <span className="form-layout-lock" title="Нельзя удалить">
              <FiLock size={13} />
            </span>
          )}
          <span className="form-layout-row-label">{layoutRowLabel(row, schema)}</span>
          <button
            type="button"
            className="catalog-chip form-layout-width-btn"
            onClick={() => {
              const next = rows.map((r, i) => (i === idx ? toggleRowWidth(r) : r));
              setState({ ...state, form_layout: next });
            }}
            title={row.width === 'half' ? 'Половина ширины' : 'На всю ширину'}
          >
            {row.width === 'half' ? '½' : '□'}
          </button>
          {!isLockedRow(row) && (
            <button
              type="button"
              className="product-field-minus"
              onClick={() => setState({ ...state, form_layout: rows.filter((_, i) => i !== idx) })}
            >
              <FiMinus size={14} />
            </button>
          )}
        </div>
        {row.kind === 'attribute' && (
          <div className="form-layout-row-preview">
            {(() => {
              const f = state.fields.find((x) => x.key === row.key);
              if (f?.type === 'chip' && f.options) {
                const opts = String(f.options).split(',').map((s) => s.trim()).filter(Boolean);
                return (
                  <div className="chip-field-group">
                    {opts.map((o) => (
                      <span key={o} className="catalog-chip">{o}</span>
                    ))}
                  </div>
                );
              }
              return (
                <span className="form-layout-placeholder">
                  {row.placeholder || layoutRowLabel(row, schema)}
                </span>
              );
            })()}
          </div>
        )}
        {row.kind === 'builtin' && row.key === 'name' && (
          <span className="form-layout-placeholder">{row.placeholder || 'Название товара'}</span>
        )}
        {row.kind === 'builtin' && row.key === 'cny_price' && (
          <span className="form-layout-placeholder">¥ 0.00</span>
        )}
        {row.kind === 'builtin' && row.key === 'delivery_block' && (
          <div className="form-layout-row-preview form-layout-row-preview--delivery">
            <span className="catalog-chip catalog-chip-active">Обычная</span>
            <span className="form-layout-placeholder">₸ · кг</span>
          </div>
        )}
        {row.kind === 'builtin' && (row.key === 'sale_price' || row.key === 'quantity') && (
          <span className="form-layout-placeholder">0</span>
        )}
        {row.kind === 'builtin' && row.key === 'supplier' && (
          <span className="form-layout-placeholder">Поставщик</span>
        )}
        {row.kind === 'builtin' && row.key === 'description' && (
          <span className="form-layout-placeholder">Текст…</span>
        )}
        {row.kind === 'compatibility' && (
          <div className="chip-field-group">
            <span className="catalog-chip">FAW Bestune</span>
            <span className="catalog-chip">Changan CS35</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="form-layout-editor-card">
      <p className="form-layout-editor-hint">
        Перетащите ⋮⋮ · кнопка ½ — два поля в один ряд · − удалить (кроме фото и штрих-кода)
      </p>
      <div className="form-layout-preview-grid">
        {groupLayoutRowsForDisplay(rows).map((block, bidx) => {
          if (block.type === 'half-row') {
            return (
              <div key={`pair-${bidx}`} className="form-layout-row-pair">
                {block.items.map((row) => renderLayoutRow(row))}
              </div>
            );
          }
          return renderLayoutRow(block.row);
        })}
      </div>
      <div className="form-layout-add-row">
        <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Добавить:</span>
        {ADDABLE_BUILTIN.filter((b) => !rows.some((r) => r.id === b.id)).map((b) => (
          <button key={b.id} type="button" className="catalog-chip" onClick={() => addBuiltin(b)}>
            + {b.label}
          </button>
        ))}
        {availableAttrs.map((f) => (
          <button key={f.key} type="button" className="catalog-chip" onClick={() => addAttribute(f.key)}>
            + {f.label || f.key}
          </button>
        ))}
      </div>
    </div>
  );
}

export default function CategoryFormLayoutEditor({ category, groupName, onSave, onClose, saving }) {
  const initial = useMemo(() => {
    const schema = category?.attribute_schema || {};
    const fields = (schema.fields || []).map((f) => ({
      key: f.key || '',
      label: f.label || '',
      type: f.type || 'text',
      options: Array.isArray(f.options) ? f.options.join(', ') : '',
      unit: f.unit || '',
      required: Boolean(f.required),
      placeholder: f.placeholder || '',
      width: f.width === 'half' ? 'half' : 'full',
    }));
    const base = {
      fields: fields.length ? fields : [emptyField()],
      show_compatibility: Boolean(schema.show_compatibility),
    };
    return {
      ...base,
      form_layout: normalizeFormLayout(schema.form_layout, base),
    };
  }, [category]);

  const [tab, setTab] = useState('card');
  const [state, setState] = useState(initial);

  const handleSave = () => {
    const schema = fieldsToFullSchema(state.fields, state.show_compatibility, state.form_layout);
    onSave?.(schema);
  };

  return (
    <div className="form-layout-editor-overlay" role="dialog" aria-modal="true">
      <div className="form-layout-editor-sheet">
        <div className="form-layout-editor-header">
          <div>
            <div className="form-layout-editor-title">Карточка заполнения</div>
            <div className="form-layout-editor-sub">
              {groupName ? `${groupName} → ` : ''}{category?.name}
            </div>
          </div>
          <button type="button" className="catalog-chip" onClick={onClose}>✕</button>
        </div>
        <div className="form-layout-editor-tabs">
          <button
            type="button"
            className={`catalog-chip${tab === 'fields' ? ' catalog-chip-active' : ''}`}
            onClick={() => setTab('fields')}
          >
            Поля
          </button>
          <button
            type="button"
            className={`catalog-chip${tab === 'card' ? ' catalog-chip-active' : ''}`}
            onClick={() => setTab('card')}
          >
            Карточка
          </button>
        </div>
        <div className="form-layout-editor-body">
          {tab === 'fields' ? <FieldsTab state={state} setState={setState} /> : <CardTab state={state} setState={setState} />}
        </div>
        <div className="form-layout-editor-footer">
          <button type="button" className="catalog-chip" onClick={onClose}>Отмена</button>
          <button
            type="button"
            className="catalog-chip catalog-chip-active"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? 'Сохранение…' : 'Сохранить на сервер'}
          </button>
        </div>
      </div>
    </div>
  );
}

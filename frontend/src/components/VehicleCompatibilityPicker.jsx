import React, { useEffect, useMemo, useState } from 'react';
import { FiMinus, FiPlus } from 'react-icons/fi';

function selectedIdsToRows(selectedIds, models) {
  const byBrand = new Map();
  (selectedIds || []).forEach((id) => {
    const m = (models || []).find((x) => x.id === id);
    if (!m) return;
    const bid = m.vehicle_brand_id;
    if (!byBrand.has(bid)) byBrand.set(bid, []);
    byBrand.get(bid).push(id);
  });
  const rows = [...byBrand.entries()].map(([brandId, modelIds]) => ({
    key: `brand-${brandId}`,
    brandId,
    modelIds,
  }));
  return rows.length ? rows : [{ key: 'new-0', brandId: null, modelIds: [] }];
}

function rowsToSelectedIds(rows) {
  const out = [];
  const seen = new Set();
  (rows || []).forEach((row) => {
    (row.modelIds || []).forEach((id) => {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    });
  });
  return out;
}

export default function VehicleCompatibilityPicker({
  brands = [],
  models = [],
  selectedIds = [],
  onChange,
  disabled = false,
}) {
  const [rows, setRows] = useState(() => selectedIdsToRows(selectedIds, models));

  useEffect(() => {
    setRows(selectedIdsToRows(selectedIds, models));
  }, [selectedIds, models]);

  const modelsByBrand = useMemo(() => {
    const map = new Map();
    (models || []).forEach((m) => {
      const bid = m.vehicle_brand_id;
      if (!map.has(bid)) map.set(bid, []);
      map.get(bid).push(m);
    });
    map.forEach((list, bid) => {
      list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
      map.set(bid, list);
    });
    return map;
  }, [models]);

  const emit = (nextRows) => {
    setRows(nextRows);
    onChange?.(rowsToSelectedIds(nextRows));
  };

  const updateRow = (idx, patch) => {
    const next = rows.map((row, i) => (i === idx ? { ...row, ...patch } : row));
    emit(next);
  };

  const removeRow = (idx) => {
    if (rows.length <= 1) {
      emit([{ key: `new-${Date.now()}`, brandId: null, modelIds: [] }]);
      return;
    }
    emit(rows.filter((_, i) => i !== idx));
  };

  const addRow = () => {
    emit([...rows, { key: `new-${Date.now()}`, brandId: null, modelIds: [] }]);
  };

  const toggleModel = (rowIdx, modelId) => {
    const row = rows[rowIdx];
    const set = new Set(row.modelIds || []);
    if (set.has(modelId)) set.delete(modelId);
    else set.add(modelId);
    updateRow(rowIdx, { modelIds: [...set] });
  };

  const onBrandChange = (rowIdx, brandId) => {
    const parsed = brandId ? Number(brandId) : null;
    const allowed = new Set((modelsByBrand.get(parsed) || []).map((m) => m.id));
    const kept = (rows[rowIdx].modelIds || []).filter((id) => allowed.has(id));
    updateRow(rowIdx, { brandId: parsed, modelIds: kept });
  };

  return (
    <div className="vehicle-compat-picker vehicle-compat-picker--rows">
      <div className="vehicle-compat-picker__head">
        <span className="vehicle-compat-picker__title">Совместим с авто</span>
        <span className="vehicle-compat-picker__hint">Несколько марок — одна деталь для FAW, Dongfeng, Changan…</span>
      </div>

      <div className="vehicle-compat-rows">
        {rows.map((row, idx) => {
          const brandModels = row.brandId ? modelsByBrand.get(row.brandId) || [] : [];
          const selectedSet = new Set(row.modelIds || []);
          return (
            <div key={row.key || idx} className="vehicle-compat-row">
              <div className="vehicle-compat-row__top">
                <label className="vehicle-compat-row__brand-label">
                  <span>Марка</span>
                  <select
                    className="ios-input"
                    value={row.brandId || ''}
                    disabled={disabled}
                    onChange={(e) => onBrandChange(idx, e.target.value)}
                  >
                    <option value="">Выберите марку</option>
                    {(brands || []).map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  className="product-field-minus"
                  title="Удалить марку"
                  disabled={disabled}
                  onClick={() => removeRow(idx)}
                >
                  <FiMinus size={14} />
                </button>
              </div>

              {row.brandId ? (
                <div className="vehicle-compat-row__models">
                  <span className="vehicle-compat-row__models-label">Модели</span>
                  <div className="vehicle-compat-row__model-chips">
                    {brandModels.map((m) => {
                      const on = selectedSet.has(m.id);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={`catalog-chip ${on ? 'catalog-chip-active' : ''}`}
                          disabled={disabled}
                          onClick={() => toggleModel(idx, m.id)}
                        >
                          {m.name}
                        </button>
                      );
                    })}
                    {!brandModels.length && (
                      <span className="vehicle-compat-picker__empty">Нет моделей — добавьте в настройках</span>
                    )}
                  </div>
                </div>
              ) : (
                <p className="vehicle-compat-picker__empty">Сначала выберите марку, затем отметьте модели</p>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="catalog-chip vehicle-compat-add-brand"
        disabled={disabled}
        onClick={addRow}
      >
        <FiPlus size={14} /> Добавить ещё марку
      </button>
    </div>
  );
}

export { selectedIdsToRows, rowsToSelectedIds };

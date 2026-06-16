import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FiMinus, FiPlus } from 'react-icons/fi';
import { getRecentBrandIds, getSuggestedBrandIds, rememberCompatBrand } from '../utils/recentCompatBrands';

function idsKey(ids) {
  return (ids || []).slice().sort((a, b) => a - b).join(',');
}

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

function emptyRow() {
  return { key: `new-${Date.now()}`, brandId: null, modelIds: [] };
}

function hasDraftRows(rows) {
  return (rows || []).some((r) => {
    if (!r.brandId && !(r.modelIds || []).length) return true;
    if (r.brandId && !(r.modelIds || []).length) return true;
    return false;
  });
}

function mergeCommittedWithDrafts(committed, drafts) {
  const committedBrandIds = new Set(committed.map((r) => r.brandId).filter(Boolean));
  const merged = [...committed];
  drafts.forEach((draft) => {
    if (!draft.brandId) {
      if (!merged.some((r) => !r.brandId && !(r.modelIds || []).length)) merged.push(draft);
      return;
    }
    if (!committedBrandIds.has(draft.brandId)) merged.push(draft);
  });
  return merged.length ? merged : [emptyRow()];
}

function brandName(brands, brandId) {
  return (brands || []).find((b) => b.id === brandId)?.name || '';
}

/**
 * Локальное состояние: родитель только получает onChange, не управляет selectedIds.
 * initialSelectedIds — только при монтировании (key= на родителе при смене товара/категории).
 */
export default function VehicleCompatibilityPicker({
  initialSelectedIds = [],
  brands = [],
  models = [],
  onChange,
  disabled = false,
}) {
  const userEditedRef = useRef(false);
  const hydratedRef = useRef(false);
  const modelIdsByBrandRef = useRef(new Map());
  const [rows, setRows] = useState(() => {
    const initial = selectedIdsToRows(initialSelectedIds, models);
    initial.forEach((row) => {
      if (row.brandId && (row.modelIds || []).length) {
        modelIdsByBrandRef.current.set(row.brandId, [...row.modelIds]);
      }
    });
    return initial;
  });

  const cacheRowModels = useCallback((row) => {
    const bid = row.brandId;
    if (!bid) return;
    if (!(row.modelIds || []).length) modelIdsByBrandRef.current.delete(bid);
    else modelIdsByBrandRef.current.set(bid, [...row.modelIds]);
  }, []);

  const hydrateCacheFromRows = useCallback((list) => {
    list.forEach(cacheRowModels);
  }, [cacheRowModels]);

  const allSelectedIds = useCallback((list) => {
    list.forEach(cacheRowModels);
    const out = [];
    const seen = new Set();
    modelIdsByBrandRef.current.forEach((ids) => {
      ids.forEach((id) => {
        if (!seen.has(id)) {
          seen.add(id);
          out.push(id);
        }
      });
    });
    return out;
  }, [cacheRowModels]);

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

  const emitRows = (nextRows) => {
    onChange?.(allSelectedIds(nextRows));
  };

  const scheduleEmit = (nextRows) => {
    queueMicrotask(() => emitRows(nextRows));
  };

  // Один раз: подтянуть сохранённые id после загрузки справочника (редактирование товара).
  useEffect(() => {
    if (hydratedRef.current || userEditedRef.current) return;
    if (!(initialSelectedIds || []).length || !(models || []).length) return;
    hydratedRef.current = true;
    setRows((prev) => {
      if (rowsToSelectedIds(prev).length > 0) return prev;
      if (hasDraftRows(prev)) return prev;
      const committed = selectedIdsToRows(initialSelectedIds, models);
      if (!committed.some((r) => r.brandId)) return prev;
      hydrateCacheFromRows(committed);
      return mergeCommittedWithDrafts(committed, prev);
    });
  }, [models, initialSelectedIds, hydrateCacheFromRows]);

  const patchRows = (updater, { emit = false } = {}) => {
    userEditedRef.current = true;
    setRows((prev) => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (emit) scheduleEmit(next);
      return next;
    });
  };

  const removeRow = (idx) => {
    patchRows((prev) => {
      const removedBrand = prev[idx]?.brandId;
      const next = prev.length <= 1 ? [emptyRow()] : prev.filter((_, i) => i !== idx);
      if (removedBrand && !next.some((r) => r.brandId === removedBrand)) {
        modelIdsByBrandRef.current.delete(removedBrand);
      }
      return next;
    }, { emit: true });
  };

  const addBrandRow = () => {
    patchRows((prev) => {
      if (prev.some((r) => !r.brandId && !(r.modelIds || []).length)) return prev;
      return [...prev, emptyRow()];
    });
  };

  const toggleModel = (rowIdx, modelId) => {
    patchRows((prev) => {
      const row = prev[rowIdx];
      if (!row) return prev;
      const set = new Set(row.modelIds || []);
      if (set.has(modelId)) set.delete(modelId);
      else set.add(modelId);
      return prev.map((r, i) => (i === rowIdx ? { ...r, modelIds: [...set] } : r));
    }, { emit: true });
  };

  const onBrandChange = (rowIdx, brandId) => {
    const parsed = brandId ? Number(brandId) : null;
    if (parsed) rememberCompatBrand(parsed);
    patchRows((prev) => {
      const current = prev[rowIdx];
      if (current) cacheRowModels(current);
      const allowed = new Set((modelsByBrand.get(parsed) || []).map((m) => m.id));
      const restored = parsed
        ? (modelIdsByBrandRef.current.get(parsed) || []).filter((id) => allowed.has(id))
        : [];
      const next = prev.map((row, i) => {
        if (i !== rowIdx) return row;
        return {
          ...row,
          brandId: parsed,
          modelIds: restored,
          key: parsed ? `brand-${parsed}` : row.key,
        };
      });
      const prevIds = idsKey(allSelectedIds(prev));
      const nextIds = idsKey(allSelectedIds(next));
      if (prevIds !== nextIds) scheduleEmit(next);
      return next;
    });
  };

  const totalModels = useMemo(() => allSelectedIds(rows).length, [rows, allSelectedIds]);
  const brandCount = useMemo(
    () => [...modelIdsByBrandRef.current.values()].filter((ids) => ids.length).length,
    [rows],
  );

  const recentBrandIds = useMemo(() => getRecentBrandIds(brands), [brands]);
  const suggestedBrandIds = useMemo(
    () => getSuggestedBrandIds(brands, recentBrandIds),
    [brands, recentBrandIds],
  );

  const pickSuggestedBrand = (brandId) => {
    const idx = rows.findIndex((r) => !r.brandId);
    const rowIdx = idx >= 0 ? idx : 0;
    rememberCompatBrand(brandId);
    onBrandChange(rowIdx, String(brandId));
  };

  return (
    <div className="vehicle-compat-picker vehicle-compat-picker--rows">
      <div className="vehicle-compat-picker__head">
        <span className="vehicle-compat-picker__title">Совместим с авто</span>
        {totalModels > 0 && (
          <span className="vehicle-compat-picker__summary">
            Выбрано: {totalModels} мод.
            {brandCount > 1 ? ` · ${brandCount} марки` : ''}
          </span>
        )}
      </div>

      {suggestedBrandIds.length > 0 && !disabled && (
        <div className="vehicle-compat-quick-brands">
          <span className="vehicle-compat-quick-brands__label">Быстрый выбор:</span>
          <div className="vehicle-compat-quick-brands__list">
            {suggestedBrandIds.map((bid) => {
              const b = (brands || []).find((x) => x.id === bid);
              if (!b) return null;
              return (
                <button
                  key={bid}
                  type="button"
                  className="catalog-chip vehicle-compat-quick-brand"
                  onClick={() => pickSuggestedBrand(bid)}
                >
                  {b.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="vehicle-compat-rows">
        {rows.map((row, idx) => {
          const brandModels = row.brandId ? modelsByBrand.get(row.brandId) || [] : [];
          const selectedSet = new Set(row.modelIds || []);
          const rowModelCount = (row.modelIds || []).length;
          return (
            <div
              key={row.key || `row-${idx}`}
              className={`vehicle-compat-row${row.brandId ? ' vehicle-compat-row--active' : ''}`}
            >
              <div className="vehicle-compat-row__top">
                <label className="vehicle-compat-row__brand-label">
                  <span>
                    Марка
                    {row.brandId && rowModelCount > 0 && (
                      <span className="vehicle-compat-row__count">
                        {' '}· {brandName(brands, row.brandId)} ({rowModelCount})
                      </span>
                    )}
                  </span>
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
                  title="Убрать эту марку"
                  disabled={disabled}
                  onClick={() => removeRow(idx)}
                >
                  <FiMinus size={14} />
                </button>
              </div>

              {row.brandId ? (
                <div className="vehicle-compat-row__models">
                  <span className="vehicle-compat-row__models-label">Модели — можно несколько</span>
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
                <p className="vehicle-compat-picker__empty">Выберите марку, затем отметьте одну или несколько моделей</p>
              )}
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="catalog-chip vehicle-compat-add-brand"
        disabled={disabled}
        onClick={addBrandRow}
      >
        <FiPlus size={14} /> Добавить ещё марку
      </button>
    </div>
  );
}

export { selectedIdsToRows, rowsToSelectedIds };

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { FiX } from 'react-icons/fi';
import { compatibilityApi } from '../api/client';

function normalizeIds(ids) {
  return (ids || [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

/**
 * Multi-select кодов моторов. Подсказки по выбранным моделям авто — необязательная привязка.
 */
export default function EngineFamilyPicker({
  initialSelectedIds = [],
  vehicleModelIds = [],
  onChange,
  disabled = false,
}) {
  const userEditedRef = useRef(false);
  const [selectedIds, setSelectedIds] = useState(() => normalizeIds(initialSelectedIds));
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);

  const { data: families = [] } = useQuery({
    queryKey: ['compatibility', 'engine-families', 'picker'],
    queryFn: () => compatibilityApi.engineFamilies({ include_inactive: false }).then((r) => r.data),
    staleTime: 60000,
  });

  useEffect(() => {
    if (userEditedRef.current) return;
    setSelectedIds(normalizeIds(initialSelectedIds));
  }, [initialSelectedIds]);

  const emitChange = useCallback((ids) => {
    userEditedRef.current = true;
    setSelectedIds(ids);
    onChange?.(ids);
  }, [onChange]);

  const vmSet = useMemo(() => new Set(normalizeIds(vehicleModelIds)), [vehicleModelIds]);

  const sortedFamilies = useMemo(() => {
    const linkedIds = new Set();
    (families || []).forEach((f) => {
      (f.vehicle_models || []).forEach((vm) => {
        if (vmSet.has(vm.id)) linkedIds.add(f.id);
      });
    });
    return [...(families || [])].sort((a, b) => {
      const aLinked = linkedIds.has(a.id);
      const bLinked = linkedIds.has(b.id);
      if (aLinked !== bLinked) return aLinked ? -1 : 1;
      return String(a.code).localeCompare(String(b.code), 'ru', { sensitivity: 'base' });
    });
  }, [families, vmSet]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return sortedFamilies;
    return sortedFamilies.filter((f) => {
      const code = String(f.code || '').toLowerCase();
      const name = String(f.name || '').toLowerCase();
      return code.includes(q) || name.includes(q);
    });
  }, [sortedFamilies, search]);

  const selectedFamilies = useMemo(() => {
    const byId = new Map((families || []).map((f) => [f.id, f]));
    return selectedIds.map((id) => byId.get(id)).filter(Boolean);
  }, [families, selectedIds]);

  const toggle = (id) => {
    const nid = Number(id);
    if (!nid) return;
    if (selectedIds.includes(nid)) {
      emitChange(selectedIds.filter((x) => x !== nid));
    } else {
      emitChange([...selectedIds, nid]);
    }
  };

  const hasVmHint = vmSet.size > 0;

  return (
    <div className={`engine-family-picker${open ? ' engine-family-picker--open' : ''}`}>
      <div className="engine-family-picker__selected">
        {selectedFamilies.length ? selectedFamilies.map((f) => (
          <button
            key={f.id}
            type="button"
            className="catalog-chip catalog-chip-active engine-family-picker__chip"
            disabled={disabled}
            onClick={() => toggle(f.id)}
            title={f.name || f.code}
          >
            {f.code}
            <FiX size={12} aria-hidden />
          </button>
        )) : (
          <span className="engine-family-picker__empty">Выберите один или несколько кодов</span>
        )}
      </div>

      <button
        type="button"
        className="engine-family-picker__toggle"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Скрыть список' : 'Выбрать коды'}
      </button>

      {open && (
        <div className="engine-family-picker__panel">
          {hasVmHint && (
            <p className="product-form-field-hint">Коды для выбранных моделей — в начале списка</p>
          )}
          <input
            className="ios-input engine-family-picker__search"
            placeholder="Поиск кода…"
            value={search}
            disabled={disabled}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="engine-family-picker__grid">
            {filtered.map((f) => {
              const on = selectedIds.includes(f.id);
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`catalog-chip${on ? ' catalog-chip-active' : ''}`}
                  disabled={disabled}
                  onClick={() => toggle(f.id)}
                  title={f.name || undefined}
                >
                  {f.code}
                </button>
              );
            })}
            {!filtered.length && (
              <span className="engine-family-picker__empty">Нет кодов — добавьте в настройках каталога</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export { normalizeIds as normalizeEngineFamilyIds };

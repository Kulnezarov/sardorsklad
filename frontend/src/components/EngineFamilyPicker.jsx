import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FiChevronDown, FiChevronUp, FiPlus, FiX } from 'react-icons/fi';
import { compatibilityApi, getApiErrorMessage } from '../api/client';
import EngineFamilyDetailsFields from './EngineFamilyDetailsFields';
import {
  buildEngineFamilyPayload,
  EMPTY_ENGINE_FAMILY_DETAILS,
  engineFamilySearchHaystack,
  formatEngineFamilySummary,
} from '../utils/engineFamilyUtils';

function normalizeIds(ids) {
  return (ids || [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function normalizeCode(value) {
  return String(value || '').trim().replace(/\s+/g, '');
}

/**
 * Multi-select кодов моторов. Подсказки по выбранным моделям авто — необязательная привязка.
 * Если кода нет в справочнике — можно добавить прямо из формы товара.
 */
export default function EngineFamilyPicker({
  initialSelectedIds = [],
  vehicleModelIds = [],
  onChange,
  disabled = false,
  singleSelect = false,
  allowCreate = true,
}) {
  const qc = useQueryClient();
  const userEditedRef = useRef(false);
  const [selectedIds, setSelectedIds] = useState(() => normalizeIds(initialSelectedIds));
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [addPanelOpen, setAddPanelOpen] = useState(false);
  const [showAddDetails, setShowAddDetails] = useState(false);
  const [newDetails, setNewDetails] = useState({ ...EMPTY_ENGINE_FAMILY_DETAILS });

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
  const vmIds = useMemo(() => normalizeIds(vehicleModelIds), [vehicleModelIds]);

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

  const searchTrim = search.trim();
  const searchCode = normalizeCode(search);

  const existingByCode = useMemo(() => {
    if (!searchCode) return null;
    const q = searchCode.toLowerCase();
    return (families || []).find((f) => normalizeCode(f.code).toLowerCase() === q) || null;
  }, [families, searchCode]);

  const filtered = useMemo(() => {
    const q = searchTrim.toLowerCase();
    if (!q) return sortedFamilies;
    return sortedFamilies.filter((f) => engineFamilySearchHaystack(f).includes(q));
  }, [sortedFamilies, searchTrim]);

  const selectedFamilies = useMemo(() => {
    const byId = new Map((families || []).map((f) => [f.id, f]));
    return selectedIds.map((id) => byId.get(id)).filter(Boolean);
  }, [families, selectedIds]);

  const selectCreatedFamily = useCallback((family) => {
    if (!family?.id) return;
    const nid = Number(family.id);
    if (singleSelect) {
      emitChange([nid]);
    } else if (!selectedIds.includes(nid)) {
      emitChange([...selectedIds, nid]);
    }
  }, [emitChange, selectedIds, singleSelect]);

  const createMut = useMutation({
    mutationFn: (payload) => compatibilityApi.createEngineFamily(payload).then((r) => r.data),
    onSuccess: (created) => {
      qc.invalidateQueries({ queryKey: ['compatibility', 'engine-families'] });
      selectCreatedFamily(created);
      toast.success(`Код «${created.code}» добавлен`);
      setSearch('');
      setAddPanelOpen(false);
      setShowAddDetails(false);
      setNewDetails({ ...EMPTY_ENGINE_FAMILY_DETAILS });
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось добавить код')),
  });

  const toggle = (id) => {
    const nid = Number(id);
    if (!nid) return;
    if (singleSelect) {
      if (selectedIds.includes(nid)) {
        emitChange([]);
      } else {
        emitChange([nid]);
      }
      return;
    }
    if (selectedIds.includes(nid)) {
      emitChange(selectedIds.filter((x) => x !== nid));
    } else {
      emitChange([...selectedIds, nid]);
    }
  };

  const submitNewCode = (codeOverride) => {
    const code = normalizeCode(codeOverride ?? search);
    if (!code) {
      toast.error('Введите код мотора');
      return;
    }
    if ((families || []).some((f) => normalizeCode(f.code).toLowerCase() === code.toLowerCase())) {
      toast.error('Такой код уже есть — выберите его из списка');
      return;
    }
    createMut.mutate(buildEngineFamilyPayload({
      code,
      ...newDetails,
      is_active: true,
      vehicle_model_ids: vmIds.length ? vmIds : undefined,
    }));
  };

  const hasVmHint = vmSet.size > 0;
  const showQuickAdd = allowCreate && !disabled && searchCode && !existingByCode;
  const showAddForm = allowCreate && !disabled && (showQuickAdd || addPanelOpen);

  return (
    <div className={`engine-family-picker${open ? ' engine-family-picker--open' : ''}`}>
      <div className="engine-family-picker__selected">
        {selectedFamilies.length ? selectedFamilies.map((f) => {
          const summary = formatEngineFamilySummary(f);
          return (
          <button
            key={f.id}
            type="button"
            className="catalog-chip catalog-chip-active engine-family-picker__chip"
            disabled={disabled}
            onClick={() => toggle(f.id)}
            title={summary || f.code}
          >
            <span className="engine-family-picker__chip-code">{f.code}</span>
            {summary ? (
              <span className="engine-family-picker__chip-sub">{summary}</span>
            ) : null}
            <FiX size={12} aria-hidden />
          </button>
          );
        }) : (
          <span className="engine-family-picker__empty">
            {singleSelect ? 'Выберите код мотора' : 'Выберите один или несколько кодов'}
          </span>
        )}
      </div>

      <button
        type="button"
        className="engine-family-picker__toggle"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Скрыть список' : (singleSelect ? 'Выбрать код' : 'Выбрать коды')}
      </button>

      {open && (
        <div className="engine-family-picker__panel">
          {hasVmHint && (
            <p className="product-form-field-hint">Коды для выбранных моделей — в начале списка</p>
          )}
          <input
            className="ios-input engine-family-picker__search"
            placeholder="Поиск или новый код (например 465)…"
            value={search}
            disabled={disabled}
            onChange={(e) => setSearch(e.target.value)}
          />

          {existingByCode && !selectedIds.includes(existingByCode.id) && (
            <button
              type="button"
              className="engine-family-picker__existing-hint"
              disabled={disabled}
              onClick={() => toggle(existingByCode.id)}
            >
              Код «{existingByCode.code}» уже есть — нажмите, чтобы выбрать
            </button>
          )}

          <div className="engine-family-picker__grid">
            {filtered.map((f) => {
              const on = selectedIds.includes(f.id);
              const summary = formatEngineFamilySummary(f);
              return (
                <button
                  key={f.id}
                  type="button"
                  className={`catalog-chip engine-family-picker__option${on ? ' catalog-chip-active' : ''}`}
                  disabled={disabled}
                  onClick={() => toggle(f.id)}
                  title={summary || undefined}
                >
                  <span className="engine-family-picker__option-code">{f.code}</span>
                  {summary ? (
                    <span className="engine-family-picker__option-sub">{summary}</span>
                  ) : null}
                </button>
              );
            })}
            {!filtered.length && !showQuickAdd && (
              <span className="engine-family-picker__empty">Нет совпадений — введите код и добавьте ниже</span>
            )}
          </div>

          {showAddForm && (
            <div className="engine-family-picker__add">
              <div className="engine-family-picker__add-head">
                <span className="engine-family-picker__add-title">
                  {showQuickAdd ? `Новый код «${searchCode}»` : 'Новый код мотора'}
                </span>
                {showQuickAdd && (
                  <button
                    type="button"
                    className="engine-family-picker__add-quick"
                    disabled={disabled || createMut.isPending}
                    onClick={() => submitNewCode(searchCode)}
                  >
                    <FiPlus size={14} aria-hidden />
                    {createMut.isPending ? 'Добавление…' : 'Добавить и выбрать'}
                  </button>
                )}
              </div>

              {!showQuickAdd && (
                <div className="engine-family-picker__add-code-row">
                  <input
                    className="ios-input engine-family-picker__add-code"
                    placeholder="Код, например 465"
                    value={search}
                    disabled={disabled}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <button
                    type="button"
                    className="engine-family-picker__add-quick"
                    disabled={disabled || createMut.isPending || !searchCode}
                    onClick={() => submitNewCode()}
                  >
                    <FiPlus size={14} aria-hidden />
                    {createMut.isPending ? '…' : 'Добавить'}
                  </button>
                </div>
              )}

              <button
                type="button"
                className="engine-family-picker__add-details-toggle"
                disabled={disabled}
                onClick={() => setShowAddDetails((v) => !v)}
              >
                {showAddDetails ? <FiChevronUp size={14} /> : <FiChevronDown size={14} />}
                {showAddDetails ? 'Скрыть характеристики' : 'Объём, топливо, мощность…'}
              </button>

              {showAddDetails && (
                <EngineFamilyDetailsFields
                  idPrefix="picker-ef"
                  value={newDetails}
                  onChange={setNewDetails}
                />
              )}

              {vmIds.length > 0 && (
                <p className="product-form-field-hint engine-family-picker__add-hint">
                  Код будет привязан к выбранным моделям авто
                </p>
              )}
            </div>
          )}

          {allowCreate && !disabled && !showAddForm && (
            <button
              type="button"
              className="engine-family-picker__add-link"
              onClick={() => {
                setAddPanelOpen(true);
                setShowAddDetails(false);
                setNewDetails({ ...EMPTY_ENGINE_FAMILY_DETAILS });
              }}
            >
              <FiPlus size={14} aria-hidden />
              Добавить новый код
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export { normalizeIds as normalizeEngineFamilyIds };

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  FiCheck,
  FiChevronDown,
  FiChevronUp,
  FiCpu,
  FiLayers,
  FiPackage,
  FiPlus,
  FiSave,
  FiSearch,
  FiSlash,
  FiTrash2,
  FiTruck,
} from 'react-icons/fi';
import { categoryApi, compatibilityApi, getApiErrorMessage } from '../api/client';
import EngineFamilyDetailsFields from './EngineFamilyDetailsFields';
import {
  buildEngineFamilyPayload,
  EMPTY_ENGINE_FAMILY_DETAILS,
  engineFamilyDetailsFromFamily,
  formatEngineFamilySummary,
} from '../utils/engineFamilyUtils';
import { resolveCategoryProfile, categoryTreeQueryKey, patchEngineCodeModeInSchema, mergeEngineCodeModeIntoCategoryTree } from '../utils/formLayoutUtils';

function pluralProducts(n) {
  const m = n % 10;
  const m2 = n % 100;
  if (m2 >= 11 && m2 <= 14) return 'товаров';
  if (m === 1) return 'товар';
  if (m >= 2 && m <= 4) return 'товара';
  return 'товаров';
}

function normalizeModelIds(ids) {
  return (ids || [])
    .map((id) => Number(id))
    .filter((id) => Number.isInteger(id) && id > 0);
}

function MatrixModeToggle({ value, onChange }) {
  return (
    <div className="engine-matrix-toggle" role="group" aria-label="Режим кода мотора">
      <button
        type="button"
        className={`engine-matrix-toggle__btn${value === 'none' ? ' engine-matrix-toggle__btn--active' : ''}`}
        onClick={() => onChange('none')}
      >
        <FiSlash size={13} aria-hidden />
        Не нужен
      </button>
      <button
        type="button"
        className={`engine-matrix-toggle__btn engine-matrix-toggle__btn--required${value === 'required' ? ' engine-matrix-toggle__btn--active' : ''}`}
        onClick={() => onChange('required')}
      >
        <FiCheck size={13} aria-hidden />
        Обязателен
      </button>
    </div>
  );
}

export default function SettingsEngineFamiliesSection() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newDetails, setNewDetails] = useState({ ...EMPTY_ENGINE_FAMILY_DETAILS });
  const [expandedId, setExpandedId] = useState(null);
  const [editCode, setEditCode] = useState('');
  const [editDetails, setEditDetails] = useState({ ...EMPTY_ENGINE_FAMILY_DETAILS });
  const [editModelIds, setEditModelIds] = useState([]);
  const [matrixDraft, setMatrixDraft] = useState({});

  const { data: families = [], isLoading } = useQuery({
    queryKey: ['compatibility', 'engine-families', 'all', search],
    queryFn: () => compatibilityApi.engineFamilies({
      include_inactive: true,
      ...(search.trim() ? { q: search.trim() } : {}),
    }).then((r) => r.data),
  });

  const { data: models = [] } = useQuery({
    queryKey: ['compatibility', 'vehicle-models', 'all'],
    queryFn: () => compatibilityApi.vehicleModels({ include_inactive: true }).then((r) => r.data),
  });

  const { data: categoryTree = [] } = useQuery({
    queryKey: categoryTreeQueryKey(false),
    queryFn: () => categoryApi.getTree({ active_only: false }).then((r) => r.data),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['compatibility', 'engine-families'] });
  };

  const createMut = useMutation({
    mutationFn: (payload) => compatibilityApi.createEngineFamily(payload),
    onSuccess: () => {
      toast.success('Код мотора добавлен');
      setNewCode('');
      setNewDetails({ ...EMPTY_ENGINE_FAMILY_DETAILS });
      invalidate();
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось добавить код')),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, payload }) => compatibilityApi.updateEngineFamily(id, payload),
    onSuccess: () => {
      toast.success('Сохранено');
      invalidate();
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось сохранить')),
  });

  const deleteMut = useMutation({
    mutationFn: (id) => compatibilityApi.deleteEngineFamily(id),
    onSuccess: () => {
      toast.success('Код удалён');
      setExpandedId(null);
      invalidate();
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось удалить')),
  });

  const categoryMatrix = useMemo(() => {
    const rows = [];
    (categoryTree || []).forEach((group) => {
      (group.children || []).forEach((cat) => {
        const prof = resolveCategoryProfile(cat.attribute_schema);
        rows.push({
          id: cat.id,
          groupName: group.name,
          name: cat.name,
          engine_code_mode: prof.engine_code_mode || 'none',
        });
      });
    });
    return rows.sort((a, b) =>
      `${a.groupName} ${a.name}`.localeCompare(`${b.groupName} ${b.name}`, 'ru'),
    );
  }, [categoryTree]);

  const sortedFamilies = useMemo(
    () => [...(families || [])].sort((a, b) =>
      String(a.code).localeCompare(String(b.code), 'ru', { sensitivity: 'base' }),
    ),
    [families],
  );

  const stats = useMemo(() => {
    const total = sortedFamilies.length;
    const active = sortedFamilies.filter((f) => f.is_active !== false).length;
    const requiredCats = categoryMatrix.filter((r) =>
      (matrixDraft[r.id] ?? r.engine_code_mode) === 'required',
    ).length;
    return { total, active, requiredCats };
  }, [sortedFamilies, categoryMatrix, matrixDraft]);

  const modelsByBrand = useMemo(() => {
    const map = new Map();
    (models || []).forEach((m) => {
      const bid = m.vehicle_brand_id;
      if (!map.has(bid)) map.set(bid, { brandName: m.brand?.name || m.brand_name || '—', models: [] });
      map.get(bid).models.push(m);
    });
    map.forEach((g) => g.models.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru')));
    return [...map.entries()].sort((a, b) => a[1].brandName.localeCompare(b[1].brandName, 'ru'));
  }, [models]);

  const openEdit = (family) => {
    setExpandedId(family.id);
    setEditCode(family.code || '');
    setEditDetails(engineFamilyDetailsFromFamily(family));
    setEditModelIds((family.vehicle_models || []).map((vm) => vm.id));
  };

  const submitNew = () => {
    const code = newCode.trim();
    if (!code) return toast.error('Введите код');
    createMut.mutate(buildEngineFamilyPayload({
      code,
      ...newDetails,
      is_active: true,
    }));
  };

  const saveEdit = (family) => {
    const code = editCode.trim();
    if (!code) return toast.error('Введите код');
    updateMut.mutate({
      id: family.id,
      payload: buildEngineFamilyPayload({
        code,
        ...editDetails,
        vehicle_model_ids: normalizeModelIds(editModelIds),
      }),
    });
  };

  const toggleEditModel = (modelId) => {
    setEditModelIds((prev) => {
      const id = Number(modelId);
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      return [...prev, id];
    });
  };

  const matrixMode = (catId, fallback) => {
    if (matrixDraft[catId] != null) return matrixDraft[catId];
    return fallback;
  };

  const setMatrixMode = (catId, mode) => {
    setMatrixDraft((d) => ({ ...d, [catId]: mode }));
  };

  const saveMatrixMut = useMutation({
    mutationFn: async (updates) => {
      const results = [];
      for (const { id, engine_code_mode, attribute_schema } of updates) {
        let response;
        try {
          response = await categoryApi.patchEngineCodeMode(id, engine_code_mode);
        } catch (e) {
          const status = e?.response?.status;
          if (status === 404 || status === 405) {
            response = await categoryApi.update(id, { attribute_schema });
          } else {
            throw e;
          }
        }
        const savedSchema = response?.data?.attribute_schema;
        const savedMode = resolveCategoryProfile(savedSchema).engine_code_mode;
        if (savedMode !== engine_code_mode) {
          const err = new Error('ENGINE_CODE_MODE_NOT_PERSISTED');
          err.meta = { id, expected: engine_code_mode, actual: savedMode };
          throw err;
        }
        results.push({
          id,
          engine_code_mode,
          attribute_schema: savedSchema,
        });
      }
      return results;
    },
    onSuccess: (results) => {
      const updatesById = Object.fromEntries(results.map((r) => [r.id, r]));
      const patchTree = (old) => mergeEngineCodeModeIntoCategoryTree(old, updatesById);
      qc.setQueryData(categoryTreeQueryKey(false), patchTree);
      qc.setQueryData(categoryTreeQueryKey(true), patchTree);
      setMatrixDraft({});
      toast.success('Настройки категорий сохранены');
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['categories', 'tree'] });
    },
    onError: (e) => {
      if (e?.message === 'ENGINE_CODE_MODE_NOT_PERSISTED') {
        toast.error(
          'Сервер не сохранил настройку «код мотора». Обновите backend на VPS: docker compose -f docker-compose.vps.yml up -d --build backend',
          { duration: 8000 },
        );
        return;
      }
      toast.error(getApiErrorMessage(e, 'Не удалось сохранить категории'));
    },
  });

  const saveMatrix = () => {
    const updates = categoryMatrix
      .filter((row) => matrixDraft[row.id] != null && matrixDraft[row.id] !== row.engine_code_mode)
      .map((row) => {
        const cat = categoryTree.flatMap((g) => g.children || []).find((c) => c.id === row.id);
        const engine_code_mode = matrixDraft[row.id];
        return {
          id: row.id,
          engine_code_mode,
          attribute_schema: patchEngineCodeModeInSchema(cat?.attribute_schema, engine_code_mode),
        };
      });
    if (!updates.length) {
      toast('Нет изменений');
      return;
    }
    saveMatrixMut.mutate(updates);
  };

  const matrixDirty = categoryMatrix.some(
    (row) => matrixDraft[row.id] != null && matrixDraft[row.id] !== row.engine_code_mode,
  );

  const groupedMatrix = useMemo(() => {
    const groups = new Map();
    categoryMatrix.forEach((row) => {
      if (!groups.has(row.groupName)) groups.set(row.groupName, []);
      groups.get(row.groupName).push(row);
    });
    return [...groups.entries()];
  }, [categoryMatrix]);

  const matrixStats = useMemo(() => {
    const required = categoryMatrix.filter((row) =>
      (matrixDraft[row.id] ?? row.engine_code_mode) === 'required',
    ).length;
    return { total: categoryMatrix.length, required };
  }, [categoryMatrix, matrixDraft]);

  return (
    <div className="settings-catalog-panel engine-settings">
      <div className="engine-settings-hero">
        <div className="engine-settings-hero__icon" aria-hidden>
          <FiCpu size={22} />
        </div>
        <div className="engine-settings-hero__text">
          <h2 className="engine-settings-hero__title">Коды моторов</h2>
          <p className="engine-settings-hero__desc">
            Единый справочник двигателей для совместимости запчастей. Несколько кодов на один товар.
          </p>
          <div className="engine-settings-stats">
            <span className="engine-settings-stat">
              <strong>{stats.total}</strong> {stats.total === 1 ? 'код' : stats.total >= 2 && stats.total <= 4 ? 'кода' : 'кодов'}
            </span>
            <span className="engine-settings-stat engine-settings-stat--muted">
              {stats.active} активных
            </span>
            <span className="engine-settings-stat engine-settings-stat--accent">
              {stats.requiredCats} категорий с обязательным кодом
            </span>
          </div>
        </div>
      </div>

      <div className="engine-settings-card engine-settings-card--add">
        <div className="engine-settings-card__head">
          <FiPlus size={16} />
          <span>Новый код</span>
        </div>
        <div className="engine-settings-add-grid">
          <label className="engine-settings-field engine-settings-field--full">
            <span className="engine-settings-field__label">Код мотора</span>
            <input
              className="engine-settings-field__input engine-settings-field__input--mono"
              placeholder="JL473ZQ7, 465Q…"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitNew();
              }}
            />
          </label>
          <EngineFamilyDetailsFields
            idPrefix="new-ef"
            value={newDetails}
            onChange={setNewDetails}
          />
          <button
            type="button"
            className="engine-settings-add-btn engine-settings-add-btn--wide"
            disabled={createMut.isPending}
            onClick={submitNew}
          >
            <FiPlus size={17} />
            Добавить
          </button>
        </div>
      </div>

      <div className="engine-settings-search-wrap">
        <FiSearch size={16} className="engine-settings-search-wrap__icon" aria-hidden />
        <input
          className="engine-settings-search"
          placeholder="Поиск по коду, объёму, производителю…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search.trim() && (
          <button type="button" className="engine-settings-search-wrap__clear" onClick={() => setSearch('')}>
            ×
          </button>
        )}
      </div>

      {isLoading && (
        <div className="engine-settings-loading">
          <span className="engine-settings-loading__dot" />
          Загрузка справочника…
        </div>
      )}

      {!isLoading && !sortedFamilies.length && (
        <div className="engine-settings-empty">
          <div className="engine-settings-empty__icon"><FiCpu size={28} /></div>
          <p className="engine-settings-empty__title">Справочник пуст</p>
          <p className="engine-settings-empty__hint">Добавьте первый код двигателя в форме выше</p>
        </div>
      )}

      {sortedFamilies.length > 0 && (
        <div className="engine-code-list">
          {sortedFamilies.map((family) => {
            const open = expandedId === family.id;
            const linked = family.vehicle_models || [];
            const productCount = family.product_count || 0;
            const summary = formatEngineFamilySummary(family);
            return (
              <article
                key={family.id}
                className={`engine-code-card${open ? ' engine-code-card--open' : ''}${family.is_active === false ? ' engine-code-card--inactive' : ''}`}
              >
                <button
                  type="button"
                  className="engine-code-card__head"
                  onClick={() => (open ? setExpandedId(null) : openEdit(family))}
                >
                  <div className="engine-code-card__code-wrap">
                    <span className="engine-code-card__code">{family.code}</span>
                    {family.is_active === false && (
                      <span className="engine-code-card__badge engine-code-card__badge--muted">неактивен</span>
                    )}
                  </div>
                  {summary ? (
                    <p className="engine-code-card__desc">{summary}</p>
                  ) : family.name ? (
                    <p className="engine-code-card__desc">{family.name}</p>
                  ) : null}
                  <div className="engine-code-card__meta">
                    <span className="engine-code-card__badge">
                      <FiPackage size={12} />
                      {productCount} {pluralProducts(productCount)}
                    </span>
                    {linked.length > 0 && (
                      <span className="engine-code-card__badge">
                        <FiTruck size={12} />
                        {linked.length} мод.
                      </span>
                    )}
                  </div>
                  <span className="engine-code-card__chevron" aria-hidden>
                    {open ? <FiChevronUp size={18} /> : <FiChevronDown size={18} />}
                  </span>
                </button>

                {open && (
                  <div className="engine-code-card__body">
                    <div className="engine-settings-edit-grid">
                      <label className="engine-settings-field">
                        <span className="engine-settings-field__label">Код</span>
                        <input
                          className="engine-settings-field__input engine-settings-field__input--mono"
                          value={editCode}
                          onChange={(e) => setEditCode(e.target.value)}
                        />
                      </label>
                      <EngineFamilyDetailsFields
                        idPrefix={`edit-ef-${family.id}`}
                        value={editDetails}
                        onChange={setEditDetails}
                      />
                    </div>

                    <div className="engine-code-card__models">
                      <div className="engine-code-card__models-head">
                        <FiTruck size={15} />
                        <span>Модели авто</span>
                        <span className="engine-code-card__models-opt">необязательно</span>
                      </div>
                      <p className="engine-code-card__models-hint">
                        В форме товара коды, привязанные к модели, показываются первыми.
                      </p>
                      <div className="engine-code-card__models-scroll">
                        {modelsByBrand.map(([brandId, group]) => (
                          <div key={brandId} className="engine-code-card__brand">
                            <div className="engine-code-card__brand-name">{group.brandName}</div>
                            <div className="engine-code-card__brand-chips">
                              {group.models.map((m) => {
                                const on = editModelIds.includes(m.id);
                                return (
                                  <button
                                    key={m.id}
                                    type="button"
                                    className={`engine-code-chip${on ? ' engine-code-chip--on' : ''}`}
                                    onClick={() => toggleEditModel(m.id)}
                                  >
                                    {m.name}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="engine-code-card__actions">
                      <button
                        type="button"
                        className="engine-code-card__btn engine-code-card__btn--primary"
                        disabled={updateMut.isPending}
                        onClick={() => saveEdit(family)}
                      >
                        <FiCheck size={16} /> Сохранить
                      </button>
                      <button
                        type="button"
                        className="engine-code-card__btn engine-code-card__btn--ghost"
                        disabled={updateMut.isPending}
                        onClick={() => updateMut.mutate({
                          id: family.id,
                          payload: { is_active: !family.is_active },
                        })}
                      >
                        {family.is_active !== false ? 'Деактивировать' : 'Активировать'}
                      </button>
                      <button
                        type="button"
                        className="engine-code-card__btn engine-code-card__btn--danger"
                        disabled={deleteMut.isPending || productCount > 0}
                        title={productCount > 0 ? 'Код используется в товарах' : 'Удалить'}
                        onClick={() => {
                          if (window.confirm(`Удалить код «${family.code}»?`)) {
                            deleteMut.mutate(family.id);
                          }
                        }}
                      >
                        <FiTrash2 size={15} /> Удалить
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      <section className="engine-settings-card engine-settings-card--matrix">
        <div className="engine-settings-card__head engine-settings-card__head--matrix">
          <div className="engine-matrix-head__icon" aria-hidden>
            <FiLayers size={18} />
          </div>
          <div className="engine-matrix-head__text">
            <span>Где показывать код мотора</span>
            <p className="engine-settings-card__sub">
              Для категорий «Обязателен» в форме товара можно выбрать несколько кодов.
            </p>
          </div>
          {categoryMatrix.length > 0 && (
            <div className="engine-matrix-head__stats">
              <span className="engine-matrix-head__stat">
                <strong>{matrixStats.required}</strong>
                <span>обяз.</span>
              </span>
              <span className="engine-matrix-head__stat engine-matrix-head__stat--muted">
                <strong>{matrixStats.total}</strong>
                <span>всего</span>
              </span>
            </div>
          )}
        </div>

        {categoryMatrix.length > 0 ? (
          <>
            <div className="engine-matrix-groups">
              {groupedMatrix.map(([groupName, rows]) => {
                const groupRequired = rows.filter((row) =>
                  (matrixDraft[row.id] ?? row.engine_code_mode) === 'required',
                ).length;
                return (
                  <div key={groupName} className="engine-matrix-group">
                    <div className="engine-matrix-group__head">
                      <div className="engine-matrix-group__title">
                        <span className="engine-matrix-group__dot" aria-hidden />
                        <span>{groupName}</span>
                      </div>
                      <span className={`engine-matrix-group__pill${groupRequired ? ' engine-matrix-group__pill--active' : ''}`}>
                        {groupRequired ? `${groupRequired} обяз.` : 'не требуется'}
                      </span>
                    </div>
                    <div className="engine-matrix-group__rows">
                      {rows.map((row) => {
                        const mode = matrixMode(row.id, row.engine_code_mode);
                        const dirty = matrixDraft[row.id] != null && matrixDraft[row.id] !== row.engine_code_mode;
                        return (
                          <div
                            key={row.id}
                            className={`engine-matrix-row${dirty ? ' engine-matrix-row--dirty' : ''}${mode === 'required' ? ' engine-matrix-row--required' : ''}`}
                          >
                            <div className="engine-matrix-row__info">
                              <span className="engine-matrix-row__cat">{row.name}</span>
                              {mode === 'required' && (
                                <span className="engine-matrix-row__badge">
                                  <FiCheck size={11} aria-hidden />
                                  Код обязателен
                                </span>
                              )}
                              {dirty && (
                                <span className="engine-matrix-row__badge engine-matrix-row__badge--dirty">
                                  изменено
                                </span>
                              )}
                            </div>
                            <MatrixModeToggle
                              value={mode}
                              onChange={(v) => setMatrixMode(row.id, v)}
                            />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>

            {matrixDirty && (
              <div className="engine-matrix-save-bar">
                <div className="engine-matrix-save-bar__text">
                  <span className="engine-matrix-save-bar__dot" aria-hidden />
                  Есть несохранённые изменения категорий
                </div>
                <button
                  type="button"
                  className="engine-matrix-save-bar__btn"
                  disabled={saveMatrixMut.isPending}
                  onClick={saveMatrix}
                >
                  <FiSave size={16} />
                  Сохранить
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="engine-settings-empty__hint engine-matrix-empty">Категории не загружены</p>
        )}
      </section>
    </div>
  );
}

import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FiCheck, FiChevronDown, FiChevronUp, FiEdit2, FiPlus, FiTrash2, FiX } from 'react-icons/fi';
import { categoryApi, compatibilityApi, getApiErrorMessage } from '../api/client';
import { fieldsToFullSchema, resolveCategoryProfile, schemaToEditorState } from '../utils/formLayoutUtils';

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

export default function SettingsEngineFamiliesSection() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [editCode, setEditCode] = useState('');
  const [editDesc, setEditDesc] = useState('');
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
    queryKey: ['categories', 'tree'],
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
      setNewDesc('');
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
    return rows.sort((a, b) => {
      const ga = `${a.groupName} ${a.name}`.localeCompare(`${b.groupName} ${b.name}`, 'ru');
      return ga;
    });
  }, [categoryTree]);

  const sortedFamilies = useMemo(
    () => [...(families || [])].sort((a, b) => String(a.code).localeCompare(String(b.code), 'ru', { sensitivity: 'base' })),
    [families],
  );

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
    setEditDesc(family.name || '');
    setEditModelIds((family.vehicle_models || []).map((vm) => vm.id));
  };

  const saveEdit = (family) => {
    const code = editCode.trim();
    if (!code) return toast.error('Введите код');
    updateMut.mutate({
      id: family.id,
      payload: {
        code,
        name: editDesc.trim() || null,
        vehicle_model_ids: normalizeModelIds(editModelIds),
      },
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
      await Promise.all(updates.map(({ id, payload }) => categoryApi.update(id, payload)));
    },
    onSuccess: () => {
      toast.success('Настройки категорий сохранены');
      setMatrixDraft({});
      qc.invalidateQueries({ queryKey: ['categories'] });
      qc.invalidateQueries({ queryKey: ['categories', 'tree'] });
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось сохранить категории')),
  });

  const saveMatrix = () => {
    const updates = categoryMatrix
      .filter((row) => matrixDraft[row.id] != null && matrixDraft[row.id] !== row.engine_code_mode)
      .map((row) => {
        const cat = categoryTree.flatMap((g) => g.children || []).find((c) => c.id === row.id);
        const prof = resolveCategoryProfile(cat?.attribute_schema);
        const fields = schemaToEditorState(cat?.attribute_schema).fields;
        const ecm = matrixDraft[row.id];
        return {
          id: row.id,
          payload: {
            attribute_schema: fieldsToFullSchema(fields, prof.vehicle_mode === 'compatibility', cat?.attribute_schema?.form_layout, {
              vehicle_mode: prof.vehicle_mode,
              pricing_mode: prof.pricing_mode,
              engine_code_mode: ecm,
            }),
          },
        };
      });
    if (!updates.length) {
      toast('Нет изменений');
      return;
    }
    saveMatrixMut.mutate(updates);
  };

  const matrixDirty = categoryMatrix.some((row) => matrixDraft[row.id] != null && matrixDraft[row.id] !== row.engine_code_mode);

  return (
    <div className="settings-catalog-panel">
      <div className="settings-catalog-hero settings-catalog-hero--compact">
        <div className="settings-catalog-hero__text">
          <h2 className="settings-catalog-hero__title">Коды моторов</h2>
          <p className="settings-catalog-hero__desc">
            Справочник кодов двигателей (465Q, JL473ZQ7…). Сортировка A–Z. Можно привязать к моделям авто — необязательно.
          </p>
        </div>
      </div>

      <div className="settings-ios-add settings-ios-add--row">
        <input
          className="settings-ios-add__input"
          placeholder="Код мотора *"
          value={newCode}
          onChange={(e) => setNewCode(e.target.value)}
        />
        <input
          className="settings-ios-add__input"
          placeholder="Описание (необяз.)"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
        />
        <button
          type="button"
          className="ios-btn-primary settings-ios-add__btn"
          disabled={createMut.isPending}
          onClick={() => {
            const code = newCode.trim();
            if (!code) return toast.error('Введите код');
            createMut.mutate({ code, name: newDesc.trim() || null, is_active: true });
          }}
        >
          <FiPlus size={16} /> Добавить
        </button>
      </div>

      <input
        className="settings-ios-add__input engine-families-search"
        placeholder="Поиск по коду или описанию…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      {isLoading && <p className="settings-catalog-empty">Загрузка…</p>}

      {!isLoading && !sortedFamilies.length && (
        <div className="settings-catalog-empty">
          <span className="settings-catalog-empty__icon">⚙️</span>
          <p>Кодов пока нет</p>
          <span>Добавьте первый код в форме выше</span>
        </div>
      )}

      {sortedFamilies.length > 0 && (
        <div className="settings-ios-group engine-families-list">
          {sortedFamilies.map((family) => {
            const open = expandedId === family.id;
            const linked = family.vehicle_models || [];
            return (
              <div key={family.id} className={`settings-ios-brand${open ? ' settings-ios-brand--open' : ''}`}>
                <div className="settings-ios-row">
                  <button
                    type="button"
                    className="settings-ios-row__main"
                    onClick={() => (open ? setExpandedId(null) : openEdit(family))}
                  >
                    <span className="settings-ios-row__text">
                      <span className="settings-ios-row__title engine-family-code">{family.code}</span>
                      <span className="settings-ios-row__meta">
                        {family.name ? `${family.name} · ` : ''}
                        {family.product_count || 0} {pluralProducts(family.product_count || 0)}
                        {linked.length ? ` · ${linked.length} мод.` : ''}
                        {!family.is_active ? ' · неактивен' : ''}
                      </span>
                    </span>
                    {open ? <FiChevronUp size={17} className="settings-ios-row__chevron" /> : <FiChevronDown size={17} className="settings-ios-row__chevron" />}
                  </button>
                </div>

                {open && (
                  <div className="settings-ios-brand__body">
                    <input
                      className="settings-ios-add__input"
                      placeholder="Код"
                      value={editCode}
                      onChange={(e) => setEditCode(e.target.value)}
                    />
                    <textarea
                      className="settings-ios-add__input engine-family-desc"
                      rows={2}
                      placeholder="Описание (объём, топливо, производитель — необязательно)"
                      value={editDesc}
                      onChange={(e) => setEditDesc(e.target.value)}
                    />

                    <div className="engine-family-models-block">
                      <div className="settings-field-editor__title">Модели авто (необязательно)</div>
                      <p className="product-form-field-hint">Подсказка в форме товара: коды, привязанные к модели, показываются первыми.</p>
                      {modelsByBrand.map(([brandId, group]) => (
                        <div key={brandId} className="engine-family-brand-group">
                          <div className="engine-family-brand-group__title">{group.brandName}</div>
                          <div className="settings-ios-chips">
                            {group.models.map((m) => {
                              const on = editModelIds.includes(m.id);
                              return (
                                <button
                                  key={m.id}
                                  type="button"
                                  className={`settings-ios-chip${on ? ' settings-ios-chip--active' : ''}`}
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

                    <div className="engine-family-actions">
                      <button
                        type="button"
                        className="ios-btn-primary"
                        disabled={updateMut.isPending}
                        onClick={() => saveEdit(family)}
                      >
                        <FiCheck size={16} /> Сохранить
                      </button>
                      <button
                        type="button"
                        className="ios-btn-secondary"
                        disabled={updateMut.isPending}
                        onClick={() => updateMut.mutate({
                          id: family.id,
                          payload: { is_active: !family.is_active },
                        })}
                      >
                        {family.is_active ? 'Деактивировать' : 'Активировать'}
                      </button>
                      <button
                        type="button"
                        className="ios-btn-destructive"
                        disabled={deleteMut.isPending || (family.product_count || 0) > 0}
                        title={(family.product_count || 0) > 0 ? 'Код используется в товарах' : 'Удалить'}
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
              </div>
            );
          })}
        </div>
      )}

      <div className="engine-category-matrix">
        <div className="settings-field-editor__title">Где показывать код мотора</div>
        <p className="product-form-field-hint">
          Быстрый обзор подкатегорий. «Обязателен» — в форме товара можно выбрать несколько кодов.
        </p>
        {categoryMatrix.length > 0 && (
          <>
            <div className="engine-category-matrix__table">
              <div className="engine-category-matrix__head">
                <span>Группа</span>
                <span>Подкатегория</span>
                <span>Код мотора</span>
              </div>
              {categoryMatrix.map((row) => (
                <div key={row.id} className="engine-category-matrix__row">
                  <span className="engine-category-matrix__group">{row.groupName}</span>
                  <span>{row.name}</span>
                  <select
                    className="settings-editor-select engine-category-matrix__select"
                    value={matrixMode(row.id, row.engine_code_mode)}
                    onChange={(e) => setMatrixMode(row.id, e.target.value)}
                  >
                    <option value="none">Не нужен</option>
                    <option value="required">Обязателен</option>
                  </select>
                </div>
              ))}
            </div>
            {matrixDirty && (
              <button
                type="button"
                className="ios-btn-primary engine-category-matrix__save"
                disabled={saveMatrixMut.isPending}
                onClick={saveMatrix}
              >
                Сохранить настройки категорий
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

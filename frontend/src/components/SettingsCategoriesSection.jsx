import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FiChevronLeft, FiChevronRight, FiPlus, FiTrash2, FiEdit2, FiLayout, FiX, FiDownload } from 'react-icons/fi';
import { categoryApi, getApiErrorMessage } from '../api/client';
import CategoryFormLayoutEditor from './CategoryFormLayoutEditor';
import { fieldsToFullSchema, slugFieldKey, resolveCategoryProfile } from '../utils/formLayoutUtils';

const emptyField = () => ({
  key: '',
  label: '',
  type: 'text',
  options: '',
  unit: '',
  required: false,
  use_in_name: false,
  placeholder: '',
  width: 'full',
});

function schemaToFields(schema) {
  const fields = schema?.fields || [];
  return fields.map((f) => ({
    key: f.key || '',
    label: f.label || '',
    type: f.type || 'text',
    options: Array.isArray(f.options) ? f.options.join(', ') : '',
    unit: f.unit || '',
    required: Boolean(f.required),
    use_in_name: Boolean(f.use_in_name),
    placeholder: f.placeholder || '',
    width: f.width === 'half' ? 'half' : 'full',
  }));
}

function fieldCount(schema) {
  if (!schema) return 0;
  const fields = schema.fields || schema;
  return Array.isArray(fields) ? fields.length : 0;
}

function pluralCategories(n) {
  const m = n % 10;
  const m2 = n % 100;
  if (m2 >= 11 && m2 <= 14) return 'категорий';
  if (m === 1) return 'категория';
  if (m >= 2 && m <= 4) return 'категории';
  return 'категорий';
}

function pluralFields(n) {
  const m = n % 10;
  const m2 = n % 100;
  if (m2 >= 11 && m2 <= 14) return 'полей';
  if (m === 1) return 'поле';
  if (m >= 2 && m <= 4) return 'поля';
  return 'полей';
}

function findSimilarSubcategories(name, tree, excludeId = null) {
  const n = String(name || '').trim().toLowerCase();
  if (!n) return [];
  const out = [];
  (tree || []).forEach((g) => {
    (g.children || []).forEach((c) => {
      if (excludeId && c.id === excludeId) return;
      const cn = String(c.name || '').trim().toLowerCase();
      if (!cn) return;
      if (cn === n || cn.includes(n) || n.includes(cn)) {
        out.push(`${g.name} → ${c.name}`);
      }
    });
  });
  return [...new Set(out)];
}

function CategoryTemplatePreview({ form }) {
  const vm = form?.vehicle_mode || 'none';
  const ecm = form?.engine_code_mode || 'none';
  const autoLabel = vm === 'compatibility'
    ? 'Пикер марок и моделей'
    : vm === 'brand_model'
      ? 'Поля марка / модель'
      : 'Без привязки к авто';
  const engineLabel = ecm === 'required' ? 'Код мотора (несколько)' : null;
  const fields = (form?.fields || []).filter((f) => f?.label?.trim());
  return (
    <div className="settings-category-template-preview">
      <div className="settings-category-template-preview__title">Превью формы кладовщика</div>
      <ul className="settings-category-template-preview__list">
        <li>Название товара</li>
        <li>{autoLabel}</li>
        {engineLabel ? <li>{engineLabel} *</li> : null}
        {fields.map((f, i) => (
          <li key={f.key || i}>
            {f.label}
            {f.required ? ' *' : ''}
            {f.type === 'chip' && f.options ? ` (${String(f.options).split(',').slice(0, 3).join(', ')}…)` : ''}
          </li>
        ))}
        <li>Артикул, цены, количество</li>
      </ul>
    </div>
  );
}

export default function SettingsCategoriesSection() {
  const qc = useQueryClient();
  const [drillGroupId, setDrillGroupId] = useState(null);
  const [groupForm, setGroupForm] = useState({ name: '', icon: '📦' });
  const [subForm, setSubForm] = useState(null);
  const [editTarget, setEditTarget] = useState(null);
  const [layoutEditor, setLayoutEditor] = useState(null);

  const { data: tree = [], isLoading } = useQuery({
    queryKey: ['categories', 'tree'],
    queryFn: () => categoryApi.getTree({ active_only: false }).then((r) => r.data),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['categories'] });
    qc.invalidateQueries({ queryKey: ['categories', 'tree'] });
  };

  const createMutation = useMutation({
    mutationFn: (payload) => categoryApi.create(payload),
    onSuccess: () => {
      toast.success('Сохранено');
      invalidate();
      setGroupForm({ name: '', icon: '📦' });
      setSubForm(null);
      setEditTarget(null);
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось сохранить')),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }) => categoryApi.update(id, payload),
    onSuccess: () => {
      toast.success('Обновлено');
      invalidate();
      setEditTarget(null);
      setSubForm(null);
      setLayoutEditor(null);
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось обновить')),
  });

  const deleteMutation = useMutation({
    mutationFn: (id) => categoryApi.delete(id),
    onSuccess: () => { toast.success('Удалено'); invalidate(); },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось удалить')),
  });

  const seedMutation = useMutation({
    mutationFn: () => categoryApi.seedDefaults(),
    onSuccess: (r) => {
      toast.success(`Каталог загружен (${r.data?.groups || 0} групп)`);
      invalidate();
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось загрузить каталог')),
  });

  const groups = useMemo(() => (Array.isArray(tree) ? tree : []), [tree]);
  const drillGroup = drillGroupId != null ? groups.find((g) => g.id === drillGroupId) : null;

  const startAddSub = (groupId) => {
    setSubForm({
      parent_id: groupId,
      name: '',
      icon: '⚙️',
      show_compatibility: true,
      vehicle_mode: 'compatibility',
      engine_code_mode: 'none',
      pricing_mode: 'import_cny',
      fields: [emptyField()],
    });
    setEditTarget(null);
    setLayoutEditor(null);
  };

  const startEditGroup = (g) => {
    setEditTarget({ type: 'group', id: g.id, name: g.name, icon: g.icon || '📦', is_active: g.is_active !== false });
    setSubForm(null);
    setLayoutEditor(null);
  };

  const startEditSub = (g, c) => {
    const prof = resolveCategoryProfile(c.attribute_schema);
    setEditTarget({
      type: 'sub',
      id: c.id,
      parent_id: g.id,
      name: c.name,
      icon: c.icon || '⚙️',
      is_active: c.is_active !== false,
      show_compatibility: prof.vehicle_mode === 'compatibility',
      vehicle_mode: prof.vehicle_mode,
      engine_code_mode: prof.engine_code_mode || 'none',
      pricing_mode: prof.pricing_mode,
      fields: schemaToFields(c.attribute_schema).length ? schemaToFields(c.attribute_schema) : [emptyField()],
    });
    setSubForm(null);
    setLayoutEditor(null);
  };

  const openLayoutEditor = (g, c) => {
    setLayoutEditor({ group: g, category: c });
    setEditTarget(null);
    setSubForm(null);
  };

  const saveGroup = () => {
    const name = groupForm.name.trim();
    if (!name) { toast.error('Введите название группы'); return; }
    createMutation.mutate({ name, icon: groupForm.icon || '📦', sort_order: groups.length * 100, is_active: true });
  };

  const saveSub = () => {
    const f = subForm || editTarget;
    if (!f?.name?.trim()) { toast.error('Введите название подкатегории'); return; }
    const vm = f.vehicle_mode || 'none';
    const ecm = f.engine_code_mode || 'none';
    const payload = {
      name: f.name.trim(),
      icon: f.icon || '⚙️',
      parent_id: f.parent_id,
      attribute_schema: fieldsToFullSchema(f.fields, vm === 'compatibility', null, {
        vehicle_mode: vm,
        pricing_mode: f.pricing_mode || 'import_cny',
        engine_code_mode: ecm,
      }),
      is_active: true,
    };
    if (editTarget?.type === 'sub') updateMutation.mutate({ id: editTarget.id, payload });
    else createMutation.mutate(payload);
  };

  const saveEdit = () => {
    if (!editTarget) return;
    if (editTarget.type === 'group') {
      updateMutation.mutate({
        id: editTarget.id,
        payload: { name: editTarget.name.trim(), icon: editTarget.icon, is_active: editTarget.is_active },
      });
      return;
    }
    const vm = editTarget.vehicle_mode || 'none';
    const ecm = editTarget.engine_code_mode || 'none';
    updateMutation.mutate({
      id: editTarget.id,
      payload: {
        name: editTarget.name.trim(),
        icon: editTarget.icon,
        is_active: editTarget.is_active,
        attribute_schema: fieldsToFullSchema(editTarget.fields, vm === 'compatibility', null, {
          vehicle_mode: vm,
          pricing_mode: editTarget.pricing_mode || 'import_cny',
          engine_code_mode: ecm,
        }),
      },
    });
  };

  const renderFieldEditor = (form, setForm) => (
    <div className="settings-field-editor">
      {/* Профиль категории */}
      <div className="settings-field-editor__title">Профиль категории</div>

      <div className="settings-profile-row">
        <span className="settings-profile-row__label">Закуп</span>
        <div className="settings-profile-chips">
          {[
            { value: 'import_cny', label: '¥ из Китая', sub: '¥ + доставка + закуп ₸' },
            { value: 'local_kzt', label: 'Локальный ₸', sub: 'только цена в тенге' },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`settings-profile-chip${(form.pricing_mode || 'import_cny') === opt.value ? ' settings-profile-chip--active' : ''}`}
              onClick={() => setForm({ ...form, pricing_mode: opt.value })}
            >
              <span className="settings-profile-chip__label">{opt.label}</span>
              <span className="settings-profile-chip__sub">{opt.sub}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-profile-row">
        <span className="settings-profile-row__label">Авто</span>
        <div className="settings-profile-chips">
          {[
            { value: 'none', label: 'Без привязки к авто', sub: 'масла, жидкости' },
            { value: 'brand_model', label: 'Марка + модель', sub: 'текстовый ввод' },
            { value: 'compatibility', label: 'Нужны марки авто', sub: 'полный пикер совместимости' },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`settings-profile-chip${(form.vehicle_mode || 'none') === opt.value ? ' settings-profile-chip--active' : ''}`}
              onClick={() => setForm({
                ...form,
                vehicle_mode: opt.value,
                show_compatibility: opt.value === 'compatibility',
              })}
            >
              <span className="settings-profile-chip__label">{opt.label}</span>
              <span className="settings-profile-chip__sub">{opt.sub}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-profile-row">
        <span className="settings-profile-row__label">Код мотора</span>
        <div className="settings-profile-chips">
          {[
            { value: 'none', label: 'Не нужен', sub: 'кузов, интерьер, оптика' },
            { value: 'required', label: 'Обязателен', sub: 'несколько кодов на товар' },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              className={`settings-profile-chip${(form.engine_code_mode || 'none') === opt.value ? ' settings-profile-chip--active' : ''}`}
              onClick={() => setForm({ ...form, engine_code_mode: opt.value })}
            >
              <span className="settings-profile-chip__label">{opt.label}</span>
              <span className="settings-profile-chip__sub">{opt.sub}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="settings-field-editor__title" style={{ marginTop: 16 }}>Поля характеристик</div>
      {(form.fields || []).map((field, idx) => (
        <div key={idx} className="settings-field-editor__card">
          <div className="settings-field-editor__card-head">
            <span>#{idx + 1}</span>
            <button
              type="button"
              className="product-field-minus"
              onClick={() => {
                const fields = [...form.fields];
                if (fields.length <= 1) { toast.error('Нужно хотя бы одно поле'); return; }
                fields.splice(idx, 1);
                setForm({ ...form, fields });
              }}
            >
              −
            </button>
          </div>
          <input
            className="settings-ios-add__input"
            placeholder="Название поля (Объём)"
            value={field.label}
            onChange={(e) => {
              const fields = [...form.fields];
              fields[idx] = { ...fields[idx], label: e.target.value, key: fields[idx].key || slugFieldKey(e.target.value) };
              setForm({ ...form, fields });
            }}
          />
          <select
            className="settings-ios-add__input settings-editor-select"
            value={field.type}
            onChange={(e) => {
              const fields = [...form.fields];
              fields[idx] = { ...fields[idx], type: e.target.value };
              setForm({ ...form, fields });
            }}
          >
            <option value="text">Текст</option>
            <option value="number">Число</option>
            <option value="select">Выбор</option>
            <option value="chip">Кнопки (chip)</option>
            <option value="textarea">Многострочный</option>
          </select>
          {(field.type === 'select' || field.type === 'chip') && (
            <input
              className="settings-ios-add__input"
              placeholder="Варианты: 1.1, 1.3, 1.5"
              value={field.options}
              onChange={(e) => {
                const fields = [...form.fields];
                fields[idx] = { ...fields[idx], options: e.target.value };
                setForm({ ...form, fields });
              }}
            />
          )}
          <input
            className="settings-ios-add__input"
            placeholder="Подсказка в поле"
            value={field.placeholder}
            onChange={(e) => {
              const fields = [...form.fields];
              fields[idx] = { ...fields[idx], placeholder: e.target.value };
              setForm({ ...form, fields });
            }}
          />
          <input
            className="settings-ios-add__input"
            placeholder="Единица (л, мм, А)"
            value={field.unit}
            onChange={(e) => {
              const fields = [...form.fields];
              fields[idx] = { ...fields[idx], unit: e.target.value };
              setForm({ ...form, fields });
            }}
          />
          <div className="settings-field-meta-checks">
            <label className="settings-field-editor__check">
              <input
                type="checkbox"
                checked={Boolean(field.required)}
                onChange={(e) => {
                  const fields = [...form.fields];
                  fields[idx] = { ...fields[idx], required: e.target.checked };
                  setForm({ ...form, fields });
                }}
              />
              Обязательное
            </label>
            <label className="settings-field-editor__check">
              <input
                type="checkbox"
                checked={Boolean(field.use_in_name)}
                onChange={(e) => {
                  const fields = [...form.fields];
                  fields[idx] = { ...fields[idx], use_in_name: e.target.checked };
                  setForm({ ...form, fields });
                }}
              />
              В название товара
            </label>
          </div>
        </div>
      ))}
      <button type="button" className="settings-editor-btn settings-editor-btn--ghost" onClick={() => setForm({ ...form, fields: [...(form.fields || []), emptyField()] })}>+ Добавить поле</button>
      <CategoryTemplatePreview form={form} />
    </div>
  );

  const closeEditor = () => {
    setSubForm(null);
    setEditTarget(null);
  };

  const editorOpen = Boolean(subForm || editTarget);

  const renderEditorPanel = () => {
    if (subForm) {
      return (
        <div className="settings-editor-panel" role="dialog" aria-modal="true">
          <div className="settings-editor-panel__head">
            <h3 className="settings-editor-panel__title">Новая подкатегория</h3>
            <button type="button" className="settings-editor-panel__close" onClick={closeEditor} aria-label="Закрыть">
              <FiX size={18} />
            </button>
          </div>
          <div className="settings-editor-panel__body">
            <div className="settings-editor-panel__row">
              <input className="settings-ios-add__icon" value={subForm.icon} onChange={(e) => setSubForm({ ...subForm, icon: e.target.value })} maxLength={4} aria-label="Иконка" />
              <input className="settings-ios-add__input" placeholder="Название подкатегории" value={subForm.name} onChange={(e) => setSubForm({ ...subForm, name: e.target.value })} />
            </div>
            {findSimilarSubcategories(subForm.name, groups).length > 0 && (
              <div className="settings-duplicate-warn">
                Похожая категория уже есть: {findSimilarSubcategories(subForm.name, groups).join('; ')}
              </div>
            )}
            {renderFieldEditor(subForm, setSubForm)}
          </div>
          <div className="settings-editor-panel__actions">
            <button type="button" className="settings-editor-btn settings-editor-btn--secondary" onClick={closeEditor}>Отмена</button>
            <button type="button" className="settings-editor-btn settings-editor-btn--primary" onClick={saveSub}>Сохранить</button>
          </div>
        </div>
      );
    }
    if (editTarget) {
      return (
        <div className="settings-editor-panel" role="dialog" aria-modal="true">
          <div className="settings-editor-panel__head">
            <h3 className="settings-editor-panel__title">
              {editTarget.type === 'group' ? 'Группа' : 'Подкатегория'}
            </h3>
            <button type="button" className="settings-editor-panel__close" onClick={closeEditor} aria-label="Закрыть">
              <FiX size={18} />
            </button>
          </div>
          <div className="settings-editor-panel__body">
            <div className="settings-editor-panel__row">
              <input className="settings-ios-add__icon" value={editTarget.icon} onChange={(e) => setEditTarget({ ...editTarget, icon: e.target.value })} maxLength={4} aria-label="Иконка" />
              <input className="settings-ios-add__input" placeholder="Название" value={editTarget.name} onChange={(e) => setEditTarget({ ...editTarget, name: e.target.value })} />
            </div>
            <label className="settings-field-editor__check">
              <input type="checkbox" checked={editTarget.is_active !== false} onChange={(e) => setEditTarget({ ...editTarget, is_active: e.target.checked })} />
              Активна (видна в формах)
            </label>
            {editTarget.type === 'sub' && findSimilarSubcategories(editTarget.name, groups, editTarget.id).length > 0 && (
              <div className="settings-duplicate-warn">
                Похожая категория уже есть: {findSimilarSubcategories(editTarget.name, groups, editTarget.id).join('; ')}
              </div>
            )}
            {editTarget.type === 'sub' && renderFieldEditor(editTarget, setEditTarget)}
          </div>
          <div className="settings-editor-panel__actions">
            <button type="button" className="settings-editor-btn settings-editor-btn--secondary" onClick={closeEditor}>Отмена</button>
            <button type="button" className="settings-editor-btn settings-editor-btn--primary" onClick={saveEdit}>Сохранить</button>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="settings-catalog-panel">
      {!drillGroup ? (
        <>
          <div className="settings-catalog-hero">
            <div className="settings-catalog-hero__text">
              <h2 className="settings-catalog-hero__title">Категории товаров</h2>
              <p className="settings-catalog-hero__desc">
                Группы и подкатегории. Для каждой подкатегории настройте карточку заполнения товара.
              </p>
            </div>
            <button
              type="button"
              className="settings-catalog-hero__btn"
              disabled={seedMutation.isPending}
              onClick={() => {
                if (window.confirm('Загрузить каталог автозапчастей? Существующие категории обновятся.')) {
                  seedMutation.mutate();
                }
              }}
            >
              <FiDownload size={16} />
              Загрузить каталог
            </button>
          </div>

          {!isLoading && groups.length > 0 && (
            <div className="settings-catalog-stats">
              <span>{groups.length} {groups.length === 1 ? 'группа' : groups.length < 5 ? 'группы' : 'групп'}</span>
              <span className="settings-catalog-stats__dot">·</span>
              <span>
                {groups.reduce((n, g) => n + (g.children || []).length, 0)} подкатегорий
              </span>
            </div>
          )}

          {isLoading && <p className="settings-catalog-empty">Загрузка…</p>}

          {!isLoading && !groups.length && (
            <div className="settings-catalog-empty">
              <span className="settings-catalog-empty__icon">📦</span>
              <p>Каталог пуст</p>
              <span>Загрузите готовый каталог автозапчастей или добавьте группу вручную</span>
            </div>
          )}

          {groups.length > 0 && (
          <div className="settings-ios-group">
            {groups.map((g) => {
              const subCount = (g.children || []).length;
              return (
                <div key={g.id} className="settings-ios-row">
                  <button
                    type="button"
                    className="settings-ios-row__main"
                    onClick={() => setDrillGroupId(g.id)}
                  >
                    <span className="settings-ios-row__icon settings-ios-row__icon--emoji">{g.icon || '📦'}</span>
                    <span className="settings-ios-row__text">
                      <span className="settings-ios-row__title">{g.name}</span>
                      <span className="settings-ios-row__meta">{subCount} {pluralCategories(subCount)}</span>
                    </span>
                  </button>
                  <div className="settings-ios-row__tools">
                    <button type="button" className="settings-ios-icon-btn" title="Редактировать" onClick={() => startEditGroup(g)}>
                      <FiEdit2 size={15} />
                    </button>
                    <button
                      type="button"
                      className="settings-ios-icon-btn settings-ios-icon-btn--danger"
                      title="Удалить"
                      onClick={() => { if (window.confirm(`Удалить группу «${g.name}»?`)) deleteMutation.mutate(g.id); }}
                    >
                      <FiTrash2 size={15} />
                    </button>
                    <FiChevronRight size={17} className="settings-ios-row__chevron settings-ios-row__chevron--trail" aria-hidden />
                  </div>
                </div>
              );
            })}
          </div>
          )}

          <div className="settings-ios-group settings-ios-group--add">
            <div className="settings-ios-add__label">Новая группа</div>
            <div className="settings-ios-add__row settings-ios-add__row--inline">
              <input
                className="settings-ios-add__icon"
                value={groupForm.icon}
                onChange={(e) => setGroupForm({ ...groupForm, icon: e.target.value })}
                maxLength={4}
                aria-label="Иконка"
              />
              <input
                className="settings-ios-add__input"
                placeholder="Название группы"
                value={groupForm.name}
                onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Enter') saveGroup(); }}
              />
              <button type="button" className="settings-ios-add__btn" disabled={createMutation.isPending} onClick={saveGroup} aria-label="Добавить">
                <FiPlus size={18} />
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="settings-catalog-drill">
            <button type="button" className="settings-catalog-drill__back" onClick={() => setDrillGroupId(null)}>
              <FiChevronLeft size={20} />
              Назад
            </button>
            <div className="settings-catalog-drill__head">
              <span className="settings-catalog-drill__emoji">{drillGroup.icon || '📦'}</span>
              <div>
                <h3 className="settings-catalog-drill__title">{drillGroup.name}</h3>
                <p className="settings-catalog-drill__meta">{(drillGroup.children || []).length} подкатегорий</p>
              </div>
              <button
                type="button"
                className="settings-catalog-drill__add"
                title="Добавить подкатегорию"
                onClick={() => startAddSub(drillGroup.id)}
              >
                <FiPlus size={18} />
              </button>
            </div>
          </div>

          <div className="settings-ios-group">
            {(drillGroup.children || []).map((c) => {
              const fc = fieldCount(c.attribute_schema);
              const letter = (c.name || '?').charAt(0).toUpperCase();
              return (
                <div key={c.id} className="settings-ios-row settings-ios-row--sub">
                  <div className="settings-ios-row__main settings-ios-row__main--static">
                    <span className="settings-ios-row__icon settings-ios-row__icon--letter">{letter}</span>
                    <span className="settings-ios-row__text">
                      <span className="settings-ios-row__title">{c.name}</span>
                      <span className="settings-ios-row__meta">
                        {fc} {pluralFields(fc)}
                        <span className="settings-ios-row__dot">·</span>
                        {c.has_form_layout ? 'карточка' : 'по умолчанию'}
                      </span>
                    </span>
                  </div>
                  <div className="settings-ios-row__tools">
                    <button type="button" className="settings-ios-icon-btn" title="Карточка" onClick={() => openLayoutEditor(drillGroup, c)}>
                      <FiLayout size={15} />
                    </button>
                    <button type="button" className="settings-ios-icon-btn" title="Редактировать" onClick={() => startEditSub(drillGroup, c)}>
                      <FiEdit2 size={15} />
                    </button>
                    <button
                      type="button"
                      className="settings-ios-icon-btn settings-ios-icon-btn--danger"
                      title="Удалить"
                      onClick={() => { if (window.confirm(`Удалить «${c.name}»?`)) deleteMutation.mutate(c.id); }}
                    >
                      <FiX size={15} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {editorOpen && (
        <div className="settings-editor-backdrop" role="presentation" onClick={closeEditor} />
      )}
      {renderEditorPanel()}

      {layoutEditor && (
        <CategoryFormLayoutEditor
          category={layoutEditor.category}
          groupName={layoutEditor.group?.name}
          saving={updateMutation.isPending}
          onClose={() => setLayoutEditor(null)}
          onSave={(attribute_schema) => {
            updateMutation.mutate({
              id: layoutEditor.category.id,
              payload: { attribute_schema },
            });
          }}
        />
      )}
    </div>
  );
}

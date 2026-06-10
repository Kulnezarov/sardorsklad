import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FiGrid, FiPlus, FiTrash2, FiEdit2, FiChevronDown, FiChevronRight, FiLayout } from 'react-icons/fi';
import { categoryApi, getApiErrorMessage } from '../api/client';
import CategoryFormLayoutEditor from './CategoryFormLayoutEditor';
import { fieldsToFullSchema, slugFieldKey } from '../utils/formLayoutUtils';

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

function schemaToFields(schema) {
  const fields = schema?.fields || [];
  return fields.map((f) => ({
    key: f.key || '',
    label: f.label || '',
    type: f.type || 'text',
    options: Array.isArray(f.options) ? f.options.join(', ') : '',
    unit: f.unit || '',
    required: Boolean(f.required),
    placeholder: f.placeholder || '',
    width: f.width === 'half' ? 'half' : 'full',
  }));
}

export default function SettingsCategoriesSection() {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState({});
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

  const startAddSub = (groupId) => {
    setSubForm({
      parent_id: groupId,
      name: '',
      icon: '⚙️',
      show_compatibility: false,
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
    setEditTarget({
      type: 'sub',
      id: c.id,
      parent_id: g.id,
      name: c.name,
      icon: c.icon || '⚙️',
      is_active: c.is_active !== false,
      show_compatibility: Boolean(c.attribute_schema?.show_compatibility),
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
    const payload = {
      name: f.name.trim(),
      icon: f.icon || '⚙️',
      parent_id: f.parent_id,
      attribute_schema: fieldsToFullSchema(f.fields, f.show_compatibility),
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
    updateMutation.mutate({
      id: editTarget.id,
      payload: {
        name: editTarget.name.trim(),
        icon: editTarget.icon,
        is_active: editTarget.is_active,
        attribute_schema: fieldsToFullSchema(editTarget.fields, editTarget.show_compatibility),
      },
    });
  };

  const renderFieldEditor = (form, setForm) => (
    <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
        <input
          type="checkbox"
          checked={form.show_compatibility}
          onChange={(e) => setForm({ ...form, show_compatibility: e.target.checked })}
        />
        Показывать «Совместим с авто» в форме товара
      </label>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Поля характеристик</div>
      {(form.fields || []).map((field, idx) => (
        <div key={idx} style={{ padding: 12, borderRadius: 12, border: '1px solid var(--border)', background: 'var(--ios-grouped-bg)', display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700 }}>#{idx + 1}</span>
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
            className="ios-input"
            placeholder="Название поля (Объём)"
            value={field.label}
            onChange={(e) => {
              const fields = [...form.fields];
              fields[idx] = { ...fields[idx], label: e.target.value, key: fields[idx].key || slugFieldKey(e.target.value) };
              setForm({ ...form, fields });
            }}
          />
          <select
            className="ios-input"
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
              className="ios-input"
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
            className="ios-input"
            placeholder="Подсказка в поле"
            value={field.placeholder}
            onChange={(e) => {
              const fields = [...form.fields];
              fields[idx] = { ...fields[idx], placeholder: e.target.value };
              setForm({ ...form, fields });
            }}
          />
          <input
            className="ios-input"
            placeholder="Единица (л, мм, А)"
            value={field.unit}
            onChange={(e) => {
              const fields = [...form.fields];
              fields[idx] = { ...fields[idx], unit: e.target.value };
              setForm({ ...form, fields });
            }}
          />
        </div>
      ))}
      <button type="button" className="catalog-chip" onClick={() => setForm({ ...form, fields: [...(form.fields || []), emptyField()] })}>+ Поле</button>
    </div>
  );

  return (
    <div className="settings-section">
      <div className="settings-section-title">
        <FiGrid size={16} /> Категории товаров
      </div>
      <div className="settings-section-body">
        <div className="ios-settings-block">
        <p className="ios-form-section-footer settings-categories-intro">
          Группы и подкатегории — на сервере. Карточку заполнения настраивайте для каждой подкатегории.
        </p>

        <button
          type="button"
          className="ios-btn-secondary"
          style={{ width: '100%', marginBottom: 4 }}
          disabled={seedMutation.isPending}
          onClick={() => {
            if (window.confirm('Загрузить каталог автозапчастей на сервер? Существующие категории обновятся.')) {
              seedMutation.mutate();
            }
          }}
        >
          Загрузить каталог автозапчастей
        </button>
        </div>

        {isLoading && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Загрузка…</div>}

        {!isLoading && groups.map((g) => {
          const open = expanded[g.id] !== false;
          const childCount = (g.children || []).length;
          return (
            <div key={g.id} className="settings-category-group">
              <div className="settings-category-group__head">
                <button type="button" onClick={() => setExpanded((e) => ({ ...e, [g.id]: !open }))} style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', color: 'var(--text-muted)' }}>
                  {open ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
                </button>
                <span style={{ fontSize: 20 }}>{g.icon || '📦'}</span>
                <strong style={{ flex: 1, fontSize: 14 }}>{g.name}</strong>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{childCount} подкат.</span>
                <button type="button" className="topbar-theme-toggle" title="Редактировать" onClick={() => startEditGroup(g)}><FiEdit2 size={14} /></button>
                <button type="button" className="topbar-theme-toggle" title="Удалить" onClick={() => { if (window.confirm(`Удалить группу «${g.name}»?`)) deleteMutation.mutate(g.id); }}><FiTrash2 size={14} /></button>
              </div>
              {open && (
                <div className="settings-category-group__body">
                  {(g.children || []).map((c) => (
                    <div key={c.id} className="settings-subcategory-row">
                      <div className="settings-subcategory-row__meta">
                        <div><span>{c.icon || '⚙️'} </span><span style={{ fontSize: 13 }}>{c.name}</span></div>
                        {c.has_form_layout ? (
                          <span className="settings-layout-badge settings-layout-badge--ok">Карточка настроена</span>
                        ) : (
                          <span className="settings-layout-badge settings-layout-badge--default">По умолчанию</span>
                        )}
                      </div>
                      <div className="settings-subcategory-row__actions">
                        <button type="button" className="catalog-chip catalog-chip-active" style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => openLayoutEditor(g, c)}>
                          <FiLayout size={12} /> Карточка
                        </button>
                        <button type="button" className="topbar-theme-toggle" onClick={() => startEditSub(g, c)}><FiEdit2 size={13} /></button>
                        <button type="button" className="topbar-theme-toggle" onClick={() => { if (window.confirm(`Удалить «${c.name}»?`)) deleteMutation.mutate(c.id); }}><FiTrash2 size={13} /></button>
                      </div>
                    </div>
                  ))}
                  <button type="button" className="catalog-chip" style={{ marginTop: 10 }} onClick={() => startAddSub(g.id)}>
                    <FiPlus size={13} /> Подкатегория
                  </button>
                </div>
              )}
            </div>
          );
        })}

        <div style={{ marginTop: 16, padding: 14, borderRadius: 14, border: '1px dashed var(--border)', background: 'var(--surface)' }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Добавить группу</div>
          <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr auto', gap: 8 }}>
            <input className="ios-input" value={groupForm.icon} onChange={(e) => setGroupForm({ ...groupForm, icon: e.target.value })} maxLength={4} />
            <input className="ios-input" placeholder="Название группы" value={groupForm.name} onChange={(e) => setGroupForm({ ...groupForm, name: e.target.value })} />
            <button type="button" className="catalog-chip catalog-chip-active" onClick={saveGroup} disabled={createMutation.isPending}><FiPlus size={14} /></button>
          </div>
        </div>

        {subForm && (
          <div style={{ marginTop: 16, padding: 14, borderRadius: 14, border: '1px solid var(--primary)', background: 'var(--primary-light)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Новая подкатегория</div>
            <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr', gap: 8, marginBottom: 8 }}>
              <input className="ios-input" value={subForm.icon} onChange={(e) => setSubForm({ ...subForm, icon: e.target.value })} />
              <input className="ios-input" placeholder="Название" value={subForm.name} onChange={(e) => setSubForm({ ...subForm, name: e.target.value })} />
            </div>
            {renderFieldEditor(subForm, setSubForm)}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="catalog-chip" onClick={() => setSubForm(null)}>Отмена</button>
              <button type="button" className="catalog-chip catalog-chip-active" onClick={saveSub}>Сохранить</button>
            </div>
          </div>
        )}

        {editTarget && (
          <div style={{ marginTop: 16, padding: 14, borderRadius: 14, border: '1px solid var(--border)', background: 'var(--ios-grouped-bg)' }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>Редактирование</div>
            <div style={{ display: 'grid', gridTemplateColumns: '56px 1fr', gap: 8, marginBottom: 8 }}>
              <input className="ios-input" value={editTarget.icon} onChange={(e) => setEditTarget({ ...editTarget, icon: e.target.value })} />
              <input className="ios-input" value={editTarget.name} onChange={(e) => setEditTarget({ ...editTarget, name: e.target.value })} />
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 8 }}>
              <input type="checkbox" checked={editTarget.is_active !== false} onChange={(e) => setEditTarget({ ...editTarget, is_active: e.target.checked })} />
              Активна (видна в формах)
            </label>
            {editTarget.type === 'sub' && renderFieldEditor(editTarget, setEditTarget)}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button type="button" className="catalog-chip" onClick={() => setEditTarget(null)}>Отмена</button>
              <button type="button" className="catalog-chip catalog-chip-active" onClick={saveEdit}>Сохранить</button>
            </div>
          </div>
        )}
      </div>

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

import React, { useMemo, useState } from 'react';
import { FiChevronLeft, FiChevronRight } from 'react-icons/fi';

/**
 * Drill-down выбор: список групп → внутрь группы → подкатегория.
 * (стиль iOS Settings / Apple списки)
 */
export default function CategoryPicker({
  tree = [],
  groupId = null,
  categoryId = null,
  onChange,
  disabled = false,
  legacyCategoryText = '',
}) {
  const groups = useMemo(() => (Array.isArray(tree) ? tree : []), [tree]);
  const selectedGroup = groups.find((g) => g.id === groupId) || null;
  const children = selectedGroup?.children || [];
  const selectedChild = children.find((c) => c.id === categoryId) || null;

  const [drillGroupId, setDrillGroupId] = useState(null);
  const drillGroup = drillGroupId != null ? groups.find((g) => g.id === drillGroupId) : null;

  const openGroup = (gid) => {
    if (disabled) return;
    setDrillGroupId(gid);
    onChange?.({ groupId: gid, categoryId: null });
  };

  const pickSubcategory = (gid, cid) => {
    if (disabled) return;
    onChange?.({ groupId: gid, categoryId: cid });
    setDrillGroupId(null);
  };

  const goBack = () => setDrillGroupId(null);

  if (drillGroup) {
    const subs = drillGroup.children || [];
    return (
      <div className="category-picker-drill">
        <button type="button" className="category-picker-drill__back" onClick={goBack} disabled={disabled}>
          <FiChevronLeft size={18} />
          <span>{drillGroup.name}</span>
        </button>
        <div className="ios-form-group category-picker-drill__list">
          {subs.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`category-picker-drill__row${categoryId === c.id ? ' category-picker-drill__row--active' : ''}`}
              disabled={disabled}
              onClick={() => pickSubcategory(drillGroup.id, c.id)}
            >
              <span className="category-picker-drill__row-icon">{c.icon || '⚙️'}</span>
              <span className="category-picker-drill__row-label">{c.name}</span>
              <FiChevronRight size={16} className="category-picker-drill__row-chevron" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="category-picker-drill">
      <div className="ios-form-group category-picker-drill__list">
        {groups.map((g) => {
          const subCount = (g.children || []).length;
          return (
            <button
              key={g.id}
              type="button"
              className={`category-picker-drill__row${groupId === g.id && categoryId ? ' category-picker-drill__row--active' : ''}`}
              disabled={disabled}
              onClick={() => openGroup(g.id)}
            >
              <span className="category-picker-drill__row-icon">{g.icon || '📦'}</span>
              <span className="category-picker-drill__row-label">
                <span>{g.name}</span>
                <small className="category-picker-drill__row-meta">{subCount} подкат.</small>
              </span>
              <FiChevronRight size={16} className="category-picker-drill__row-chevron" />
            </button>
          );
        })}
      </div>

      {!categoryId && legacyCategoryText && (
        <div className="product-form-legacy-banner">
          Старая категория: <strong>{legacyCategoryText}</strong> — выберите новую подкатегорию при обновлении
        </div>
      )}

      {selectedChild && selectedGroup && (
        <div className="product-form-template-badge">
          <span className="product-form-template-badge__label">Шаблон</span>
          <span className="product-form-template-badge__path">{selectedGroup.name} → {selectedChild.name}</span>
        </div>
      )}
    </div>
  );
}

export function findGroupIdForCategory(tree, categoryId) {
  if (!categoryId || !Array.isArray(tree)) return null;
  for (const g of tree) {
    if ((g.children || []).some((c) => c.id === categoryId)) return g.id;
  }
  return null;
}

export function findCategoryInTree(tree, categoryId) {
  if (!categoryId || !Array.isArray(tree)) return null;
  for (const g of tree) {
    const hit = (g.children || []).find((c) => c.id === categoryId);
    if (hit) return hit;
  }
  return null;
}

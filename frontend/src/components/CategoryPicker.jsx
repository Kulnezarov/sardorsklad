import React, { useMemo } from 'react';

/**
 * Двухшаговый выбор: группа → подкатегория.
 * value: { groupId, categoryId }
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

  const setGroup = (gid) => {
    onChange?.({ groupId: gid, categoryId: null });
  };

  const setCategory = (cid) => {
    onChange?.({ groupId, categoryId: cid });
  };

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <div>
        <span style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
          Группа категории
        </span>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 8 }}>
          {groups.map((g) => {
            const on = groupId === g.id;
            return (
              <button
                key={g.id}
                type="button"
                disabled={disabled}
                className={`catalog-chip ${on ? 'catalog-chip-active' : ''}`}
                onClick={() => setGroup(g.id)}
                style={{
                  padding: '12px 14px',
                  textAlign: 'left',
                  minHeight: 72,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 6,
                  borderRadius: 16,
                  background: on ? 'var(--primary-light)' : 'var(--ios-grouped-bg)',
                }}
              >
                <span style={{ fontSize: 22, lineHeight: 1 }}>{g.icon || '📦'}</span>
                <span style={{ fontSize: 12, fontWeight: 700, lineHeight: 1.3 }}>{g.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedGroup && (
        <div>
          <span style={{ display: 'block', marginBottom: 8, fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            Подкатегория (для поиска)
          </span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {children.map((c) => {
              const on = categoryId === c.id;
              return (
                <button
                  key={c.id}
                  type="button"
                  disabled={disabled}
                  className={`catalog-chip ${on ? 'catalog-chip-active' : ''}`}
                  onClick={() => setCategory(c.id)}
                  style={{ padding: '8px 14px', fontSize: 13 }}
                >
                  {c.icon ? `${c.icon} ` : ''}{c.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {!categoryId && legacyCategoryText && (
        <div style={{ padding: '10px 12px', borderRadius: 12, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', fontSize: 12, color: '#b45309' }}>
          Старая категория: <strong>{legacyCategoryText}</strong> — выберите новую подкатегорию при обновлении
        </div>
      )}

      {selectedChild && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          Выбрано: <strong style={{ color: 'var(--text)' }}>{selectedGroup.name} → {selectedChild.name}</strong>
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

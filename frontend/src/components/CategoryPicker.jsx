import React, { useMemo, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiSearch } from 'react-icons/fi';

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

function normalizeSearch(s) {
  return String(s || '').trim().toLowerCase();
}

/**
 * Drill-down: группы → подкатегории (как в макете «Новый товар»).
 * Поиск: плоский список «Группа → Подкатегория» с выбором в один тап.
 */
export default function CategoryPicker({
  tree = [],
  groupId = null,
  categoryId = null,
  onChange,
  disabled = false,
  legacyCategoryText = '',
  stepTitle = 'Выберите группу',
  stepCaption = 'Новый товар',
  className = '',
}) {
  const groups = useMemo(() => (Array.isArray(tree) ? tree : []), [tree]);
  const selectedGroup = groups.find((g) => g.id === groupId) || null;
  const children = selectedGroup?.children || [];
  const selectedChild = children.find((c) => c.id === categoryId) || null;

  const [drillGroupId, setDrillGroupId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const drillGroup = drillGroupId != null ? groups.find((g) => g.id === drillGroupId) : null;

  const flatRows = useMemo(() => {
    const rows = [];
    groups.forEach((g) => {
      (g.children || []).forEach((c) => {
        rows.push({
          groupId: g.id,
          groupName: g.name || '—',
          categoryId: c.id,
          categoryName: c.name || '—',
          schema: c.attribute_schema,
        });
      });
    });
    return rows.sort((a, b) =>
      `${a.groupName} ${a.categoryName}`.localeCompare(`${b.groupName} ${b.categoryName}`, 'ru'),
    );
  }, [groups]);

  const searchActive = normalizeSearch(searchQuery).length > 0;

  const searchResults = useMemo(() => {
    const q = normalizeSearch(searchQuery);
    if (!q) return [];
    return flatRows.filter((row) => {
      const hay = `${row.groupName} ${row.categoryName}`.toLowerCase();
      return hay.includes(q);
    });
  }, [flatRows, searchQuery]);

  const openGroup = (gid) => {
    if (disabled) return;
    setSearchQuery('');
    setDrillGroupId(gid);
    onChange?.({ groupId: gid, categoryId: null });
  };

  const pickSubcategory = (gid, cid) => {
    if (disabled) return;
    onChange?.({ groupId: gid, categoryId: cid });
    setDrillGroupId(null);
    setSearchQuery('');
  };

  const goBack = () => setDrillGroupId(null);

  if (drillGroup && !searchActive) {
    const subs = drillGroup.children || [];
    return (
      <div className={`catalog-picker catalog-picker--wizard catalog-picker--touch${className ? ` ${className}` : ''}`}>
        <div className="catalog-picker__header">
          <button type="button" className="catalog-picker__back-btn" onClick={goBack} disabled={disabled} aria-label="Назад">
            <FiChevronLeft size={22} />
          </button>
          <div className="catalog-picker__header-text">
            <span className="catalog-picker__caption">{drillGroup.name.toUpperCase()}</span>
            <h3 className="catalog-picker__title">Выберите категорию</h3>
          </div>
        </div>
        <div className="catalog-picker__cards">
          {subs.map((c) => {
            const fc = fieldCount(c.attribute_schema);
            const letter = (c.name || '?').charAt(0).toUpperCase();
            return (
              <button
                key={c.id}
                type="button"
                className={`catalog-picker__card${categoryId === c.id ? ' catalog-picker__card--active' : ''}`}
                disabled={disabled}
                onClick={() => pickSubcategory(drillGroup.id, c.id)}
              >
                <span className="catalog-picker__letter">{letter}</span>
                <span className="catalog-picker__card-body">
                  <strong>{c.name}</strong>
                  <small>{fc} {pluralFields(fc)}</small>
                </span>
                <FiChevronRight size={18} className="catalog-picker__chevron" />
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className={`catalog-picker catalog-picker--wizard catalog-picker--touch${className ? ` ${className}` : ''}`}>
      <div className="catalog-picker__header catalog-picker__header--static">
        <span className="catalog-picker__caption">{stepCaption}</span>
        <h3 className="catalog-picker__title">{stepTitle}</h3>
      </div>

      <div className="catalog-picker__search">
        <FiSearch className="catalog-picker__search-icon" size={17} aria-hidden />
        <input
          type="search"
          className="catalog-picker__search-input"
          placeholder="Поиск группы или категории…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          disabled={disabled}
          autoComplete="off"
          enterKeyHint="search"
        />
      </div>

      {searchActive ? (
        <div className="catalog-picker__cards catalog-picker__cards--search">
          {searchResults.length === 0 ? (
            <p className="catalog-picker__search-empty">Ничего не найдено</p>
          ) : (
            searchResults.map((row) => {
              const fc = fieldCount(row.schema);
              const letter = row.categoryName.charAt(0).toUpperCase();
              const isActive = categoryId === row.categoryId;
              return (
                <button
                  key={`${row.groupId}-${row.categoryId}`}
                  type="button"
                  className={`catalog-picker__card catalog-picker__card--search${isActive ? ' catalog-picker__card--active' : ''}`}
                  disabled={disabled}
                  onClick={() => pickSubcategory(row.groupId, row.categoryId)}
                >
                  <span className="catalog-picker__letter">{letter}</span>
                  <span className="catalog-picker__card-body">
                    <strong>{row.groupName} → {row.categoryName}</strong>
                    <small>{fc} {pluralFields(fc)}</small>
                  </span>
                  <FiChevronRight size={18} className="catalog-picker__chevron" />
                </button>
              );
            })
          )}
        </div>
      ) : (
        <div className="catalog-picker__cards">
          {groups.map((g) => {
            const subCount = (g.children || []).length;
            return (
              <button
                key={g.id}
                type="button"
                className={`catalog-picker__card catalog-picker__card--group${groupId === g.id && categoryId ? ' catalog-picker__card--active' : ''}`}
                disabled={disabled}
                onClick={() => openGroup(g.id)}
              >
                <span className="catalog-picker__emoji">{g.icon || '📦'}</span>
                <span className="catalog-picker__card-body">
                  <strong>{g.name}</strong>
                  <small>{subCount} {pluralCategories(subCount)}</small>
                </span>
                <FiChevronRight size={18} className="catalog-picker__chevron" />
              </button>
            );
          })}
        </div>
      )}

      {!categoryId && legacyCategoryText && (
        <div className="product-form-legacy-banner">
          Старая категория: <strong>{legacyCategoryText}</strong>
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

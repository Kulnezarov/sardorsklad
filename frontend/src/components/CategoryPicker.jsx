import React, { useMemo, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiSearch, FiX } from 'react-icons/fi';

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

function matchRank(name, q) {
  const n = normalizeSearch(name);
  if (!q || !n) return 99;
  if (n === q) return 0;
  if (n.startsWith(q)) return 1;
  if (n.includes(q)) return 2;
  return 99;
}

/**
 * Drill-down: группы → подкатегории.
 * Поиск всегда сверху: можно сразу выбрать категорию или открыть группу.
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
          type: 'category',
          groupId: g.id,
          groupName: g.name || '—',
          groupIcon: g.icon,
          categoryId: c.id,
          categoryName: c.name || '—',
          schema: c.attribute_schema,
        });
      });
    });
    return rows;
  }, [groups]);

  const searchActive = normalizeSearch(searchQuery).length > 0;

  const searchResults = useMemo(() => {
    const q = normalizeSearch(searchQuery);
    if (!q) return [];

    const groupHits = groups
      .filter((g) => matchRank(g.name, q) < 99)
      .map((g) => ({
        type: 'group',
        groupId: g.id,
        groupName: g.name || '—',
        groupIcon: g.icon,
        subCount: (g.children || []).length,
        rank: matchRank(g.name, q),
      }))
      .sort((a, b) => a.rank - b.rank || a.groupName.localeCompare(b.groupName, 'ru'));

    const categoryHits = flatRows
      .map((row) => {
        const catRank = matchRank(row.categoryName, q);
        const groupRank = matchRank(row.groupName, q);
        const rank = Math.min(catRank, groupRank === 0 || groupRank === 1 ? groupRank + 3 : groupRank);
        return { ...row, rank, catRank };
      })
      .filter((row) => row.rank < 99)
      .sort((a, b) =>
        a.catRank - b.catRank
        || a.rank - b.rank
        || `${a.groupName} ${a.categoryName}`.localeCompare(`${b.groupName} ${b.categoryName}`, 'ru'),
      );

    // Группы сверху, затем категории — можно сразу зайти куда нужно
    return [...groupHits, ...categoryHits];
  }, [groups, flatRows, searchQuery]);

  const openGroup = (gid) => {
    if (disabled) return;
    setDrillGroupId(gid);
    setSearchQuery('');
    onChange?.({ groupId: gid, categoryId: null });
  };

  const pickSubcategory = (gid, cid) => {
    if (disabled) return;
    onChange?.({ groupId: gid, categoryId: cid });
    setDrillGroupId(null);
    setSearchQuery('');
  };

  const goBack = () => {
    setDrillGroupId(null);
  };

  const clearSearch = () => setSearchQuery('');

  const applyFirstSearchHit = () => {
    if (disabled || !searchResults.length) return;
    const first = searchResults[0];
    if (first.type === 'group') openGroup(first.groupId);
    else pickSubcategory(first.groupId, first.categoryId);
  };

  const showGroupDrill = Boolean(drillGroup) && !searchActive;

  return (
    <div className={`catalog-picker catalog-picker--wizard catalog-picker--touch${className ? ` ${className}` : ''}`}>
      {showGroupDrill ? (
        <div className="catalog-picker__header">
          <button type="button" className="catalog-picker__back-btn" onClick={goBack} disabled={disabled} aria-label="Назад">
            <FiChevronLeft size={22} />
          </button>
          <div className="catalog-picker__header-text">
            <span className="catalog-picker__caption">{drillGroup.name.toUpperCase()}</span>
            <h3 className="catalog-picker__title">Выберите категорию</h3>
          </div>
        </div>
      ) : (
        <div className="catalog-picker__header catalog-picker__header--static">
          <span className="catalog-picker__caption">{stepCaption}</span>
          <h3 className="catalog-picker__title">{searchActive ? 'Результаты поиска' : stepTitle}</h3>
        </div>
      )}

      <div className="catalog-picker__search">
        <FiSearch className="catalog-picker__search-icon" size={17} aria-hidden />
        <input
          type="search"
          className="catalog-picker__search-input"
          placeholder="Найти и сразу выбрать…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              applyFirstSearchHit();
            }
          }}
          disabled={disabled}
          autoComplete="off"
          enterKeyHint="go"
        />
        {searchQuery ? (
          <button
            type="button"
            className="catalog-picker__search-clear"
            onClick={clearSearch}
            disabled={disabled}
            aria-label="Очистить поиск"
          >
            <FiX size={16} />
          </button>
        ) : null}
      </div>

      {searchActive ? (
        <div className="catalog-picker__cards catalog-picker__cards--search">
          {searchResults.length === 0 ? (
            <p className="catalog-picker__search-empty">Ничего не найдено</p>
          ) : (
            searchResults.map((row) => {
              if (row.type === 'group') {
                return (
                  <button
                    key={`group-${row.groupId}`}
                    type="button"
                    className="catalog-picker__card catalog-picker__card--search catalog-picker__card--group"
                    disabled={disabled}
                    onClick={() => openGroup(row.groupId)}
                  >
                    <span className="catalog-picker__emoji">{row.groupIcon || '📦'}</span>
                    <span className="catalog-picker__card-body">
                      <strong>{row.groupName}</strong>
                      <small>Открыть группу · {row.subCount} {pluralCategories(row.subCount)}</small>
                    </span>
                    <FiChevronRight size={18} className="catalog-picker__chevron" />
                  </button>
                );
              }

              const fc = fieldCount(row.schema);
              const letter = row.categoryName.charAt(0).toUpperCase();
              const isActive = categoryId === row.categoryId;
              return (
                <button
                  key={`cat-${row.groupId}-${row.categoryId}`}
                  type="button"
                  className={`catalog-picker__card catalog-picker__card--search${isActive ? ' catalog-picker__card--active' : ''}`}
                  disabled={disabled}
                  onClick={() => pickSubcategory(row.groupId, row.categoryId)}
                >
                  <span className="catalog-picker__letter">{letter}</span>
                  <span className="catalog-picker__card-body">
                    <strong>{row.categoryName}</strong>
                    <small>{row.groupName} · выбрать · {fc} {pluralFields(fc)}</small>
                  </span>
                  <FiChevronRight size={18} className="catalog-picker__chevron" />
                </button>
              );
            })
          )}
        </div>
      ) : showGroupDrill ? (
        <div className="catalog-picker__cards">
          {(drillGroup.children || []).map((c) => {
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

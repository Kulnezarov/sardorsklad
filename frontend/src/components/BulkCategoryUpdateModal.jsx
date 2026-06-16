import React, { useCallback, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation } from '@tanstack/react-query';
import { FiChevronRight, FiLayers } from 'react-icons/fi';
import { Button, Modal } from './ui';
import CategoryPicker, { findCategoryInTree } from './CategoryPicker';
import ProductFormByLayout from './ProductFormByLayout';
import VehicleCompatibilityPicker from './VehicleCompatibilityPicker';
import { productApi, getApiErrorMessage } from '../api/client';
import { resolveCategoryProfile } from '../utils/formLayoutUtils';

const EMPTY_COMPAT_IDS = [];

function legacyCategorySummary(products) {
  const counts = new Map();
  for (const p of products) {
    const key = (p.category || '').trim() || 'Без категории';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export default function BulkCategoryUpdateModal({
  isOpen,
  onClose,
  products = [],
  categoryTree = [],
  vehicleBrands = [],
  vehicleModels = [],
  onSuccess,
}) {
  const [step, setStep] = useState('category');
  const [groupId, setGroupId] = useState(null);
  const [categoryId, setCategoryId] = useState(null);
  const [attributes, setAttributes] = useState({});
  const [updateCompatibility, setUpdateCompatibility] = useState(false);
  const [compatIds, setCompatIds] = useState(EMPTY_COMPAT_IDS);
  const [compatPickerKey, setCompatPickerKey] = useState(0);

  const resetState = useCallback(() => {
    setStep('category');
    setGroupId(null);
    setCategoryId(null);
    setAttributes({});
    setUpdateCompatibility(false);
    setCompatIds(EMPTY_COMPAT_IDS);
    setCompatPickerKey((k) => k + 1);
  }, []);

  const handleClose = () => {
    resetState();
    onClose?.();
  };

  const legacyGroups = useMemo(() => legacyCategorySummary(products), [products]);

  const selectedSubcategory = useMemo(
    () => findCategoryInTree(categoryTree, categoryId),
    [categoryTree, categoryId],
  );

  const selectedCategoryGroup = useMemo(() => {
    if (groupId) return categoryTree.find((g) => g.id === groupId) || null;
    if (categoryId) {
      return categoryTree.find((g) => (g.children || []).some((c) => c.id === categoryId)) || null;
    }
    return null;
  }, [categoryTree, groupId, categoryId]);

  const schema = useMemo(() => {
    const raw = selectedSubcategory?.attribute_schema;
    if (!raw || typeof raw !== 'object') return null;
    const profile = resolveCategoryProfile(raw);
    return { ...raw, ...profile, show_compatibility: profile.vehicle_mode === 'compatibility' };
  }, [selectedSubcategory]);

  const showCompatibilityPicker = useMemo(() => {
    const vm = schema?.vehicle_mode;
    const liquidsGroup = /жидкост/i.test(selectedCategoryGroup?.name || '');
    return !liquidsGroup || vm !== 'none';
  }, [schema?.vehicle_mode, selectedCategoryGroup?.name]);

  const categoryPath = useMemo(() => {
    if (!selectedCategoryGroup || !selectedSubcategory) return '';
    return `${selectedCategoryGroup.name} → ${selectedSubcategory.name}`;
  }, [selectedCategoryGroup, selectedSubcategory]);

  const bulkMutation = useMutation({
    mutationFn: async () => {
      const ids = products.map((p) => p.id).filter(Boolean);
      const attrs = Object.fromEntries(
        Object.entries(attributes || {}).filter(([, v]) => v != null && String(v).trim() !== ''),
      );
      return productApi.bulkUpdateCategory({
        product_ids: ids,
        subcategory_id: categoryId,
        attributes: Object.keys(attrs).length ? attrs : undefined,
        compatibility_vehicle_model_ids: updateCompatibility ? compatIds : undefined,
        update_compatibility: updateCompatibility,
      });
    },
    onSuccess: (res) => {
      const n = res?.data?.updated ?? products.length;
      toast.success(`Категория обновлена: ${n} товар(ов)`);
      onSuccess?.();
      handleClose();
    },
    onError: (err) => toast.error(getApiErrorMessage(err, 'Не удалось обновить категорию')),
  });

  const handleCategoryChange = ({ groupId: gid, categoryId: cid }) => {
    setGroupId(gid);
    setCategoryId(cid || null);
    if (cid && cid !== categoryId) {
      setAttributes({});
      setCompatIds(EMPTY_COMPAT_IDS);
      setCompatPickerKey((k) => k + 1);
    }
  };

  const formData = useMemo(() => ({
    category_id: categoryId,
    category_group_id: groupId,
    attributes,
    compatibility_vehicle_model_ids: compatIds,
  }), [categoryId, groupId, attributes, compatIds]);

  const setFormData = useCallback((updater) => {
    const next = typeof updater === 'function' ? updater(formData) : updater;
    if (next.attributes) setAttributes(next.attributes);
    if (next.compatibility_vehicle_model_ids) setCompatIds(next.compatibility_vehicle_model_ids);
  }, [formData]);

  const compatibilitySlot = showCompatibilityPicker && updateCompatibility ? (
    <VehicleCompatibilityPicker
      key={`bulk-compat-${compatPickerKey}`}
      initialSelectedIds={EMPTY_COMPAT_IDS}
      brands={vehicleBrands}
      models={vehicleModels}
      onChange={setCompatIds}
    />
  ) : null;

  const actions = (() => {
    if (step === 'category') {
      return (
        <>
          <Button variant="secondary" onClick={handleClose}>Отмена</Button>
          <Button
            variant="primary"
            disabled={!categoryId}
            onClick={() => setStep('fill')}
          >
            Далее
            <FiChevronRight size={16} style={{ marginLeft: 4 }} />
          </Button>
        </>
      );
    }
    if (step === 'fill') {
      return (
        <>
          <Button variant="secondary" onClick={() => setStep('category')}>Назад</Button>
          <Button variant="primary" onClick={() => setStep('confirm')}>Далее</Button>
        </>
      );
    }
    return (
      <>
        <Button variant="secondary" onClick={() => setStep('fill')}>Назад</Button>
        <Button variant="primary" onClick={() => bulkMutation.mutate()} loading={bulkMutation.isPending}>
          Применить к {products.length}
        </Button>
      </>
    );
  })();

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title={`Массовое обновление категории (${products.length})`}
      icon={FiLayers}
      size={step === 'category' ? 'xl' : 'product'}
      actions={actions}
    >
      <div style={{ marginBottom: 14, padding: '12px 14px', borderRadius: 12, background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)' }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#b45309', marginBottom: 6 }}>
          Выбрано товаров: {products.length}
        </div>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Цены и остаток не изменятся. Заполните общие характеристики — они применятся ко всем выбранным позициям.
          {legacyGroups.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {legacyGroups.slice(0, 6).map(([name, count]) => (
                <span
                  key={name}
                  style={{
                    display: 'inline-flex',
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    background: 'var(--surface)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {name} · {count}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {step === 'category' && (
        <div className="product-wizard product-form-modal">
          <div className="product-wizard-steps" aria-label="Шаги">
            <div className="product-wizard-step product-wizard-step--active">
              <span className="product-wizard-step__num">1</span>
              <span className="product-wizard-step__label">Категория</span>
            </div>
            <div className="product-wizard-step__line" aria-hidden />
            <div className="product-wizard-step product-wizard-step--pending">
              <span className="product-wizard-step__num">2</span>
              <span className="product-wizard-step__label">Характеристики</span>
            </div>
            <div className="product-wizard-step__line" aria-hidden />
            <div className="product-wizard-step product-wizard-step--pending">
              <span className="product-wizard-step__num">3</span>
              <span className="product-wizard-step__label">Подтверждение</span>
            </div>
          </div>
          <div className="product-wizard-panel">
            <CategoryPicker
              tree={categoryTree}
              groupId={groupId}
              categoryId={categoryId}
              onChange={handleCategoryChange}
              stepCaption="Массовое обновление"
              stepTitle="Выберите новую категорию"
            />
            <p className="product-wizard-hint">
              Все выбранные товары получат одну подкатегорию. Старые текстовые категории будут заменены.
            </p>
          </div>
        </div>
      )}

      {step === 'fill' && (
        <div className="product-form-modal">
          <div className="product-wizard-steps product-wizard-steps--compact" aria-label="Шаги">
            <div className="product-wizard-step product-wizard-step--done">
              <span className="product-wizard-step__num">✓</span>
              <span className="product-wizard-step__label">Категория</span>
            </div>
            <div className="product-wizard-step__line product-wizard-step__line--done" aria-hidden />
            <div className="product-wizard-step product-wizard-step--active">
              <span className="product-wizard-step__num">2</span>
              <span className="product-wizard-step__label">Характеристики</span>
            </div>
            <div className="product-wizard-step__line" aria-hidden />
            <div className="product-wizard-step product-wizard-step--pending">
              <span className="product-wizard-step__num">3</span>
              <span className="product-wizard-step__label">Подтверждение</span>
            </div>
          </div>

          <div className="product-category-summary" style={{ marginBottom: 16 }}>
            <span className="product-category-summary__emoji">{selectedCategoryGroup?.icon || '📦'}</span>
            <div className="product-category-summary__text">
              <span className="product-category-summary__caption">Новая категория</span>
              <strong>{categoryPath}</strong>
            </div>
          </div>

          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-muted)' }}>
            Заполните общие поля. Пустые поля не перезапишут данные — их можно донастроить у каждого товара отдельно.
          </p>

          <ProductFormByLayout
            schema={schema || {}}
            formData={formData}
            onFormDataChange={setFormData}
            layoutSection="attributes"
            categoryName={selectedSubcategory?.name || ''}
            categoryGroupName={selectedCategoryGroup?.name || ''}
          />

          {showCompatibilityPicker && (
            <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)' }}>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={updateCompatibility}
                  onChange={(e) => {
                    setUpdateCompatibility(e.target.checked);
                    if (!e.target.checked) {
                      setCompatIds(EMPTY_COMPAT_IDS);
                      setCompatPickerKey((k) => k + 1);
                    }
                  }}
                  style={{ marginTop: 2 }}
                />
                <span>
                  <strong>Заменить совместимость у всех</strong>
                  <span style={{ display: 'block', color: 'var(--text-muted)', fontWeight: 400, marginTop: 4 }}>
                    Если выключено — у каждого товара останется своя марка и модель.
                  </span>
                </span>
              </label>
              {updateCompatibility && (
                <div style={{ marginTop: 12 }}>
                  {compatibilitySlot}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {step === 'confirm' && (
        <div style={{ display: 'grid', gap: 14 }}>
          <div className="product-wizard-steps product-wizard-steps--compact" aria-label="Шаги">
            <div className="product-wizard-step product-wizard-step--done">
              <span className="product-wizard-step__num">✓</span>
              <span className="product-wizard-step__label">Категория</span>
            </div>
            <div className="product-wizard-step__line product-wizard-step__line--done" aria-hidden />
            <div className="product-wizard-step product-wizard-step--done">
              <span className="product-wizard-step__num">✓</span>
              <span className="product-wizard-step__label">Характеристики</span>
            </div>
            <div className="product-wizard-step__line product-wizard-step__line--done" aria-hidden />
            <div className="product-wizard-step product-wizard-step--active">
              <span className="product-wizard-step__num">3</span>
              <span className="product-wizard-step__label">Подтверждение</span>
            </div>
          </div>

          <div style={{ padding: '14px 16px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--ios-grouped-bg)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Новая категория</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{categoryPath}</div>
          </div>

          <div style={{ padding: '14px 16px', borderRadius: 14, border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Товаров</div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{products.length}</div>
          </div>

          {Object.keys(attributes || {}).filter((k) => attributes[k] != null && String(attributes[k]).trim() !== '').length > 0 && (
            <div style={{ padding: '14px 16px', borderRadius: 14, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>Общие характеристики</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(attributes)
                  .filter(([, v]) => v != null && String(v).trim() !== '')
                  .map(([k, v]) => (
                    <span key={k} style={{ padding: '3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, background: 'var(--primary-light)', color: 'var(--primary)' }}>
                      {k}: {v}
                    </span>
                  ))}
              </div>
            </div>
          )}

          {updateCompatibility && (
            <div style={{ padding: '14px 16px', borderRadius: 14, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Совместимость</div>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                Будет заменена у всех ({compatIds.length} моделей)
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

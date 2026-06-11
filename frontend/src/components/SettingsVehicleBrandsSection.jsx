import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FiChevronDown, FiChevronUp, FiPlus, FiX } from 'react-icons/fi';
import { compatibilityApi, getApiErrorMessage } from '../api/client';

function pluralModels(n) {
  const m = n % 10;
  const m2 = n % 100;
  if (m2 >= 11 && m2 <= 14) return 'моделей';
  if (m === 1) return 'модель';
  if (m >= 2 && m <= 4) return 'модели';
  return 'моделей';
}

export default function SettingsVehicleBrandsSection() {
  const qc = useQueryClient();
  const [brandName, setBrandName] = useState('');
  const [expandedBrandId, setExpandedBrandId] = useState(null);
  const [modelDraft, setModelDraft] = useState({});

  const { data: brands = [], isLoading: brandsLoading } = useQuery({
    queryKey: ['compatibility', 'vehicle-brands', 'all'],
    queryFn: () => compatibilityApi.vehicleBrands({ include_inactive: true }).then((r) => r.data),
  });

  const { data: models = [], isLoading: modelsLoading } = useQuery({
    queryKey: ['compatibility', 'vehicle-models', 'all'],
    queryFn: () => compatibilityApi.vehicleModels({ include_inactive: true }).then((r) => r.data),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['compatibility', 'vehicle-brands'] });
    qc.invalidateQueries({ queryKey: ['compatibility', 'vehicle-models'] });
  };

  const createBrandMut = useMutation({
    mutationFn: (payload) => compatibilityApi.createVehicleBrand(payload),
    onSuccess: () => {
      toast.success('Марка добавлена');
      setBrandName('');
      invalidate();
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось добавить марку')),
  });

  const deleteBrandMut = useMutation({
    mutationFn: (id) => compatibilityApi.deleteVehicleBrand(id),
    onSuccess: () => {
      toast.success('Марка удалена');
      setExpandedBrandId(null);
      invalidate();
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось удалить марку')),
  });

  const createModelMut = useMutation({
    mutationFn: (payload) => compatibilityApi.createVehicleModel(payload),
    onSuccess: (_, vars) => {
      toast.success('Модель добавлена');
      setModelDraft((d) => ({ ...d, [vars.vehicle_brand_id]: '' }));
      invalidate();
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось добавить модель')),
  });

  const deleteModelMut = useMutation({
    mutationFn: (id) => compatibilityApi.deleteVehicleModel(id),
    onSuccess: () => {
      toast.success('Модель удалена');
      invalidate();
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось удалить модель')),
  });

  const modelsByBrand = useMemo(() => {
    const map = new Map();
    (models || []).forEach((m) => {
      const bid = m.vehicle_brand_id;
      if (!map.has(bid)) map.set(bid, []);
      map.get(bid).push(m);
    });
    map.forEach((list) => list.sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru')));
    return map;
  }, [models]);

  const sortedBrands = useMemo(
    () => [...(brands || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru')),
    [brands],
  );

  const loading = brandsLoading || modelsLoading;

  return (
    <div className="settings-catalog-panel">
      <div className="settings-catalog-hero settings-catalog-hero--compact">
        <div className="settings-catalog-hero__text">
          <h2 className="settings-catalog-hero__title">Марки и модели</h2>
          <p className="settings-catalog-hero__desc">
            Марки автомобилей и модели для совместимости запчастей.
          </p>
        </div>
      </div>

      {loading && <p className="settings-catalog-empty">Загрузка…</p>}

      {!loading && !sortedBrands.length && (
        <div className="settings-catalog-empty">
          <span className="settings-catalog-empty__icon">🚗</span>
          <p>Марок пока нет</p>
          <span>Добавьте первую марку в форме ниже</span>
        </div>
      )}

      {sortedBrands.length > 0 && (
      <div className="settings-ios-group">
        {sortedBrands.map((brand) => {
          const open = expandedBrandId === brand.id;
          const brandModels = modelsByBrand.get(brand.id) || [];
          const draft = modelDraft[brand.id] || '';

          return (
            <div key={brand.id} className={`settings-ios-brand${open ? ' settings-ios-brand--open' : ''}`}>
              <div className="settings-ios-row">
                <button
                  type="button"
                  className="settings-ios-row__main"
                  onClick={() => setExpandedBrandId(open ? null : brand.id)}
                >
                  <span className="settings-ios-row__text">
                    <span className="settings-ios-row__title">{brand.name}</span>
                    <span className="settings-ios-row__meta">{brandModels.length} {pluralModels(brandModels.length)}</span>
                  </span>
                  {open ? <FiChevronUp size={17} className="settings-ios-row__chevron" /> : <FiChevronDown size={17} className="settings-ios-row__chevron" />}
                </button>
                <button
                  type="button"
                  className="settings-ios-icon-btn settings-ios-icon-btn--danger"
                  title="Удалить марку"
                  onClick={() => {
                    if (window.confirm(`Удалить марку «${brand.name}» и все модели?`)) {
                      deleteBrandMut.mutate(brand.id);
                    }
                  }}
                >
                  <FiX size={15} />
                </button>
              </div>

              {open && (
                <div className="settings-ios-brand__body">
                  <div className="settings-ios-chips">
                    {brandModels.map((m) => (
                      <span key={m.id} className="settings-ios-chip">
                        {m.name}
                        <button
                          type="button"
                          className="settings-ios-chip__x"
                          aria-label={`Удалить ${m.name}`}
                          onClick={() => deleteModelMut.mutate(m.id)}
                        >
                          <FiX size={11} />
                        </button>
                      </span>
                    ))}
                    {!brandModels.length && (
                      <span className="settings-ios-brand__empty">Нет моделей</span>
                    )}
                  </div>
                  <div className="settings-ios-add__row settings-ios-add__row--nested">
                    <input
                      className="settings-ios-add__input"
                      value={draft}
                      onChange={(e) => setModelDraft((d) => ({ ...d, [brand.id]: e.target.value }))}
                      placeholder="Новая модель"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const name = draft.trim();
                          if (name) createModelMut.mutate({ vehicle_brand_id: brand.id, name, is_active: true });
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="settings-ios-add__btn"
                      disabled={createModelMut.isPending}
                      aria-label="Добавить модель"
                      onClick={() => {
                        const name = draft.trim();
                        if (!name) return toast.error('Введите модель');
                        createModelMut.mutate({ vehicle_brand_id: brand.id, name, is_active: true });
                      }}
                    >
                      <FiPlus size={18} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}

      <div className="settings-ios-group settings-ios-group--add">
        <div className="settings-ios-add__label">Новая марка</div>
        <div className="settings-ios-add__row settings-ios-add__row--inline">
          <input
            className="settings-ios-add__input"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder="Название марки"
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const name = brandName.trim();
                if (name) createBrandMut.mutate({ name, is_active: true });
              }
            }}
          />
          <button
            type="button"
            className="settings-ios-add__btn"
            disabled={createBrandMut.isPending}
            aria-label="Добавить марку"
            onClick={() => {
              const name = brandName.trim();
              if (!name) return toast.error('Введите марку');
              createBrandMut.mutate({ name, is_active: true });
            }}
          >
            <FiPlus size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}

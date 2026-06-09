import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FiPlus, FiTrash2, FiTruck } from 'react-icons/fi';
import { compatibilityApi, getApiErrorMessage } from '../api/client';

export default function SettingsVehicleBrandsSection() {
  const qc = useQueryClient();
  const [brandName, setBrandName] = useState('');
  const [expandedBrandId, setExpandedBrandId] = useState(null);
  const [modelName, setModelName] = useState('');

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
      if (expandedBrandId) setExpandedBrandId(null);
      invalidate();
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось удалить марку')),
  });

  const createModelMut = useMutation({
    mutationFn: (payload) => compatibilityApi.createVehicleModel(payload),
    onSuccess: () => {
      toast.success('Модель добавлена');
      setModelName('');
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
    return map;
  }, [models]);

  const sortedBrands = useMemo(
    () => [...(brands || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru')),
    [brands],
  );

  return (
    <div className="settings-section vehicle-brands-settings">
      <div className="settings-section-title">
        <FiTruck size={16} /> Марки и модели авто
      </div>
      <div className="settings-section-body">
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 0, lineHeight: 1.5 }}>
          Справочник для выбора совместимости в карточке товара и на сайте CHPARTS. Например: Changan → CS55, CS75.
        </p>

        <div className="compat-add-code">
          <input
            className="compat-input compat-input-grow"
            value={brandName}
            onChange={(e) => setBrandName(e.target.value)}
            placeholder="Новая марка, напр. Changan"
          />
          <button
            type="button"
            className="compat-btn-primary"
            disabled={createBrandMut.isPending}
            onClick={() => {
              const name = brandName.trim();
              if (!name) return toast.error('Введите марку');
              createBrandMut.mutate({ name, is_active: true });
            }}
          >
            <FiPlus size={15} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Марка
          </button>
        </div>

        {(brandsLoading || modelsLoading) && (
          <div className="compat-muted" style={{ marginTop: 12 }}>Загрузка…</div>
        )}

        <div className="vehicle-settings-list" style={{ marginTop: 14 }}>
          {sortedBrands.map((brand) => {
            const open = expandedBrandId === brand.id;
            const brandModels = modelsByBrand.get(brand.id) || [];
            return (
              <div key={brand.id} className="compat-accordion">
                <button
                  type="button"
                  className="compat-accordion-head"
                  onClick={() => setExpandedBrandId(open ? null : brand.id)}
                >
                  <span className="compat-code-label">{brand.name}</span>
                  <span className="compat-code-sub">{brandModels.length} мод.</span>
                </button>
                <button
                  type="button"
                  className="compat-icon-del"
                  title="Удалить марку"
                  onClick={() => {
                    if (window.confirm(`Удалить марку «${brand.name}» и все модели?`)) {
                      deleteBrandMut.mutate(brand.id);
                    }
                  }}
                >
                  <FiTrash2 size={14} />
                </button>
                {open && (
                  <div style={{ padding: '8px 12px 12px', borderTop: '1px solid var(--border)' }}>
                    <div className="compat-add-code" style={{ marginBottom: 10 }}>
                      <input
                        className="compat-input compat-input-grow"
                        value={modelName}
                        onChange={(e) => setModelName(e.target.value)}
                        placeholder={`Модель для ${brand.name}, напр. CS55`}
                      />
                      <button
                        type="button"
                        className="compat-btn-primary"
                        disabled={createModelMut.isPending}
                        onClick={() => {
                          const name = modelName.trim();
                          if (!name) return toast.error('Введите модель');
                          createModelMut.mutate({
                            vehicle_brand_id: brand.id,
                            name,
                            is_active: true,
                          });
                        }}
                      >
                        <FiPlus size={14} /> Модель
                      </button>
                    </div>
                    <ul className="compat-model-list">
                      {brandModels.map((m) => (
                        <li key={m.id} className="compat-model-line">
                          <span>{m.name}</span>
                          <button
                            type="button"
                            className="compat-icon-del"
                            onClick={() => deleteModelMut.mutate(m.id)}
                          >
                            <FiTrash2 size={14} />
                          </button>
                        </li>
                      ))}
                      {!brandModels.length && (
                        <li className="compat-muted">Нет моделей</li>
                      )}
                    </ul>
                  </div>
                )}
              </div>
            );
          })}
          {!sortedBrands.length && !brandsLoading && (
            <div className="compat-muted">Пока нет марок — добавьте первую выше</div>
          )}
        </div>
      </div>
    </div>
  );
}

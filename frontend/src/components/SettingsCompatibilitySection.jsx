import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FiBox, FiChevronDown, FiChevronRight, FiPlus, FiTrash2 } from 'react-icons/fi';
import { compatibilityApi } from '../api/client';

/**
 * Иерархия: сначала заводим код (465, 474) → раскрытие кода → марки и модели
 * → «Добавить марку» в справочник, «Добавить авто в код» = марка + модель, привязка к коду.
 */
function SettingsCompatibilitySection() {
  const qc = useQueryClient();
  const [newCode, setNewCode] = useState('');
  const [newCodeName, setNewCodeName] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [newBrandName, setNewBrandName] = useState('');
  const [linkBrandId, setLinkBrandId] = useState('');
  const [linkModelName, setLinkModelName] = useState('');

  const { data: vehBrands = [], refetch: refetchVehBrands } = useQuery({
    queryKey: ['compatibility', 'vehicle-brands'],
    queryFn: () => compatibilityApi.vehicleBrands().then((r) => r.data),
  });
  const { data: engFamilies = [], refetch: refetchEng } = useQuery({
    queryKey: ['compatibility', 'engine-families'],
    queryFn: () => compatibilityApi.engineFamilies().then((r) => r.data),
  });
  const { data: detail, isFetching: detailLoading } = useQuery({
    queryKey: ['compatibility', 'engine-family', expandedId],
    queryFn: () => compatibilityApi.getEngineFamily(expandedId).then((r) => r.data),
    enabled: expandedId != null,
  });

  const byBrand = useMemo(() => {
    const vms = detail?.vehicle_models || [];
    const map = new Map();
    for (const vm of vms) {
      const bid = vm.vehicle_brand_id;
      if (!map.has(bid)) map.set(bid, { brand: vm.brand, models: [] });
      map.get(bid).models.push(vm);
    }
    for (const [, g] of map) {
      g.models.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
    }
    return map;
  }, [detail]);

  const addEf = useMutation({
    mutationFn: (body) => compatibilityApi.createEngineFamily(body),
    onSuccess: () => {
      toast.success('Код добавлен');
      setNewCode('');
      setNewCodeName('');
      refetchEng();
      qc.invalidateQueries({ queryKey: ['compatibility'] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || 'Не удалось'),
  });
  const addVb = useMutation({
    mutationFn: (name) => compatibilityApi.createVehicleBrand({ name, is_active: true }),
    onSuccess: () => {
      toast.success('Марка в справочнике');
      setNewBrandName('');
      refetchVehBrands();
      qc.invalidateQueries({ queryKey: ['compatibility'] });
    },
    onError: () => toast.error('Не удалось'),
  });
  const addVmAndLink = useMutation({
    mutationFn: async ({ efId, brandId, name }) => {
      const { data: created } = await compatibilityApi.createVehicleModel({
        vehicle_brand_id: brandId,
        name,
        is_active: true,
      });
      const cur = await compatibilityApi.getEngineFamily(efId).then((r) => r.data);
      const ids = [...(cur.vehicle_models || []).map((m) => m.id), created.id].filter(
        (v, i, a) => a.indexOf(v) === i,
      );
      await compatibilityApi.updateEngineFamily(efId, { vehicle_model_ids: ids });
    },
    onSuccess: (_, v) => {
      toast.success('Модель привязана к коду');
      setLinkModelName('');
      setLinkBrandId(String(v.brandId));
      qc.invalidateQueries({ queryKey: ['compatibility', 'engine-family', v.efId] });
      qc.invalidateQueries({ queryKey: ['compatibility', 'vehicle-models'] });
      qc.invalidateQueries({ queryKey: ['compatibility'] });
    },
    onError: (e) => toast.error(e?.response?.data?.detail || 'Ошибка'),
  });
  const removeModelFromCode = useMutation({
    mutationFn: async ({ efId, modelId, allIds }) => {
      const next = allIds.filter((id) => id !== modelId);
      await compatibilityApi.updateEngineFamily(efId, { vehicle_model_ids: next });
    },
    onSuccess: (_, v) => {
      toast.success('Связь снята');
      qc.invalidateQueries({ queryKey: ['compatibility', 'engine-family', v.efId] });
      qc.invalidateQueries({ queryKey: ['compatibility'] });
    },
    onError: () => toast.error('Не удалось'),
  });

  const allIds = (detail?.vehicle_models || []).map((m) => m.id);

  return (
    <div className="settings-section">
      <div className="settings-section-title">
        <FiBox size={16} /> Совместимость (код → марка → модель)
      </div>
      <div className="settings-section-body">
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>
          Сначала добавьте <strong>код</strong> (465, 474). Нажмите на строку — откроются привязанные марки/модели. Марку
          в справочник, затем модель в этот код.
        </div>
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            alignItems: 'center',
            marginBottom: 14,
            padding: 10,
            borderRadius: 12,
            background: 'var(--ios-grouped-bg)',
            border: '1px solid var(--border)',
          }}
        >
          <input
            value={newCode}
            onChange={(e) => setNewCode(e.target.value.replace(/\s+/g, ''))}
            placeholder="Код, напр. 465"
            style={{ width: 100, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)' }}
          />
          <input
            value={newCodeName}
            onChange={(e) => setNewCodeName(e.target.value)}
            placeholder="Название (опц.)"
            style={{ flex: 1, minWidth: 120, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)' }}
          />
          <button
            type="button"
            onClick={() => {
              const c = (newCode || '').trim();
              if (!c) { toast.error('Введите код'); return; }
              addEf.mutate({ code: c, name: newCodeName.trim() || null, is_active: true, vehicle_model_ids: null });
            }}
            disabled={addEf.isPending}
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              fontWeight: 700,
              border: '1px solid var(--primary)',
              background: 'var(--primary-light)',
              color: 'var(--primary)',
            }}
          >
            <FiPlus size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Код
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {engFamilies.length === 0 && <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Пока нет кодов</div>}
          {engFamilies
            .slice()
            .sort((a, b) => String(a.code).localeCompare(String(b.code), 'ru', { numeric: true }))
            .map((f) => {
              const open = expandedId === f.id;
              return (
                <div
                  key={f.id}
                  style={{
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    background: 'var(--surface)',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setExpandedId((id) => (id === f.id ? null : f.id))}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '10px 12px',
                      border: 'none',
                      background: open ? 'var(--ios-grouped-bg)' : 'var(--surface)',
                      cursor: 'pointer',
                      textAlign: 'left',
                    }}
                  >
                    {open ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
                    <b style={{ fontSize: 14 }}>{f.code}</b>
                    {f.name && <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{f.name}</span>}
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>раскрыть</span>
                  </button>
                  {open && (
                    <div style={{ padding: '0 12px 12px 36px' }}>
                      {detailLoading && <div style={{ fontSize: 12 }}>Загрузка…</div>}
                      {!detailLoading && (
                        <>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: 'var(--text-muted)',
                              margin: '6px 0 8px',
                            }}
                          >
                            Марка в справочник
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                            <input
                              value={newBrandName}
                              onChange={(e) => setNewBrandName(e.target.value)}
                              placeholder="Новая марка (Changan…)"
                              style={{ flex: 1, minWidth: 160, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)' }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (!newBrandName.trim()) { toast.error('Введите марку'); return; }
                                addVb.mutate(newBrandName.trim());
                              }}
                              disabled={addVb.isPending}
                            >
                              Добавить марку
                            </button>
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: 'var(--text-muted)',
                              margin: '6px 0 6px',
                            }}
                          >
                            Добавить авто в код {f.code}
                          </div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
                            <select
                              value={linkBrandId}
                              onChange={(e) => setLinkBrandId(e.target.value)}
                              style={{ minWidth: 150, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)' }}
                            >
                              <option value="">Марка…</option>
                              {vehBrands.map((b) => (
                                <option key={b.id} value={b.id}>
                                  {b.name}
                                </option>
                              ))}
                            </select>
                            <input
                              value={linkModelName}
                              onChange={(e) => setLinkModelName(e.target.value)}
                              placeholder="Модель (CS35…)"
                              style={{ flex: 1, minWidth: 120, padding: '8px 10px', borderRadius: 10, border: '1px solid var(--border)' }}
                            />
                            <button
                              type="button"
                              onClick={() => {
                                const bid = parseInt(linkBrandId, 10);
                                if (!bid || !linkModelName.trim()) { toast.error('Марка и модель обязательны'); return; }
                                addVmAndLink.mutate({ efId: f.id, brandId: bid, name: linkModelName.trim() });
                              }}
                              disabled={addVmAndLink.isPending}
                            >
                              В код
                            </button>
                          </div>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              color: 'var(--text-muted)',
                              margin: '8px 0 4px',
                            }}
                          >
                            Сейчас в коде
                          </div>
                          {[...byBrand.entries()].length === 0 && (
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>— привяжите минимум одну модель</div>
                          )}
                          {[...byBrand.entries()].map(([bid, g]) => (
                            <div key={bid} style={{ marginBottom: 8, fontSize: 13 }}>
                              <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--text)' }}>
                                {g.brand?.name || `Марка #${bid}`}
                              </div>
                              <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {g.models.map((m) => (
                                  <li key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span>{m.name}</span>
                                    <button
                                      type="button"
                                      title="Убрать из кода"
                                      onClick={() =>
                                        removeModelFromCode.mutate({ efId: f.id, modelId: m.id, allIds })
                                      }
                                      style={{
                                        border: 'none',
                                        background: 'none',
                                        color: 'var(--danger)',
                                        cursor: 'pointer',
                                        padding: 0,
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                      }}
                                    >
                                      <FiTrash2 size={12} />
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            </div>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

export default SettingsCompatibilitySection;

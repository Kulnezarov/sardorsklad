import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FiBox, FiChevronDown, FiChevronRight, FiPlus, FiTrash2, FiLayers } from 'react-icons/fi';
import { compatibilityApi, getApiErrorMessage } from '../api/client';

const emptyBlock = () => ({ k: `b-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, brandName: '', text: '' });

function parseModelNames(raw) {
  const out = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    for (const part of line.split(/[,;]+/)) {
      const t = part.trim();
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * Код (465) → блоки «марка + модели (строки)»; при «Добавить в код» несуществующие марки создаются в справочнике.
 */
function SettingsCompatibilitySection() {
  const qc = useQueryClient();
  const [newCode, setNewCode] = useState('');
  const [newCodeName, setNewCodeName] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [brandBlocks, setBrandBlocks] = useState([emptyBlock()]);

  const { data: vehBrands = [] } = useQuery({
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

  useEffect(() => {
    setBrandBlocks([emptyBlock()]);
  }, [expandedId]);

  const byBrand = React.useMemo(() => {
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
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось')),
  });
  const addBatchToCode = useMutation({
    mutationFn: async ({ efId, blocks, brandsSnapshot }) => {
      const list = brandsSnapshot || (await compatibilityApi.vehicleBrands().then((r) => r.data));
      const groups = [];
      for (const b of blocks) {
        const bname = (b.brandName || '').trim();
        if (!bname) continue;
        const names = parseModelNames(b.text);
        if (!names.length) continue;
        let brandId = list.find((x) => (x.name || '').toLowerCase() === bname.toLowerCase())?.id;
        if (!brandId) {
          const { data: createdBrand } = await compatibilityApi.createVehicleBrand({
            name: bname,
            is_active: true,
          });
          brandId = createdBrand.id;
          list.push(createdBrand);
        }
        groups.push({ brandId, names });
      }
      if (!groups.length) {
        throw new Error('empty');
      }
      let cur = await compatibilityApi.getEngineFamily(efId).then((r) => r.data);
      let ids = [...(cur.vehicle_models || []).map((m) => m.id)];
      for (const g of groups) {
        for (const name of g.names) {
          const { data: created } = await compatibilityApi.createVehicleModel({
            vehicle_brand_id: g.brandId,
            name,
            is_active: true,
          });
          ids.push(created.id);
        }
      }
      const uniq = [...new Set(ids)];
      await compatibilityApi.updateEngineFamily(efId, { vehicle_model_ids: uniq });
    },
    onSuccess: (_, { efId }) => {
      toast.success('Модели добавлены в код');
      setBrandBlocks([emptyBlock()]);
      qc.invalidateQueries({ queryKey: ['compatibility', 'engine-family', efId] });
      qc.invalidateQueries({ queryKey: ['compatibility', 'vehicle-models'] });
      qc.invalidateQueries({ queryKey: ['compatibility'] });
    },
    onError: (e) => {
      if (e?.message === 'empty') {
        toast.error('В каждом блоке укажите марку (название) и хотя бы одну модель');
        return;
      }
      toast.error(getApiErrorMessage(e, 'Ошибка'));
    },
  });

  const removeModelFromCode = useMutation({
    mutationFn: async ({ efId, modelId, allIds }) => {
      const next = allIds.filter((id) => id !== modelId);
      await compatibilityApi.updateEngineFamily(efId, { vehicle_model_ids: next });
    },
    onSuccess: (_, v) => {
      toast.success('Снято');
      qc.invalidateQueries({ queryKey: ['compatibility', 'engine-family', v.efId] });
      qc.invalidateQueries({ queryKey: ['compatibility'] });
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось')),
  });

  const allIds = (detail?.vehicle_models || []).map((m) => m.id);

  return (
    <div className="settings-section compatibility-settings">
      <div className="settings-section-title">
        <FiBox size={16} /> Совместимость
      </div>
      <div className="settings-section-body">
        <div className="compat-add-code">
          <input
            className="compat-input"
            value={newCode}
            onChange={(e) => setNewCode(e.target.value.replace(/\s+/g, ''))}
            placeholder="Код, напр. 465"
            aria-label="Код"
          />
          <input
            className="compat-input compat-input-grow"
            value={newCodeName}
            onChange={(e) => setNewCodeName(e.target.value)}
            placeholder="Название (опционально)"
            aria-label="Название кода"
          />
          <button
            type="button"
            className="compat-btn-primary"
            onClick={() => {
              const c = (newCode || '').trim();
              if (!c) {
                toast.error('Введите код');
                return;
              }
              addEf.mutate({ code: c, name: newCodeName.trim() || null, is_active: true, vehicle_model_ids: null });
            }}
            disabled={addEf.isPending}
          >
            <FiPlus size={15} style={{ marginRight: 4, verticalAlign: 'middle' }} />
            Код
          </button>
        </div>

        <div className="compat-code-list">
          {engFamilies.length === 0 && <div className="compat-muted">Нет кодов</div>}
          {engFamilies
            .slice()
            .sort((a, b) => String(a.code).localeCompare(String(b.code), 'ru', { numeric: true }))
            .map((f) => {
              const open = expandedId === f.id;
              return (
                <div key={f.id} className="compat-accordion">
                  <button
                    type="button"
                    className="compat-accordion-head"
                    onClick={() => setExpandedId((id) => (id === f.id ? null : f.id))}
                  >
                    {open ? <FiChevronDown size={16} /> : <FiChevronRight size={16} />}
                    <span className="compat-code-label">{f.code}</span>
                    {f.name && <span className="compat-code-sub">{f.name}</span>}
                  </button>
                  {open && (
                    <div className="compat-accordion-body">
                      {detailLoading && <div className="compat-muted">Загрузка…</div>}
                      {!detailLoading && (
                        <>
                          <div className="compat-subhead">
                            <FiLayers size={14} style={{ marginRight: 6, opacity: 0.7 }} />
                            Код {f.code}: марка и модели (блок = одна марка)
                          </div>

                          {brandBlocks.map((b, idx) => (
                            <div key={b.k} className="compat-brand-card">
                              <div className="compat-brand-card-head">
                                <span>Марка {idx + 1}</span>
                                {brandBlocks.length > 1 && (
                                  <button
                                    type="button"
                                    className="compat-link danger"
                                    onClick={() => setBrandBlocks((prev) => prev.filter((x) => x.k !== b.k))}
                                  >
                                    Убрать блок
                                  </button>
                                )}
                              </div>
                              <input
                                className="compat-select"
                                value={b.brandName}
                                onChange={(e) => {
                                  const t = e.target.value;
                                  setBrandBlocks((prev) => prev.map((x) => (x.k === b.k ? { ...x, brandName: t } : x)));
                                }}
                                placeholder="Название марки, напр. Changan"
                                aria-label={`Название марки ${idx + 1}`}
                              />
                              <textarea
                                className="compat-textarea"
                                value={b.text}
                                onChange={(e) => {
                                  const t = e.target.value;
                                  setBrandBlocks((prev) => prev.map((x) => (x.k === b.k ? { ...x, text: t } : x)));
                                }}
                                rows={4}
                                placeholder="CS55&#10;UNI-K"
                                spellCheck={false}
                              />
                            </div>
                          ))}

                          <div className="compat-actions">
                            <button
                              type="button"
                              className="compat-btn-ghost"
                              onClick={() => setBrandBlocks((p) => [...p, emptyBlock()])}
                            >
                              <FiPlus size={15} style={{ marginRight: 4, verticalAlign: 'middle' }} />
                              Ещё марка
                            </button>
                            <button
                              type="button"
                              className="compat-btn-primary"
                              disabled={addBatchToCode.isPending}
                              onClick={() => addBatchToCode.mutate({ efId: f.id, blocks: brandBlocks, brandsSnapshot: [...vehBrands] })}
                            >
                              {addBatchToCode.isPending ? '…' : 'Добавить в код'}
                            </button>
                          </div>

                          <div className="compat-subhead" style={{ marginTop: 18 }}>
                            В коде {f.code}
                          </div>
                          {[...byBrand.entries()].length === 0 && (
                            <div className="compat-muted">Пока пусто</div>
                          )}
                          {[...byBrand.entries()].map(([bid, g]) => (
                            <div key={bid} className="compat-linked-block">
                              <div className="compat-linked-title">{g.brand?.name || `Марка #${bid}`}</div>
                              <ul className="compat-model-list">
                                {g.models.map((m) => (
                                  <li key={m.id} className="compat-model-line">
                                    <span>{m.name}</span>
                                    <button
                                      type="button"
                                      className="compat-icon-del"
                                      title="Убрать из кода"
                                      onClick={() =>
                                        removeModelFromCode.mutate({ efId: f.id, modelId: m.id, allIds })
                                      }
                                    >
                                      <FiTrash2 size={14} />
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

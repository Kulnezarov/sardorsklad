import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { FiBox, FiPlus, FiTrash2 } from 'react-icons/fi';
import { compatibilityApi, getApiErrorMessage } from '../api/client';

function SettingsCompatibilitySection() {
  const qc = useQueryClient();
  const [engineCodeId, setEngineCodeId] = useState('');
  const [engineCodeDescription, setEngineCodeDescription] = useState('');
  const [selectedCodeId, setSelectedCodeId] = useState(null);
  const [compatBrand, setCompatBrand] = useState('');
  const [compatModel, setCompatModel] = useState('');

  const { data: codes = [] } = useQuery({
    queryKey: ['compatibility', 'engine-codes'],
    queryFn: () => compatibilityApi.engineCodes().then((r) => r.data),
  });

  const { data: selectedCode, isFetching: codeLoading } = useQuery({
    queryKey: ['compatibility', 'engine-code', selectedCodeId],
    queryFn: () => compatibilityApi.getEngineCode(selectedCodeId).then((r) => r.data),
    enabled: selectedCodeId != null,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['compatibility', 'engine-codes'] });
    if (selectedCodeId != null) qc.invalidateQueries({ queryKey: ['compatibility', 'engine-code', selectedCodeId] });
  };

  const createCodeMutation = useMutation({
    mutationFn: (payload) => compatibilityApi.createEngineCode(payload),
    onSuccess: () => {
      toast.success('Код добавлен');
      setEngineCodeId('');
      setEngineCodeDescription('');
      invalidate();
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось добавить код')),
  });

  const addCompatibilityMutation = useMutation({
    mutationFn: ({ codeId, payload }) => compatibilityApi.addEngineCodeCompatibility(codeId, payload),
    onSuccess: () => {
      toast.success('Совместимость добавлена');
      setCompatBrand('');
      setCompatModel('');
      invalidate();
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось добавить совместимость')),
  });

  const deleteCompatibilityMutation = useMutation({
    mutationFn: ({ codeId, compatibilityId }) => compatibilityApi.deleteEngineCodeCompatibility(codeId, compatibilityId),
    onSuccess: () => {
      toast.success('Запись удалена');
      invalidate();
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось удалить запись')),
  });

  const deleteCodeMutation = useMutation({
    mutationFn: (id) => compatibilityApi.deleteEngineCode(id),
    onSuccess: (_, id) => {
      toast.success('Код удален');
      if (selectedCodeId === id) setSelectedCodeId(null);
      invalidate();
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось удалить код')),
  });

  return (
    <div className="settings-section compatibility-settings">
      <div className="settings-section-title">
        <FiBox size={16} /> Мастер-коды двигателей
      </div>
      <div className="settings-section-body">
        <div className="compat-add-code">
          <input
            className="compat-input"
            value={engineCodeId}
            onChange={(e) => setEngineCodeId(e.target.value.replace(/\D+/g, ''))}
            placeholder="Код, напр. 465"
          />
          <input
            className="compat-input compat-input-grow"
            value={engineCodeDescription}
            onChange={(e) => setEngineCodeDescription(e.target.value)}
            placeholder="Описание (опционально)"
          />
          <button
            type="button"
            className="compat-btn-primary"
            onClick={() => {
              if (!engineCodeId) return toast.error('Введите код');
              createCodeMutation.mutate({
                id: Number(engineCodeId),
                description: engineCodeDescription.trim() || null,
              });
            }}
            disabled={createCodeMutation.isPending}
          >
            <FiPlus size={15} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Код
          </button>
        </div>

        <div className="compat-code-list">
          {codes.length === 0 && <div className="compat-muted">Нет кодов</div>}
          {codes.map((code) => (
            <div key={code.id} className="compat-accordion">
              <button type="button" className="compat-accordion-head" onClick={() => setSelectedCodeId(code.id)}>
                <span className="compat-code-label">{code.id}</span>
                {code.description && <span className="compat-code-sub">{code.description}</span>}
              </button>
              <button
                type="button"
                className="compat-icon-del"
                title="Удалить код"
                onClick={() => deleteCodeMutation.mutate(code.id)}
                disabled={deleteCodeMutation.isPending}
              >
                <FiTrash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        {selectedCodeId != null && (
          <div style={{ marginTop: 16 }}>
            <div className="compat-subhead">Код {selectedCodeId}: добавить марку и модель</div>
            <div className="compat-add-code">
              <input className="compat-input" value={compatBrand} onChange={(e) => setCompatBrand(e.target.value)} placeholder="Марка" />
              <input
                className="compat-input compat-input-grow"
                value={compatModel}
                onChange={(e) => setCompatModel(e.target.value)}
                placeholder="Модель"
              />
              <button
                type="button"
                className="compat-btn-primary"
                disabled={addCompatibilityMutation.isPending}
                onClick={() => {
                  const brand = compatBrand.trim();
                  const model = compatModel.trim();
                  if (!brand || !model) return toast.error('Укажите марку и модель');
                  addCompatibilityMutation.mutate({ codeId: selectedCodeId, payload: { brand, model } });
                }}
              >
                <FiPlus size={15} style={{ marginRight: 4, verticalAlign: 'middle' }} /> Добавить
              </button>
            </div>

            {codeLoading && <div className="compat-muted">Загрузка…</div>}
            {!codeLoading && (
              <div className="compat-linked-block">
                <div className="compat-linked-title">Список совместимости</div>
                <ul className="compat-model-list">
                  {(selectedCode?.compatibility || []).map((item) => (
                    <li key={item.id} className="compat-model-line">
                      <span>{item.brand} · {item.model}</span>
                      <button
                        type="button"
                        className="compat-icon-del"
                        onClick={() =>
                          deleteCompatibilityMutation.mutate({
                            codeId: selectedCodeId,
                            compatibilityId: item.id,
                          })
                        }
                      >
                        <FiTrash2 size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default SettingsCompatibilitySection;

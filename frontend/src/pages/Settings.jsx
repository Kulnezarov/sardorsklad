import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  FiLogOut, FiBox, FiPrinter, FiX,
  FiAlertTriangle, FiRefreshCw, FiLoader, FiTrash2,
  FiSun, FiMoon, FiShoppingBag, FiClock, FiSettings,
} from 'react-icons/fi';
import { settingsApi } from '../api/settings';
import { historyApi } from '../api/history';
import { useAuth } from '../auth/AuthContext';
import { fetchCnyRate } from '../utils/cnyAutoRate';

const defaultSettings = {
  store_name: 'SkladPro',
  scan_auto_increment: true,
  history_auto_clean_days: 30,
  label_size: 'small',
  dark_mode: false,
  cny_rate: 65,
  low_stock_threshold: 5,
};

/* ═══════════════════════════════════════════════
   MAIN COMPONENT
═══════════════════════════════════════════════ */
const Settings = () => {
  const { user, logout } = useAuth();
  const qc = useQueryClient();
  const [form, setForm] = useState(defaultSettings);
  const [labelType, setLabelType] = useState(() => localStorage.getItem('label_type') || 'barcode');
  const [rateLoading, setRateLoading] = useState(false);
  const [showClearHistoryConfirm, setShowClearHistoryConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const saveTimer = useRef(null);

  /* ── query ── */
  const { data: settingsData, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const r = await settingsApi.getSettings();
      return r.data;
    },
  });

  useEffect(() => {
    if (!settingsData) return;
    setForm({
      ...defaultSettings,
      ...settingsData,
      cny_rate: Number(settingsData.cny_rate ?? defaultSettings.cny_rate),
      low_stock_threshold: Number(settingsData.low_stock_threshold ?? defaultSettings.low_stock_threshold),
      history_auto_clean_days: Number(settingsData.history_auto_clean_days ?? defaultSettings.history_auto_clean_days),
    });
  }, [settingsData]);

  /* ── auto-save mutation ── */
  const saveMut = useMutation({
    mutationFn: (data) => settingsApi.updateSettings(data),
    onSuccess: () => {
      toast.success('Сохранено ✓', { duration: 1500 });
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: () => toast.error('Не удалось сохранить'),
  });

  const autoSave = (newForm) => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      saveMut.mutate(newForm);
    }, 1200);
  };

  const handleChange = (field, value) => {
    const next = { ...form, [field]: value };
    setForm(next);
    autoSave(next);
  };

  /* ── CNY rate fetch ── */
  const handleFetchRate = async () => {
    setRateLoading(true);
    try {
      const rate = await fetchCnyRate();
      if (rate) {
        const next = { ...form, cny_rate: rate };
        setForm(next);
        saveMut.mutate(next);
        toast.success(`Курс обновлён: 1 CNY = ${rate} KZT`);
      } else {
        toast.error('Не удалось получить курс');
      }
    } catch {
      toast.error('Ошибка при получении курса');
    }
    setRateLoading(false);
  };

  /* ── clear history ── */
  const clearHistoryMut = useMutation({
    mutationFn: () => historyApi.clearHistory(),
    onSuccess: () => {
      toast.success('История очищена');
      setShowClearHistoryConfirm(false);
      qc.invalidateQueries({ queryKey: ['history'] });
    },
    onError: () => toast.error('Ошибка'),
  });

  /* ── Label type ── */
  const handleLabelType = (t) => {
    setLabelType(t);
    localStorage.setItem('label_type', t);
    toast.success('Сохранено ✓', { duration: 1500 });
  };

  /* ── Pills helper ── */
  const Pills = ({ options, value, onChange }) => (
    <div style={{ display: 'flex', gap: 8 }}>
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 12,
            border: value === opt.value ? '2px solid var(--primary)' : '1px solid var(--border)',
            background: value === opt.value ? 'var(--primary-light)' : 'var(--bg-secondary)',
            color: value === opt.value ? 'var(--primary)' : 'var(--text)',
            fontWeight: 700, fontSize: 13, cursor: 'pointer',
            transition: 'all 0.15s', textAlign: 'center',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  /* ── Toggle ── */
  const Toggle = ({ value, onChange }) => (
    <button
      type="button"
      onClick={() => onChange(!value)}
      className={`ios-toggle ${value ? 'on' : ''}`}
    />
  );

  /* ── Setting row ── */
  const Row = ({ label, description, children }) => (
    <div className="settings-row">
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)', marginBottom: description ? 2 : 0 }}>
          {label}
        </div>
        {description && (
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{description}</div>
        )}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );

  /* ── Modal ── */
  const ConfirmModal = ({ isOpen, onClose, title, message, onConfirm, confirmLabel = 'Удалить', confirmColor = 'var(--danger)' }) => {
    if (!isOpen) return null;
    return createPortal(
      <div className="reserve-modal-overlay" onClick={onClose}>
        <div className="reserve-modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
          <div className="reserve-modal-header">
            <div style={{ fontWeight: 800, fontSize: 17, color: 'var(--text)' }}>{title}</div>
            <button type="button" onClick={onClose} style={{ width: 32, height: 32, borderRadius: 10, border: '1px solid var(--border)', background: 'var(--bg-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <FiX size={16} />
            </button>
          </div>
          <div className="reserve-modal-body">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', marginBottom: 20 }}>
              <FiAlertTriangle size={20} style={{ color: '#f59e0b', flexShrink: 0 }} />
              <div style={{ fontSize: 13, color: '#b45309', fontWeight: 500 }}>{message}</div>
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={onClose} style={{ flex: 1, padding: '12px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                Отмена
              </button>
              <button onClick={onConfirm} style={{ flex: 1, padding: '12px', borderRadius: 14, border: 'none', background: confirmColor, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>
      </div>,
      document.body,
    );
  };

  if (isLoading) {
    return (
      <div className="settings-shell">
        <div className="settings-content">
          <div className="reserve-empty">
            <FiLoader size={24} style={{ animation: 'spin 1s linear infinite' }} />
            <div style={{ marginTop: 12 }}>Загрузка настроек...</div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="settings-shell">
      <div className="settings-content">

        {/* Page title */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 26, fontWeight: 900, color: 'var(--text)' }}>Настройки</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
            Изменения сохраняются автоматически
          </div>
        </div>

        {/* ── Section 1: Магазин ── */}
        <div className="settings-section">
          <div className="settings-section-title">
            <FiShoppingBag size={16} /> Магазин
          </div>
          <div className="settings-section-body">
            <Row label="Название магазина" description="Отображается в заголовке сайдбара">
              <input
                value={form.store_name}
                onChange={(e) => handleChange('store_name', e.target.value)}
                style={{
                  width: 200, padding: '8px 12px', borderRadius: 10,
                  border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                  fontSize: 14, color: 'var(--text)', outline: 'none', fontFamily: 'inherit',
                  textAlign: 'left',
                }}
              />
            </Row>
          </div>
        </div>

        {/* ── Section 2: Склад ── */}
        <div className="settings-section">
          <div className="settings-section-title">
            <FiBox size={16} /> Склад
          </div>
          <div className="settings-section-body">
            <Row label="Порог низкого остатка" description="Товары с остатком ниже этого значения будут подсвечены">
              <input
                type="number"
                min="1"
                value={form.low_stock_threshold}
                onChange={(e) => handleChange('low_stock_threshold', Math.max(1, parseInt(e.target.value) || 1))}
                style={{
                  width: 80, padding: '8px 12px', borderRadius: 10,
                  border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                  fontSize: 14, color: 'var(--text)', outline: 'none', textAlign: 'center',
                  fontFamily: 'inherit',
                }}
              />
            </Row>

            <div className="settings-divider" />

            <Row label="Курс юань → тенге" description={`1 CNY = ${Number(form.cny_rate || 0).toLocaleString('ru-RU')} KZT`}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.cny_rate}
                  onChange={(e) => handleChange('cny_rate', Number(e.target.value) || 0)}
                  style={{
                    width: 90, padding: '8px 12px', borderRadius: 10,
                    border: '1px solid var(--border)', background: 'var(--bg-secondary)',
                    fontSize: 14, color: 'var(--text)', outline: 'none', textAlign: 'center',
                    fontFamily: 'inherit',
                  }}
                />
                <button
                  onClick={handleFetchRate}
                  disabled={rateLoading}
                  style={{
                    padding: '8px 12px', borderRadius: 10,
                    border: '1px solid var(--primary)', background: 'var(--primary-light)',
                    color: 'var(--primary)', fontWeight: 700, fontSize: 12, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
                  }}
                >
                  {rateLoading ? <FiLoader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <FiRefreshCw size={13} />}
                  Обновить
                </button>
              </div>
            </Row>

            <div className="settings-divider" />

            <Row label="Авто +1 при сканировании" description="Автоматически увеличивать количество при повторном сканировании">
              <Toggle value={form.scan_auto_increment} onChange={(v) => handleChange('scan_auto_increment', v)} />
            </Row>
          </div>
        </div>

        {/* ── Section 3: История ── */}
        <div className="settings-section">
          <div className="settings-section-title">
            <FiClock size={16} /> История
          </div>
          <div className="settings-section-body">
            <Row
              label={`Автоочистка: ${form.history_auto_clean_days} дней`}
              description="Удалять записи старше указанного количества дней"
            >
              <div style={{ width: 180, display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>7</span>
                <input
                  type="range"
                  min="7"
                  max="365"
                  value={form.history_auto_clean_days}
                  onChange={(e) => handleChange('history_auto_clean_days', parseInt(e.target.value))}
                  className="ios-slider"
                />
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>365</span>
              </div>
            </Row>

            <div className="settings-divider" />

            <div style={{ padding: '12px 0' }}>
              <button
                onClick={() => setShowClearHistoryConfirm(true)}
                style={{
                  padding: '10px 16px', borderRadius: 12,
                  border: '1.5px solid var(--danger)', background: 'transparent',
                  color: 'var(--danger)', fontWeight: 700, fontSize: 13,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                <FiTrash2 size={14} /> Очистить всю историю сейчас
              </button>
            </div>
          </div>
        </div>

        {/* ── Section 4: Этикетки ── */}
        <div className="settings-section">
          <div className="settings-section-title">
            <FiPrinter size={16} /> Этикетки
          </div>
          <div className="settings-section-body">
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
                Размер этикетки
              </div>
              <Pills
                options={[
                  { value: 'small', label: 'Маленький' },
                  { value: 'medium', label: 'Средний' },
                  { value: 'large', label: 'Большой' },
                ]}
                value={form.label_size}
                onChange={(v) => handleChange('label_size', v)}
              />
            </div>

            <div className="settings-divider" />

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)', marginBottom: 8 }}>
                Тип по умолчанию
              </div>
              <Pills
                options={[
                  { value: 'barcode', label: 'Штрих-код' },
                  { value: 'qr', label: 'QR-код' },
                ]}
                value={labelType}
                onChange={handleLabelType}
              />
            </div>
          </div>
        </div>

        {/* ── Section 5: Внешний вид ── */}
        <div className="settings-section">
          <div className="settings-section-title">
            {form.dark_mode ? <FiMoon size={16} /> : <FiSun size={16} />} Внешний вид
          </div>
          <div className="settings-section-body">
            <Row label="Тёмная тема">
              <Toggle value={form.dark_mode} onChange={(v) => handleChange('dark_mode', v)} />
            </Row>
          </div>
        </div>

        {/* ── Section 6: Данные ── */}
        <div className="settings-section">
          <div className="settings-section-title">
            <FiSettings size={16} /> Данные
          </div>
          <div className="settings-section-body">
            <div style={{ padding: '4px 0' }}>
              <button
                onClick={() => setShowResetConfirm(true)}
                style={{
                  padding: '12px 16px', borderRadius: 12,
                  border: '1.5px solid var(--danger)', background: 'transparent',
                  color: 'var(--danger)', fontWeight: 700, fontSize: 13,
                  cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                }}
              >
                <FiAlertTriangle size={15} /> Сбросить все настройки
              </button>
            </div>
          </div>
        </div>

        {/* ── Section 7: Аккаунт ── */}
        <div className="settings-section">
          <div className="settings-section-title">
            <FiLogOut size={16} /> Аккаунт
          </div>
          <div className="settings-section-body">
            <div style={{ padding: '4px 0' }}>
              {user?.email && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
                  Вы вошли как: <b style={{ color: 'var(--text)' }}>{user.email}</b>
                </div>
              )}
              <button
                onClick={() => setShowLogoutConfirm(true)}
                style={{
                  width: '100%', padding: '14px 16px', borderRadius: 14,
                  border: 'none', background: 'var(--danger)',
                  color: '#fff', fontWeight: 700, fontSize: 15,
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', gap: 10,
                }}
              >
                <FiLogOut size={18} /> Выйти из аккаунта
              </button>
            </div>
          </div>
        </div>

        <div style={{ height: 40 }} />
      </div>

      {/* ── Modals ── */}
      <ConfirmModal
        isOpen={showClearHistoryConfirm}
        onClose={() => setShowClearHistoryConfirm(false)}
        title="Очистить историю"
        message="Это удалит всю историю операций. Действие необратимо."
        onConfirm={() => clearHistoryMut.mutate()}
        confirmLabel="Удалить"
      />

      <ConfirmModal
        isOpen={showResetConfirm}
        onClose={() => setShowResetConfirm(false)}
        title="Сбросить настройки"
        message="Все настройки будут сброшены до значений по умолчанию. Действие необратимо."
        onConfirm={() => {
          setForm(defaultSettings);
          saveMut.mutate(defaultSettings);
          setShowResetConfirm(false);
        }}
        confirmLabel="Сбросить"
      />

      <ConfirmModal
        isOpen={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        title="Выйти из аккаунта"
        message="Вы уверены что хотите выйти? Для входа потребуется ввести логин и пароль."
        onConfirm={logout}
        confirmLabel="Выйти"
      />
    </div>
  );
};

export default Settings;

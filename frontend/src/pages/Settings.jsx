import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  FiLogOut, FiBox, FiPrinter, FiX,
  FiAlertTriangle, FiRefreshCw, FiLoader, FiTrash2,
  FiShoppingBag, FiClock, FiSettings, FiSave,
} from 'react-icons/fi';
import { getApiErrorMessage } from '../api/client';
import { settingsApi } from '../api/settings';
import { historyApi } from '../api/history';
import SettingsVehicleBrandsSection from '../components/SettingsVehicleBrandsSection';
import SettingsCategoriesSection from '../components/SettingsCategoriesSection';
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
  delivery_kzt_per_kg: 800,
};

/** Стабильные ссылки на компоненты — если объявить внутри Settings, при каждом вводе
 *  создаётся новый тип и React размонтирует строки настроек → поле теряет фокус. */
const Pills = ({ options, value, onChange }) => (
  <div className="ios-pills">
    {options.map((opt) => (
      <button
        key={opt.value}
        type="button"
        className={`ios-pill${value === opt.value ? ' ios-pill--active' : ''}`}
        onClick={() => onChange(opt.value)}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

const Row = ({ label, description, children }) => (
  <div className="settings-row">
    <div className="settings-row__label">
      <div>{label}</div>
      {description && <div className="settings-row__desc">{description}</div>}
    </div>
    <div className="settings-row__control">{children}</div>
  </div>
);

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
            <button type="button" onClick={onClose} style={{ flex: 1, padding: '12px', borderRadius: 14, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              Отмена
            </button>
            <button type="button" onClick={onConfirm} style={{ flex: 1, padding: '12px', borderRadius: 14, border: 'none', background: confirmColor, color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
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
  /** Однократная подстановка формы с сервера при открытии страницы */
  const didHydrateFromServer = useRef(false);

  /* ── query ── */
  const { data: settingsData, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => {
      const r = await settingsApi.getSettings();
      return r.data;
    },
  });

  useEffect(() => {
    if (!settingsData || didHydrateFromServer.current) return;
    didHydrateFromServer.current = true;
    setForm({
      ...defaultSettings,
      ...settingsData,
      cny_rate: Number(settingsData.cny_rate ?? defaultSettings.cny_rate),
      low_stock_threshold: Number(settingsData.low_stock_threshold ?? defaultSettings.low_stock_threshold),
      history_auto_clean_days: Number(settingsData.history_auto_clean_days ?? defaultSettings.history_auto_clean_days),
      delivery_kzt_per_kg: Number(settingsData.delivery_kzt_per_kg ?? defaultSettings.delivery_kzt_per_kg),
    });
  }, [settingsData]);

  const formToPayload = (f) => ({
    store_name: f.store_name,
    scan_auto_increment: true,
    history_auto_clean_days: f.history_auto_clean_days,
    label_size: f.label_size,
    dark_mode: f.dark_mode,
    cny_rate: Number(f.cny_rate) || 0,
    low_stock_threshold: Math.max(1, parseInt(f.low_stock_threshold, 10) || 1),
    delivery_kzt_per_kg: Math.max(0.01, Number(f.delivery_kzt_per_kg) || 0.01),
  });

  const applyServerSettings = (d) => {
    if (!d) return;
    setForm({
      ...defaultSettings,
      ...d,
      cny_rate: Number(d.cny_rate ?? defaultSettings.cny_rate),
      low_stock_threshold: Number(d.low_stock_threshold ?? defaultSettings.low_stock_threshold),
      history_auto_clean_days: Number(d.history_auto_clean_days ?? defaultSettings.history_auto_clean_days),
      delivery_kzt_per_kg: Number(d.delivery_kzt_per_kg ?? defaultSettings.delivery_kzt_per_kg),
    });
  };

  /* ── сохранение только по кнопке (без автосохранения — иначе поля «вылетают» при вводе) ── */
  const saveMut = useMutation({
    mutationFn: (data) => settingsApi.updateSettings(data),
    onSuccess: (res) => {
      const d = res?.data;
      if (d) {
        applyServerSettings(d);
        qc.setQueryData(['settings'], d);
      }
      toast.success('Сохранено ✓', { duration: 1500 });
      qc.invalidateQueries({ queryKey: ['settings-row'] });
    },
    onError: (e) => toast.error(getApiErrorMessage(e, 'Не удалось сохранить')),
  });

  const handleChange = (field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveSettings = () => {
    saveMut.mutate(formToPayload(form));
  };

  /* ── CNY rate fetch ── */
  const handleFetchRate = async () => {
    setRateLoading(true);
    try {
      const rate = await fetchCnyRate();
      if (rate) {
        setForm((prev) => ({ ...prev, cny_rate: rate }));
        toast.success(`Курс подставлен: 1 CNY = ${rate} KZT. Нажмите «Сохранить».`);
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
    onError: (e) => toast.error(getApiErrorMessage(e, 'Ошибка')),
  });

  /* ── Label type ── */
  const handleLabelType = (t) => {
    setLabelType(t);
    localStorage.setItem('label_type', t);
    toast.success('Сохранено ✓', { duration: 1500 });
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
        <div className="ios-page-header">
          <h1 className="ios-page-title">Настройки</h1>
          <button
            type="button"
            className="ios-btn-primary"
            onClick={handleSaveSettings}
            disabled={saveMut.isPending}
          >
            {saveMut.isPending ? <FiLoader size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <FiSave size={18} />}
            Сохранить
          </button>
        </div>

        {/* ── Section 1: Магазин ── */}
        <div className="settings-section">
          <div className="settings-section-title">
            <FiShoppingBag size={16} /> Магазин
          </div>
          <div className="settings-section-body">
            <Row label="Название магазина">
              <input
                className="ios-settings-input ios-settings-input--wide"
                value={form.store_name}
                onChange={(e) => handleChange('store_name', e.target.value)}
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
            <Row label="Порог низкого остатка">
              <input
                type="number"
                min="1"
                className="ios-settings-input"
                value={form.low_stock_threshold}
                onChange={(e) => handleChange('low_stock_threshold', Math.max(1, parseInt(e.target.value) || 1))}
              />
            </Row>

            <Row label={`Курс юань → тенге (1 CNY = ${Number(form.cny_rate || 0).toLocaleString('ru-RU')} KZT)`}>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="ios-settings-input"
                  value={form.cny_rate}
                  onChange={(e) => handleChange('cny_rate', Number(e.target.value) || 0)}
                />
                <button
                  type="button"
                  className="ios-btn-secondary"
                  onClick={handleFetchRate}
                  disabled={rateLoading}
                  style={{ minHeight: 36, padding: '6px 12px', fontSize: 14 }}
                >
                  {rateLoading ? <FiLoader size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <FiRefreshCw size={13} />}
                  Обновить
                </button>
              </div>
            </Row>

            <Row label="Доставка, ₸ за 1 кг">
              <input
                type="number"
                min="0.01"
                step="1"
                className="ios-settings-input"
                value={form.delivery_kzt_per_kg}
                onChange={(e) => handleChange('delivery_kzt_per_kg', Math.max(0.01, Number(e.target.value) || 0))}
              />
            </Row>

          </div>
        </div>

        {/* ── Section 3: История ── */}
        <div className="settings-section">
          <div className="settings-section-title">
            <FiClock size={16} /> История
          </div>
          <div className="settings-section-body">
            <Row label={`Автоочистка истории: ${form.history_auto_clean_days} дн.`}>
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

            <div className="settings-row">
              <button
                type="button"
                className="ios-btn-destructive"
                onClick={() => setShowClearHistoryConfirm(true)}
              >
                <FiTrash2 size={16} /> Очистить всю историю сейчас
              </button>
            </div>
          </div>
        </div>

        <SettingsCategoriesSection />

        <SettingsVehicleBrandsSection />

        {/* ── Section 4: Этикетки ── */}
        <div className="settings-section">
          <div className="settings-section-title">
            <FiPrinter size={16} /> Этикетки
          </div>
          <div className="settings-section-body">
            <div className="ios-settings-block">
              <div className="ios-settings-block__label">Размер этикетки</div>
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

            <div className="ios-settings-block">
              <div className="ios-settings-block__label">Тип по умолчанию</div>
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

        {/* ── Section 5: Данные ── */}
        <div className="settings-section">
          <div className="settings-section-title">
            <FiSettings size={16} /> Данные
          </div>
          <div className="settings-section-body">
            <div className="settings-row">
              <button
                type="button"
                className="ios-btn-destructive"
                onClick={() => setShowResetConfirm(true)}
              >
                <FiAlertTriangle size={16} /> Сбросить все настройки
              </button>
            </div>
          </div>
        </div>

        {/* ── Section 6: Аккаунт ── */}
        <div className="settings-section">
          <div className="settings-section-title">
            <FiLogOut size={16} /> Аккаунт
          </div>
          <div className="settings-section-body">
            <div className="ios-settings-block">
              {user?.email && (
                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12, lineHeight: 1.45 }}>
                  Вы вошли как: <b style={{ color: 'var(--text)' }}>{user.email}</b>
                </div>
              )}
              <button
                type="button"
                className="ios-btn-destructive ios-btn-destructive--filled"
                onClick={() => setShowLogoutConfirm(true)}
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
          const payload = formToPayload(defaultSettings);
          setForm(defaultSettings);
          saveMut.mutate(payload);
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

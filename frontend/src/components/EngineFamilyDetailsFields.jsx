import React from 'react';
import { FUEL_TYPE_OPTIONS } from '../utils/engineFamilyUtils';

export default function EngineFamilyDetailsFields({ value, onChange, idPrefix = 'ef' }) {
  const set = (key, raw) => onChange({ ...value, [key]: raw });

  return (
    <div className="engine-settings-details-grid">
      <label className="engine-settings-field">
        <span className="engine-settings-field__label">Объём, л</span>
        <input
          id={`${idPrefix}-displacement`}
          className="engine-settings-field__input"
          type="text"
          inputMode="decimal"
          placeholder="1.5"
          value={value.displacement_l}
          onChange={(e) => set('displacement_l', e.target.value)}
        />
      </label>
      <label className="engine-settings-field">
        <span className="engine-settings-field__label">Топливо</span>
        <select
          id={`${idPrefix}-fuel`}
          className="engine-settings-field__input engine-settings-field__select"
          value={value.fuel_type}
          onChange={(e) => set('fuel_type', e.target.value)}
        >
          {FUEL_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value || 'none'} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </label>
      <label className="engine-settings-field">
        <span className="engine-settings-field__label">Мощность</span>
        <input
          id={`${idPrefix}-power`}
          className="engine-settings-field__input"
          placeholder="98 л.с."
          value={value.power}
          onChange={(e) => set('power', e.target.value)}
        />
      </label>
      <label className="engine-settings-field">
        <span className="engine-settings-field__label">Производитель</span>
        <input
          id={`${idPrefix}-manufacturer`}
          className="engine-settings-field__input"
          placeholder="Changan, FAW…"
          value={value.manufacturer}
          onChange={(e) => set('manufacturer', e.target.value)}
        />
      </label>
      <label className="engine-settings-field engine-settings-field--full">
        <span className="engine-settings-field__label">
          Название <span className="engine-settings-field__opt">необяз.</span>
        </span>
        <input
          id={`${idPrefix}-name`}
          className="engine-settings-field__input"
          placeholder="Краткое имя двигателя"
          value={value.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </label>
      <label className="engine-settings-field engine-settings-field--full">
        <span className="engine-settings-field__label">
          Заметки <span className="engine-settings-field__opt">необяз.</span>
        </span>
        <textarea
          id={`${idPrefix}-notes`}
          className="engine-settings-field__textarea"
          rows={2}
          placeholder="Особенности, год выпуска, примечания…"
          value={value.notes}
          onChange={(e) => set('notes', e.target.value)}
        />
      </label>
    </div>
  );
}

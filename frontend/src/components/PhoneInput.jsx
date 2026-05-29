import React, { useEffect, useState } from 'react';
import { formatPhoneDisplay, normalizePhoneDigits } from '../utils/phoneMask';

export default function PhoneInput({
  label = 'Телефон *',
  value = '',
  onChange,
  error,
  ...rest
}) {
  const [display, setDisplay] = useState(() => formatPhoneDisplay(value));

  useEffect(() => {
    setDisplay(formatPhoneDisplay(value));
  }, [value]);

  const onInput = (e) => {
    const digits = normalizePhoneDigits(e.target.value);
    const formatted = formatPhoneDisplay(digits);
    setDisplay(formatted);
    onChange?.(digits ? `+${digits}` : '');
  };

  return (
    <div style={{ marginBottom: 12 }}>
      {label && (
        <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 6, color: 'var(--text-secondary)' }}>
          {label}
        </label>
      )}
      <input
        className="input-ios"
        type="tel"
        inputMode="numeric"
        placeholder="+7 (___) ___-__-__"
        value={display}
        onChange={onInput}
        style={{
          width: '100%',
          borderColor: error ? 'var(--danger)' : undefined,
        }}
        {...rest}
      />
      {error && <div style={{ color: 'var(--danger)', fontSize: 12, marginTop: 4 }}>{error}</div>}
    </div>
  );
}

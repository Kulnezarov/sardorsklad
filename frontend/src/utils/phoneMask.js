/** Нормализация к 11 цифрам: 7XXXXXXXXXX */
export function normalizePhoneDigits(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10) d = `7${d}`;
  if (d.length === 11 && d.startsWith('8')) d = `7${d.slice(1)}`;
  if (!d.startsWith('7')) d = `7${d}`;
  return d.slice(0, 11);
}

/** +7 (7XX) XXX-XX-XX */
export function formatPhoneDisplay(raw) {
  const d = normalizePhoneDigits(raw);
  if (!d || d.length < 2) return d ? '+7' : '';
  const a = d.slice(1);
  let out = '+7';
  if (a.length > 0) {
    out += ` (${a.slice(0, 3)}`;
    if (a.length >= 3) out += ')';
    if (a.length > 3) out += ` ${a.slice(3, 6)}`;
    if (a.length > 6) out += `-${a.slice(6, 8)}`;
    if (a.length > 8) out += `-${a.slice(8, 10)}`;
  }
  return out;
}

export function phoneToE164(raw) {
  const d = normalizePhoneDigits(raw);
  return d ? `+${d}` : '';
}

/** Обработчик onChange для controlled input */
export function handlePhoneInputChange(value, setDisplay) {
  const digits = normalizePhoneDigits(value);
  setDisplay(formatPhoneDisplay(digits));
  return digits ? `+${digits}` : '';
}

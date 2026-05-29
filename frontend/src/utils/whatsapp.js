/** Цифры для wa.me (10 цифр → префикс 7). */
export function digitsForWhatsApp(raw) {
  let d = String(raw || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.length === 10) return `7${d}`;
  if (d.length === 11 && d.startsWith('8')) return `7${d.slice(1)}`;
  return d;
}

export function openWhatsApp(phone, text) {
  const digits = digitsForWhatsApp(phone);
  if (!digits) return false;
  const url = `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

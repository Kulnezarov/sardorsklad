/** EAN-13 checksum for first 12 digits */
export function ean13Checksum12(d12) {
  if (!d12 || d12.length !== 12 || !/^\d{12}$/.test(d12)) return '0';
  let sum = 0;
  for (let i = 0; i < 12; i += 1) {
    const n = parseInt(d12[i], 10);
    sum += n * (i % 2 === 0 ? 1 : 3);
  }
  return String((10 - (sum % 10)) % 10);
}

/** Random 13-digit EAN-13 (valid checksum). */
export function generateEAN13() {
  const arr = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(arr);
  } else {
    for (let i = 0; i < 12; i += 1) arr[i] = Math.floor(Math.random() * 256);
  }
  let d12 = '';
  for (let i = 0; i < 12; i += 1) d12 += String(arr[i] % 10);
  return d12 + ean13Checksum12(d12);
}

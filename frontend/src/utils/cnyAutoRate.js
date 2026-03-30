/**
 * Auto CNY/KZT exchange rate fetcher.
 * Updates once per day at 00:03 (or on first load if not fetched today).
 * Uses open.er-api.com — free, no API key required.
 * Fallback: exchangerate-api.com
 */

const STORAGE_KEY = 'cny_rate_last_fetched'; // ISO date string YYYY-MM-DD
const RATE_KEY    = 'cny_rate_cached';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function msUntilNextSync() {
  const now = new Date();
  const target = new Date(now);
  target.setHours(0, 3, 0, 0); // 00:03:00
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

export async function fetchCnyRate() {
  const APIS = [
    'https://open.er-api.com/v6/latest/CNY',
    'https://api.exchangerate-api.com/v4/latest/CNY',
  ];

  for (const url of APIS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const json = await res.json();
      // open.er-api: { rates: { KZT: ... } }
      // exchangerate-api v4: { rates: { KZT: ... } }
      const rate = json?.rates?.KZT ?? json?.conversion_rates?.KZT;
      if (rate && Number.isFinite(Number(rate)) && Number(rate) > 0) {
        return Math.round(Number(rate) * 100) / 100; // round to 2dp
      }
    } catch (e) {
      console.warn('[CnyRate] API failed:', url, e?.message);
    }
  }
  return null;
}

/**
 * @param {(rate: number) => Promise<void>} onNewRate  called with fresh rate when available
 * @returns {{ cleanup: () => void }}
 */
export function startCnyAutoSync(onNewRate) {
  let timer = null;

  const doSync = async (force = false) => {
    const today = todayStr();
    const lastFetched = localStorage.getItem(STORAGE_KEY);

    if (!force && lastFetched === today) {
      // Already fetched today — nothing to do
      return;
    }

    const rate = await fetchCnyRate();
    if (rate) {
      localStorage.setItem(STORAGE_KEY, today);
      localStorage.setItem(RATE_KEY, String(rate));
      try {
        await onNewRate(rate);
        console.info(`[CnyRate] Updated: ${rate} ₸/¥ (${today})`);
      } catch (e) {
        console.error('[CnyRate] Failed to save to backend:', e);
      }
    }
  };

  const scheduleNext = () => {
    const ms = msUntilNextSync();
    timer = setTimeout(async () => {
      await doSync(true);
      scheduleNext(); // schedule next day
    }, ms);
  };

  // Run immediately (will no-op if already done today)
  doSync(false);
  // Schedule next 00:03
  scheduleNext();

  return {
    cleanup: () => { if (timer) clearTimeout(timer); },
  };
}

/** Returns cached rate from localStorage (or null) */
export function getCachedCnyRate() {
  const v = localStorage.getItem(RATE_KEY);
  if (!v) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

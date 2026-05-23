import { getMemCache, setMemCache, clearMemCache } from './memoryCache';

const TEN_MIN = 10 * 60 * 1000;
const FIFTEEN_MIN = 15 * 60 * 1000;
const THIRTY_MIN = 30 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;
const TWO_HOURS = 2 * 60 * 60 * 1000;

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function getCached<T>(key: string, ttlMs: number): T | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > ttlMs) {
      storage.removeItem(key);
      return null;
    }
    return parsed.data as T;
  } catch {
    return null;
  }
}

export function setCache<T>(key: string, data: T): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
  } catch { /* storage full or unavailable */ }
}

export function clearLsCache(key: string): void {
  const storage = getStorage();
  if (!storage) return;
  try { storage.removeItem(key); } catch { /* ignore */ }
}

// Three-layer cache: memory -> localStorage -> fetch
// With validation: only cache if validator passes (or no validator provided)
export function threeLayerCache<T>(
  key: string,
  memTtl: number,
  lsTtl: number,
  fetcher: () => Promise<T>,
  validator?: (data: T) => boolean
): Promise<T> {
  // Layer 1: memory cache
  const memHit = getMemCache(key, memTtl);
  if (memHit !== null) {
    if (!validator || validator(memHit as T)) {
      return Promise.resolve(memHit as T);
    }
    // Invalid cached data — clear and continue
    clearMemCache(key);
  }

  // Layer 2: localStorage cache
  const lsHit = getCached<T>(key, lsTtl);
  if (lsHit !== null) {
    if (!validator || validator(lsHit)) {
      setMemCache(key, lsHit);
      return Promise.resolve(lsHit);
    }
    // Invalid cached data — clear and continue
    clearLsCache(key);
  }

  // Layer 3: fetch
  return fetcher().then(data => {
    if (!validator || validator(data)) {
      setMemCache(key, data);
      setCache(key, data);
    }
    return data;
  });
}

// --- Specific cache helpers with TTLs ---

// Batch prices: memory 60 min, localStorage 60 min (end-of-day data)
export interface BatchPriceData {
  [ticker: string]: {
    price: number | null;
    change: number | null;
    changePct: number | null;
    high52w: number | null;
    low52w: number | null;
    fiveDay: number | null;
    oneMonth: number | null;
    threeMonth: number | null;
    fiftyTwoWeekHighPct: number | null;
    posIn52wRange: number | null;
  };
}

export const BATCH_PRICE_KEY = 'price_cache_batch_v5';
export const BATCH_PRICE_MEM_TTL = ONE_HOUR;
export const BATCH_PRICE_LS_TTL = ONE_HOUR;

// Sparkline: memory 10 min, localStorage 15 min
export interface CachedSparkline {
  price: number;
  change: number;
  changePercent: number;
  sparkline: number[];
  cachedAt: number;
}

export const SPARKLINE_MEM_TTL = TEN_MIN;
export const SPARKLINE_LS_TTL = FIFTEEN_MIN;

export function getSparklineCache(ticker: string): CachedSparkline | null {
  const key = `sparkline_${ticker}`;
  const mem = getMemCache(key, SPARKLINE_MEM_TTL);
  if (mem) return mem as CachedSparkline;
  return getCached<CachedSparkline>(key, SPARKLINE_LS_TTL);
}

export function setSparklineCache(ticker: string, data: Omit<CachedSparkline, 'cachedAt'>): void {
  const key = `sparkline_${ticker}`;
  const withTs = { ...data, cachedAt: Date.now() };
  setMemCache(key, withTs);
  setCache(key, withTs);
}

// Options chain: memory 30 min, localStorage 15 min
export const OPTIONS_MEM_TTL = THIRTY_MIN;
export const OPTIONS_LS_TTL = FIFTEEN_MIN;

// Expiry dates: memory 2 hours, localStorage 2 hours
export interface CachedExpirations {
  expirations: { date: number; label: string; dte: number }[];
  cachedAt: number;
}

export const EXPIRATIONS_MEM_TTL = TWO_HOURS;
export const EXPIRATIONS_LS_TTL = TWO_HOURS;

export function getExpirationsCache(): CachedExpirations | null {
  const mem = getMemCache('screener_expirations_v2', EXPIRATIONS_MEM_TTL);
  if (mem) return mem as CachedExpirations;
  return getCached<CachedExpirations>('screener_expirations_v2', EXPIRATIONS_LS_TTL);
}

export function setExpirationsCache(expirations: CachedExpirations['expirations']): void {
  const data = { expirations, cachedAt: Date.now() };
  setMemCache('screener_expirations_v2', data);
  setCache('screener_expirations_v2', data);
}

// Extended price: memory 10 min, localStorage 15 min
export const EXTENDED_PRICE_MEM_TTL = TEN_MIN;
export const EXTENDED_PRICE_LS_TTL = FIFTEEN_MIN;

import { getMemCache, setMemCache } from './memoryCache';

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

// Three-layer cache: memory → localStorage → fetch
export function threeLayerCache<T>(
  key: string,
  memTtl: number,
  lsTtl: number,
  fetcher: () => Promise<T>
): Promise<T> {
  // Layer 1: memory cache
  const memHit = getMemCache(key, memTtl);
  if (memHit !== null) return Promise.resolve(memHit as T);

  // Layer 2: localStorage cache
  const lsHit = getCached<T>(key, lsTtl);
  if (lsHit !== null) {
    setMemCache(key, lsHit);
    return Promise.resolve(lsHit);
  }

  // Layer 3: fetch
  return fetcher().then(data => {
    setMemCache(key, data);
    setCache(key, data);
    return data;
  });
}

// --- Specific cache helpers with TTLs ---

// Batch prices: memory 10 min, localStorage 15 min
export interface BatchPriceData {
  [ticker: string]: { price: number; change: number; changePct: number };
}

export const BATCH_PRICE_KEY = 'price_cache_batch';
export const BATCH_PRICE_MEM_TTL = TEN_MIN;
export const BATCH_PRICE_LS_TTL = FIFTEEN_MIN;

export function getBatchPriceCache(): BatchPriceData | null {
  return getCached<BatchPriceData>(BATCH_PRICE_KEY, BATCH_PRICE_LS_TTL);
}

export function setBatchPriceCache(data: BatchPriceData): void {
  setCache(BATCH_PRICE_KEY, data);
  setMemCache(BATCH_PRICE_KEY, data);
}

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

export function getOptionsCache(ticker: string, date?: number): any | null {
  const key = `options_${ticker}_${date ?? 'initial'}`;
  return getMemCache(key, OPTIONS_MEM_TTL) ?? getCached(key, OPTIONS_LS_TTL);
}

export function setOptionsCache(ticker: string, date: number | undefined, data: any): void {
  const key = `options_${ticker}_${date ?? 'initial'}`;
  setMemCache(key, data);
  setCache(key, data);
}

// Expiry dates: memory 2 hours, localStorage 2 hours
export interface CachedExpirations {
  expirations: { date: number; label: string; dte: number }[];
  cachedAt: number;
}

export const EXPIRATIONS_MEM_TTL = TWO_HOURS;
export const EXPIRATIONS_LS_TTL = TWO_HOURS;

export function getExpirationsCache(): CachedExpirations | null {
  const mem = getMemCache('screener_expirations', EXPIRATIONS_MEM_TTL);
  if (mem) return mem as CachedExpirations;
  return getCached<CachedExpirations>('screener_expirations', EXPIRATIONS_LS_TTL);
}

export function setExpirationsCache(expirations: CachedExpirations['expirations']): void {
  const data = { expirations, cachedAt: Date.now() };
  setMemCache('screener_expirations', data);
  setCache('screener_expirations', data);
}

// Extended price: memory 10 min, localStorage 15 min
export const EXTENDED_PRICE_MEM_TTL = TEN_MIN;
export const EXTENDED_PRICE_LS_TTL = FIFTEEN_MIN;

export function getExtendedPriceCache(ticker: string): any | null {
  const key = `extended_price_${ticker}`;
  return getMemCache(key, EXTENDED_PRICE_MEM_TTL) ?? getCached(key, EXTENDED_PRICE_LS_TTL);
}

export function setExtendedPriceCache(ticker: string, data: any): void {
  const key = `extended_price_${ticker}`;
  setMemCache(key, data);
  setCache(key, data);
}

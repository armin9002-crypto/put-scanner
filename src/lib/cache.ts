const FIVE_MIN = 5 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function getCached<T>(key: string, ttlMs: number = FIVE_MIN): T | null {
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

export interface CachedSparkline {
  price: number;
  change: number;
  changePercent: number;
  sparkline: number[];
  cachedAt: number;
}

export function getSparklineCache(ticker: string): CachedSparkline | null {
  return getCached<CachedSparkline>(`sparkline_${ticker}`, FIVE_MIN);
}

export function setSparklineCache(ticker: string, data: Omit<CachedSparkline, 'cachedAt'>): void {
  setCache(`sparkline_${ticker}`, { ...data, cachedAt: Date.now() });
}

export interface CachedExpirations {
  expirations: { date: number; label: string; dte: number }[];
  cachedAt: number;
}

export function getExpirationsCache(): CachedExpirations | null {
  return getCached<CachedExpirations>('screener_expirations', ONE_HOUR);
}

export function setExpirationsCache(expirations: CachedExpirations['expirations']): void {
  setCache('screener_expirations', { expirations, cachedAt: Date.now() });
}

export interface BatchPriceData {
  [ticker: string]: { price: number; change: number; changePct: number };
}

export function getBatchPriceCache(): BatchPriceData | null {
  return getCached<BatchPriceData>('price_cache_batch', FIVE_MIN);
}

export function setBatchPriceCache(data: BatchPriceData): void {
  setCache('price_cache_batch', data);
}

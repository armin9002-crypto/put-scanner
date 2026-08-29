import { getMemCache, setMemCache } from './memoryCache';
import { requestMarketData } from './marketDataRequest';
import type { RequestEndpoint } from './requestDiagnostics';

const TEN_MINUTES = 10 * 60 * 1000;
const FIFTEEN_MINUTES = 15 * 60 * 1000;
const TWO_HOURS = 2 * 60 * 60 * 1000;

function getStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function getCached<T>(key: string, ttlMs: number): T | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? 'null');
    const fetchedAt = parsed?.fetchedAt ?? parsed?.timestamp;
    if (!parsed || typeof fetchedAt !== 'number' || Date.now() - fetchedAt > ttlMs) return null;
    return parsed.data as T;
  } catch {
    return null;
  }
}

function setCache<T>(key: string, data: T): void {
  try { getStorage()?.setItem(key, JSON.stringify({ data, timestamp: Date.now() })); } catch { /* best effort */ }
}

export async function threeLayerCache<T>(
  key: string,
  memoryTtlMs: number,
  persistentTtlMs: number,
  fetcher: (signal: AbortSignal) => Promise<T>,
  validator?: (data: T) => boolean,
  options: { bypassCache?: boolean; diagnosticsEndpoint?: RequestEndpoint; diagnosticsSource?: string; signal?: AbortSignal } = {}
): Promise<T> {
  const result = await requestMarketData({
    key,
    source: options.diagnosticsSource ?? 'threeLayerCache',
    endpoint: options.diagnosticsEndpoint ?? 'price',
    softTtlMs: Math.min(memoryTtlMs, persistentTtlMs),
    hardTtlMs: Math.max(persistentTtlMs * 4, persistentTtlMs + 30 * 60 * 1000),
    schemaVersion: 1,
    mode: options.bypassCache ? 'revalidate' : 'cache-first',
    allowStaleOnError: true,
    signal: options.signal,
    validator: validator ?? (() => true),
    fetcher: signal => fetcher(signal),
  });
  return result.data;
}

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
    providerMarketTime?: number | null;
  };
}

export const BATCH_PRICE_KEY = 'price_cache_batch_v5';
export const SPARKLINE_MEM_TTL = TEN_MINUTES;
export const SPARKLINE_LS_TTL = FIFTEEN_MINUTES;
export const EXTENDED_PRICE_MEM_TTL = TEN_MINUTES;
export const EXTENDED_PRICE_LS_TTL = FIFTEEN_MINUTES;

export interface CachedExpirations {
  expirations: { date: number; label: string; dte: number }[];
  cachedAt: number;
}

const EXPIRATIONS_CACHE_KEY = 'expiry_dates_cache';
const LEGACY_EXPIRATIONS_CACHE_KEY = 'screener_expirations_v2';

export function getExpirationsCache(): CachedExpirations | null {
  const memory = getMemCache<CachedExpirations>(EXPIRATIONS_CACHE_KEY, TWO_HOURS);
  if (memory) return memory;
  return getCached<CachedExpirations>(EXPIRATIONS_CACHE_KEY, TWO_HOURS)
    ?? getCached<CachedExpirations>(LEGACY_EXPIRATIONS_CACHE_KEY, TWO_HOURS);
}

export function setExpirationsCache(expirations: CachedExpirations['expirations']): void {
  const data = { expirations, cachedAt: Date.now() };
  setMemCache(EXPIRATIONS_CACHE_KEY, data);
  setCache(EXPIRATIONS_CACHE_KEY, data);
}

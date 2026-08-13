import type { OptionsChainData } from './types';
import { threeLayerCache, BATCH_PRICE_KEY, SPARKLINE_MEM_TTL, SPARKLINE_LS_TTL, EXTENDED_PRICE_MEM_TTL, EXTENDED_PRICE_LS_TTL } from './cache';
import type { BatchPriceData } from './cache';
import { cachedRequest, makeCacheKey } from './dataCache';
import { cacheScannerOptionChain } from './scannerOptionSnapshot';
import { peekMarketData, requestMarketData, type DataFreshness, type RefreshMode } from './marketDataRequest';
import { normalizeFiniteNumber } from './marketDataNormalize';
import { normalizeOptionChainData } from './yahooOptionAdapter';

const API_BASE = '/api';

interface FetchOptionsOptions {
  bypassCache?: boolean;
  fresh?: boolean;
  source?: string;
  refreshMode?: RefreshMode;
}

const BATCH_PRICE_SOFT_TTL = 3 * 60 * 1000;
const BATCH_PRICE_HARD_TTL = 45 * 60 * 1000;
const OPTIONS_SOFT_TTL = 15 * 60 * 1000;
const OPTIONS_HARD_TTL = 2 * 60 * 60 * 1000;

function isValidBatchResponse(data: BatchPriceData, requestedTickers: string[]): boolean {
  if (!data || typeof data !== 'object') return false;
  const available = requestedTickers.filter(ticker => normalizeFiniteNumber(data[ticker]?.price) != null);
  return available.length > 0 && available.some(ticker => (
    'fiveDay' in data[ticker] && 'oneMonth' in data[ticker] && 'threeMonth' in data[ticker]
  ));
}

export interface BatchPriceRequestResult {
  data: BatchPriceData;
  freshness: DataFreshness;
  staleFallbackUsed: boolean;
}

export async function fetchBatchPricesResult(tickers: string[], options: { mode?: RefreshMode } = {}): Promise<BatchPriceRequestResult> {
  const normalizedTickers = [...new Set(tickers.map(ticker => ticker.trim().toUpperCase()).filter(Boolean))];
  const existingBatch = peekMarketData<BatchPriceData>({
    key: BATCH_PRICE_KEY,
    softTtlMs: BATCH_PRICE_SOFT_TTL,
    hardTtlMs: BATCH_PRICE_HARD_TTL,
    schemaVersion: 6,
    validator: data => data != null && typeof data === 'object',
  })?.data;
  const result = await requestMarketData<BatchPriceData>({
    key: BATCH_PRICE_KEY,
    source: 'fetchBatchPrices',
    endpoint: 'prices',
    softTtlMs: BATCH_PRICE_SOFT_TTL,
    hardTtlMs: BATCH_PRICE_HARD_TTL,
    schemaVersion: 6,
    mode: options.mode ?? 'cache-first',
    allowStaleOnError: true,
    validator: data => isValidBatchResponse(data, normalizedTickers),
    fetcher: async signal => {
      const res = await fetch(`${API_BASE}/prices?tickers=${encodeURIComponent(normalizedTickers.join(','))}`, { signal });
      if (!res.ok) {
        const error = new Error('Failed to fetch batch prices') as Error & { status: number };
        error.status = res.status;
        throw error;
      }
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return { ...existingBatch, ...data };
    },
  });
  return { data: result.data, freshness: result.meta.freshness, staleFallbackUsed: result.meta.staleFallbackUsed };
}

export async function fetchBatchPrices(tickers: string[], options: { mode?: RefreshMode } = {}): Promise<BatchPriceData> {
  return (await fetchBatchPricesResult(tickers, options)).data;
}

function getOptionsCacheKey(ticker: string, date?: number): string {
  return `options_v2_${ticker.trim().toUpperCase()}_${date ?? 'initial'}`;
}

function withCacheSource(data: OptionsChainData, cacheKey: string, stale = false, staleFallbackUsed = false): OptionsChainData {
  const fetchedAt = data.chainMeta?.fetchedAt ?? Date.now();
  return {
    ...data,
    chainMeta: {
      ticker: data.chainMeta?.ticker ?? cacheKey.split('_')[2] ?? '',
      requestedExpiration: data.chainMeta?.requestedExpiration ?? null,
      returnedExpiration: data.chainMeta?.returnedExpiration ?? data.chainMeta?.expirationDate ?? null,
      expirationDate: data.chainMeta?.expirationDate ?? null,
      fetchedAt,
      source: stale ? 'stale' : 'cache',
      freshness: stale ? 'stale' : 'fresh',
      staleFallbackUsed,
      fresh: false,
      cacheKey: data.chainMeta?.cacheKey ?? cacheKey,
      putCount: data.puts.length,
      callCount: data.chainMeta?.callCount,
      putStrikeMin: data.chainMeta?.putStrikeMin ?? (data.puts.length ? Math.min(...data.puts.map(put => put.strike)) : null),
      putStrikeMax: data.chainMeta?.putStrikeMax ?? (data.puts.length ? Math.max(...data.puts.map(put => put.strike)) : null),
      callStrikeMin: data.chainMeta?.callStrikeMin,
      callStrikeMax: data.chainMeta?.callStrikeMax,
      yahooExpirationDatesCount: data.chainMeta?.yahooExpirationDatesCount,
      previousCachedPutCount: data.chainMeta?.previousCachedPutCount ?? null,
      validationWarnings: data.chainMeta?.validationWarnings ?? [],
    },
  };
}

export async function fetchOptions(ticker: string, date?: number, options: FetchOptionsOptions = {}): Promise<OptionsChainData> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const cacheKey = getOptionsCacheKey(normalizedTicker, date);
  const source = options.source ?? 'fetchOptions';
  const fresh = options.fresh === true;
  const mode: RefreshMode = fresh ? 'fresh' : options.refreshMode ?? (options.bypassCache ? 'revalidate' : 'cache-first');
  const validator = (value: OptionsChainData) => value != null
    && Array.isArray(value.expirations)
    && Array.isArray(value.puts)
    && Number.isFinite(value.currentPrice);
  const previousCached = peekMarketData({
    key: cacheKey,
    softTtlMs: OPTIONS_SOFT_TTL,
    hardTtlMs: OPTIONS_HARD_TTL,
    schemaVersion: 3,
    validator,
  })?.data ?? null;
  const previousCachedPutCount = previousCached?.puts?.length ?? null;

  const result = await requestMarketData<OptionsChainData>({
    key: cacheKey,
    source,
    endpoint: 'options',
    softTtlMs: OPTIONS_SOFT_TTL,
    hardTtlMs: OPTIONS_HARD_TTL,
    schemaVersion: 3,
    mode,
    priority: source.startsWith('Scanner:') ? 'bulk_manual' : fresh ? 'user_refresh' : 'interactive',
    allowStaleOnError: true,
    validator,
    fetcher: async signal => {
    let url = `${API_BASE}/options?ticker=${encodeURIComponent(normalizedTicker)}`;
    if (date) url += `&date=${date}`;
    if (fresh) url += `&fresh=1&_=${Date.now()}`;

    const res = await fetch(url, { signal, ...(fresh ? { cache: 'no-store' as RequestCache } : {}) });
    if (!res.ok) {
      const error = new Error(`Failed to fetch options for ${normalizedTicker}`) as Error & { status: number };
      error.status = res.status;
      throw error;
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    return normalizeOptionChainData(
      data,
      normalizedTicker,
      date,
      cacheKey,
      fresh ? 'fresh' : 'network',
      previousCachedPutCount
    );
    },
  });
  const normalized = result.meta.source === 'network'
    ? result.data
    : withCacheSource(result.data, cacheKey, result.meta.freshness === 'stale' || result.meta.staleFallbackUsed, result.meta.staleFallbackUsed);
  cacheScannerOptionChain(normalizedTicker, normalized);
  return normalized;
}

function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

export function calculatePutDelta(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return -0.5;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return normalCDF(d1) - 1;
}

export function blackScholesPutDelta(
  S: number, K: number, T: number, r: number, sigma: number
): number {
  return calculatePutDelta(S, K, T, r, sigma);
}

export function formatPrice(n: number | null): string {
  if (n == null) return '—';
  return n.toFixed(2);
}

export function formatYield(n: number): string {
  return n.toFixed(2) + '%';
}

export function yieldColor(annYield: number): string {
  if (annYield < 5) return '#64748b';
  if (annYield < 15) return '#eab308';
  if (annYield < 30) return '#f97316';
  return '#22c55e';
}

export function formatNumber(n: number | null): string {
  if (n == null || n === 0) return '—';
  return n.toLocaleString('en-US');
}

export interface SparklineData {
  price: number;
  change: number;
  changePercent: number;
  previousClose: number | null;
  sparkline: number[];
  cachedAt?: number;
}

export async function fetchSparkline(ticker: string): Promise<SparklineData> {
  const cacheKey = `sparkline_${ticker}`;
  return threeLayerCache<SparklineData>(
    cacheKey,
    SPARKLINE_MEM_TTL,
    SPARKLINE_LS_TTL,
    async () => {
      const res = await fetch(`${API_BASE}/price?ticker=${encodeURIComponent(ticker)}&range=1d&interval=1m`);
      if (!res.ok) throw new Error(`Failed to fetch sparkline for ${ticker}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      return {
        price: data.price,
        change: data.change,
        changePercent: data.changePct,
        previousClose: data.previousClose ?? null,
        sparkline: data.sparkline || [],
      };
    },
    undefined,
    {
      diagnosticsEndpoint: 'price',
      diagnosticsSource: 'fetchSparkline',
    }
  );
}

export interface ExtendedPriceData {
  price: number;
  change: number;
  changePercent: number;
  fiveDay: number | null;
  oneMonth: number | null;
  threeMonth: number | null;
  fiftyTwoWeekHighPct: number | null;
  previousClose: number | null;
  sparkline: number[];
}

export async function fetchExtendedPrice(ticker: string, options: { includeSparkline?: boolean } = {}): Promise<ExtendedPriceData> {
  const includeSparkline = options.includeSparkline === true;
  const cacheKey = `extended_price_${ticker}_${includeSparkline ? 'spark' : 'daily'}`;
  return threeLayerCache<ExtendedPriceData>(
    cacheKey,
    EXTENDED_PRICE_MEM_TTL,
    EXTENDED_PRICE_LS_TTL,
    async () => {
      const res = await fetch(`${API_BASE}/price?ticker=${encodeURIComponent(ticker)}&extended=true&includeSparkline=${includeSparkline ? 'true' : 'false'}`);
      if (!res.ok) throw new Error(`Failed to fetch extended price for ${ticker}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return {
        price: data.price,
        change: data.change,
        changePercent: data.changePct,
        fiveDay: data.fiveDay ?? null,
        oneMonth: data.oneMonth ?? null,
        threeMonth: data.threeMonth ?? null,
        fiftyTwoWeekHighPct: data.fiftyTwoWeekHighPct ?? null,
        previousClose: data.previousClose ?? null,
        sparkline: data.sparkline || [],
      };
    },
    undefined,
    {
      diagnosticsEndpoint: 'price',
      diagnosticsSource: includeSparkline ? 'fetchExtendedPrice:sparkline' : 'fetchExtendedPrice:daily',
    }
  );
}

export interface IVRankData {
  currentIV: number | null;
  ivRank: number | null;
  ivPercentile: number | null;
}

export async function fetchIVRank(ticker: string): Promise<IVRankData> {
  const normalizedTicker = ticker.trim().toUpperCase();
  return cachedRequest(
    makeCacheKey(['ivrank', normalizedTicker]),
    60 * 60 * 1000,
    async () => {
      const res = await fetch(`${API_BASE}/ivrank?ticker=${encodeURIComponent(normalizedTicker)}`);
      if (!res.ok) throw new Error(`Failed to fetch IV Rank for ${normalizedTicker}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return {
        currentIV: data.currentIV ?? null,
        ivRank: data.ivRank ?? null,
        ivPercentile: data.ivPercentile ?? null,
      };
    },
    {
      validator: data => (
        data != null &&
        typeof data === 'object' &&
        ('ivRank' in data || 'currentIV' in data || 'ivPercentile' in data)
      ),
      diagnosticsEndpoint: 'ivrank',
      diagnosticsSource: 'fetchIVRank',
    }
  );
}

// Concurrency-limited fetch for screener (Opt 4)
export async function fetchWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit = 5
): Promise<PromiseSettledResult<T>[]> {
  const results: Promise<T>[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const p = task();
    results.push(p);
    const e: Promise<void> = p.then(() => {
      executing.splice(executing.indexOf(e), 1);
    }).catch(() => {
      executing.splice(executing.indexOf(e), 1);
    });
    executing.push(e);
    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(results);
}

import type { OptionsChainData } from './types';
import { threeLayerCache, BATCH_PRICE_KEY, SPARKLINE_MEM_TTL, SPARKLINE_LS_TTL, EXTENDED_PRICE_MEM_TTL, EXTENDED_PRICE_LS_TTL } from './cache';
import type { BatchPriceData } from './cache';
import { cachedRequest, cachedRequestResult, makeCacheKey } from './dataCache';
import { cacheScannerOptionChain } from './scannerOptionSnapshot';
import { peekMarketData, requestMarketData, type DataFreshness, type RefreshMode } from './marketDataRequest';
import { normalizeFiniteNumber } from './marketDataNormalize';
import { normalizeOptionChainData } from './yahooOptionAdapter';
import { getOptionsCacheKey, isValidOptionsChain, RejectedOptionChainError, OPTIONS_CACHE_SCHEMA_VERSION, OPTIONS_HARD_TTL_MS, OPTIONS_SOFT_TTL_MS, primeOptionsMarketDataCache } from './optionChainCache';
import { fetchObservedMarketData } from './requestDiagnostics';
import { mapWithConcurrency } from '../../shared/concurrency.js';
import { calculatePutDelta } from './putDelta';

export { calculatePutDelta } from './putDelta';

const API_BASE = '/api';

interface FetchOptionsOptions {
  bypassCache?: boolean;
  fresh?: boolean;
  source?: string;
  refreshMode?: RefreshMode;
  signal?: AbortSignal;
}

const BATCH_PRICE_SOFT_TTL = 3 * 60 * 1000;
const BATCH_PRICE_HARD_TTL = 45 * 60 * 1000;
const OPTIONS_SOFT_TTL = OPTIONS_SOFT_TTL_MS;
const OPTIONS_HARD_TTL = OPTIONS_HARD_TTL_MS;

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
  fetchedAt: number;
  cacheSource: 'memory' | 'persistent' | 'network' | 'stale-fallback';
}

export async function fetchBatchPricesResult(tickers: string[], options: { mode?: RefreshMode; signal?: AbortSignal } = {}): Promise<BatchPriceRequestResult> {
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
    signal: options.signal,
    validator: data => isValidBatchResponse(data, normalizedTickers),
    fetcher: async signal => {
      const res = await fetchObservedMarketData('prices', `${API_BASE}/prices?tickers=${encodeURIComponent(normalizedTickers.join(','))}`, { signal }, 'fetchBatchPrices');
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
  return { data: result.data, freshness: result.meta.freshness, staleFallbackUsed: result.meta.staleFallbackUsed, fetchedAt: result.meta.fetchedAt, cacheSource: result.meta.source };
}

export async function fetchBatchPrices(tickers: string[], options: { mode?: RefreshMode; signal?: AbortSignal } = {}): Promise<BatchPriceData> {
  return (await fetchBatchPricesResult(tickers, options)).data;
}

export function primeOptionsChainCache(ticker: string, date: number | undefined, data: OptionsChainData): boolean {
  const normalizedTicker = ticker.trim().toUpperCase();
  const primed = primeOptionsMarketDataCache(normalizedTicker, date, data);
  if (primed) cacheScannerOptionChain(normalizedTicker, data);
  return primed;
}

function withRequestProvenance(data: OptionsChainData, cacheKey: string, meta: { source: string; fetchedAt: number; cachedAt?: number; staleFallbackUsed: boolean }): OptionsChainData {
  const retained = meta.staleFallbackUsed || meta.source === 'stale-fallback';
  const fetchedAt = retained
    ? data.chainMeta?.fetchedAt ?? meta.fetchedAt
    : meta.source === 'network' ? meta.fetchedAt : data.chainMeta?.fetchedAt ?? meta.fetchedAt;
  const source = retained ? 'stale' : meta.source === 'network' ? data.chainMeta?.source === 'fresh' ? 'fresh' : 'network' : 'cache';
  return {
    ...data,
    chainMeta: {
      ticker: data.chainMeta?.ticker ?? cacheKey.split('_')[2] ?? '',
      requestedExpiration: data.chainMeta?.requestedExpiration ?? null,
      returnedExpiration: data.chainMeta?.returnedExpiration ?? data.chainMeta?.expirationDate ?? null,
      expirationDate: data.chainMeta?.expirationDate ?? null,
      expirationEvidence: data.chainMeta?.expirationEvidence,
      fetchedAt,
      providerMarketTime: data.chainMeta?.providerMarketTime ?? null,
      // Cache reads preserve the original storage/observation time; read time must not refresh the quote.
      cachedAt: meta.cachedAt ?? data.chainMeta?.cachedAt ?? null,
      timestampSource: data.chainMeta?.timestampSource,
      source,
      freshness: retained ? 'stale' : 'fresh',
      staleFallbackUsed: retained,
      retentionReason: retained ? 'Refresh failed; the last usable chain was retained.' : null,
      fresh: source === 'fresh',
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
      integrity: data.chainMeta?.integrity,
    },
  };
}

export async function fetchOptions(ticker: string, date?: number, options: FetchOptionsOptions = {}): Promise<OptionsChainData> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const cacheKey = getOptionsCacheKey(normalizedTicker, date);
  const source = options.source ?? 'fetchOptions';
  const fresh = options.fresh === true;
  const mode: RefreshMode = fresh ? 'fresh' : options.refreshMode ?? (options.bypassCache ? 'revalidate' : 'cache-first');
  const validator = (value: OptionsChainData) => isValidOptionsChain(value, date ?? null);
  const previousCached = peekMarketData({
    key: cacheKey,
    softTtlMs: OPTIONS_SOFT_TTL,
    hardTtlMs: OPTIONS_HARD_TTL,
    schemaVersion: OPTIONS_CACHE_SCHEMA_VERSION,
    validator,
  })?.data ?? null;
  const previousCachedPutCount = previousCached?.puts?.length ?? null;

  const result = await requestMarketData<OptionsChainData>({
    key: cacheKey,
    source,
    endpoint: 'options',
    softTtlMs: OPTIONS_SOFT_TTL,
    hardTtlMs: OPTIONS_HARD_TTL,
    schemaVersion: OPTIONS_CACHE_SCHEMA_VERSION,
    mode,
    priority: source.startsWith('Scanner:') ? 'bulk_manual' : fresh ? 'user_refresh' : 'interactive',
    allowStaleOnError: true,
    signal: options.signal,
    validator,
    fetcher: async signal => {
    let url = `${API_BASE}/options?ticker=${encodeURIComponent(normalizedTicker)}&v=${OPTIONS_CACHE_SCHEMA_VERSION}`;
    if (date) url += `&date=${date}`;
    if (fresh) url += `&fresh=1&_=${Date.now()}`;

    const res = await fetchObservedMarketData('options', url, { signal, ...(fresh ? { cache: 'no-store' as RequestCache } : {}) }, source);
    if (!res.ok) {
      const error = new Error(`Failed to fetch options for ${normalizedTicker}`) as Error & { status: number };
      error.status = res.status;
      throw error;
    }
    const data = await res.json();
    if (data.error) throw new Error(data.error);

    const chain = normalizeOptionChainData(
      data,
      normalizedTicker,
      date,
      cacheKey,
      fresh ? 'fresh' : 'network',
      previousCachedPutCount
    );
    if (chain.chainMeta?.integrity?.status === 'invalid') throw new RejectedOptionChainError(chain);
    return chain;
    },
  });
  const normalized = withRequestProvenance(result.data, cacheKey, result.meta);
  cacheScannerOptionChain(normalizedTicker, normalized);
  return normalized;
}

export function blackScholesPutDelta(
  S: number, K: number, T: number, r: number, sigma: number
): number | null {
  return calculatePutDelta(S, K, T, r, sigma);
}

export function formatPrice(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(2);
}

export function formatYield(n: number): string {
  return Number.isFinite(n) ? n.toFixed(2) + '%' : '—';
}

export function yieldColor(annYield: number): string {
  if (annYield < 5) return '#64748b';
  if (annYield < 15) return '#eab308';
  if (annYield < 30) return '#f97316';
  return '#22c55e';
}

export function formatNumber(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('en-US');
}

export interface SparklineData {
  price: number;
  change: number;
  changePercent: number;
  previousClose: number | null;
  sparkline: number[];
  cachedAt?: number;
  providerMarketTime?: number | null;
}

export interface SparklineRequestResult {
  data: SparklineData;
  freshness: DataFreshness;
  source: 'memory' | 'persistent' | 'network' | 'stale-fallback';
  observedAt: number;
  cachedAt?: number;
  staleFallbackUsed: boolean;
}

function isSparklineData(value: SparklineData): boolean {
  return value != null
    && Number.isFinite(value.price)
    && Number.isFinite(value.change)
    && Number.isFinite(value.changePercent)
    && Array.isArray(value.sparkline);
}

export async function fetchSparklineResult(ticker: string, options: { mode?: RefreshMode; signal?: AbortSignal } = {}): Promise<SparklineRequestResult> {
  const cacheKey = `sparkline_${ticker}`;
  const result = await requestMarketData<SparklineData>({
    key: cacheKey,
    source: 'fetchSparkline',
    endpoint: 'price',
    softTtlMs: Math.min(SPARKLINE_MEM_TTL, SPARKLINE_LS_TTL),
    hardTtlMs: Math.max(SPARKLINE_LS_TTL * 4, SPARKLINE_LS_TTL + 30 * 60 * 1000),
    schemaVersion: 1,
    mode: options.mode ?? 'cache-first',
    allowStaleOnError: true,
    signal: options.signal,
    validator: isSparklineData,
    fetcher: async signal => {
      const res = await fetchObservedMarketData('price', `${API_BASE}/price?ticker=${encodeURIComponent(ticker)}&range=1d&interval=1m`, { signal }, 'fetchSparkline');
      if (!res.ok) throw new Error(`Failed to fetch sparkline for ${ticker}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return {
        price: data.price,
        change: data.change,
        changePercent: data.changePct,
        previousClose: data.previousClose ?? null,
        sparkline: data.sparkline || [],
        providerMarketTime: data.providerMarketTime ?? null,
      };
    },
  });
  return {
    data: result.data,
    freshness: result.meta.freshness,
    source: result.meta.source,
    observedAt: result.meta.observedAt ?? result.meta.fetchedAt,
    cachedAt: result.meta.cachedAt,
    staleFallbackUsed: result.meta.staleFallbackUsed,
  };
}

export async function fetchSparkline(ticker: string, options: { mode?: RefreshMode; signal?: AbortSignal } = {}): Promise<SparklineData> {
  return (await fetchSparklineResult(ticker, options)).data;
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
  providerMarketTime?: number | null;
}

export async function fetchExtendedPrice(ticker: string, options: { includeSparkline?: boolean } = {}): Promise<ExtendedPriceData> {
  const includeSparkline = options.includeSparkline === true;
  const cacheKey = `extended_price_${ticker}_${includeSparkline ? 'spark' : 'daily'}`;
  return threeLayerCache<ExtendedPriceData>(
    cacheKey,
    EXTENDED_PRICE_MEM_TTL,
    EXTENDED_PRICE_LS_TTL,
    async () => {
      const res = await fetchObservedMarketData('price', `${API_BASE}/price?ticker=${encodeURIComponent(ticker)}&extended=true&includeSparkline=${includeSparkline ? 'true' : 'false'}`, undefined, includeSparkline ? 'fetchExtendedPrice:sparkline' : 'fetchExtendedPrice:daily');
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
        providerMarketTime: data.providerMarketTime ?? null,
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

export interface VolatilityContextData {
  currentIV: number | null;
  rangePosition: number | null;
  observationPercent: number | null;
  realizedVolLow: number | null;
  realizedVolHigh: number | null;
  observationCount: number;
}

export async function fetchVolatilityContext(ticker: string): Promise<VolatilityContextData> {
  const normalizedTicker = ticker.trim().toUpperCase();
  return cachedRequest(
    makeCacheKey(['volatility-context', normalizedTicker]),
    60 * 60 * 1000,
    async () => {
      const res = await fetchObservedMarketData('volatility-context', `${API_BASE}/volatility-context?ticker=${encodeURIComponent(normalizedTicker)}`, undefined, 'fetchVolatilityContext');
      if (!res.ok) throw new Error(`Failed to fetch volatility context for ${normalizedTicker}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return {
        currentIV: data.currentIV ?? null,
        rangePosition: data.rangePosition ?? null,
        observationPercent: data.observationPercent ?? null,
        realizedVolLow: data.realizedVolLow ?? null,
        realizedVolHigh: data.realizedVolHigh ?? null,
        observationCount: Number.isFinite(data.observationCount) ? data.observationCount : 0,
      };
    },
    {
      validator: data => (
        data != null &&
        typeof data === 'object' &&
        ('rangePosition' in data || 'currentIV' in data || 'observationPercent' in data)
      ),
      diagnosticsEndpoint: 'volatility-context',
      diagnosticsSource: 'fetchVolatilityContext',
    }
  );
}

export type TickerDetailAvailability = 'optionable' | 'no_options';
export type TickerDetailErrorCode = 'INVALID_INPUT' | 'INVALID_SYMBOL' | 'PROVIDER_FAILURE';

export interface TickerDetailData {
  options: OptionsChainData;
  extendedPrice: ExtendedPriceData | null;
  volatilityContext: VolatilityContextData | null;
  availability: TickerDetailAvailability;
}

export async function fetchTickerDetail(
  ticker: string,
  date?: number,
  options: { bypassCache?: boolean; fresh?: boolean; signal?: AbortSignal } = {},
): Promise<TickerDetailData> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const cacheKey = makeCacheKey(['ticker-detail-v1', normalizedTicker, date]);
  const detailResult = await cachedRequestResult(
    cacheKey,
    5 * 60 * 1000,
    async signal => {
      let url = `${API_BASE}/ticker-detail?ticker=${encodeURIComponent(normalizedTicker)}&v=2`;
      if (date) url += `&date=${date}`;
      if (options.fresh) url += `&fresh=1&_=${Date.now()}`;
      const response = await fetchObservedMarketData('ticker-detail', url, { ...(options.fresh ? { cache: 'no-store' as RequestCache } : {}), signal }, 'fetchTickerDetail');
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const error = new Error(body.message || `We couldn't load options for ${normalizedTicker}.`) as Error & { status: number; code: TickerDetailErrorCode };
        error.status = response.status;
        error.code = body.code === 'INVALID_INPUT' || body.code === 'INVALID_SYMBOL' ? body.code : 'PROVIDER_FAILURE';
        throw error;
      }
      const normalizedOptions = normalizeOptionChainData(
        body.options,
        normalizedTicker,
        date,
        getOptionsCacheKey(normalizedTicker, date),
        options.fresh ? 'fresh' : 'network',
        null,
      );
      return {
        options: normalizedOptions,
        extendedPrice: body.extendedPrice ?? null,
        volatilityContext: body.volatilityContext ?? null,
        availability: body.availability === 'no_options' ? 'no_options' : 'optionable',
      } satisfies TickerDetailData;
    },
    {
      bypassCache: options.bypassCache || options.fresh,
      hardTtlMs: 45 * 60 * 1000,
      schemaVersion: 2,
      allowStaleOnError: !options.fresh,
      signal: options.signal,
      validator: value => value?.options != null && (
        (value.availability === 'optionable' && isValidOptionsChain(value.options, date ?? null))
        || (value.availability === 'no_options'
          && value.options.expirations.length === 0
          && value.options.puts.length === 0
          && (value.options.chainMeta?.callCount ?? 0) === 0
          && value.options.currentPrice > 0)
      ),
      diagnosticsEndpoint: 'ticker-detail',
      diagnosticsSource: 'fetchTickerDetail',
    },
  );
  const data = {
    ...detailResult.data,
    options: withRequestProvenance(detailResult.data.options, getOptionsCacheKey(normalizedTicker, date), detailResult.meta),
  };
  primeOptionsChainCache(normalizedTicker, date, data.options);
  return data;
}

// Concurrency-limited fetch for screener (Opt 4)
export async function fetchWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit = 5,
  options: { signal?: AbortSignal } = {},
): Promise<PromiseSettledResult<T>[]> {
  return mapWithConcurrency(tasks, limit, task => task(), { signal: options.signal });
}

import type { OptionsChainData, ExpirationDate, OptionContract, OptionChainSource } from './types';
import { threeLayerCache, BATCH_PRICE_KEY, SPARKLINE_MEM_TTL, SPARKLINE_LS_TTL, EXTENDED_PRICE_MEM_TTL, EXTENDED_PRICE_LS_TTL } from './cache';
import type { BatchPriceData } from './cache';
import { cachedRequest, makeCacheKey } from './dataCache';
import { cacheScannerOptionChain } from './scannerOptionSnapshot';
import { peekMarketData, requestMarketData, type DataFreshness, type RefreshMode } from './marketDataRequest';
import { normalizeFiniteNumber, normalizeNonNegativeNumber, normalizePositiveNumber, normalizeTimestampSeconds, normalizeYahooIvPercent } from './marketDataNormalize';

const API_BASE = '/api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

interface YahooOptionContract {
  contractSymbol?: string | null;
  contractSize?: string | null;
  currency?: string | null;
  inTheMoney?: boolean | null;
  strike?: number | null;
  lastPrice?: number | null;
  lastTradeDate?: number | null;
  bid?: number | null;
  ask?: number | null;
  delta?: number | null;
  gamma?: number | null;
  theta?: number | null;
  vega?: number | null;
  greeks?: {
    delta?: number | null;
    gamma?: number | null;
    theta?: number | null;
    vega?: number | null;
  };
  impliedVolatility?: number | null;
  volume?: number | null;
  openInterest?: number | null;
}

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

function calculateDTE(expirationTimestamp: number): number {
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiryDate = new Date(expirationTimestamp * 1000);
  const expiryUTC = Date.UTC(
    expiryDate.getUTCFullYear(),
    expiryDate.getUTCMonth(),
    expiryDate.getUTCDate()
  );
  const dte = Math.round((expiryUTC - todayUTC) / (1000 * 60 * 60 * 24));
  return Math.max(0, dte);
}

function formatExpirationLabel(timestamp: number, currentUtcYear: number): string {
  const d = new Date(timestamp * 1000);
  const monthDay = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const year = d.getUTCFullYear();
  return year !== currentUtcYear
    ? `${monthDay} '${String(year % 100).padStart(2, '0')}`
    : monthDay;
}

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

function strikeRange(contracts: YahooOptionContract[]): { min: number | null; max: number | null } {
  const strikes = contracts
    .map(contract => contract.strike)
    .filter((strike): strike is number => Number.isFinite(strike));
  if (strikes.length === 0) return { min: null, max: null };
  return { min: Math.min(...strikes), max: Math.max(...strikes) };
}

function preferContract(existing: OptionContract, incoming: OptionContract): OptionContract {
  const existingHasMarket = existing.bid != null || existing.ask != null || existing.last != null;
  const incomingHasMarket = incoming.bid != null || incoming.ask != null || incoming.last != null;
  if (incomingHasMarket && !existingHasMarket) return incoming;
  const existingTrade = existing.lastTradeDate ?? 0;
  const incomingTrade = incoming.lastTradeDate ?? 0;
  return incomingTrade > existingTrade ? incoming : existing;
}

function normalizeYahooContract(contract: YahooOptionContract): YahooOptionContract {
  return {
    ...contract,
    strike: normalizePositiveNumber(contract.strike),
    lastPrice: normalizeNonNegativeNumber(contract.lastPrice),
    lastTradeDate: normalizeTimestampSeconds(contract.lastTradeDate),
    bid: normalizeNonNegativeNumber(contract.bid),
    ask: normalizeNonNegativeNumber(contract.ask),
    delta: normalizeFiniteNumber(contract.delta),
    gamma: normalizeFiniteNumber(contract.gamma),
    theta: normalizeFiniteNumber(contract.theta),
    vega: normalizeFiniteNumber(contract.vega),
    greeks: contract.greeks ? {
      delta: normalizeFiniteNumber(contract.greeks.delta),
      gamma: normalizeFiniteNumber(contract.greeks.gamma),
      theta: normalizeFiniteNumber(contract.greeks.theta),
      vega: normalizeFiniteNumber(contract.greeks.vega),
    } : undefined,
    impliedVolatility: normalizePositiveNumber(contract.impliedVolatility),
    volume: normalizeNonNegativeNumber(contract.volume),
    openInterest: normalizeNonNegativeNumber(contract.openInterest),
  };
}

function mapYahooPut(p: YahooOptionContract & { strike: number }): OptionContract {
  const yahooDelta = normalizeFiniteNumber(p.greeks?.delta ?? p.delta);
  const delta = yahooDelta != null && yahooDelta !== 0
    ? (yahooDelta > 0 ? -yahooDelta : yahooDelta)
    : null;

  const iv = normalizeYahooIvPercent(p.impliedVolatility);

  return {
    strike: p.strike,
    last: normalizeNonNegativeNumber(p.lastPrice),
    lastTradeDate: normalizeTimestampSeconds(p.lastTradeDate),
    bid: normalizeNonNegativeNumber(p.bid),
    ask: normalizeNonNegativeNumber(p.ask),
    delta,
    gamma: p.greeks?.gamma ?? p.gamma ?? null,
    theta: p.greeks?.theta ?? p.theta ?? null,
    vega: p.greeks?.vega ?? p.vega ?? null,
    impliedVolatility: iv,
    volume: normalizeNonNegativeNumber(p.volume),
    openInterest: normalizeNonNegativeNumber(p.openInterest),
    contractSymbol: p.contractSymbol ?? null,
    rawLastPrice: p.lastPrice ?? null,
    rawBid: p.bid ?? null,
    rawAsk: p.ask ?? null,
    rawImpliedVolatility: p.impliedVolatility ?? null,
    rawOpenInterest: p.openInterest ?? null,
    rawVolume: p.volume ?? null,
    rawLastTradeDate: p.lastTradeDate ?? null,
  };
}

function parseYahooOptionSymbol(symbol: string | null | undefined): { expiration: number | null; type: 'C' | 'P' | null; strike: number | null } {
  if (!symbol) return { expiration: null, type: null, strike: null };
  const match = symbol.match(/(\d{6})([CP])(\d{8})$/);
  if (!match) return { expiration: null, type: null, strike: null };
  const [, yymmdd, type, strikeRaw] = match;
  const year = 2000 + Number(yymmdd.slice(0, 2));
  const month = Number(yymmdd.slice(2, 4));
  const day = Number(yymmdd.slice(4, 6));
  const expiration = Math.floor(Date.UTC(year, month - 1, day) / 1000);
  const strike = Number(strikeRaw) / 1000;
  return {
    expiration: Number.isFinite(expiration) ? expiration : null,
    type: type === 'P' || type === 'C' ? type : null,
    strike: Number.isFinite(strike) ? strike : null,
  };
}

function validateYahooPutContract(contract: YahooOptionContract, requestedExpiration: number | null, returnedExpiration: number | null): string[] {
  const warnings: string[] = [];
  if (!Number.isFinite(contract.strike)) warnings.push('Invalid or missing strike.');
  ([
    ['lastPrice', contract.lastPrice],
    ['bid', contract.bid],
    ['ask', contract.ask],
    ['impliedVolatility', contract.impliedVolatility],
    ['openInterest', contract.openInterest],
    ['volume', contract.volume],
    ['lastTradeDate', contract.lastTradeDate],
  ] as const).forEach(([label, value]) => {
    if (value != null && !Number.isFinite(value)) warnings.push(`${label} is not finite.`);
  });

  const parsed = parseYahooOptionSymbol(contract.contractSymbol);
  if (parsed.type && parsed.type !== 'P') warnings.push(`Contract symbol appears to be a ${parsed.type === 'C' ? 'call' : parsed.type}.`);
  const expectedExpiration = requestedExpiration ?? returnedExpiration;
  if (parsed.expiration != null && expectedExpiration != null && parsed.expiration !== expectedExpiration) {
    warnings.push(`Contract symbol expiration ${parsed.expiration} does not match expected ${expectedExpiration}.`);
  }
  if (parsed.strike != null && Number.isFinite(contract.strike) && Math.abs(parsed.strike - Number(contract.strike)) > 0.001) {
    warnings.push(`Contract symbol strike ${parsed.strike} does not match Yahoo strike ${contract.strike}.`);
  }
  return warnings;
}

function normalizeOptionChainData(
  data: unknown,
  ticker: string,
  date: number | undefined,
  cacheKey: string,
  source: OptionChainSource,
  previousCachedPutCount: number | null
): OptionsChainData {
  const result = (data as { optionChain?: { result?: unknown[] } })?.optionChain?.result?.[0] as {
    quote?: { regularMarketPrice?: number | null };
    expirationDates?: number[];
    options?: Array<{ puts?: YahooOptionContract[]; calls?: YahooOptionContract[]; expirationDate?: number }>;
  } | undefined;
  const fetchedAt = Date.now();
  if (!result) {
    return {
      expirations: [],
      puts: [],
      currentPrice: 0,
      chainMeta: {
        ticker,
        requestedExpiration: date ?? null,
        returnedExpiration: null,
        expirationDate: null,
        fetchedAt,
        source,
        fresh: source === 'fresh',
        cacheKey,
        putCount: 0,
        callCount: 0,
        putStrikeMin: null,
        putStrikeMax: null,
        callStrikeMin: null,
        callStrikeMax: null,
        yahooExpirationDatesCount: 0,
        previousCachedPutCount,
      },
    };
  }

  const currentPrice = normalizePositiveNumber(result.quote?.regularMarketPrice) ?? 0;
  const expDates = (result.expirationDates || []).map(normalizeTimestampSeconds).filter((value): value is number => value != null);
  const chain = result.options?.[0];
  const chainExpiration = normalizeTimestampSeconds(chain?.expirationDate) ?? date ?? null;
  const requestedExpiration = date ?? null;
  const validationWarnings: string[] = [];
  if (requestedExpiration != null && chainExpiration != null && requestedExpiration !== chainExpiration) {
    validationWarnings.push(`Requested expiration ${requestedExpiration} but Yahoo returned ${chainExpiration}.`);
  }
  const putsRaw: YahooOptionContract[] = (chain?.puts ?? []).map(normalizeYahooContract);
  const callsRaw: YahooOptionContract[] = (chain?.calls ?? []).map(normalizeYahooContract);
  const putRange = strikeRange(putsRaw);
  const callRange = strikeRange(callsRaw);
  const currentYear = new Date().getUTCFullYear();

  const expirations: ExpirationDate[] = expDates.map((ts: number) => {
    const dte = calculateDTE(ts);
    const label = formatExpirationLabel(ts, currentYear);
    return { date: ts, label, dte };
  });

  const putsByStrike = new Map<number, OptionContract>();
  putsRaw
    .filter((p): p is YahooOptionContract & { strike: number } => {
      const warnings = validateYahooPutContract(p, requestedExpiration, chainExpiration);
      warnings.forEach(warning => validationWarnings.push(`${p.contractSymbol ?? `strike ${p.strike ?? 'unknown'}`}: ${warning}`));
      const parsed = parseYahooOptionSymbol(p.contractSymbol);
      return Number.isFinite(p.strike) && parsed.type !== 'C';
    })
    .forEach(p => {
      const put = mapYahooPut(p);
      const existing = putsByStrike.get(put.strike);
      putsByStrike.set(put.strike, existing ? preferContract(existing, put) : put);
    });

  const puts = [...putsByStrike.values()].sort((a, b) => a.strike - b.strike);

  return {
    expirations,
    puts,
    currentPrice,
    chainMeta: {
      ticker,
      requestedExpiration,
      returnedExpiration: chainExpiration,
      expirationDate: chainExpiration,
      fetchedAt,
      source,
      fresh: source === 'fresh',
      cacheKey,
      putCount: puts.length,
      callCount: callsRaw.length,
      putStrikeMin: putRange.min,
      putStrikeMax: putRange.max,
      callStrikeMin: callRange.min,
      callStrikeMax: callRange.max,
      yahooExpirationDatesCount: expDates.length,
      previousCachedPutCount,
      validationWarnings,
    },
  };
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

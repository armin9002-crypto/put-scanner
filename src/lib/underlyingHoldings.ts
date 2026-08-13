import { clearMarketDataCache, peekMarketData, requestMarketData } from './marketDataRequest';

export interface UnderlyingHolding {
  symbol: string;
  name: string;
  weight: number | null;
}

export interface UnderlyingHoldingsData {
  ticker: string;
  name: string;
  holdings: UnderlyingHolding[];
  topHoldingsCount: number;
  topHoldingsWeight: number | null;
  source: string;
  fetchedAt: number;
  unavailableReason?: string;
  errorCachedUntil?: number;
}

const HOLDINGS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const HOLDINGS_HARD_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const HOLDINGS_ERROR_TTL_MS = 15 * 60 * 1000;

function cacheKey(proxyTicker: string): string {
  return `underlying_holdings_v1_${proxyTicker.trim().toUpperCase()}`;
}

function normalizeTicker(proxyTicker: string): string {
  return proxyTicker.trim().toUpperCase();
}

function isValidHoldingsData(data: UnderlyingHoldingsData): boolean {
  if (typeof data.errorCachedUntil === 'number' && Date.now() > data.errorCachedUntil) return false;
  return !!data &&
    typeof data.ticker === 'string' &&
    Array.isArray(data.holdings) &&
    typeof data.fetchedAt === 'number';
}

export function getCachedUnderlyingHoldings(proxyTicker: string): UnderlyingHoldingsData | null {
  return peekMarketData<UnderlyingHoldingsData>({
    key: cacheKey(proxyTicker),
    softTtlMs: HOLDINGS_TTL_MS,
    hardTtlMs: HOLDINGS_HARD_TTL_MS,
    schemaVersion: 2,
    validator: isValidHoldingsData,
  })?.data ?? null;
}

export function clearUnderlyingHoldingsCache(proxyTicker: string): void {
  clearMarketDataCache(cacheKey(proxyTicker));
}

export async function fetchUnderlyingHoldings(
  proxyTicker: string,
  options: { bypassCache?: boolean } = {}
): Promise<UnderlyingHoldingsData> {
  const ticker = normalizeTicker(proxyTicker);
  const key = cacheKey(ticker);

  try {
    const result = await requestMarketData<UnderlyingHoldingsData>({
      key,
      source: 'fetchUnderlyingHoldings',
      endpoint: 'holdings',
      softTtlMs: HOLDINGS_TTL_MS,
      hardTtlMs: HOLDINGS_HARD_TTL_MS,
      schemaVersion: 2,
      mode: options.bypassCache ? 'revalidate' : 'cache-first',
      allowStaleOnError: true,
      validator: isValidHoldingsData,
      fetcher: async signal => {
    const response = await fetch(`/api/holdings?ticker=${encodeURIComponent(ticker)}`, { signal });
    if (!response.ok) {
      throw new Error(`Unable to load holdings for ${ticker}.`);
    }

    const data = await response.json() as UnderlyingHoldingsData;
    const normalized: UnderlyingHoldingsData = {
      ticker: normalizeTicker(data.ticker || ticker),
      name: data.name || ticker,
      holdings: Array.isArray(data.holdings)
        ? data.holdings.map(holding => ({
            symbol: holding.symbol || '',
            name: holding.name || holding.symbol || 'Unknown',
            weight: typeof holding.weight === 'number' && Number.isFinite(holding.weight) ? holding.weight : null,
          }))
        : [],
      topHoldingsCount: Number.isFinite(data.topHoldingsCount) ? data.topHoldingsCount : 0,
      topHoldingsWeight: typeof data.topHoldingsWeight === 'number' && Number.isFinite(data.topHoldingsWeight) ? data.topHoldingsWeight : null,
      source: data.source || 'Yahoo Finance',
      fetchedAt: typeof data.fetchedAt === 'number' ? data.fetchedAt : Date.now(),
      unavailableReason: data.unavailableReason,
      errorCachedUntil: data.errorCachedUntil,
    };

    return normalized;
      },
    });
    return result.data;
  } catch {
    return {
      ticker,
      name: ticker,
      holdings: [],
      topHoldingsCount: 0,
      topHoldingsWeight: null,
      source: 'Yahoo Finance',
      fetchedAt: Date.now(),
      unavailableReason: `Unable to load holdings for ${ticker}.`,
      errorCachedUntil: Date.now() + HOLDINGS_ERROR_TTL_MS,
    };
  }
}

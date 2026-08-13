import { makeCacheKey } from './dataCache.ts';
import { peekMarketData, requestMarketData, type DataFreshness } from './marketDataRequest.ts';

export type ChartTimeframe = '1D' | '5D' | '30D' | 'YTD' | '3M' | '6M' | '1Y' | '2Y' | '3Y' | '5Y' | 'All';

export interface ChartPoint {
  timestamp: number;
  date: string;
  price: number;
}

export interface ChartHistoryResponse {
  ticker: string;
  displayTicker: string;
  timeframe: ChartTimeframe;
  points: ChartPoint[];
  previousClose?: number | null;
  latestPrice?: number | null;
  fetchedAt: number;
  freshness?: DataFreshness;
  staleFallbackUsed?: boolean;
  metadata?: {
    range?: string;
    interval?: string;
    sourcePoints?: number;
    derivedFrom?: ChartTimeframe;
  };
}

const CHART_TTLS: Record<ChartTimeframe, number> = {
  '1D': 2 * 60 * 1000,
  '5D': 5 * 60 * 1000,
  '30D': 30 * 60 * 1000,
  YTD: 4 * 60 * 60 * 1000,
  '3M': 2 * 60 * 60 * 1000,
  '6M': 4 * 60 * 60 * 1000,
  '1Y': 6 * 60 * 60 * 1000,
  '2Y': 6 * 60 * 60 * 1000,
  '3Y': 12 * 60 * 60 * 1000,
  '5Y': 12 * 60 * 60 * 1000,
  All: 24 * 60 * 60 * 1000,
};

const CHART_HARD_TTLS: Record<ChartTimeframe, number> = {
  '1D': 30 * 60 * 1000,
  '5D': 2 * 60 * 60 * 1000,
  '30D': 24 * 60 * 60 * 1000,
  YTD: 48 * 60 * 60 * 1000,
  '3M': 48 * 60 * 60 * 1000,
  '6M': 48 * 60 * 60 * 1000,
  '1Y': 72 * 60 * 60 * 1000,
  '2Y': 72 * 60 * 60 * 1000,
  '3Y': 7 * 24 * 60 * 60 * 1000,
  '5Y': 7 * 24 * 60 * 60 * 1000,
  All: 14 * 24 * 60 * 60 * 1000,
};

const DAILY_HISTORY_FAMILIES: Partial<Record<ChartTimeframe, ChartTimeframe[]>> = {
  '3M': ['6M', '1Y', '2Y'],
  '6M': ['1Y', '2Y'],
  YTD: ['1Y', '2Y'],
  '1Y': ['2Y'],
};

const WEEKLY_HISTORY_FAMILIES: Partial<Record<ChartTimeframe, ChartTimeframe[]>> = {
  '3Y': ['5Y'],
};

function cacheKey(ticker: string, timeframe: ChartTimeframe): string {
  return makeCacheKey(['chart_history_cache', ticker, timeframe]);
}

function isValidChartHistory(value: unknown, timeframe: ChartTimeframe): value is ChartHistoryResponse {
  if (!value || typeof value !== 'object') return false;
  const data = value as ChartHistoryResponse;
  return (
    data.timeframe === timeframe &&
    typeof data.ticker === 'string' &&
    typeof data.displayTicker === 'string' &&
    typeof data.fetchedAt === 'number' &&
    Array.isArray(data.points) &&
    data.points.every(point =>
      point &&
      Number.isFinite(point.timestamp) &&
      typeof point.date === 'string' &&
      Number.isFinite(point.price)
    )
  );
}

function clipStart(timeframe: ChartTimeframe, now = new Date()): number | null {
  const start = new Date(now);
  if (timeframe === 'YTD') start.setUTCMonth(0, 1);
  else if (timeframe === '3M') start.setUTCMonth(start.getUTCMonth() - 3);
  else if (timeframe === '6M') start.setUTCMonth(start.getUTCMonth() - 6);
  else if (timeframe === '1Y') start.setUTCFullYear(start.getUTCFullYear() - 1);
  else if (timeframe === '3Y') start.setUTCFullYear(start.getUTCFullYear() - 3);
  else return null;
  start.setUTCHours(0, 0, 0, 0);
  return Math.floor(start.getTime() / 1000);
}

function findReusableHistory(ticker: string, timeframe: ChartTimeframe): ChartHistoryResponse | null {
  const cutoff = clipStart(timeframe);
  if (cutoff == null) return null;
  const candidates = [
    ...(DAILY_HISTORY_FAMILIES[timeframe] ?? []).map(candidate => ({ candidate, interval: '1d' })),
    ...(WEEKLY_HISTORY_FAMILIES[timeframe] ?? []).map(candidate => ({ candidate, interval: '1wk' })),
  ];
  for (const { candidate, interval } of candidates) {
    const cached = peekMarketData<ChartHistoryResponse>({
      key: cacheKey(ticker, candidate),
      softTtlMs: CHART_TTLS[candidate],
      hardTtlMs: CHART_HARD_TTLS[candidate],
      schemaVersion: 2,
      validator: data => isValidChartHistory(data, candidate) && data.metadata?.interval === interval,
    });
    if (!cached || cached.meta.freshness === 'expired') continue;
    const points = cached.data.points.filter(point => point.timestamp >= cutoff);
    if (points.length < 2) continue;
    return {
      ...cached.data,
      timeframe,
      points,
      freshness: cached.meta.freshness,
      staleFallbackUsed: false,
      metadata: { ...cached.data.metadata, sourcePoints: points.length, derivedFrom: candidate },
    };
  }
  return null;
}

export async function getChartHistory(
  ticker: string,
  timeframe: ChartTimeframe,
  options: { forceRefresh?: boolean } = {}
): Promise<ChartHistoryResponse> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const key = cacheKey(normalizedTicker, timeframe);

  if (!options.forceRefresh) {
    const exact = peekMarketData<ChartHistoryResponse>({
      key,
      softTtlMs: CHART_TTLS[timeframe],
      hardTtlMs: CHART_HARD_TTLS[timeframe],
      schemaVersion: 2,
      validator: data => isValidChartHistory(data, timeframe),
    });
    if (exact && exact.meta.freshness !== 'expired') {
      return { ...exact.data, freshness: exact.meta.freshness, staleFallbackUsed: false };
    }
    const reusable = findReusableHistory(normalizedTicker, timeframe);
    if (reusable) return reusable;
  }

  const result = await requestMarketData<ChartHistoryResponse>({
    key,
    source: `getChartHistory:${timeframe}`,
    endpoint: 'chart-history',
    softTtlMs: CHART_TTLS[timeframe],
    hardTtlMs: CHART_HARD_TTLS[timeframe],
    schemaVersion: 2,
    mode: options.forceRefresh ? 'revalidate' : 'cache-first',
    allowStaleOnError: true,
    validator: data => isValidChartHistory(data, timeframe),
    fetcher: async signal => {
      const response = await fetch(`/api/chart-history?ticker=${encodeURIComponent(normalizedTicker)}&timeframe=${encodeURIComponent(timeframe)}`, { signal });
      if (!response.ok) {
        const error = new Error('Failed to fetch chart history') as Error & { status: number };
        error.status = response.status;
        throw error;
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }
      if (!isValidChartHistory(data, timeframe)) {
        throw new Error('Invalid chart history response');
      }
      return data;
    },
  });
  return { ...result.data, freshness: result.meta.freshness, staleFallbackUsed: result.meta.staleFallbackUsed };
}

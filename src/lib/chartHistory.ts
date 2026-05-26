import { cachedRequest, makeCacheKey } from './dataCache';

export type ChartTimeframe = '1D' | '5D' | '30D' | 'YTD' | '3M' | '6M' | '1Y' | '3Y' | '5Y' | 'All';

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
  metadata?: {
    range?: string;
    interval?: string;
    sourcePoints?: number;
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
  '3Y': 12 * 60 * 60 * 1000,
  '5Y': 12 * 60 * 60 * 1000,
  All: 24 * 60 * 60 * 1000,
};

function cacheKey(ticker: string, timeframe: ChartTimeframe): string {
  return makeCacheKey(['chart_history_cache', ticker, timeframe]);
}

function isFresh(data: ChartHistoryResponse, timeframe: ChartTimeframe): boolean {
  return Date.now() - data.fetchedAt < CHART_TTLS[timeframe];
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

export async function getChartHistory(
  ticker: string,
  timeframe: ChartTimeframe,
  options: { forceRefresh?: boolean } = {}
): Promise<ChartHistoryResponse> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const key = cacheKey(normalizedTicker, timeframe);

  return cachedRequest(
    key,
    CHART_TTLS[timeframe],
    async () => {
      const response = await fetch(`/api/chart-history?ticker=${encodeURIComponent(normalizedTicker)}&timeframe=${encodeURIComponent(timeframe)}`);
      if (!response.ok) {
        throw new Error('Failed to fetch chart history');
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
    {
      bypassCache: options.forceRefresh,
      validator: (data) => isValidChartHistory(data, timeframe) && isFresh(data, timeframe),
    }
  );
}

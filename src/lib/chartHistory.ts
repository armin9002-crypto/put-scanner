export type ChartTimeframe = '1D' | '5D' | '30D' | '3M' | '6M' | '1Y' | '3Y' | '5Y' | 'All';

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
  '3M': 2 * 60 * 60 * 1000,
  '6M': 4 * 60 * 60 * 1000,
  '1Y': 6 * 60 * 60 * 1000,
  '3Y': 12 * 60 * 60 * 1000,
  '5Y': 12 * 60 * 60 * 1000,
  All: 24 * 60 * 60 * 1000,
};

const memoryCache = new Map<string, ChartHistoryResponse>();

function cacheKey(ticker: string, timeframe: ChartTimeframe): string {
  return `chart_history_cache:${ticker}:${timeframe}`;
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

function readLocalCache(key: string, timeframe: ChartTimeframe): ChartHistoryResponse | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidChartHistory(parsed, timeframe)) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeLocalCache(key: string, data: ChartHistoryResponse): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Storage can be unavailable or full; memory cache still protects this session.
  }
}

export async function getChartHistory(
  ticker: string,
  timeframe: ChartTimeframe,
  options: { forceRefresh?: boolean } = {}
): Promise<ChartHistoryResponse> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const key = cacheKey(normalizedTicker, timeframe);

  if (!options.forceRefresh) {
    const memoryHit = memoryCache.get(key);
    if (memoryHit && isFresh(memoryHit, timeframe)) return memoryHit;

    const localHit = readLocalCache(key, timeframe);
    if (localHit && isFresh(localHit, timeframe)) {
      memoryCache.set(key, localHit);
      return localHit;
    }
  }

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

  memoryCache.set(key, data);
  writeLocalCache(key, data);
  return data;
}

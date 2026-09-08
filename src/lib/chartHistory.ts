import { makeCacheKey } from './dataCache.ts';
import { peekMarketData, requestMarketData, type DataFreshness } from './marketDataRequest.ts';
import { fetchObservedMarketData } from './requestDiagnostics.ts';
import { buildCanonicalYtdView, marketYearForAsOf } from '../../shared/ytdBaseline.js';

export type ChartTimeframe = '1D' | '5D' | '30D' | 'YTD' | '3M' | '6M' | '1Y' | '2Y' | '3Y' | '5Y' | 'All';

export interface ChartPoint {
  timestamp: number;
  date: string;
  price: number;
}

export interface ChartYtdBaseline extends ChartPoint {
  marketDate: string;
}

export interface ChartCorporateAction {
  type: 'split' | 'dividend' | 'capital_gain';
  timestamp: number;
  date: string;
  splitRatio?: string | null;
  numerator?: number | null;
  denominator?: number | null;
  amount?: number | null;
}

export interface ChartHistoryResponse {
  ticker: string;
  displayTicker: string;
  timeframe: ChartTimeframe;
  points: ChartPoint[];
  corporateActions: ChartCorporateAction[];
  previousClose?: number | null;
  latestPrice?: number | null;
  providerMarketTime?: number | null;
  ytdBaseline?: ChartYtdBaseline | null;
  ytdPreYearPoints?: ChartPoint[];
  fetchedAt: number;
  freshness?: DataFreshness;
  staleFallbackUsed?: boolean;
  metadata?: {
    range?: string;
    interval?: string;
    sourcePoints?: number;
    derivedFrom?: ChartTimeframe;
    ytdMarketYear?: number;
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

function cacheSchemaVersion(timeframe: ChartTimeframe): number {
  return timeframe === 'YTD' ? 4 : 3;
}

function isValidChartPoint(point: unknown): point is ChartPoint {
  if (!point || typeof point !== 'object') return false;
  const candidate = point as ChartPoint;
  return Number.isFinite(candidate.timestamp) && typeof candidate.date === 'string' && Number.isFinite(candidate.price);
}

function isValidYtdContract(data: ChartHistoryResponse): boolean {
  if (!('ytdBaseline' in data) || !Array.isArray(data.ytdPreYearPoints)) return false;
  if (!data.ytdPreYearPoints.every(isValidChartPoint)) return false;
  if (data.ytdBaseline != null && (!isValidChartPoint(data.ytdBaseline)
    || typeof data.ytdBaseline.marketDate !== 'string' || data.ytdBaseline.price <= 0)) return false;
  const view = buildCanonicalYtdView([...data.ytdPreYearPoints, ...data.points], new Date());
  const samePoint = (left: ChartPoint, right: ChartPoint) => left.timestamp === right.timestamp && left.price === right.price;
  return data.metadata?.ytdMarketYear === view.marketYear
    && view.points.length === data.points.length
    && view.points.every((point, index) => samePoint(point, data.points[index]))
    && view.preYearPoints.length === data.ytdPreYearPoints.length
    && view.preYearPoints.every((point, index) => samePoint(point, data.ytdPreYearPoints?.[index] as ChartPoint))
    && (view.baseline == null
      ? data.ytdBaseline == null
      : data.ytdBaseline != null && view.baseline.marketDate === data.ytdBaseline.marketDate
        && samePoint(view.baseline, data.ytdBaseline));
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
    Array.isArray(data.corporateActions) &&
    data.corporateActions.every(action =>
      action &&
      (action.type === 'split' || action.type === 'dividend' || action.type === 'capital_gain') &&
      Number.isFinite(action.timestamp) &&
      typeof action.date === 'string'
    ) &&
    data.points.every(isValidChartPoint) &&
    (timeframe !== 'YTD' || (
      data.metadata?.ytdMarketYear === marketYearForAsOf(new Date()) && isValidYtdContract(data)
    ))
  );
}

function clipStart(timeframe: ChartTimeframe, now = new Date()): number | null {
  const start = new Date(now);
  if (timeframe === '3M') start.setUTCMonth(start.getUTCMonth() - 3);
  else if (timeframe === '6M') start.setUTCMonth(start.getUTCMonth() - 6);
  else if (timeframe === '1Y') start.setUTCFullYear(start.getUTCFullYear() - 1);
  else if (timeframe === '3Y') start.setUTCFullYear(start.getUTCFullYear() - 3);
  else return null;
  start.setUTCHours(0, 0, 0, 0);
  return Math.floor(start.getTime() / 1000);
}

export function deriveYtdChartHistory(history: ChartHistoryResponse, asOf: Date | number | string = new Date()): ChartHistoryResponse {
  const view = buildCanonicalYtdView(history.points, asOf);
  return {
    ...history,
    timeframe: 'YTD',
    points: view.points,
    ytdBaseline: view.baseline,
    ytdPreYearPoints: view.preYearPoints,
    metadata: {
      ...history.metadata,
      sourcePoints: view.points.length,
      ytdMarketYear: view.marketYear ?? undefined,
    },
  };
}

function findReusableHistory(ticker: string, timeframe: ChartTimeframe): ChartHistoryResponse | null {
  const cutoff = timeframe === 'YTD' ? null : clipStart(timeframe);
  if (timeframe !== 'YTD' && cutoff == null) return null;
  const candidates = [
    ...(DAILY_HISTORY_FAMILIES[timeframe] ?? []).map(candidate => ({ candidate, interval: '1d' })),
    ...(WEEKLY_HISTORY_FAMILIES[timeframe] ?? []).map(candidate => ({ candidate, interval: '1wk' })),
  ];
  for (const { candidate, interval } of candidates) {
    const cached = peekMarketData<ChartHistoryResponse>({
      key: cacheKey(ticker, candidate),
      softTtlMs: CHART_TTLS[candidate],
      hardTtlMs: CHART_HARD_TTLS[candidate],
      schemaVersion: cacheSchemaVersion(candidate),
      validator: data => isValidChartHistory(data, candidate) && data.metadata?.interval === interval,
    });
    if (!cached || cached.meta.freshness === 'expired') continue;
    if (timeframe === 'YTD') {
      const derived = deriveYtdChartHistory(cached.data);
      if (derived.points.length === 0) continue;
      return {
        ...derived,
        freshness: cached.meta.freshness,
        staleFallbackUsed: false,
        metadata: { ...derived.metadata, derivedFrom: candidate },
      };
    }
    const points = cached.data.points.filter(point => point.timestamp >= (cutoff as number));
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

export function findCachedDailyHistoryForDates(ticker: string, dates: string[]): ChartHistoryResponse | null {
  const normalizedTicker = ticker.trim().toUpperCase();
  const targets = [...new Set(dates.filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date)))];
  if (targets.length === 0) return null;
  const candidates: ChartTimeframe[] = ['2Y', '1Y', 'YTD', '6M', '3M'];
  for (const timeframe of candidates) {
    const cached = peekMarketData<ChartHistoryResponse>({
      key: cacheKey(normalizedTicker, timeframe),
      softTtlMs: CHART_TTLS[timeframe],
      hardTtlMs: CHART_HARD_TTLS[timeframe],
      schemaVersion: cacheSchemaVersion(timeframe),
      validator: data => isValidChartHistory(data, timeframe) && data.metadata?.interval === '1d',
    });
    if (!cached || cached.meta.freshness === 'expired') continue;
    const pointDates = [...(cached.data.ytdPreYearPoints ?? []), ...cached.data.points]
      .map(point => point.date.slice(0, 10))
      .sort();
    const coversTargets = targets.every(target => {
      const nearestPrior = [...pointDates].reverse().find(pointDate => pointDate <= target);
      if (!nearestPrior) return false;
      const gapDays = (Date.parse(`${target}T00:00:00Z`) - Date.parse(`${nearestPrior}T00:00:00Z`)) / 86_400_000;
      return gapDays >= 0 && gapDays <= 7;
    });
    if (coversTargets) {
      return { ...cached.data, freshness: cached.meta.freshness, staleFallbackUsed: false };
    }
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
      schemaVersion: cacheSchemaVersion(timeframe),
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
    schemaVersion: cacheSchemaVersion(timeframe),
    mode: options.forceRefresh ? 'revalidate' : 'cache-first',
    allowStaleOnError: true,
    validator: data => isValidChartHistory(data, timeframe),
    fetcher: async signal => {
      const cacheContract = timeframe === 'YTD' ? '&v=2' : '';
      const response = await fetchObservedMarketData('chart-history', `/api/chart-history?ticker=${encodeURIComponent(normalizedTicker)}&timeframe=${encodeURIComponent(timeframe)}${cacheContract}`, { signal }, `chartHistory:${timeframe}`);
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

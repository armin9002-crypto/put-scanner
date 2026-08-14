import { makeCacheKey } from './dataCache.ts';
import { findCachedDailyHistoryForDates, type ChartPoint } from './chartHistory.ts';
import { requestMarketData } from './marketDataRequest.ts';
import { isFiniteNumber } from './optionMetrics.ts';
import type { PortfolioEntryVixSource, PortfolioTrade } from './portfolioStorage.ts';

interface HistoricalVixResponse {
  ticker: string;
  timeframe: 'custom';
  points: ChartPoint[];
  fetchedAt: number;
  metadata?: { interval?: string };
}

export interface EntryVixClose {
  close: number;
  closeDate: string;
  source: PortfolioEntryVixSource;
}

export interface PortfolioEntryVixResult {
  trades: PortfolioTrade[];
  changed: boolean;
  networkRequests: number;
  resolved: number;
  unresolved: number;
}

const ENTRY_VIX_TTL = 3650 * 24 * 60 * 60 * 1000;

function isIsoDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function pointDate(point: ChartPoint): string | null {
  if (isIsoDate(point.date.slice(0, 10))) return point.date.slice(0, 10);
  const timestamp = point.timestamp * 1000;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : null;
}

function addDays(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function isValidHistory(value: unknown): value is HistoricalVixResponse {
  if (!value || typeof value !== 'object') return false;
  const data = value as HistoricalVixResponse;
  return data.ticker === '^VIX'
    && data.timeframe === 'custom'
    && typeof data.fetchedAt === 'number'
    && Array.isArray(data.points)
    && data.points.every(point => point && isFiniteNumber(point.timestamp) && typeof point.date === 'string' && isFiniteNumber(point.price));
}

export function selectEntryVixClose(points: ChartPoint[], entryDate: string): EntryVixClose | null {
  if (!isIsoDate(entryDate)) return null;
  const candidates = points
    .map(point => ({ date: pointDate(point), close: point.price }))
    .filter((point): point is { date: string; close: number } => point.date != null && isFiniteNumber(point.close) && point.date <= entryDate)
    .sort((a, b) => b.date.localeCompare(a.date));
  const selected = candidates.find(point => point.date === entryDate) ?? candidates[0];
  return selected ? {
    close: selected.close,
    closeDate: selected.date,
    source: selected.date === entryDate ? 'historical_close' : 'nearest_prior_close',
  } : null;
}

export function unresolvedEntryVixDates(trades: PortfolioTrade[]): string[] {
  return [...new Set(trades
    .filter(trade => trade.status === 'open' && !isFiniteNumber(trade.entryVixClose) && isIsoDate(trade.soldDate))
    .map(trade => trade.soldDate))]
    .sort();
}

export function resolveEntryVixFromPoints(trades: PortfolioTrade[], points: ChartPoint[], nowIso = new Date().toISOString()): PortfolioEntryVixResult {
  let resolved = 0;
  const next = trades.map(trade => {
    if (trade.status !== 'open' || isFiniteNumber(trade.entryVixClose) || !isIsoDate(trade.soldDate)) return trade;
    const value = selectEntryVixClose(points, trade.soldDate);
    if (!value) return trade;
    resolved += 1;
    return {
      ...trade,
      entryVixClose: value.close,
      entryVixDate: value.closeDate,
      entryVixSource: value.source,
      updatedAt: nowIso,
    };
  });
  return {
    trades: next,
    changed: resolved > 0,
    networkRequests: 0,
    resolved,
    unresolved: unresolvedEntryVixDates(next).length,
  };
}

export async function resolvePortfolioEntryVix(trades: PortfolioTrade[]): Promise<PortfolioEntryVixResult> {
  const dates = unresolvedEntryVixDates(trades);
  if (dates.length === 0) return { trades, changed: false, networkRequests: 0, resolved: 0, unresolved: 0 };

  const cachedChart = findCachedDailyHistoryForDates('^VIX', dates);
  if (cachedChart) return resolveEntryVixFromPoints(trades, cachedChart.points);

  const start = addDays(dates[0], -7);
  const end = addDays(dates[dates.length - 1], 2);
  const result = await requestMarketData<HistoricalVixResponse>({
    key: makeCacheKey(['portfolio_entry_vix', start, end]),
    source: 'Portfolio:entryVix',
    endpoint: 'chart-history',
    softTtlMs: ENTRY_VIX_TTL,
    hardTtlMs: ENTRY_VIX_TTL,
    schemaVersion: 1,
    mode: 'cache-first',
    allowStaleOnError: true,
    validator: isValidHistory,
    fetcher: async signal => {
      const response = await fetch(`/api/chart-history?ticker=${encodeURIComponent('^VIX')}&start=${start}&end=${end}`, { signal });
      if (!response.ok) throw new Error('Failed to fetch historical VIX closes');
      const data = await response.json();
      if (data.error || !isValidHistory(data)) throw new Error(data.error || 'Invalid historical VIX response');
      return data;
    },
  });
  const resolved = resolveEntryVixFromPoints(trades, result.data.points);
  return { ...resolved, networkRequests: result.meta.networkCall ? 1 : 0 };
}

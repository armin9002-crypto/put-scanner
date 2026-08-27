import { cachedRequest, makeCacheKey } from './dataCache.ts';
import { isFiniteNumber } from './optionMetrics.ts';
import { calculatePremiumCollected } from './portfolioMetrics.ts';
import type { PortfolioResolutionSource, PortfolioTrade } from './portfolioStorage';
import { findCachedDailyHistoryForDates, type ChartPoint } from './chartHistory.ts';
import { mapWithConcurrency } from '../../shared/concurrency.js';
import { fetchObservedMarketData } from './requestDiagnostics.ts';

interface HistoricalClosePoint {
  timestamp: number;
  date: string;
  price: number;
}

interface HistoricalCloseResponse {
  ticker: string;
  timeframe: 'custom';
  points: HistoricalClosePoint[];
  fetchedAt: number;
}

export interface ExpirationCloseResult {
  closePrice: number;
  closeDate: string;
  warning?: string;
}

export function selectExpirationClose(
  points: Array<{ timestamp: number; date: string; price: number }>,
  expirationDate: string,
): ExpirationCloseResult | null {
  const candidates = points
    .map(point => ({ date: toIsoDate(point.date) ?? toIsoDate(point.timestamp), close: point.price }))
    .filter((point): point is { date: string; close: number } => point.date != null && isFiniteNumber(point.close))
    .filter(point => point.date <= expirationDate)
    .sort((a, b) => b.date.localeCompare(a.date));
  const selected = candidates.find(point => point.date === expirationDate) ?? candidates[0];
  return selected ? {
    closePrice: selected.close,
    closeDate: selected.date,
    warning: selected.date === expirationDate ? undefined : PRIOR_CLOSE_WARNING,
  } : null;
}

const EXPIRATION_CLOSE_TTL = 3650 * 24 * 60 * 60 * 1000;
const PRIOR_CLOSE_WARNING = 'Used nearest prior trading-day close because exact expiration close was unavailable';

function parseIsoDateUtc(value: string | null | undefined): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function addDaysIso(value: string, days: number): string {
  const timestamp = parseIsoDateUtc(value);
  if (timestamp == null) return value;
  return new Date(timestamp + days * 86400000).toISOString().split('T')[0];
}

function toIsoDate(value: string | number): string | null {
  const timestamp = typeof value === 'number' ? value * 1000 : Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().split('T')[0];
}

function isValidHistory(value: unknown): value is HistoricalCloseResponse {
  if (!value || typeof value !== 'object') return false;
  const data = value as HistoricalCloseResponse;
  return (
    data.timeframe === 'custom' &&
    typeof data.ticker === 'string' &&
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

function rawDte(expiration: string, now = new Date()): number | null {
  const expiry = parseIsoDateUtc(expiration);
  if (expiry == null) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((expiry - today) / 86400000);
}

function calendarDaysBetween(start: string, end: string): number | null {
  const startMs = parseIsoDateUtc(start);
  const endMs = parseIsoDateUtc(end);
  if (startMs == null || endMs == null) return null;
  return Math.max(0, Math.round((endMs - startMs) / 86400000));
}

export function isExpiredUnresolvedOpenTrade(trade: PortfolioTrade, now = new Date()): boolean {
  if (trade.status !== 'open' || isFiniteNumber(trade.expirationClosePrice)) return false;
  const dte = rawDte(trade.expiration, now);
  return isFiniteNumber(dte) && dte < 0;
}

export function isArchivedTrade(trade: PortfolioTrade): boolean {
  return trade.status !== 'open';
}

export async function getExpirationClosePrice(ticker: string, expirationDate: string, options: { forceRefresh?: boolean } = {}): Promise<ExpirationCloseResult | null> {
  const normalizedTicker = ticker.trim().toUpperCase();
  const start = addDaysIso(expirationDate, -5);
  const end = addDaysIso(expirationDate, 2);
  const key = makeCacheKey(['portfolio_expiration_close', normalizedTicker, expirationDate]);

  const history = await cachedRequest(
    key,
    EXPIRATION_CLOSE_TTL,
    async () => {
      const response = await fetchObservedMarketData('chart-history', `/api/chart-history?ticker=${encodeURIComponent(normalizedTicker)}&start=${start}&end=${end}`, undefined, 'portfolioExpirationArchive');
      if (!response.ok) throw new Error(`Failed to fetch expiration close for ${normalizedTicker}`);
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      if (!isValidHistory(data)) throw new Error('Invalid expiration close history response');
      return data;
    },
    {
      bypassCache: options.forceRefresh,
      validator: isValidHistory,
      diagnosticsEndpoint: 'chart-history',
      diagnosticsSource: 'portfolioExpirationClose',
    }
  );

  return selectExpirationClose(history.points, expirationDate);
}

export function resolveExpiredTradeWithClose(
  trade: PortfolioTrade,
  closePrice: number,
  closeDate: string,
  source: PortfolioResolutionSource,
  warning?: string,
  nowIso = new Date().toISOString()
): PortfolioTrade {
  const premiumCollected = calculatePremiumCollected(trade);
  const finalOptionValue = Math.max(trade.strike - closePrice, 0) * trade.contracts * 100;
  const realizedPnl = premiumCollected != null ? premiumCollected - finalOptionValue : null;
  const percentCaptured = premiumCollected != null && premiumCollected > 0 && realizedPnl != null ? realizedPnl / premiumCollected : null;
  const resolutionType = finalOptionValue === 0 ? 'expired_worthless' : 'expired_itm';

  return {
    ...trade,
    status: 'expired',
    resolvedDate: nowIso.split('T')[0],
    resolutionType,
    expirationClosePrice: closePrice,
    expirationCloseDate: closeDate,
    finalOptionValue,
    realizedPnl: realizedPnl ?? undefined,
    percentCaptured: percentCaptured ?? undefined,
    premiumCollected: premiumCollected ?? undefined,
    daysHeld: calendarDaysBetween(trade.soldDate, trade.expiration) ?? undefined,
    resolutionSource: source,
    resolutionWarning: warning,
    closePrice: finalOptionValue / (trade.contracts * 100),
    closeDate: trade.expiration,
    updatedAt: nowIso,
    latestMarketData: {
      ...trade.latestMarketData,
      underlyingPrice: closePrice,
      dte: rawDte(trade.expiration) ?? trade.latestMarketData?.dte,
      refreshedAt: nowIso,
      availabilityStatus: 'expired',
    },
  };
}

export function markExpirationPricePending(trade: PortfolioTrade, warning = 'Expiration close unavailable', nowIso = new Date().toISOString()): PortfolioTrade {
  return {
    ...trade,
    status: 'expired_price_pending',
    resolvedDate: nowIso.split('T')[0],
    resolutionType: 'expired_price_pending',
    resolutionWarning: warning,
    premiumCollected: calculatePremiumCollected(trade) ?? undefined,
    daysHeld: calendarDaysBetween(trade.soldDate, trade.expiration) ?? undefined,
    updatedAt: nowIso,
    latestMarketData: {
      ...trade.latestMarketData,
      dte: rawDte(trade.expiration) ?? trade.latestMarketData?.dte,
      refreshedAt: nowIso,
      availabilityStatus: 'expired',
    },
  };
}

export async function archiveExpiredOpenTrades(trades: PortfolioTrade[], options: {
  now?: Date;
  concurrency?: number;
  findRichHistory?: (ticker: string, dates: string[]) => { points: ChartPoint[] } | null;
  fetchClose?: (ticker: string, expiration: string) => Promise<ExpirationCloseResult | null>;
} = {}): Promise<{ trades: PortfolioTrade[]; changed: boolean }> {
  const now = options.now ?? new Date();
  const nowIso = now.toISOString();
  const expired = trades.filter(trade => isExpiredUnresolvedOpenTrade(trade, now));
  if (expired.length === 0) return { trades, changed: false };

  const closeByKey = new Map<string, ExpirationCloseResult | null>();
  const datesByTicker = new Map<string, Set<string>>();
  expired.forEach(trade => {
    const ticker = trade.ticker.trim().toUpperCase();
    const dates = datesByTicker.get(ticker) ?? new Set<string>();
    dates.add(trade.expiration);
    datesByTicker.set(ticker, dates);
  });
  const findRichHistory = options.findRichHistory ?? findCachedDailyHistoryForDates;
  datesByTicker.forEach((dates, ticker) => {
    const history = findRichHistory(ticker, [...dates]);
    if (!history) return;
    dates.forEach(expiration => closeByKey.set(`${ticker}|${expiration}`, selectExpirationClose(history.points, expiration)));
  });

  const requirements = [...datesByTicker.entries()].flatMap(([ticker, dates]) => [...dates]
    .map(expiration => ({ ticker, expiration, key: `${ticker}|${expiration}` }))
    .filter(requirement => !closeByKey.has(requirement.key)));
  const fetchClose = options.fetchClose ?? getExpirationClosePrice;
  const settled = await mapWithConcurrency(requirements, options.concurrency ?? 3, requirement => fetchClose(requirement.ticker, requirement.expiration));
  settled.forEach((result, index) => closeByKey.set(
    requirements[index].key,
    result.status === 'fulfilled' ? result.value : null,
  ));

  const byId = new Map<string, PortfolioTrade>();
  expired.forEach(trade => {
    const result = closeByKey.get(`${trade.ticker.trim().toUpperCase()}|${trade.expiration}`) ?? null;
    byId.set(
      trade.id,
      result
        ? resolveExpiredTradeWithClose(trade, result.closePrice, result.closeDate, 'expiration_close', result.warning, nowIso)
        : markExpirationPricePending(trade, 'Expiration close unavailable', nowIso)
    );
  });

  return {
    changed: byId.size > 0,
    trades: trades.map(trade => byId.get(trade.id) ?? trade),
  };
}

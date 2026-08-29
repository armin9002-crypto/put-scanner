import { isFiniteNumber } from './optionMetrics.ts';
import type { PortfolioTrade } from './portfolioStorage.ts';

export type PortfolioQuoteFreshnessState = 'fresh' | 'aging' | 'stale' | 'unavailable';

export interface PortfolioQuoteFreshness {
  state: PortfolioQuoteFreshnessState;
  label: 'Fresh' | 'Aging' | 'Stale' | 'Unavailable';
  observedAt: number | null;
  observedSessionAge: number | null;
  lastTradeAt: number | null;
  lastTradeSessionAge: number | null;
  reason: string;
}

function marketDateKey(value: Date | number): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function parseDateKey(value: string): number {
  return Date.parse(`${value}T12:00:00Z`);
}

export function elapsedMarketSessions(from: Date | number, to: Date | number = new Date()): number {
  const startKey = marketDateKey(from);
  const endKey = marketDateKey(to);
  if (startKey >= endKey) return 0;
  let cursor = parseDateKey(startKey) + 86_400_000;
  const end = parseDateKey(endKey);
  let sessions = 0;
  while (cursor <= end) {
    const day = new Date(cursor).getUTCDay();
    if (day !== 0 && day !== 6) sessions += 1;
    cursor += 86_400_000;
  }
  return sessions;
}

function timestamp(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') {
    const normalized = value < 10_000_000_000 ? value * 1000 : value;
    return Number.isFinite(normalized) ? normalized : null;
  }
  const parsed = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function labelFor(state: PortfolioQuoteFreshnessState): PortfolioQuoteFreshness['label'] {
  return state === 'fresh' ? 'Fresh' : state === 'aging' ? 'Aging' : state === 'stale' ? 'Stale' : 'Unavailable';
}

export function getPortfolioQuoteFreshness(trade: PortfolioTrade, now = new Date()): PortfolioQuoteFreshness {
  const market = trade.latestMarketData;
  const observedAt = timestamp(market?.refreshedAt);
  const lastTradeAt = timestamp(market?.lastTradeDate);
  const observedSessionAge = observedAt == null ? null : elapsedMarketSessions(observedAt, now);
  const lastTradeSessionAge = lastTradeAt == null ? null : elapsedMarketSessions(lastTradeAt, now);
  const hasCurrentInputs = isFiniteNumber(market?.underlyingPrice)
    || isFiniteNumber(market?.optionBid)
    || isFiniteNumber(market?.optionAsk)
    || isFiniteNumber(market?.optionLast)
    || isFiniteNumber(market?.delta);

  let state: PortfolioQuoteFreshnessState;
  let reason: string;
  if (!market || market.availabilityStatus === 'unavailable' || market.availabilityStatus === 'imported_snapshot' || !hasCurrentInputs || observedAt == null) {
    state = 'unavailable';
    reason = 'No current market observation is available.';
  } else if (market.availabilityStatus === 'refresh_failed' || market.availabilityStatus === 'stale') {
    state = 'stale';
    reason = 'The latest refresh failed or returned stale fallback data.';
  } else if (market.availabilityStatus === 'expired') {
    state = 'unavailable';
    reason = 'The contract is past expiration and needs lifecycle review.';
  } else if ((observedSessionAge ?? Number.POSITIVE_INFINITY) === 0) {
    state = 'fresh';
    reason = 'Market data was observed in the current or most recent non-trading session.';
  } else if (observedSessionAge === 1) {
    state = 'aging';
    reason = 'Market data is one trading session old.';
  } else {
    state = 'stale';
    reason = `Market data is ${observedSessionAge ?? 'more than one'} trading sessions old.`;
  }

  return { state, label: labelFor(state), observedAt, observedSessionAge, lastTradeAt, lastTradeSessionAge, reason };
}

export function isPortfolioQuoteDecisionEligible(trade: PortfolioTrade, now = new Date()): boolean {
  const state = getPortfolioQuoteFreshness(trade, now).state;
  return state === 'fresh' || state === 'aging';
}

export function summarizePortfolioQuoteFreshness(trades: PortfolioTrade[], now = new Date()): Record<PortfolioQuoteFreshnessState, number> {
  const counts: Record<PortfolioQuoteFreshnessState, number> = { fresh: 0, aging: 0, stale: 0, unavailable: 0 };
  trades.forEach(trade => { counts[getPortfolioQuoteFreshness(trade, now).state] += 1; });
  return counts;
}

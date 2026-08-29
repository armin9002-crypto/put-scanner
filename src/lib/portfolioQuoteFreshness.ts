import { isFiniteNumber } from './optionMetrics.ts';
import { elapsedUsEquityTradingSessions } from './usMarketCalendar.ts';
import { canonicalizeMarketTime, type MarketTimestampSource } from './marketTimestamp.ts';
import type { PortfolioTrade } from './portfolioStorage.ts';

export type PortfolioQuoteFreshnessState = 'fresh' | 'aging' | 'stale' | 'unavailable';

export interface PortfolioQuoteFreshness {
  state: PortfolioQuoteFreshnessState;
  label: 'Fresh' | 'Aging' | 'Stale' | 'Unavailable';
  observedAt: number | null;
  observedSessionAge: number | null;
  freshnessAt: number | null;
  freshnessSessionAge: number | null;
  freshnessTimestampSource: MarketTimestampSource;
  providerMarketAt: number | null;
  providerQuoteAt: number | null;
  cachedAt: number | null;
  lastTradeAt: number | null;
  lastTradeSessionAge: number | null;
  reason: string;
}

function marketDateKey(value: Date | number): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function elapsedMarketSessions(from: Date | number, to: Date | number = new Date()): number {
  return elapsedUsEquityTradingSessions(marketDateKey(from), marketDateKey(to));
}

function labelFor(state: PortfolioQuoteFreshnessState): PortfolioQuoteFreshness['label'] {
  return state === 'fresh' ? 'Fresh' : state === 'aging' ? 'Aging' : state === 'stale' ? 'Stale' : 'Unavailable';
}

export function getPortfolioQuoteFreshness(trade: PortfolioTrade, now = new Date()): PortfolioQuoteFreshness {
  const nowMs = now.getTime();
  const market = trade.latestMarketData;
  const canonical = canonicalizeMarketTime({
    observedAt: market?.refreshedAt,
    providerQuoteAt: market?.providerQuoteAt,
    providerMarketAt: market?.providerMarketAt,
    lastTradeAt: market?.lastTradeDate,
    cachedAt: market?.cachedAt,
    nowMs,
  });
  const observedAt = canonical.observedAt;
  const freshnessAt = canonical.providerQuoteAt ?? canonical.providerMarketAt ?? canonical.observedAt;
  const freshnessTimestampSource: MarketTimestampSource = canonical.providerQuoteAt != null
    ? 'provider_quote'
    : canonical.providerMarketAt != null ? 'provider_market_time' : canonical.observedAt != null ? 'observed_at' : 'unavailable';
  const observedSessionAge = observedAt == null ? null : elapsedMarketSessions(observedAt, now);
  const freshnessSessionAge = freshnessAt == null ? null : elapsedMarketSessions(freshnessAt, now);
  const lastTradeAt = canonical.lastTradeAt;
  const lastTradeSessionAge = lastTradeAt == null ? null : elapsedMarketSessions(lastTradeAt, now);
  const hasCurrentInputs = isFiniteNumber(market?.underlyingPrice)
    || isFiniteNumber(market?.optionBid)
    || isFiniteNumber(market?.optionAsk)
    || isFiniteNumber(market?.optionLast)
    || isFiniteNumber(market?.delta);

  let state: PortfolioQuoteFreshnessState;
  let reason: string;
  if (!market || market.availabilityStatus === 'unavailable' || market.availabilityStatus === 'imported_snapshot' || !hasCurrentInputs || freshnessAt == null) {
    state = 'unavailable';
    reason = 'No current market observation is available.';
  } else if (market.availabilityStatus === 'refresh_failed' || market.availabilityStatus === 'stale') {
    state = 'stale';
    reason = 'The latest refresh failed or returned stale fallback data.';
  } else if (market.availabilityStatus === 'expired') {
    state = 'unavailable';
    reason = 'The contract is past expiration and needs lifecycle review.';
  } else if ((freshnessSessionAge ?? Number.POSITIVE_INFINITY) === 0) {
    state = 'fresh';
    reason = freshnessTimestampSource === 'observed_at'
      ? 'Freshness uses when Put Scanner observed the market data.'
      : 'Freshness uses the provider market event time; option last-trade time is tracked separately.';
  } else if (freshnessSessionAge === 1) {
    state = 'aging';
    reason = 'Market data is one trading session old.';
  } else {
    state = 'stale';
    reason = `Market data is ${freshnessSessionAge ?? 'more than one'} trading sessions old.`;
  }

  return {
    state, label: labelFor(state), observedAt, observedSessionAge,
    freshnessAt, freshnessSessionAge, freshnessTimestampSource,
    providerMarketAt: canonical.providerMarketAt, providerQuoteAt: canonical.providerQuoteAt,
    cachedAt: canonical.cachedAt, lastTradeAt, lastTradeSessionAge, reason,
  };
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

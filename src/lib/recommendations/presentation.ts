import type { RecommendationPricing, TransactionRecency } from './types.ts';
import { isUsEquityTradingSession, usMarketDateIso } from '../usMarketCalendar.ts';

const EASTERN_MARKET_CLOCK = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export const RECOMMENDATION_MARKET_CLOSED_TEXT = 'Market closed · quotes are indicative until the next session.';

/** Presentation-only context. This performs no refresh, polling, or market-data request. */
export function recommendationMarketClosedText(value: string | number | Date): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const parts = Object.fromEntries(EASTERN_MARKET_CLOCK.formatToParts(date).map(part => [part.type, part.value]));
  const sessionDate = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const regularSessionOpen = isUsEquityTradingSession(sessionDate) && minutes >= 9 * 60 + 30 && minutes < 16 * 60;
  return regularSessionOpen ? null : RECOMMENDATION_MARKET_CLOSED_TEXT;
}

function timestampMs(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  const normalized = value < 100_000_000_000 ? value * 1_000 : value;
  return Number.isNaN(new Date(normalized).getTime()) ? null : normalized;
}

export function recommendationLastTradeText(pricing: RecommendationPricing, asOf: string): string {
  const value = timestampMs(pricing.lastTradeDate);
  if (value == null) return 'Last trade unavailable';
  const tradeDate = new Date(value);
  const tradeMarketDate = usMarketDateIso(value);
  const evaluationMarketDate = usMarketDateIso(asOf);
  const includeYear = tradeMarketDate.slice(0, 4) !== evaluationMarketDate.slice(0, 4);
  const date = tradeDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' as const } : {}),
    timeZone: 'America/New_York',
  });
  const age = pricing.exactTradeSessionAge;
  const ageText = age == null ? 'trading-session age unavailable' : age === 0 ? '0 sessions' : `${age} session${age === 1 ? '' : 's'} ago`;
  return `Last trade ${date} · ${ageText}`;
}

export function transactionRecencyTone(recency: TransactionRecency): 'positive' | 'warning' | 'danger' | 'muted' {
  if (recency === 'RECENT') return 'positive';
  if (recency === 'STALE') return 'warning';
  if (recency === 'VERY_STALE') return 'danger';
  return 'muted';
}

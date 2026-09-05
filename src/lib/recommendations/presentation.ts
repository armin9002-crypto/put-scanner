import type { RecommendationPricing, TransactionRecency } from './types.ts';

function timestampMs(value: number | null): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  const normalized = value < 100_000_000_000 ? value * 1_000 : value;
  return Number.isNaN(new Date(normalized).getTime()) ? null : normalized;
}

export function recommendationLastTradeText(pricing: RecommendationPricing, asOf: string): string {
  const value = timestampMs(pricing.lastTradeDate);
  if (value == null) return 'Last trade unavailable';
  const tradeDate = new Date(value);
  const asOfDate = new Date(asOf);
  const includeYear = tradeDate.getUTCFullYear() !== asOfDate.getUTCFullYear();
  const date = tradeDate.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(includeYear ? { year: 'numeric' as const } : {}),
    timeZone: 'UTC',
  });
  const age = pricing.exactTradeSessionAge;
  return age == null ? `Last trade ${date} · trading-session age unavailable` : `Last trade ${date} · ${age} td ago`;
}

export function transactionRecencyTone(recency: TransactionRecency): 'positive' | 'warning' | 'danger' | 'muted' {
  if (recency === 'RECENT') return 'positive';
  if (recency === 'STALE') return 'warning';
  if (recency === 'VERY_STALE') return 'danger';
  return 'muted';
}

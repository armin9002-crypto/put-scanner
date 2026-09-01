import { compareNullableValue } from './metricValue.ts';
import { isFiniteNumber } from './optionMetrics.ts';
import {
  historyDaysHeld,
  historyEntryNominalYield,
  historyEntryVix,
  historyOutcomeLabel,
  historyPercentCaptured,
  historyPremium,
  historyPriceAtExpiration,
  historyRealizedIrr,
  historyRealizedPnl,
  historyGrossRisk,
  type HistoryGroup,
} from './portfolioHistoryAnalytics.ts';
import type { PortfolioTrade } from './portfolioStorage.ts';

export type HistorySortField =
  | 'ticker'
  | 'expiration'
  | 'strike'
  | 'contracts'
  | 'grossRisk'
  | 'entry'
  | 'daysHeld'
  | 'soldPrice'
  | 'ny'
  | 'entryVix'
  | 'priceAtExpiration'
  | 'premium'
  | 'realizedPnl'
  | 'realizedIrr'
  | 'percentCaptured'
  | 'entryDelta'
  | 'outcome';

export type HistorySortDirection = 'asc' | 'desc';

export const HISTORY_SORT_OPTIONS: Array<{ value: HistorySortField; label: string }> = [
  { value: 'ticker', label: 'Ticker' },
  { value: 'expiration', label: 'Exp.' },
  { value: 'strike', label: 'Strike' },
  { value: 'contracts', label: 'Contracts' },
  { value: 'grossRisk', label: 'Gross Risk' },
  { value: 'entry', label: 'Entry' },
  { value: 'daysHeld', label: 'Days Held' },
  { value: 'soldPrice', label: 'Sold Price' },
  { value: 'ny', label: 'NY' },
  { value: 'entryVix', label: 'VIX @ Entry' },
  { value: 'priceAtExpiration', label: 'Price @ Exp.' },
  { value: 'premium', label: 'Premium' },
  { value: 'realizedPnl', label: 'Realized P&L' },
  { value: 'realizedIrr', label: 'Realized IRR' },
  { value: 'percentCaptured', label: '% Captured' },
  { value: 'entryDelta', label: 'Entry Delta' },
  { value: 'outcome', label: 'Outcome' },
];

export const HISTORY_MOBILE_SORT_OPTIONS = HISTORY_SORT_OPTIONS.filter(option =>
  ['expiration', 'entry', 'strike', 'grossRisk', 'soldPrice', 'entryDelta'].includes(option.value),
);

type HistorySortValue = number | string | null;

function finite(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function dateTimestamp(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getHistorySortValue(trade: PortfolioTrade, field: HistorySortField): HistorySortValue {
  switch (field) {
    case 'ticker': return trade.ticker.trim() || null;
    case 'expiration': return dateTimestamp(trade.expiration);
    case 'strike': return finite(trade.strike);
    case 'contracts': return finite(trade.contracts);
    case 'grossRisk': return historyGrossRisk(trade);
    case 'entry': return dateTimestamp(trade.soldDate);
    case 'daysHeld': return historyDaysHeld(trade);
    case 'soldPrice': return finite(trade.soldPrice);
    case 'ny': return historyEntryNominalYield(trade);
    case 'entryVix': return historyEntryVix(trade);
    case 'priceAtExpiration': return historyPriceAtExpiration(trade);
    case 'premium': return historyPremium(trade);
    case 'realizedPnl': return historyRealizedPnl(trade);
    case 'realizedIrr': return historyRealizedIrr(trade);
    case 'percentCaptured': return historyPercentCaptured(trade);
    case 'entryDelta': return finite(trade.entryDelta);
    case 'outcome': return historyOutcomeLabel(trade);
  }
}

export function compareHistoryTrades(
  a: PortfolioTrade,
  b: PortfolioTrade,
  field: HistorySortField,
  direction: HistorySortDirection,
): number {
  return compareNullableValue(getHistorySortValue(a, field), getHistorySortValue(b, field), direction);
}

export function sortHistoryTrades(
  trades: PortfolioTrade[],
  field: HistorySortField | null,
  direction: HistorySortDirection,
): PortfolioTrade[] {
  if (field == null) return [...trades];
  return trades
    .map((trade, originalIndex) => ({ trade, originalIndex }))
    .sort((a, b) => compareHistoryTrades(a.trade, b.trade, field, direction) || a.originalIndex - b.originalIndex)
    .map(item => item.trade);
}

/**
 * History group identity and order remain canonical. Only child rows are sorted.
 * This keeps group subtotals, disclosure state, and grouping semantics intact.
 */
export function sortHistoryGroups(
  groups: HistoryGroup[],
  field: HistorySortField | null,
  direction: HistorySortDirection,
): HistoryGroup[] {
  return groups.map(group => ({
    ...group,
    trades: sortHistoryTrades(group.trades, field, direction),
  }));
}

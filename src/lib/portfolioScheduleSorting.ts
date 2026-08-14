import { isFiniteNumber } from './optionMetrics.ts';
import {
  calculateBreakeven,
  calculateCurrentAnnualizedYield,
  calculateCurrentNominalYield,
  calculateCurrentOptionMark,
  calculateCurrentPositionValue,
  calculateDistanceToStrike,
  calculateEquityAtRisk,
  calculateNetCapitalAtRisk,
  calculateOriginalAnnualizedYield,
  calculateOriginalNominalYield,
  calculatePercentCaptured,
  calculatePremiumCollected,
  calculateRemainingDte,
  calculateTotalGainLoss,
  type MarkBasis,
} from './portfolioMetrics.ts';
import type { PortfolioTrade } from './portfolioStorage.ts';
import type { PortfolioExpirationScheduleGroup, PortfolioUnderlyingScheduleGroup } from './portfolioAnalytics.ts';

export type PortfolioScheduleSortField =
  | 'ticker'
  | 'expiration'
  | 'dte'
  | 'health'
  | 'strike'
  | 'contracts'
  | 'soldPrice'
  | 'premium'
  | 'grossRisk'
  | 'netCapitalRisk'
  | 'currentMark'
  | 'currentValue'
  | 'pnl'
  | 'percentCaptured'
  | 'delta'
  | 'breakeven'
  | 'underlying'
  | 'distanceToStrike'
  | 'iv'
  | 'entryVix'
  | 'openInterest'
  | 'originalNy'
  | 'originalAy'
  | 'currentNy'
  | 'currentAy';

export type PortfolioScheduleSortDirection = 'asc' | 'desc';
export type PortfolioPositionHealthLevel = 'Healthy' | 'Monitor' | 'Elevated' | 'Risky' | 'Threatened' | 'Unknown';

type SortValue = number | string | null;

const HEALTH_SEVERITY: Record<Exclude<PortfolioPositionHealthLevel, 'Unknown'>, number> = {
  Healthy: 0,
  Monitor: 1,
  Elevated: 2,
  Risky: 3,
  Threatened: 4,
};

function finite(value: unknown): number | null {
  return isFiniteNumber(value) ? value : null;
}

function expirationTimestamp(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function getPortfolioPositionHealthLevel(trade: PortfolioTrade): PortfolioPositionHealthLevel {
  const underlying = finite(trade.latestMarketData?.underlyingPrice ?? trade.entrySnapshot?.underlyingPrice);
  const strike = finite(trade.strike);
  const breakeven = calculateBreakeven(trade);
  const distanceToStrike = calculateDistanceToStrike(trade);
  const delta = finite(trade.latestMarketData?.delta);
  const dte = calculateRemainingDte(trade);
  const absDelta = delta == null ? null : Math.abs(delta);

  if (underlying == null || strike == null || breakeven == null) return 'Unknown';
  if (underlying <= breakeven || (underlying < strike && absDelta != null && absDelta >= 0.35)) return 'Threatened';
  if ((distanceToStrike != null && distanceToStrike <= 0.10) || (absDelta != null && absDelta >= 0.30)) return 'Risky';
  if ((distanceToStrike != null && distanceToStrike <= 0.20) || (absDelta != null && absDelta > 0.20)) return 'Elevated';
  if (
    (distanceToStrike != null && distanceToStrike <= 0.25)
    || (absDelta != null && absDelta > 0.15)
    || (dte != null && dte <= 14 && distanceToStrike != null && distanceToStrike <= 0.25)
  ) return 'Monitor';
  return 'Healthy';
}

export function getPortfolioScheduleSortValue(
  trade: PortfolioTrade,
  field: PortfolioScheduleSortField,
  markBasis: MarkBasis,
): SortValue {
  switch (field) {
    case 'ticker': return trade.ticker.trim() || null;
    case 'expiration': return expirationTimestamp(trade.expiration);
    case 'dte': return finite(calculateRemainingDte(trade));
    case 'health': {
      const level = getPortfolioPositionHealthLevel(trade);
      return level === 'Unknown' ? null : HEALTH_SEVERITY[level];
    }
    case 'strike': return finite(trade.strike);
    case 'contracts': return finite(trade.contracts);
    case 'soldPrice': return finite(trade.soldPrice);
    case 'premium': return finite(calculatePremiumCollected(trade));
    case 'grossRisk': return finite(calculateEquityAtRisk(trade));
    case 'netCapitalRisk': return finite(calculateNetCapitalAtRisk(trade));
    case 'currentMark': return finite(calculateCurrentOptionMark(trade, markBasis));
    case 'currentValue': return finite(calculateCurrentPositionValue(trade, markBasis));
    case 'pnl': return finite(calculateTotalGainLoss(trade, markBasis));
    case 'percentCaptured': return finite(calculatePercentCaptured(trade, markBasis));
    case 'delta': return finite(trade.latestMarketData?.delta);
    case 'breakeven': return finite(calculateBreakeven(trade));
    case 'underlying': return finite(trade.latestMarketData?.underlyingPrice ?? trade.entrySnapshot?.underlyingPrice);
    case 'distanceToStrike': return finite(calculateDistanceToStrike(trade));
    case 'iv': return finite(trade.latestMarketData?.iv);
    case 'entryVix': return finite(trade.entryVixClose);
    case 'openInterest': return finite(trade.latestMarketData?.openInterest);
    case 'originalNy': return finite(calculateOriginalNominalYield(trade));
    case 'originalAy': return finite(calculateOriginalAnnualizedYield(trade));
    case 'currentNy': return finite(calculateCurrentNominalYield(trade, markBasis));
    case 'currentAy': return finite(calculateCurrentAnnualizedYield(trade, markBasis));
  }
}

export function comparePortfolioScheduleTrades(
  a: PortfolioTrade,
  b: PortfolioTrade,
  field: PortfolioScheduleSortField,
  direction: PortfolioScheduleSortDirection,
  markBasis: MarkBasis,
): number {
  const aValue = getPortfolioScheduleSortValue(a, field, markBasis);
  const bValue = getPortfolioScheduleSortValue(b, field, markBasis);

  // Missing data remains last regardless of direction.
  if (aValue == null) return bValue == null ? 0 : 1;
  if (bValue == null) return -1;

  const comparison = typeof aValue === 'string' && typeof bValue === 'string'
    ? aValue.localeCompare(bValue, undefined, { sensitivity: 'base', numeric: true })
    : (aValue as number) - (bValue as number);
  return direction === 'asc' ? comparison : -comparison;
}

export function sortFlatPortfolioSchedule(
  trades: PortfolioTrade[],
  field: PortfolioScheduleSortField,
  direction: PortfolioScheduleSortDirection,
  markBasis: MarkBasis,
): PortfolioTrade[] {
  return [...trades].sort((a, b) => comparePortfolioScheduleTrades(a, b, field, direction, markBasis));
}

export function sortExpirationPortfolioScheduleGroups(
  groups: PortfolioExpirationScheduleGroup[],
  field: PortfolioScheduleSortField,
  direction: PortfolioScheduleSortDirection,
  markBasis: MarkBasis,
): PortfolioExpirationScheduleGroup[] {
  const groupDirection = field === 'expiration' && direction === 'desc' ? -1 : 1;
  return [...groups]
    .sort((a, b) => ((expirationTimestamp(a.expiration) ?? 0) - (expirationTimestamp(b.expiration) ?? 0)) * groupDirection)
    .map(group => ({
      ...group,
      trades: field === 'expiration' ? [...group.trades] : sortFlatPortfolioSchedule(group.trades, field, direction, markBasis),
    }));
}

export function sortUnderlyingPortfolioScheduleGroups(
  groups: PortfolioUnderlyingScheduleGroup[],
  field: PortfolioScheduleSortField,
  direction: PortfolioScheduleSortDirection,
  markBasis: MarkBasis,
): PortfolioUnderlyingScheduleGroup[] {
  const groupDirection = field === 'ticker' && direction === 'desc' ? -1 : 1;
  return [...groups]
    .sort((a, b) => a.ticker.localeCompare(b.ticker, undefined, { sensitivity: 'base', numeric: true }) * groupDirection)
    .map(group => ({
      ...group,
      trades: field === 'ticker' ? [...group.trades] : sortFlatPortfolioSchedule(group.trades, field, direction, markBasis),
    }));
}

import { isFiniteNumber } from './optionMetrics.ts';
import {
  calculateEquityAtRisk,
  calculateNetCapitalAtRisk,
  calculateOriginalAnnualizedYield,
  calculateOriginalNominalYield,
  calculatePremiumCollected,
} from './portfolioMetrics.ts';
import { isValidEntryDelta } from './portfolioEntryDelta.ts';
import {
  canonicalHistoricalDaysHeld,
  canonicalHistoricalFinalOptionValue,
  canonicalHistoricalPremium,
  canonicalHistoricalRealizedPnl,
} from './portfolioRealizedEconomics.ts';
import type { PortfolioTrade } from './portfolioStorage';

export type HistoryOutcome = 'all' | 'expired_worthless' | 'closed' | 'expired_itm' | 'assigned';
export type HistoryGroupMode = 'year' | 'expiration' | 'underlying' | 'none';

export interface HistoryCashFlow {
  date: string;
  amount: number;
}

export interface HistoryGroup {
  key: string;
  label: string;
  trades: PortfolioTrade[];
  tradeCount: number;
  contractCount: number;
  grossRisk: number;
  realizedPnl: number | null;
  premium: number;
}

export function historyOutcome(trade: PortfolioTrade): Exclude<HistoryOutcome, 'all'> | 'pending' {
  if (trade.status === 'closed') return 'closed';
  if (trade.status === 'assigned') return 'assigned';
  if (trade.status === 'expired_price_pending' || trade.resolutionType === 'expired_price_pending') return 'pending';
  if (trade.resolutionType === 'expired_itm') return 'expired_itm';
  return 'expired_worthless';
}

export function historyRealizedPnl(trade: PortfolioTrade): number | null {
  const canonical = canonicalHistoricalRealizedPnl(trade);
  if (canonical != null) return canonical;
  if ((trade.status === 'expired' || trade.status === 'assigned') && Number.isFinite(trade.realizedPnl)) return trade.realizedPnl!;
  return null;
}

export function historyPremium(trade: PortfolioTrade): number | null {
  return canonicalHistoricalPremium(trade)
    ?? (Number.isFinite(trade.premiumCollected) ? trade.premiumCollected! : calculatePremiumCollected(trade));
}

export function historyDaysHeld(trade: PortfolioTrade): number | null {
  const canonical = canonicalHistoricalDaysHeld(trade);
  if (canonical != null) return canonical;
  if (Number.isFinite(trade.daysHeld)) return trade.daysHeld!;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trade.soldDate)) return null;
  const end = trade.closeDate ?? trade.resolvedDate ?? trade.expiration;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${trade.soldDate}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(days) && days >= 0 ? days : null;
}

export function historyRealizedIrr(trade: PortfolioTrade): number | null {
  const realizedPnl = historyRealizedPnl(trade);
  const originalNetCapitalAtRisk = calculateNetCapitalAtRisk(trade);
  const resolvedDate = trade.closeDate ?? trade.resolvedDate ?? trade.expiration;
  const daysHeld = /^\d{4}-\d{2}-\d{2}$/.test(trade.soldDate) && /^\d{4}-\d{2}-\d{2}$/.test(resolvedDate)
    ? Math.round((Date.parse(`${resolvedDate}T00:00:00Z`) - Date.parse(`${trade.soldDate}T00:00:00Z`)) / 86_400_000)
    : null;
  if (realizedPnl == null || originalNetCapitalAtRisk == null || originalNetCapitalAtRisk <= 0 || daysHeld == null || daysHeld <= 0) return null;
  const realizedReturn = realizedPnl / originalNetCapitalAtRisk;
  if (realizedReturn === -1) return -1;
  if (1 + realizedReturn <= 0) return null;
  const annualized = Math.pow(1 + realizedReturn, 365.25 / daysHeld) - 1;
  return Number.isFinite(annualized) ? annualized : null;
}

function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`));
}

function aggregateCashFlows(cashFlows: HistoryCashFlow[]): HistoryCashFlow[] {
  const totals = new Map<string, number>();
  cashFlows.forEach(flow => totals.set(flow.date, (totals.get(flow.date) ?? 0) + flow.amount));
  return [...totals.entries()]
    .filter(([, amount]) => Math.abs(amount) > 1e-10)
    .map(([date, amount]) => ({ date, amount }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Date-aware money-weighted return. Multiple/no-real roots intentionally fail closed. */
export function calculateXirr(cashFlows: HistoryCashFlow[]): number | null {
  if (cashFlows.some(flow => !isIsoDate(flow.date) || !isFiniteNumber(flow.amount))) return null;
  const flows = aggregateCashFlows(cashFlows);
  if (flows.length < 2 || !flows.some(flow => flow.amount < 0) || !flows.some(flow => flow.amount > 0)) return null;
  const origin = Date.parse(`${flows[0].date}T00:00:00Z`);
  const dated = flows.map(flow => ({ amount: flow.amount, years: (Date.parse(`${flow.date}T00:00:00Z`) - origin) / 86_400_000 / 365.25 }));
  if (dated[dated.length - 1].years <= 0) return null;
  const scale = dated.reduce((sum, flow) => sum + Math.abs(flow.amount), 0);
  const zeroTolerance = Math.max(1e-10, scale * 1e-11);
  const npvAtLogRate = (logRate: number) => dated.reduce((sum, flow) => sum + flow.amount * Math.exp(-logRate * flow.years), 0);
  const roots: number[] = [];
  const rememberRoot = (root: number) => {
    if (!roots.some(existing => Math.abs(existing - root) < 1e-7)) roots.push(root);
  };

  const minLogRate = -16;
  const maxLogRate = 16;
  const steps = 8192;
  let left = minLogRate;
  let leftValue = npvAtLogRate(left);
  for (let step = 1; step <= steps; step += 1) {
    const right = minLogRate + (maxLogRate - minLogRate) * step / steps;
    const rightValue = npvAtLogRate(right);
    if (Number.isFinite(leftValue) && Math.abs(leftValue) <= zeroTolerance) rememberRoot(left);
    if (Number.isFinite(rightValue) && Math.abs(rightValue) <= zeroTolerance) rememberRoot(right);
    if (Number.isFinite(leftValue) && Number.isFinite(rightValue) && leftValue * rightValue < 0) {
      let lower = left;
      let upper = right;
      let lowerValue = leftValue;
      for (let iteration = 0; iteration < 100; iteration += 1) {
        const middle = (lower + upper) / 2;
        const middleValue = npvAtLogRate(middle);
        if (Math.abs(middleValue) <= zeroTolerance) {
          lower = middle;
          upper = middle;
          break;
        }
        if (lowerValue * middleValue <= 0) {
          upper = middle;
        } else {
          lower = middle;
          lowerValue = middleValue;
        }
      }
      rememberRoot((lower + upper) / 2);
    }
    left = right;
    leftValue = rightValue;
  }
  if (roots.length !== 1) return null;
  const result = Math.expm1(roots[0]);
  return Number.isFinite(result) && result > -1 ? result : null;
}

/**
 * Uses the existing collateral convention: deploy original Net Risk at entry,
 * then return that capital plus the trade's realized P&L at resolution.
 */
export function buildHistoryRealizedCashFlows(trades: PortfolioTrade[]): HistoryCashFlow[] | null {
  const cashFlows: HistoryCashFlow[] = [];
  for (const trade of trades) {
    const realizedPnl = historyRealizedPnl(trade);
    if (realizedPnl == null) continue;
    const netRisk = calculateNetCapitalAtRisk(trade);
    const resolvedDate = trade.closeDate ?? trade.resolvedDate ?? trade.expiration;
    if (!isFiniteNumber(netRisk) || netRisk <= 0 || !isIsoDate(trade.soldDate) || !isIsoDate(resolvedDate) || resolvedDate < trade.soldDate) return null;
    cashFlows.push(
      { date: trade.soldDate, amount: -netRisk },
      { date: resolvedDate, amount: netRisk + realizedPnl },
    );
  }
  return cashFlows.length ? aggregateCashFlows(cashFlows) : null;
}

export function calculateHistoryTotalRealizedIrr(trades: PortfolioTrade[]): number | null {
  const cashFlows = buildHistoryRealizedCashFlows(trades);
  return cashFlows ? calculateXirr(cashFlows) : null;
}

export function calculateHistoryWeightedEntryDelta(trades: PortfolioTrade[]) {
  let totalGrossRisk = 0;
  let knownGrossRisk = 0;
  let weightedDelta = 0;
  trades.forEach(trade => {
    const grossRisk = calculateEquityAtRisk(trade);
    if (!isFiniteNumber(grossRisk) || grossRisk <= 0) return;
    totalGrossRisk += grossRisk;
    if (!isValidEntryDelta(trade.entryDelta)) return;
    knownGrossRisk += grossRisk;
    weightedDelta += trade.entryDelta * grossRisk;
  });
  return {
    value: knownGrossRisk > 0 ? weightedDelta / knownGrossRisk : null,
    coverage: totalGrossRisk > 0 ? knownGrossRisk / totalGrossRisk : null,
    knownGrossRisk,
    totalGrossRisk,
  };
}

export function calculateTotalHistoricalNotional(trades: PortfolioTrade[]): number | null {
  if (trades.length === 0) return null;
  return trades.reduce((sum, trade) => sum + (calculateEquityAtRisk(trade) ?? 0), 0);
}

export function historyEntryNominalYield(trade: PortfolioTrade): number | null {
  return calculateOriginalNominalYield(trade);
}

export function historyEntryVix(trade: PortfolioTrade): number | null {
  return isFiniteNumber(trade.entryVixClose) ? trade.entryVixClose : null;
}

export function historyPriceAtExpiration(trade: PortfolioTrade): number | null {
  return isFiniteNumber(trade.expirationClosePrice) ? trade.expirationClosePrice : null;
}

export function historyFinalValue(trade: PortfolioTrade): number | null {
  const canonical = canonicalHistoricalFinalOptionValue(trade);
  if (canonical != null) return canonical;
  if (isFiniteNumber(trade.finalOptionValue)) return trade.finalOptionValue;
  return trade.status === 'closed' && isFiniteNumber(trade.closePrice) ? trade.closePrice * trade.contracts * 100 : null;
}

function historyGroupIdentity(trade: PortfolioTrade, mode: Exclude<HistoryGroupMode, 'none'>): { key: string; label: string } {
  if (mode === 'underlying') {
    const ticker = trade.ticker.trim().toUpperCase();
    return ticker ? { key: ticker, label: ticker } : { key: 'unknown', label: 'Unknown' };
  }
  if (!isIsoDate(trade.expiration)) return { key: 'unknown', label: 'Unknown' };
  return mode === 'year'
    ? { key: trade.expiration.slice(0, 4), label: trade.expiration.slice(0, 4) }
    : { key: trade.expiration, label: trade.expiration };
}

export function buildHistoryGroups(trades: PortfolioTrade[], mode: HistoryGroupMode): HistoryGroup[] {
  const buckets = new Map<string, { label: string; trades: PortfolioTrade[] }>();
  if (mode === 'none') buckets.set('all', { label: 'All History', trades: [...trades] });
  else trades.forEach(trade => {
    const identity = historyGroupIdentity(trade, mode);
    const bucket = buckets.get(identity.key) ?? { label: identity.label, trades: [] };
    bucket.trades.push(trade);
    buckets.set(identity.key, bucket);
  });
  const groups = [...buckets.entries()].map(([key, bucket]) => {
    const realized = bucket.trades.map(historyRealizedPnl).filter((value): value is number => value != null);
    return {
      key,
      label: bucket.label,
      trades: bucket.trades,
      tradeCount: bucket.trades.length,
      contractCount: bucket.trades.reduce((sum, trade) => sum + trade.contracts, 0),
      grossRisk: bucket.trades.reduce((sum, trade) => sum + (calculateEquityAtRisk(trade) ?? 0), 0),
      realizedPnl: realized.length ? realized.reduce((sum, value) => sum + value, 0) : null,
      premium: bucket.trades.reduce((sum, trade) => sum + (historyPremium(trade) ?? 0), 0),
    };
  });
  return groups.sort((a, b) => {
    if (a.key === 'unknown') return 1;
    if (b.key === 'unknown') return -1;
    return mode === 'underlying' || mode === 'none' ? a.label.localeCompare(b.label) : b.key.localeCompare(a.key);
  });
}

export function filterHistoryTrades(trades: PortfolioTrade[], outcome: HistoryOutcome): PortfolioTrade[] {
  return outcome === 'all' ? trades : trades.filter(trade => historyOutcome(trade) === outcome);
}

export function buildHistoryAnalytics(trades: PortfolioTrade[]) {
  const resolved = trades.map(trade => ({ trade, pnl: historyRealizedPnl(trade), premium: historyPremium(trade), days: historyDaysHeld(trade) })).filter(item => item.pnl != null);
  const realizedPnl = resolved.reduce((sum, item) => sum + item.pnl!, 0);
  const premiumCollected = resolved.reduce((sum, item) => sum + (item.premium ?? 0), 0);
  const dayValues = resolved.map(item => item.days).filter((value): value is number => value != null);
  const counts = { expired_worthless: 0, closed: 0, expired_itm: 0, assigned: 0 };
  resolved.forEach(item => { const outcome = historyOutcome(item.trade); if (outcome in counts) counts[outcome as keyof typeof counts] += 1; });
  const totalOutcomes = Object.values(counts).reduce((sum, value) => sum + value, 0);
  const originalAyItems = resolved.map(item => calculateOriginalAnnualizedYield(item.trade)).filter((value): value is number => value != null);
  const entryDelta = calculateHistoryWeightedEntryDelta(trades);
  return {
    resolvedTrades: resolved.length,
    realizedPnl: resolved.length ? realizedPnl : null,
    premiumCollected: resolved.length ? premiumCollected : null,
    blendedCapture: premiumCollected > 0 ? realizedPnl / premiumCollected : null,
    averageDaysHeld: dayValues.length ? dayValues.reduce((sum, value) => sum + value, 0) / dayValues.length : null,
    averageOriginalAy: originalAyItems.length ? originalAyItems.reduce((sum, value) => sum + value, 0) / originalAyItems.length : null,
    totalRealizedIrr: calculateHistoryTotalRealizedIrr(trades),
    weightedAverageEntryDelta: entryDelta.value,
    entryDeltaCoverage: entryDelta.coverage,
    totalHistoricalNotional: calculateTotalHistoricalNotional(trades),
    counts,
    percentages: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, totalOutcomes ? value / totalOutcomes : 0])) as Record<keyof typeof counts, number>,
  };
}

export function buildMonthlyRealizedPnl(trades: PortfolioTrade[]) {
  const months = new Map<string, { month: string; trades: number; premiumCollected: number; realizedPnl: number }>();
  trades.forEach(trade => {
    const pnl = historyRealizedPnl(trade);
    const resolvedDate = trade.closeDate ?? trade.resolvedDate ?? (trade.status === 'expired' ? trade.expiration : null);
    if (pnl == null || !resolvedDate || !/^\d{4}-\d{2}/.test(resolvedDate)) return;
    const month = resolvedDate.slice(0, 7);
    const current = months.get(month) ?? { month, trades: 0, premiumCollected: 0, realizedPnl: 0 };
    current.trades += 1;
    current.premiumCollected += historyPremium(trade) ?? 0;
    current.realizedPnl += pnl;
    months.set(month, current);
  });
  return [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
}

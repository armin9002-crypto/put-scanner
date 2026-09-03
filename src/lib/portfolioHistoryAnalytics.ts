import { isFiniteNumber } from './optionMetrics.ts';
import {
  calculateEquityAtRisk,
  calculateNetCapitalAtRisk,
  calculateOriginalAnnualizedYield,
  calculateOriginalNominalYield,
  calculatePremiumCollected,
} from './portfolioMetrics.ts';
import { isValidEntryDelta, isValidEntryIv } from './portfolioEntryDelta.ts';
import {
  canonicalHistoricalDaysHeld,
  canonicalHistoricalFinalOptionValue,
  canonicalHistoricalPremium,
  canonicalHistoricalRealizedPnl,
} from './portfolioRealizedEconomics.ts';
import type { PortfolioTrade } from './portfolioStorage';

export type HistoryOutcome = 'all' | 'expired_worthless' | 'closed' | 'expired_itm' | 'assigned';
export type HistoryGroupMode = 'year' | 'expiration' | 'underlying' | 'none';
export type RealizedPnlPeriod = 'month' | 'quarter' | 'year';

export interface ExpirationPeriodRealizedPnl {
  periodKey: string;
  label: string;
  startDate: string;
  endDate: string;
  tradeCount: number;
  premium: number;
  realizedPnl: number;
  captured: number | null;
  /** @deprecated Use tradeCount. */
  trades: number;
  /** @deprecated Use premium. */
  premiumCollected: number;
}

export interface RealizedPnlChartScale {
  min: number;
  max: number;
  zeroRatio: number;
}

export interface HistoryCashFlow {
  date: string;
  amount: number;
}

export interface HistoryGroupAggregates {
  tradeCount: number;
  contractCount: number;
  grossRisk: number;
  realizedPnl: number | null;
  premium: number;
  weightedAverageDaysHeld: number | null;
  weightedAverageNy: number | null;
  weightedAverageEntryVix: number | null;
  entryVixCoverage: number | null;
  weightedAverageEntryDelta: number | null;
  entryDeltaCoverage: number | null;
  weightedAverageEntryIv: number | null;
  entryIvCoverage: number | null;
  weightedAverageRealizedIrr: number | null;
  weightedAveragePercentCaptured: number | null;
}

export interface HistoryGroup extends HistoryGroupAggregates {
  key: string;
  label: string;
  trades: PortfolioTrade[];
}

export interface HistoryGrossRiskWeightedMetric {
  value: number | null;
  coverage: number | null;
  knownGrossRisk: number;
  totalGrossRisk: number;
}

export function historyOutcome(trade: PortfolioTrade): Exclude<HistoryOutcome, 'all'> | 'pending' {
  if (trade.status === 'closed') return 'closed';
  if (trade.status === 'assigned') return 'assigned';
  if (trade.status === 'expired_price_pending' || trade.resolutionType === 'expired_price_pending') return 'pending';
  if (trade.resolutionType === 'expired_itm') return 'expired_itm';
  return 'expired_worthless';
}

export function historyOutcomeLabel(trade: PortfolioTrade): string {
  switch (historyOutcome(trade)) {
    case 'closed': return 'Closed Manually';
    case 'pending': return 'Expiration Price Pending';
    case 'expired_itm': return 'Expired ITM / Assignment Likely';
    case 'expired_worthless': return 'Expired Worthless';
    case 'assigned': return 'Assigned';
  }
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

/** Canonical cash-secured historical notional; independent of current quotes. */
export function historyGrossRisk(trade: PortfolioTrade): number | null {
  return calculateEquityAtRisk(trade);
}

export function historyPercentCaptured(trade: PortfolioTrade): number | null {
  const premium = historyPremium(trade);
  const realizedPnl = historyRealizedPnl(trade);
  if (isFiniteNumber(premium) && premium > 0 && isFiniteNumber(realizedPnl)) return realizedPnl / premium;
  return isFiniteNumber(trade.percentCaptured) ? trade.percentCaptured : null;
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
  const grossRisk = historyGrossRisk(trade);
  const daysHeld = historyDaysHeld(trade);
  if (realizedPnl == null || grossRisk == null || grossRisk <= 0 || daysHeld == null || daysHeld <= 0) return null;
  const annualized = (realizedPnl / grossRisk) * (365 / daysHeld);
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

/**
 * General date-aware money-weighted return utility. It does not back any
 * canonical visible History yield or Realized IRR metric.
 * Multiple/no-real roots intentionally fail closed.
 */
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
 * Legacy/general cash-flow helper retained for explicit XIRR analysis only.
 * It does not back any canonical visible History yield or Realized IRR metric.
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
  return calculateGrossRiskWeightedHistoryMetric(trades, historyRealizedIrr).value;
}

function calculateWeightedHistoryMetric(
  trades: PortfolioTrade[],
  valueFor: (trade: PortfolioTrade) => number | null,
  weightFor: (trade: PortfolioTrade) => number | null,
): number | null {
  let weightedTotal = 0;
  let knownWeight = 0;
  trades.forEach(trade => {
    const value = valueFor(trade);
    const weight = weightFor(trade);
    if (!isFiniteNumber(value) || !isFiniteNumber(weight) || weight <= 0) return;
    weightedTotal += value * weight;
    knownWeight += weight;
  });
  return knownWeight > 0 ? weightedTotal / knownWeight : null;
}

function calculateGrossRiskWeightedHistoryMetric(
  trades: PortfolioTrade[],
  valueFor: (trade: PortfolioTrade) => number | null,
): HistoryGrossRiskWeightedMetric {
  let totalGrossRisk = 0;
  let knownGrossRisk = 0;
  let weightedValue = 0;
  trades.forEach(trade => {
    const grossRisk = historyGrossRisk(trade);
    if (!isFiniteNumber(grossRisk) || grossRisk <= 0) return;
    totalGrossRisk += grossRisk;
    const value = valueFor(trade);
    if (!isFiniteNumber(value)) return;
    knownGrossRisk += grossRisk;
    weightedValue += value * grossRisk;
  });
  return {
    value: knownGrossRisk > 0 ? weightedValue / knownGrossRisk : null,
    coverage: totalGrossRisk > 0 ? knownGrossRisk / totalGrossRisk : null,
    knownGrossRisk,
    totalGrossRisk,
  };
}

export function calculateHistoryWeightedEntryDelta(trades: PortfolioTrade[]): HistoryGrossRiskWeightedMetric {
  return calculateGrossRiskWeightedHistoryMetric(
    trades,
    trade => isValidEntryDelta(trade.entryDelta) ? trade.entryDelta : null,
  );
}

export function historyEntryIv(trade: PortfolioTrade): number | null {
  return isValidEntryIv(trade.entryIv) ? trade.entryIv! : null;
}

export function calculateHistoryWeightedEntryIv(trades: PortfolioTrade[]): HistoryGrossRiskWeightedMetric {
  return calculateGrossRiskWeightedHistoryMetric(trades, historyEntryIv);
}

/**
 * Canonical numeric aggregates for any History group. Group identity never changes
 * the formulas: exposure and yield metrics use Gross Risk,
 * and captured premium uses Premium so its weighted value reconciles to group P&L.
 */
export function buildHistoryGroupAggregates(trades: PortfolioTrade[]): HistoryGroupAggregates {
  const realizedPnlValues = trades.map(historyRealizedPnl).filter(isFiniteNumber);
  const entryVix = calculateGrossRiskWeightedHistoryMetric(trades, historyEntryVix);
  const entryDelta = calculateHistoryWeightedEntryDelta(trades);
  const entryIv = calculateHistoryWeightedEntryIv(trades);
  return {
    tradeCount: trades.length,
    contractCount: trades.reduce((sum, trade) => sum + trade.contracts, 0),
    grossRisk: trades.map(historyGrossRisk).filter(isFiniteNumber).reduce((sum, value) => sum + value, 0),
    premium: trades.map(historyPremium).filter(isFiniteNumber).reduce((sum, value) => sum + value, 0),
    realizedPnl: realizedPnlValues.length > 0 ? realizedPnlValues.reduce((sum, value) => sum + value, 0) : null,
    weightedAverageDaysHeld: calculateGrossRiskWeightedHistoryMetric(trades, historyDaysHeld).value,
    weightedAverageNy: calculateGrossRiskWeightedHistoryMetric(trades, historyEntryNominalYield).value,
    weightedAverageEntryVix: entryVix.value,
    entryVixCoverage: entryVix.coverage,
    weightedAverageEntryDelta: entryDelta.value,
    entryDeltaCoverage: entryDelta.coverage,
    weightedAverageEntryIv: entryIv.value,
    entryIvCoverage: entryIv.coverage,
    weightedAverageRealizedIrr: calculateGrossRiskWeightedHistoryMetric(trades, historyRealizedIrr).value,
    weightedAveragePercentCaptured: calculateWeightedHistoryMetric(trades, historyPercentCaptured, historyPremium),
  };
}

export function calculateTotalHistoricalNotional(trades: PortfolioTrade[]): number | null {
  if (trades.length === 0) return null;
  return trades.reduce((sum, trade) => sum + (historyGrossRisk(trade) ?? 0), 0);
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
  const groups = [...buckets.entries()].map(([key, bucket]) => ({
    key,
    label: bucket.label,
    trades: bucket.trades,
    ...buildHistoryGroupAggregates(bucket.trades),
  }));
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
  const entryIv = calculateHistoryWeightedEntryIv(trades);
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
    weightedAverageEntryIv: entryIv.value,
    entryIvCoverage: entryIv.coverage,
    totalHistoricalNotional: calculateTotalHistoricalNotional(trades),
    counts,
    percentages: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, totalOutcomes ? value / totalOutcomes : 0])) as Record<keyof typeof counts, number>,
  };
}

function finalCalendarDay(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function expirationPeriodIdentity(expiration: string, period: RealizedPnlPeriod) {
  const year = Number(expiration.slice(0, 4));
  const monthIndex = Number(expiration.slice(5, 7)) - 1;
  if (period === 'year') return {
    periodKey: String(year),
    label: String(year),
    startDate: `${year}-01-01`,
    endDate: `${year}-12-31`,
  };
  if (period === 'quarter') {
    const quarter = Math.floor(monthIndex / 3) + 1;
    const startMonth = (quarter - 1) * 3;
    const endMonth = startMonth + 2;
    return {
      periodKey: `${year}-Q${quarter}`,
      label: `Q${quarter} '${String(year).slice(2)}`,
      startDate: `${year}-${String(startMonth + 1).padStart(2, '0')}-01`,
      endDate: `${year}-${String(endMonth + 1).padStart(2, '0')}-${String(finalCalendarDay(year, endMonth)).padStart(2, '0')}`,
    };
  }
  const month = String(monthIndex + 1).padStart(2, '0');
  const date = new Date(Date.UTC(year, monthIndex, 1));
  return {
    periodKey: `${year}-${month}`,
    label: `${date.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} '${String(year).slice(2)}`,
    startDate: `${year}-${month}-01`,
    endDate: `${year}-${month}-${String(finalCalendarDay(year, monthIndex)).padStart(2, '0')}`,
  };
}

/** Aggregates canonical realized economics strictly by contract expiration period. */
export function buildExpirationPeriodRealizedPnl(
  trades: readonly PortfolioTrade[],
  period: RealizedPnlPeriod,
): ExpirationPeriodRealizedPnl[] {
  const buckets = new Map<string, Omit<ExpirationPeriodRealizedPnl, 'captured' | 'trades' | 'premiumCollected'>>();
  trades.forEach(trade => {
    const pnl = historyRealizedPnl(trade);
    if (pnl == null || !isIsoDate(trade.expiration)) return;
    const identity = expirationPeriodIdentity(trade.expiration, period);
    const current = buckets.get(identity.periodKey) ?? { ...identity, tradeCount: 0, premium: 0, realizedPnl: 0 };
    current.tradeCount += 1;
    current.premium += historyPremium(trade) ?? 0;
    current.realizedPnl += pnl;
    buckets.set(identity.periodKey, current);
  });
  return [...buckets.values()]
    .sort((left, right) => left.startDate.localeCompare(right.startDate))
    .map(bucket => ({
      ...bucket,
      captured: bucket.premium > 0 ? bucket.realizedPnl / bucket.premium : null,
      trades: bucket.tradeCount,
      premiumCollected: bucket.premium,
    }));
}

export function buildRealizedPnlChartScale(values: readonly number[]): RealizedPnlChartScale {
  const finite = values.filter(isFiniteNumber);
  const rawMin = Math.min(0, ...finite);
  const rawMax = Math.max(0, ...finite);
  const rawSpan = rawMax - rawMin;
  const reference = rawSpan > 0 ? rawSpan : Math.max(Math.abs(rawMax), Math.abs(rawMin), 1);
  const padding = reference * 0.08;
  const min = rawMin - padding;
  const max = rawMax + padding;
  return { min, max, zeroRatio: (max - 0) / (max - min) };
}

/** Backward-compatible month view; new callers should use buildExpirationPeriodRealizedPnl. */
export function buildMonthlyRealizedPnl(trades: PortfolioTrade[]) {
  return buildExpirationPeriodRealizedPnl(trades, 'month').map(bucket => ({
    month: bucket.periodKey,
    trades: bucket.tradeCount,
    premiumCollected: bucket.premium,
    realizedPnl: bucket.realizedPnl,
  }));
}

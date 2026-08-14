import { calculateNetCapitalAtRisk, calculateOriginalAnnualizedYield, calculatePremiumCollected } from './portfolioMetrics.ts';
import type { PortfolioTrade } from './portfolioStorage';

export type HistoryOutcome = 'all' | 'expired_worthless' | 'closed' | 'expired_itm' | 'assigned';

export function historyOutcome(trade: PortfolioTrade): Exclude<HistoryOutcome, 'all'> | 'pending' {
  if (trade.status === 'closed') return 'closed';
  if (trade.status === 'assigned') return 'assigned';
  if (trade.status === 'expired_price_pending' || trade.resolutionType === 'expired_price_pending') return 'pending';
  if (trade.resolutionType === 'expired_itm') return 'expired_itm';
  return 'expired_worthless';
}

export function historyRealizedPnl(trade: PortfolioTrade): number | null {
  if (Number.isFinite(trade.realizedPnl)) return trade.realizedPnl!;
  if (trade.status === 'closed' && Number.isFinite(trade.closePrice)) return (trade.soldPrice - trade.closePrice!) * trade.contracts * 100;
  if (trade.resolutionType === 'expired_worthless') return calculatePremiumCollected(trade);
  return null;
}

export function historyPremium(trade: PortfolioTrade): number | null {
  return Number.isFinite(trade.premiumCollected) ? trade.premiumCollected! : calculatePremiumCollected(trade);
}

export function historyDaysHeld(trade: PortfolioTrade): number | null {
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
  return {
    resolvedTrades: resolved.length,
    realizedPnl: resolved.length ? realizedPnl : null,
    premiumCollected: resolved.length ? premiumCollected : null,
    blendedCapture: premiumCollected > 0 ? realizedPnl / premiumCollected : null,
    averageDaysHeld: dayValues.length ? dayValues.reduce((sum, value) => sum + value, 0) / dayValues.length : null,
    averageOriginalAy: originalAyItems.length ? originalAyItems.reduce((sum, value) => sum + value, 0) / originalAyItems.length : null,
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

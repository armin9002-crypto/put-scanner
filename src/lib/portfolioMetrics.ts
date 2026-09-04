import { calculateAnnualizedYield, calculateDte, calculateNominalYield, isFiniteNumber } from './optionMetrics.ts';
import type { PortfolioTrade } from './portfolioStorage';

export type MarkBasis = 'ask' | 'mid' | 'bid' | 'last';

export interface PortfolioSummaryMetrics {
  totalOpenContracts: number;
  totalPremiumCollected: number;
  totalEquityAtRisk: number;
  totalNetCapitalAtRisk: number;
  totalCurrentValue: number | null;
  totalCostBasis: number | null;
  totalUnrealizedPnlAsk: number | null;
  totalUnrealizedPnlMid: number | null;
  totalUnrealizedPnlPreferred: number | null;
  weightedAverageSoldPrice: number | null;
  weightedAverageOriginalAnnualizedYield: number | null;
  weightedAverageRemainingAnnualizedYield: number | null;
  weightedAverageRemainingDte: number | null;
  totalOpenTrades: number;
  totalClosedTrades: number;
  realizedPnl: number | null;
}

export interface PortfolioMarkSummaryMetrics {
  totalCurrentValue: number | null;
  totalGainLoss: number | null;
  totalCurrentPremium: number | null;
  percentCaptured: number | null;
  portfolioOriginalNominalYield: number | null;
  portfolioOriginalAnnualizedYield: number | null;
  portfolioCurrentNominalYield: number | null;
  portfolioCurrentAnnualizedYield: number | null;
  weightedAverageDelta: number | null;
  totalDeltaExposure: number | null;
}

function derivedPositionMetric(trade: PortfolioTrade, field: 'originalDte' | 'originalAnnualizedYield'): number | null | undefined {
  const metrics = (trade as PortfolioTrade & { positionMetrics?: Record<string, number | null> }).positionMetrics;
  return metrics && field in metrics ? metrics[field] : undefined;
}

function validContracts(trade: PortfolioTrade): number | null {
  return Number.isInteger(trade.contracts) && trade.contracts > 0 ? trade.contracts : null;
}

function positive(value: unknown, allowZero = false): number | null {
  if (!isFiniteNumber(value)) return null;
  return allowZero ? value >= 0 ? value : null : value > 0 ? value : null;
}

function safeRatio(numerator: number | null, denominator: number | null): number | null {
  if (!isFiniteNumber(numerator) || !isFiniteNumber(denominator) || denominator <= 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

export function isOpenTrade(trade: PortfolioTrade): boolean {
  return trade.status === 'open';
}

export function calculatePremiumCollected(trade: PortfolioTrade): number | null {
  const price = positive(trade.soldPrice, true);
  const contracts = validContracts(trade);
  return price != null && contracts != null ? price * 100 * contracts : null;
}

export function calculateEquityAtRisk(trade: PortfolioTrade): number | null {
  const strike = positive(trade.strike);
  const contracts = validContracts(trade);
  return strike != null && contracts != null ? strike * 100 * contracts : null;
}

export function calculateNetCapitalAtRisk(trade: PortfolioTrade): number | null {
  const equityAtRisk = calculateEquityAtRisk(trade);
  const premium = calculatePremiumCollected(trade);
  return equityAtRisk != null && premium != null ? equityAtRisk - premium : null;
}

export function calculateBreakeven(trade: PortfolioTrade): number | null {
  const strike = positive(trade.strike);
  const price = positive(trade.soldPrice, true);
  return strike != null && price != null ? strike - price : null;
}

export function calculateOriginalDte(trade: PortfolioTrade): number | null {
  const derived = derivedPositionMetric(trade, 'originalDte');
  if (derived !== undefined) return derived;
  const sold = parseIsoDateUtc(trade.soldDate);
  const expiration = parseIsoDateUtc(trade.expiration);
  if (sold == null || expiration == null) return null;
  return Math.round((expiration - sold) / 86400000);
}

export function calculateRemainingDte(trade: PortfolioTrade): number | null {
  const value = calculateDte(trade.expiration);
  return value == null ? null : Math.max(0, value);
}

export function calculateOriginalAnnualizedYield(trade: PortfolioTrade): number | null {
  const derived = derivedPositionMetric(trade, 'originalAnnualizedYield');
  if (derived !== undefined) return derived;
  return calculateAnnualizedYield(trade.soldPrice, trade.strike, calculateOriginalDte(trade));
}

export function calculateCurrentOptionMark(trade: PortfolioTrade, basis: MarkBasis): number | null {
  const md = trade.latestMarketData;
  if (!md) return null;
  if (basis === 'ask') return positive(md.optionAsk);
  if (basis === 'bid') return positive(md.optionBid);
  if (basis === 'last') return positive(md.optionLast);
  const explicitMid = positive(md.optionMid);
  if (explicitMid != null) return explicitMid;
  const bid = positive(md.optionBid);
  const ask = positive(md.optionAsk);
  if (bid != null && ask != null && ask >= bid) return (bid + ask) / 2;
  return positive(md.optionLast);
}

export function calculateOriginalNominalYield(trade: PortfolioTrade): number | null {
  return calculateNominalYield(trade.soldPrice, trade.strike);
}

export function calculateUnrealizedPnl(trade: PortfolioTrade, basis: MarkBasis): number | null {
  if (!isOpenTrade(trade)) return null;
  const mark = calculateCurrentOptionMark(trade, basis);
  const contracts = validContracts(trade);
  const soldPrice = positive(trade.soldPrice, true);
  if (mark == null || contracts == null || soldPrice == null) return null;
  return (soldPrice - mark) * 100 * contracts;
}

export function calculateImportedCurrentValue(trade: PortfolioTrade): number | null {
  const value = trade.importedSnapshot?.currentValue;
  return isFiniteNumber(value) ? value : null;
}

export function calculateCurrentPositionValue(trade: PortfolioTrade, basis: MarkBasis): number | null {
  if (!isOpenTrade(trade)) return null;
  const mark = calculateCurrentOptionMark(trade, basis);
  const contracts = validContracts(trade);
  return mark != null && contracts != null ? -mark * 100 * contracts : null;
}

export function calculateCurrentMarkValueAbsolute(trade: PortfolioTrade, basis: MarkBasis): number | null {
  if (!isOpenTrade(trade)) return null;
  const mark = calculateCurrentOptionMark(trade, basis);
  const contracts = validContracts(trade);
  return mark != null && contracts != null ? mark * 100 * contracts : null;
}

export function calculateTotalGainLoss(trade: PortfolioTrade, basis: MarkBasis): number | null {
  if (!isOpenTrade(trade)) return null;
  const premium = calculatePremiumCollected(trade);
  const currentValue = calculateCurrentPositionValue(trade, basis);
  return premium != null && currentValue != null ? premium + currentValue : null;
}

export function calculatePercentCaptured(trade: PortfolioTrade, basis: MarkBasis): number | null {
  return safeRatio(calculateTotalGainLoss(trade, basis), calculatePremiumCollected(trade));
}

export function calculateCurrentNominalYield(trade: PortfolioTrade, basis: MarkBasis): number | null {
  if (!isOpenTrade(trade)) return null;
  return calculateNominalYield(calculateCurrentOptionMark(trade, basis), trade.strike);
}

export function calculateCurrentAnnualizedYield(trade: PortfolioTrade, basis: MarkBasis): number | null {
  if (!isOpenTrade(trade)) return null;
  return calculateAnnualizedYield(calculateCurrentOptionMark(trade, basis), trade.strike, calculateRemainingDte(trade));
}

export function calculatePreferredCurrentPositionValue(trade: PortfolioTrade): number | null {
  return calculateCurrentPositionValue(trade, 'ask')
    ?? calculateImportedCurrentValue(trade)
    ?? calculateCurrentPositionValue(trade, 'mid');
}

export function calculatePreferredUnrealizedPnl(trade: PortfolioTrade): number | null {
  if (!isOpenTrade(trade)) return null;
  const askPnl = calculateUnrealizedPnl(trade, 'ask');
  if (askPnl != null) return askPnl;
  const premium = calculatePremiumCollected(trade);
  const importedValue = calculateImportedCurrentValue(trade);
  if (premium != null && importedValue != null) return premium + importedValue;
  return calculateUnrealizedPnl(trade, 'mid');
}

export function getPreferredMtmSource(trade: PortfolioTrade): 'ask' | 'imported_snapshot' | 'mid' | null {
  if (calculateCurrentPositionValue(trade, 'ask') != null) return 'ask';
  if (calculateImportedCurrentValue(trade) != null) return 'imported_snapshot';
  if (calculateCurrentPositionValue(trade, 'mid') != null) return 'mid';
  return null;
}

export function calculateRemainingAnnualizedYieldToExpiry(trade: PortfolioTrade, basis: MarkBasis): number | null {
  if (!isOpenTrade(trade)) return null;
  const mark = calculateCurrentOptionMark(trade, basis);
  const remainingDte = calculateRemainingDte(trade);
  const equityAtRisk = calculateEquityAtRisk(trade);
  if (mark == null || !isFiniteNumber(remainingDte) || remainingDte <= 0) return null;
  const contracts = validContracts(trade);
  const optionValue = contracts != null ? mark * 100 * contracts : null;
  const currentNetRisk = equityAtRisk != null && optionValue != null ? equityAtRisk - optionValue : null;
  const ratio = safeRatio(optionValue, currentNetRisk);
  return ratio == null ? null : ratio * (365 / remainingDte);
}

export function calculateWeightedAverageDelta(trades: PortfolioTrade[]): number | null {
  return weightedAverage(
    trades.filter(isOpenTrade).map(trade => ({
      value: isFiniteNumber(trade.latestMarketData?.delta) ? trade.latestMarketData.delta : null,
      weight: calculateEquityAtRisk(trade),
    }))
  );
}

export function calculateTotalDeltaExposure(trades: PortfolioTrade[]): number | null {
  const values = trades.filter(isOpenTrade).map(trade => {
    const delta = trade.latestMarketData?.delta;
    const contracts = validContracts(trade);
    return isFiniteNumber(delta) && contracts != null ? delta * 100 * contracts : null;
  }).filter(isFiniteNumber);
  return values.length > 0 ? sum(values) : null;
}

export function calculateDistanceToStrike(trade: PortfolioTrade): number | null {
  const underlying = positive(trade.latestMarketData?.underlyingPrice ?? trade.entrySnapshot?.underlyingPrice);
  const strike = positive(trade.strike);
  return underlying != null && strike != null ? (underlying - strike) / underlying : null;
}

export function calculateDistanceToBreakeven(trade: PortfolioTrade): number | null {
  const underlying = positive(trade.latestMarketData?.underlyingPrice ?? trade.entrySnapshot?.underlyingPrice);
  const breakeven = calculateBreakeven(trade);
  return underlying != null && breakeven != null ? (underlying - breakeven) / underlying : null;
}

export function calculateRealizedPnl(trade: PortfolioTrade): number | null {
  if (isFiniteNumber(trade.realizedPnl)) return trade.realizedPnl;
  if (trade.status === 'assigned') return null;
  const premium = positive(trade.soldPrice, true);
  const contracts = validContracts(trade);
  const closePrice = trade.status === 'expired' ? 0 : positive(trade.closePrice, true);
  if (premium == null || contracts == null || closePrice == null) return null;
  return (premium - closePrice) * 100 * contracts;
}

export function calculatePortfolioSummary(trades: PortfolioTrade[]): PortfolioSummaryMetrics {
  const openTrades = trades.filter(isOpenTrade);
  const closedTrades = trades.filter(trade => trade.status !== 'open');

  const totalPremiumCollected = sum(openTrades.map(calculatePremiumCollected));
  const totalEquityAtRisk = sum(openTrades.map(calculateEquityAtRisk));
  const totalNetCapitalAtRisk = sum(openTrades.map(calculateNetCapitalAtRisk));
  const totalCurrentValue = nullableSum(openTrades.map(calculatePreferredCurrentPositionValue));
  const totalCostBasis = nullableSum(openTrades.map(trade => trade.importedSnapshot?.costBasisTotal ?? calculatePremiumCollected(trade)));
  const totalUnrealizedPnlAsk = nullableSum(openTrades.map(trade => calculateUnrealizedPnl(trade, 'ask')));
  const totalUnrealizedPnlMid = nullableSum(openTrades.map(trade => calculateUnrealizedPnl(trade, 'mid')));
  const totalUnrealizedPnlPreferred = nullableSum(openTrades.map(calculatePreferredUnrealizedPnl));
  const realizedPnl = nullableSum(trades.map(calculateRealizedPnl));

  return {
    totalOpenContracts: openTrades.reduce((total, trade) => total + trade.contracts, 0),
    totalPremiumCollected,
    totalEquityAtRisk,
    totalNetCapitalAtRisk,
    totalCurrentValue,
    totalCostBasis,
    totalUnrealizedPnlAsk,
    totalUnrealizedPnlMid,
    totalUnrealizedPnlPreferred,
    weightedAverageSoldPrice: weightedAverage(
      openTrades.map(trade => ({
        value: positive(trade.soldPrice, true),
        weight: validContracts(trade),
      }))
    ),
    weightedAverageOriginalAnnualizedYield: weightedAverage(
      openTrades.map(trade => ({
        value: calculateOriginalAnnualizedYield(trade),
        weight: calculateEquityAtRisk(trade),
      }))
    ),
    weightedAverageRemainingAnnualizedYield: weightedAverage(
      openTrades.map(trade => ({
        value: calculateRemainingAnnualizedYieldToExpiry(trade, 'ask') ?? calculateRemainingAnnualizedYieldToExpiry(trade, 'mid'),
        weight: calculateNetCapitalAtRisk(trade),
      }))
    ),
    weightedAverageRemainingDte: weightedAverage(
      openTrades.map(trade => ({
        value: calculateRemainingDte(trade),
        weight: calculateNetCapitalAtRisk(trade),
      }))
    ),
    totalOpenTrades: openTrades.length,
    totalClosedTrades: closedTrades.length,
    realizedPnl,
  };
}

export function calculatePortfolioMarkSummary(trades: PortfolioTrade[], basis: MarkBasis): PortfolioMarkSummaryMetrics {
  const openTrades = trades.filter(isOpenTrade);
  const totalPremium = sum(openTrades.map(calculatePremiumCollected));
  const totalGrossRisk = sum(openTrades.map(calculateEquityAtRisk));
  const totalCurrentValue = completeNullableSum(openTrades.map(trade => calculateCurrentPositionValue(trade, basis)));
  const totalCurrentPremium = completeNullableSum(openTrades.map(trade => calculateCurrentMarkValueAbsolute(trade, basis)));
  const totalGainLoss = totalCurrentValue != null ? totalPremium + totalCurrentValue : null;

  return {
    totalCurrentValue,
    totalGainLoss,
    totalCurrentPremium,
    percentCaptured: safeRatio(totalGainLoss, totalPremium),
    portfolioOriginalNominalYield: safeRatio(totalPremium, totalGrossRisk),
    portfolioOriginalAnnualizedYield: weightedAverage(openTrades.map(trade => ({
      value: calculateOriginalAnnualizedYield(trade),
      weight: calculateEquityAtRisk(trade),
    }))),
    portfolioCurrentNominalYield: safeRatio(totalCurrentPremium, totalGrossRisk),
    portfolioCurrentAnnualizedYield: totalCurrentPremium == null ? null : weightedAverage(openTrades.map(trade => ({
      value: calculateCurrentAnnualizedYield(trade, basis),
      weight: calculateEquityAtRisk(trade),
    }))),
    weightedAverageDelta: calculateWeightedAverageDelta(openTrades),
    totalDeltaExposure: calculateTotalDeltaExposure(openTrades),
  };
}

function parseIsoDateUtc(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (isFiniteNumber(value) ? value : 0), 0);
}

function nullableSum(values: Array<number | null>): number | null {
  const valid = values.filter(isFiniteNumber);
  return valid.length > 0 ? sum(valid) : null;
}

function completeNullableSum(values: Array<number | null>): number | null {
  if (values.length === 0 || values.some(value => !isFiniteNumber(value))) return null;
  return sum(values);
}

function weightedAverage(items: Array<{ value: number | null; weight: number | null }>): number | null {
  const totals = items.reduce((acc, item) => {
    if (!isFiniteNumber(item.value) || !isFiniteNumber(item.weight) || item.weight <= 0) return acc;
    return {
      weighted: acc.weighted + item.value * item.weight,
      weight: acc.weight + item.weight,
    };
  }, { weighted: 0, weight: 0 });
  return totals.weight > 0 ? totals.weighted / totals.weight : null;
}

import { ETF_LIST } from './etfs';
import { calculateDte, isFiniteNumber } from './optionMetrics';
import {
  calculateBreakeven,
  calculateCurrentAnnualizedYield,
  calculateCurrentMarkValueAbsolute,
  calculateCurrentNominalYield,
  calculateCurrentOptionMark,
  calculateCurrentPositionValue,
  calculateDistanceToBreakeven,
  calculateDistanceToStrike,
  calculateEquityAtRisk,
  calculateNetCapitalAtRisk,
  calculateOriginalAnnualizedYield,
  calculateOriginalDte,
  calculateOriginalNominalYield,
  calculatePercentCaptured,
  calculatePremiumCollected,
  calculateRemainingDte,
  calculateTotalGainLoss,
  isOpenTrade,
  type MarkBasis,
} from './portfolioMetrics';
import type { PortfolioTrade } from './portfolioStorage';

export type PortfolioDteBucket =
  | 'Expired / 0 DTE'
  | '1-7'
  | '8-14'
  | '15-30'
  | '31-60'
  | '61-90'
  | '90+';

export type PortfolioBreakevenRiskBucket =
  | 'Below Breakeven'
  | '0-5% Above Breakeven'
  | '5-10% Above Breakeven'
  | '10-20% Above Breakeven'
  | '20%+ Above Breakeven'
  | 'Unknown';

export interface PortfolioTotals {
  tradeCount: number;
  grossRisk: number;
  netCapitalAtRisk: number;
  premiumCollected: number;
  currentValue: number | null;
  totalGainLoss: number | null;
  currentMarkValue: number | null;
  deltaExposure: number | null;
  underlyingEquivalentExposure: number | null;
  weightedAverageDelta: number | null;
  originalNY: number | null;
  originalAY: number | null;
  currentNY: number | null;
  currentAY: number | null;
  averageDte: number | null;
}

export interface PortfolioExposureGroup extends PortfolioTotals {
  key: string;
  label: string;
}

export interface EtfMetadata {
  category: string;
  leverage: string;
  theme: string;
}

const ETF_METADATA = new Map(
  ETF_LIST.map(etf => [etf.ticker.toUpperCase(), {
    category: getCategoryBucket(etf.type),
    leverage: getLeverageBucket(etf.leverage, etf.underlying, etf.type),
    theme: getThemeBucket(etf.underlying, etf.type),
  }])
);

const FALLBACK_METADATA = new Map<string, EtfMetadata>([
  ['SPY', { category: 'Broad Index', leverage: '1x', theme: 'Broad Market / S&P 500' }],
  ['VOO', { category: 'Broad Index', leverage: '1x', theme: 'Broad Market / S&P 500' }],
  ['IVV', { category: 'Broad Index', leverage: '1x', theme: 'Broad Market / S&P 500' }],
  ['QQQ', { category: 'Broad Index', leverage: '1x', theme: 'Nasdaq / Mega-cap Tech' }],
  ['IWM', { category: 'Broad Index', leverage: '1x', theme: 'Small Caps' }],
  ['DIA', { category: 'Broad Index', leverage: '1x', theme: 'Broad Market / S&P 500' }],
  ['VIX', { category: 'Volatility', leverage: 'Volatility', theme: 'Volatility' }],
  ['VXN', { category: 'Volatility', leverage: 'Volatility', theme: 'Volatility' }],
]);

const DTE_BUCKETS: Array<{ label: PortfolioDteBucket; match: (dte: number | null) => boolean }> = [
  { label: 'Expired / 0 DTE', match: dte => dte == null || dte <= 0 },
  { label: '1-7', match: dte => dte != null && dte >= 1 && dte <= 7 },
  { label: '8-14', match: dte => dte != null && dte >= 8 && dte <= 14 },
  { label: '15-30', match: dte => dte != null && dte >= 15 && dte <= 30 },
  { label: '31-60', match: dte => dte != null && dte >= 31 && dte <= 60 },
  { label: '61-90', match: dte => dte != null && dte >= 61 && dte <= 90 },
  { label: '90+', match: dte => dte != null && dte > 90 },
];

const BREAKEVEN_BUCKETS: Array<{ label: PortfolioBreakevenRiskBucket; match: (distance: number | null) => boolean }> = [
  { label: 'Below Breakeven', match: distance => distance != null && distance < 0 },
  { label: '0-5% Above Breakeven', match: distance => distance != null && distance >= 0 && distance < 0.05 },
  { label: '5-10% Above Breakeven', match: distance => distance != null && distance >= 0.05 && distance < 0.10 },
  { label: '10-20% Above Breakeven', match: distance => distance != null && distance >= 0.10 && distance < 0.20 },
  { label: '20%+ Above Breakeven', match: distance => distance != null && distance >= 0.20 },
  { label: 'Unknown', match: distance => distance == null },
];

export function getTradeGrossRisk(trade: PortfolioTrade): number | null {
  return calculateEquityAtRisk(trade);
}

export function getTradeNetCapitalAtRisk(trade: PortfolioTrade): number | null {
  return calculateNetCapitalAtRisk(trade);
}

export function getTradePremiumCollected(trade: PortfolioTrade): number | null {
  return calculatePremiumCollected(trade);
}

export function getTradeBreakeven(trade: PortfolioTrade): number | null {
  return calculateBreakeven(trade);
}

export function getTradeCurrentMark(trade: PortfolioTrade, markBasis: MarkBasis): number | null {
  return calculateCurrentOptionMark(trade, markBasis);
}

export function getTradeCurrentValue(trade: PortfolioTrade, markBasis: MarkBasis): number | null {
  return calculateCurrentPositionValue(trade, markBasis);
}

export function getTradeTotalGainLoss(trade: PortfolioTrade, markBasis: MarkBasis): number | null {
  return calculateTotalGainLoss(trade, markBasis);
}

export function getTradePercentCaptured(trade: PortfolioTrade, markBasis: MarkBasis): number | null {
  return calculatePercentCaptured(trade, markBasis);
}

export function getTradeDistanceToStrike(trade: PortfolioTrade): number | null {
  return calculateDistanceToStrike(trade);
}

export function getTradeDistanceToBreakeven(trade: PortfolioTrade): number | null {
  return calculateDistanceToBreakeven(trade);
}

export function getTradeOriginalNY(trade: PortfolioTrade): number | null {
  return calculateOriginalNominalYield(trade);
}

export function getTradeOriginalAY(trade: PortfolioTrade): number | null {
  return calculateOriginalAnnualizedYield(trade);
}

export function getTradeCurrentNY(trade: PortfolioTrade, markBasis: MarkBasis): number | null {
  return calculateCurrentNominalYield(trade, markBasis);
}

export function getTradeCurrentAY(trade: PortfolioTrade, markBasis: MarkBasis): number | null {
  return calculateCurrentAnnualizedYield(trade, markBasis);
}

export function getTradeDeltaExposure(trade: PortfolioTrade): number | null {
  const delta = trade.latestMarketData?.delta;
  return isFiniteNumber(delta) && validContracts(trade) != null ? delta * 100 * trade.contracts : null;
}

export function getTradeUnderlyingEquivalentExposure(trade: PortfolioTrade): number | null {
  const delta = trade.latestMarketData?.delta;
  const underlying = getUnderlyingPrice(trade);
  return isFiniteNumber(delta) && underlying != null && validContracts(trade) != null
    ? Math.abs(delta) * underlying * 100 * trade.contracts
    : null;
}

export function getPortfolioTotals(trades: PortfolioTrade[], markBasis: MarkBasis): PortfolioTotals {
  return buildTotals(openTrades(trades), markBasis);
}

export function getPortfolioOriginalNY(trades: PortfolioTrade[]): number | null {
  const open = openTrades(trades);
  return safeRatio(sum(open.map(getTradePremiumCollected)), sum(open.map(getTradeNetCapitalAtRisk)));
}

export function getPortfolioOriginalAYDollarDays(trades: PortfolioTrade[]): number | null {
  const open = openTrades(trades);
  const premium = sum(open.map(getTradePremiumCollected));
  // Annualize against aggregate dollars-at-risk multiplied by days at risk.
  const dollarDays = sum(open.map(trade => {
    const netRisk = getTradeNetCapitalAtRisk(trade);
    const dte = calculateOriginalDte(trade);
    return netRisk != null && isFiniteNumber(dte) && dte > 0 ? netRisk * dte / 365 : null;
  }));
  return dollarDays > 0 ? premium / dollarDays : null;
}

export function getPortfolioCurrentNY(trades: PortfolioTrade[], markBasis: MarkBasis): number | null {
  const open = openTrades(trades);
  return safeRatio(completeSum(open.map(trade => calculateCurrentMarkValueAbsolute(trade, markBasis))), sum(open.map(getTradeNetCapitalAtRisk)));
}

export function getPortfolioCurrentAYDollarDays(trades: PortfolioTrade[], markBasis: MarkBasis): number | null {
  const open = openTrades(trades);
  const currentPremium = completeSum(open.map(trade => calculateCurrentMarkValueAbsolute(trade, markBasis)));
  // Same dollar-days approach as original AY, but using remaining option value and remaining DTE.
  const dollarDays = sum(open.map(trade => {
    const netRisk = getTradeNetCapitalAtRisk(trade);
    const dte = getRemainingDte(trade);
    return netRisk != null && isFiniteNumber(dte) && dte > 0 ? netRisk * dte / 365 : null;
  }));
  return currentPremium != null && dollarDays > 0 ? currentPremium / dollarDays : null;
}

export function getWeightedAverageDelta(trades: PortfolioTrade[]): number | null {
  return weightedAverage(openTrades(trades).map(trade => ({
    value: trade.latestMarketData?.delta,
    weight: getTradeGrossRisk(trade),
  })));
}

export function getTotalDeltaExposure(trades: PortfolioTrade[]): number | null {
  return nullableSum(openTrades(trades).map(getTradeDeltaExposure));
}

export function getTotalUnderlyingEquivalentExposure(trades: PortfolioTrade[]): number | null {
  return nullableSum(openTrades(trades).map(getTradeUnderlyingEquivalentExposure));
}

export function groupByExpiration(trades: PortfolioTrade[], markBasis: MarkBasis): PortfolioExposureGroup[] {
  return buildGroups(openTrades(trades), markBasis, trade => trade.expiration, trade => trade.expiration)
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function groupByDteBucket(trades: PortfolioTrade[], markBasis: MarkBasis): PortfolioExposureGroup[] {
  return DTE_BUCKETS.map(bucket => {
    const grouped = openTrades(trades).filter(trade => bucket.match(getRemainingDte(trade)));
    return toGroup(bucket.label, bucket.label, grouped, markBasis);
  }).filter(group => group.tradeCount > 0);
}

export function groupByBreakevenRiskBucket(trades: PortfolioTrade[], markBasis: MarkBasis): PortfolioExposureGroup[] {
  return BREAKEVEN_BUCKETS.map(bucket => {
    const grouped = openTrades(trades).filter(trade => bucket.match(getTradeDistanceToBreakeven(trade)));
    return toGroup(bucket.label, bucket.label, grouped, markBasis);
  }).filter(group => group.tradeCount > 0);
}

export function groupByTicker(trades: PortfolioTrade[], markBasis: MarkBasis): PortfolioExposureGroup[] {
  return buildGroups(openTrades(trades), markBasis, trade => normalizeTicker(trade.ticker), trade => normalizeTicker(trade.ticker))
    .sort((a, b) => b.grossRisk - a.grossRisk);
}

export function groupByCategory(trades: PortfolioTrade[], markBasis: MarkBasis): PortfolioExposureGroup[] {
  return buildGroups(openTrades(trades), markBasis, trade => getMetadata(trade).category, trade => getMetadata(trade).category)
    .sort((a, b) => b.grossRisk - a.grossRisk);
}

export function groupByLeverage(trades: PortfolioTrade[], markBasis: MarkBasis): PortfolioExposureGroup[] {
  return buildGroups(openTrades(trades), markBasis, trade => getMetadata(trade).leverage, trade => getMetadata(trade).leverage)
    .sort((a, b) => leverageSort(a.label) - leverageSort(b.label) || b.grossRisk - a.grossRisk);
}

export function groupByThemeBucket(trades: PortfolioTrade[], markBasis: MarkBasis): PortfolioExposureGroup[] {
  return buildGroups(openTrades(trades), markBasis, trade => getMetadata(trade).theme, trade => getMetadata(trade).theme)
    .sort((a, b) => b.grossRisk - a.grossRisk);
}

export function groupByCorrelatedDrawdownBucket(trades: PortfolioTrade[], markBasis: MarkBasis): PortfolioExposureGroup[] {
  return groupByThemeBucket(trades, markBasis);
}

function buildGroups(
  trades: PortfolioTrade[],
  markBasis: MarkBasis,
  keyFn: (trade: PortfolioTrade) => string,
  labelFn: (trade: PortfolioTrade) => string
): PortfolioExposureGroup[] {
  const groups = new Map<string, { label: string; trades: PortfolioTrade[] }>();
  trades.forEach(trade => {
    const key = keyFn(trade);
    const current = groups.get(key) ?? { label: labelFn(trade), trades: [] };
    current.trades.push(trade);
    groups.set(key, current);
  });
  return [...groups.entries()].map(([key, value]) => toGroup(key, value.label, value.trades, markBasis));
}

function toGroup(key: string, label: string, trades: PortfolioTrade[], markBasis: MarkBasis): PortfolioExposureGroup {
  return {
    key,
    label,
    ...buildTotals(trades, markBasis),
  };
}

function buildTotals(trades: PortfolioTrade[], markBasis: MarkBasis): PortfolioTotals {
  const premiumCollected = sum(trades.map(getTradePremiumCollected));
  const grossRisk = sum(trades.map(getTradeGrossRisk));
  const netCapitalAtRisk = sum(trades.map(getTradeNetCapitalAtRisk));
  const currentMarkValue = completeSum(trades.map(trade => calculateCurrentMarkValueAbsolute(trade, markBasis)));
  const currentValue = completeSum(trades.map(trade => getTradeCurrentValue(trade, markBasis)));
  const totalGainLoss = currentValue != null ? premiumCollected + currentValue : null;

  return {
    tradeCount: trades.length,
    grossRisk,
    netCapitalAtRisk,
    premiumCollected,
    currentValue,
    totalGainLoss,
    currentMarkValue,
    deltaExposure: nullableSum(trades.map(getTradeDeltaExposure)),
    underlyingEquivalentExposure: nullableSum(trades.map(getTradeUnderlyingEquivalentExposure)),
    weightedAverageDelta: weightedAverage(trades.map(trade => ({ value: trade.latestMarketData?.delta, weight: getTradeGrossRisk(trade) }))),
    originalNY: safeRatio(premiumCollected, netCapitalAtRisk),
    originalAY: getPortfolioOriginalAYDollarDays(trades),
    currentNY: safeRatio(currentMarkValue, netCapitalAtRisk),
    currentAY: getPortfolioCurrentAYDollarDays(trades, markBasis),
    averageDte: weightedAverage(trades.map(trade => ({ value: getRemainingDte(trade), weight: getTradeNetCapitalAtRisk(trade) }))),
  };
}

export function getPortfolioEtfMetadata(ticker: string): EtfMetadata {
  const normalized = normalizeTicker(ticker);
  return ETF_METADATA.get(normalized) ?? FALLBACK_METADATA.get(normalized) ?? { category: 'Other', leverage: 'Other', theme: 'Other' };
}

function getMetadata(trade: PortfolioTrade): EtfMetadata {
  return getPortfolioEtfMetadata(trade.ticker);
}

function getCategoryBucket(category: string): string {
  if (category === 'Broad Index') return 'Broad Index';
  if (category === 'Commodity') return 'Commodity';
  if (category === 'Country') return 'Country';
  if (category === 'Sector') return 'Sector';
  if (category === 'Volatility') return 'Volatility';
  return 'Other';
}

function getLeverageBucket(leverage: string, underlying: string, category: string): string {
  const value = `${leverage} ${underlying} ${category}`.toLowerCase();
  if (/vix|volatility/.test(value)) return 'Volatility';
  if (/inverse|bear|short/.test(value)) return 'Inverse';
  if (/\b3x\b/.test(value)) return '3x';
  if (/\b2x\b/.test(value)) return '2x';
  if (/\b1x\b/.test(value)) return '1x';
  return 'Other';
}

function leverageSort(label: string): number {
  const order = ['1x', '2x', '3x', 'Inverse', 'Volatility', 'Other'];
  const index = order.indexOf(label);
  return index === -1 ? order.length : index;
}

function getThemeBucket(underlying: string, category: string): string {
  const value = `${underlying} ${category}`.toLowerCase();
  if (/vix|volatility/.test(value)) return 'Volatility';
  if (/semiconductor/.test(value)) return 'Semiconductors';
  if (/biotech|healthcare/.test(value)) return 'Biotech';
  if (/china/.test(value)) return 'China';
  if (/russell|small cap|mid cap/.test(value)) return 'Small Caps';
  if (/nasdaq|qqq|fang|technology|internet|software/.test(value)) return 'Nasdaq / Mega-cap Tech';
  if (/s&p|dow|broad|high beta/.test(value)) return 'Broad Market / S&P 500';
  if (/oil|gas|energy|crude|natural gas|gold|silver|mining|commodity|materials/.test(value)) return 'Commodities';
  if (/financial|bank/.test(value)) return 'Financials';
  return 'Other';
}

function openTrades(trades: PortfolioTrade[]): PortfolioTrade[] {
  return trades.filter(isOpenTrade);
}

function getUnderlyingPrice(trade: PortfolioTrade): number | null {
  return positive(trade.latestMarketData?.underlyingPrice ?? trade.entrySnapshot?.underlyingPrice);
}

function getRemainingDte(trade: PortfolioTrade): number | null {
  return calculateRemainingDte(trade) ?? calculateDte(trade.expiration);
}

function normalizeTicker(value: string): string {
  return value.trim().toUpperCase();
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

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (isFiniteNumber(value) ? value : 0), 0);
}

function nullableSum(values: Array<number | null>): number | null {
  const valid = values.filter(isFiniteNumber);
  return valid.length > 0 ? sum(valid) : null;
}

function completeSum(values: Array<number | null>): number | null {
  if (values.length === 0 || values.some(value => !isFiniteNumber(value))) return null;
  return sum(values);
}

function weightedAverage(items: Array<{ value: number | null | undefined; weight: number | null | undefined }>): number | null {
  const totals = items.reduce((acc, item) => {
    if (!isFiniteNumber(item.value) || !isFiniteNumber(item.weight) || item.weight <= 0) return acc;
    return {
      weighted: acc.weighted + item.value * item.weight,
      weight: acc.weight + item.weight,
    };
  }, { weighted: 0, weight: 0 });
  return totals.weight > 0 ? totals.weighted / totals.weight : null;
}

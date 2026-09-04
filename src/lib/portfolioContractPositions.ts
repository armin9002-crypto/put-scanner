import { canonicalizeMarketTime } from './marketTimestamp.ts';
import { isFiniteNumber } from './optionMetrics.ts';
import { makePortfolioContractKey } from './portfolioContractIdentity.ts';
import {
  buildHistoryGroupAggregates,
  historyFinalValue,
  historyOutcomeLabel,
  historyPriceAtExpiration,
} from './portfolioHistoryAnalytics.ts';
import {
  calculateCurrentAnnualizedYield,
  calculateCurrentNominalYield,
  calculateCurrentOptionMark,
  calculateCurrentPositionValue,
  calculateEquityAtRisk,
  calculateNetCapitalAtRisk,
  calculateOriginalAnnualizedYield,
  calculateOriginalDte,
  calculatePercentCaptured,
  calculatePremiumCollected,
  calculateTotalGainLoss,
  type MarkBasis,
} from './portfolioMetrics.ts';
import type { PortfolioTrade, PortfolioTradeInput } from './portfolioStorage.ts';

export interface PortfolioContractPositionMetrics {
  markBasis: MarkBasis | null;
  premiumCollected: number | null;
  grossRisk: number | null;
  netCapitalRisk: number | null;
  currentMark: number | null;
  currentValue: number | null;
  totalGainLoss: number | null;
  percentCaptured: number | null;
  weightedSoldPrice: number | null;
  breakeven: number | null;
  originalDte: number | null;
  originalNominalYield: number | null;
  originalAnnualizedYield: number | null;
  currentNominalYield: number | null;
  currentAnnualizedYield: number | null;
  entryDelta: number | null;
  entryIv: number | null;
  entryVix: number | null;
  realizedPnl: number | null;
  historicalPercentCaptured: number | null;
  daysHeld: number | null;
  realizedIrr: number | null;
  priceAtExpiration: number | null;
  finalOptionValue: number | null;
}

/**
 * Pure read model for one exact option contract. It extends PortfolioTrade only
 * so existing calculation and presentation helpers can consume the projection;
 * it is rebuilt from lots and must never be written to portfolio storage.
 */
export interface PortfolioContractPosition extends PortfolioTrade {
  contractKey: string;
  lots: PortfolioTrade[];
  lotCount: number;
  totalContracts: number;
  entryDateStart: string;
  entryDateEnd: string;
  resolvedDateStart?: string;
  resolvedDateEnd?: string;
  outcomeLabel: string;
  positionMetrics: PortfolioContractPositionMetrics;
}

function sumComplete(values: Array<number | null>): number | null {
  return values.every(isFiniteNumber) ? values.reduce<number>((sum, value) => sum + value!, 0) : null;
}

function weightedAverage(items: Array<{ value: number | null | undefined; weight: number | null | undefined }>): number | null {
  let weighted = 0;
  let totalWeight = 0;
  items.forEach(({ value, weight }) => {
    if (!isFiniteNumber(value) || !isFiniteNumber(weight) || weight <= 0) return;
    weighted += value * weight;
    totalWeight += weight;
  });
  return totalWeight > 0 ? weighted / totalWeight : null;
}

function dateRange(values: Array<string | null | undefined>): { start?: string; end?: string } {
  const dates = values.filter((value): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)).sort();
  return dates.length > 0 ? { start: dates[0], end: dates[dates.length - 1] } : {};
}

function commonValue<T>(values: Array<T | null | undefined>): T | undefined {
  if (values.length === 0 || values[0] == null) return undefined;
  return values.every(value => value === values[0]) ? values[0] : undefined;
}

function hasCurrentContractFacts(trade: PortfolioTrade): boolean {
  const market = trade.latestMarketData;
  return !!market && [
    market.underlyingPrice,
    market.optionBid,
    market.optionAsk,
    market.optionMid,
    market.optionLast,
    market.iv,
    market.delta,
    market.volume,
    market.openInterest,
  ].some(isFiniteNumber);
}

function marketObservationTime(trade: PortfolioTrade): number {
  const market = trade.latestMarketData;
  const canonical = canonicalizeMarketTime({
    observedAt: market?.refreshedAt,
    providerQuoteAt: market?.providerQuoteAt,
    providerMarketAt: market?.providerMarketAt,
    lastTradeAt: market?.lastTradeDate,
    cachedAt: market?.cachedAt,
  });
  return canonical.providerQuoteAt ?? canonical.providerMarketAt ?? canonical.observedAt ?? canonical.cachedAt ?? 0;
}

/** Freshest valid current quote wins; durable lot facts are never merged into it. */
export function selectPortfolioContractObservation(lots: readonly PortfolioTrade[]): PortfolioTrade | null {
  return [...lots]
    .sort((left, right) => {
      const validity = Number(hasCurrentContractFacts(right)) - Number(hasCurrentContractFacts(left));
      if (validity !== 0) return validity;
      const freshness = marketObservationTime(right) - marketObservationTime(left);
      if (freshness !== 0) return freshness;
      const updated = Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      return updated || left.id.localeCompare(right.id);
    })[0] ?? null;
}

function buildPosition(lots: PortfolioTrade[], markBasis: MarkBasis | null): PortfolioContractPosition {
  const orderedLots = [...lots].sort((left, right) => left.soldDate.localeCompare(right.soldDate) || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id));
  const representative = selectPortfolioContractObservation(orderedLots) ?? orderedLots[0];
  const contractKey = makePortfolioContractKey(representative);
  const totalContracts = orderedLots.reduce((sum, lot) => sum + lot.contracts, 0);
  const weightedSoldPrice = weightedAverage(orderedLots.map(lot => ({ value: lot.soldPrice, weight: lot.contracts })));
  const premiumCollected = sumComplete(orderedLots.map(calculatePremiumCollected));
  const grossRisk = sumComplete(orderedLots.map(calculateEquityAtRisk));
  const netCapitalRisk = sumComplete(orderedLots.map(calculateNetCapitalAtRisk));
  const entryDate = dateRange(orderedLots.map(lot => lot.soldDate));
  const resolvedDate = dateRange(orderedLots.map(lot => lot.closeDate ?? lot.resolvedDate ?? (lot.status === 'expired' ? lot.expiration : undefined)));
  const history = buildHistoryGroupAggregates(orderedLots);
  const outcomes = [...new Set(orderedLots.map(historyOutcomeLabel))];
  const outcomeLabel = orderedLots.every(lot => lot.status === 'open') ? 'Open' : outcomes.length === 1 ? outcomes[0] : 'Mixed';
  const projection: PortfolioContractPosition = {
    ...representative,
    id: `contract:${contractKey}`,
    ticker: representative.ticker.trim().toUpperCase(),
    optionType: 'put',
    strike: representative.strike,
    expiration: representative.expiration,
    contracts: totalContracts,
    soldPrice: weightedSoldPrice ?? representative.soldPrice,
    soldDate: entryDate.start ?? representative.soldDate,
    status: orderedLots.every(lot => lot.status === 'open') ? 'open' : representative.status,
    notes: orderedLots.length === 1 ? representative.notes : `${orderedLots.length} independently tracked entries`,
    closeDate: commonValue(orderedLots.map(lot => lot.closeDate)),
    resolvedDate: commonValue(orderedLots.map(lot => lot.resolvedDate)),
    resolutionType: commonValue(orderedLots.map(lot => lot.resolutionType)),
    expirationClosePrice: commonValue(orderedLots.map(lot => lot.expirationClosePrice)),
    expirationCloseDate: commonValue(orderedLots.map(lot => lot.expirationCloseDate)),
    finalOptionValue: sumComplete(orderedLots.map(historyFinalValue)) ?? undefined,
    realizedPnl: history.realizedPnl ?? undefined,
    percentCaptured: history.weightedAveragePercentCaptured ?? undefined,
    premiumCollected: history.premium,
    daysHeld: history.weightedAverageDaysHeld ?? undefined,
    entryVixClose: history.weightedAverageEntryVix ?? undefined,
    entryVixDate: commonValue(orderedLots.map(lot => lot.entryVixDate)),
    entryVixSource: commonValue(orderedLots.map(lot => lot.entryVixSource)),
    entryDelta: history.weightedAverageEntryDelta ?? undefined,
    entryDeltaSource: commonValue(orderedLots.map(lot => lot.entryDeltaSource)),
    entryDeltaCapturedAt: commonValue(orderedLots.map(lot => lot.entryDeltaCapturedAt)),
    entryIv: history.weightedAverageEntryIv ?? undefined,
    entryIvSource: commonValue(orderedLots.map(lot => lot.entryIvSource)),
    entryIvCapturedAt: commonValue(orderedLots.map(lot => lot.entryIvCapturedAt)),
    createdAt: orderedLots.map(lot => lot.createdAt).sort()[0],
    updatedAt: orderedLots.map(lot => lot.updatedAt).sort().slice(-1)[0] ?? representative.updatedAt,
    entrySnapshot: representative.entrySnapshot ? { ...representative.entrySnapshot } : undefined,
    latestMarketData: representative.latestMarketData ? { ...representative.latestMarketData } : undefined,
    importedSnapshot: orderedLots.length === 1 && representative.importedSnapshot ? { ...representative.importedSnapshot } : undefined,
    contractKey,
    lots: orderedLots,
    lotCount: orderedLots.length,
    totalContracts,
    entryDateStart: entryDate.start ?? representative.soldDate,
    entryDateEnd: entryDate.end ?? representative.soldDate,
    resolvedDateStart: resolvedDate.start,
    resolvedDateEnd: resolvedDate.end,
    outcomeLabel,
    positionMetrics: {} as PortfolioContractPositionMetrics,
  };

  const currentMark = markBasis ? calculateCurrentOptionMark(projection, markBasis) : null;
  projection.positionMetrics = {
    markBasis,
    premiumCollected,
    grossRisk,
    netCapitalRisk,
    currentMark,
    currentValue: markBasis ? calculateCurrentPositionValue(projection, markBasis) : null,
    totalGainLoss: markBasis ? calculateTotalGainLoss(projection, markBasis) : null,
    percentCaptured: markBasis ? calculatePercentCaptured(projection, markBasis) : null,
    weightedSoldPrice,
    breakeven: weightedSoldPrice == null ? null : representative.strike - weightedSoldPrice,
    originalDte: weightedAverage(orderedLots.map(lot => ({ value: calculateOriginalDte(lot), weight: calculateEquityAtRisk(lot) }))),
    originalNominalYield: grossRisk != null && grossRisk > 0 && premiumCollected != null ? premiumCollected / grossRisk : null,
    originalAnnualizedYield: weightedAverage(orderedLots.map(lot => ({ value: calculateOriginalAnnualizedYield(lot), weight: calculateEquityAtRisk(lot) }))),
    currentNominalYield: markBasis ? calculateCurrentNominalYield(projection, markBasis) : null,
    currentAnnualizedYield: markBasis ? calculateCurrentAnnualizedYield(projection, markBasis) : null,
    entryDelta: history.weightedAverageEntryDelta,
    entryIv: history.weightedAverageEntryIv,
    entryVix: history.weightedAverageEntryVix,
    realizedPnl: history.realizedPnl,
    historicalPercentCaptured: history.weightedAveragePercentCaptured,
    daysHeld: history.weightedAverageDaysHeld,
    realizedIrr: history.weightedAverageRealizedIrr,
    priceAtExpiration: commonValue(orderedLots.map(historyPriceAtExpiration)) ?? null,
    finalOptionValue: sumComplete(orderedLots.map(historyFinalValue)),
  };
  return projection;
}

function buildPositions(trades: readonly PortfolioTrade[], markBasis: MarkBasis | null): PortfolioContractPosition[] {
  const grouped = new Map<string, PortfolioTrade[]>();
  trades.forEach(trade => {
    const key = makePortfolioContractKey(trade);
    grouped.set(key, [...(grouped.get(key) ?? []), trade]);
  });
  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, lots]) => buildPosition(lots, markBasis));
}

export function buildOpenContractPositions(trades: readonly PortfolioTrade[], markBasis: MarkBasis): PortfolioContractPosition[] {
  return buildPositions(trades.filter(trade => trade.status === 'open'), markBasis);
}

/** Caller must filter canonical lots by outcome before invoking this builder. */
export function buildHistoricalContractPositions(filteredLots: readonly PortfolioTrade[]): PortfolioContractPosition[] {
  return buildPositions(filteredLots, null);
}

export function isPortfolioContractPosition(value: PortfolioTrade): value is PortfolioContractPosition {
  return Array.isArray((value as PortfolioContractPosition).lots)
    && typeof (value as PortfolioContractPosition).contractKey === 'string';
}

export function buildAddToPositionSeed(position: PortfolioContractPosition): PortfolioTradeInput {
  return {
    ticker: position.ticker,
    optionType: position.optionType,
    expiration: position.expiration,
    strike: position.strike,
    contracts: Number.NaN,
    soldPrice: Number.NaN,
    soldDate: '',
    status: position.status === 'open' ? 'open' : 'closed',
    notes: '',
  };
}

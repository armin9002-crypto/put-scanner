import { isFiniteNumber } from './optionMetrics.ts';
import { resolvePutDeltaWithSource } from './putDelta.ts';
import type { OptionsChainData } from './types.ts';
import type { PortfolioEntryDeltaSource, PortfolioTrade } from './portfolioStorage.ts';

export interface PortfolioEntryDeltaCapture {
  entryDelta: number;
  entryDeltaSource: PortfolioEntryDeltaSource;
  entryDeltaCapturedAt: string;
}

export interface PortfolioEntryDeltaCaptureResult {
  status: 'captured' | 'ineligible' | 'unavailable';
  capture?: PortfolioEntryDeltaCapture;
  reason: string;
}

export function isValidEntryDelta(value: unknown): value is number {
  return isFiniteNumber(value) && value >= -1 && value <= 0;
}

export function usMarketDateIso(value: Date | number = new Date()): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const field = (type: Intl.DateTimeFormatPartTypes) => parts.find(part => part.type === type)?.value ?? '';
  return `${field('year')}-${field('month')}-${field('day')}`;
}

export function isContemporaneousPortfolioEntry(trade: Pick<PortfolioTrade, 'soldDate' | 'status'>, now = new Date()): boolean {
  return trade.status === 'open' && trade.soldDate === usMarketDateIso(now);
}

function calculateDteAt(expiration: string, marketDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiration) || !/^\d{4}-\d{2}-\d{2}$/.test(marketDate)) return null;
  const expirationTimestamp = Date.parse(`${expiration}T00:00:00Z`);
  const marketTimestamp = Date.parse(`${marketDate}T00:00:00Z`);
  return Number.isFinite(expirationTimestamp) && Number.isFinite(marketTimestamp)
    ? Math.round((expirationTimestamp - marketTimestamp) / 86_400_000)
    : null;
}

function expirationDateIso(value: number): string | null {
  const timestamp = value < 10_000_000_000 ? value * 1000 : value;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

export function entryDeltaFromExactChain(
  trade: Pick<PortfolioTrade, 'ticker' | 'strike' | 'expiration' | 'soldDate' | 'status'>,
  chain: OptionsChainData,
  now = new Date(),
): PortfolioEntryDeltaCaptureResult {
  if (!isContemporaneousPortfolioEntry(trade, now)) {
    return { status: 'ineligible', reason: 'Only a trade entered on the current U.S. market date is eligible.' };
  }
  if (chain.chainMeta?.ticker && chain.chainMeta.ticker.toUpperCase() !== trade.ticker.toUpperCase()) {
    return { status: 'unavailable', reason: 'The option chain belongs to a different ticker.' };
  }
  const chainExpiration = chain.chainMeta?.returnedExpiration ?? chain.chainMeta?.expirationDate ?? chain.chainMeta?.requestedExpiration;
  if (isFiniteNumber(chainExpiration) && expirationDateIso(chainExpiration) !== trade.expiration) {
    return { status: 'unavailable', reason: 'The option chain belongs to a different expiration.' };
  }
  if (chain.chainMeta?.staleFallbackUsed || chain.chainMeta?.freshness === 'stale') {
    return { status: 'unavailable', reason: 'The available option chain is stale.' };
  }
  if (isFiniteNumber(chain.chainMeta?.fetchedAt) && usMarketDateIso(chain.chainMeta.fetchedAt) !== trade.soldDate) {
    return { status: 'unavailable', reason: 'The option chain was not observed on the trade entry date.' };
  }

  const put = chain.puts.find(candidate => Math.abs(candidate.strike - trade.strike) < 0.0001);
  if (!put) return { status: 'unavailable', reason: 'The exact put contract was not available.' };
  const delta = resolvePutDeltaWithSource({
    providerDelta: put.delta,
    underlyingPrice: chain.currentPrice,
    strike: trade.strike,
    dte: calculateDteAt(trade.expiration, trade.soldDate),
    impliedVolatilityPercent: put.impliedVolatility,
  });
  if (!delta || !isValidEntryDelta(delta.delta)) {
    return { status: 'unavailable', reason: 'The exact contract did not have a valid provider or calculated Delta.' };
  }
  return {
    status: 'captured',
    reason: 'Captured from contemporaneous exact-contract data.',
    capture: {
      entryDelta: delta.delta,
      entryDeltaSource: delta.source,
      entryDeltaCapturedAt: now.toISOString(),
    },
  };
}

export function recoverEntryDeltaFromStoredSnapshot(
  trade: PortfolioTrade,
): PortfolioEntryDeltaCapture | null {
  if (isValidEntryDelta(trade.entryDelta) || !isValidEntryDelta(trade.entrySnapshot?.delta)) return null;
  return {
    entryDelta: trade.entrySnapshot.delta,
    entryDeltaSource: 'stored_snapshot',
    entryDeltaCapturedAt: trade.createdAt,
  };
}

export function backfillStoredEntryDeltas(
  trades: PortfolioTrade[],
  nowIso = new Date().toISOString(),
): { trades: PortfolioTrade[]; changed: boolean; resolved: number } {
  let resolved = 0;
  const next = trades.map(trade => {
    const capture = recoverEntryDeltaFromStoredSnapshot(trade);
    if (!capture) return trade;
    resolved += 1;
    return { ...trade, ...capture, updatedAt: nowIso };
  });
  return { trades: next, changed: resolved > 0, resolved };
}

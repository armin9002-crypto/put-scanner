import { isFiniteNumber } from './optionMetrics.ts';
import { resolvePutDeltaWithSource } from './putDelta.ts';
import type { OptionsChainData } from './types.ts';
import type {
  PortfolioEntryDeltaSource,
  PortfolioEntryIvSource,
  PortfolioTrade,
  PortfolioTradeSnapshot,
} from './portfolioStorage.ts';

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

export interface PortfolioEntrySnapshotCapture {
  entrySnapshot: PortfolioTradeSnapshot;
  entryDelta?: number;
  entryDeltaSource?: PortfolioEntryDeltaSource;
  entryDeltaCapturedAt?: string;
  entryIv?: number;
  entryIvSource?: PortfolioEntryIvSource;
  entryIvCapturedAt?: string;
}

export interface PortfolioEntrySnapshotCaptureResult {
  status: 'captured' | 'ineligible' | 'unavailable';
  capture?: PortfolioEntrySnapshotCapture;
  reason: string;
}

export interface PortfolioEntrySnapshotEnrichmentResult {
  trade: PortfolioTrade;
  status: PortfolioEntrySnapshotCaptureResult['status'];
  reason: string;
  lookupCount: number;
}

export type PortfolioEntryDeltaEditPatch = Pick<
  PortfolioTrade,
  'entryDelta' | 'entryDeltaSource' | 'entryDeltaCapturedAt'
>;

export type PortfolioEntryIvEditPatch = Pick<
  PortfolioTrade,
  'entryIv' | 'entryIvSource' | 'entryIvCapturedAt'
>;

export function isValidEntryDelta(value: unknown): value is number {
  return isFiniteNumber(value) && value >= -1 && value <= 0;
}

/** Canonical option IV is stored in percentage points: 65.4 means 65.4%. */
export function isValidEntryIv(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

/** Historical broker exports often represent put Delta as an unsigned magnitude. */
export function normalizeManualHistoricalEntryDelta(value: number | null): number | null {
  if (value == null) return null;
  if (!isFiniteNumber(value) || Math.abs(value) > 1) throw new RangeError('Historical Entry Delta magnitude must be between 0 and 1.');
  return value === 0 ? 0 : -Math.abs(value);
}

/**
 * Resolves an explicit Edit Trade value without consulting current market data.
 * An unchanged value preserves its historical provenance, a changed value becomes
 * a manual override, and an explicit blank clears all Entry Delta metadata.
 */
export function buildEntryDeltaEditPatch(
  trade: Pick<PortfolioTrade, 'entryDelta' | 'entryDeltaSource' | 'entryDeltaCapturedAt'>,
  value: number | null,
  capturedAt = new Date().toISOString(),
): PortfolioEntryDeltaEditPatch {
  if (value == null) {
    return { entryDelta: undefined, entryDeltaSource: undefined, entryDeltaCapturedAt: undefined };
  }
  if (!isValidEntryDelta(value)) throw new RangeError('Entry Delta must be between -1 and 0.');
  if (trade.entryDelta === value) {
    return {
      entryDelta: trade.entryDelta,
      entryDeltaSource: trade.entryDeltaSource,
      entryDeltaCapturedAt: trade.entryDeltaCapturedAt,
    };
  }
  return { entryDelta: value, entryDeltaSource: 'manual', entryDeltaCapturedAt: capturedAt };
}

/** Explicit Edit/Historical values use the same percentage-point scale as option-chain IV. */
export function buildEntryIvEditPatch(
  trade: Pick<PortfolioTrade, 'entryIv' | 'entryIvSource' | 'entryIvCapturedAt'>,
  value: number | null,
  capturedAt = new Date().toISOString(),
): PortfolioEntryIvEditPatch {
  if (value == null) {
    return { entryIv: undefined, entryIvSource: undefined, entryIvCapturedAt: undefined };
  }
  if (!isValidEntryIv(value)) throw new RangeError('Entry IV must be greater than 0%.');
  if (trade.entryIv === value) {
    return {
      entryIv: trade.entryIv,
      entryIvSource: trade.entryIvSource,
      entryIvCapturedAt: trade.entryIvCapturedAt,
    };
  }
  return { entryIv: value, entryIvSource: 'manual', entryIvCapturedAt: capturedAt };
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

export function entrySnapshotFromExactChain(
  trade: Pick<PortfolioTrade, 'ticker' | 'strike' | 'expiration' | 'soldDate' | 'status'>,
  chain: OptionsChainData,
  now = new Date(),
): PortfolioEntrySnapshotCaptureResult {
  if (!isContemporaneousPortfolioEntry(trade, now)) {
    return { status: 'ineligible', reason: 'Only a trade entered on the current U.S. market date is eligible.' };
  }
  if (!trade.ticker.trim() || !isFiniteNumber(trade.strike) || trade.strike <= 0 || isoDateToUnixSeconds(trade.expiration) == null) {
    return { status: 'ineligible', reason: 'Ticker, strike, and expiration must identify a valid exact contract.' };
  }
  if (trade.expiration < trade.soldDate) {
    return { status: 'ineligible', reason: 'An expired contract cannot receive a current entry snapshot.' };
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
  const entryDelta = delta && isValidEntryDelta(delta.delta) ? delta.delta : null;
  const entryIv = isValidEntryIv(put.impliedVolatility) ? put.impliedVolatility : null;
  if (entryDelta == null && entryIv == null) return { status: 'unavailable', reason: 'The exact contract did not have a valid Delta or IV.' };
  const capturedAt = now.toISOString();
  return {
    status: 'captured',
    reason: 'Captured from contemporaneous exact-contract data.',
    capture: {
      entrySnapshot: {
        underlyingPrice: chain.currentPrice,
        bid: put.bid,
        ask: put.ask,
        last: put.last,
        iv: entryIv,
        delta: entryDelta,
      },
      ...(entryDelta != null ? {
        entryDelta,
        entryDeltaSource: delta!.source,
        entryDeltaCapturedAt: capturedAt,
      } : {}),
      ...(entryIv != null ? {
        entryIv,
        entryIvSource: 'provider' as const,
        entryIvCapturedAt: capturedAt,
      } : {}),
    },
  };
}

/** Backward-compatible Delta-only view over the shared exact-contract observation. */
export function entryDeltaFromExactChain(
  trade: Pick<PortfolioTrade, 'ticker' | 'strike' | 'expiration' | 'soldDate' | 'status'>,
  chain: OptionsChainData,
  now = new Date(),
): PortfolioEntryDeltaCaptureResult {
  const result = entrySnapshotFromExactChain(trade, chain, now);
  if (result.status !== 'captured' || !result.capture || !isValidEntryDelta(result.capture.entryDelta)) {
    return {
      status: result.status === 'ineligible' ? 'ineligible' : 'unavailable',
      reason: result.status === 'captured' ? 'The exact contract did not have a valid provider or calculated Delta.' : result.reason,
    };
  }
  return {
    status: 'captured',
    reason: result.reason,
    capture: {
      entryDelta: result.capture.entryDelta,
      entryDeltaSource: result.capture.entryDeltaSource!,
      entryDeltaCapturedAt: result.capture.entryDeltaCapturedAt!,
    },
  };
}

export function applyEntrySnapshotCapture(
  trade: PortfolioTrade,
  capture: PortfolioEntrySnapshotCapture,
): PortfolioTrade {
  return {
    ...trade,
    entrySnapshot: capture.entrySnapshot,
    ...(!isValidEntryDelta(trade.entryDelta) && isValidEntryDelta(capture.entryDelta) ? {
      entryDelta: capture.entryDelta,
      entryDeltaSource: capture.entryDeltaSource,
      entryDeltaCapturedAt: capture.entryDeltaCapturedAt,
    } : {}),
    ...(!isValidEntryIv(trade.entryIv) && isValidEntryIv(capture.entryIv) ? {
      entryIv: capture.entryIv,
      entryIvSource: capture.entryIvSource,
      entryIvCapturedAt: capture.entryIvCapturedAt,
    } : {}),
  };
}

/**
 * One bounded exact-chain lookup enriches a current trade before its initial
 * durable save. Lookup failure is non-destructive and returns the trade unchanged.
 */
export async function enrichCurrentTradeEntrySnapshot(
  trade: PortfolioTrade,
  lookup: (ticker: string, expirationUnixSeconds: number) => Promise<OptionsChainData>,
  now = new Date(),
): Promise<PortfolioEntrySnapshotEnrichmentResult> {
  if (!isContemporaneousPortfolioEntry(trade, now)) {
    return { trade, status: 'ineligible', reason: 'Only a current trade entered on the current U.S. market date is eligible.', lookupCount: 0 };
  }
  const expirationUnixSeconds = isoDateToUnixSeconds(trade.expiration);
  if (expirationUnixSeconds == null) {
    return { trade, status: 'ineligible', reason: 'The expiration date is invalid.', lookupCount: 0 };
  }
  try {
    const chain = await lookup(trade.ticker, expirationUnixSeconds);
    const result = entrySnapshotFromExactChain(trade, chain, now);
    return {
      trade: result.capture ? applyEntrySnapshotCapture(trade, result.capture) : trade,
      status: result.status,
      reason: result.reason,
      lookupCount: 1,
    };
  } catch (error) {
    return {
      trade,
      status: 'unavailable',
      reason: error instanceof Error ? error.message : 'The entry snapshot was unavailable.',
      lookupCount: 1,
    };
  }
}

function isoDateToUnixSeconds(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) return null;
  return Math.floor(timestamp / 1000);
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

export function recoverEntryIvFromStoredSnapshot(
  trade: PortfolioTrade,
): Pick<PortfolioTrade, 'entryIv' | 'entryIvSource' | 'entryIvCapturedAt'> | null {
  if (isValidEntryIv(trade.entryIv) || !isValidEntryIv(trade.entrySnapshot?.iv)) return null;
  return {
    entryIv: trade.entrySnapshot.iv,
    entryIvSource: 'stored_snapshot',
    entryIvCapturedAt: trade.createdAt,
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

export function backfillStoredEntrySnapshots(
  trades: PortfolioTrade[],
  nowIso = new Date().toISOString(),
): { trades: PortfolioTrade[]; changed: boolean; resolvedDeltas: number; resolvedIvs: number } {
  let resolvedDeltas = 0;
  let resolvedIvs = 0;
  const next = trades.map(trade => {
    const delta = recoverEntryDeltaFromStoredSnapshot(trade);
    const iv = recoverEntryIvFromStoredSnapshot(trade);
    if (!delta && !iv) return trade;
    if (delta) resolvedDeltas += 1;
    if (iv) resolvedIvs += 1;
    return { ...trade, ...delta, ...iv, updatedAt: nowIso };
  });
  return { trades: next, changed: resolvedDeltas + resolvedIvs > 0, resolvedDeltas, resolvedIvs };
}

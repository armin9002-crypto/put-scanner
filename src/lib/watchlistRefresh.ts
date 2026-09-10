import { calculateDte, calculateMoneyness, calculateYieldPercent, isFiniteNumber, sanitizePositive } from './optionMetrics.ts';
import { evidenceFreshnessFromChainMeta } from './evidence.ts';
import { getOptionChainExpirationEvidence } from './optionExpiryNavigation.ts';
import { isOptionContractIntegrityInvalid, parseYahooOptionSymbol } from './optionMarketIntegrity.ts';
import { resolvePutDeltaWithSource } from './putDelta.ts';
import {
  isPastWatchlistExpirationDte,
  retainWatchlistSnapshotAfterInvalidRefresh,
  retainWatchlistSnapshotAfterUnverifiedRefresh,
  type WatchlistItem,
} from './watchlist.ts';
import type { OptionsChainData } from './types.ts';
import { executableOptionPrice } from './optionQuoteDisplay.ts';

export function isWatchlistRefreshCurrent(
  refreshGeneration: number,
  currentGeneration: number,
  signal?: Pick<AbortSignal, 'aborted'>,
): boolean {
  return refreshGeneration === currentGeneration && signal?.aborted !== true;
}

/**
 * Merges one already-acquired chain into a saved contract. Exact Watchlist
 * publication requires returned expiration evidence; the requested key alone
 * is not evidence that the provider honored the request.
 */
export function mergeWatchlistRefreshItem(
  item: WatchlistItem,
  optData: OptionsChainData | null,
  currentPrice: number | null,
  failed: boolean,
): WatchlistItem {
  const rawDte = calculateDte(item.expiry);
  const dte = isFiniteNumber(rawDte) ? Math.max(0, rawDte) : null;
  if (isPastWatchlistExpirationDte(rawDte)) {
    return { ...item, status: 'expired', updatedAt: Date.now() };
  }

  if (failed || !optData) {
    return {
      ...item,
      status: 'refresh_failed',
      updatedAt: item.updatedAt,
      snapshot: {
        ...item.snapshot,
        evidenceFreshness: 'retained-stale',
        evidenceSource: 'snapshot',
        observedAt: item.snapshot?.observedAt ?? item.updatedAt ?? null,
        retentionReason: 'Refresh failed; the prior trusted quote was retained.',
      },
    };
  }

  const put = optData.puts.find(candidate => Math.abs(candidate.strike - item.strike) < 0.01);
  const underlyingPrice = sanitizePositive(currentPrice) ?? sanitizePositive(optData.currentPrice);

  if (!put) {
    return {
      ...item,
      status: 'unavailable',
      updatedAt: item.updatedAt,
      snapshot: {
        ...item.snapshot,
        underlyingPrice,
        dte,
        evidenceFreshness: 'retained-stale',
        evidenceSource: 'snapshot',
        observedAt: item.snapshot?.observedAt ?? item.updatedAt ?? null,
        retentionReason: 'The exact contract was absent from the new chain; the prior quote was retained.',
      },
    };
  }

  const expirationEvidence = getOptionChainExpirationEvidence(
    optData.chainMeta,
    item.expiryTimestamp,
    [parseYahooOptionSymbol(put.contractSymbol).expiration],
  );
  if (expirationEvidence !== 'match') {
    return retainWatchlistSnapshotAfterUnverifiedRefresh(item, {
      underlyingPrice,
      dte,
      reason: expirationEvidence === 'mismatch' ? 'expiration_mismatch' : 'expiration_unverified',
    });
  }

  if (isOptionContractIntegrityInvalid(put)) {
    return retainWatchlistSnapshotAfterInvalidRefresh(item, { underlyingPrice, dte, reasonCodes: put.integrity?.reasonCodes ?? [] });
  }

  const iv = put.impliedVolatility ?? null;
  const resolvedDelta = resolvePutDeltaWithSource({
    providerDelta: put.delta,
    underlyingPrice,
    strike: item.strike,
    dte,
    impliedVolatilityPercent: iv,
  });
  const bidYield = calculateYieldPercent(executableOptionPrice(put.bid), item.strike, dte);
  const askYield = calculateYieldPercent(executableOptionPrice(put.ask), item.strike, dte);
  const moneyness = calculateMoneyness(underlyingPrice, item.strike);
  const evidenceFreshness = evidenceFreshnessFromChainMeta(optData.chainMeta);
  const retained = evidenceFreshness === 'retained-stale';
  const observedAt = optData.chainMeta?.fetchedAt ?? item.snapshot?.observedAt ?? item.updatedAt ?? null;

  return {
    ...item,
    status: retained ? 'stale' : 'live',
    updatedAt: observedAt ?? item.updatedAt,
    snapshot: {
      underlyingPrice,
      bid: put.bid,
      ask: put.ask,
      last: put.last,
      lastTradeDate: put.lastTradeDate,
      delta: resolvedDelta?.delta ?? null,
      deltaSource: resolvedDelta?.source ?? null,
      deltaModelVersion: resolvedDelta?.modelVersion ?? null,
      iv,
      dte,
      volume: put.volume,
      openInterest: put.openInterest,
      nominalYieldBid: bidYield.nominal,
      annualizedYieldBid: bidYield.annualized,
      annualizedYieldAsk: askYield.annualized,
      moneynessPct: moneyness.pct,
      moneynessLabel: moneyness.label,
      integrityStatus: put.integrity?.status ?? 'clean',
      integrityReasonCodes: put.integrity?.reasonCodes ?? [],
      observedAt,
      providerMarketTime: optData.chainMeta?.providerMarketTime ?? null,
      evidenceFreshness,
      evidenceSource: optData.chainMeta?.source ?? 'unknown',
      retentionReason: retained ? 'Refresh returned stale fallback; the prior trusted quote remains visible.' : null,
    },
  };
}

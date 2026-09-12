import { normalizeTimestampMs } from './marketDataNormalize.ts';
import { elapsedMarketSessions } from './portfolioQuoteFreshness.ts';
import { RejectedOptionChainError } from './optionChainCache.ts';
import { getOptionChainExpirationEvidence } from './optionExpiryNavigation.ts';
import { parseYahooOptionSymbol } from './optionMarketIntegrity.ts';
import { makePortfolioContractKey, optionContractMatchesExactIdentity } from './portfolioContractIdentity.ts';
import type { PortfolioMarketData, PortfolioTrade } from './portfolioStorage.ts';
import type { OptionContract, OptionsChainData, OptionIntegrityReasonCode } from './types.ts';

export type PortfolioMarketDataUpdateMode = 'merge' | 'replace';

/**
 * Applies device-local current-market state without touching durable trade data.
 * In particular, PortfolioTrade.updatedAt records durable user/lifecycle changes
 * and must never be advanced by quote freshness.
 */
export function applyTransientPortfolioMarketData(
  trade: PortfolioTrade,
  marketData: PortfolioMarketData,
  mode: PortfolioMarketDataUpdateMode = 'merge',
): PortfolioTrade {
  return {
    ...trade,
    latestMarketData: mode === 'replace'
      ? { ...marketData }
      : { ...trade.latestMarketData, ...marketData },
  };
}

export function retainPortfolioMarketAfterUntrustedRefresh(
  trade: PortfolioTrade,
  update: {
    underlyingPrice?: number | null;
    dte?: number | null;
    attemptedAt: string;
    reasonCodes?: OptionIntegrityReasonCode[];
    exactLast?: { price: number; lastTradeDate: number | string | null; observedAt: string };
    kind: 'quote_inconsistent' | 'refresh_failed' | 'unavailable' | 'no_usable_price';
  },
): PortfolioTrade {
  const previous = trade.latestMarketData;
  const hasTrustedOptionMark = previous?.optionIntegrityStatus !== 'invalid'
    && [previous?.optionBid, previous?.optionAsk, previous?.optionLast].some(value => typeof value === 'number' && Number.isFinite(value) && value > 0);
  const retained: PortfolioMarketData = hasTrustedOptionMark
    ? {
        ...previous,
        underlyingPrice: update.underlyingPrice ?? previous?.underlyingPrice ?? null,
        dte: update.dte ?? previous?.dte ?? null,
        availabilityStatus: update.kind === 'refresh_failed' ? 'refresh_failed' : 'stale',
        optionIntegrityStatus: update.kind === 'quote_inconsistent' ? 'degraded' : previous?.optionIntegrityStatus,
        optionIntegrityReasonCodes: update.reasonCodes ?? previous?.optionIntegrityReasonCodes,
        latestRefreshAttemptAt: update.attemptedAt,
      }
    : {
        underlyingPrice: update.underlyingPrice ?? previous?.underlyingPrice ?? null,
        dte: update.dte ?? previous?.dte ?? null,
        optionBid: null,
        optionAsk: null,
        optionMid: null,
        optionLast: null,
        iv: null,
        delta: null,
        volume: null,
        openInterest: null,
        availabilityStatus: 'unavailable',
        optionIntegrityStatus: update.kind === 'quote_inconsistent' ? 'invalid' : previous?.optionIntegrityStatus,
        optionIntegrityReasonCodes: update.reasonCodes,
        latestRefreshAttemptAt: update.attemptedAt,
      };
  retained.refreshOutcome = update.kind;
  // Preserve a previously observed exact Last and its original timestamps.
  const observedLast = update.exactLast ?? (previous?.availabilityStatus !== 'imported_snapshot' && typeof previous?.optionLast === 'number' && Number.isFinite(previous.optionLast) && previous.optionLast > 0
    ? { price: previous.optionLast, lastTradeDate: previous.lastTradeDate ?? null, observedAt: previous.lastObservedAt ?? previous.refreshedAt } : null);
  if (trade.status === 'open' && observedLast && Number.isFinite(observedLast.price) && observedLast.price > 0) {
    // A new rejected quote's historical Last must not relabel prior trusted Bid/Ask.
    if (!hasTrustedOptionMark || previous?.lastFallbackOnly || update.exactLast) {
      retained.optionBid = null; retained.optionAsk = null; retained.optionMid = null;
      retained.iv = null; retained.delta = null; retained.volume = null; retained.openInterest = null;
      retained.lastFallbackOnly = true;
      retained.availabilityStatus = 'stale';
      retained.providerMarketAt = undefined; retained.providerQuoteAt = undefined;
    }
    retained.optionLast = observedLast.price;
    retained.lastTradeDate = observedLast.lastTradeDate;
    retained.lastObservedAt = observedLast.observedAt;
    if (retained.lastFallbackOnly) retained.refreshedAt = observedLast.observedAt;
  }
  return applyTransientPortfolioMarketData(trade, retained, 'replace');
}

function sameMarketDataTarget(current: PortfolioTrade, requested: PortfolioTrade): boolean {
  return current.status === 'open'
    && requested.status === 'open'
    && makePortfolioContractKey(current) === makePortfolioContractKey(requested);
}

function refreshedAt(value: PortfolioTrade): number {
  const timestamp = Date.parse(value.latestMarketData?.latestRefreshAttemptAt ?? value.latestMarketData?.refreshedAt ?? '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Reconciles an async quote sweep with the latest durable Portfolio state.
 * Removed trades stay removed, durable edits win, and only device-local market
 * data is copied from a still-matching refresh target.
 */
export function mergePortfolioMarketRefresh(
  currentTrades: PortfolioTrade[],
  refreshedSnapshot: PortfolioTrade[],
): PortfolioTrade[] {
  const refreshedById = new Map(refreshedSnapshot.map(trade => [trade.id, trade]));
  return currentTrades.map(current => {
    const refreshed = refreshedById.get(current.id);
    if (!refreshed || !sameMarketDataTarget(current, refreshed)) return current;
    if (refreshedAt(current) > refreshedAt(refreshed)) return current;
    return {
      ...current,
      ...(refreshed.latestMarketData ? { latestMarketData: { ...refreshed.latestMarketData } } : {}),
    };
  });
}

/**
 * Applies lifecycle resolution only when the durable trade is still the exact
 * version that was inspected. This prevents passive expiration work from
 * overwriting an edit or resurrecting a deletion completed while it awaited
 * historical market data.
 */
export function mergePortfolioLifecycleResults(
  currentTrades: PortfolioTrade[],
  inspectedSnapshot: PortfolioTrade[],
  resolvedSnapshot: PortfolioTrade[],
): PortfolioTrade[] {
  const inspectedById = new Map(inspectedSnapshot.map(trade => [trade.id, trade]));
  const resolvedById = new Map(resolvedSnapshot.map(trade => [trade.id, trade]));
  return currentTrades.map(current => {
    const inspected = inspectedById.get(current.id);
    const resolved = resolvedById.get(current.id);
    if (!inspected || !resolved || current.updatedAt !== inspected.updatedAt) return current;
    if (resolved === inspected) return current;
    return resolved;
  });
}

/** Require the returned chain identity, plus OCC identity when supplied. */
export function findExactPortfolioPut(trade: PortfolioTrade, chain: OptionsChainData | null): OptionContract | null {
  if (!chain || trade.status !== 'open' || trade.optionType !== 'put') return null;
  const expiration = Date.parse(`${trade.expiration}T00:00:00Z`) / 1000;
  const meta = chain.chainMeta;
  if (!Number.isSafeInteger(expiration) || !meta
    || meta.ticker.trim().toUpperCase() !== trade.ticker.trim().toUpperCase()) return null;
  const identity = { ticker: trade.ticker, optionType: trade.optionType, expiration: trade.expiration, strike: trade.strike };
  const put = chain.puts.find(candidate => optionContractMatchesExactIdentity(candidate, identity));
  if (!put) return null;
  if (getOptionChainExpirationEvidence(
    meta,
    expiration,
    [parseYahooOptionSymbol(put.contractSymbol).expiration],
  ) !== 'match') return null;
  return put;
}

export function portfolioExactLast(put: OptionContract | null, observedAt: string) {
  const price = put?.rawLastPrice ?? put?.last;
  return typeof price === 'number' && Number.isFinite(price) && price > 0
    ? { price, lastTradeDate: put?.rawLastTradeDate ?? put?.lastTradeDate ?? null, observedAt } : undefined;
}

/** Only Portfolio open-position refresh may consume this non-executable evidence. */
export async function acquirePortfolioValuationChain(acquire: () => Promise<OptionsChainData>): Promise<OptionsChainData> {
  try { return await acquire(); }
  catch (error) {
    if (error instanceof RejectedOptionChainError) return error.chain;
    throw error;
  }
}

/** Preserve recent trusted Last behavior even when no executable Bid/Ask exists. */
export function requiresPortfolioLastFallback(put: OptionContract, now = new Date()): boolean {
  if (put.integrity?.status === 'invalid') return true;
  if ([put.bid, put.ask].some(value => typeof value === 'number' && Number.isFinite(value) && value > 0)) return false;
  const last = portfolioExactLast(put, now.toISOString());
  const tradedAt = normalizeTimestampMs(last?.lastTradeDate);
  return !last || tradedAt == null || elapsedMarketSessions(tradedAt, now) > 1;
}

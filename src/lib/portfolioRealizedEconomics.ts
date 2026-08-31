import { isFiniteNumber } from './optionMetrics.ts';
import { calculatePremiumCollected } from './portfolioMetrics.ts';
import { usMarketDateIso } from './portfolioEntryDelta.ts';
import type { PortfolioTrade } from './portfolioStorage.ts';

function calendarDaysBetween(start: string, end: string | undefined): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !end || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return undefined;
  const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
  return Number.isFinite(days) && days >= 0 ? days : undefined;
}

/**
 * Manual outcome attestation is intentionally narrower than provider resolution:
 * only an already-pending, past-expiration record can be confirmed worthless.
 */
export function isManualWorthlessConfirmationEligible(trade: PortfolioTrade, now = new Date()): boolean {
  if (!Number.isFinite(now.getTime())) return false;
  const marketDate = usMarketDateIso(now);
  return trade.status === 'expired_price_pending'
    && (trade.resolutionType == null || trade.resolutionType === 'expired_price_pending')
    && /^\d{4}-\d{2}-\d{2}$/.test(trade.expiration)
    && trade.expiration < marketDate;
}

export function canonicalHistoricalPremium(trade: PortfolioTrade): number | null {
  return calculatePremiumCollected(trade);
}

export function canonicalHistoricalFinalOptionValue(trade: PortfolioTrade): number | null {
  if (isFiniteNumber(trade.expirationClosePrice)) {
    return Math.max(trade.strike - trade.expirationClosePrice, 0) * trade.contracts * 100;
  }
  if (trade.resolutionType === 'expired_worthless') return 0;
  return isFiniteNumber(trade.finalOptionValue) ? trade.finalOptionValue : null;
}

export function canonicalHistoricalRealizedPnl(trade: PortfolioTrade): number | null {
  const premium = canonicalHistoricalPremium(trade);
  if (trade.status === 'closed') {
    return premium != null && isFiniteNumber(trade.closePrice)
      ? premium - trade.closePrice * trade.contracts * 100
      : null;
  }
  if (trade.status === 'expired') {
    const finalValue = canonicalHistoricalFinalOptionValue(trade);
    if (premium != null && finalValue != null) return premium - finalValue;
  }
  if (trade.status === 'assigned') {
    return isFiniteNumber(trade.realizedPnl) ? trade.realizedPnl : null;
  }
  return null;
}

export function canonicalHistoricalDaysHeld(trade: PortfolioTrade): number | null {
  const exitDate = trade.status === 'closed'
    ? trade.closeDate
    : trade.status === 'expired' || trade.status === 'expired_price_pending'
      ? trade.expiration
      : trade.resolvedDate ?? trade.closeDate;
  return calendarDaysBetween(trade.soldDate, exitDate) ?? null;
}

/**
 * Records a user's explicit knowledge of a zero-intrinsic-value expiration.
 * The underlying expiration close remains unknown and is never synthesized.
 */
export function confirmPortfolioTradeExpiredWorthless(
  trade: PortfolioTrade,
  now = new Date(),
): PortfolioTrade | null {
  if (!isManualWorthlessConfirmationEligible(trade, now)) return null;
  const nowIso = now.toISOString();
  return reconcilePortfolioTradeEconomics(trade, {
    ...trade,
    status: 'expired',
    resolvedDate: trade.expiration,
    resolutionType: 'expired_worthless',
    expirationClosePrice: undefined,
    expirationCloseDate: undefined,
    expirationBasisStatus: undefined,
    expirationBasisCheckedFrom: undefined,
    finalOptionValue: undefined,
    resolutionSource: 'manual_worthless_confirmation',
    resolutionWarning: undefined,
    closePrice: undefined,
    closeDate: undefined,
    updatedAt: nowIso,
  });
}

function clearExpirationResolution(trade: PortfolioTrade): PortfolioTrade {
  return {
    ...trade,
    resolvedDate: undefined,
    resolutionType: undefined,
    expirationClosePrice: undefined,
    expirationCloseDate: undefined,
    expirationBasisStatus: undefined,
    expirationBasisCheckedFrom: undefined,
    finalOptionValue: undefined,
    resolutionSource: undefined,
    resolutionWarning: undefined,
  };
}

/**
 * Reconciles redundant lifecycle snapshots to canonical trade fields before a durable write.
 * Sold Price, contracts, close economics, and expiration resolution remain the sources of truth.
 */
export function reconcilePortfolioTradeEconomics(previous: PortfolioTrade | null, candidate: PortfolioTrade): PortfolioTrade {
  const premiumCollected = canonicalHistoricalPremium(candidate) ?? undefined;
  if (candidate.status === 'open') {
    return {
      ...clearExpirationResolution(candidate),
      closePrice: undefined,
      closeDate: undefined,
      realizedPnl: undefined,
      percentCaptured: undefined,
      premiumCollected: undefined,
      daysHeld: undefined,
    };
  }

  if (candidate.status === 'closed') {
    const closed = clearExpirationResolution(candidate);
    const realizedPnl = canonicalHistoricalRealizedPnl(closed);
    const daysHeld = canonicalHistoricalDaysHeld(closed);
    return {
      ...closed,
      premiumCollected,
      realizedPnl: realizedPnl ?? undefined,
      percentCaptured: premiumCollected != null && premiumCollected > 0 && realizedPnl != null
        ? realizedPnl / premiumCollected
        : undefined,
      daysHeld: daysHeld ?? undefined,
    };
  }

  if (candidate.status === 'expired_price_pending') {
    const pending = clearExpirationResolution(candidate);
    return {
      ...pending,
      status: 'expired_price_pending',
      resolvedDate: candidate.resolvedDate,
      resolutionType: 'expired_price_pending',
      resolutionWarning: candidate.resolutionWarning,
      closePrice: undefined,
      closeDate: undefined,
      premiumCollected,
      realizedPnl: undefined,
      percentCaptured: undefined,
      daysHeld: canonicalHistoricalDaysHeld(candidate) ?? undefined,
    };
  }

  if (candidate.status === 'expired') {
    const finalOptionValue = canonicalHistoricalFinalOptionValue(candidate);
    const realizedPnl = premiumCollected != null && finalOptionValue != null
      ? premiumCollected - finalOptionValue
      : null;
    return {
      ...candidate,
      closePrice: finalOptionValue != null ? finalOptionValue / (candidate.contracts * 100) : candidate.closePrice,
      closeDate: candidate.expiration,
      finalOptionValue: finalOptionValue ?? undefined,
      premiumCollected,
      realizedPnl: realizedPnl ?? undefined,
      percentCaptured: premiumCollected != null && premiumCollected > 0 && realizedPnl != null
        ? realizedPnl / premiumCollected
        : undefined,
      daysHeld: canonicalHistoricalDaysHeld(candidate) ?? undefined,
    };
  }

  const assignmentEconomicsChanged = previous == null
    || previous.status !== 'assigned'
    || previous.ticker !== candidate.ticker
    || previous.expiration !== candidate.expiration
    || previous.strike !== candidate.strike
    || previous.contracts !== candidate.contracts
    || previous.soldPrice !== candidate.soldPrice
    || previous.soldDate !== candidate.soldDate;
  const assigned = { ...clearExpirationResolution(candidate), resolvedDate: candidate.resolvedDate };
  const realizedPnl = assignmentEconomicsChanged ? undefined : previous.realizedPnl;
  return {
    ...assigned,
    closePrice: undefined,
    closeDate: undefined,
    premiumCollected,
    realizedPnl,
    percentCaptured: premiumCollected != null && premiumCollected > 0 && isFiniteNumber(realizedPnl)
      ? realizedPnl / premiumCollected
      : undefined,
    daysHeld: assignmentEconomicsChanged ? undefined : previous.daysHeld,
  };
}

import {
  getExpirationClosePrice,
  markExpirationPricePending,
  resolveExpiredTradeWithClose,
  type ExpirationCloseResult,
} from './portfolioExpirationArchive.ts';
import { reconcilePortfolioTradeEconomics } from './portfolioRealizedEconomics.ts';
import { makePortfolioTradeId, normalizePortfolioTrade, type PortfolioTrade, type PortfolioTradeInput } from './portfolioStorage.ts';
import { usMarketDateIso } from './portfolioEntryDelta.ts';

export type ManualTradeMode = 'open' | 'historical';
export type HistoricalTradeOutcome = 'held_to_expiration' | 'closed' | 'assigned';

export interface ManualTradeSaveIntent {
  mode: ManualTradeMode;
  historicalOutcome?: HistoricalTradeOutcome;
}

export interface PreparedManualTrade {
  trade: PortfolioTrade;
  needsExpirationLookup: boolean;
}

export function isPastExpirationDate(expiration: string, marketDate = usMarketDateIso()): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(expiration) && expiration < marketDate;
}

export function inferManualTradeMode(trade: PortfolioTrade | null, marketDate = usMarketDateIso()): ManualTradeMode {
  if (!trade) return 'open';
  return trade.status === 'open' && !isPastExpirationDate(trade.expiration, marketDate) ? 'open' : 'historical';
}

export function inferHistoricalTradeOutcome(trade: PortfolioTrade | null): HistoricalTradeOutcome {
  if (trade?.status === 'closed') return 'closed';
  if (trade?.status === 'assigned') return 'assigned';
  return 'held_to_expiration';
}

function resolutionIdentityMatches(existing: PortfolioTrade, candidate: PortfolioTrade): boolean {
  return existing.ticker === candidate.ticker
    && existing.expiration === candidate.expiration
    && existing.strike === candidate.strike
    && existing.soldDate === candidate.soldDate;
}

function contractIdentityChanged(existing: PortfolioTrade | null, candidate: PortfolioTrade): boolean {
  return existing != null && (
    existing.ticker !== candidate.ticker
    || existing.expiration !== candidate.expiration
    || existing.strike !== candidate.strike
    || existing.soldDate !== candidate.soldDate
  );
}

export function prepareManualTradeForSave(
  input: PortfolioTradeInput,
  existing: PortfolioTrade | null,
  intent: ManualTradeSaveIntent,
  nowIso = new Date().toISOString(),
): PreparedManualTrade {
  const historicalOutcome = intent.historicalOutcome ?? 'held_to_expiration';
  const status = intent.mode === 'open'
    ? 'open'
    : historicalOutcome === 'closed'
      ? 'closed'
      : historicalOutcome === 'assigned'
        ? 'assigned'
        : 'open';
  const normalized = normalizePortfolioTrade({
    ...existing,
    ...input,
    id: existing?.id ?? input.id ?? makePortfolioTradeId(),
    createdAt: existing?.createdAt ?? input.createdAt ?? nowIso,
    updatedAt: nowIso,
    status,
    closePrice: status === 'closed' ? input.closePrice : undefined,
    closeDate: status === 'closed' ? input.closeDate : undefined,
  });
  if (!normalized) throw new Error('Historical trade could not be normalized.');

  const identityChanged = contractIdentityChanged(existing, normalized);
  let candidate: PortfolioTrade = {
    ...normalized,
    ...(identityChanged ? {
      entrySnapshot: undefined,
      latestMarketData: undefined,
      importedSnapshot: undefined,
    } : {}),
    ...(existing && existing.soldDate !== normalized.soldDate ? {
      entryVixClose: undefined,
      entryVixDate: undefined,
      entryVixSource: undefined,
    } : {}),
  };
  if (identityChanged && candidate.entryDeltaSource !== 'manual') {
    candidate = {
      ...candidate,
      entryDelta: undefined,
      entryDeltaSource: undefined,
      entryDeltaCapturedAt: undefined,
    };
  }
  candidate = reconcilePortfolioTradeEconomics(existing, candidate);

  if (intent.mode !== 'historical' || historicalOutcome !== 'held_to_expiration') {
    return { trade: candidate, needsExpirationLookup: false };
  }

  if (existing && resolutionIdentityMatches(existing, candidate)) {
    const expirationEconomicsChanged = existing.soldPrice !== candidate.soldPrice || existing.contracts !== candidate.contracts;
    const reusableBasis = existing.resolutionSource === 'manual_expiration_close'
      || (existing.expirationBasisStatus === 'provider_no_actions'
        && typeof existing.expirationBasisCheckedFrom === 'string'
        && existing.expirationBasisCheckedFrom <= candidate.soldDate);
    if (Number.isFinite(existing.expirationClosePrice) && (reusableBasis || !expirationEconomicsChanged)) {
      const resolved = resolveExpiredTradeWithClose(
        candidate,
        existing.expirationClosePrice!,
        existing.expirationCloseDate ?? existing.expiration,
        existing.resolutionSource ?? 'expiration_close',
        existing.resolutionWarning,
        nowIso,
        {
          basisStatus: existing.expirationBasisStatus,
          basisCheckedFrom: existing.expirationBasisCheckedFrom,
        },
      );
      return {
        trade: { ...resolved, resolvedDate: existing.resolvedDate ?? resolved.resolvedDate },
        needsExpirationLookup: false,
      };
    }
    if (existing.status === 'expired_price_pending' || existing.resolutionType === 'expired_price_pending') {
      const pending = markExpirationPricePending(candidate, existing.resolutionWarning, nowIso);
      return {
        trade: { ...pending, resolvedDate: existing.resolvedDate ?? pending.resolvedDate },
        needsExpirationLookup: false,
      };
    }
  }

  return { trade: candidate, needsExpirationLookup: true };
}

export async function resolvePreparedManualTrade(
  prepared: PreparedManualTrade,
  options: {
    nowIso?: string;
    lookup?: (ticker: string, expiration: string, options: { contractStartDate: string }) => Promise<ExpirationCloseResult | null>;
  } = {},
): Promise<PortfolioTrade> {
  if (!prepared.needsExpirationLookup) return prepared.trade;
  const nowIso = options.nowIso ?? new Date().toISOString();
  const lookup = options.lookup ?? getExpirationClosePrice;
  try {
    const result = await lookup(prepared.trade.ticker, prepared.trade.expiration, { contractStartDate: prepared.trade.soldDate });
    return result
      ? resolveExpiredTradeWithClose(prepared.trade, result.closePrice, result.closeDate, 'expiration_close', result.warning, nowIso, result)
      : markExpirationPricePending(prepared.trade, 'Expiration close unavailable', nowIso);
  } catch (error) {
    return markExpirationPricePending(
      prepared.trade,
      error instanceof Error ? error.message : 'Expiration close unavailable',
      nowIso,
    );
  }
}

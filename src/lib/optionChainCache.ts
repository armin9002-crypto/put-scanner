import { primeMarketDataCache } from './marketDataRequest.ts';
import { getOptionChainExpirationEvidence } from './optionExpiryNavigation.ts';
import { parseYahooOptionSymbol } from './optionMarketIntegrity.ts';
import type { OptionsChainData } from './types.ts';

export const OPTIONS_SOFT_TTL_MS = 15 * 60 * 1_000;
export const OPTIONS_HARD_TTL_MS = 2 * 60 * 60 * 1_000;
export const OPTIONS_CACHE_SCHEMA_VERSION = 7;

export function getOptionsCacheKey(ticker: string, date?: number): string {
  return `options_v2_${ticker.trim().toUpperCase()}_${date ?? 'initial'}`;
}

export function optionsChainExpirationEvidence(value: OptionsChainData, requestedExpiration: number) {
  return getOptionChainExpirationEvidence(
    value.chainMeta,
    requestedExpiration,
    value.puts.map(contract => parseYahooOptionSymbol(contract.contractSymbol).expiration),
  );
}

export function isValidOptionsChain(value: OptionsChainData, requestedExpirationOverride: number | null = null): boolean {
  if (value == null
    || !Array.isArray(value.expirations)
    || !Array.isArray(value.puts)
    || !Number.isFinite(value.currentPrice)
    || value.currentPrice <= 0) return false;
  if (value.chainMeta?.integrity?.status === 'invalid') return false;
  const requestedExpiration = requestedExpirationOverride ?? value.chainMeta?.requestedExpiration ?? null;
  if (requestedExpiration != null && optionsChainExpirationEvidence(value, requestedExpiration) !== 'match') return false;
  // A symbol with no listed expirations can truthfully have no options. Listed expirations
  // paired with an empty put chain are an incomplete provider response, not cacheable evidence.
  return value.puts.length > 0 || (
    requestedExpiration == null
    && value.expirations.length === 0
    && (value.chainMeta?.callCount ?? 0) === 0
  );
}

export function primeOptionsMarketDataCache(ticker: string, date: number | undefined, data: OptionsChainData): boolean {
  return primeMarketDataCache({
    key: getOptionsCacheKey(ticker, date),
    softTtlMs: OPTIONS_SOFT_TTL_MS,
    hardTtlMs: OPTIONS_HARD_TTL_MS,
    schemaVersion: OPTIONS_CACHE_SCHEMA_VERSION,
    validator: value => isValidOptionsChain(value, date ?? null),
  }, data, data.chainMeta?.fetchedAt);
}

/** Carries acquired raw facts without admitting the rejected chain to any cache. */
export class RejectedOptionChainError extends Error {
  readonly chain: OptionsChainData;
  constructor(chain: OptionsChainData) {
    super('Option quote integrity rejected the acquired chain.');
    this.name = 'RejectedOptionChainError';
    this.chain = chain;
  }
}

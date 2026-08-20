import { primeMarketDataCache } from './marketDataRequest.ts';
import type { OptionsChainData } from './types.ts';

export const OPTIONS_SOFT_TTL_MS = 15 * 60 * 1_000;
export const OPTIONS_HARD_TTL_MS = 2 * 60 * 60 * 1_000;

export function getOptionsCacheKey(ticker: string, date?: number): string {
  return `options_v2_${ticker.trim().toUpperCase()}_${date ?? 'initial'}`;
}

export function isValidOptionsChain(value: OptionsChainData): boolean {
  return value != null
    && Array.isArray(value.expirations)
    && Array.isArray(value.puts)
    && Number.isFinite(value.currentPrice);
}

export function primeOptionsMarketDataCache(ticker: string, date: number | undefined, data: OptionsChainData): boolean {
  return primeMarketDataCache({
    key: getOptionsCacheKey(ticker, date),
    softTtlMs: OPTIONS_SOFT_TTL_MS,
    hardTtlMs: OPTIONS_HARD_TTL_MS,
    schemaVersion: 3,
    validator: isValidOptionsChain,
  }, data, data.chainMeta?.fetchedAt);
}

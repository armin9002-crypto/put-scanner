import type { ExpirationDate } from './types.ts';
import { buildOptionsPath } from './optionsNavigation.ts';

export { buildOptionsPath } from './optionsNavigation.ts';

export interface OptionExpirySelection {
  date: number | null;
  requestedMatch: boolean;
  needsChainFetch: boolean;
}

export type OptionChainExpirationEvidence = 'match' | 'mismatch' | 'unknown';

export interface OptionChainExpirationMetadata {
  returnedExpiration?: number | null;
  expirationDate?: number | null;
  expirationEvidence?: OptionChainExpirationEvidence;
}

export function getReturnedOptionExpiration(metadata: OptionChainExpirationMetadata | null | undefined): number | null {
  return metadata?.returnedExpiration ?? metadata?.expirationDate ?? null;
}

function isExpirationTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Determines whether returned chain evidence proves the requested expiration.
 * The request parameter itself is deliberately never treated as returned evidence.
 */
export function getOptionChainExpirationEvidence(
  metadata: OptionChainExpirationMetadata | null | undefined,
  requestedExpiration: number,
  contractExpirations: readonly (number | null | undefined)[] = [],
): OptionChainExpirationEvidence {
  const returnedExpirations = [metadata?.returnedExpiration, metadata?.expirationDate]
    .filter(isExpirationTimestamp);
  const hasReturnedMismatch = returnedExpirations.some(expiration => expiration !== requestedExpiration);
  if (hasReturnedMismatch || metadata?.expirationEvidence === 'mismatch') return 'mismatch';

  const parsedContractExpirations = contractExpirations.filter(isExpirationTimestamp);
  const hasUnknownContractExpiration = contractExpirations.length > 0
    && parsedContractExpirations.length !== contractExpirations.length;
  const hasContractMismatch = parsedContractExpirations.some(expiration => expiration !== requestedExpiration);
  if (hasContractMismatch) return 'mismatch';

  if (returnedExpirations.length > 0 || metadata?.expirationEvidence === 'match') return 'match';
  if (parsedContractExpirations.length > 0 && !hasUnknownContractExpiration) return 'match';
  return 'unknown';
}

export function optionChainMatchesRequestedExpiration(
  metadata: OptionChainExpirationMetadata | null | undefined,
  requestedExpiration: number,
  contractExpirations: readonly (number | null | undefined)[] = [],
): boolean {
  return getOptionChainExpirationEvidence(metadata, requestedExpiration, contractExpirations) === 'match';
}

function isoFromTimestamp(timestamp: number): string | null {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  try {
    return new Date(timestamp * 1_000).toISOString().slice(0, 10);
  } catch {
    return null;
  }
}

export function canonicalOptionExpiryIso(timestamp: number): string | null {
  return isoFromTimestamp(timestamp);
}

/** Returns the canonical URL value only when the supplied value resolved exactly. */
export function canonicalizeResolvedOptionExpiry(value: string | null, resolvedTimestamp: number): string | null {
  const canonical = isoFromTimestamp(resolvedTimestamp);
  return canonical != null && parseRequestedOptionExpiry(value) === resolvedTimestamp ? canonical : null;
}

export function parseRequestedOptionExpiry(value: string | null): number | null {
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const timestamp = Number(value);
    return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`) / 1_000;
  return Number.isSafeInteger(timestamp) && isoFromTimestamp(timestamp) === value ? timestamp : null;
}

export function buildScannerOptionsPath(ticker: string, scannerExpiration: string): string {
  if (!scannerExpiration.startsWith('date_')) return buildOptionsPath(ticker);
  const iso = isoFromTimestamp(Number(scannerExpiration.slice(5)));
  return iso ? buildOptionsPath(ticker, iso) : buildOptionsPath(ticker);
}

export function resolveOptionExpirySelection(
  expirations: ExpirationDate[],
  expiryParam: string | null,
  returnedExpiration: number | null,
): OptionExpirySelection {
  if (expirations.length === 0) {
    return { date: null, requestedMatch: false, needsChainFetch: false };
  }
  const requestedDate = parseRequestedOptionExpiry(expiryParam);
  const requestedMatch = requestedDate != null
    && expirations.some(expiration => expiration.date === requestedDate);
  const date = requestedMatch ? requestedDate : expirations[0].date;
  return {
    date,
    requestedMatch,
    needsChainFetch: returnedExpiration !== date,
  };
}

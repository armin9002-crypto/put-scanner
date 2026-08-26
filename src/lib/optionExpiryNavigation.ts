import type { ExpirationDate } from './types.ts';

export interface OptionExpirySelection {
  date: number | null;
  requestedMatch: boolean;
  needsChainFetch: boolean;
}

function isoFromTimestamp(timestamp: number): string | null {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  try {
    return new Date(timestamp * 1_000).toISOString().slice(0, 10);
  } catch {
    return null;
  }
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
  const normalizedTicker = ticker.trim().toUpperCase();
  const base = `/options/${encodeURIComponent(normalizedTicker)}`;
  if (!scannerExpiration.startsWith('date_')) return base;
  const iso = isoFromTimestamp(Number(scannerExpiration.slice(5)));
  return iso ? `${base}?expiry=${iso}` : base;
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

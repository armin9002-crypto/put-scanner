export type MarketTimestampSource = 'provider_quote' | 'provider_market_time' | 'provider_last_trade' | 'observed_at' | 'cache_time' | 'unavailable';

export interface NormalizedTimestamp {
  valueMs: number | null;
  source: MarketTimestampSource;
}

export interface CanonicalMarketTime {
  observedAt: number | null;
  providerQuoteAt: number | null;
  providerMarketAt: number | null;
  lastTradeAt: number | null;
  cachedAt: number | null;
  timestampSource: MarketTimestampSource;
}

const MIN_REASONABLE_TIMESTAMP_MS = Date.UTC(2000, 0, 1);
const DEFAULT_FUTURE_SKEW_MS = 5 * 60 * 1_000;

function numericTimestamp(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '' && /^[-+]?\d+(?:\.\d+)?$/.test(value.trim())) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
  return null;
}

/** Normalizes seconds, milliseconds, numeric strings, ISO strings, and Dates; invalid/future values fail closed. */
export function normalizeMarketTimestamp(
  value: unknown,
  options: { nowMs?: number; maxFutureSkewMs?: number } = {},
): number | null {
  const nowMs = options.nowMs ?? Date.now();
  const numeric = numericTimestamp(value);
  let timestampMs: number | null = numeric == null
    ? value instanceof Date ? value.getTime() : typeof value === 'string' ? Date.parse(value) : null
    : numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  if (timestampMs == null || !Number.isFinite(timestampMs)) return null;
  timestampMs = Math.round(timestampMs);
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    const normalizedDate = new Date(timestampMs).toISOString().slice(0, 10);
    if (normalizedDate !== value.trim()) return null;
  }
  const maxFutureSkewMs = options.maxFutureSkewMs ?? DEFAULT_FUTURE_SKEW_MS;
  if (timestampMs < MIN_REASONABLE_TIMESTAMP_MS || timestampMs > nowMs + maxFutureSkewMs) return null;
  return timestampMs;
}

export function normalizeTimestampWithSource(
  value: unknown,
  source: MarketTimestampSource,
  options: { nowMs?: number; maxFutureSkewMs?: number } = {},
): NormalizedTimestamp {
  const valueMs = normalizeMarketTimestamp(value, options);
  return { valueMs, source: valueMs == null ? 'unavailable' : source };
}

export function canonicalizeMarketTime(input: {
  observedAt?: unknown;
  providerQuoteAt?: unknown;
  providerMarketAt?: unknown;
  lastTradeAt?: unknown;
  cachedAt?: unknown;
  nowMs?: number;
}): CanonicalMarketTime {
  const options = { nowMs: input.nowMs };
  const observedAt = normalizeMarketTimestamp(input.observedAt, options);
  const providerQuoteAt = normalizeMarketTimestamp(input.providerQuoteAt, options);
  const providerMarketAt = normalizeMarketTimestamp(input.providerMarketAt, options);
  const lastTradeAt = normalizeMarketTimestamp(input.lastTradeAt, options);
  const cachedAt = normalizeMarketTimestamp(input.cachedAt, options);
  const timestampSource: MarketTimestampSource = providerQuoteAt != null
    ? 'provider_quote'
    : providerMarketAt != null
      ? 'provider_market_time'
      : observedAt != null
        ? 'observed_at'
        : cachedAt != null ? 'cache_time' : 'unavailable';
  return { observedAt, providerQuoteAt, providerMarketAt, lastTradeAt, cachedAt, timestampSource };
}

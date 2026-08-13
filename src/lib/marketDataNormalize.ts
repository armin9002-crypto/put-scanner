export function normalizeFiniteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeNonNegativeNumber(value: unknown): number | null {
  const numeric = normalizeFiniteNumber(value);
  return numeric != null && numeric >= 0 ? numeric : null;
}

export function normalizePositiveNumber(value: unknown): number | null {
  const numeric = normalizeFiniteNumber(value);
  return numeric != null && numeric > 0 ? numeric : null;
}

export function normalizeTimestampSeconds(value: unknown): number | null {
  const numeric = normalizeFiniteNumber(value);
  if (numeric == null || numeric <= 0) return null;
  return Math.round(numeric > 10_000_000_000 ? numeric / 1000 : numeric);
}

export function normalizeTimestampMs(value: unknown): number | null {
  const numeric = normalizeFiniteNumber(value);
  if (numeric == null || numeric <= 0) return null;
  return Math.round(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
}

export function normalizeYahooIvPercent(value: unknown): number | null {
  const numeric = normalizePositiveNumber(value);
  if (numeric == null) return null;
  return numeric > 5 ? numeric : numeric * 100;
}

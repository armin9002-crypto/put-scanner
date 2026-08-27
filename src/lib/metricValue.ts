export type MetricAvailability = 'available' | 'unavailable' | 'stale' | 'loading';
export type MetricSortDirection = 'asc' | 'desc';

export function isMetricAvailable(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function getMetricAvailability(
  value: unknown,
  options: { stale?: boolean; loaded?: boolean } = {},
): MetricAvailability {
  if (options.loaded === false) return 'loading';
  if (!isMetricAvailable(value)) return 'unavailable';
  return options.stale ? 'stale' : 'available';
}

export function formatMetric(
  value: unknown,
  formatter: (availableValue: number) => string,
  options: { stale?: boolean; loaded?: boolean; unavailable?: string; loading?: string; staleSuffix?: string } = {},
): string {
  const availability = getMetricAvailability(value, options);
  if (availability === 'loading') return options.loading ?? 'Loading…';
  if (availability === 'unavailable') return options.unavailable ?? '—';
  const formatted = formatter(value as number);
  return availability === 'stale' ? `${formatted}${options.staleSuffix ?? ' (stale)'}` : formatted;
}

export function compareNullableMetric(
  a: unknown,
  b: unknown,
  direction: MetricSortDirection,
): number {
  const aAvailable = isMetricAvailable(a);
  const bAvailable = isMetricAvailable(b);
  if (!aAvailable || !bAvailable) {
    if (!aAvailable && !bAvailable) return 0;
    return aAvailable ? -1 : 1;
  }
  const comparison = a - b;
  return direction === 'asc' ? comparison : -comparison;
}

export function compareNullableValue(
  a: number | string | null | undefined,
  b: number | string | null | undefined,
  direction: MetricSortDirection,
): number {
  const aAvailable = typeof a === 'string' ? a.length > 0 : isMetricAvailable(a);
  const bAvailable = typeof b === 'string' ? b.length > 0 : isMetricAvailable(b);
  if (!aAvailable || !bAvailable) {
    if (!aAvailable && !bAvailable) return 0;
    return aAvailable ? -1 : 1;
  }
  const comparison = typeof a === 'string' && typeof b === 'string'
    ? a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
    : (a as number) - (b as number);
  return direction === 'asc' ? comparison : -comparison;
}

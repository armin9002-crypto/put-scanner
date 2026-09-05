import { compareNullableValue, type MetricSortDirection } from './metricValue.ts';

export type WatchlistGroupMode = 'underlying' | 'expiry';

export interface WatchlistSortOverride {
  field: string;
  direction: MetricSortDirection;
}

export interface WatchlistGroupableRow {
  id: string;
  ticker: string;
  expiryTimestamp: number;
  expiryFormatted: string;
  strike: number;
  [field: string]: unknown;
}

export interface WatchlistRowGroup<T extends WatchlistGroupableRow = WatchlistGroupableRow> {
  key: string;
  label: string;
  rows: T[];
}

function canonicalRowCompare(a: WatchlistGroupableRow, b: WatchlistGroupableRow, mode: WatchlistGroupMode): number {
  const primary = mode === 'underlying'
    ? compareNullableValue(a.expiryTimestamp, b.expiryTimestamp, 'asc') || compareNullableValue(a.strike, b.strike, 'asc')
    : compareNullableValue(a.ticker, b.ticker, 'asc') || compareNullableValue(a.strike, b.strike, 'asc');
  return primary || compareNullableValue(a.id, b.id, 'asc');
}

function sortableValue(row: WatchlistGroupableRow, field: string): number | string | null {
  if (field === 'expiry') return row.expiryTimestamp;
  const value = row[field];
  return typeof value === 'number' || typeof value === 'string' ? value : null;
}

function rowCompare(a: WatchlistGroupableRow, b: WatchlistGroupableRow, mode: WatchlistGroupMode, sortOverride: WatchlistSortOverride | null): number {
  if (!sortOverride) return canonicalRowCompare(a, b, mode);
  return compareNullableValue(sortableValue(a, sortOverride.field), sortableValue(b, sortOverride.field), sortOverride.direction) || canonicalRowCompare(a, b, mode);
}

export function buildWatchlistGroups<T extends WatchlistGroupableRow>(
  rows: T[],
  mode: WatchlistGroupMode = 'underlying',
  sortOverride: WatchlistSortOverride | null = null,
): WatchlistRowGroup<T>[] {
  const grouped = new Map<string, T[]>();
  rows.forEach(row => {
    const key = mode === 'underlying' ? row.ticker : String(row.expiryTimestamp);
    const existing = grouped.get(key);
    if (existing) existing.push(row);
    else grouped.set(key, [row]);
  });
  return [...grouped.entries()]
    .sort(([aKey, aRows], [bKey, bRows]) => mode === 'underlying'
      ? compareNullableValue(aKey, bKey, 'asc')
      : compareNullableValue(aRows[0]?.expiryTimestamp, bRows[0]?.expiryTimestamp, 'asc'))
    .map(([key, groupRows]) => ({
      key,
      label: mode === 'underlying' ? groupRows[0]?.ticker ?? key : groupRows[0]?.expiryFormatted ?? key,
      rows: [...groupRows].sort((a, b) => rowCompare(a, b, mode, sortOverride)),
    }));
}


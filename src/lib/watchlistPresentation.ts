import { compareNullableValue, type MetricSortDirection } from './metricValue.ts';
import type { WatchlistSnapshot, WatchlistStatus } from './watchlist.ts';

export type WatchlistGroupMode = 'none' | 'underlying' | 'expiry';

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

export type WatchlistStatusTone = 'saved' | 'current' | 'stale' | 'unavailable' | 'refresh-failed' | 'quote-inconsistent' | 'expired';

export interface WatchlistStatusPresentation {
  label: 'Saved' | 'Current' | 'Stale' | 'Unavailable' | 'Refresh failed' | 'Quote inconsistent' | 'Expired';
  detail: string | null;
  tone: WatchlistStatusTone;
  color: string;
}

export function hasTrustedWatchlistQuote(snapshot: WatchlistSnapshot | null | undefined): boolean {
  return snapshot?.integrityStatus !== 'invalid'
    && [snapshot?.bid, snapshot?.ask, snapshot?.last]
      .some(value => typeof value === 'number' && Number.isFinite(value) && value > 0);
}

/**
 * Keep saved identity, evidence freshness, quote integrity, and refresh outcome
 * as separate presentation dimensions. A bare saved contract is never presented
 * as stale without retained quote evidence.
 */
export function getWatchlistStatusPresentation(
  status: WatchlistStatus,
  expired: boolean,
  snapshot: WatchlistSnapshot | null | undefined,
): WatchlistStatusPresentation {
  if (expired || status === 'expired') return { label: 'Expired', detail: 'Saved contract', tone: 'expired', color: 'var(--text-muted)' };

  const hasQuote = hasTrustedWatchlistQuote(snapshot);
  const retained = snapshot?.evidenceFreshness === 'retained-stale' && hasQuote;

  if (status === 'saved') {
    return retained
      ? { label: 'Stale', detail: 'Saved contract', tone: 'stale', color: 'var(--yellow)' }
      : { label: 'Saved', detail: hasQuote ? 'Current evidence' : 'Awaiting quote', tone: 'saved', color: 'var(--accent-light)' };
  }

  if (status === 'live') {
    return snapshot?.evidenceFreshness === 'retained-stale'
      ? { label: 'Stale', detail: 'Retained', tone: 'stale', color: 'var(--yellow)' }
      : { label: 'Current', detail: snapshot?.evidenceFreshness === 'cached-current' ? 'Cached current' : 'Live', tone: 'current', color: 'var(--green)' };
  }

  if (status === 'stale') {
    return hasQuote
      ? { label: 'Stale', detail: 'Retained', tone: 'stale', color: 'var(--yellow)' }
      : { label: 'Unavailable', detail: 'Saved contract · no quote', tone: 'unavailable', color: 'var(--text-muted)' };
  }

  if (status === 'refresh_failed') {
    return hasQuote
      ? { label: 'Stale', detail: 'Refresh failed', tone: 'refresh-failed', color: 'var(--orange)' }
      : { label: 'Unavailable', detail: 'Refresh failed · no quote', tone: 'refresh-failed', color: 'var(--orange)' };
  }

  if (status === 'quote_inconsistent') {
    return hasQuote
      ? { label: 'Stale', detail: 'Quote inconsistent', tone: 'quote-inconsistent', color: 'var(--yellow)' }
      : { label: 'Unavailable', detail: 'Quote inconsistent', tone: 'quote-inconsistent', color: 'var(--yellow)' };
  }

  return hasQuote
    ? { label: 'Stale', detail: 'Quote unavailable', tone: 'unavailable', color: 'var(--text-muted)' }
    : { label: 'Unavailable', detail: 'No current quote', tone: 'unavailable', color: 'var(--text-muted)' };
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
  if (mode === 'none') return rows.length ? [{ key: 'all', label: 'Watchlist', rows: [...rows].sort((a, b) => rowCompare(a, b, mode, sortOverride)) }] : [];
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


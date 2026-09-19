import { calculateCalendarDte, getAllCachedScannerExpirations, type ScannerSnapshotDiagnostic, type ScannerSnapshotUpdateOutcome } from './scannerOptionSnapshot.ts';
import { isTrustedOptionAvailabilityObservation, normalizeAvailabilityTickers, optionAvailabilityNeedsRevalidation, trustedListedExpirations } from './optionAvailability.ts';
import { nextUsEquityRegularSessionOpenAt } from './usMarketCalendar.ts';
import { usMarketDateIso } from '../../shared/marketDate.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatExpirationDropdownLabel(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, '${String(date.getUTCFullYear() % 100).padStart(2, '0')}`;
}

export interface CachedExpirationState {
  expirations: { date: number; label: string; dte: number }[];
  availability: Record<string, number[]>;
  coverage: 'complete' | 'partial' | 'failed' | 'cached';
  errors: Array<{ ticker?: string; message: string }>;
  retentionReason: string | null;
  observedAtByTicker?: Record<string, number>;
}

export interface SnapshotUpdateProgress {
  current: number;
  total: number;
  updated: number;
  expanded: number;
  unavailable: number;
  failed: number;
  complete: boolean;
}

export function buildExpirationState(
  availability: Record<string, number[]>,
  coverage: CachedExpirationState['coverage'] = 'cached',
  errors: Array<{ ticker?: string; message: string }> = [],
  retentionReason: string | null = null,
  observedAtByTicker?: Record<string, number>,
  now = new Date(),
): CachedExpirationState {
  // Per-ticker successes survive partial coverage; explicit ticker/global errors do not.
  const normalized = normalizeAvailabilityTickers(availability);
  const isCurrent = (ticker: string) => observedAtByTicker == null || (
    Number.isFinite(observedAtByTicker[ticker])
    && isTrustedOptionAvailabilityObservation(observedAtByTicker[ticker], now.getTime())
  );
  availability = Object.fromEntries(Object.entries(normalized)
    .filter(([ticker]) => trustedListedExpirations(normalized, ticker, errors) != null && isCurrent(ticker))
    .map(([ticker, dates]) => [ticker, dates.filter(date => (calculateCalendarDte(date, now) ?? -1) > 0)]));
  if (Object.keys(normalized).some(ticker => !isCurrent(ticker))) {
    coverage = 'partial';
    retentionReason = 'Expiration availability evidence exceeded the market-session retention bound.';
  }
  const expirationMap = new Map<number, { date: number; label: string; dte: number }>();
  Object.values(availability).flat().forEach(date => {
    const dte = calculateCalendarDte(date, now);
    if (dte != null && dte > 0 && !expirationMap.has(date)) expirationMap.set(date, { date, label: formatExpirationDropdownLabel(date), dte });
  });
  return {
    expirations: [...expirationMap.values()].sort((a, b) => a.date - b.date),
    availability,
    coverage,
    errors,
    retentionReason,
    observedAtByTicker,
  };
}

/** One local date-boundary check; no provider polling. Also re-evaluate DTE locally. */
export function nextScannerExpirationCheckAt(state: CachedExpirationState, nowMs = Date.now()): number | null {
  if (Object.keys(state.availability).length === 0) return null;
  const marketDate = usMarketDateIso(nowMs);
  if (!marketDate) return null;
  let low = nowMs;
  let high = nowMs + 26 * 60 * 60 * 1_000;
  // Search using the canonical market calendar, including DST transitions.
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (usMarketDateIso(middle) === marketDate) low = middle;
    else high = middle;
  }
  return high;
}

export function scannerExpirationStateNeedsRevalidation(state: CachedExpirationState, nowMs = Date.now()): boolean {
  const observedAt = Object.values(state.observedAtByTicker ?? {});
  return observedAt.length > 0 && observedAt.some(value => optionAvailabilityNeedsRevalidation(value, nowMs));
}

/** Schedule one wake-up for the next session; the caller decides whether acquisition is due. */
export function nextScannerExpirationSessionCheckAt(state: CachedExpirationState, nowMs = Date.now()): number | null {
  if (Object.keys(state.availability).length === 0 && Object.keys(state.observedAtByTicker ?? {}).length === 0) return null;
  return nextUsEquityRegularSessionOpenAt(nowMs);
}

export function revalidateScannerExpirationState(state: CachedExpirationState, now = new Date()): CachedExpirationState {
  return buildExpirationState(state.availability, state.coverage, state.errors, state.retentionReason, state.observedAtByTicker, now);
}

/** Keep only positive evidence after an unavailable refresh; never retain authoritative negatives as fresh fact. */
export function retainScannerPositiveEvidenceAfterFailure(state: CachedExpirationState, now = new Date()): CachedExpirationState {
  const availability = Object.fromEntries(Object.entries(state.availability).filter(([, dates]) => dates.length > 0));
  const observedAtByTicker = state.observedAtByTicker
    ? Object.fromEntries(Object.entries(state.observedAtByTicker).filter(([ticker]) => Object.prototype.hasOwnProperty.call(availability, ticker)))
    : undefined;
  return buildExpirationState(
    availability,
    'partial',
    [],
    'Expiration availability refresh failed; recent confirmed expirations retained.',
    observedAtByTicker,
    now,
  );
}

export function buildCachedExpirationState(): CachedExpirationState {
  return buildExpirationState(getAllCachedScannerExpirations(), 'cached');
}

export type ScannerExpirationMatch = 'present' | 'absent' | 'unknown';

export function scannerExpirationMatch(
  ticker: string,
  expirationFilter: string,
  availability: Record<string, number[]>,
  coverage: CachedExpirationState['coverage'],
  now = new Date(),
): ScannerExpirationMatch {
  if (coverage === 'cached' || coverage === 'failed') return 'unknown';
  const dates = trustedListedExpirations(availability, ticker);
  if (!dates) return 'unknown';
  const futureDates = dates.filter(date => (calculateCalendarDte(date, now) ?? -1) > 0);
  if (expirationFilter === 'all' || expirationFilter === 'nearest') return futureDates.length > 0 ? 'present' : 'absent';
  if (expirationFilter === 'lte_30dte') {
    return futureDates.some(date => {
      const dte = calculateCalendarDte(date, now);
      return dte != null && dte > 0 && dte <= 30;
    }) ? 'present' : 'absent';
  }
  if (!expirationFilter.startsWith('date_')) return 'unknown';
  const targetDate = Number(expirationFilter.slice(5));
  return Number.isSafeInteger(targetDate) && futureDates.includes(targetDate) ? 'present' : 'absent';
}

export function tickerMatchesScannerExpiration(
  ticker: string,
  expirationFilter: string,
  availability: Record<string, number[]>,
  authoritativeAvailabilityReady: boolean,
  now = new Date(),
  coverage: CachedExpirationState['coverage'] | null = null,
): boolean {
  if (!authoritativeAvailabilityReady) return false;
  return scannerExpirationMatch(ticker, expirationFilter, availability, coverage ?? 'complete', now) === 'present';
}

export function summarizeSnapshotOutcomes(outcomes: ScannerSnapshotUpdateOutcome[]): Pick<SnapshotUpdateProgress, 'updated' | 'expanded' | 'unavailable' | 'failed'> {
  return outcomes.reduce((summary, outcome) => {
    if (outcome.status === 'updated') summary.updated += 1;
    if (outcome.status === 'updated' && outcome.expanded) summary.expanded += 1;
    if (outcome.status === 'unavailable') summary.unavailable += 1;
    if (outcome.status === 'failed') summary.failed += 1;
    return summary;
  }, { updated: 0, expanded: 0, unavailable: 0, failed: 0 });
}

export function snapshotProgressLabel(progress: SnapshotUpdateProgress | null): string {
  if (!progress || progress.complete) return 'Update liquidity';
  return `Updating ${progress.current}/${progress.total} needing refresh`;
}

export function snapshotIssueLabel(progress: SnapshotUpdateProgress | null): string | null {
  if (!progress?.complete) return null;
  const issues = progress.unavailable + progress.failed;
  return issues > 0 ? `${issues} ${issues === 1 ? 'issue' : 'issues'} / ${progress.total} checked` : null;
}

export function snapshotProgressDetails(progress: SnapshotUpdateProgress | null): string | null {
  if (!progress?.complete || progress.total === 0) return null;
  return `Last refresh: ${progress.total} checked \u00b7 ${progress.updated} updated \u00b7 ${progress.unavailable} unavailable \u00b7 ${progress.failed} failed`;
}

export function diagnosticForOutcome(outcome: ScannerSnapshotUpdateOutcome): { status: ScannerSnapshotDiagnostic['status']; reason: string } | null {
  if (outcome.status === 'failed') return { status: 'failed', reason: outcome.reason ?? 'Snapshot update failed.' };
  if (outcome.status === 'unavailable') return { status: 'unavailable', reason: outcome.reason ?? 'No usable snapshot could be constructed.' };
  return null;
}

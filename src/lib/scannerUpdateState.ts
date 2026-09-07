import { calculateCalendarDte, getAllCachedScannerExpirations, type ScannerSnapshotDiagnostic, type ScannerSnapshotUpdateOutcome } from './scannerOptionSnapshot.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatExpirationDropdownLabel(timestamp: number): string {
  const date = new Date(timestamp * 1000);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, '${String(date.getUTCFullYear() % 100).padStart(2, '0')}`;
}

export interface CachedExpirationState {
  expirations: { date: number; label: string; dte: number }[];
  availability: Record<string, number[]>;
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

export function buildExpirationState(availability: Record<string, number[]>): CachedExpirationState {
  const expirationMap = new Map<number, { date: number; label: string; dte: number }>();
  Object.values(availability).flat().forEach(date => {
    const dte = calculateCalendarDte(date);
    if (dte > 0 && !expirationMap.has(date)) expirationMap.set(date, { date, label: formatExpirationDropdownLabel(date), dte });
  });
  return { expirations: [...expirationMap.values()].sort((a, b) => a.date - b.date), availability };
}

export function buildCachedExpirationState(): CachedExpirationState {
  return buildExpirationState(getAllCachedScannerExpirations());
}

export function tickerMatchesScannerExpiration(
  ticker: string,
  expirationFilter: string,
  availability: Record<string, number[]>,
  authoritativeAvailabilityReady: boolean,
  now = new Date(),
): boolean {
  if (expirationFilter === 'all' || !authoritativeAvailabilityReady) return true;
  const dates = availability[ticker.trim().toUpperCase()];
  // Partial endpoint failures are unknown, not evidence that the ticker has no options.
  if (!dates) return true;
  if (expirationFilter === 'lte_30dte') {
    return dates.some(date => {
      const dte = calculateCalendarDte(date, now);
      return dte >= 0 && dte <= 30;
    });
  }
  if (!expirationFilter.startsWith('date_')) return true;
  const targetDate = Number(expirationFilter.slice(5));
  return Number.isSafeInteger(targetDate) && dates.includes(targetDate);
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
  return issues > 0 ? `${issues} ${issues === 1 ? 'issue' : 'issues'}` : null;
}

export function snapshotProgressDetails(progress: SnapshotUpdateProgress | null): string | null {
  if (!progress?.complete || progress.total === 0) return null;
  return `Updated ${progress.updated} \u00b7 Expanded ${progress.expanded} \u00b7 ${progress.unavailable} unavailable \u00b7 ${progress.failed} failed`;
}

export function diagnosticForOutcome(outcome: ScannerSnapshotUpdateOutcome): { status: ScannerSnapshotDiagnostic['status']; reason: string } | null {
  if (outcome.status === 'failed') return { status: 'failed', reason: outcome.reason ?? 'Snapshot update failed.' };
  if (outcome.status === 'unavailable') return { status: 'unavailable', reason: outcome.reason ?? 'No usable snapshot could be constructed.' };
  return null;
}

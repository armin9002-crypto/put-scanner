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

export function buildCachedExpirationState(): CachedExpirationState {
  const availability = getAllCachedScannerExpirations();
  const expirationMap = new Map<number, { date: number; label: string; dte: number }>();
  Object.values(availability).flat().forEach(date => {
    const dte = calculateCalendarDte(date);
    if (dte > 0 && !expirationMap.has(date)) expirationMap.set(date, { date, label: formatExpirationDropdownLabel(date), dte });
  });
  return { expirations: [...expirationMap.values()].sort((a, b) => a.date - b.date), availability };
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
  if (!progress) return 'Update IV / Liquidity';
  if (!progress.complete) return `Updating ${progress.current}/${progress.total}`;
  if (progress.total === 0) return 'IV / Liquidity Current';
  return `Updated ${progress.updated} \u00b7 Expanded ${progress.expanded} \u00b7 Unavailable ${progress.unavailable} \u00b7 Failed ${progress.failed}`;
}

export function diagnosticForOutcome(outcome: ScannerSnapshotUpdateOutcome): { status: ScannerSnapshotDiagnostic['status']; reason: string } | null {
  if (outcome.status === 'failed') return { status: 'failed', reason: outcome.reason ?? 'Snapshot update failed.' };
  if (outcome.status === 'unavailable') return { status: 'unavailable', reason: outcome.reason ?? 'No usable snapshot could be constructed.' };
  return null;
}

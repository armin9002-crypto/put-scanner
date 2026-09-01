import { AlertTriangle, CheckCircle2, History, Wrench } from 'lucide-react';
import type { PortfolioMaintenanceAssessment } from '../lib/portfolioMaintenance';

interface PortfolioMaintenanceModalProps {
  assessment: PortfolioMaintenanceAssessment;
  busy: 'lifecycle' | 'entry-vix' | 'entry-snapshot' | null;
  message: string;
  onResolveLifecycle: () => void;
  onResolveEntryVix: () => void;
  onRecoverEntrySnapshots: () => void;
  onClose: () => void;
}

function CountRow({ label, count, detail, actionable = false }: { label: string; count: number; detail: string; actionable?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg px-3 py-2.5" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
      <div className="min-w-0">
        <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{label}</div>
        <div className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>{detail}</div>
      </div>
      <span className="shrink-0 rounded px-2 py-1 font-mono text-xs font-semibold" style={{ color: actionable && count > 0 ? 'var(--yellow)' : 'var(--text-muted)', backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>{count}</span>
    </div>
  );
}

export default function PortfolioMaintenanceModal({
  assessment,
  busy,
  message,
  onResolveLifecycle,
  onResolveEntryVix,
  onRecoverEntrySnapshots,
  onClose,
}: PortfolioMaintenanceModalProps) {
  const lifecycleCount = assessment.expiredLifecycleReview.length;
  const entryVixCount = assessment.missingEntryVix.length;
  const recoverableDeltaCount = assessment.recoverableEntryDelta.length;
  const unavailableDeltaCount = assessment.historicalEntryDeltaUnavailable.length;
  const recoverableIvCount = assessment.recoverableEntryIv.length;
  const unavailableIvCount = assessment.historicalEntryIvUnavailable.length;
  const recoverableSnapshotCount = new Set([
    ...assessment.recoverableEntryDelta.map(trade => trade.id),
    ...assessment.recoverableEntryIv.map(trade => trade.id),
  ]).size;
  return (
    <div className="fixed inset-0 z-[85]">
      <button type="button" aria-label="Close Portfolio Maintenance" onClick={onClose} className="absolute inset-0 bg-black/55" />
      <section role="dialog" aria-modal="true" aria-labelledby="portfolio-maintenance-title" className="absolute inset-x-0 bottom-0 max-h-[94dvh] overflow-y-auto rounded-t-2xl p-4 shadow-2xl sm:inset-x-1/2 sm:top-[3dvh] sm:bottom-auto sm:w-[min(680px,calc(100vw-32px))] sm:-translate-x-1/2 sm:rounded-xl sm:p-5" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="mb-2 inline-flex h-9 w-9 items-center justify-center rounded-lg" style={{ color: 'var(--accent-light)', backgroundColor: 'var(--accent-bg)' }}><Wrench className="h-4 w-4" /></div>
            <h2 id="portfolio-maintenance-title" className="text-lg font-bold" style={{ color: 'var(--text)' }}>Portfolio Maintenance</h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Review durable lifecycle and entry snapshots. Opening this view makes no market requests and changes nothing.</p>
          </div>
          <button type="button" onClick={onClose} className="min-h-10 rounded-lg px-3 text-xs font-semibold" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>Close</button>
        </div>

        <div className="mt-4 space-y-2">
          <CountRow label="Lifecycle review" count={lifecycleCount} actionable detail="Open positions definitively past expiration." />
          <CountRow label="Missing Entry VIX" count={entryVixCount} actionable detail="Historical closes can be fetched explicitly by entry-date range." />
          <CountRow label="Recoverable Entry Delta" count={recoverableDeltaCount} actionable detail="A real Delta already exists in the durable entry snapshot; no market request is needed." />
          <CountRow label="Entry Delta unavailable" count={unavailableDeltaCount} detail="No trustworthy historical source exists. These blanks are retained without warning churn." />
          <CountRow label="Recoverable Entry IV" count={recoverableIvCount} actionable detail="A valid IV already exists in the durable entry snapshot; no market request is needed." />
          <CountRow label="Entry IV unavailable" count={unavailableIvCount} detail="No trustworthy historical source exists. These blanks remain optional." />
          {assessment.expirationPricePending.length > 0 && <CountRow label="Expiration close pending" count={assessment.expirationPricePending.length} actionable detail="Use the existing history actions to retry or enter a verified close." />}
        </div>

        {message && <div role="status" className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs" style={{ color: message.startsWith('Could not') ? 'var(--yellow)' : 'var(--green)', backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>{message.startsWith('Could not') ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />}{message}</div>}

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <button type="button" onClick={onResolveLifecycle} disabled={busy != null || lifecycleCount === 0} className="min-h-11 rounded-lg px-3 text-xs font-semibold disabled:opacity-40" style={{ color: 'var(--text)', backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}><History className="mr-1.5 inline h-3.5 w-3.5" />{busy === 'lifecycle' ? 'Reviewing...' : 'Resolve Lifecycle'}</button>
          <button type="button" onClick={onResolveEntryVix} disabled={busy != null || entryVixCount === 0} className="min-h-11 rounded-lg px-3 text-xs font-semibold disabled:opacity-40" style={{ color: 'var(--text)', backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>{busy === 'entry-vix' ? 'Fetching...' : 'Backfill Entry VIX'}</button>
          <button type="button" onClick={onRecoverEntrySnapshots} disabled={busy != null || recoverableSnapshotCount === 0} className="min-h-11 rounded-lg px-3 text-xs font-semibold disabled:opacity-40" style={{ color: 'var(--text)', backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>{busy === 'entry-snapshot' ? 'Recovering...' : 'Recover Stored Snapshots'}</button>
        </div>
        <p className="mt-3 text-[11px]" style={{ color: 'var(--text-dim)' }}>Maintenance never substitutes today's Delta, IV, or underlying price for missing historical entry data.</p>
      </section>
    </div>
  );
}

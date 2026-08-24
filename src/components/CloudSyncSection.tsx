import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, Download, Loader2, RefreshCw } from 'lucide-react';
import { useProductionSync, type ProductionSyncPhase } from '../lib/cloudState/productionSyncContext.ts';
import { CLOUD_STATE_NAMESPACES } from '../lib/cloudState/types.ts';
import { createPutScannerBackup, downloadPutScannerBackup } from '../lib/userDataBackup.ts';

function statusLabel(phase: ProductionSyncPhase): string {
  if (phase === 'not_enrolled') return 'Not enabled on this device';
  if (phase === 'verifying') return 'Verifying';
  if (phase === 'synced') return 'Synced';
  if (phase === 'syncing') return 'Syncing';
  if (phase === 'pending') return 'Saved locally';
  if (phase === 'conflict') return 'Sync conflict';
  if (phase === 'account_mismatch') return 'This browser is associated with another account.';
  if (phase === 'unavailable' || phase === 'attention') return 'Account data needs attention.';
  return 'Disabled';
}

function statusDetail(
  phase: ProductionSyncPhase,
  namespaces: Record<string, string>,
): string {
  if (phase === 'not_enrolled') return 'Enable Account Sync only after Account Data has been safely saved or restored on this device.';
  if (phase === 'verifying') return 'Checking this device and its account copy.';
  if (phase === 'synced') return 'Your account data is up to date.';
  if (phase === 'syncing') return 'Syncing account changes.';
  if (phase === 'pending') return 'Account sync pending. Your changes are safely saved on this device.';
  if (phase === 'conflict') {
    const affected = CLOUD_STATE_NAMESPACES.find(namespace => namespaces[namespace] === 'conflict');
    const label = affected ? `${affected.charAt(0).toUpperCase()}${affected.slice(1)} needs attention. ` : '';
    return `${label}No data was overwritten.`;
  }
  if (phase === 'account_mismatch') return 'No data has been changed.';
  if (phase === 'unavailable' || phase === 'attention') return 'Put Scanner will not overwrite this browser.';
  return 'Account Sync is unavailable.';
}

function syncDetailStatus(status: string): string {
  if (status === 'synced') return 'Synced';
  if (status === 'pending') return 'Pending';
  if (status === 'conflict' || status === 'attention') return 'Needs attention';
  return 'Not active';
}

function statusColor(phase: ProductionSyncPhase): string {
  if (phase === 'synced') return 'var(--green)';
  if (phase === 'conflict' || phase === 'account_mismatch' || phase === 'attention') return 'var(--red)';
  if (phase === 'pending' || phase === 'unavailable') return 'var(--yellow)';
  return 'var(--text-muted)';
}

export default function CloudSyncSection() {
  const sync = useProductionSync();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const run = async (action: () => ReturnType<typeof sync.syncNow>) => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await action();
      if (!result.ok) setError(result.message);
    } finally {
      setBusy(false);
    }
  };

  const enable = () => {
    if (!window.confirm('Enable account synchronization on this browser after a fresh local/cloud equality check?')) return;
    void run(() => sync.enableOnThisDevice());
  };

  const downloadBackup = () => {
    setError('');
    try {
      const backup = createPutScannerBackup(localStorage, {
        appVersion: import.meta.env.VITE_APP_VERSION || '0.0.0',
      });
      downloadPutScannerBackup(backup, 'put-scanner-sync-conflict-backup');
    } catch (backupError) {
      setError(backupError instanceof Error ? backupError.message : 'Local backup could not be created.');
    }
  };

  if (!sync.featureEnabled) return null;

  return (
    <section className="space-y-3 rounded-xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-alt)' }} aria-label="Account Sync">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text)' }}>
            <Cloud className="h-4 w-4" aria-hidden="true" /> Account Sync
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold" style={{ color: statusColor(sync.phase) }}>
            {sync.phase === 'synced' ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : sync.phase === 'verifying' || sync.phase === 'syncing' ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
            {statusLabel(sync.phase)}
          </div>
        </div>
        {sync.lastSuccessfulSyncAt && (
          <time className="text-right text-[10px] leading-4" style={{ color: 'var(--text-dim)' }} dateTime={sync.lastSuccessfulSyncAt}>
            Last synced<br />{new Date(sync.lastSuccessfulSyncAt).toLocaleString()}
          </time>
        )}
      </div>

      <p className="text-xs leading-5" style={{ color: 'var(--text-muted)' }}>{statusDetail(sync.phase, sync.namespaces)}</p>

      {sync.canEnable && (
        <button type="button" onClick={enable} disabled={busy} className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--accent)' }}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />} Enable Sync on This Device
        </button>
      )}

      {sync.canSyncNow && sync.phase !== 'conflict' && (
        <button type="button" onClick={() => void run(() => sync.syncNow())} disabled={busy} className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />} Sync Now
        </button>
      )}

      {sync.phase === 'conflict' && (
        <button type="button" onClick={downloadBackup} className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
          <Download className="h-4 w-4" aria-hidden="true" /> Download Local Backup
        </button>
      )}

      {sync.enrollment !== 'none' && (
        <details className="rounded-lg border px-2.5 py-2 text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)', backgroundColor: 'var(--surface)' }}>
          <summary className="min-h-11 cursor-pointer py-3 font-semibold" style={{ color: 'var(--text)' }}>Sync details</summary>
          <div className="mt-2 grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
            {CLOUD_STATE_NAMESPACES.map(namespace => (
              <div key={namespace} className="contents">
                <span className="capitalize">{namespace}</span>
                <span>{syncDetailStatus(sync.namespaces[namespace])}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      {error && <div role="alert" className="rounded-lg border px-2.5 py-2 text-[11px] leading-4" style={{ borderColor: 'color-mix(in srgb, var(--red) 35%, var(--border))', color: 'var(--red)', backgroundColor: 'var(--surface)' }}>{error}</div>}
      <p className="text-[10px] leading-4" style={{ color: 'var(--text-dim)' }}>Your local data remains available immediately.</p>
    </section>
  );
}

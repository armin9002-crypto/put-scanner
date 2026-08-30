import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { AlertTriangle, Download, FileCheck2, ShieldCheck, Upload, X } from 'lucide-react';
import {
  createPutScannerBackupFromCloudState,
  downloadPutScannerBackup,
  getPutScannerBackupSummary,
  parsePutScannerBackup,
  type PutScannerBackup,
} from '../lib/userDataBackup';
import { useAuth } from '../lib/authContext';
import { useAccountState } from '../lib/cloudState/accountStateContext';

interface DataBackupModalProps {
  onClose: () => void;
  onImported: () => void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The backup operation failed.';
}

function formatExportedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export default function DataBackupModal({ onClose, onImported }: DataBackupModalProps) {
  const { user } = useAuth();
  const account = useAccountState();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const [pendingBackup, setPendingBackup] = useState<PutScannerBackup | null>(null);
  const [recoveryDownloaded, setRecoveryDownloaded] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);
  const accountReady = Boolean(user && account.cloud && (account.phase === 'ready' || account.phase === 'conflict'));

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    closeButtonRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  const exportCurrentData = (prefix = 'put-scanner-backup') => {
    try {
      if (!account.cloud || !user) throw new Error('Sign in and load your account before exporting a backup.');
      const backup = createPutScannerBackupFromCloudState(account.cloud, {
        appVersion: import.meta.env.VITE_APP_VERSION || '0.0.0',
      });
      downloadPutScannerBackup(backup, prefix);
      setError('');
      setSuccess(prefix === 'pre-import-backup'
        ? 'Recovery backup downloaded. Replace Current Data is now available.'
        : 'Backup downloaded. Keep it somewhere safe.');
      if (prefix === 'pre-import-backup') setRecoveryDownloaded(true);
    } catch (exportError) {
      setSuccess('');
      setError(errorMessage(exportError));
      if (prefix === 'pre-import-backup') setRecoveryDownloaded(false);
    }
  };

  const selectImportFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setPendingBackup(null);
    setRecoveryDownloaded(false);
    setSuccess('');
    setError('');
    try {
      const text = await file.text();
      setPendingBackup(parsePutScannerBackup(text));
    } catch (importError) {
      setError(errorMessage(importError));
    }
  };

  const replaceCurrentData = async () => {
    if (!pendingBackup || !recoveryDownloaded) return;
    setBusy(true);
    try {
      const restored = await account.restoreBackup(pendingBackup);
      if (!restored.ok) throw new Error(restored.message);
      onImported();
      setPendingBackup(null);
      setRecoveryDownloaded(false);
      setError('');
      setSuccess('Backup restored to your cloud account.');
    } catch (importError) {
      setSuccess('');
      setError(errorMessage(importError));
    } finally {
      setBusy(false);
    }
  };

  const summary = pendingBackup ? getPutScannerBackupSummary(pendingBackup) : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-end justify-center p-0 sm:items-center sm:p-4" style={{ backgroundColor: 'rgba(0,0,0,0.72)' }} role="presentation" onMouseDown={event => { if (event.currentTarget === event.target) onClose(); }}>
      <section className="max-h-[94dvh] w-full overflow-y-auto rounded-t-2xl p-4 shadow-2xl sm:max-w-xl sm:rounded-2xl sm:p-5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} role="dialog" aria-modal="true" aria-labelledby="data-backup-title">
        <header className="flex items-start justify-between gap-3">
          <div>
            <h2 id="data-backup-title" className="text-lg font-semibold" style={{ color: 'var(--text)' }}>Data Backup</h2>
            <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>Export or explicitly restore canonical cloud account data. Market-data caches are never included.</p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} className="pressable flex h-11 w-11 flex-none items-center justify-center rounded-full" aria-label="Close data backup" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-alt)' }}><X className="h-5 w-5" /></button>
        </header>

        {!accountReady && <div className="mt-4 rounded-lg border px-3 py-2 text-xs leading-5" role="status" style={{ color: 'var(--yellow)', borderColor: 'color-mix(in srgb, var(--yellow) 30%, var(--border))' }}>Sign in and load your account to export or restore durable data.</div>}
        {(error || success) && <div className="mt-4 rounded-lg px-3 py-2 text-xs leading-5" role={error ? 'alert' : 'status'} style={{ color: error ? 'var(--red)' : 'var(--green)', backgroundColor: error ? 'rgba(239,68,68,0.10)' : 'rgba(34,197,94,0.10)', border: `1px solid ${error ? 'rgba(239,68,68,0.24)' : 'rgba(34,197,94,0.24)'}` }}>{error || success}</div>}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <section className="rounded-xl p-3" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2"><Download className="h-4 w-4" style={{ color: 'var(--accent-light)' }} /><h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Export Backup</h3></div>
            <p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>Downloads trades, history, watchlist notes, and saved display preferences.</p>
            <button type="button" disabled={!accountReady || busy} onClick={() => exportCurrentData()} className="pressable mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold text-white disabled:opacity-40" style={{ backgroundColor: 'var(--accent)' }}><Download className="h-4 w-4" /> Download Backup</button>
          </section>

          <section className="rounded-xl p-3" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
            <div className="flex items-center gap-2"><Upload className="h-4 w-4" style={{ color: 'var(--accent-light)' }} /><h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Import Backup</h3></div>
            <p className="mt-2 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>A file is parsed and validated before explicit CAS-protected cloud writes.</p>
            <input ref={fileInputRef} type="file" accept="application/json,.json" className="hidden" onChange={event => void selectImportFile(event)} />
            <button type="button" disabled={!accountReady || busy} onClick={() => fileInputRef.current?.click()} className="pressable mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold disabled:opacity-40" style={{ color: 'var(--text)', backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}><Upload className="h-4 w-4" /> Choose Backup File</button>
          </section>
        </div>

        {summary && pendingBackup && (
          <section className="mt-4 rounded-xl p-4" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--accent-border)' }}>
            <div className="flex items-center gap-2"><FileCheck2 className="h-4 w-4" style={{ color: 'var(--green)' }} /><h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Backup found</h3></div>
            <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <div><dt style={{ color: 'var(--text-dim)' }}>Open positions</dt><dd className="mt-0.5 font-mono font-semibold" style={{ color: 'var(--text)' }}>{summary.openPositions}</dd></div>
              <div><dt style={{ color: 'var(--text-dim)' }}>Historical positions</dt><dd className="mt-0.5 font-mono font-semibold" style={{ color: 'var(--text)' }}>{summary.historicalPositions}</dd></div>
              <div><dt style={{ color: 'var(--text-dim)' }}>Watchlist items</dt><dd className="mt-0.5 font-mono font-semibold" style={{ color: 'var(--text)' }}>{summary.watchlistItems}</dd></div>
              <div><dt style={{ color: 'var(--text-dim)' }}>Preferences</dt><dd className="mt-0.5 font-semibold" style={{ color: 'var(--text)' }}>{summary.preferencesIncluded ? 'Included' : 'Not included'}</dd></div>
            </dl>
            <p className="mt-3 text-[11px]" style={{ color: 'var(--text-muted)' }}>Exported {formatExportedAt(summary.exportedAt)}</p>

            <div className="mt-4 rounded-lg p-3" style={{ backgroundColor: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.24)' }}>
              <div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-4 w-4 flex-none" style={{ color: 'var(--yellow)' }} /><p className="text-xs leading-5" style={{ color: 'var(--text-muted)' }}><b style={{ color: 'var(--text)' }}>Replace Account Data</b> writes the backup to your cloud account. Download the required recovery copy first.</p></div>
              <button type="button" onClick={() => exportCurrentData('pre-import-backup')} className="pressable mt-3 flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold" style={{ color: 'var(--text)', backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}><ShieldCheck className="h-4 w-4" /> {recoveryDownloaded ? 'Recovery Backup Downloaded' : 'Download Current Recovery Backup'}</button>
            </div>

            <button type="button" disabled={!recoveryDownloaded || !accountReady || busy} onClick={() => void replaceCurrentData()} className="pressable mt-3 min-h-11 w-full rounded-lg px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40" style={{ backgroundColor: 'var(--red)' }}>{busy ? 'Restoring…' : 'Replace Account Data'}</button>
          </section>
        )}
      </section>
    </div>
  );
}

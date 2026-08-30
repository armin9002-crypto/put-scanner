import { AlertTriangle, CheckCircle2, Cloud, Loader2, RefreshCw } from 'lucide-react';
import { useAccountState } from '../lib/cloudState/accountStateContext.ts';

export default function CloudSyncSection() {
  const account = useAccountState();
  const busy = account.phase === 'loading' || account.phase === 'saving';
  const needsAttention = account.phase === 'error' || account.phase === 'conflict' || account.phase === 'unavailable';
  const label = account.phase === 'saving'
    ? 'Saving'
    : account.phase === 'conflict'
      ? 'Latest version reloaded'
      : account.phase === 'error' || account.phase === 'unavailable'
        ? 'Needs attention'
        : 'Synced';

  return (
    <section className="space-y-3 rounded-xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-alt)' }} aria-label="Cloud account status">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text)' }}>
            <Cloud className="h-4 w-4" aria-hidden="true" /> Account Data
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-xs font-semibold" style={{ color: needsAttention ? 'var(--yellow)' : busy ? 'var(--accent-light)' : 'var(--green)' }}>
            {busy
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              : needsAttention
                ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                : <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />}
            {label}
          </div>
        </div>
        {account.lastSavedAt && (
          <time className="text-right text-[10px] leading-4" style={{ color: 'var(--text-dim)' }} dateTime={account.lastSavedAt}>
            Last saved<br />{new Date(account.lastSavedAt).toLocaleString()}
          </time>
        )}
      </div>
      <p className="text-xs leading-5" style={{ color: 'var(--text-muted)' }}>{account.message}</p>
      {needsAttention && (
        <button type="button" onClick={() => void account.reload()} disabled={busy} className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--accent)' }}>
          <RefreshCw className="h-4 w-4" aria-hidden="true" /> Reload Latest Cloud Data
        </button>
      )}
    </section>
  );
}

import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  Database,
  Download,
  FlaskConical,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import {
  beginMigrationBackupSession,
  hasCurrentSessionBackupAcknowledgement,
  recordMigrationBackupExport,
} from '../lib/cloudState/backupGate.ts';
import { createDormantCloudStateClient } from '../lib/cloudState/cloudStateClient.ts';
import { createDisposableLocalTestData } from '../lib/cloudState/devFixture.ts';
import {
  initializeTestAccountAfterFreshCheck,
  restoreTestAccountAfterFreshFetch,
} from '../lib/cloudState/devMigrationHarness.ts';
import { readCanonicalLocalState } from '../lib/cloudState/localState.ts';
import { planCloudMigration } from '../lib/cloudState/migrationPlanner.ts';
import { initializationMatchesCloud } from '../lib/cloudState/stateComparison.ts';
import { readCloudSyncMetadata } from '../lib/cloudState/syncMetadata.ts';
import type { CloudStateAssessment, CloudStateSnapshot, LocalStateAssessment } from '../lib/cloudState/types.ts';
import { supabaseAuthClient } from '../lib/supabaseClient.ts';
import { createPutScannerBackup, downloadPutScannerBackup } from '../lib/userDataBackup.ts';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The development migration action failed.';
}

function newMigrationSessionId(): string {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `cloud-migration-test-session-${id}`;
}

export default function CloudMigrationTestHarness({ userId }: { userId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [local, setLocal] = useState(() => readCanonicalLocalState(localStorage));
  const [cloud, setCloud] = useState<CloudStateSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const sessionId = useRef(newMigrationSessionId()).current;
  const [backupGate, setBackupGate] = useState(() => beginMigrationBackupSession(sessionId));
  const client = useMemo(
    () => createDormantCloudStateClient(supabaseAuthClient, userId),
    [userId],
  );

  const refreshLocal = () => {
    const next = readCanonicalLocalState(localStorage);
    setLocal(next);
    return next;
  };

  const localAssessment: LocalStateAssessment = local.status === 'ok'
    ? local.value.summary
    : local.status === 'unsupported_version'
      ? { status: 'unsupported_version' }
      : { status: 'corrupt' };
  let cloudAssessment: CloudStateAssessment = { status: 'not_checked' };
  if (cloud?.status === 'empty') cloudAssessment = { status: 'empty' };
  if (cloud?.status === 'complete') {
    const equal = local.status === 'ok' && initializationMatchesCloud(local.value.documents, cloud.state);
    cloudAssessment = {
      status: 'complete',
      hasMeaningfulData: cloud.state.portfolio.payload.data.length > 0
        || cloud.state.watchlist.payload.data.length > 0
        || Object.keys(cloud.state.preferences.payload.data).length > 0,
      comparison: equal ? 'equal' : 'different',
    };
  }
  const metadataRead = readCloudSyncMetadata(localStorage, userId);
  const syncIdentity = metadataRead.status === 'account_mismatch' ? 'mismatch' : metadataRead.status === 'missing' ? 'none' : 'match';
  const backupAcknowledged = hasCurrentSessionBackupAcknowledgement(backupGate, sessionId);
  const migrationPlan = planCloudMigration({
    local: localAssessment,
    cloud: cloudAssessment,
    syncIdentity,
    backupAcknowledgedThisSession: backupAcknowledged,
  });

  const run = async (action: () => Promise<void> | void) => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await action();
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusy(false);
    }
  };

  const checkCloud = () => run(async () => {
    const result = await client.fetchAllUserState();
    if (!result.ok) {
      setCloud(null);
      setError(result.error.message);
      return;
    }
    setCloud(result.value);
    setSuccess(result.value.status === 'empty'
      ? 'Cloud check complete: no saved account state.'
      : 'Cloud check complete: all three namespaces are available.');
  });

  const createFixture = () => run(() => {
    const confirmed = window.confirm(
      'This creates fake local data in this Incognito/private browser only. Do not use this in a browser containing real Put Scanner data.',
    );
    if (!confirmed) return;
    const result = createDisposableLocalTestData(localStorage);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setLocal({ status: 'ok', value: result.local });
    setSuccess('Disposable local test data created and validated.');
  });

  const downloadBackup = (prefix: string, unlockMigration: boolean) => run(() => {
    const backup = createPutScannerBackup(localStorage, {
      appVersion: import.meta.env.VITE_APP_VERSION || '0.0.0',
    });
    downloadPutScannerBackup(backup, prefix);
    if (unlockMigration) {
      setBackupGate(current => recordMigrationBackupExport(current, sessionId, 'succeeded'));
      setSuccess('Backup downloaded for this migration session.');
    } else {
      setSuccess('Pre-restore recovery backup downloaded.');
    }
  });

  const initializeCloud = () => run(async () => {
    const result = await initializeTestAccountAfterFreshCheck(
      client,
      localStorage,
      userId,
      hasCurrentSessionBackupAcknowledgement(backupGate, sessionId),
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setCloud({ status: 'complete', state: result.cloud });
    refreshLocal();
    setSuccess(result.metadataWritten
      ? 'Test migration verified. 3 cloud namespaces saved and read back successfully.'
      : 'Test migration verified, but device sync metadata could not be written.');
  });

  const restoreCloud = () => run(async () => {
    const result = await restoreTestAccountAfterFreshFetch(client, localStorage, userId);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setCloud({ status: 'complete', state: result.cloud });
    setLocal({ status: 'ok', value: result.local });
    setSuccess(result.metadataWritten
      ? 'Test restore verified. Restored local durable state matches cloud state.'
      : 'Test restore verified, but device sync metadata could not be written.');
  });

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={() => setExpanded(true)}
        className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold"
        style={{ borderColor: 'var(--yellow)', color: 'var(--yellow)', backgroundColor: 'color-mix(in srgb, var(--yellow) 7%, transparent)' }}
      >
        <FlaskConical className="h-4 w-4" aria-hidden="true" />
        Migration Test Harness
      </button>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border p-3" style={{ borderColor: 'var(--yellow)', backgroundColor: 'color-mix(in srgb, var(--yellow) 5%, var(--surface))' }} aria-label="Development cloud migration test harness">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--yellow)' }}>
            <FlaskConical className="h-4 w-4" aria-hidden="true" /> Development only
          </div>
          <p className="mt-1 text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>
            Localhost + Incognito/private browser only. Never use real browser data.
          </p>
        </div>
        <button type="button" onClick={() => setExpanded(false)} className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Collapse</button>
      </div>

      <button type="button" onClick={checkCloud} disabled={busy} className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold disabled:opacity-50" style={{ backgroundColor: 'var(--accent)', color: 'white' }}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Cloud className="h-4 w-4" aria-hidden="true" />}
        Check Cloud State
      </button>

      <div className="grid grid-cols-2 gap-2">
        <SafeSummary title="Local test state" icon={<Database className="h-3.5 w-3.5" aria-hidden="true" />}>
          {local.status === 'ok' ? (
            <>
              <div>Portfolio: {local.value.summary.portfolio.openTradeCount} open</div>
              <div>History: {local.value.summary.portfolio.historyCount}</div>
              <div>Watchlist: {local.value.summary.watchlist.itemCount}</div>
              <div>Preferences: {local.value.summary.preferences.nonDefaultPreferenceCount}</div>
            </>
          ) : <div>Blocked: invalid local state</div>}
        </SafeSummary>
        <SafeSummary title="Cloud" icon={<Cloud className="h-3.5 w-3.5" aria-hidden="true" />}>
          {!cloud && <div>Not checked</div>}
          {cloud?.status === 'empty' && <div>No saved account state</div>}
          {cloud?.status === 'complete' && (
            <>
              <div>Portfolio saved · r{cloud.state.portfolio.revision}</div>
              <div>Watchlist saved · r{cloud.state.watchlist.revision}</div>
              <div>Preferences saved · r{cloud.state.preferences.revision}</div>
            </>
          )}
        </SafeSummary>
      </div>

      <div className="rounded-lg border px-2.5 py-2 text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)', backgroundColor: 'var(--surface)' }}>
        Planner: <span className="font-semibold" style={{ color: 'var(--text)' }}>{migrationPlan.state}</span>
      </div>

      <button type="button" onClick={createFixture} disabled={busy} className="pressable min-h-11 w-full rounded-lg border px-3 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
        Create Disposable Local Test Data
      </button>

      {cloud?.status === 'empty' && local.status === 'ok' && local.value.summary.hasMeaningfulData && (
        <div className="space-y-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <div className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Existing Local Data Found</div>
          <p className="text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>Before saving this browser&apos;s data to the test account, download a backup.</p>
          <button type="button" onClick={() => downloadBackup('cloud-migration-test-backup', true)} disabled={busy} className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
            <Download className="h-4 w-4" aria-hidden="true" /> Download Backup
          </button>
          {backupAcknowledged && <div className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--green)' }}><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Backup downloaded for this migration session</div>}
          <button type="button" onClick={initializeCloud} disabled={busy || !migrationPlan.canInitializeCloud} className="pressable min-h-11 w-full rounded-lg px-3 text-xs font-semibold text-white disabled:opacity-40" style={{ backgroundColor: 'var(--accent)' }}>
            Save Existing Data to Test Account
          </button>
        </div>
      )}

      {cloud?.status === 'complete' && local.status === 'ok' && !local.value.summary.hasMeaningfulData && (
        <div className="space-y-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <div className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Cloud Data Found</div>
          <p className="text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>This browser contains no meaningful local Put Scanner data. Restore is explicit and validated.</p>
          <button type="button" onClick={() => downloadBackup('pre-restore-cloud-migration-test', false)} disabled={busy} className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
            <Download className="h-4 w-4" aria-hidden="true" /> Download Pre-Restore Backup
          </button>
          <button type="button" onClick={restoreCloud} disabled={busy} className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--accent)' }}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Restore Cloud Data to This Browser
          </button>
        </div>
      )}

      {error && <div role="alert" className="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] leading-4" style={{ borderColor: 'color-mix(in srgb, var(--red) 35%, transparent)', color: 'var(--red)' }}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />{error}</div>}
      {success && <div role="status" className="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] leading-4" style={{ borderColor: 'color-mix(in srgb, var(--green) 35%, transparent)', color: 'var(--green)' }}><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />{success}</div>}
      <div className="flex items-start gap-2 text-[10px] leading-4" style={{ color: 'var(--text-dim)' }}><AlertTriangle className="mt-0.5 h-3 w-3 flex-none" aria-hidden="true" />No automatic upload, restore, polling, or ongoing sync is enabled.</div>
    </section>
  );
}

function SafeSummary({
  title,
  icon,
  children,
}: {
  title: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-lg border p-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
      <div className="mb-1 flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>{icon}{title}</div>
      <div className="space-y-0.5 text-[10px] leading-4" style={{ color: 'var(--text-muted)' }}>{children}</div>
    </div>
  );
}

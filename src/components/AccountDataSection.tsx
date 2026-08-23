import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Cloud,
  Database,
  Download,
  Loader2,
  RotateCcw,
} from 'lucide-react';
import {
  beginMigrationBackupSession,
  hasCurrentSessionBackupAcknowledgement,
  recordMigrationBackupExport,
} from '../lib/cloudState/backupGate.ts';
import {
  initializeAccountAfterFreshCheck,
  inspectAccountData,
  planInspectedAccountData,
  restoreAccountAfterFreshFetch,
  type AccountDataInspection,
  type AccountDataInspectionResult,
} from '../lib/cloudState/accountMigration.ts';
import { createDormantCloudStateClient } from '../lib/cloudState/cloudStateClient.ts';
import type { LocalDataPresenceSummary } from '../lib/cloudState/types.ts';
import { supabaseAuthClient } from '../lib/supabaseClient.ts';
import { createPutScannerBackup, downloadPutScannerBackup } from '../lib/userDataBackup.ts';

type Completion = {
  kind: 'saved' | 'restored';
  local: LocalDataPresenceSummary;
  metadataWritten: boolean;
};

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The account data action could not be completed.';
}

function newMigrationSessionId(): string {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `account-migration-session-${id}`;
}

export default function AccountDataSection({
  userId,
  ongoingSyncState = 'none',
}: {
  userId: string;
  ongoingSyncState?: 'none' | 'enabled' | 'blocked';
}) {
  const [expanded, setExpanded] = useState(false);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inspection, setInspection] = useState<AccountDataInspection | null>(null);
  const [inspectionFailure, setInspectionFailure] = useState<Extract<AccountDataInspectionResult, { ok: false }> | null>(null);
  const [confirmation, setConfirmation] = useState<'save' | 'restore' | null>(null);
  const [actionError, setActionError] = useState('');
  const [blocked, setBlocked] = useState(false);
  const [notice, setNotice] = useState('');
  const [completion, setCompletion] = useState<Completion | null>(null);
  const sessionId = useRef(newMigrationSessionId()).current;
  const statusCheckInFlight = useRef(false);
  const operationInFlight = useRef(false);
  const [backupGate, setBackupGate] = useState(() => beginMigrationBackupSession(sessionId));
  const client = useMemo(
    () => createDormantCloudStateClient(supabaseAuthClient, userId),
    [userId],
  );
  const backupAcknowledged = hasCurrentSessionBackupAcknowledgement(backupGate, sessionId);
  const plan = inspection ? planInspectedAccountData(inspection, backupAcknowledged) : null;

  const checkStatus = async () => {
    if (statusCheckInFlight.current) return;
    statusCheckInFlight.current = true;
    setChecking(true);
    setInspection(null);
    setInspectionFailure(null);
    setActionError('');
    setNotice('');
    setBlocked(false);
    setCompletion(null);
    try {
      const result = await inspectAccountData(client, localStorage, userId);
      if (result.ok) setInspection(result.value);
      else setInspectionFailure(result);
    } catch (error) {
      setInspectionFailure({
        ok: false,
        code: 'cloud_check_failed',
        message: errorMessage(error),
      });
    } finally {
      statusCheckInFlight.current = false;
      setChecking(false);
    }
  };

  const openAccountData = () => {
    setExpanded(true);
    if (ongoingSyncState === 'none'
      && !inspection && !inspectionFailure && !completion && !checking) void checkStatus();
  };

  const downloadLocalBackup = (prefix: string, unlockMigration: boolean) => {
    setActionError('');
    setNotice('');
    try {
      const backup = createPutScannerBackup(localStorage, {
        appVersion: import.meta.env.VITE_APP_VERSION || '0.0.0',
      });
      downloadPutScannerBackup(backup, prefix);
      if (unlockMigration) {
        setBackupGate(current => recordMigrationBackupExport(current, sessionId, 'succeeded'));
        setNotice('Backup downloaded for this migration session.');
      } else {
        setNotice('Local recovery backup downloaded.');
      }
    } catch (error) {
      if (unlockMigration) {
        setBackupGate(current => recordMigrationBackupExport(current, sessionId, 'failed'));
      }
      setActionError(errorMessage(error));
    }
  };

  const saveToAccount = async () => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      const result = await initializeAccountAfterFreshCheck(client, localStorage, userId, {
        backupAcknowledgedThisSession: hasCurrentSessionBackupAcknowledgement(backupGate, sessionId),
        confirmed: true,
        expectedLocalDocuments: inspection?.local.documents,
      });
      if (!result.ok) {
        setActionError(result.message);
        setConfirmation(null);
        setBlocked(true);
        return;
      }
      setCompletion({
        kind: 'saved',
        local: result.local.summary,
        metadataWritten: result.metadataWritten,
      });
      setConfirmation(null);
    } catch (error) {
      setActionError(errorMessage(error));
      setConfirmation(null);
      setBlocked(true);
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  };

  const restoreToBrowser = async () => {
    if (operationInFlight.current) return;
    operationInFlight.current = true;
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      const result = await restoreAccountAfterFreshFetch(client, localStorage, userId, {
        confirmed: true,
      });
      if (!result.ok) {
        setActionError(result.message);
        setConfirmation(null);
        setBlocked(true);
        return;
      }
      setCompletion({
        kind: 'restored',
        local: result.local.summary,
        metadataWritten: result.metadataWritten,
      });
      setConfirmation(null);
    } catch (error) {
      setActionError(errorMessage(error));
      setConfirmation(null);
      setBlocked(true);
    } finally {
      operationInFlight.current = false;
      setBusy(false);
    }
  };

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={openAccountData}
        className="pressable flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border px-3 text-sm font-semibold"
        style={{ borderColor: 'var(--border)', color: 'var(--text)', backgroundColor: 'var(--surface-alt)' }}
      >
        <span className="flex items-center gap-2"><Cloud className="h-4 w-4" aria-hidden="true" />Account Data</span>
        <ChevronDown className="h-4 w-4" aria-hidden="true" style={{ color: 'var(--text-dim)' }} />
      </button>
    );
  }

  if (ongoingSyncState !== 'none') {
    return (
      <section className="space-y-3 rounded-xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-alt)' }} aria-label="Account Data">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text)' }}>
            <Cloud className="h-4 w-4" aria-hidden="true" />Account Data
          </div>
          <button type="button" onClick={() => setExpanded(false)} className="pressable flex min-h-9 items-center gap-1 px-1 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
            Collapse <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
        <div className="rounded-lg border p-3" style={{ borderColor: ongoingSyncState === 'enabled' ? 'color-mix(in srgb, var(--green) 35%, var(--border))' : 'color-mix(in srgb, var(--yellow) 35%, var(--border))', backgroundColor: 'var(--surface)' }}>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: ongoingSyncState === 'enabled' ? 'var(--green)' : 'var(--yellow)' }}>
            {ongoingSyncState === 'enabled' ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : <AlertTriangle className="h-4 w-4" aria-hidden="true" />}
            {ongoingSyncState === 'enabled' ? 'Account copy established' : 'Account association needs attention'}
          </div>
          <p className="mt-2 text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>
            {ongoingSyncState === 'enabled'
              ? 'Sync is enabled on this device. Initial migration and restore actions are unavailable so they cannot compete with the established sync baseline.'
              : 'Ongoing sync metadata must be resolved before initial migration or restore can run. Local data has not been changed.'}
          </p>
        </div>
        <button type="button" onClick={() => downloadLocalBackup('put-scanner-account-copy-backup', false)} className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
          <Download className="h-4 w-4" aria-hidden="true" /> Download Local Backup
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-alt)' }} aria-label="Account Data">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text)' }}>
          <Cloud className="h-4 w-4" aria-hidden="true" />Account Data
        </div>
        <button type="button" onClick={() => setExpanded(false)} className="pressable flex min-h-9 items-center gap-1 px-1 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          Collapse <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      {checking && (
        <div className="flex min-h-20 items-center justify-center gap-2 text-xs" style={{ color: 'var(--text-muted)' }} role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Checking status...
        </div>
      )}

      {!checking && inspectionFailure?.code === 'metadata_conflict' && (
        <Attention title="Account association needs attention">
          This browser was previously associated with another Put Scanner account. No data has been changed. Sign out or use another clean browser.
        </Attention>
      )}

      {!checking && inspectionFailure && inspectionFailure.code !== 'metadata_conflict' && (
        <Attention title="Account data needs attention">
          Put Scanner will not modify this browser until the account data issue is resolved.
          {inspectionFailure.code === 'cloud_check_failed' && (
            <button type="button" onClick={() => void checkStatus()} className="pressable mt-3 min-h-10 w-full rounded-lg border px-3 text-xs font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Try Status Check Again</button>
          )}
        </Attention>
      )}

      {!checking && completion && (
        <CompletionView completion={completion} />
      )}

      {!checking && inspection && !completion && (
        <>
          {plan?.state === 'cloud_empty_local_empty' && (
            <div className="rounded-lg border p-3 text-xs leading-5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)', color: 'var(--text-muted)' }}>
              <div className="font-semibold" style={{ color: 'var(--text)' }}>No account data yet</div>
              <p className="mt-1">No Put Scanner data has been saved to this account yet. This browser also contains no meaningful local data.</p>
            </div>
          )}

          {(plan?.state === 'cloud_empty_local_has_data' || plan?.state === 'migration_ready') && (
            <ExistingLocalData
              summary={inspection.localAssessment}
              backupAcknowledged={backupAcknowledged}
              confirmation={confirmation}
              busy={busy}
              blocked={blocked}
              onDownload={() => downloadLocalBackup('put-scanner-migration-backup', true)}
              onRequestSave={() => setConfirmation('save')}
              onCancel={() => setConfirmation(null)}
              onConfirm={() => void saveToAccount()}
            />
          )}

          {plan?.state === 'cloud_has_data_local_empty' && inspection.cloudSummary && (
            <CloudRestore
              summary={inspection.cloudSummary}
              confirmation={confirmation}
              busy={busy}
              blocked={blocked}
              onDownload={() => downloadLocalBackup('put-scanner-pre-restore-backup', false)}
              onRequestRestore={() => setConfirmation('restore')}
              onCancel={() => setConfirmation(null)}
              onConfirm={() => void restoreToBrowser()}
            />
          )}

          {plan?.state === 'both_have_data' && inspection.cloudSummary && (
            <div className="space-y-3">
              <Attention title="Both This Browser and Your Account Contain Data">
                For safety, Put Scanner will not automatically choose which copy to use. No data has been changed.
              </Attention>
              <div className="grid grid-cols-2 gap-2">
                <DataCounts title="This browser" summary={inspection.localAssessment} />
                <DataCounts title="Your account" summary={inspection.cloudSummary} />
              </div>
              <button type="button" onClick={() => downloadLocalBackup('put-scanner-conflict-local-backup', false)} className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                <Download className="h-4 w-4" aria-hidden="true" /> Download Local Backup
              </button>
            </div>
          )}

          {plan?.state === 'migration_verified' && (
            <CompletionView completion={{
              kind: 'saved',
              local: inspection.localAssessment,
              metadataWritten: true,
            }} />
          )}
        </>
      )}

      {actionError && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: 'color-mix(in srgb, var(--red) 30%, transparent)', color: 'var(--red)', backgroundColor: 'var(--surface)' }}>
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />{actionError}
        </div>
      )}
      {notice && (
        <div role="status" className="flex items-start gap-2 rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: 'color-mix(in srgb, var(--green) 30%, transparent)', color: 'var(--green)', backgroundColor: 'var(--surface)' }}>
          <CheckCircle2 className="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />{notice}
        </div>
      )}
      <p className="text-[10px] leading-4" style={{ color: 'var(--text-dim)' }}>
        Automatic cross-device updates are not enabled yet. Account status is checked only when you open this section.
      </p>
    </section>
  );
}

function ExistingLocalData({
  summary,
  backupAcknowledged,
  confirmation,
  busy,
  blocked,
  onDownload,
  onRequestSave,
  onCancel,
  onConfirm,
}: {
  summary: LocalDataPresenceSummary;
  backupAcknowledged: boolean;
  confirmation: 'save' | 'restore' | null;
  busy: boolean;
  blocked: boolean;
  onDownload: () => void;
  onRequestSave: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Existing Data Found</div>
        <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>This browser contains Put Scanner data that is not yet saved to your account.</p>
      </div>
      <DataCounts title="This browser" summary={summary} />
      {!confirmation && !blocked && (
        <div className="space-y-2 rounded-lg border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <div className="text-xs font-semibold" style={{ color: 'var(--text)' }}>Step 1 of 2</div>
          <p className="text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>Download a fresh backup of this browser&apos;s data.</p>
          <button type="button" onClick={onDownload} disabled={busy} className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
            <Download className="h-4 w-4" aria-hidden="true" /> Download Backup
          </button>
          {backupAcknowledged && <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--green)' }}><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Backup downloaded</div>}
          <div className="pt-1 text-xs font-semibold" style={{ color: 'var(--text)' }}>Step 2 of 2</div>
          <button type="button" onClick={onRequestSave} disabled={busy || !backupAcknowledged} className="pressable min-h-11 w-full rounded-lg px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40" style={{ backgroundColor: 'var(--accent)' }}>
            Save Existing Data to My Account
          </button>
        </div>
      )}
      {confirmation === 'save' && (
        <Confirmation title="Save this browser's data to your account?" onCancel={onCancel} onConfirm={onConfirm} confirmLabel="Save to My Account" busy={busy}>
          <p>This will create your first cloud copy of:</p>
          <DataCounts title="Local → Cloud" summary={summary} />
          <p>Your current browser data will remain in place. Cloud data will not replace or delete anything in this browser.</p>
        </Confirmation>
      )}
    </div>
  );
}

function CloudRestore({
  summary,
  confirmation,
  busy,
  blocked,
  onDownload,
  onRequestRestore,
  onCancel,
  onConfirm,
}: {
  summary: LocalDataPresenceSummary;
  confirmation: 'save' | 'restore' | null;
  busy: boolean;
  blocked: boolean;
  onDownload: () => void;
  onRequestRestore: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Account Data Found</div>
        <p className="mt-1 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>This browser contains no meaningful local Put Scanner data.</p>
      </div>
      <DataCounts title="Saved to your account" summary={summary} />
      {!confirmation && !blocked && (
        <div className="space-y-2">
          <button type="button" onClick={onDownload} disabled={busy} className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
            <Download className="h-4 w-4" aria-hidden="true" /> Download Local Recovery Backup
          </button>
          <button type="button" onClick={onRequestRestore} disabled={busy} className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--accent)' }}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" /> Restore to This Browser
          </button>
        </div>
      )}
      {confirmation === 'restore' && (
        <Confirmation title="Restore account data to this browser?" onCancel={onCancel} onConfirm={onConfirm} confirmLabel="Restore" busy={busy}>
          <p>This browser currently contains no meaningful Put Scanner data.</p>
          <p>Saved account data will be copied to this browser.</p>
        </Confirmation>
      )}
    </div>
  );
}

function CompletionView({ completion }: { completion: Completion }) {
  const title = completion.kind === 'saved' ? 'Account data saved' : 'Account data restored';
  return (
    <div className="space-y-3 rounded-lg border p-3" style={{ borderColor: 'color-mix(in srgb, var(--green) 35%, var(--border))', backgroundColor: 'var(--surface)' }} role="status">
      <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--green)' }}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{title}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
        <CheckLine>Portfolio</CheckLine><CheckLine>History</CheckLine><CheckLine>Watchlist</CheckLine><CheckLine>Preferences</CheckLine>
      </div>
      <DataCounts title="Current browser" summary={completion.local} />
      <p className="text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>
        {completion.kind === 'saved' ? 'Saved securely to your account. Current browser data remains available locally.' : 'Verified account data is now stored in this browser.'}
      </p>
      {!completion.metadataWritten && <p className="text-[11px] leading-4" style={{ color: 'var(--yellow)' }}>Account data was verified, but this browser could not save device bookkeeping.</p>}
      <p className="text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>Automatic cross-device updates are not enabled yet.</p>
    </div>
  );
}

function Confirmation({
  title,
  children,
  onCancel,
  onConfirm,
  confirmLabel,
  busy,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  onConfirm: () => void;
  confirmLabel: string;
  busy: boolean;
}) {
  return (
    <div className="space-y-3 rounded-lg border p-3" style={{ borderColor: 'var(--accent-border)', backgroundColor: 'var(--surface)' }} role="group" aria-label={title}>
      <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{title}</div>
      <div className="space-y-2 text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>{children}</div>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" onClick={onCancel} disabled={busy} className="pressable min-h-11 rounded-lg border px-3 text-xs font-semibold disabled:opacity-50" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Cancel</button>
        <button type="button" onClick={onConfirm} disabled={busy} className="pressable flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--accent)' }}>
          {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{confirmLabel}
        </button>
      </div>
    </div>
  );
}

function Attention({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-lg border p-3" style={{ borderColor: 'color-mix(in srgb, var(--yellow) 35%, var(--border))', backgroundColor: 'var(--surface)' }} role="alert">
      <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text)' }}><AlertTriangle className="h-4 w-4" aria-hidden="true" style={{ color: 'var(--yellow)' }} />{title}</div>
      <div className="mt-2 text-xs leading-5" style={{ color: 'var(--text-muted)' }}>{children}</div>
    </div>
  );
}

function DataCounts({ title, summary }: { title: string; summary: LocalDataPresenceSummary }) {
  return (
    <div className="rounded-lg border p-2.5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
      <div className="mb-2 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}><Database className="h-3.5 w-3.5" aria-hidden="true" />{title}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        <div>Open Portfolio</div><div className="text-right font-mono" style={{ color: 'var(--text)' }}>{summary.portfolio.openTradeCount}</div>
        <div>History</div><div className="text-right font-mono" style={{ color: 'var(--text)' }}>{summary.portfolio.historyCount}</div>
        <div>Watchlist</div><div className="text-right font-mono" style={{ color: 'var(--text)' }}>{summary.watchlist.itemCount}</div>
        <div>Preferences</div><div className="text-right font-mono" style={{ color: 'var(--text)' }}>{summary.preferences.nonDefaultPreferenceCount}</div>
      </div>
    </div>
  );
}

function CheckLine({ children }: { children: ReactNode }) {
  return <div className="flex items-center gap-1"><Check className="h-3.5 w-3.5" aria-hidden="true" style={{ color: 'var(--green)' }} />{children}</div>;
}

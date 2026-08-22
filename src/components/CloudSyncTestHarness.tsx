import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Cloud, FlaskConical, Loader2, WifiOff } from 'lucide-react';
import { createDormantCloudStateClient } from '../lib/cloudState/cloudStateClient.ts';
import { createSyncTestDiagnostics, type SyncTestDiagnosticCounters } from '../lib/cloudState/devSyncDiagnostics.ts';
import {
  assessDisposableSyncTestCloud,
  assessDisposableSyncTestLocal,
  CLOUD_SYNC_TEST_BLOCK_MESSAGE,
  disposableTestVersions,
  mutateDisposableTestPortfolio,
  mutateDisposableTestPreference,
  mutateDisposableTestWatchlist,
} from '../lib/cloudState/devSyncFixture.ts';
import {
  enableDisposableSyncTest,
  establishDisposableSyncTestEligibility,
  inspectDisposableSyncTestAccount,
  prepareDisposableSyncTestAccount,
} from '../lib/cloudState/devSyncHarness.ts';
import { isCloudSyncTestModeEnabled } from '../lib/cloudState/devSyncTestMode.ts';
import { createDevelopmentSyncTestTransport } from '../lib/cloudState/devSyncTransport.ts';
import { readCanonicalLocalNamespace, readCanonicalLocalState } from '../lib/cloudState/localState.ts';
import {
  createDormantLocalFirstSyncCoordinator,
  type DormantLocalFirstSyncCoordinator,
  type SyncNowResult,
} from '../lib/cloudState/syncCoordinator.ts';
import { readOngoingSyncMetadata } from '../lib/cloudState/syncEngineMetadata.ts';
import { fingerprintNamespaceDocument } from '../lib/cloudState/syncFingerprint.ts';
import { CLOUD_STATE_NAMESPACES, type CloudNamespace, type CloudStateRow, type CloudStateSnapshot } from '../lib/cloudState/types.ts';
import { supabaseAuthClient } from '../lib/supabaseClient.ts';

const EMPTY_COUNTERS: SyncTestDiagnosticCounters = {
  cloudSelectCount: 0,
  casAttemptCount: 0,
  verifiedCasSuccessCount: 0,
  networkRetryCount: 0,
  conflictCount: 0,
  pullCount: 0,
  mutationEventCount: 0,
};
const TEST_BUTTON_CLASSES = 'pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold disabled:opacity-40';

function shortFingerprint(value: string | null | undefined): string {
  if (!value) return '—';
  return value.length <= 18 ? value : `${value.slice(0, 9)}…${value.slice(-6)}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The development synchronization action failed.';
}

function mergeVerifiedCloudRow(
  snapshot: CloudStateSnapshot | null,
  row: CloudStateRow,
): CloudStateSnapshot | null {
  if (snapshot?.status !== 'complete') return snapshot;
  return {
    status: 'complete',
    state: { ...snapshot.state, [row.namespace]: row },
  } as CloudStateSnapshot;
}

function CloudSyncTestHarnessActive({ userId }: { userId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [cloud, setCloud] = useState<CloudStateSnapshot | null>(null);
  const [deviceLabel, setDeviceLabel] = useState<'A' | 'B'>('A');
  const [offline, setOffline] = useState(false);
  const [runtimeVersion, setRuntimeVersion] = useState(0);
  const [counters, setCounters] = useState<SyncTestDiagnosticCounters>(EMPTY_COUNTERS);
  const [lastSyncNow, setLastSyncNow] = useState<SyncNowResult | null>(null);
  const coordinatorRef = useRef<DormantLocalFirstSyncCoordinator | null>(null);
  const enableInFlightRef = useRef(false);
  const diagnostics = useMemo(() => createSyncTestDiagnostics(setCounters), []);
  const client = useMemo(() => {
    const base = createDormantCloudStateClient(supabaseAuthClient, userId);
    return createDevelopmentSyncTestTransport(base, {
      onSnapshot: setCloud,
      onVerifiedRow: row => setCloud(current => mergeVerifiedCloudRow(current, row)),
    });
  }, [userId]);

  useEffect(() => () => {
    coordinatorRef.current?.setAuthenticatedUser(null);
    coordinatorRef.current?.dispose();
    coordinatorRef.current = null;
  }, [userId]);

  const local = readCanonicalLocalState(localStorage);
  const localAssessment = assessDisposableSyncTestLocal(localStorage);
  const cloudAssessment = cloud ? assessDisposableSyncTestCloud(cloud) : null;
  const hardBlocked = cloudAssessment?.status === 'non_test';
  const storedMetadata = readOngoingSyncMetadata(localStorage, userId);
  const runtimeMetadata = coordinatorRef.current?.getMetadata()
    ?? (storedMetadata.status === 'ok' ? storedMetadata.metadata : null);
  const runtimeSnapshot = coordinatorRef.current?.getSnapshot();
  const localVersions = local.status === 'ok'
    ? disposableTestVersions(local.value.documents)
    : { portfolio: null, watchlist: null, preference: null };
  const cloudVersions = cloud?.status === 'complete'
    ? disposableTestVersions({
        portfolio: { schemaVersion: cloud.state.portfolio.schemaVersion, payload: cloud.state.portfolio.payload },
        watchlist: { schemaVersion: cloud.state.watchlist.schemaVersion, payload: cloud.state.watchlist.payload },
        preferences: { schemaVersion: cloud.state.preferences.schemaVersion, payload: cloud.state.preferences.payload },
      })
    : { portfolio: null, watchlist: null, preference: null };
  const enabled = Boolean(coordinatorRef.current && runtimeSnapshot?.syncMode === 'enabled');
  const eligible = runtimeMetadata?.syncMode === 'eligible';
  const mutationSafe = enabled && localAssessment.status === 'fixture' && cloudAssessment?.status === 'fixture';

  const refresh = () => setRuntimeVersion(value => value + 1);
  void runtimeVersion;

  const run = async (action: () => Promise<void> | void) => {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await action();
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      refresh();
      setBusy(false);
    }
  };

  const checkAccount = () => run(async () => {
    const result = await inspectDisposableSyncTestAccount(client);
    if (!result.ok) return setError(result.message);
    setCloud(result.snapshot);
    if (result.assessment.status === 'non_test') return setError(CLOUD_SYNC_TEST_BLOCK_MESSAGE);
    setSuccess(result.assessment.status === 'empty'
      ? 'Disposable account check complete: cloud is empty.'
      : 'Disposable Stage 5 cloud fixture verified.');
  });

  const prepare = () => run(async () => {
    if (!window.confirm('Prepare this EMPTY disposable test account? Never continue in a browser or account containing real data.')) return;
    const result = await prepareDisposableSyncTestAccount(client, localStorage, userId);
    if (!result.ok) return setError(result.message);
    setCloud({ status: 'complete', state: result.cloud });
    setSuccess('Test account prepared. portfolio r1 · watchlist r1 · preferences r1. Eligible — not enabled.');
  });

  const establishEligibility = () => run(async () => {
    const result = await establishDisposableSyncTestEligibility(client, localStorage, userId);
    if (!result.ok) return setError(result.message);
    setCloud({ status: 'complete', state: result.cloud });
    setSuccess('Stage 5 eligibility verified. Synchronization is still disabled.');
  });

  const enableSync = () => run(async () => {
    if (coordinatorRef.current || enableInFlightRef.current) return;
    if (!window.confirm('Enable the real Stage 5 coordinator for this disposable test account in this browser session?')) return;
    enableInFlightRef.current = true;
    try {
      const result = await enableDisposableSyncTest(client, localStorage, userId);
      if (!result.ok) return setError(result.message);
      setCloud({ status: 'complete', state: result.cloud });
      const coordinator = createDormantLocalFirstSyncCoordinator({
        userId,
        client,
        storage: localStorage,
        onDiagnosticEvent: event => {
          diagnostics.record(event);
          refresh();
        },
      });
      coordinator.attachMutationEvents();
      coordinatorRef.current = coordinator;
      setSuccess('Test synchronization enabled. The real durable mutation listener is attached once.');
    } finally {
      enableInFlightRef.current = false;
    }
  });

  const mutation = (
    label: string,
    action: () => { ok: true } | { ok: false; message: string },
  ) => run(() => {
    const result = action();
    if (!result.ok) return setError(result.message);
    setSuccess(`${label} changed locally through its real durable writer. Waiting for the 1,000 ms queue.`);
  });

  const syncNow = () => run(async () => {
    const result = await coordinatorRef.current?.syncNow();
    if (!result) return setError('Test synchronization is not enabled.');
    setLastSyncNow(result);
    const pulled = CLOUD_STATE_NAMESPACES.filter(namespace => result.namespaces[namespace].outcome === 'pulled');
    setSuccess(pulled.length > 0
      ? `Sync Now complete. Pulled ${pulled.map(namespace => `${namespace} r${result.namespaces[namespace].cloudRevision}`).join(', ')}.`
      : `Sync Now complete: ${result.overall}. No conflict winner was selected.`);
  });

  const setNetworkOffline = (value: boolean) => {
    client.setOffline(value);
    setOffline(value);
    setSuccess(value
      ? 'Only the Stage 5 test transport is paused. Local writes, Auth, and market data are unchanged.'
      : 'Stage 5 test network resumed. No synchronization was started; use Sync Now deliberately.');
  };

  if (!expanded) {
    return (
      <button type="button" onClick={() => setExpanded(true)} className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border px-3 text-xs font-semibold" style={{ borderColor: 'var(--yellow)', color: 'var(--yellow)' }}>
        <FlaskConical className="h-4 w-4" aria-hidden="true" /> Sync Test Harness
      </button>
    );
  }

  return (
    <section className="space-y-3 rounded-xl border p-3" style={{ borderColor: 'var(--yellow)', backgroundColor: 'color-mix(in srgb, var(--yellow) 5%, var(--surface))' }} aria-label="Development ongoing synchronization test harness">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--yellow)' }}><FlaskConical className="h-4 w-4" aria-hidden="true" /> Sync Test Harness</div>
          <p className="mt-1 text-[11px] leading-4" style={{ color: 'var(--text-muted)' }}>Development + exact disposable email only. Localhost/private browser only.</p>
        </div>
        <button type="button" onClick={() => setExpanded(false)} className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>Collapse</button>
      </div>

      <button type="button" onClick={checkAccount} disabled={busy || enabled} className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold text-white disabled:opacity-40" style={{ backgroundColor: 'var(--accent)' }}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Cloud className="h-4 w-4" aria-hidden="true" />} Check Test Account
      </button>

      {hardBlocked && <Alert message={CLOUD_SYNC_TEST_BLOCK_MESSAGE} />}

      <div className="grid grid-cols-2 gap-2">
        <SafeSummary title="Local fixture">
          <div>Safety: {localAssessment.status}</div>
          <div>Portfolio v{localVersions.portfolio ?? '—'}</div>
          <div>Watchlist v{localVersions.watchlist ?? '—'}</div>
          <div>Preference: {localVersions.preference === null ? '—' : String(localVersions.preference)}</div>
        </SafeSummary>
        <SafeSummary title="Cloud fixture">
          <div>Safety: {cloudAssessment?.status ?? 'not checked'}</div>
          <div>Portfolio: {cloud?.status === 'complete' ? `r${cloud.state.portfolio.revision} · v${cloudVersions.portfolio ?? '—'}` : '—'}</div>
          <div>Watchlist: {cloud?.status === 'complete' ? `r${cloud.state.watchlist.revision} · v${cloudVersions.watchlist ?? '—'}` : '—'}</div>
          <div>Preferences: {cloud?.status === 'complete' ? `r${cloud.state.preferences.revision}` : '—'}</div>
        </SafeSummary>
      </div>

      {!hardBlocked && cloudAssessment?.status === 'empty' && localAssessment.status === 'empty' && (
        <button type="button" onClick={prepare} disabled={busy} className="pressable min-h-11 w-full rounded-lg border px-3 text-xs font-semibold disabled:opacity-40" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Prepare Disposable Sync Test</button>
      )}

      {!hardBlocked && cloudAssessment?.status === 'fixture' && localAssessment.status === 'fixture' && !enabled && (
        <div className="space-y-2">
          <button type="button" onClick={establishEligibility} disabled={busy} className="pressable min-h-11 w-full rounded-lg border px-3 text-xs font-semibold disabled:opacity-40" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Establish Test Eligibility</button>
          <button type="button" onClick={enableSync} disabled={busy || !eligible} className="pressable min-h-11 w-full rounded-lg px-3 text-xs font-semibold text-white disabled:opacity-40" style={{ backgroundColor: 'var(--accent)' }}>Enable Test Sync</button>
        </div>
      )}

      <SafeSummary title="Synchronization status">
        <div>Overall: {runtimeSnapshot?.overall ?? (eligible ? 'Eligible — not enabled' : 'Disabled')}</div>
        {CLOUD_STATE_NAMESPACES.map(namespace => <NamespaceStatus key={namespace} namespace={namespace} metadata={runtimeMetadata} />)}
      </SafeSummary>

      {mutationSafe && (
        <div className="space-y-2 rounded-lg border p-2.5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <label className="flex min-h-11 items-center justify-between gap-2 text-xs" style={{ color: 'var(--text)' }}>
            Device label
            <select value={deviceLabel} onChange={event => setDeviceLabel(event.target.value === 'B' ? 'B' : 'A')} className="min-h-9 rounded border px-2" style={{ backgroundColor: 'var(--input-bg)', borderColor: 'var(--border)' }}><option value="A">Device A</option><option value="B">Device B</option></select>
          </label>
          <button type="button" onClick={() => mutation('Portfolio', () => mutateDisposableTestPortfolio(localStorage, deviceLabel))} disabled={busy} className={TEST_BUTTON_CLASSES} style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Mutate Test Portfolio</button>
          <button type="button" onClick={() => mutation('Watchlist', () => mutateDisposableTestWatchlist(localStorage, deviceLabel))} disabled={busy} className={TEST_BUTTON_CLASSES} style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Mutate Test Watchlist</button>
          <button type="button" onClick={() => mutation('Preferences', () => mutateDisposableTestPreference(localStorage))} disabled={busy} className={TEST_BUTTON_CLASSES} style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Mutate Test Preferences</button>
          <button type="button" onClick={() => mutation('Portfolio burst', () => mutateDisposableTestPortfolio(localStorage, deviceLabel, 5))} disabled={busy} className={TEST_BUTTON_CLASSES} style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Burst Mutate Test Portfolio</button>
          <button type="button" onClick={syncNow} disabled={busy} className={TEST_BUTTON_CLASSES} style={{ borderColor: 'var(--accent)', color: 'var(--accent-light)' }}>Sync Now</button>
          <button type="button" onClick={() => setNetworkOffline(true)} disabled={offline || busy} className={TEST_BUTTON_CLASSES} style={{ borderColor: 'var(--border)', color: 'var(--text)' }}><WifiOff className="h-3.5 w-3.5" aria-hidden="true" /> Simulate Offline (Pause Test Network)</button>
          <button type="button" onClick={() => setNetworkOffline(false)} disabled={!offline || busy} className={TEST_BUTTON_CLASSES} style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>Resume Test Network</button>
        </div>
      )}

      <SafeSummary title="In-memory diagnostics">
        <div>Cloud SELECT: {counters.cloudSelectCount} · CAS attempts: {counters.casAttemptCount}</div>
        <div>Verified CAS: {counters.verifiedCasSuccessCount} · retries: {counters.networkRetryCount}</div>
        <div>Conflicts: {counters.conflictCount} · pulls: {counters.pullCount} · mutations: {counters.mutationEventCount}</div>
      </SafeSummary>

      {lastSyncNow && <SafeSummary title="Last Sync Now">{CLOUD_STATE_NAMESPACES.map(namespace => <div key={namespace}>{namespace}: {lastSyncNow.namespaces[namespace].classification} / {lastSyncNow.namespaces[namespace].outcome}</div>)}</SafeSummary>}
      {runtimeSnapshot?.namespaces.portfolio === 'conflict' && <Alert message="Conflict — Portfolio needs attention. No data was overwritten." />}
      {error && <Alert message={error} />}
      {success && <div role="status" className="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] leading-4" style={{ borderColor: 'color-mix(in srgb, var(--green) 35%, transparent)', color: 'var(--green)' }}><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />{success}</div>}
      <div className="text-[10px] leading-4" style={{ color: 'var(--text-dim)' }}>No DELETE, Realtime, polling, automatic restore, or conflict resolution. Test account cleanup required through separately reviewed administrative SQL.</div>
    </section>
  );
}

function NamespaceStatus({ namespace, metadata }: { namespace: CloudNamespace; metadata: ReturnType<DormantLocalFirstSyncCoordinator['getMetadata']> }) {
  const local = readCanonicalLocalNamespace(localStorage, namespace);
  const fingerprint = local.status === 'ok' ? fingerprintNamespaceDocument(local.value.document) : null;
  const state = metadata?.namespaces[namespace];
  return <div className="mt-1"><span className="capitalize">{namespace}</span>: local {shortFingerprint(fingerprint)} · synced {shortFingerprint(state?.lastSyncedFingerprint)} · r{state?.cloudRevision ?? '—'} · {state?.status ?? 'disabled'}</div>;
}

function SafeSummary({ title, children }: { title: string; children: ReactNode }) {
  return <div className="min-w-0 rounded-lg border p-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}><div className="mb-1 text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-dim)' }}>{title}</div><div className="space-y-0.5 break-words text-[10px] leading-4" style={{ color: 'var(--text-muted)' }}>{children}</div></div>;
}

function Alert({ message }: { message: string }) {
  return <div role="alert" className="flex items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] leading-4" style={{ borderColor: 'color-mix(in srgb, var(--red) 35%, transparent)', color: 'var(--red)' }}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" aria-hidden="true" />{message}</div>;
}

export default function CloudSyncTestHarness(props: { userId: string; authenticatedEmail: string | null | undefined }) {
  const allowed = isCloudSyncTestModeEnabled({
    dev: import.meta.env.DEV,
    flag: import.meta.env.VITE_CLOUD_SYNC_TEST_MODE,
    configuredEmail: import.meta.env.VITE_CLOUD_SYNC_TEST_EMAIL,
    authenticatedEmail: props.authenticatedEmail,
  });
  return allowed ? <CloudSyncTestHarnessActive userId={props.userId} /> : null;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyncTestDiagnostics } from '../src/lib/cloudState/devSyncDiagnostics.ts';
import {
  CLOUD_SYNC_TEST_NOTE,
  createDisposableLocalSyncTestData,
  disposableTestVersions,
  mutateDisposableTestPortfolio,
  mutateDisposableTestPreference,
  mutateDisposableTestWatchlist,
} from '../src/lib/cloudState/devSyncFixture.ts';
import {
  assessDisposableSyncTestResume,
  resumeDisposableSyncTest,
} from '../src/lib/cloudState/devSyncHarness.ts';
import { readCanonicalLocalState } from '../src/lib/cloudState/localState.ts';
import { createDormantLocalFirstSyncCoordinator } from '../src/lib/cloudState/syncCoordinator.ts';
import {
  readOngoingSyncMetadata,
  SYNC_ENGINE_METADATA_KEY,
  writeOngoingSyncMetadata,
} from '../src/lib/cloudState/syncEngineMetadata.ts';
import { durableMutationListenerCount } from '../src/lib/cloudState/syncEvents.ts';
import { fingerprintInitialization } from '../src/lib/cloudState/syncFingerprint.ts';
import { readCloudSyncMetadata } from '../src/lib/cloudState/syncMetadata.ts';
import { PORTFOLIO_STORAGE_KEY } from '../src/lib/portfolioStorage.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userId = '77777777-7777-4777-8777-777777777777';
const otherUserId = '88888888-8888-4888-8888-888888888888';
const now = new Date('2026-08-22T12:00:00.000Z');
const gate = {
  dev: true,
  flag: 'true',
  configuredEmail: 'stage5@example.com',
  authenticatedEmail: 'STAGE5@example.com',
};

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
    this.writes = [];
    this.removes = [];
  }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); this.writes.push([key, String(value)]); }
  removeItem(key) { this.values.delete(key); this.removes.push(key); }
}

function clone(value) {
  return structuredClone(value);
}

function storageEntries(storage) {
  return Object.fromEntries(storage.values);
}

class MockCloudClient {
  constructor(cloud) {
    this.cloud = clone(cloud);
    this.fetchCalls = 0;
    this.updateCalls = [];
  }

  async fetchAllUserState() {
    this.fetchCalls += 1;
    return { ok: true, value: { status: 'complete', state: clone(this.cloud) } };
  }

  async updateNamespaceIfRevisionMatches(namespace, expectedRevision, schemaVersion, payload) {
    this.updateCalls.push({ namespace, expectedRevision, schemaVersion, payload: clone(payload) });
    const row = this.cloud[namespace];
    if (row.revision !== expectedRevision) {
      return { ok: false, error: { code: 'conflict', operation: 'update_namespace', namespace, message: 'conflict' } };
    }
    row.schemaVersion = schemaVersion;
    row.payload = clone(payload);
    row.revision += 1;
    row.updatedAt = now.toISOString();
    return { ok: true, value: clone(row) };
  }
}

function cloudFromDocuments(documents, revisions) {
  return Object.fromEntries(Object.entries(documents).map(([namespace, document]) => [namespace, {
    userId,
    namespace,
    schemaVersion: document.schemaVersion,
    payload: clone(document.payload),
    revision: revisions[namespace],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }]));
}

function enabledMetadata(documents, revisions) {
  const fingerprints = fingerprintInitialization(documents);
  return {
    version: 1,
    userId,
    syncMode: 'enabled',
    namespaces: Object.fromEntries(Object.keys(documents).map(namespace => [namespace, {
      cloudRevision: revisions[namespace],
      lastSyncedFingerprint: fingerprints[namespace],
      lastSyncedAt: now.toISOString(),
      status: 'synced',
      pendingFingerprint: null,
    }])),
    lastReconciledAt: now.toISOString(),
  };
}

function exactPreviouslyEnabledDevice({ preferenceCloudAhead = true } = {}) {
  const storage = new MemoryStorage();
  assert.equal(createDisposableLocalSyncTestData(storage, now).ok, true);
  assert.deepEqual(mutateDisposableTestPortfolio(storage, 'A', 7, now), { ok: true, version: 8 });
  assert.deepEqual(mutateDisposableTestWatchlist(storage, 'A', now), { ok: true, version: 2 });
  assert.deepEqual(mutateDisposableTestPreference(storage), { ok: true, enabled: false });

  const local = readCanonicalLocalState(storage);
  assert.equal(local.status, 'ok');
  assert.deepEqual(disposableTestVersions(local.value.documents), {
    portfolio: 8,
    watchlist: 2,
    preference: false,
  });
  const revisions = { portfolio: 4, watchlist: 2, preferences: 2 };
  const cloud = cloudFromDocuments(local.value.documents, revisions);
  assert.equal(writeOngoingSyncMetadata(storage, enabledMetadata(local.value.documents, revisions)).status, 'ok');

  if (preferenceCloudAhead) {
    cloud.preferences.payload.data.showNominalYield = true;
    cloud.preferences.revision = 3;
    cloud.preferences.updatedAt = new Date(now.getTime() + 1_000).toISOString();
  }
  storage.writes = [];
  storage.removes = [];
  return { storage, client: new MockCloudClient(cloud) };
}

function attachResumedCoordinator(storage, client, diagnostics = createSyncTestDiagnostics()) {
  const coordinator = createDormantLocalFirstSyncCoordinator({
    userId,
    client,
    storage,
    debounceMs: 60_000,
    retryDelaysMs: [0, 0],
    now: () => now,
    delay: async () => {},
    onDiagnosticEvent: event => diagnostics.record(event),
  });
  coordinator.attachMutationEvents();
  return { coordinator, diagnostics };
}

test('exact live P8/W2/false baseline resumes inertly, then explicit Sync Now safely pulls Preferences r3 without CAS echo', async t => {
  const { storage, client } = exactPreviouslyEnabledDevice();
  const localBeforeResume = storageEntries(storage);
  const metadataBeforeResume = storage.getItem(SYNC_ENGINE_METADATA_KEY);
  const diagnostics = createSyncTestDiagnostics();

  assert.equal(assessDisposableSyncTestResume(storage, userId, gate).status, 'resumable');
  const resumed = await resumeDisposableSyncTest(client, storage, userId, gate);
  assert.equal(resumed.ok, true);
  assert.equal(client.fetchCalls, 1, 'resume performs only the explicit cloud safety read');
  assert.equal(client.updateCalls.length, 0);
  assert.deepEqual(storageEntries(storage), localBeforeResume);
  assert.equal(storage.getItem(SYNC_ENGINE_METADATA_KEY), metadataBeforeResume);
  assert.deepEqual(diagnostics.snapshot(), {
    cloudSelectCount: 0,
    casAttemptCount: 0,
    verifiedCasSuccessCount: 0,
    networkRetryCount: 0,
    conflictCount: 0,
    pullCount: 0,
    mutationEventCount: 0,
  });

  assert.equal(durableMutationListenerCount(), 0);
  const { coordinator } = attachResumedCoordinator(storage, client, diagnostics);
  t.after(() => coordinator.dispose());
  assert.equal(durableMutationListenerCount(), 1);
  coordinator.attachMutationEvents();
  assert.equal(durableMutationListenerCount(), 1, 'resume attachment remains exactly-once/idempotent');
  assert.equal(client.fetchCalls, 1, 'construction and listener attachment do not reconcile');
  assert.equal(client.updateCalls.length, 0);
  assert.deepEqual(storageEntries(storage), localBeforeResume);

  const reconciled = await coordinator.syncNow();
  assert.deepEqual({
    portfolio: [reconciled.namespaces.portfolio.classification, reconciled.namespaces.portfolio.outcome],
    watchlist: [reconciled.namespaces.watchlist.classification, reconciled.namespaces.watchlist.outcome],
    preferences: [reconciled.namespaces.preferences.classification, reconciled.namespaces.preferences.outcome],
  }, {
    portfolio: ['CLEAN', 'clean'],
    watchlist: ['CLEAN', 'clean'],
    preferences: ['CLOUD_AHEAD', 'pulled'],
  });
  assert.equal(reconciled.overall, 'all_synced');
  const localAfter = readCanonicalLocalState(storage);
  assert.equal(localAfter.status, 'ok');
  assert.equal(localAfter.value.documents.preferences.payload.data.showNominalYield, true);
  assert.equal(client.cloud.preferences.revision, 3);
  assert.equal(client.cloud.preferences.payload.data.showNominalYield, true);
  assert.equal(client.updateCalls.length, 0, 'safe preference hydration must not echo r3 back as r4');
  assert.deepEqual(diagnostics.snapshot(), {
    cloudSelectCount: 1,
    casAttemptCount: 0,
    verifiedCasSuccessCount: 0,
    networkRetryCount: 0,
    conflictCount: 0,
    pullCount: 1,
    mutationEventCount: 0,
  });
  assert.equal(readOngoingSyncMetadata(storage, userId).metadata.namespaces.preferences.cloudRevision, 3);
});

test('Account close/reopen and harness unmount/remount preserve the enabled baseline and offer inert resume again', async t => {
  for (const lifecycle of ['Account dialog close/reopen', 'Sync Test Harness unmount/remount']) {
    await t.test(lifecycle, async () => {
      const { storage, client } = exactPreviouslyEnabledDevice();
      const metadataBefore = storage.getItem(SYNC_ENGINE_METADATA_KEY);
      assert.equal((await resumeDisposableSyncTest(client, storage, userId, gate)).ok, true);
      const first = attachResumedCoordinator(storage, client).coordinator;
      assert.equal(durableMutationListenerCount(), 1);
      first.dispose();
      assert.equal(durableMutationListenerCount(), 0, 'component cleanup removes the in-memory coordinator listener');
      assert.equal(storage.getItem(SYNC_ENGINE_METADATA_KEY), metadataBefore);

      storage.writes = [];
      const resumedAgain = await resumeDisposableSyncTest(client, storage, userId, gate);
      assert.equal(resumedAgain.ok, true);
      const second = attachResumedCoordinator(storage, client).coordinator;
      assert.equal(durableMutationListenerCount(), 1);
      assert.equal(storage.writes.length, 0);
      assert.equal(client.updateCalls.length, 0);
      second.dispose();
      assert.equal(durableMutationListenerCount(), 0);
    });
  }
});

test('full reload needs no Stage 4/first-eligibility replay and performs no automatic reconciliation', async t => {
  const original = exactPreviouslyEnabledDevice();
  assert.equal(readCloudSyncMetadata(original.storage, userId).status, 'missing', 'resume is independent of Stage 4 first eligibility metadata');
  const reloadedStorage = new MemoryStorage(storageEntries(original.storage));
  const reloadedClient = new MockCloudClient(original.client.cloud);
  assert.equal(assessDisposableSyncTestResume(reloadedStorage, userId, gate).status, 'resumable');
  const result = await resumeDisposableSyncTest(reloadedClient, reloadedStorage, userId, gate);
  assert.equal(result.ok, true);
  const { coordinator, diagnostics } = attachResumedCoordinator(reloadedStorage, reloadedClient);
  t.after(() => coordinator.dispose());
  assert.equal(reloadedClient.fetchCalls, 1);
  assert.equal(reloadedClient.updateCalls.length, 0);
  assert.equal(reloadedStorage.writes.length, 0);
  assert.equal(diagnostics.snapshot().pullCount, 0);
  assert.equal(diagnostics.snapshot().casAttemptCount, 0);
});

test('LOCAL_AHEAD still pushes with verified CAS after resume', async t => {
  const { storage, client } = exactPreviouslyEnabledDevice({ preferenceCloudAhead: false });
  assert.deepEqual(mutateDisposableTestPortfolio(storage, 'B', 1, now), { ok: true, version: 9 });
  assert.equal((await resumeDisposableSyncTest(client, storage, userId, gate)).ok, true);
  assert.equal(client.updateCalls.length, 0);
  const { coordinator, diagnostics } = attachResumedCoordinator(storage, client);
  t.after(() => coordinator.dispose());

  const result = await coordinator.syncNow();
  assert.equal(result.namespaces.portfolio.classification, 'LOCAL_AHEAD');
  assert.equal(result.namespaces.portfolio.outcome, 'pushed');
  assert.equal(client.cloud.portfolio.revision, 5);
  assert.match(client.cloud.portfolio.payload.data[0].notes, /Portfolio v9 \| Device B/);
  assert.deepEqual(client.updateCalls.map(call => [call.namespace, call.expectedRevision]), [['portfolio', 4]]);
  assert.equal(diagnostics.snapshot().casAttemptCount, 1);
  assert.equal(diagnostics.snapshot().verifiedCasSuccessCount, 1);
  assert.equal(diagnostics.snapshot().conflictCount, 0);
});

test('BOTH_CHANGED remains a no-overwrite conflict after resume', async t => {
  const { storage, client } = exactPreviouslyEnabledDevice({ preferenceCloudAhead: false });
  assert.deepEqual(mutateDisposableTestPortfolio(storage, 'B', 1, now), { ok: true, version: 9 });
  const localWinner = storage.getItem(PORTFOLIO_STORAGE_KEY);
  client.cloud.portfolio.payload.data[0].notes = `${CLOUD_SYNC_TEST_NOTE} | Portfolio v9 | Device A`;
  client.cloud.portfolio.payload.data[0].updatedAt = new Date(now.getTime() + 2_000).toISOString();
  client.cloud.portfolio.revision = 5;
  client.cloud.portfolio.updatedAt = new Date(now.getTime() + 2_000).toISOString();
  const cloudWinner = clone(client.cloud.portfolio);

  assert.equal((await resumeDisposableSyncTest(client, storage, userId, gate)).ok, true);
  const { coordinator, diagnostics } = attachResumedCoordinator(storage, client);
  t.after(() => coordinator.dispose());
  const result = await coordinator.syncNow();
  assert.equal(result.namespaces.portfolio.classification, 'BOTH_CHANGED');
  assert.equal(result.namespaces.portfolio.outcome, 'conflict');
  assert.equal(result.overall, 'conflict_needs_attention');
  assert.deepEqual(client.cloud.portfolio, cloudWinner);
  assert.equal(storage.getItem(PORTFOLIO_STORAGE_KEY), localWinner);
  assert.equal(client.updateCalls.length, 0);
  assert.equal(diagnostics.snapshot().conflictCount, 1);
});

test('account mismatch, corrupt metadata, and wrong exact-email gate block resume before cloud access', async t => {
  await t.test('account mismatch', async () => {
    const { storage, client } = exactPreviouslyEnabledDevice();
    const result = await resumeDisposableSyncTest(client, storage, otherUserId, gate);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'metadata_account_mismatch');
    assert.equal(client.fetchCalls, 0);
    assert.equal(client.updateCalls.length, 0);
  });

  await t.test('corrupt metadata', async () => {
    const { storage, client } = exactPreviouslyEnabledDevice();
    storage.setItem(SYNC_ENGINE_METADATA_KEY, '{not-json');
    const result = await resumeDisposableSyncTest(client, storage, userId, gate);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'metadata_corrupt');
    assert.equal(client.fetchCalls, 0);
    assert.equal(client.updateCalls.length, 0);
  });

  await t.test('wrong test email', async () => {
    const { storage, client } = exactPreviouslyEnabledDevice();
    const result = await resumeDisposableSyncTest(client, storage, userId, {
      ...gate,
      authenticatedEmail: 'owner@example.com',
    });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'test_gate_blocked');
    assert.equal(client.fetchCalls, 0);
    assert.equal(client.updateCalls.length, 0);
  });
});

test('resume control is explicit, coordinator remains component-local in Stage 5B.1, and production guard includes it', async () => {
  const [harness, buildReport] = await Promise.all([
    readFile(path.join(root, 'src/components/CloudSyncTestHarness.tsx'), 'utf8'),
    readFile(path.join(root, 'scripts/build-report.mjs'), 'utf8'),
  ]);
  assert.match(harness, /previouslyEnabled[\s\S]*?Previously enabled device — resume available[\s\S]*?Resume Test Sync/);
  assert.match(harness, /resumeDisposableSyncTest[\s\S]*?attachCoordinator\(\)[\s\S]*?Enabled \/ awaiting reconciliation/);
  assert.match(harness, /const coordinatorRef = useRef<DormantLocalFirstSyncCoordinator \| null>\(null\)/);
  assert.match(harness, /useEffect\(\(\) => \{[\s\S]*?return \(\) => \{[\s\S]*?coordinatorRef\.current\?\.dispose\(\)/);
  assert.ok(buildReport.includes("'Resume Test Sync'"));
});

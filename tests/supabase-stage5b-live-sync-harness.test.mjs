import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSyncTestDiagnostics } from '../src/lib/cloudState/devSyncDiagnostics.ts';
import {
  assessDisposableSyncTestCloud,
  assessDisposableSyncTestLocal,
  CLOUD_SYNC_TEST_BLOCK_MESSAGE,
  CLOUD_SYNC_TEST_ID_PREFIX,
  CLOUD_SYNC_TEST_NOTE,
  createDisposableLocalSyncTestData,
  createDisposableSyncFixture,
  mutateDisposableTestPortfolio,
  mutateDisposableTestPreference,
  mutateDisposableTestWatchlist,
} from '../src/lib/cloudState/devSyncFixture.ts';
import {
  enableDisposableSyncTest,
  prepareDisposableSyncTestAccount,
} from '../src/lib/cloudState/devSyncHarness.ts';
import { isCloudSyncTestModeEnabled } from '../src/lib/cloudState/devSyncTestMode.ts';
import { createDevelopmentSyncTestTransport } from '../src/lib/cloudState/devSyncTransport.ts';
import { readCanonicalLocalState } from '../src/lib/cloudState/localState.ts';
import { createDormantLocalFirstSyncCoordinator } from '../src/lib/cloudState/syncCoordinator.ts';
import { durableMutationListenerCount } from '../src/lib/cloudState/syncEvents.ts';
import { readOngoingSyncMetadata } from '../src/lib/cloudState/syncEngineMetadata.ts';
import { readCloudSyncMetadata } from '../src/lib/cloudState/syncMetadata.ts';
import { PORTFOLIO_STORAGE_KEY, writePortfolioTrades } from '../src/lib/portfolioStorage.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userId = '77777777-7777-4777-8777-777777777777';
const otherUserId = '88888888-8888-4888-8888-888888888888';
const now = new Date('2026-08-22T12:00:00.000Z');

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

class MockCloudClient {
  constructor() {
    this.cloud = null;
    this.fetchCalls = 0;
    this.initializeCalls = 0;
    this.updateCalls = [];
    this.beforeNextUpdate = null;
  }

  async fetchAllUserState() {
    this.fetchCalls += 1;
    return this.cloud
      ? { ok: true, value: { status: 'complete', state: clone(this.cloud) } }
      : { ok: true, value: { status: 'empty' } };
  }

  async fetchNamespace(namespace) {
    return { ok: true, value: this.cloud ? clone(this.cloud[namespace]) : null };
  }

  async initializeAllNamespaces(input) {
    this.initializeCalls += 1;
    if (this.cloud) return this.error('conflict', 'initialize_all');
    this.cloud = Object.fromEntries(['portfolio', 'watchlist', 'preferences'].map(namespace => [namespace, {
      userId,
      namespace,
      schemaVersion: input[namespace].schemaVersion,
      payload: clone(input[namespace].payload),
      revision: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    }]));
    return { ok: true, value: clone(this.cloud) };
  }

  async updateNamespaceIfRevisionMatches(namespace, expectedRevision, schemaVersion, payload) {
    this.updateCalls.push({ namespace, expectedRevision, payload: clone(payload) });
    if (this.beforeNextUpdate) {
      const hook = this.beforeNextUpdate;
      this.beforeNextUpdate = null;
      await hook();
    }
    const row = this.cloud?.[namespace];
    if (!row || row.revision !== expectedRevision) return this.error('conflict', 'update_namespace', namespace);
    row.schemaVersion = schemaVersion;
    row.payload = clone(payload);
    row.revision += 1;
    row.updatedAt = now.toISOString();
    return { ok: true, value: clone(row) };
  }

  error(code, operation, namespace) {
    return { ok: false, error: { code, operation, message: code, ...(namespace ? { namespace } : {}) } };
  }
}

async function preparedDevice() {
  const storage = new MemoryStorage();
  const base = new MockCloudClient();
  const prepared = await prepareDisposableSyncTestAccount(base, storage, userId, now);
  assert.equal(prepared.ok, true);
  const enabled = await enableDisposableSyncTest(base, storage, userId, now);
  assert.equal(enabled.ok, true);
  return { storage, base, prepared, enabled };
}

function makeCoordinator(storage, client, diagnostics) {
  return createDormantLocalFirstSyncCoordinator({
    userId,
    client,
    storage,
    debounceMs: 60_000,
    retryDelaysMs: [0, 0],
    now: () => now,
    delay: async () => {},
    onDiagnosticEvent: event => diagnostics.record(event),
  });
}

test('triple gate requires DEV, exact true flag, a configured email, and normalized exact authenticated email', () => {
  const enabled = { dev: true, flag: 'true', configuredEmail: ' test@example.com ', authenticatedEmail: 'TEST@example.com' };
  assert.equal(isCloudSyncTestModeEnabled(enabled), true);
  assert.equal(isCloudSyncTestModeEnabled({ ...enabled, authenticatedEmail: 'owner@example.com' }), false);
  assert.equal(isCloudSyncTestModeEnabled({ ...enabled, flag: 'false' }), false);
  assert.equal(isCloudSyncTestModeEnabled({ ...enabled, flag: undefined }), false);
  assert.equal(isCloudSyncTestModeEnabled({ ...enabled, dev: false }), false);
  assert.equal(isCloudSyncTestModeEnabled({ ...enabled, configuredEmail: '' }), false);
});

test('fixture uses unmistakable markers and refuses meaningful non-test local data', () => {
  const fixture = createDisposableSyncFixture(now);
  assert.equal(fixture.data.portfolio.data.length, 2);
  assert.equal(fixture.data.portfolio.data.every(trade => trade.id.startsWith(CLOUD_SYNC_TEST_ID_PREFIX)), true);
  assert.equal(fixture.data.portfolio.data.every(trade => trade.notes.startsWith(CLOUD_SYNC_TEST_NOTE)), true);
  assert.equal(fixture.data.watchlist.data[0].id.toLowerCase().startsWith(CLOUD_SYNC_TEST_ID_PREFIX), true);
  assert.equal(fixture.data.watchlist.data[0].note.startsWith(CLOUD_SYNC_TEST_NOTE), true);

  const storage = new MemoryStorage();
  const realTrade = {
    id: 'real-trade', ticker: 'TQQQ', optionType: 'put', strike: 50, expiration: '2027-01-15',
    contracts: 1, soldPrice: 1, soldDate: '2026-08-20', status: 'open', notes: 'real',
    createdAt: now.toISOString(), updatedAt: now.toISOString(),
  };
  assert.equal(writePortfolioTrades(storage, [realTrade], { now }).status, 'ok');
  const before = new Map(storage.values);
  const result = createDisposableLocalSyncTestData(storage, now);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'local_not_empty');
  assert.deepEqual(storage.values, before);
  assert.equal(assessDisposableSyncTestLocal(storage).status, 'non_test');
});

test('non-test cloud payload hard-blocks setup without initialization or local writes', async () => {
  const storage = new MemoryStorage();
  const base = new MockCloudClient();
  const fixtureStorage = new MemoryStorage();
  assert.equal(createDisposableLocalSyncTestData(fixtureStorage, now).ok, true);
  const documents = readCanonicalLocalState(fixtureStorage).value.documents;
  await base.initializeAllNamespaces(documents);
  base.cloud.portfolio.payload.data[0].ticker = 'REALDATA';
  const assessment = assessDisposableSyncTestCloud({ status: 'complete', state: base.cloud });
  assert.equal(assessment.status, 'non_test');
  assert.equal(assessment.message, CLOUD_SYNC_TEST_BLOCK_MESSAGE);
  base.initializeCalls = 0;
  const result = await prepareDisposableSyncTestAccount(base, storage, userId, now);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'non_test_cloud');
  assert.equal(result.message, CLOUD_SYNC_TEST_BLOCK_MESSAGE);
  assert.equal(base.initializeCalls, 0);
  assert.equal(storage.writes.length, 0);
});

test('empty bootstrap atomically creates r1 fixtures, Stage 4 verification, and Stage 5 eligibility without enabling', async () => {
  const storage = new MemoryStorage();
  const base = new MockCloudClient();
  const result = await prepareDisposableSyncTestAccount(base, storage, userId, now);
  assert.equal(result.ok, true);
  assert.equal(base.fetchCalls, 2);
  assert.equal(base.initializeCalls, 1);
  assert.deepEqual(Object.values(result.cloud).map(row => row.revision), [1, 1, 1]);
  assert.equal(readCloudSyncMetadata(storage, userId).metadata.migrationState, 'migration_verified');
  assert.equal(readOngoingSyncMetadata(storage, userId).metadata.syncMode, 'eligible');
  assert.equal(durableMutationListenerCount(), 0);

  const enabled = await enableDisposableSyncTest(base, storage, userId, now);
  assert.equal(enabled.ok, true);
  assert.equal(readOngoingSyncMetadata(storage, userId).metadata.syncMode, 'enabled');
  assert.equal(durableMutationListenerCount(), 0);
});

test('explicit runtime attachment is idempotent and real writers drive independent verified CAS updates', async () => {
  const { storage, base } = await preparedDevice();
  const diagnostics = createSyncTestDiagnostics();
  const sync = makeCoordinator(storage, base, diagnostics);
  assert.equal(durableMutationListenerCount(), 0);
  const detachA = sync.attachMutationEvents();
  const detachB = sync.attachMutationEvents();
  assert.equal(typeof detachA, 'function');
  assert.equal(typeof detachB, 'function');
  assert.equal(durableMutationListenerCount(), 1);

  assert.equal(mutateDisposableTestPortfolio(storage, 'A', 1, now).ok, true);
  assert.equal(await sync.flushNamespace('portfolio'), 'complete');
  assert.deepEqual([base.cloud.portfolio.revision, base.cloud.watchlist.revision, base.cloud.preferences.revision], [2, 1, 1]);
  assert.equal(mutateDisposableTestWatchlist(storage, 'A', now).ok, true);
  assert.equal(await sync.flushNamespace('watchlist'), 'complete');
  assert.deepEqual([base.cloud.portfolio.revision, base.cloud.watchlist.revision, base.cloud.preferences.revision], [2, 2, 1]);
  assert.equal(mutateDisposableTestPreference(storage).ok, true);
  assert.equal(await sync.flushNamespace('preferences'), 'complete');
  assert.deepEqual([base.cloud.portfolio.revision, base.cloud.watchlist.revision, base.cloud.preferences.revision], [2, 2, 2]);
  assert.deepEqual(diagnostics.snapshot(), {
    cloudSelectCount: 0,
    casAttemptCount: 3,
    verifiedCasSuccessCount: 3,
    networkRetryCount: 0,
    conflictCount: 0,
    pullCount: 0,
    mutationEventCount: 3,
  });
  sync.dispose();
  assert.equal(durableMutationListenerCount(), 0);
});

test('burst mutations coalesce to one final cloud CAS', async () => {
  const { storage, base } = await preparedDevice();
  const diagnostics = createSyncTestDiagnostics();
  const sync = makeCoordinator(storage, base, diagnostics);
  sync.attachMutationEvents();
  assert.deepEqual(mutateDisposableTestPortfolio(storage, 'A', 5, now), { ok: true, version: 6 });
  assert.equal(await sync.flushNamespace('portfolio'), 'complete');
  assert.equal(base.updateCalls.length, 1);
  assert.match(base.cloud.portfolio.payload.data[0].notes, /Portfolio v6 \| Device A/);
  assert.equal(diagnostics.snapshot().mutationEventCount, 5);
  assert.equal(diagnostics.snapshot().verifiedCasSuccessCount, 1);
  sync.dispose();
});

test('offline wrapper is Stage 5-only, retries are bounded, and deliberate Sync Now recovers safely', async () => {
  const { storage, base } = await preparedDevice();
  const transport = createDevelopmentSyncTestTransport(base);
  const diagnostics = createSyncTestDiagnostics();
  const sync = makeCoordinator(storage, transport, diagnostics);
  sync.attachMutationEvents();
  transport.setOffline(true);
  assert.equal(mutateDisposableTestWatchlist(storage, 'B', now).ok, true);
  const localBefore = readCanonicalLocalState(storage).value.documents.watchlist.payload.data[0].note;
  assert.equal(await sync.flushNamespace('watchlist'), 'retry_later');
  assert.equal(base.cloud.watchlist.revision, 1);
  assert.equal(sync.getMetadata().namespaces.watchlist.cloudRevision, 1);
  assert.equal(sync.getSnapshot().namespaces.watchlist, 'offline');
  assert.equal(diagnostics.snapshot().casAttemptCount, 3);
  assert.equal(diagnostics.snapshot().networkRetryCount, 2);

  transport.setOffline(false);
  assert.equal(base.cloud.watchlist.revision, 1, 'resuming transport must not start synchronization');
  const recovered = await sync.syncNow();
  assert.equal(recovered.namespaces.watchlist.classification, 'LOCAL_AHEAD');
  assert.equal(recovered.namespaces.watchlist.outcome, 'pushed');
  assert.equal(base.cloud.watchlist.revision, 2);
  assert.equal(base.cloud.watchlist.payload.data[0].note, localBefore);
  sync.dispose();
});

test('divergent device edits become conflict without overwriting either winner, while another namespace continues', async () => {
  const { storage, base } = await preparedDevice();
  const transport = createDevelopmentSyncTestTransport(base);
  const diagnostics = createSyncTestDiagnostics();
  const sync = makeCoordinator(storage, transport, diagnostics);
  sync.attachMutationEvents();

  transport.setOffline(true);
  assert.equal(mutateDisposableTestPortfolio(storage, 'B', 1, now).ok, true);
  await sync.flushNamespace('portfolio');
  const deviceBLocal = storage.getItem(PORTFOLIO_STORAGE_KEY);
  base.cloud.portfolio.payload.data[0].notes = `${CLOUD_SYNC_TEST_NOTE} | Portfolio v2 | Device A`;
  base.cloud.portfolio.payload.data[0].updatedAt = now.toISOString();
  base.cloud.portfolio.revision = 2;
  const deviceACloud = clone(base.cloud.portfolio);

  transport.setOffline(false);
  const result = await sync.syncNow();
  assert.equal(result.namespaces.portfolio.classification, 'BOTH_CHANGED');
  assert.equal(result.namespaces.portfolio.outcome, 'conflict');
  assert.deepEqual(base.cloud.portfolio, deviceACloud);
  assert.equal(storage.getItem(PORTFOLIO_STORAGE_KEY), deviceBLocal);
  assert.equal(sync.getSnapshot().namespaces.portfolio, 'conflict');

  assert.equal(mutateDisposableTestWatchlist(storage, 'B', now).ok, true);
  assert.equal(await sync.flushNamespace('watchlist'), 'complete');
  assert.equal(base.cloud.watchlist.revision, 2);
  assert.equal(sync.getSnapshot().namespaces.watchlist, 'synced');
  assert.equal(sync.getSnapshot().overall, 'conflict_needs_attention');
  sync.dispose();
});

test('account change invalidates an in-flight response and leaves local data and verified metadata unadvanced', async () => {
  const { storage, base } = await preparedDevice();
  const diagnostics = createSyncTestDiagnostics();
  const sync = makeCoordinator(storage, base, diagnostics);
  sync.attachMutationEvents();
  let release;
  let started;
  const startedPromise = new Promise(resolve => { started = resolve; });
  const releasePromise = new Promise(resolve => { release = resolve; });
  base.beforeNextUpdate = async () => { started(); await releasePromise; };
  assert.equal(mutateDisposableTestPortfolio(storage, 'B', 1, now).ok, true);
  const localBefore = storage.getItem(PORTFOLIO_STORAGE_KEY);
  const flushing = sync.flushNamespace('portfolio');
  await startedPromise;
  sync.setAuthenticatedUser(otherUserId);
  release();
  assert.equal(await flushing, 'blocked');
  assert.equal(storage.getItem(PORTFOLIO_STORAGE_KEY), localBefore);
  assert.equal(readOngoingSyncMetadata(storage, userId).metadata.namespaces.portfolio.cloudRevision, 1);
  assert.equal(await sync.flushNamespace('watchlist'), 'blocked');
  sync.dispose();
});

test('development harness is Account-only, lazy, inert before enable, and production build guard covers every marker', async () => {
  const [account, harness, app, buildReport, envExample, migrations] = await Promise.all([
    readFile(path.join(root, 'src/components/AccountControl.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/CloudSyncTestHarness.tsx'), 'utf8'),
    readFile(path.join(root, 'src/App.tsx'), 'utf8'),
    readFile(path.join(root, 'scripts/build-report.mjs'), 'utf8'),
    readFile(path.join(root, '.env.example'), 'utf8'),
    readdir(path.join(root, 'supabase/migrations')),
  ]);
  assert.match(account, /import\.meta\.env\.DEV[\s\S]*?lazy\(\(\) => import\('\.\/CloudSyncTestHarness'\)\)/);
  assert.match(account, /VITE_CLOUD_SYNC_TEST_MODE === 'true'/);
  assert.match(account, /user\.email\?\.trim\(\)\.toLowerCase\(\) === cloudSyncTestConfiguredEmail/);
  assert.match(account, /cloudSyncTestModeEnabled[\s\S]*?DevCloudSyncTestHarness/);
  assert.match(harness, /enableDisposableSyncTest[\s\S]*?createDormantLocalFirstSyncCoordinator[\s\S]*?attachMutationEvents/);
  assert.doesNotMatch(app, /CloudSyncTestHarness|Sync Test Harness|VITE_CLOUD_SYNC_TEST/);
  assert.doesNotMatch(harness, /setInterval|\.channel\s*\(|\.delete\s*\(/);
  for (const marker of ['Sync Test Harness', 'Enable Test Sync', 'Pause Test Network', 'Mutate Test Portfolio', 'Mutate Test Watchlist', 'Mutate Test Preferences', 'stage5b-exact-test-email-allow-list', 'VITE_CLOUD_SYNC_TEST_MODE', 'VITE_CLOUD_SYNC_TEST_EMAIL']) {
    assert.ok(buildReport.includes(marker));
  }
  assert.equal(envExample, 'VITE_SUPABASE_URL=\nVITE_SUPABASE_PUBLISHABLE_KEY=\nVITE_CLOUD_MIGRATION_TEST_MODE=false\nVITE_CLOUD_SYNC_TEST_MODE=false\nVITE_CLOUD_SYNC_TEST_EMAIL=\n');
  assert.deepEqual(migrations, ['20260820154219_create_user_state.sql']);
});

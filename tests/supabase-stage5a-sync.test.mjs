import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVerifiedSyncMetadata } from '../src/lib/cloudState/accountMigration.ts';
import {
  createDormantLocalFirstSyncCoordinator,
} from '../src/lib/cloudState/syncCoordinator.ts';
import {
  createEligibleOngoingSyncMetadata,
  enableEligibleOngoingSync,
  readOngoingSyncMetadata,
  SYNC_ENGINE_METADATA_KEY,
  writeOngoingSyncMetadata,
} from '../src/lib/cloudState/syncEngineMetadata.ts';
import {
  durableMutationListenerCount,
  subscribeToDurableMutations,
} from '../src/lib/cloudState/syncEvents.ts';
import {
  fingerprintCloudState,
  fingerprintInitialization,
  fingerprintNamespaceDocument,
} from '../src/lib/cloudState/syncFingerprint.ts';
import { safelyPullCloudNamespace } from '../src/lib/cloudState/syncPull.ts';
import { SyncNamespaceQueue } from '../src/lib/cloudState/syncQueue.ts';
import { reconcileNamespace } from '../src/lib/cloudState/syncReconciler.ts';
import { readCanonicalLocalState } from '../src/lib/cloudState/localState.ts';
import { canonicalJsonSerialize } from '../src/lib/cloudState/stateComparison.ts';
import { persistShowNominalYield } from '../src/lib/optionTablePreferences.ts';
import { persistPortfolioMarkBasis } from '../src/lib/portfolioMarkPreference.ts';
import {
  migratePortfolioState,
  PORTFOLIO_STORAGE_KEY,
  readPortfolioTrades,
  writePortfolioTrades,
} from '../src/lib/portfolioStorage.ts';
import { THEME_STORAGE_KEY } from '../src/lib/themePreference.ts';
import {
  readWatchlist,
  WATCHLIST_STORAGE_KEY,
  writeWatchlist,
} from '../src/lib/watchlist.ts';
import { applyPutScannerBackup, createPutScannerBackup, serializePutScannerBackup } from '../src/lib/userDataBackup.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userId = '55555555-5555-4555-8555-555555555555';
const otherUserId = '66666666-6666-4666-8666-666666666666';
const now = new Date('2026-08-22T12:00:00.000Z');

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
    this.writes = [];
    this.removes = [];
    this.failOnceOnKey = null;
    this.failed = false;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (key === this.failOnceOnKey && !this.failed) {
      this.failed = true;
      throw new Error('injected write failure');
    }
    this.values.set(key, String(value));
    this.writes.push([key, String(value)]);
  }

  removeItem(key) {
    this.values.delete(key);
    this.removes.push(key);
  }
}

const trade = (id = 'trade-1', overrides = {}) => ({
  id,
  ticker: 'TQQQ',
  optionType: 'put',
  strike: 50,
  expiration: '2026-10-16',
  contracts: 2,
  soldPrice: 1.25,
  soldDate: '2026-08-13',
  status: 'open',
  notes: 'durable note',
  createdAt: '2026-08-13T12:00:00.000Z',
  updatedAt: '2026-08-13T12:00:00.000Z',
  ...overrides,
});

const watch = (ticker = 'TQQQ', strike = 50, overrides = {}) => ({
  id: `${ticker}|put|2026-10-16|${strike}`,
  ticker,
  expiry: '2026-10-16',
  expiryTimestamp: 1_792_108_800,
  expiryFormatted: "Oct 16 '26",
  strike,
  optionType: 'put',
  addedAt: 1_765_627_200_000,
  savedAt: 1_765_627_200_000,
  note: 'durable note',
  ...overrides,
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cloudFromDocuments(documents, revisions = { portfolio: 5, watchlist: 5, preferences: 5 }) {
  return Object.fromEntries(['portfolio', 'watchlist', 'preferences'].map(namespace => [namespace, {
    userId,
    namespace,
    schemaVersion: 1,
    payload: clone(documents[namespace].payload),
    revision: revisions[namespace],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }]));
}

function associatedDevice() {
  const storage = new MemoryStorage();
  assert.equal(writePortfolioTrades(storage, [trade()], { now }).status, 'ok');
  assert.equal(writeWatchlist(storage, [watch()], { now }).status, 'ok');
  storage.setItem(THEME_STORAGE_KEY, 'sepia');
  persistPortfolioMarkBasis('bid', storage);
  persistShowNominalYield(true, storage);
  const local = readCanonicalLocalState(storage);
  assert.equal(local.status, 'ok');
  const cloud = cloudFromDocuments(local.value.documents);
  const stage4 = createVerifiedSyncMetadata(userId, cloud, local.value, now);
  const eligible = createEligibleOngoingSyncMetadata(userId, stage4, local.value, cloud, now);
  assert.equal(eligible.ok, true);
  const enabled = enableEligibleOngoingSync(eligible.metadata);
  assert.equal(writeOngoingSyncMetadata(storage, enabled).status, 'ok');
  storage.writes.length = 0;
  storage.removes.length = 0;
  return { storage, local: local.value, cloud, metadata: enabled };
}

function cloudError(code, namespace) {
  return {
    ok: false,
    error: {
      code,
      operation: namespace ? 'update_namespace' : 'fetch_all',
      message: code,
      ...(namespace ? { namespace } : {}),
    },
  };
}

class MockTransport {
  constructor(cloud) {
    this.cloud = clone(cloud);
    this.fetchCalls = 0;
    this.updateCalls = [];
    this.active = { portfolio: 0, watchlist: 0, preferences: 0 };
    this.maxActive = { portfolio: 0, watchlist: 0, preferences: 0 };
    this.behaviors = { portfolio: [], watchlist: [], preferences: [] };
  }

  async fetchAllUserState() {
    this.fetchCalls += 1;
    return this.cloud
      ? { ok: true, value: { status: 'complete', state: clone(this.cloud) } }
      : { ok: true, value: { status: 'empty' } };
  }

  async updateNamespaceIfRevisionMatches(namespace, expectedRevision, schemaVersion, payload) {
    this.updateCalls.push({ namespace, expectedRevision, schemaVersion, payload: clone(payload) });
    this.active[namespace] += 1;
    this.maxActive[namespace] = Math.max(this.maxActive[namespace], this.active[namespace]);
    try {
      const behavior = this.behaviors[namespace].shift();
      if (behavior) {
        const result = await behavior({ namespace, expectedRevision, schemaVersion, payload: clone(payload) });
        if (result) return result;
      }
      const row = this.cloud?.[namespace];
      if (!row || row.revision !== expectedRevision) return cloudError('conflict', namespace);
      row.schemaVersion = schemaVersion;
      row.payload = clone(payload);
      row.revision += 1;
      row.updatedAt = now.toISOString();
      return { ok: true, value: clone(row) };
    } finally {
      this.active[namespace] -= 1;
    }
  }
}

function coordinator(device, transport, overrides = {}) {
  return createDormantLocalFirstSyncCoordinator({
    userId,
    client: transport,
    storage: device.storage,
    debounceMs: 60_000,
    retryDelaysMs: [],
    now: () => now,
    delay: async () => {},
    ...overrides,
  });
}

function deferred() {
  let resolve;
  const promise = new Promise(res => { resolve = res; });
  return { promise, resolve };
}

test('fingerprints ignore object key order and undefined optional properties', () => {
  const first = { schemaVersion: 1, payload: { data: { theme: 'sepia', showNominalYield: true } } };
  const second = { payload: { data: { showNominalYield: true, ignored: undefined, theme: 'sepia' } }, schemaVersion: 1 };
  assert.equal(fingerprintNamespaceDocument(first), fingerprintNamespaceDocument(second));
  assert.equal(canonicalJsonSerialize(first), canonicalJsonSerialize(second));
});

test('fingerprints distinguish semantic changes across all three namespaces and empty arrays', () => {
  const empty = fingerprintNamespaceDocument({ schemaVersion: 1, payload: { data: [] } });
  assert.notEqual(empty, fingerprintNamespaceDocument({ schemaVersion: 1, payload: { data: [trade()] } }));
  assert.notEqual(
    fingerprintNamespaceDocument({ schemaVersion: 1, payload: { data: [trade()] } }),
    fingerprintNamespaceDocument({ schemaVersion: 1, payload: { data: [trade('trade-2', { status: 'closed' })] } }),
  );
  assert.notEqual(
    fingerprintNamespaceDocument({ schemaVersion: 1, payload: { data: [watch()] } }),
    fingerprintNamespaceDocument({ schemaVersion: 1, payload: { data: [watch('SQQQ', 40)] } }),
  );
  assert.notEqual(
    fingerprintNamespaceDocument({ schemaVersion: 1, payload: { data: { theme: 'dark' } } }),
    fingerprintNamespaceDocument({ schemaVersion: 1, payload: { data: { theme: 'light' } } }),
  );
});

test('fingerprints use Stage 1.5 normalization for legacy Portfolio and history combinations', () => {
  const legacy = [trade(), trade('history-1', { status: 'closed', closePrice: 0.2, closeDate: '2026-08-20' })];
  const first = migratePortfolioState(0, legacy);
  const second = migratePortfolioState(1, clone(first.state.data));
  assert.equal(first.status, 'ok');
  assert.equal(second.status, 'ok');
  assert.equal(
    fingerprintNamespaceDocument({ schemaVersion: 1, payload: { data: first.state.data } }),
    fingerprintNamespaceDocument({ schemaVersion: 1, payload: { data: second.state.data } }),
  );
});

test('verified Stage 4 metadata is required before a device becomes eligible, and enablement is explicit', () => {
  const device = associatedDevice();
  assert.equal(device.metadata.syncMode, 'enabled');
  const invalidStage4 = createVerifiedSyncMetadata(userId, device.cloud, device.local, now);
  invalidStage4.migrationState = 'not_checked';
  assert.equal(createEligibleOngoingSyncMetadata(userId, invalidStage4, device.local, device.cloud, now).ok, false);
  assert.equal(createEligibleOngoingSyncMetadata(otherUserId, createVerifiedSyncMetadata(userId, device.cloud, device.local, now), device.local, device.cloud, now).ok, false);
  const wrongOwnerCloud = clone(device.cloud);
  wrongOwnerCloud.preferences.userId = otherUserId;
  assert.equal(createEligibleOngoingSyncMetadata(userId, createVerifiedSyncMetadata(userId, device.cloud, device.local, now), device.local, wrongOwnerCloud, now).ok, false);
});

test('durable mutation events are narrow and exclude transient market refreshes', () => {
  assert.equal(durableMutationListenerCount(), 0);
  const events = [];
  const unsubscribe = subscribeToDurableMutations(event => events.push(event.namespace));
  const storage = new MemoryStorage();
  writePortfolioTrades(storage, [trade()], { now });
  const portfolio = readPortfolioTrades(storage);
  writePortfolioTrades(storage, [{ ...portfolio.data[0], latestMarketData: { optionBid: 1.1 } }], { now });
  writeWatchlist(storage, [watch()], { now });
  const watchlist = readWatchlist(storage);
  writeWatchlist(storage, [{ ...watchlist.data[0], snapshot: { bid: 1.2 }, status: 'live' }], { now });
  persistPortfolioMarkBasis('bid', storage);
  persistPortfolioMarkBasis('bid', storage);
  unsubscribe();
  assert.deepEqual(events, ['portfolio', 'watchlist', 'preferences']);
  assert.equal(durableMutationListenerCount(), 0);
});

test('a successful explicit JSON import emits each changed durable namespace once', () => {
  const source = associatedDevice();
  const backup = createPutScannerBackup(source.storage, { now });
  const target = new MemoryStorage();
  const events = [];
  const unsubscribe = subscribeToDurableMutations(event => events.push(event.namespace));
  applyPutScannerBackup(target, backup);
  unsubscribe();
  assert.deepEqual(events, ['portfolio', 'watchlist', 'preferences']);
});

test('queue coalesces rapid mutations and permits only one operation in flight', async () => {
  const gate = deferred();
  let calls = 0;
  let active = 0;
  let maxActive = 0;
  const queue = new SyncNamespaceQueue({
    debounceMs: 60_000,
    run: async () => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await gate.promise;
      active -= 1;
      return 'complete';
    },
  });
  for (let index = 0; index < 5; index += 1) queue.markMutation();
  const first = queue.flush();
  queue.markMutation();
  queue.markMutation();
  gate.resolve();
  await first;
  assert.equal(calls, 2);
  assert.equal(maxActive, 1);
  queue.dispose();
});

test('different namespace queues run independently', async () => {
  const gate = deferred();
  let portfolioDone = false;
  let watchlistDone = false;
  const portfolioQueue = new SyncNamespaceQueue({ debounceMs: 60_000, run: async () => {
    await gate.promise;
    portfolioDone = true;
    return 'complete';
  } });
  const watchlistQueue = new SyncNamespaceQueue({ debounceMs: 60_000, run: async () => {
    watchlistDone = true;
    return 'complete';
  } });
  portfolioQueue.markMutation();
  watchlistQueue.markMutation();
  const portfolioFlush = portfolioQueue.flush();
  await watchlistQueue.flush();
  assert.equal(watchlistDone, true);
  assert.equal(portfolioDone, false);
  gate.resolve();
  await portfolioFlush;
  portfolioQueue.dispose();
  watchlistQueue.dispose();
});

test('CAS success advances revision and metadata only after verified response', async () => {
  const device = associatedDevice();
  const transport = new MockTransport(device.cloud);
  const sync = coordinator(device, transport);
  sync.attachMutationEvents();
  writePortfolioTrades(device.storage, [trade('trade-1', { notes: 'edited locally' })], { now });
  await sync.flushNamespace('portfolio');
  assert.equal(transport.updateCalls.length, 1);
  assert.equal(transport.updateCalls[0].expectedRevision, 5);
  assert.equal(transport.cloud.portfolio.revision, 6);
  assert.equal(sync.getMetadata().namespaces.portfolio.cloudRevision, 6);
  assert.equal(sync.getSnapshot().namespaces.portfolio, 'synced');
  sync.dispose();
});

test('Sync Now cannot overlap an event-driven write for the same namespace', async () => {
  const device = associatedDevice();
  const transport = new MockTransport(device.cloud);
  const started = deferred();
  const release = deferred();
  transport.behaviors.portfolio.push(async ({ schemaVersion, payload }) => {
    started.resolve();
    await release.promise;
    const row = transport.cloud.portfolio;
    row.schemaVersion = schemaVersion;
    row.payload = clone(payload);
    row.revision = 6;
    return { ok: true, value: clone(row) };
  });
  const sync = coordinator(device, transport);
  sync.attachMutationEvents();
  writePortfolioTrades(device.storage, [trade('trade-1', { notes: 'one local edit' })], { now });
  const eventFlush = sync.flushNamespace('portfolio');
  await started.promise;
  const manualSync = sync.syncNow();
  await Promise.resolve();
  assert.equal(transport.updateCalls.length, 1);
  release.resolve();
  await Promise.all([eventFlush, manualSync]);
  assert.equal(transport.updateCalls.length, 1);
  assert.equal(transport.maxActive.portfolio, 1);
  assert.equal(sync.getMetadata().namespaces.portfolio.cloudRevision, 6);
  sync.dispose();
});

test('a mismatched returned payload cannot advance verified metadata', async () => {
  const device = associatedDevice();
  const transport = new MockTransport(device.cloud);
  transport.behaviors.portfolio.push(async () => {
    const mismatched = clone(transport.cloud.portfolio);
    mismatched.revision = 6;
    mismatched.payload.data[0].notes = 'unexpected response';
    return { ok: true, value: mismatched };
  });
  const sync = coordinator(device, transport);
  sync.attachMutationEvents();
  writePortfolioTrades(device.storage, [trade('trade-1', { notes: 'intended local' })], { now });
  assert.equal(await sync.flushNamespace('portfolio'), 'blocked');
  assert.equal(sync.getMetadata().namespaces.portfolio.cloudRevision, 5);
  assert.equal(sync.getSnapshot().namespaces.portfolio, 'attention');
  sync.dispose();
});

test('local mutation during an in-flight write queues the latest fingerprint at the new revision', async () => {
  const device = associatedDevice();
  const transport = new MockTransport(device.cloud);
  const started = deferred();
  const release = deferred();
  transport.behaviors.portfolio.push(async ({ expectedRevision, schemaVersion, payload }) => {
    started.resolve();
    await release.promise;
    const row = transport.cloud.portfolio;
    assert.equal(expectedRevision, 5);
    row.schemaVersion = schemaVersion;
    row.payload = clone(payload);
    row.revision = 6;
    return { ok: true, value: clone(row) };
  });
  const sync = coordinator(device, transport);
  sync.attachMutationEvents();
  writePortfolioTrades(device.storage, [trade('trade-1', { notes: 'A' })], { now });
  const flushing = sync.flushNamespace('portfolio');
  await started.promise;
  writePortfolioTrades(device.storage, [trade('trade-1', { notes: 'B' })], { now });
  release.resolve();
  await flushing;
  assert.equal(transport.updateCalls.length, 2);
  assert.deepEqual(transport.updateCalls.map(call => call.expectedRevision), [5, 6]);
  assert.equal(transport.cloud.portfolio.revision, 7);
  assert.equal(transport.cloud.portfolio.payload.data[0].notes, 'B');
  assert.equal(sync.getMetadata().namespaces.portfolio.cloudRevision, 7);
  sync.dispose();
});

test('rapid local mutations coalesce to one final cloud payload', async () => {
  const device = associatedDevice();
  const transport = new MockTransport(device.cloud);
  const sync = coordinator(device, transport);
  sync.attachMutationEvents();
  for (let index = 0; index < 5; index += 1) {
    writePortfolioTrades(device.storage, [trade('trade-1', { notes: `edit-${index}` })], { now });
  }
  await sync.flushNamespace('portfolio');
  assert.equal(transport.updateCalls.length, 1);
  assert.equal(transport.cloud.portfolio.payload.data[0].notes, 'edit-4');
  sync.dispose();
});

test('CAS conflict freezes only that namespace and never retries or overwrites cloud', async () => {
  const device = associatedDevice();
  const transport = new MockTransport(device.cloud);
  transport.cloud.portfolio.revision = 6;
  transport.cloud.portfolio.payload.data[0].notes = 'Device A cloud';
  const sync = coordinator(device, transport);
  sync.attachMutationEvents();
  writePortfolioTrades(device.storage, [trade('trade-1', { notes: 'Device B local' })], { now });
  const localBefore = device.storage.getItem(PORTFOLIO_STORAGE_KEY);
  await sync.flushNamespace('portfolio');
  assert.equal(transport.updateCalls.length, 1);
  assert.equal(transport.cloud.portfolio.revision, 6);
  assert.equal(transport.cloud.portfolio.payload.data[0].notes, 'Device A cloud');
  assert.equal(device.storage.getItem(PORTFOLIO_STORAGE_KEY), localBefore);
  assert.equal(sync.getSnapshot().namespaces.portfolio, 'conflict');
  assert.equal(sync.getSnapshot().namespaces.watchlist, 'synced');
  sync.dispose();
});

test('network retries are capped, preserve local data, and do not advance revision metadata', async () => {
  const device = associatedDevice();
  const transport = new MockTransport(device.cloud);
  transport.behaviors.portfolio.push(
    async () => cloudError('network_error', 'portfolio'),
    async () => cloudError('network_error', 'portfolio'),
    async () => cloudError('network_error', 'portfolio'),
  );
  const sync = coordinator(device, transport, { retryDelaysMs: [0, 0] });
  sync.attachMutationEvents();
  writePortfolioTrades(device.storage, [trade('trade-1', { notes: 'offline edit' })], { now });
  const localBefore = device.storage.getItem(PORTFOLIO_STORAGE_KEY);
  assert.equal(await sync.flushNamespace('portfolio'), 'retry_later');
  assert.equal(transport.updateCalls.length, 3);
  assert.equal(sync.getMetadata().namespaces.portfolio.cloudRevision, 5);
  assert.equal(sync.getSnapshot().namespaces.portfolio, 'offline');
  assert.equal(device.storage.getItem(PORTFOLIO_STORAGE_KEY), localBefore);
  writePortfolioTrades(device.storage, [trade('trade-1', { notes: 'next real mutation' })], { now });
  assert.equal(await sync.flushNamespace('portfolio'), 'complete');
  assert.equal(transport.updateCalls.length, 4);
  assert.equal(sync.getMetadata().namespaces.portfolio.cloudRevision, 6);
  assert.equal(transport.cloud.portfolio.payload.data[0].notes, 'next real mutation');
  sync.dispose();
});

test('a stale write response after sign-out or account switch cannot update metadata', async () => {
  const device = associatedDevice();
  const transport = new MockTransport(device.cloud);
  const started = deferred();
  const release = deferred();
  transport.behaviors.portfolio.push(async ({ schemaVersion, payload }) => {
    started.resolve();
    await release.promise;
    const row = transport.cloud.portfolio;
    row.schemaVersion = schemaVersion;
    row.payload = clone(payload);
    row.revision = 6;
    return { ok: true, value: clone(row) };
  });
  const sync = coordinator(device, transport);
  sync.attachMutationEvents();
  writePortfolioTrades(device.storage, [trade('trade-1', { notes: 'pending A' })], { now });
  const flushing = sync.flushNamespace('portfolio');
  await started.promise;
  const metadataBeforeSwitch = device.storage.getItem(SYNC_ENGINE_METADATA_KEY);
  sync.setAuthenticatedUser(otherUserId);
  release.resolve();
  await flushing;
  assert.equal(device.storage.getItem(SYNC_ENGINE_METADATA_KEY), metadataBeforeSwitch);
  assert.equal(sync.getSnapshot().overall, 'attention');
  sync.dispose();
});

test('account switching blocks reads and writes without clearing local data', async () => {
  const device = associatedDevice();
  const transport = new MockTransport(device.cloud);
  const sync = coordinator(device, transport);
  const localBefore = device.storage.getItem(PORTFOLIO_STORAGE_KEY);
  sync.setAuthenticatedUser(otherUserId);
  const result = await sync.syncNow();
  assert.equal(result.namespaces.portfolio.classification, 'ACCOUNT_MISMATCH');
  assert.equal(transport.fetchCalls, 0);
  assert.equal(transport.updateCalls.length, 0);
  assert.equal(device.storage.getItem(PORTFOLIO_STORAGE_KEY), localBefore);
  sync.dispose();
});

test('preexisting metadata for another account and an unassociated browser both make zero cloud calls', async () => {
  const device = associatedDevice();
  const transport = new MockTransport(device.cloud);
  const mismatch = createDormantLocalFirstSyncCoordinator({
    userId: otherUserId,
    client: transport,
    storage: device.storage,
  });
  const mismatchedResult = await mismatch.syncNow();
  assert.equal(mismatchedResult.namespaces.portfolio.classification, 'ACCOUNT_MISMATCH');
  assert.equal(mismatchedResult.overall, 'attention');
  mismatch.dispose();

  const cleanStorage = new MemoryStorage();
  const unassociated = createDormantLocalFirstSyncCoordinator({
    userId,
    client: transport,
    storage: cleanStorage,
  });
  const unassociatedResult = await unassociated.syncNow();
  assert.equal(unassociatedResult.overall, 'disabled');
  assert.equal(transport.fetchCalls, 0);
  assert.equal(transport.updateCalls.length, 0);
  assert.equal(cleanStorage.writes.length, 0);
  unassociated.dispose();
});

test('pure reconciliation classifies clean, local ahead, cloud ahead, both changed, missing, invalid, and mismatch', () => {
  const baseline = fingerprintNamespaceDocument({ schemaVersion: 1, payload: { data: [] } });
  const changed = fingerprintNamespaceDocument({ schemaVersion: 1, payload: { data: [watch()] } });
  const classify = overrides => reconcileNamespace({
    accountMatches: true,
    localFingerprint: baseline,
    lastSyncedFingerprint: baseline,
    knownCloudRevision: 5,
    cloud: { status: 'ok', revision: 5, fingerprint: baseline },
    ...overrides,
  }).classification;
  assert.equal(classify({}), 'CLEAN');
  assert.equal(classify({ localFingerprint: changed }), 'LOCAL_AHEAD');
  assert.equal(classify({ cloud: { status: 'ok', revision: 6, fingerprint: changed } }), 'CLOUD_AHEAD');
  assert.equal(classify({ localFingerprint: changed, cloud: { status: 'ok', revision: 6, fingerprint: changed } }), 'BOTH_CHANGED');
  assert.equal(classify({ cloud: { status: 'missing' } }), 'CLOUD_MISSING');
  assert.equal(classify({ cloud: { status: 'invalid' } }), 'INVALID');
  assert.equal(classify({ accountMatches: false }), 'ACCOUNT_MISMATCH');
  assert.equal(classify({ cloud: { status: 'ok', revision: 5, fingerprint: changed } }), 'INVALID');
});

test('safe cloud pull runs only from a clean baseline and verifies the new local fingerprint', () => {
  const device = associatedDevice();
  const fingerprints = fingerprintInitialization(device.local.documents);
  const row = clone(device.cloud.portfolio);
  row.revision = 6;
  row.payload.data[0].notes = 'newer cloud';
  const pulled = safelyPullCloudNamespace(device.storage, userId, row, fingerprints.portfolio, { now });
  assert.equal(pulled.ok, true);
  assert.equal(readPortfolioTrades(device.storage).data[0].notes, 'newer cloud');
  assert.equal(pulled.fingerprint, fingerprintNamespaceDocument(row));
});

test('safe pull stops before overwrite when local changes during reconciliation', () => {
  const device = associatedDevice();
  const fingerprints = fingerprintInitialization(device.local.documents);
  const row = clone(device.cloud.portfolio);
  row.revision = 6;
  row.payload.data[0].notes = 'newer cloud';
  const pulled = safelyPullCloudNamespace(device.storage, userId, row, fingerprints.portfolio, {
    now,
    beforeCommit: () => {
      writePortfolioTrades(device.storage, [trade('trade-1', { notes: 'newer local' })], { now });
    },
  });
  assert.equal(pulled.ok, false);
  assert.equal(pulled.code, 'local_changed');
  assert.equal(readPortfolioTrades(device.storage).data[0].notes, 'newer local');
});

test('safe pull rolls every durable key back after a local write or verification failure', () => {
  for (const failureMode of ['write', 'verify']) {
    const device = associatedDevice();
    const fingerprints = fingerprintInitialization(device.local.documents);
    const row = clone(device.cloud.portfolio);
    row.revision = 6;
    row.payload.data[0].notes = 'newer cloud';
    const before = Object.fromEntries(device.storage.values);
    if (failureMode === 'write') device.storage.failOnceOnKey = PORTFOLIO_STORAGE_KEY;
    const pulled = safelyPullCloudNamespace(device.storage, userId, row, fingerprints.portfolio, {
      now,
      forceVerificationMismatch: failureMode === 'verify',
    });
    assert.equal(pulled.ok, false);
    assert.deepEqual(Object.fromEntries(device.storage.values), before);
  }
});

test('Sync Now ignores clean state, pushes local ahead, pulls cloud ahead, and blocks both changed', async () => {
  const device = associatedDevice();
  const transport = new MockTransport(device.cloud);
  writePortfolioTrades(device.storage, [trade('trade-1', { notes: 'local ahead' })], { now });
  transport.cloud.watchlist.revision = 6;
  transport.cloud.watchlist.payload.data[0].note = 'cloud ahead';
  transport.cloud.preferences.revision = 6;
  transport.cloud.preferences.payload.data.theme = 'light';
  persistShowNominalYield(false, device.storage);
  const sync = coordinator(device, transport);
  const result = await sync.syncNow();
  assert.equal(result.namespaces.portfolio.outcome, 'pushed');
  assert.equal(result.namespaces.watchlist.outcome, 'pulled');
  assert.equal(result.namespaces.preferences.outcome, 'conflict');
  assert.equal(transport.cloud.portfolio.revision, 6);
  assert.equal(readWatchlist(device.storage).data[0].note, 'cloud ahead');
  assert.equal(device.storage.getItem(THEME_STORAGE_KEY), 'sepia');
  assert.equal(sync.getSnapshot().namespaces.preferences, 'conflict');
  sync.dispose();
});

test('Sync Now treats previously synchronized missing rows and corrupt local state as attention', async () => {
  const missingDevice = associatedDevice();
  const missingTransport = new MockTransport(null);
  const missingSync = coordinator(missingDevice, missingTransport);
  const missing = await missingSync.syncNow();
  assert.equal(missing.namespaces.portfolio.classification, 'CLOUD_MISSING');
  assert.equal(missing.namespaces.portfolio.outcome, 'attention');
  missingSync.dispose();

  const invalidDevice = associatedDevice();
  invalidDevice.storage.values.set(PORTFOLIO_STORAGE_KEY, '{bad json');
  const invalidTransport = new MockTransport(invalidDevice.cloud);
  const invalidSync = coordinator(invalidDevice, invalidTransport);
  const invalid = await invalidSync.syncNow();
  assert.equal(invalid.namespaces.portfolio.classification, 'INVALID');
  assert.equal(invalid.namespaces.portfolio.outcome, 'attention');
  invalidSync.dispose();
});

test('partial namespace failure preserves unrelated successes and reports pending overall state', async () => {
  const device = associatedDevice();
  const transport = new MockTransport(device.cloud);
  const sync = coordinator(device, transport, { retryDelaysMs: [] });
  sync.attachMutationEvents();
  writePortfolioTrades(device.storage, [trade('trade-1', { notes: 'portfolio edit' })], { now });
  writeWatchlist(device.storage, [watch('TQQQ', 50, { note: 'watch edit' })], { now });
  persistShowNominalYield(false, device.storage);
  transport.behaviors.watchlist.push(async () => cloudError('network_error', 'watchlist'));
  await Promise.all([
    sync.flushNamespace('portfolio'),
    sync.flushNamespace('watchlist'),
    sync.flushNamespace('preferences'),
  ]);
  assert.equal(sync.getMetadata().namespaces.portfolio.cloudRevision, 6);
  assert.equal(sync.getMetadata().namespaces.preferences.cloudRevision, 6);
  assert.equal(sync.getMetadata().namespaces.watchlist.cloudRevision, 5);
  assert.equal(sync.getSnapshot().overall, 'offline_saved_locally');
  sync.dispose();
});

test('normal runtime remains dormant: storage edits and auth/app sources instantiate no coordinator', async () => {
  assert.equal(durableMutationListenerCount(), 0);
  const storage = new MemoryStorage();
  writePortfolioTrades(storage, [trade()], { now });
  writeWatchlist(storage, [watch()], { now });
  persistShowNominalYield(true, storage);
  assert.equal(durableMutationListenerCount(), 0);

  const runtimeFiles = [
    'src/App.tsx',
    'src/main.tsx',
    'src/lib/auth.tsx',
    'src/lib/authActions.ts',
    'src/components/AccountControl.tsx',
    'src/components/AccountDataSection.tsx',
  ];
  for (const relative of runtimeFiles) {
    const source = await readFile(path.join(root, relative), 'utf8');
    assert.doesNotMatch(source, /syncCoordinator|createDormantLocalFirstSyncCoordinator|attachMutationEvents/);
  }

  const cloudFiles = await readdir(path.join(root, 'src/lib/cloudState'));
  assert.ok(cloudFiles.includes('syncCoordinator.ts'));
  assert.ok(cloudFiles.includes('syncEvents.ts'));
  const buildReport = await readFile(path.join(root, 'scripts/build-report.mjs'), 'utf8');
  assert.match(buildReport, /Feature-disabled production bundle excludes sync orchestration and the Stage 5 engine/);
});

test('engine metadata stores fingerprints and revisions but no raw documents or auth tokens', () => {
  const device = associatedDevice();
  const raw = device.storage.getItem(SYNC_ENGINE_METADATA_KEY);
  const read = readOngoingSyncMetadata(device.storage, userId);
  assert.equal(read.status, 'ok');
  assert.match(raw, /fnv1a64:[0-9a-f]{16}/);
  assert.doesNotMatch(raw, /TQQQ|durable note|access_token|refresh_token/);
  assert.deepEqual(fingerprintCloudState(device.cloud), fingerprintInitialization(device.local.documents));
});

test('ongoing sync metadata remains excluded from the unchanged JSON backup format', () => {
  const device = associatedDevice();
  const serialized = serializePutScannerBackup(createPutScannerBackup(device.storage, { now }));
  assert.doesNotMatch(serialized, /put_scanner_cloud_sync_engine|fnv1a64|cloudRevision/);
  assert.deepEqual(Object.keys(JSON.parse(serialized).data).sort(), ['portfolio', 'preferences', 'watchlist']);
});

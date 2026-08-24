import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVerifiedSyncMetadata } from '../src/lib/cloudState/accountMigration.ts';
import {
  createDisposableLocalSyncTestData,
  mutateDisposableTestPortfolio,
  mutateDisposableTestPreference,
  mutateDisposableTestWatchlist,
} from '../src/lib/cloudState/devSyncFixture.ts';
import { readCanonicalLocalState } from '../src/lib/cloudState/localState.ts';
import {
  createProductionCloudSyncManager,
  prepareProductionSyncEnrollment,
} from '../src/lib/cloudState/productionSyncLifecycle.ts';
import {
  createEligibleOngoingSyncMetadata,
  enableEligibleOngoingSync,
  readOngoingSyncMetadata,
  SYNC_ENGINE_METADATA_KEY,
  writeOngoingSyncMetadata,
} from '../src/lib/cloudState/syncEngineMetadata.ts';
import { LOCAL_SYNC_DEVICE_ID_KEY } from '../src/lib/cloudState/deviceIdentity.ts';
import { durableMutationListenerCount } from '../src/lib/cloudState/syncEvents.ts';
import { writeCloudSyncMetadata } from '../src/lib/cloudState/syncMetadata.ts';
import { readPortfolioTrades, writePortfolioTrades } from '../src/lib/portfolioStorage.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userId = '99999999-9999-4999-8999-999999999999';
const otherUserId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const now = new Date('2026-08-23T12:00:00.000Z');

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
    this.writes = [];
    this.removes = [];
    this.reads = [];
  }
  getItem(key) { this.reads.push(key); return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); this.writes.push([key, String(value)]); }
  removeItem(key) { this.values.delete(key); this.removes.push(key); }
}

function clone(value) {
  return structuredClone(value);
}

function storageEntries(storage) {
  return Object.fromEntries(storage.values);
}

function durableDataEntries(storage) {
  return Object.fromEntries([...storage.values].filter(([key]) => key !== SYNC_ENGINE_METADATA_KEY));
}

class MockCloudClient {
  constructor(cloud) {
    this.cloud = cloud === null ? null : clone(cloud);
    this.fetchCalls = 0;
    this.updateCalls = [];
    this.fetchError = null;
    this.updateError = null;
    this.beforeUpdate = null;
  }

  async fetchAllUserState() {
    this.fetchCalls += 1;
    if (this.fetchError) return { ok: false, error: clone(this.fetchError) };
    return this.cloud
      ? { ok: true, value: { status: 'complete', state: clone(this.cloud) } }
      : { ok: true, value: { status: 'empty' } };
  }

  async updateNamespaceIfRevisionMatches(namespace, expectedRevision, schemaVersion, payload) {
    this.updateCalls.push({ namespace, expectedRevision, schemaVersion, payload: clone(payload) });
    if (this.beforeUpdate) await this.beforeUpdate();
    if (this.updateError) return { ok: false, error: { ...clone(this.updateError), namespace } };
    const row = this.cloud?.[namespace];
    if (!row || row.revision !== expectedRevision) {
      return { ok: false, error: { code: 'conflict', operation: 'update_namespace', namespace, message: 'conflict' } };
    }
    row.schemaVersion = schemaVersion;
    row.payload = clone(payload);
    row.revision += 1;
    row.updatedAt = now.toISOString();
    return { ok: true, value: clone(row) };
  }
}

function cloudFromDocuments(documents, revisions = { portfolio: 1, watchlist: 1, preferences: 1 }, owner = userId) {
  return Object.fromEntries(Object.entries(documents).map(([namespace, document]) => [namespace, {
    userId: owner,
    namespace,
    schemaVersion: document.schemaVersion,
    payload: clone(document.payload),
    revision: revisions[namespace],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }]));
}

function verifiedDevice({ enabled = false } = {}) {
  const storage = new MemoryStorage();
  assert.equal(createDisposableLocalSyncTestData(storage, now).ok, true);
  const local = readCanonicalLocalState(storage);
  assert.equal(local.status, 'ok');
  const cloud = cloudFromDocuments(local.value.documents);
  assert.equal(writeCloudSyncMetadata(storage, createVerifiedSyncMetadata(userId, cloud, local.value, now)).status, 'ok');
  if (enabled) {
    const eligible = createEligibleOngoingSyncMetadata(
      userId,
      createVerifiedSyncMetadata(userId, cloud, local.value, now),
      local.value,
      cloud,
      now,
    );
    assert.equal(eligible.ok, true);
    assert.equal(writeOngoingSyncMetadata(storage, enableEligibleOngoingSync(eligible.metadata)).status, 'ok');
  }
  storage.writes = [];
  storage.removes = [];
  storage.reads = [];
  return { storage, cloud };
}

function managerFor(storage, client, options = {}) {
  let factoryCalls = 0;
  const manager = createProductionCloudSyncManager({
    featureEnabled: options.featureEnabled ?? true,
    storage,
    clientForUser: () => { factoryCalls += 1; return client; },
    debounceMs: options.debounceMs ?? 0,
    retryDelaysMs: options.retryDelaysMs ?? [0, 0],
    now: () => now,
    delay: async () => {},
  });
  return { manager, factoryCalls: () => factoryCalls };
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail(message);
}

async function startEnabled(options = {}) {
  const device = verifiedDevice({ enabled: true });
  const client = new MockCloudClient(device.cloud);
  if (options.configure) options.configure(device, client);
  const runtime = managerFor(device.storage, client, options.managerOptions);
  await runtime.manager.setAccount(userId, true);
  return { ...device, client, ...runtime };
}

async function stopManager(manager) {
  await manager.setAccount(null, true);
  assert.equal(durableMutationListenerCount(), 0);
}

test('feature gate absent/false, anonymous auth, and unenrolled signed-in devices perform zero cloud operations', async t => {
  for (const flag of [undefined, false]) {
    await t.test(`feature flag ${String(flag)}`, async () => {
      const storage = new MemoryStorage();
      const client = new MockCloudClient(null);
      const { manager, factoryCalls } = managerFor(storage, client, { featureEnabled: flag === true });
      await manager.setAccount(userId, true);
      assert.equal(manager.getSnapshot().phase, 'disabled');
      assert.equal(factoryCalls(), 0);
      assert.equal(client.fetchCalls, 0);
      assert.equal(client.updateCalls.length, 0);
      assert.equal(durableMutationListenerCount(), 0);
    });
  }

  await t.test('flag true and anonymous', async () => {
    const storage = new MemoryStorage();
    const client = new MockCloudClient(null);
    const { manager, factoryCalls } = managerFor(storage, client);
    await manager.setAccount(null, true);
    assert.equal(manager.getSnapshot().phase, 'anonymous');
    assert.equal(factoryCalls(), 0);
    assert.equal(client.fetchCalls, 0);
  });

  await t.test('flag true, signed in, not enrolled', async () => {
    const storage = new MemoryStorage();
    const client = new MockCloudClient(null);
    const { manager, factoryCalls } = managerFor(storage, client);
    await manager.setAccount(userId, true);
    assert.equal(manager.getSnapshot().phase, 'not_enrolled');
    assert.equal(manager.getSnapshot().canEnable, true);
    assert.equal(factoryCalls(), 0);
    assert.equal(client.fetchCalls, 0);
    assert.equal(durableMutationListenerCount(), 0);
  });
});

test('explicit enrollment requires the exact verified Stage 4 baseline and changes only local engine metadata', async t => {
  await t.test('missing Stage 4 verification blocks before cloud access', async () => {
    const storage = new MemoryStorage();
    assert.equal(createDisposableLocalSyncTestData(storage, now).ok, true);
    const local = readCanonicalLocalState(storage);
    const client = new MockCloudClient(cloudFromDocuments(local.value.documents));
    const result = await prepareProductionSyncEnrollment(client, storage, userId, now);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'stage4_missing');
    assert.equal(client.fetchCalls, 0);
  });

  await t.test('local/cloud inequality blocks enrollment', async () => {
    const { storage, cloud } = verifiedDevice();
    cloud.portfolio.payload.data[0].notes = 'different cloud durable value';
    const client = new MockCloudClient(cloud);
    const result = await prepareProductionSyncEnrollment(client, storage, userId, now);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'not_eligible');
    assert.equal(client.fetchCalls, 1);
    assert.equal(client.updateCalls.length, 0);
    assert.equal(storage.getItem(SYNC_ENGINE_METADATA_KEY), null);
  });

  await t.test('fresh equality enables and attaches once without changing user_state payloads', async () => {
    const { storage, cloud } = verifiedDevice();
    const cloudBefore = clone(cloud);
    const durableBefore = storageEntries(storage);
    const client = new MockCloudClient(cloud);
    const { manager } = managerFor(storage, client);
    await manager.setAccount(userId, true);
    const result = await manager.enableOnThisDevice();
    assert.equal(result.ok, true);
    assert.equal(client.fetchCalls, 1);
    assert.equal(client.updateCalls.length, 0);
    assert.deepEqual(client.cloud, cloudBefore);
    assert.equal(readOngoingSyncMetadata(storage, userId).metadata.syncMode, 'enabled');
    const after = storageEntries(storage);
    assert.deepEqual(Object.fromEntries(Object.entries(after).filter(([key]) => (
      key !== SYNC_ENGINE_METADATA_KEY && key !== LOCAL_SYNC_DEVICE_ID_KEY
    ))), durableBefore);
    assert.equal(manager.getSnapshot().phase, 'synced');
    assert.equal(durableMutationListenerCount(), 1);
    await manager.setAccount(userId, true);
    assert.equal(client.fetchCalls, 1, 'duplicate root/account update does not reconstruct or re-read');
    assert.equal(durableMutationListenerCount(), 1);
    await stopManager(manager);
  });
});

test('enabled startup reconciles CLEAN, CLOUD_AHEAD, LOCAL_AHEAD, BOTH_CHANGED, CLOUD_MISSING, INVALID, and account mismatch safely', async t => {
  await t.test('CLEAN reads once and writes no cloud row', async () => {
    const { manager, client } = await startEnabled();
    assert.equal(client.fetchCalls, 1);
    assert.equal(client.updateCalls.length, 0);
    assert.equal(manager.getSnapshot().phase, 'synced');
    assert.equal(durableMutationListenerCount(), 1);
    await stopManager(manager);
  });

  await t.test('CLOUD_AHEAD pulls once without CAS echo', async () => {
    const { manager, client, storage } = await startEnabled({
      configure: (_device, mock) => {
        mock.cloud.preferences.payload.data.showNominalYield = false;
        mock.cloud.preferences.revision = 2;
      },
    });
    const local = readCanonicalLocalState(storage);
    assert.equal(local.value.documents.preferences.payload.data.showNominalYield, false);
    assert.equal(client.fetchCalls, 1);
    assert.equal(client.updateCalls.length, 0);
    assert.equal(client.cloud.preferences.revision, 2);
    assert.equal(manager.getSnapshot().phase, 'synced');
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(client.updateCalls.length, 0, 'cloud hydration emits no user mutation echo');
    await stopManager(manager);
  });

  await t.test('LOCAL_AHEAD performs one revision-checked CAS', async () => {
    const { manager, client } = await startEnabled({
      configure: device => {
        assert.deepEqual(mutateDisposableTestPortfolio(device.storage, 'B', 1, now), { ok: true, version: 2 });
      },
    });
    assert.deepEqual(client.updateCalls.map(call => [call.namespace, call.expectedRevision]), [['portfolio', 1]]);
    assert.equal(client.cloud.portfolio.revision, 2);
    assert.equal(manager.getSnapshot().phase, 'synced');
    await stopManager(manager);
  });

  await t.test('BOTH_CHANGED freezes only the divergent namespace with no winner', async () => {
    let localWinner;
    const { manager, client, storage } = await startEnabled({
      configure: (device, mock) => {
        assert.deepEqual(mutateDisposableTestPortfolio(device.storage, 'B', 1, now), { ok: true, version: 2 });
        localWinner = device.storage.getItem('put_scanner_portfolio_trades');
        mock.cloud.portfolio.payload.data[0].notes = 'CLOUD SYNC TEST ONLY — disposable fixture | Portfolio v2 | Device A';
        mock.cloud.portfolio.revision = 2;
      },
    });
    assert.equal(manager.getSnapshot().phase, 'conflict');
    assert.equal(manager.getSnapshot().namespaces.portfolio, 'conflict');
    assert.equal(client.updateCalls.length, 0);
    assert.equal(storage.getItem('put_scanner_portfolio_trades'), localWinner);
    assert.match(client.cloud.portfolio.payload.data[0].notes, /Device A/);
    assert.equal(durableMutationListenerCount(), 1, 'safe conflict startup still permits unrelated namespaces');
    await stopManager(manager);
  });

  await t.test('CLOUD_MISSING blocks and does not attach', async () => {
    const device = verifiedDevice({ enabled: true });
    const client = new MockCloudClient(null);
    const { manager } = managerFor(device.storage, client);
    await manager.setAccount(userId, true);
    assert.equal(client.fetchCalls, 1);
    assert.equal(client.updateCalls.length, 0);
    assert.equal(manager.getSnapshot().phase, 'attention');
    assert.equal(durableMutationListenerCount(), 0);
    await stopManager(manager);
  });

  await t.test('INVALID cloud blocks and does not attach', async () => {
    const device = verifiedDevice({ enabled: true });
    const client = new MockCloudClient(device.cloud);
    client.fetchError = { code: 'cloud_state_invalid', operation: 'fetch_all', message: 'invalid cloud' };
    const { manager } = managerFor(device.storage, client);
    await manager.setAccount(userId, true);
    assert.equal(client.fetchCalls, 1);
    assert.equal(client.updateCalls.length, 0);
    assert.equal(manager.getSnapshot().phase, 'attention');
    assert.equal(durableMutationListenerCount(), 0);
    await stopManager(manager);
  });

  await t.test('ACCOUNT_MISMATCH blocks before client construction', async () => {
    const device = verifiedDevice({ enabled: true });
    const client = new MockCloudClient(device.cloud);
    const { manager, factoryCalls } = managerFor(device.storage, client);
    await manager.setAccount(otherUserId, true);
    assert.equal(manager.getSnapshot().phase, 'account_mismatch');
    assert.equal(factoryCalls(), 0);
    assert.equal(client.fetchCalls, 0);
    assert.equal(client.updateCalls.length, 0);
  });
});

test('normal durable edits auto-sync by namespace and bursts coalesce, while market-only refreshes stay local', async () => {
  const { manager, client, storage } = await startEnabled();
  client.fetchCalls = 0;
  client.updateCalls = [];

  assert.equal(mutateDisposableTestPortfolio(storage, 'A', 1, now).ok, true);
  await waitFor(() => client.updateCalls.length === 1, 'Portfolio edit did not synchronize');
  assert.equal(client.updateCalls[0].namespace, 'portfolio');

  assert.equal(mutateDisposableTestWatchlist(storage, 'A', now).ok, true);
  await waitFor(() => client.updateCalls.length === 2, 'Watchlist edit did not synchronize');
  assert.equal(client.updateCalls[1].namespace, 'watchlist');

  assert.equal(mutateDisposableTestPreference(storage).ok, true);
  await waitFor(() => client.updateCalls.length === 3, 'Preference edit did not synchronize');
  assert.equal(client.updateCalls[2].namespace, 'preferences');

  assert.equal(mutateDisposableTestPortfolio(storage, 'A', 5, now).ok, true);
  await waitFor(() => client.updateCalls.length === 4, 'Portfolio burst did not synchronize');
  assert.equal(client.updateCalls.filter(call => call.namespace === 'portfolio').length, 2, 'five-write burst coalesces to one additional CAS');

  const portfolio = readPortfolioTrades(storage);
  assert.equal(portfolio.status, 'ok');
  writePortfolioTrades(storage, [{
    ...portfolio.data[0],
    latestMarketData: { optionBid: 1.25 },
  }, ...portfolio.data.slice(1)], { now });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(client.updateCalls.length, 4, 'direct market-data refresh performs no user_state write');
  assert.equal(client.fetchCalls, 0, 'normal edits and market refreshes do not inventory/poll');
  await stopManager(manager);
});

test('offline edits stay local, retry exactly three times, and explicit Sync Now later recovers', async () => {
  const { manager, client, storage } = await startEnabled();
  client.fetchCalls = 0;
  client.updateCalls = [];
  client.updateError = { code: 'network_error', operation: 'update_namespace', message: 'offline' };
  assert.equal(mutateDisposableTestWatchlist(storage, 'B', now).ok, true);
  const localAfterEdit = durableDataEntries(storage);
  await waitFor(() => client.updateCalls.length === 3, 'bounded retries did not complete');
  await waitFor(() => manager.getSnapshot().phase === 'pending', 'pending status was not published');
  assert.deepEqual(durableDataEntries(storage), localAfterEdit);
  assert.equal(readOngoingSyncMetadata(storage, userId).metadata.namespaces.watchlist.cloudRevision, 1);
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(client.updateCalls.length, 3, 'no infinite retry loop');

  client.updateError = null;
  const result = await manager.syncNow();
  assert.equal(result.ok, true);
  assert.equal(result.reconciliation.namespaces.watchlist.classification, 'LOCAL_AHEAD');
  assert.equal(result.reconciliation.namespaces.watchlist.outcome, 'pushed');
  assert.equal(client.fetchCalls, 1);
  assert.equal(client.updateCalls.length, 4);
  assert.equal(manager.getSnapshot().phase, 'synced');
  await stopManager(manager);
});

test('explicit Sync Now inventories an already-open device and safely pulls a later cloud-ahead preference', async () => {
  const { manager, client, storage } = await startEnabled();
  client.fetchCalls = 0;
  client.updateCalls = [];
  client.cloud.preferences.payload.data.showNominalYield = false;
  client.cloud.preferences.revision = 2;
  const result = await manager.syncNow();
  assert.equal(result.ok, true);
  assert.equal(result.reconciliation.namespaces.preferences.classification, 'CLOUD_AHEAD');
  assert.equal(result.reconciliation.namespaces.preferences.outcome, 'pulled');
  assert.equal(client.fetchCalls, 1);
  assert.equal(client.updateCalls.length, 0);
  assert.equal(readCanonicalLocalState(storage).value.documents.preferences.payload.data.showNominalYield, false);
  assert.equal(client.cloud.preferences.revision, 2);
  await stopManager(manager);
});

test('a conflicted namespace stays frozen while an unrelated namespace continues', async () => {
  const { manager, client, storage } = await startEnabled({
    configure: (device, mock) => {
      mutateDisposableTestPortfolio(device.storage, 'B', 1, now);
      mock.cloud.portfolio.payload.data[0].notes = 'CLOUD SYNC TEST ONLY — disposable fixture | Portfolio v2 | Device A';
      mock.cloud.portfolio.revision = 2;
    },
  });
  assert.equal(manager.getSnapshot().phase, 'conflict');
  client.updateCalls = [];
  assert.equal(mutateDisposableTestWatchlist(storage, 'B', now).ok, true);
  await waitFor(() => client.updateCalls.length === 1, 'unrelated Watchlist edit did not synchronize');
  assert.equal(client.updateCalls[0].namespace, 'watchlist');
  assert.equal(client.updateCalls[0].expectedRevision, 1);
  assert.equal(manager.getSnapshot().namespaces.portfolio, 'conflict');
  assert.equal(manager.getSnapshot().namespaces.watchlist, 'synced');
  await stopManager(manager);
});

test('sign-out preserves every durable byte and late responses after account switch cannot advance metadata', async t => {
  await t.test('sign-out', async () => {
    const { manager, storage } = await startEnabled();
    const before = storageEntries(storage);
    await manager.setAccount(null, true);
    assert.equal(manager.getSnapshot().phase, 'anonymous');
    assert.equal(durableMutationListenerCount(), 0);
    assert.deepEqual(storageEntries(storage), before);
  });

  await t.test('late response after account switch', async () => {
    const { manager, client, storage } = await startEnabled();
    client.updateCalls = [];
    let release;
    let started;
    const startedPromise = new Promise(resolve => { started = resolve; });
    const releasePromise = new Promise(resolve => { release = resolve; });
    client.beforeUpdate = async () => { started(); await releasePromise; };
    assert.equal(mutateDisposableTestPortfolio(storage, 'B', 1, now).ok, true);
    await startedPromise;
    const baselineRevision = readOngoingSyncMetadata(storage, userId).metadata.namespaces.portfolio.cloudRevision;
    const switching = manager.setAccount(otherUserId, true);
    release();
    await switching;
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(readOngoingSyncMetadata(storage, userId).metadata.namespaces.portfolio.cloudRevision, baselineRevision);
    assert.equal(manager.getSnapshot().phase, 'account_mismatch');
    assert.equal(durableMutationListenerCount(), 0);
  });
});

test('root ownership, compact Account UI, Stage 4 protection, no polling, and production/test build boundaries are structural', async () => {
  const [app, provider, lifecycle, account, accountData, syncSection, buildReport, envExample] = await Promise.all([
    readFile(path.join(root, 'src/App.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/CloudSyncProvider.tsx'), 'utf8'),
    readFile(path.join(root, 'src/lib/cloudState/productionSyncLifecycle.ts'), 'utf8'),
    readFile(path.join(root, 'src/components/AccountControl.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/AccountDataSection.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/CloudSyncSection.tsx'), 'utf8'),
    readFile(path.join(root, 'scripts/build-report.mjs'), 'utf8'),
    readFile(path.join(root, '.env.example'), 'utf8'),
  ]);
  assert.match(app, /VITE_CLOUD_SYNC_ENABLED === 'true'[\s\S]*?lazy\(\(\) => import\('\.\/components\/CloudSyncProvider'\)\)/);
  assert.match(app, /<AuthProvider>[\s\S]*?<ProductionCloudSyncProvider>[\s\S]*?<AppBody \/>/);
  assert.doesNotMatch(account, /createDormantLocalFirstSyncCoordinator|attachMutationEvents|syncNow\(\)/);
  assert.doesNotMatch(accountData, /createDormantLocalFirstSyncCoordinator|attachMutationEvents/);
  assert.match(provider, /createProductionCloudSyncManager[\s\S]*?manager\.setAccount/);
  assert.match(syncSection, /Enable Sync on This Device/);
  assert.match(syncSection, /Sync Now/);
  assert.match(accountData, /ongoingSyncState !== 'none'[\s\S]*?Save and restore actions stay unavailable/);
  assert.doesNotMatch(lifecycle, /setInterval|addEventListener\(['"]focus|visibilitychange|\.channel\s*\(|Realtime/);
  assert.doesNotMatch(provider, /setInterval|addEventListener\(['"]focus|visibilitychange/);
  assert.ok(buildReport.includes('stage5bHarnessMarkers'));
  assert.match(envExample, /^VITE_CLOUD_SYNC_ENABLED=false$/m);
});

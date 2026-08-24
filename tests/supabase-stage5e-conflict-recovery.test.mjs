import test from 'node:test';
import assert from 'node:assert/strict';
import { createVerifiedSyncMetadata } from '../src/lib/cloudState/accountMigration.ts';
import { createDormantLocalFirstSyncCoordinator } from '../src/lib/cloudState/syncCoordinator.ts';
import {
  createEligibleOngoingSyncMetadata,
  enableEligibleOngoingSync,
  readOngoingSyncMetadata,
  writeOngoingSyncMetadata,
} from '../src/lib/cloudState/syncEngineMetadata.ts';
import { readCanonicalLocalState } from '../src/lib/cloudState/localState.ts';
import {
  getOrCreateLocalSyncDeviceId,
  LOCAL_SYNC_DEVICE_ID_KEY,
  localDeviceLabel,
} from '../src/lib/cloudState/deviceIdentity.ts';
import { persistPortfolioMarkBasis } from '../src/lib/portfolioMarkPreference.ts';
import {
  readPortfolioTrades,
  writePortfolioTrades,
} from '../src/lib/portfolioStorage.ts';
import { THEME_STORAGE_KEY } from '../src/lib/themePreference.ts';
import { readWatchlist, writeWatchlist } from '../src/lib/watchlist.ts';

const userId = '77777777-7777-4777-8777-777777777777';
const now = new Date('2026-08-25T12:00:00.000Z');

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const clone = value => JSON.parse(JSON.stringify(value));

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
  notes: 'common baseline',
  createdAt: '2026-08-13T12:00:00.000Z',
  updatedAt: '2026-08-13T12:00:00.000Z',
  latestMarketData: {
    optionBid: 0.91,
    optionAsk: 1.08,
    volume: 240,
    refreshedAt: '2026-08-25T11:45:00.000Z',
  },
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
  note: 'common baseline',
  ...overrides,
});

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
  storage.setItem(THEME_STORAGE_KEY, 'dark');
  persistPortfolioMarkBasis('ask', storage);
  const local = readCanonicalLocalState(storage);
  assert.equal(local.status, 'ok');
  const cloud = cloudFromDocuments(local.value.documents);
  const stage4 = createVerifiedSyncMetadata(userId, cloud, local.value, now);
  const eligible = createEligibleOngoingSyncMetadata(userId, stage4, local.value, cloud, now);
  assert.equal(eligible.ok, true);
  const metadata = enableEligibleOngoingSync(eligible.metadata);
  assert.equal(writeOngoingSyncMetadata(storage, metadata).status, 'ok');
  return { storage, cloud, metadata };
}

function cloudError(code, namespace, operation = 'update_namespace') {
  return { ok: false, error: { code, operation, namespace, message: code } };
}

class MockTransport {
  constructor(cloud) {
    this.cloud = clone(cloud);
    this.fetchAllCalls = 0;
    this.fetchNamespaceCalls = [];
    this.updateCalls = [];
  }

  async fetchAllUserState() {
    this.fetchAllCalls += 1;
    return { ok: true, value: { status: 'complete', state: clone(this.cloud) } };
  }

  async fetchNamespace(namespace) {
    this.fetchNamespaceCalls.push(namespace);
    return { ok: true, value: clone(this.cloud[namespace]) };
  }

  async updateNamespaceIfRevisionMatches(namespace, expectedRevision, schemaVersion, payload) {
    this.updateCalls.push({ namespace, expectedRevision, schemaVersion, payload: clone(payload) });
    const row = this.cloud[namespace];
    if (!row || row.revision !== expectedRevision) return cloudError('conflict', namespace);
    row.schemaVersion = schemaVersion;
    row.payload = clone(payload);
    row.revision += 1;
    row.updatedAt = now.toISOString();
    return { ok: true, value: clone(row) };
  }
}

function mutateLocal(device, namespace, suffix = 'local') {
  if (namespace === 'portfolio') {
    const current = readPortfolioTrades(device.storage);
    assert.equal(current.status, 'ok');
    assert.equal(writePortfolioTrades(device.storage, current.data.map(item => ({
      ...item,
      notes: `${item.notes}-${suffix}`,
      updatedAt: '2026-08-25T12:01:00.000Z',
    })), { now: new Date('2026-08-25T12:01:00.000Z') }).status, 'ok');
    return;
  }
  if (namespace === 'watchlist') {
    const current = readWatchlist(device.storage);
    assert.equal(current.status, 'ok');
    assert.equal(writeWatchlist(device.storage, [...current.data, watch('SQQQ', 40, { note: suffix })], {
      now: new Date('2026-08-25T12:01:00.000Z'),
    }).status, 'ok');
    return;
  }
  persistPortfolioMarkBasis('last', device.storage);
}

function mutateCloud(device, namespace, suffix = 'cloud') {
  const row = device.cloud[namespace];
  row.revision += 1;
  row.updatedAt = '2026-08-25T12:02:00.000Z';
  if (namespace === 'portfolio') {
    row.payload.data[0].notes = `${row.payload.data[0].notes}-${suffix}`;
    row.payload.data[0].updatedAt = row.updatedAt;
  } else if (namespace === 'watchlist') {
    row.payload.data.push(watch('SOXL', 35, { note: suffix }));
  } else {
    row.payload.data.portfolioMarkBasis = 'bid';
    row.payload.data.theme = 'dark-blue';
  }
}

function coordinator(device, transport = new MockTransport(device.cloud)) {
  return {
    transport,
    sync: createDormantLocalFirstSyncCoordinator({
      userId,
      client: transport,
      storage: device.storage,
      debounceMs: 60_000,
      retryDelaysMs: [],
      now: () => now,
      delay: async () => {},
    }),
  };
}

async function createConflict(namespaces = ['portfolio']) {
  const device = associatedDevice();
  for (const namespace of namespaces) {
    mutateLocal(device, namespace);
    mutateCloud(device, namespace);
  }
  const runtime = coordinator(device);
  const result = await runtime.sync.syncNow();
  assert.equal(result.overall, 'conflict_needs_attention');
  return { device, ...runtime };
}

function conflictFor(sync, namespace) {
  const conflict = sync.getSnapshot().conflicts?.[namespace];
  assert.ok(conflict, `${namespace} conflict snapshot should be available`);
  return conflict;
}

test('BOTH_CHANGED still performs no automatic write or pull and captures a safe comparison', async () => {
  const { device, transport, sync } = await createConflict();
  const local = readCanonicalLocalState(device.storage);
  const conflict = conflictFor(sync, 'portfolio');
  assert.equal(transport.updateCalls.length, 0);
  assert.equal(transport.fetchNamespaceCalls.length, 0);
  assert.match(local.value.documents.portfolio.payload.data[0].notes, /local/);
  assert.equal(conflict.namespace, 'portfolio');
  assert.equal(conflict.backupCompleted, false);
  assert.match(conflict.thisDevice.lines.join(' '), /1 open position/);
  assert.match(conflict.accountCopy.lines.join(' '), /1 open position/);
});

test('resolution is blocked until the exact captured conflict has a successful backup acknowledgement', async () => {
  const { transport, sync } = await createConflict();
  const conflict = conflictFor(sync, 'portfolio');
  const result = await sync.resolveConflict('portfolio', 'keep_this_device', conflict.id);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'backup_required');
  assert.equal(transport.updateCalls.length, 0);
});

test('Keep This Device uses one exact captured revision CAS and clears only that conflict', async () => {
  const { device, transport, sync } = await createConflict();
  const conflict = conflictFor(sync, 'portfolio');
  assert.equal(sync.acknowledgeConflictBackup('portfolio', conflict.id).ok, true);
  const result = await sync.resolveConflict('portfolio', 'keep_this_device', conflict.id);
  assert.equal(result.ok, true);
  assert.equal(transport.updateCalls.length, 1);
  assert.equal(transport.updateCalls[0].namespace, 'portfolio');
  assert.equal(transport.updateCalls[0].expectedRevision, 6);
  assert.equal(transport.cloud.portfolio.revision, 7);
  assert.match(transport.cloud.portfolio.payload.data[0].notes, /local/);
  assert.equal(sync.getSnapshot().namespaces.portfolio, 'synced');
  assert.equal(sync.getSnapshot().conflicts.portfolio, undefined);
  assert.equal(readOngoingSyncMetadata(device.storage, userId).metadata.namespaces.portfolio.cloudRevision, 7);
});

test('Keep This Device stale CAS never retries and keeps local data untouched', async () => {
  const { device, transport, sync } = await createConflict();
  const conflict = conflictFor(sync, 'portfolio');
  assert.equal(sync.acknowledgeConflictBackup('portfolio', conflict.id).ok, true);
  transport.cloud.portfolio.revision = 7;
  transport.cloud.portfolio.payload.data[0].notes = 'newer-account-change';
  const localBefore = device.storage.getItem('put_scanner_portfolio');
  const result = await sync.resolveConflict('portfolio', 'keep_this_device', conflict.id);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'cloud_changed_again');
  assert.equal(transport.updateCalls.length, 1);
  assert.equal(transport.updateCalls[0].expectedRevision, 6);
  assert.equal(device.storage.getItem('put_scanner_portfolio'), localBefore);
  assert.equal(sync.getSnapshot().namespaces.portfolio, 'conflict');
});

test('Use Account Copy verifies the captured revision, preserves Portfolio quotes, and sends zero echo CAS', async () => {
  const { device, transport, sync } = await createConflict();
  const conflict = conflictFor(sync, 'portfolio');
  assert.equal(sync.acknowledgeConflictBackup('portfolio', conflict.id).ok, true);
  const result = await sync.resolveConflict('portfolio', 'use_account_copy', conflict.id);
  assert.equal(result.ok, true);
  assert.deepEqual(transport.fetchNamespaceCalls, ['portfolio']);
  assert.equal(transport.updateCalls.length, 0);
  const local = readPortfolioTrades(device.storage);
  assert.equal(local.status, 'ok');
  assert.match(local.data[0].notes, /cloud/);
  assert.equal(local.data[0].latestMarketData.optionBid, 0.91);
  assert.equal(local.data[0].latestMarketData.volume, 240);
  assert.equal(sync.getSnapshot().namespaces.portfolio, 'synced');
});

test('Use Account Copy refuses a stale cloud snapshot without changing local state', async () => {
  const { device, transport, sync } = await createConflict();
  const conflict = conflictFor(sync, 'portfolio');
  assert.equal(sync.acknowledgeConflictBackup('portfolio', conflict.id).ok, true);
  transport.cloud.portfolio.revision = 7;
  transport.cloud.portfolio.payload.data[0].notes = 'changed-again';
  const localBefore = device.storage.getItem('put_scanner_portfolio');
  const result = await sync.resolveConflict('portfolio', 'use_account_copy', conflict.id);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'cloud_changed_again');
  assert.equal(transport.updateCalls.length, 0);
  assert.equal(device.storage.getItem('put_scanner_portfolio'), localBefore);
  assert.equal(sync.getSnapshot().namespaces.portfolio, 'conflict');
});

test('Preferences and Watchlist conflicts resolve independently without touching Portfolio', async t => {
  for (const namespace of ['preferences', 'watchlist']) {
    await t.test(namespace, async () => {
      const { device, transport, sync } = await createConflict([namespace]);
      const portfolioBefore = device.storage.getItem('put_scanner_portfolio');
      const conflict = conflictFor(sync, namespace);
      assert.equal(sync.acknowledgeConflictBackup(namespace, conflict.id).ok, true);
      const result = await sync.resolveConflict(namespace, 'use_account_copy', conflict.id);
      assert.equal(result.ok, true);
      assert.equal(device.storage.getItem('put_scanner_portfolio'), portfolioBefore);
      assert.equal(transport.updateCalls.length, 0);
      assert.equal(sync.getSnapshot().namespaces[namespace], 'synced');
    });
  }
});

test('sign-out during conflict produces no cloud write and preserves local bytes', async () => {
  const { device, transport, sync } = await createConflict();
  const conflict = conflictFor(sync, 'portfolio');
  assert.equal(sync.acknowledgeConflictBackup('portfolio', conflict.id).ok, true);
  const before = clone(Object.fromEntries(device.storage.values));
  sync.setAuthenticatedUser(null);
  const result = await sync.resolveConflict('portfolio', 'keep_this_device', conflict.id);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'not_enabled');
  assert.equal(transport.updateCalls.length, 0);
  assert.deepEqual(Object.fromEntries(device.storage.values), before);
});

test('reload reconstructs an unresolved conflict safely from persisted baseline and fresh inventory', async () => {
  const { device, transport, sync } = await createConflict();
  assert.equal(sync.getSnapshot().namespaces.portfolio, 'conflict');
  sync.dispose();
  const reloaded = coordinator(device, transport).sync;
  const result = await reloaded.syncNow();
  assert.equal(result.namespaces.portfolio.outcome, 'conflict');
  assert.ok(reloaded.getSnapshot().conflicts.portfolio);
  assert.equal(transport.updateCalls.length, 0);
});

test('multiple conflicts can be resolved independently while the other remains frozen', async () => {
  const { transport, sync } = await createConflict(['portfolio', 'preferences']);
  const portfolio = conflictFor(sync, 'portfolio');
  assert.equal(sync.acknowledgeConflictBackup('portfolio', portfolio.id).ok, true);
  assert.equal((await sync.resolveConflict('portfolio', 'keep_this_device', portfolio.id)).ok, true);
  assert.equal(sync.getSnapshot().namespaces.portfolio, 'synced');
  assert.equal(sync.getSnapshot().namespaces.preferences, 'conflict');
  assert.equal(transport.updateCalls.length, 1);
  assert.equal(transport.updateCalls[0].namespace, 'portfolio');
});

test('long-offline and simultaneous edits remain BOTH_CHANGED, while sequential clean devices pull safely', async t => {
  await t.test('long-offline divergence', async () => {
    const { transport, sync } = await createConflict();
    assert.equal(sync.getSnapshot().namespaces.portfolio, 'conflict');
    assert.equal(transport.updateCalls.length, 0);
  });

  await t.test('simultaneous note edits do not merge', async () => {
    const { transport, sync } = await createConflict();
    const conflict = conflictFor(sync, 'portfolio');
    assert.doesNotMatch(conflict.thisDevice.lines.join(' '), /cloud/);
    assert.equal(transport.updateCalls.length, 0);
  });

  await t.test('sequential cloud-ahead preferences pull cleanly', async () => {
    const device = associatedDevice();
    mutateCloud(device, 'preferences');
    const { transport, sync } = coordinator(device);
    const result = await sync.syncNow();
    assert.equal(result.namespaces.preferences.outcome, 'pulled');
    assert.equal(sync.getSnapshot().namespaces.preferences, 'synced');
    assert.equal(transport.updateCalls.length, 0);
    assert.equal(device.storage.getItem('put_scanner_portfolio_mark_basis'), 'bid');
  });
});

test('normal clean reconciliation and quote-only Portfolio refresh remain zero CAS and zero conflict', async () => {
  const device = associatedDevice();
  const current = readPortfolioTrades(device.storage);
  assert.equal(current.status, 'ok');
  assert.equal(writePortfolioTrades(device.storage, current.data.map(item => ({
    ...item,
    latestMarketData: { ...item.latestMarketData, optionBid: 0.72, volume: 900 },
  })), { now: new Date('2026-08-25T12:03:00.000Z') }).status, 'ok');
  const { transport, sync } = coordinator(device);
  const result = await sync.syncNow();
  assert.equal(result.namespaces.portfolio.outcome, 'clean');
  assert.equal(transport.updateCalls.length, 0);
  assert.equal(sync.getSnapshot().conflicts.portfolio, undefined);
});

test('device identity is stable, opaque, local-only, and does not replace malformed existing metadata', () => {
  const storage = new MemoryStorage();
  let generations = 0;
  const randomUuid = () => {
    generations += 1;
    return '12345678-1234-4123-8123-123456789abc';
  };
  const first = getOrCreateLocalSyncDeviceId(storage, randomUuid);
  const second = getOrCreateLocalSyncDeviceId(storage, () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(first, '12345678-1234-4123-8123-123456789abc');
  assert.equal(second, first);
  assert.equal(generations, 1);
  assert.deepEqual(JSON.parse(storage.getItem(LOCAL_SYNC_DEVICE_ID_KEY)), { version: 1, id: first });
  assert.equal(localDeviceLabel('Mozilla/5.0 (iPhone)'), 'This iPhone');
  assert.equal(localDeviceLabel('Mozilla/5.0 (Windows NT 10.0)'), 'This Browser');

  const malformed = new MemoryStorage({ [LOCAL_SYNC_DEVICE_ID_KEY]: '{"version":1,"id":"browser-fingerprint"}' });
  assert.equal(getOrCreateLocalSyncDeviceId(malformed, randomUuid), null);
  assert.equal(malformed.getItem(LOCAL_SYNC_DEVICE_ID_KEY), '{"version":1,"id":"browser-fingerprint"}');
});

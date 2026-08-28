import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { restoreAccountAfterFreshFetch } from '../src/lib/cloudState/accountMigration.ts';
import { readCanonicalLocalState } from '../src/lib/cloudState/localState.ts';
import {
  createProductionCloudSyncManager,
  prepareProductionSyncEnrollment,
} from '../src/lib/cloudState/productionSyncLifecycle.ts';
import { fingerprintInitialization } from '../src/lib/cloudState/syncFingerprint.ts';
import { readOngoingSyncMetadata } from '../src/lib/cloudState/syncEngineMetadata.ts';
import { subscribeToDurableMutations } from '../src/lib/cloudState/syncEvents.ts';
import { CLOUD_SYNC_METADATA_KEY } from '../src/lib/cloudState/syncMetadata.ts';
import { resolveEntryVixFromPoints } from '../src/lib/portfolioEntryVix.ts';
import { archiveExpiredOpenTrades } from '../src/lib/portfolioExpirationArchive.ts';
import {
  PORTFOLIO_STORAGE_KEY,
  readPortfolioTrades,
  writePortfolioTrades,
} from '../src/lib/portfolioStorage.ts';
import { readShowNominalYield, persistShowNominalYield } from '../src/lib/optionTablePreferences.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userId = '53535353-5353-4535-8535-535353535353';
const otherUserId = '64646464-6464-4646-8646-646464646464';
const now = new Date('2026-08-23T12:00:00.000Z');

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
    this.writes = [];
  }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); this.writes.push([key, String(value)]); }
  removeItem(key) { this.values.delete(key); }
}

function clone(value) {
  return structuredClone(value);
}

function durableTrade(overrides = {}) {
  return {
    id: 'canary-trade',
    ticker: 'TQQQ',
    optionType: 'put',
    strike: 50,
    expiration: '2026-12-18',
    contracts: 2,
    soldPrice: 1.25,
    soldDate: '2026-08-20',
    status: 'open',
    notes: 'verified owner note',
    entryVixClose: 16.5,
    entryVixDate: '2026-08-20',
    entryVixSource: 'historical_close',
    createdAt: '2026-08-20T14:00:00.000Z',
    updatedAt: '2026-08-20T14:00:00.000Z',
    entrySnapshot: { underlyingPrice: 60, bid: 1.2, ask: 1.3, last: 1.25, iv: 0.45, delta: -0.2 },
    ...overrides,
  };
}

function cloudState(overrides = {}) {
  const documents = {
    portfolio: { schemaVersion: 1, payload: { data: [durableTrade()] } },
    watchlist: { schemaVersion: 1, payload: { data: [] } },
    preferences: { schemaVersion: 1, payload: { data: { showNominalYield: false } } },
  };
  const revisions = { portfolio: 1, watchlist: 1, preferences: 5, ...overrides.revisions };
  return Object.fromEntries(Object.entries(documents).map(([namespace, document]) => [namespace, {
    userId: overrides.owner ?? userId,
    namespace,
    schemaVersion: document.schemaVersion,
    payload: clone(document.payload),
    revision: revisions[namespace],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  }]));
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

async function restoredDevice(cloud = cloudState()) {
  const storage = new MemoryStorage();
  const client = new MockCloudClient(cloud);
  const restored = await restoreAccountAfterFreshFetch(client, storage, userId, { confirmed: true, now });
  assert.equal(restored.ok, true);
  assert.equal(restored.metadataWritten, true);
  client.fetchCalls = 0;
  storage.writes = [];
  return { storage, client, cloud };
}

async function applyMarketData(trade, marketData, mode = 'merge') {
  const module = await import('../src/lib/portfolioMarketRefresh.ts');
  return module.applyTransientPortfolioMarketData(trade, marketData, mode);
}

async function waitFor(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail(message);
}

test('quote-refresh outcomes are transient and preserve trade/envelope durability', async () => {
  const cases = [
    ['latest market data', { underlyingPrice: 61, refreshedAt: now.toISOString() }],
    ['successful quote', { optionBid: 0.9, optionAsk: 1.1, optionMid: 1, optionLast: 1.05, iv: 0.42, delta: -0.19, volume: 120, openInterest: 800, availabilityStatus: 'live', refreshedAt: now.toISOString() }],
    ['failed quote', { underlyingPrice: 61, availabilityStatus: 'refresh_failed', refreshedAt: now.toISOString() }],
    ['unavailable quote', { underlyingPrice: 61, availabilityStatus: 'unavailable', refreshedAt: now.toISOString() }],
    ['DTE-only refresh', { dte: 117, refreshedAt: now.toISOString() }],
  ];

  for (const [label, marketData] of cases) {
    const { storage } = await restoredDevice();
    const before = readPortfolioTrades(storage);
    assert.equal(before.status, 'ok');
    const beforeFingerprint = fingerprintInitialization(readCanonicalLocalState(storage).value.documents).portfolio;
    const rawBefore = JSON.parse(storage.getItem(PORTFOLIO_STORAGE_KEY));
    let mutations = 0;
    let refreshed;
    const unsubscribe = subscribeToDurableMutations(event => { if (event.namespace === 'portfolio') mutations += 1; });
    try {
      refreshed = await applyMarketData(before.data[0], marketData, label === 'successful quote' ? 'replace' : 'merge');
      assert.equal(refreshed.updatedAt, before.data[0].updatedAt, `${label} changed durable trade updatedAt`);
      assert.equal(writePortfolioTrades(storage, [refreshed], { now }).status, 'ok');
    } finally {
      unsubscribe();
    }
    const after = readPortfolioTrades(storage);
    const rawAfter = JSON.parse(storage.getItem(PORTFOLIO_STORAGE_KEY));
    assert.equal(after.status, 'ok');
    assert.equal(rawAfter.revision, rawBefore.revision, `${label} changed durable revision`);
    assert.equal(rawAfter.updatedAt, rawBefore.updatedAt, `${label} changed envelope updatedAt`);
    assert.equal(mutations, 0, `${label} emitted a durable mutation`);
    assert.equal(fingerprintInitialization(readCanonicalLocalState(storage).value.documents).portfolio, beforeFingerprint);
    assert.deepEqual(readPortfolioTrades(storage).data[0].latestMarketData, refreshed.latestMarketData, `${label} did not survive local reload`);
  }
});

test('Stage 4 restore -> quote refresh -> production enrollment succeeds without cloud mutation', async () => {
  const cloud = cloudState();
  const { storage, client } = await restoredDevice(cloud);
  const portfolio = readPortfolioTrades(storage);
  const refreshed = await applyMarketData(portfolio.data[0], {
    underlyingPrice: 61,
    optionBid: 0.8,
    optionAsk: 1,
    optionMid: 0.9,
    optionLast: 0.95,
    lastTradeDate: '2026-08-22T19:59:00.000Z',
    iv: 0.41,
    delta: -0.18,
    volume: 250,
    openInterest: 900,
    dte: 117,
    refreshedAt: now.toISOString(),
    availabilityStatus: 'live',
  }, 'replace');
  writePortfolioTrades(storage, [refreshed], { now });

  const manager = createProductionCloudSyncManager({
    featureEnabled: true,
    storage,
    clientForUser: () => client,
    debounceMs: 0,
    retryDelaysMs: [0, 0],
    now: () => now,
    delay: async () => {},
  });
  await manager.setAccount(userId, true);
  assert.equal(client.fetchCalls, 0, 'unenrolled startup must remain inert');
  const enabled = await manager.enableOnThisDevice();
  assert.equal(enabled.ok, true);
  assert.equal(readOngoingSyncMetadata(storage, userId).metadata.syncMode, 'enabled');
  assert.deepEqual(Object.fromEntries(Object.entries(client.cloud).map(([namespace, row]) => [namespace, row.revision])), {
    portfolio: 1,
    watchlist: 1,
    preferences: 5,
  });
  assert.equal(client.updateCalls.length, 0);

  persistShowNominalYield(true, storage);
  await waitFor(() => client.updateCalls.length === 1, 'portable preference did not synchronize');
  assert.equal(client.updateCalls[0].namespace, 'preferences');
  assert.deepEqual(Object.fromEntries(Object.entries(client.cloud).map(([namespace, row]) => [namespace, row.revision])), {
    portfolio: 1,
    watchlist: 1,
    preferences: 6,
  });
  await manager.setAccount(null, true);
});

test('post-enrollment quote refresh stays Synced and performs zero CAS', async () => {
  const { storage, client } = await restoredDevice();
  const manager = createProductionCloudSyncManager({
    featureEnabled: true,
    storage,
    clientForUser: () => client,
    debounceMs: 0,
    retryDelaysMs: [0, 0],
    now: () => now,
    delay: async () => {},
  });
  await manager.setAccount(userId, true);
  assert.equal((await manager.enableOnThisDevice()).ok, true);
  client.fetchCalls = 0;
  client.updateCalls = [];

  const before = readPortfolioTrades(storage);
  const refreshed = await applyMarketData(before.data[0], {
    underlyingPrice: 62,
    optionBid: 0.7,
    optionAsk: 0.9,
    optionMid: 0.8,
    dte: 116,
    refreshedAt: '2026-08-23T13:00:00.000Z',
    availabilityStatus: 'live',
  }, 'replace');
  writePortfolioTrades(storage, [refreshed], { now: new Date('2026-08-23T13:00:00.000Z') });
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(client.fetchCalls, 0);
  assert.equal(client.updateCalls.length, 0);
  assert.equal(manager.getSnapshot().phase, 'synced');
  assert.equal(readPortfolioTrades(storage).revision, before.revision);
  await manager.setAccount(null, true);
});

test('post-enrollment durable note, add, and delete operations each produce one verified Portfolio CAS', async () => {
  const { storage, client } = await restoredDevice();
  const manager = createProductionCloudSyncManager({
    featureEnabled: true,
    storage,
    clientForUser: () => client,
    debounceMs: 0,
    retryDelaysMs: [0, 0],
    now: () => now,
    delay: async () => {},
  });
  await manager.setAccount(userId, true);
  assert.equal((await manager.enableOnThisDevice()).ok, true);
  client.updateCalls = [];

  const initial = readPortfolioTrades(storage).data;
  writePortfolioTrades(storage, [{ ...initial[0], notes: 'intentional note edit', updatedAt: '2026-08-23T13:01:00.000Z' }], { now: new Date('2026-08-23T13:01:00.000Z') });
  await waitFor(() => client.updateCalls.length === 1, 'note edit did not synchronize');
  assert.equal(client.updateCalls[0].namespace, 'portfolio');
  assert.equal(client.updateCalls[0].expectedRevision, 1);

  const afterNote = readPortfolioTrades(storage).data;
  writePortfolioTrades(storage, [...afterNote, durableTrade({
    id: 'added-trade',
    strike: 45,
    notes: 'intentional add',
    createdAt: '2026-08-23T13:02:00.000Z',
    updatedAt: '2026-08-23T13:02:00.000Z',
  })], { now: new Date('2026-08-23T13:02:00.000Z') });
  await waitFor(() => client.updateCalls.length === 2, 'trade add did not synchronize');
  assert.equal(client.updateCalls[1].expectedRevision, 2);

  const afterAdd = readPortfolioTrades(storage).data;
  writePortfolioTrades(storage, afterAdd.filter(trade => trade.id !== 'added-trade'), { now: new Date('2026-08-23T13:03:00.000Z') });
  await waitFor(() => client.updateCalls.length === 3, 'trade delete did not synchronize');
  assert.equal(client.updateCalls[2].expectedRevision, 3);
  assert.equal(client.cloud.portfolio.revision, 4);
  await manager.setAccount(null, true);
});

test('cloud-ahead durable pull preserves current local market data and emits no CAS echo', async () => {
  const { storage, client } = await restoredDevice();
  const manager = createProductionCloudSyncManager({
    featureEnabled: true,
    storage,
    clientForUser: () => client,
    debounceMs: 0,
    retryDelaysMs: [0, 0],
    now: () => now,
    delay: async () => {},
  });
  await manager.setAccount(userId, true);
  assert.equal((await manager.enableOnThisDevice()).ok, true);
  const localBefore = readPortfolioTrades(storage);
  const localMarketData = {
    underlyingPrice: 63,
    optionBid: 0.6,
    optionAsk: 0.8,
    optionMid: 0.7,
    refreshedAt: '2026-08-23T13:05:00.000Z',
    availabilityStatus: 'live',
  };
  writePortfolioTrades(storage, [await applyMarketData(localBefore.data[0], localMarketData, 'replace')], { now });
  client.updateCalls = [];
  client.cloud.portfolio.payload.data[0].notes = 'newer durable cloud note';
  client.cloud.portfolio.payload.data[0].updatedAt = '2026-08-23T13:06:00.000Z';
  client.cloud.portfolio.revision = 2;

  const result = await manager.syncNow();
  assert.equal(result.ok, true);
  assert.equal(result.reconciliation.namespaces.portfolio.classification, 'CLOUD_AHEAD');
  assert.equal(result.reconciliation.namespaces.portfolio.outcome, 'pulled');
  const localAfter = readPortfolioTrades(storage);
  assert.equal(localAfter.data[0].notes, 'newer durable cloud note');
  assert.deepEqual(localAfter.data[0].latestMarketData, localMarketData);
  await new Promise(resolve => setTimeout(resolve, 15));
  assert.equal(client.updateCalls.length, 0);
  await manager.setAccount(null, true);
});

test('harmless envelope timestamp drift is enrollable, but canonical/revision/identity corruption remains blocked', async () => {
  {
    const { storage, client } = await restoredDevice();
    const envelope = JSON.parse(storage.getItem(PORTFOLIO_STORAGE_KEY));
    envelope.updatedAt = '2026-08-23T13:00:00.000Z';
    storage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(envelope));
    const result = await prepareProductionSyncEnrollment(client, storage, userId, now);
    assert.equal(result.ok, true, 'identical canonical data was rejected only because envelope metadata drifted');
  }
  {
    const { storage, client } = await restoredDevice();
    const portfolio = readPortfolioTrades(storage);
    writePortfolioTrades(storage, [{ ...portfolio.data[0], notes: 'real local edit', updatedAt: now.toISOString() }], { now });
    const result = await prepareProductionSyncEnrollment(client, storage, userId, now);
    assert.equal(result.ok, false);
  }
  {
    const cloud = cloudState();
    const { storage, client } = await restoredDevice(cloud);
    client.cloud.portfolio.revision = 2;
    const result = await prepareProductionSyncEnrollment(client, storage, userId, now);
    assert.equal(result.ok, false);
  }
  {
    const { storage, client } = await restoredDevice();
    const result = await prepareProductionSyncEnrollment(client, storage, otherUserId, now);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'account_mismatch');
  }
  {
    const { storage, client } = await restoredDevice();
    storage.setItem(CLOUD_SYNC_METADATA_KEY, '{broken');
    const result = await prepareProductionSyncEnrollment(client, storage, userId, now);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'stage4_invalid');
  }
});

test('entry VIX remains durable but passive Portfolio mount does not resolve or persist it', async () => {
  const unresolved = durableTrade({ entryVixClose: undefined, entryVixDate: undefined, entryVixSource: undefined });
  const resolved = resolveEntryVixFromPoints([unresolved], [{
    timestamp: Date.parse('2026-08-20T00:00:00.000Z') / 1000,
    date: '2026-08-20',
    price: 16.5,
  }], now.toISOString());
  assert.equal(resolved.changed, true);
  assert.equal(resolved.trades[0].entryVixClose, 16.5);
  assert.equal(resolved.trades[0].updatedAt, now.toISOString());

  const source = await readFile(path.join(root, 'src/pages/PortfolioPage.tsx'), 'utf8');
  const mountStart = source.indexOf('useEffect(() => {\n    let active = true;') >= 0
    ? source.indexOf('useEffect(() => {\n    let active = true;')
    : source.indexOf('useEffect(() => {\r\n    let active = true;');
  const mount = source.slice(mountStart, source.indexOf('  const summary = useMemo'));
  assert.doesNotMatch(mount, /resolvePortfolioEntryVix/);
  assert.match(mount, /mergePortfolioLifecycleResults\(latest, stored, archived\.trades\)/);
  assert.match(mount, /if \(lifecycleApplied\)[\s\S]*?savePortfolioTrades\(reconciled\)/);
});

test('a restored non-expired trade with missing entry VIX remains enrollable after passive Portfolio lifecycle inspection', async () => {
  const cloud = cloudState();
  delete cloud.portfolio.payload.data[0].entryVixClose;
  delete cloud.portfolio.payload.data[0].entryVixDate;
  delete cloud.portfolio.payload.data[0].entryVixSource;
  const { storage, client } = await restoredDevice(cloud);
  const before = readCanonicalLocalState(storage);
  const archived = await archiveExpiredOpenTrades(readPortfolioTrades(storage).data, { now });
  assert.equal(archived.changed, false);
  const after = readCanonicalLocalState(storage);
  assert.deepEqual(after.value.documents, before.value.documents);
  assert.deepEqual(after.value.localRevision, before.value.localRevision);
  assert.deepEqual(after.value.localUpdatedAt, before.value.localUpdatedAt);
  assert.equal((await prepareProductionSyncEnrollment(client, storage, userId, now)).ok, true);
});

test('expiration resolution remains a real durable lifecycle mutation', async () => {
  const storage = new MemoryStorage();
  const expired = durableTrade({ expiration: '2026-08-21', entryVixClose: 16.5 });
  writePortfolioTrades(storage, [expired], { now: new Date('2026-08-20T00:00:00.000Z') });
  let mutations = 0;
  const unsubscribe = subscribeToDurableMutations(event => { if (event.namespace === 'portfolio') mutations += 1; });
  try {
    const archived = await archiveExpiredOpenTrades(readPortfolioTrades(storage).data, {
      now,
      findRichHistory: () => ({ points: [{ timestamp: 1, date: '2026-08-21', price: 55 }] }),
    });
    assert.equal(archived.changed, true);
    assert.equal(archived.trades[0].status, 'expired');
    writePortfolioTrades(storage, archived.trades, { now });
  } finally {
    unsubscribe();
  }
  assert.equal(mutations, 1);
  assert.equal(readPortfolioTrades(storage).revision, 2);
});

test('an automatic expired-trade lifecycle transition intentionally blocks exact-baseline enrollment', async () => {
  const cloud = cloudState();
  cloud.portfolio.payload.data[0].expiration = '2026-08-21';
  const { storage, client } = await restoredDevice(cloud);
  const archived = await archiveExpiredOpenTrades(readPortfolioTrades(storage).data, {
    now,
    findRichHistory: () => ({ points: [{ timestamp: 1, date: '2026-08-21', price: 55 }] }),
  });
  assert.equal(archived.changed, true);
  writePortfolioTrades(storage, archived.trades, { now });
  const enrollment = await prepareProductionSyncEnrollment(client, storage, userId, now);
  assert.equal(enrollment.ok, false);
  assert.equal(enrollment.code, 'not_eligible');
  assert.match(enrollment.message, /Canonical local durable data differs/);
});

test('Portfolio quote handler has no transient updatedAt assignment and nominal yield uses durable preferences', async () => {
  const source = await readFile(path.join(root, 'src/pages/PortfolioPage.tsx'), 'utf8');
  const refresh = source.slice(source.indexOf('const handleRefreshOpenTrades'), source.indexOf('const handleRetryResolve'));
  assert.doesNotMatch(refresh, /updatedAt:\s*nowIso/);
  assert.match(source, /useState\(readShowNominalYield\)/);
  assert.match(source, /handleShowNominalYieldChange[\s\S]*?persistShowNominalYield\(value\)/);
  assert.doesNotMatch(source, /useEffect\(\(\) => \{[\s\S]{0,100}persistShowNominalYield/);

  const optionsSource = await readFile(path.join(root, 'src/pages/OptionsPage.tsx'), 'utf8');
  assert.match(optionsSource, /handleShowNominalYieldChange[\s\S]*?persistShowNominalYield\(value\)/);
  assert.doesNotMatch(optionsSource, /useEffect\(\(\) => \{[\s\S]{0,100}persistShowNominalYield/);

  const storage = new MemoryStorage();
  assert.equal(readShowNominalYield(storage), false);
  let preferenceMutations = 0;
  const unsubscribe = subscribeToDurableMutations(event => { if (event.namespace === 'preferences') preferenceMutations += 1; });
  try {
    persistShowNominalYield(true, storage);
  } finally {
    unsubscribe();
  }
  assert.equal(readShowNominalYield(storage), true);
  assert.equal(preferenceMutations, 1);
});

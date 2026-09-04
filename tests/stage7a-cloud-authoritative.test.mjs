import test from 'node:test';
import assert from 'node:assert/strict';
import { AccountStateMemoryStorage } from '../src/lib/cloudState/accountStateStorage.ts';
import { createCloudAuthoritativeAccountStateManager } from '../src/lib/cloudState/accountStateLifecycle.ts';
import { LEGACY_DURABLE_ACCOUNT_KEYS } from '../src/lib/cloudState/legacyAccountCleanup.ts';
import { readPortfolioTrades, writePortfolioTrades, PORTFOLIO_STORAGE_KEY } from '../src/lib/portfolioStorage.ts';
import { readWatchlist, writeWatchlist, WATCHLIST_STORAGE_KEY } from '../src/lib/watchlist.ts';
import { THEME_STORAGE_KEY } from '../src/lib/themePreference.ts';
import { RECOMMENDATIONS_MINIMUM_DTE_KEY } from '../src/lib/recommendationPreferences.ts';
import { PORTFOLIO_EXPIRY_GROUPS_KEY } from '../src/lib/portfolioSchedulePreferences.ts';
import { createPutScannerBackupFromCloudState, validatePutScannerBackup } from '../src/lib/userDataBackup.ts';
import { confirmPortfolioTradeExpiredWorthless } from '../src/lib/portfolioRealizedEconomics.ts';

const userId = '77777777-7777-4777-8777-777777777777';
const fixedNow = new Date('2026-08-29T15:00:00.000Z');

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); this.removes = []; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); this.removes.push(key); }
}

const clone = value => structuredClone(value);
const waitFor = async predicate => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 2));
  }
  assert.fail('Timed out waiting for account-state operation.');
};

const trade = (id, note, overrides = {}) => ({
  id,
  ticker: 'TQQQ',
  optionType: 'put',
  strike: 50,
  expiration: '2026-10-16',
  contracts: 2,
  soldPrice: 1.25,
  soldDate: '2026-08-13',
  status: 'open',
  notes: note,
  entryVixClose: 17.4,
  entryVixDate: '2026-08-13',
  entryVixSource: 'historical_close',
  entryDelta: -0.24,
  entryDeltaSource: 'provider',
  entryDeltaCapturedAt: '2026-08-13T15:31:00.000Z',
  entryIv: 43.8,
  entryIvSource: 'provider',
  entryIvCapturedAt: '2026-08-13T15:31:00.000Z',
  createdAt: '2026-08-13T15:30:00.000Z',
  updatedAt: '2026-08-13T15:30:00.000Z',
  ...overrides,
});

const watch = (note = 'cloud watch') => ({
  id: 'TQQQ|put|2026-10-16|50',
  ticker: 'TQQQ',
  expiry: '2026-10-16',
  expiryTimestamp: 1_792_108_800,
  expiryFormatted: "Oct 16 '26",
  strike: 50,
  optionType: 'put',
  addedAt: 1_765_627_200_000,
  savedAt: 1_765_627_200_000,
  note,
});

function cloudState(portfolio = [trade('cloud-a', 'Portfolio A')], watchlist = [watch()], revisions = {}) {
  return Object.fromEntries(['portfolio', 'watchlist', 'preferences'].map(namespace => [namespace, {
    userId,
    namespace,
    schemaVersion: 1,
    payload: { data: namespace === 'portfolio' ? portfolio : namespace === 'watchlist' ? watchlist : { portfolioMarkBasis: 'bid', recommendationsOnlyAtLeast60Dte: false } },
    revision: revisions[namespace] ?? 10,
    createdAt: fixedNow.toISOString(),
    updatedAt: fixedNow.toISOString(),
  }]));
}

class SharedCloudBackend {
  constructor(state = cloudState()) {
    this.state = clone(state);
    this.fetchAllCalls = 0;
    this.fetchNamespaceCalls = [];
    this.initializeCalls = [];
    this.updateCalls = [];
    this.fetchError = false;
    this.fetchErrorAfter = Number.POSITIVE_INFINITY;
    this.updateError = false;
    this.updateMode = 'normal';
    this.beforeUpdate = null;
  }

  client() {
    return {
      fetchAllUserState: async () => {
        this.fetchAllCalls += 1;
        if (this.fetchError || this.fetchAllCalls > this.fetchErrorAfter) return { ok: false, error: { code: 'network_error', operation: 'fetch_all', message: 'offline' } };
        return this.state === null
          ? { ok: true, value: { status: 'empty' } }
          : { ok: true, value: { status: 'complete', state: clone(this.state) } };
      },
      fetchNamespace: async namespace => {
        this.fetchNamespaceCalls.push(namespace);
        return { ok: true, value: this.state ? clone(this.state[namespace]) : null };
      },
      initializeAllNamespaces: async documents => {
        this.initializeCalls.push(clone(documents));
        this.state = cloudState(documents.portfolio.payload.data, documents.watchlist.payload.data, {
          portfolio: 1, watchlist: 1, preferences: 1,
        });
        this.state.preferences.payload = clone(documents.preferences.payload);
        return { ok: true, value: clone(this.state) };
      },
      updateNamespaceIfRevisionMatches: async (namespace, expectedRevision, schemaVersion, payload) => {
        this.updateCalls.push({ namespace, expectedRevision, schemaVersion, payload: clone(payload) });
        if (this.beforeUpdate) await this.beforeUpdate();
        if (this.updateError) return { ok: false, error: { code: 'network_error', operation: 'update_namespace', namespace, message: 'offline' } };
        const row = this.state?.[namespace];
        if (!row || row.revision !== expectedRevision) {
          return { ok: false, error: { code: 'conflict', operation: 'update_namespace', namespace, message: 'stale' } };
        }
        row.payload = clone(payload);
        row.schemaVersion = schemaVersion;
        row.revision += 1;
        row.updatedAt = fixedNow.toISOString();
        if (this.updateMode === 'partial_then_network_error') {
          row.payload.data = row.payload.data.slice(0, Math.max(1, row.payload.data.length - 1));
          return { ok: false, error: { code: 'network_error', operation: 'update_namespace', namespace, message: 'lost acknowledgement' } };
        }
        if (this.updateMode === 'commit_then_network_error') {
          return { ok: false, error: { code: 'network_error', operation: 'update_namespace', namespace, message: 'lost acknowledgement' } };
        }
        return { ok: true, value: clone(row) };
      },
    };
  }
}

function runtime(backend, legacy = new MemoryStorage(), options = {}) {
  const storage = new AccountStateMemoryStorage();
  const manager = createCloudAuthoritativeAccountStateManager({
    storage,
    legacyStorage: legacy,
    clientForUser: () => backend.client(),
    now: () => fixedNow,
    ...options,
  });
  return { storage, manager, legacy };
}

test('legacy local Portfolio B never displays, pushes, merges, or conflicts with cloud Portfolio A', async t => {
  const legacy = new MemoryStorage({
    [PORTFOLIO_STORAGE_KEY]: JSON.stringify([trade('local-b', 'Portfolio B')]),
    [THEME_STORAGE_KEY]: 'sepia',
    [PORTFOLIO_EXPIRY_GROUPS_KEY]: JSON.stringify({ '2026-10-16': true }),
    price_cache_batch_v5: '{"cache":true}',
  });
  const backend = new SharedCloudBackend(cloudState([trade('cloud-a', 'Portfolio A')]));
  const device = runtime(backend, legacy);
  t.after(() => device.manager.destroy());

  await device.manager.setAccount(userId, true);
  const loaded = readPortfolioTrades(device.storage);
  assert.equal(loaded.status, 'ok');
  assert.deepEqual(loaded.data.map(item => item.notes), ['Portfolio A']);
  assert.equal(loaded.data.some(item => item.notes === 'Portfolio B'), false);
  assert.equal(device.manager.getSnapshot().phase, 'ready');
  assert.equal(backend.updateCalls.length, 0);
  assert.equal(backend.state.portfolio.payload.data[0].notes, 'Portfolio A');
  assert.equal(device.storage.getItem(RECOMMENDATIONS_MINIMUM_DTE_KEY), 'false');
  assert.equal(legacy.getItem(PORTFOLIO_STORAGE_KEY), null);
  assert.equal(legacy.getItem(THEME_STORAGE_KEY), 'sepia');
  assert.equal(legacy.getItem(PORTFOLIO_EXPIRY_GROUPS_KEY), JSON.stringify({ '2026-10-16': true }));
  assert.equal(legacy.getItem('price_cache_batch_v5'), '{"cache":true}');
});

test('cloud-empty Portfolio stays empty when obsolete local Portfolio is populated', async t => {
  const legacy = new MemoryStorage({ [PORTFOLIO_STORAGE_KEY]: JSON.stringify([trade('local-b', 'Portfolio B')]) });
  const backend = new SharedCloudBackend(cloudState([]));
  const device = runtime(backend, legacy);
  t.after(() => device.manager.destroy());
  await device.manager.setAccount(userId, true);
  const loaded = readPortfolioTrades(device.storage);
  assert.equal(loaded.status, 'ok');
  assert.deepEqual(loaded.data, []);
  assert.equal(backend.updateCalls.length, 0);
  assert.deepEqual(backend.state.portfolio.payload.data, []);
});

test('brand-new account initializes three empty cloud namespaces without migrating legacy data', async t => {
  const legacy = new MemoryStorage({ [PORTFOLIO_STORAGE_KEY]: JSON.stringify([trade('local-b', 'Portfolio B')]) });
  const backend = new SharedCloudBackend(null);
  const device = runtime(backend, legacy);
  t.after(() => device.manager.destroy());
  await device.manager.setAccount(userId, true);
  assert.equal(backend.initializeCalls.length, 1);
  assert.deepEqual(backend.initializeCalls[0].portfolio.payload.data, []);
  assert.deepEqual(backend.initializeCalls[0].watchlist.payload.data, []);
  assert.deepEqual(backend.initializeCalls[0].preferences.payload.data, {});
  assert.equal(readPortfolioTrades(device.storage).data.length, 0);
});

test('cloud load failure exposes no account data and does not clean legacy keys', async t => {
  const legacy = new MemoryStorage({ [PORTFOLIO_STORAGE_KEY]: JSON.stringify([trade('local-b', 'Portfolio B')]) });
  const backend = new SharedCloudBackend();
  backend.fetchError = true;
  const device = runtime(backend, legacy);
  t.after(() => device.manager.destroy());
  await device.manager.setAccount(userId, true);
  assert.equal(device.manager.getSnapshot().phase, 'error');
  assert.equal(readPortfolioTrades(device.storage).status, 'missing');
  assert.notEqual(legacy.getItem(PORTFOLIO_STORAGE_KEY), null);
  assert.equal(device.storage.isWritable(), false);
});

test('signed-out account storage is empty, non-durable, and rejects Portfolio/Watchlist saves', async t => {
  const backend = new SharedCloudBackend();
  const device = runtime(backend);
  t.after(() => device.manager.destroy());
  await device.manager.setAccount(null, true);
  assert.equal(readPortfolioTrades(device.storage).status, 'missing');
  assert.equal(readWatchlist(device.storage).status, 'missing');
  assert.equal(writePortfolioTrades(device.storage, [trade('x', 'blocked')]).status, 'error');
  assert.equal(writeWatchlist(device.storage, [watch('blocked')]).status, 'error');
  assert.equal(backend.updateCalls.length, 0);
});

test('sign-out clears cloud account memory and an in-flight save cannot republish it', async t => {
  const backend = new SharedCloudBackend();
  let release;
  backend.beforeUpdate = () => new Promise(resolve => { release = resolve; });
  const device = runtime(backend);
  t.after(() => device.manager.destroy());
  await device.manager.setAccount(userId, true);
  const portfolio = readPortfolioTrades(device.storage);
  assert.equal(writePortfolioTrades(device.storage, portfolio.data.map(item => ({ ...item, notes: 'in flight' }))).status, 'ok');
  await waitFor(() => backend.updateCalls.length === 1);
  await device.manager.setAccount(null, true);
  assert.equal(device.manager.getSnapshot().phase, 'anonymous');
  assert.equal(device.manager.getSnapshot().cloud, null);
  assert.equal(readPortfolioTrades(device.storage).status, 'missing');
  release();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(device.manager.getSnapshot().phase, 'anonymous');
  assert.equal(device.manager.getSnapshot().cloud, null);
  assert.equal(readPortfolioTrades(device.storage).status, 'missing');
});

test('successful Portfolio and Watchlist mutations use cloud CAS and advance revisions', async t => {
  const backend = new SharedCloudBackend();
  const device = runtime(backend);
  t.after(() => device.manager.destroy());
  await device.manager.setAccount(userId, true);
  const portfolio = readPortfolioTrades(device.storage);
  assert.equal(portfolio.status, 'ok');
  assert.equal(writePortfolioTrades(device.storage, portfolio.data.map(item => ({ ...item, notes: 'saved cloud edit' }))).status, 'ok');
  await waitFor(() => device.manager.getSnapshot().phase === 'ready' && backend.updateCalls.length === 1);
  assert.equal(backend.updateCalls[0].expectedRevision, 10);
  assert.equal(backend.state.portfolio.revision, 11);
  assert.equal(backend.state.portfolio.payload.data[0].notes, 'saved cloud edit');

  const watchlist = readWatchlist(device.storage);
  assert.equal(watchlist.status, 'ok');
  assert.equal(writeWatchlist(device.storage, watchlist.data.map(item => ({ ...item, note: 'saved watch edit' }))).status, 'ok');
  await waitFor(() => backend.updateCalls.length === 2 && device.manager.getSnapshot().phase === 'ready');
  assert.equal(backend.state.watchlist.payload.data[0].note, 'saved watch edit');
});

test('account manager reactivates mutation tracking after a Strict Mode cleanup cycle', async t => {
  const backend = new SharedCloudBackend();
  const device = runtime(backend);
  t.after(() => device.manager.destroy());
  device.manager.destroy();
  device.manager.activate();
  await device.manager.setAccount(userId, true);
  const portfolio = readPortfolioTrades(device.storage);
  assert.equal(portfolio.status, 'ok');
  assert.equal(writePortfolioTrades(device.storage, portfolio.data.map(item => ({ ...item, notes: 'strict mode save' }))).status, 'ok');
  await waitFor(() => backend.updateCalls.length === 1 && device.manager.getSnapshot().phase === 'ready');
  assert.equal(backend.state.portfolio.payload.data[0].notes, 'strict mode save');
});

test('failed cloud edit reverts ephemeral Portfolio to the last cloud-saved value', async t => {
  const backend = new SharedCloudBackend();
  const device = runtime(backend);
  t.after(() => device.manager.destroy());
  await device.manager.setAccount(userId, true);
  backend.updateError = true;
  const portfolio = readPortfolioTrades(device.storage);
  assert.equal(writePortfolioTrades(device.storage, portfolio.data.map(item => ({ ...item, notes: 'unsaved edit' }))).status, 'ok');
  await waitFor(() => device.manager.getSnapshot().phase === 'error');
  const reverted = readPortfolioTrades(device.storage);
  assert.equal(reverted.status, 'ok');
  assert.equal(reverted.data[0].notes, 'Portfolio A');
  assert.equal(backend.state.portfolio.payload.data[0].notes, 'Portfolio A');
});

test('two devices use stale-CAS protection; stale device reloads latest and can retry explicitly', async t => {
  const backend = new SharedCloudBackend();
  const a = runtime(backend);
  const b = runtime(backend);
  t.after(() => { a.manager.destroy(); b.manager.destroy(); });
  await a.manager.setAccount(userId, true);
  await b.manager.setAccount(userId, true);

  const aPortfolio = readPortfolioTrades(a.storage);
  assert.equal(writePortfolioTrades(a.storage, aPortfolio.data.map(item => ({ ...item, notes: 'Device A' }))).status, 'ok');
  await waitFor(() => backend.state.portfolio.revision === 11);

  const bPortfolio = readPortfolioTrades(b.storage);
  assert.equal(writePortfolioTrades(b.storage, bPortfolio.data.map(item => ({ ...item, notes: 'Device B stale' }))).status, 'ok');
  await waitFor(() => b.manager.getSnapshot().phase === 'conflict');
  assert.equal(backend.state.portfolio.payload.data[0].notes, 'Device A');
  assert.equal(readPortfolioTrades(b.storage).data[0].notes, 'Device A');

  assert.deepEqual(await b.manager.reload(), { ok: true });
  const latest = readPortfolioTrades(b.storage);
  assert.equal(writePortfolioTrades(b.storage, latest.data.map(item => ({ ...item, notes: 'Device B retry' }))).status, 'ok');
  await waitFor(() => backend.state.portfolio.revision === 12);
  assert.equal(backend.state.portfolio.payload.data[0].notes, 'Device B retry');
});

test('realized Sold Price, Entry Delta, and Entry IV edits survive CAS, conflict rollback, and fresh cloud bootstrap', async t => {
  const realized = trade('realized', 'history', {
    status: 'closed', closePrice: 0.5, closeDate: '2026-09-01', premiumCollected: 250, realizedPnl: 150, percentCaptured: 0.6,
  });
  const backend = new SharedCloudBackend(cloudState([realized]));
  const a = runtime(backend);
  const stale = runtime(backend);
  t.after(() => { a.manager.destroy(); stale.manager.destroy(); });
  await a.manager.setAccount(userId, true);
  await stale.manager.setAccount(userId, true);

  const aState = readPortfolioTrades(a.storage);
  assert.equal(writePortfolioTrades(a.storage, aState.data.map(item => ({
    ...item,
    soldPrice: 2.3456,
    premiumCollected: 469.12,
    realizedPnl: 369.12,
    percentCaptured: 369.12 / 469.12,
    entryDelta: -0.31,
    entryDeltaSource: 'manual',
    entryDeltaCapturedAt: '2026-08-30T12:00:00.000Z',
    entryIv: 71.2,
    entryIvSource: 'manual',
    entryIvCapturedAt: '2026-08-30T12:00:00.000Z',
  }))).status, 'ok');
  await waitFor(() => backend.state.portfolio.revision === 11);
  assert.deepEqual(
    [backend.state.portfolio.payload.data[0].soldPrice, backend.state.portfolio.payload.data[0].premiumCollected, backend.state.portfolio.payload.data[0].realizedPnl, backend.state.portfolio.payload.data[0].entryDelta, backend.state.portfolio.payload.data[0].entryIv],
    [2.3456, 469.12, 369.12, -0.31, 71.2],
  );

  const staleState = readPortfolioTrades(stale.storage);
  assert.equal(writePortfolioTrades(stale.storage, staleState.data.map(item => ({ ...item, notes: 'stale runtime write' }))).status, 'ok');
  await waitFor(() => stale.manager.getSnapshot().phase === 'conflict');
  assert.equal(backend.state.portfolio.payload.data[0].soldPrice, 2.3456);
  assert.deepEqual(
    [readPortfolioTrades(stale.storage).data[0].soldPrice, readPortfolioTrades(stale.storage).data[0].entryDelta, readPortfolioTrades(stale.storage).data[0].entryIv],
    [2.3456, -0.31, 71.2],
    'conflict rollback hydrates the authoritative edited economics',
  );

  const fresh = runtime(backend);
  t.after(() => fresh.manager.destroy());
  await fresh.manager.setAccount(userId, true);
  const bootstrapped = readPortfolioTrades(fresh.storage).data[0];
  assert.deepEqual([bootstrapped.soldPrice, bootstrapped.premiumCollected, bootstrapped.realizedPnl, bootstrapped.entryDelta, bootstrapped.entryIv], [2.3456, 469.12, 369.12, -0.31, 71.2]);
});

test('manual worthless confirmation survives cloud CAS, sign-in bootstrap, backup, and restore without an expiration price', async t => {
  const pending = trade('pending-worthless', 'Corporate-action basis unresolved', {
    expiration: '2026-07-17',
    soldDate: '2026-06-20',
    status: 'expired_price_pending',
    resolutionType: 'expired_price_pending',
    resolutionWarning: 'Expiration economics remain pending because Yahoo reported an in-contract corporate action (dividend); adjusted option deliverables are not stored.',
  });
  const backend = new SharedCloudBackend(cloudState([pending]));
  const device = runtime(backend);
  const stale = runtime(backend);
  t.after(() => { device.manager.destroy(); stale.manager.destroy(); });
  await device.manager.setAccount(userId, true);
  await stale.manager.setAccount(userId, true);

  const current = readPortfolioTrades(device.storage);
  const confirmed = confirmPortfolioTradeExpiredWorthless(current.data[0], fixedNow);
  assert.ok(confirmed);
  assert.equal(writePortfolioTrades(device.storage, [confirmed], { now: fixedNow }).status, 'ok');
  await waitFor(() => backend.state.portfolio.revision === 11 && device.manager.getSnapshot().phase === 'ready');
  assert.deepEqual(
    [backend.state.portfolio.payload.data[0].status, backend.state.portfolio.payload.data[0].resolutionType, backend.state.portfolio.payload.data[0].resolutionSource, backend.state.portfolio.payload.data[0].finalOptionValue, backend.state.portfolio.payload.data[0].realizedPnl, backend.state.portfolio.payload.data[0].percentCaptured],
    ['expired', 'expired_worthless', 'manual_worthless_confirmation', 0, 250, 1],
  );
  assert.equal(backend.state.portfolio.payload.data[0].expirationClosePrice, undefined);
  assert.doesNotMatch(JSON.stringify(backend.state.portfolio.payload.data[0]), /expirationClosePrice/);

  const backup = createPutScannerBackupFromCloudState(device.manager.getSnapshot().cloud, { now: fixedNow, appVersion: '7.0.0' });
  assert.equal(backup.data.portfolio.data[0].resolutionSource, 'manual_worthless_confirmation');
  assert.equal(backup.data.portfolio.data[0].expirationClosePrice, undefined);
  assert.doesNotMatch(JSON.stringify(backup.data.portfolio.data[0]), /expirationClosePrice/);

  const staleState = readPortfolioTrades(stale.storage);
  assert.equal(writePortfolioTrades(stale.storage, staleState.data.map(item => ({ ...item, notes: 'stale overwrite' }))).status, 'ok');
  await waitFor(() => stale.manager.getSnapshot().phase === 'conflict');
  assert.equal(backend.state.portfolio.payload.data[0].resolutionSource, 'manual_worthless_confirmation');
  assert.equal(readPortfolioTrades(stale.storage).data[0].resolutionSource, 'manual_worthless_confirmation', 'stale CAS rollback restores the authoritative attestation');
  stale.manager.destroy();

  await device.manager.setAccount(null, true);
  assert.equal(readPortfolioTrades(device.storage).status, 'missing');
  await device.manager.setAccount(userId, true);
  const bootstrapped = readPortfolioTrades(device.storage).data[0];
  assert.equal(bootstrapped.resolutionSource, 'manual_worthless_confirmation');
  assert.equal(bootstrapped.expirationClosePrice, undefined);

  assert.equal(writePortfolioTrades(device.storage, [{ ...bootstrapped, notes: 'temporary later change' }], { now: fixedNow }).status, 'ok');
  await waitFor(() => backend.state.portfolio.revision === 12 && device.manager.getSnapshot().phase === 'ready');
  assert.deepEqual(await device.manager.restoreBackup(backup), { ok: true });
  assert.equal(backend.state.portfolio.payload.data[0].resolutionSource, 'manual_worthless_confirmation');
  assert.equal(backend.state.portfolio.payload.data[0].notes, 'Corporate-action basis unresolved');
  assert.equal(backend.state.portfolio.payload.data[0].expirationClosePrice, undefined);
  assert.doesNotMatch(JSON.stringify(backend.state.portfolio.payload.data[0]), /expirationClosePrice/);
});

test('quote-only refresh stays transient and creates zero cloud durable writes', async t => {
  const backend = new SharedCloudBackend();
  const device = runtime(backend);
  t.after(() => device.manager.destroy());
  await device.manager.setAccount(userId, true);
  const portfolio = readPortfolioTrades(device.storage);
  assert.equal(portfolio.status, 'ok');
  assert.equal(writePortfolioTrades(device.storage, portfolio.data.map(item => ({
    ...item,
    latestMarketData: { optionBid: 0.8, optionAsk: 0.9, refreshedAt: fixedNow.toISOString() },
  }))).status, 'ok');
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(backend.updateCalls.length, 0);
  assert.equal(backend.state.portfolio.payload.data[0].latestMarketData, undefined);
});

test('signed-in backup is built from canonical cloud rows and explicit restore uses CAS', async t => {
  const backend = new SharedCloudBackend();
  const device = runtime(backend);
  t.after(() => device.manager.destroy());
  await device.manager.setAccount(userId, true);
  const cloud = device.manager.getSnapshot().cloud;
  assert.ok(cloud);
  const backup = createPutScannerBackupFromCloudState(cloud, { now: fixedNow, appVersion: '7.0.0' });
  assert.equal(backup.data.portfolio.data[0].entryDelta, -0.24);
  assert.equal(backup.data.portfolio.data[0].entryIv, 43.8);
  assert.equal(backup.data.portfolio.revision, 10);

  const edited = validatePutScannerBackup(clone(backup));
  edited.data.portfolio.data[0].notes = 'restored note';
  edited.data.watchlist.data[0].note = 'restored watch';
  const result = await device.manager.restoreBackup(edited);
  assert.deepEqual(result, { ok: true });
  assert.equal(backend.state.portfolio.payload.data[0].notes, 'restored note');
  assert.equal(backend.state.watchlist.payload.data[0].note, 'restored watch');
  assert.equal(backend.updateCalls.every(call => call.expectedRevision === 10), true);
});

test('legacy cleanup is an explicit account-only allowlist', () => {
  assert.deepEqual([...LEGACY_DURABLE_ACCOUNT_KEYS], [
    'put_scanner_portfolio_trades',
    'put_scanner_watchlist',
    'watchlist',
    'put_scanner_portfolio_mark_basis',
    'put_scanner_portfolio_group_mode:v1',
    'put_scanner_show_nominal_yield:v1',
    'put_scanner_cloud_sync_meta:v1',
    'put_scanner_cloud_sync_engine:v1',
    'put_scanner_cloud_device_id:v1',
  ]);
});

const historicalImportLot = (id, overrides = {}) => ({
  id,
  ticker: 'SPXL',
  optionType: 'put',
  strike: 30,
  expiration: '2026-06-19',
  contracts: 1,
  soldPrice: 1.5,
  soldDate: '2026-05-01',
  status: 'expired',
  closePrice: 0,
  closeDate: '2026-06-19',
  resolvedDate: '2026-06-19',
  resolutionType: 'expired_worthless',
  expirationClosePrice: 35,
  expirationCloseDate: '2026-06-19',
  finalOptionValue: 0,
  realizedPnl: 150,
  percentCaptured: 1,
  premiumCollected: 150,
  daysHeld: 49,
  entryDelta: -0.2,
  entryDeltaSource: 'imported',
  entryDeltaCapturedAt: fixedNow.toISOString(),
  entryIv: 50,
  entryIvSource: 'imported',
  entryIvCapturedAt: fixedNow.toISOString(),
  resolutionSource: 'manual_expiration_close',
  resolutionWarning: 'Historical underlying expiration price imported from source workbook; not provider-verified.',
  createdAt: fixedNow.toISOString(),
  updatedAt: fixedNow.toISOString(),
  ...overrides,
});

function historicalImportRequest(device, lots, overrides = {}) {
  return {
    reviewPortfolioRevision: device.manager.getSnapshot().cloud?.portfolio.revision ?? 0,
    trades: lots,
    acknowledgedExistingDuplicateIds: [],
    appVersion: '7.0.0',
    downloadBackup: () => {},
    ...overrides,
  };
}

test('historical bulk import is signed-in/ready-only and pending writes block it', async t => {
  const backend = new SharedCloudBackend();
  const device = runtime(backend);
  t.after(() => device.manager.destroy());
  await device.manager.setAccount(null, true);
  assert.equal((await device.manager.commitHistoricalPortfolioImport({
    reviewPortfolioRevision: 10,
    trades: [historicalImportLot('import-a')],
    acknowledgedExistingDuplicateIds: [],
    appVersion: '7.0.0',
    downloadBackup: () => {},
  })).ok, false);
  assert.equal(backend.updateCalls.length, 0);

  await device.manager.setAccount(userId, false);
  const unavailable = await device.manager.commitHistoricalPortfolioImport({
    reviewPortfolioRevision: 10,
    trades: [historicalImportLot('import-unavailable')],
    acknowledgedExistingDuplicateIds: [],
    appVersion: '7.0.0',
    downloadBackup: () => {},
  });
  assert.equal(unavailable.ok, false);
  assert.equal(backend.updateCalls.length, 0);

  await device.manager.setAccount(userId, true);
  let release;
  backend.beforeUpdate = () => new Promise(resolve => { release = resolve; });
  const current = readPortfolioTrades(device.storage);
  assert.equal(writePortfolioTrades(device.storage, current.data.map(item => ({ ...item, notes: 'pending' }))).status, 'ok');
  await waitFor(() => device.manager.getSnapshot().pendingWrites === 1);
  const blocked = await device.manager.commitHistoricalPortfolioImport(historicalImportRequest(device, [historicalImportLot('import-b')]));
  assert.equal(blocked.ok, false);
  assert.equal(backend.updateCalls.length, 1, 'only the already-pending ordinary write reached cloud');
  release();
});

test('N historical lots use one Portfolio CAS after latest-state backup and authoritative read-back', async t => {
  const backend = new SharedCloudBackend();
  const beforeWatchlist = clone(backend.state.watchlist);
  const beforePreferences = clone(backend.state.preferences);
  const beforePortfolio = clone(backend.state.portfolio.payload.data);
  const device = runtime(backend);
  t.after(() => device.manager.destroy());
  await device.manager.setAccount(userId, true);
  let downloadedBackup = null;
  const lots = [historicalImportLot('import-a'), historicalImportLot('import-b', { soldDate: '2026-05-02', soldPrice: 1.6 })];
  const result = await device.manager.commitHistoricalPortfolioImport(historicalImportRequest(device, lots, {
    downloadBackup: backup => { downloadedBackup = clone(backup); },
  }));
  assert.equal(result.ok, true);
  assert.equal(result.importedCount, 2);
  assert.match(result.backupFilename, /^pre-historical-import-backup-/);
  assert.equal(downloadedBackup.data.portfolio.data.length, 1, 'backup contains the pre-import Portfolio');
  assert.equal(downloadedBackup.data.portfolio.revision, 10);
  assert.equal(backend.updateCalls.length, 1);
  assert.deepEqual(
    [backend.updateCalls[0].namespace, backend.updateCalls[0].expectedRevision, backend.updateCalls[0].schemaVersion],
    ['portfolio', 10, 1],
  );
  assert.deepEqual(backend.updateCalls[0].payload.data.map(item => item.id), ['cloud-a', 'import-a', 'import-b']);
  assert.equal(backend.fetchAllCalls, 3, 'bootstrap, latest pre-commit state, and authoritative read-back');
  assert.deepEqual(backend.state.watchlist, beforeWatchlist);
  assert.deepEqual(backend.state.preferences, beforePreferences);
  assert.deepEqual(
    JSON.parse(JSON.stringify(backend.state.portfolio.payload.data.slice(0, beforePortfolio.length))),
    JSON.parse(JSON.stringify(beforePortfolio)),
  );
  assert.deepEqual(readPortfolioTrades(device.storage).data.map(item => item.id), ['cloud-a', 'import-a', 'import-b']);
  assert.equal(device.manager.getSnapshot().phase, 'ready');
});

test('revision change and final duplicate recheck stop import before backup or mutation', async t => {
  const backend = new SharedCloudBackend();
  const device = runtime(backend);
  t.after(() => device.manager.destroy());
  await device.manager.setAccount(userId, true);
  const request = historicalImportRequest(device, [historicalImportLot('import-a')]);
  let backups = 0;
  request.downloadBackup = () => { backups += 1; };
  backend.state.portfolio.revision += 1;
  const changed = await device.manager.commitHistoricalPortfolioImport(request);
  assert.equal(changed.code, 'revision_changed');
  assert.equal(backups, 0);
  assert.equal(backend.updateCalls.length, 0);

  const duplicateBackend = new SharedCloudBackend(cloudState([historicalImportLot('existing-copy')]));
  const duplicateDevice = runtime(duplicateBackend);
  t.after(() => duplicateDevice.manager.destroy());
  await duplicateDevice.manager.setAccount(userId, true);
  const duplicate = await duplicateDevice.manager.commitHistoricalPortfolioImport(historicalImportRequest(duplicateDevice, [historicalImportLot('incoming-copy')]));
  assert.equal(duplicate.code, 'duplicate_state_changed');
  assert.equal(duplicateBackend.updateCalls.length, 0);
});

test('backup creation/download failure produces zero cloud mutations', async t => {
  const backend = new SharedCloudBackend();
  const device = runtime(backend);
  t.after(() => device.manager.destroy());
  await device.manager.setAccount(userId, true);
  const result = await device.manager.commitHistoricalPortfolioImport(historicalImportRequest(device, [historicalImportLot('import-a')], {
    downloadBackup: () => { throw new Error('download unavailable'); },
  }));
  assert.equal(result.code, 'backup_failed');
  assert.equal(backend.updateCalls.length, 0);
  assert.deepEqual(backend.state.portfolio.payload.data.map(item => item.id), ['cloud-a']);

  const invalidBackend = new SharedCloudBackend();
  const invalidBackupDevice = runtime(invalidBackend, new MemoryStorage(), {
    createHistoricalImportBackup: () => ({ format: 'not-a-put-scanner-backup' }),
  });
  t.after(() => invalidBackupDevice.manager.destroy());
  await invalidBackupDevice.manager.setAccount(userId, true);
  const invalidBackup = await invalidBackupDevice.manager.commitHistoricalPortfolioImport(
    historicalImportRequest(invalidBackupDevice, [historicalImportLot('import-invalid-backup')]),
  );
  assert.equal(invalidBackup.code, 'backup_failed');
  assert.equal(invalidBackend.updateCalls.length, 0);
});

test('CAS conflict is never retried and latest canonical state is restored', async t => {
  const backend = new SharedCloudBackend();
  const device = runtime(backend);
  t.after(() => device.manager.destroy());
  await device.manager.setAccount(userId, true);
  backend.beforeUpdate = async () => { backend.state.portfolio.revision += 1; };
  const result = await device.manager.commitHistoricalPortfolioImport(historicalImportRequest(device, [historicalImportLot('import-a')]));
  assert.equal(result.code, 'conflict');
  assert.equal(backend.updateCalls.length, 1);
  assert.equal(backend.state.portfolio.payload.data.some(item => item.id === 'import-a'), false);
  assert.equal(device.manager.getSnapshot().phase, 'conflict');
});

test('lost acknowledgement is read back and recognized as committed without duplicate retry', async t => {
  const backend = new SharedCloudBackend();
  backend.updateMode = 'commit_then_network_error';
  const device = runtime(backend);
  t.after(() => device.manager.destroy());
  await device.manager.setAccount(userId, true);
  const result = await device.manager.commitHistoricalPortfolioImport(historicalImportRequest(device, [historicalImportLot('import-a')]));
  assert.equal(result.ok, true);
  assert.equal(backend.updateCalls.length, 1);
  assert.equal(backend.state.portfolio.payload.data.filter(item => item.id === 'import-a').length, 1);
  assert.equal(readPortfolioTrades(device.storage).data.filter(item => item.id === 'import-a').length, 1);
});

test('ambiguous failure proven uncommitted is safe, while partial or unavailable read-back requires verification', async t => {
  const notCommitted = new SharedCloudBackend();
  notCommitted.updateError = true;
  const safeDevice = runtime(notCommitted);
  t.after(() => safeDevice.manager.destroy());
  await safeDevice.manager.setAccount(userId, true);
  const safe = await safeDevice.manager.commitHistoricalPortfolioImport(historicalImportRequest(safeDevice, [historicalImportLot('import-safe')]));
  assert.equal(safe.code, 'network_error');
  assert.equal(notCommitted.updateCalls.length, 1);
  assert.equal(notCommitted.state.portfolio.payload.data.some(item => item.id === 'import-safe'), false);

  const partial = new SharedCloudBackend();
  partial.updateMode = 'partial_then_network_error';
  const partialDevice = runtime(partial);
  t.after(() => partialDevice.manager.destroy());
  await partialDevice.manager.setAccount(userId, true);
  const partialResult = await partialDevice.manager.commitHistoricalPortfolioImport(historicalImportRequest(partialDevice, [
    historicalImportLot('partial-a'), historicalImportLot('partial-b', { soldPrice: 1.6 }),
  ]));
  assert.equal(partialResult.code, 'verification_required');
  assert.equal(partial.updateCalls.length, 1);
  assert.equal(partialDevice.manager.getSnapshot().phase, 'error');

  const unavailable = new SharedCloudBackend();
  const unavailableDevice = runtime(unavailable);
  t.after(() => unavailableDevice.manager.destroy());
  await unavailableDevice.manager.setAccount(userId, true);
  unavailable.fetchErrorAfter = 2;
  const unavailableResult = await unavailableDevice.manager.commitHistoricalPortfolioImport(historicalImportRequest(unavailableDevice, [historicalImportLot('unavailable-a')]));
  assert.equal(unavailableResult.code, 'verification_required');
  assert.equal(unavailable.updateCalls.length, 1);
  assert.equal(unavailableDevice.manager.getSnapshot().phase, 'error');
});

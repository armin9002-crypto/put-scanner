import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyPutScannerBackup,
  createPutScannerBackup,
  parsePutScannerBackup,
  serializePutScannerBackup,
  validatePutScannerBackup,
} from '../src/lib/userDataBackup.ts';
import { PORTFOLIO_STORAGE_KEY } from '../src/lib/portfolioStorage.ts';
import { WATCHLIST_STORAGE_KEY } from '../src/lib/watchlist.ts';
import { SHOW_NOMINAL_YIELD_KEY } from '../src/lib/optionTablePreferences.ts';
import { PORTFOLIO_MARK_BASIS_KEY } from '../src/lib/portfolioMarkPreference.ts';
import {
  PORTFOLIO_EXPIRY_GROUPS_KEY,
  PORTFOLIO_GROUP_MODE_KEY,
  PORTFOLIO_UNDERLYING_GROUPS_KEY,
} from '../src/lib/portfolioSchedulePreferences.ts';
import { THEME_STORAGE_KEY } from '../src/lib/themePreference.ts';

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
    this.failOnKey = null;
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    if (key === this.failOnKey) {
      this.failOnKey = null;
      throw new Error('quota exceeded');
    }
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const openTrade = (overrides = {}) => ({
  id: 'trade-open',
  ticker: 'TQQQ',
  optionType: 'put',
  strike: 50,
  expiration: '2026-10-16',
  contracts: 2,
  soldPrice: 1.25,
  soldDate: '2026-08-13',
  status: 'open',
  notes: 'Owner note',
  createdAt: '2026-08-13T12:00:00.000Z',
  updatedAt: '2026-08-13T12:00:00.000Z',
  entrySnapshot: { underlyingPrice: 62, bid: 1.2, ask: 1.3 },
  latestMarketData: { optionBid: 0.9, optionAsk: 1.1, refreshedAt: '2026-08-13T13:00:00.000Z' },
  ...overrides,
});

const watchlistItem = (overrides = {}) => ({
  id: 'TQQQ|put|2026-10-16|50',
  ticker: 'TQQQ',
  expiry: '2026-10-16',
  expiryTimestamp: 1792108800,
  expiryFormatted: "Oct 16 '26",
  strike: 50,
  optionType: 'put',
  addedAt: 1_765_627_200_000,
  savedAt: 1_765_627_200_000,
  updatedAt: 1_765_630_800_000,
  note: 'Wait for red day',
  status: 'live',
  snapshot: { bid: 1.2, ask: 1.3, underlyingPrice: 62 },
  ...overrides,
});

function seededStorage() {
  return new MemoryStorage({
    [PORTFOLIO_STORAGE_KEY]: JSON.stringify([
      openTrade(),
      openTrade({
        id: 'trade-history',
        status: 'closed',
        closePrice: 0.25,
        closeDate: '2026-08-20',
        realizedPnl: 200,
      }),
    ]),
    [WATCHLIST_STORAGE_KEY]: JSON.stringify([watchlistItem()]),
    [THEME_STORAGE_KEY]: 'sepia',
    [PORTFOLIO_MARK_BASIS_KEY]: 'bid',
    [PORTFOLIO_GROUP_MODE_KEY]: 'underlying',
    [PORTFOLIO_EXPIRY_GROUPS_KEY]: JSON.stringify({ '2026-10-16': true }),
    [PORTFOLIO_UNDERLYING_GROUPS_KEY]: JSON.stringify({ TQQQ: false }),
    [SHOW_NOMINAL_YIELD_KEY]: 'true',
    price_cache_batch_v5: JSON.stringify({ data: { SECRET_CACHE_SENTINEL: 123 } }),
    scanner_option_snapshots_v2: JSON.stringify({ SECRET_SNAPSHOT_SENTINEL: true }),
    'chart_history_cache:TQQQ:2Y': JSON.stringify({ data: { SECRET_CHART_SENTINEL: true } }),
  });
}

test('export creates the versioned format with every durable namespace and no market caches', () => {
  const backup = createPutScannerBackup(seededStorage(), {
    now: new Date('2026-08-13T23:42:00.000Z'),
    appVersion: '1.2.3',
  });
  assert.equal(backup.format, 'put-scanner-backup');
  assert.equal(backup.schemaVersion, 2);
  assert.equal(backup.exportedAt, '2026-08-13T23:42:00.000Z');
  assert.equal(backup.appVersion, '1.2.3');
  assert.deepEqual(Object.keys(backup.data).sort(), ['portfolio', 'preferences', 'watchlist']);
  assert.equal(backup.data.portfolio.schemaVersion, 1);
  assert.equal(backup.data.watchlist.schemaVersion, 1);
  assert.equal(backup.data.preferences.schemaVersion, 1);
  assert.equal(backup.data.portfolio.data.length, 2);
  assert.equal(backup.data.watchlist.data.length, 1);
  assert.equal(backup.data.preferences.data.theme, 'sepia');
  assert.equal(backup.data.preferences.data.portfolioMarkBasis, 'bid');
  assert.equal(backup.data.preferences.data.portfolioGroupMode, 'underlying');
  assert.equal(backup.data.preferences.data.showNominalYield, true);

  const serialized = serializePutScannerBackup(backup);
  assert.doesNotMatch(serialized, /SECRET_CACHE_SENTINEL|SECRET_SNAPSHOT_SENTINEL|SECRET_CHART_SENTINEL/);
  assert.doesNotMatch(serialized, /latestMarketData|"snapshot"|"status": "live"|"updatedAt": 1765630800000/);
  assert.match(serialized, /Owner note|Wait for red day|entrySnapshot|realizedPnl/);
});

test('valid import roundtrip reproduces durable state without network calls or duplicate appends', () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    throw new Error('backup must not use the network');
  };
  try {
    const source = seededStorage();
    const exported = createPutScannerBackup(source, { now: new Date('2026-08-13T23:42:00.000Z') });
    const destination = new MemoryStorage({
      [PORTFOLIO_STORAGE_KEY]: JSON.stringify([openTrade({ id: 'old-trade' })]),
      [WATCHLIST_STORAGE_KEY]: JSON.stringify([]),
    });
    applyPutScannerBackup(destination, exported);
    applyPutScannerBackup(destination, exported);
    const roundtrip = createPutScannerBackup(destination, { now: new Date('2026-08-14T00:00:00.000Z') });
    assert.deepEqual(roundtrip.data, exported.data);
    assert.equal(JSON.parse(destination.getItem(PORTFOLIO_STORAGE_KEY)).data.length, 2);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a pre-Stage-1.5 schema v1 backup migrates explicitly and imports safely', () => {
  const { latestMarketData: _market, ...durableTrade } = openTrade();
  const { snapshot: _snapshot, status: _status, updatedAt: _updatedAt, ...durableWatch } = watchlistItem();
  const legacyBackup = {
    format: 'put-scanner-backup',
    schemaVersion: 1,
    exportedAt: '2026-08-13T23:42:00.000Z',
    appVersion: '0.0.0',
    data: {
      portfolio: [durableTrade],
      watchlist: [durableWatch],
      preferences: { theme: 'light', portfolioMarkBasis: 'last' },
    },
  };

  const migrated = validatePutScannerBackup(legacyBackup);
  assert.equal(migrated.schemaVersion, 2);
  assert.equal(migrated.data.portfolio.schemaVersion, 1);
  assert.equal(migrated.data.portfolio.updatedAt, null);
  assert.equal(migrated.data.portfolio.data[0].id, 'trade-open');
  assert.equal(migrated.data.preferences.data.theme, 'light');

  const destination = new MemoryStorage();
  applyPutScannerBackup(destination, legacyBackup);
  const storedPortfolio = JSON.parse(destination.getItem(PORTFOLIO_STORAGE_KEY));
  assert.equal(storedPortfolio.schemaVersion, 1);
  assert.equal(storedPortfolio.data[0].id, 'trade-open');
  assert.equal('latestMarketData' in storedPortfolio.data[0], false);
});

test('malformed JSON, wrong formats, and unsupported future schemas are rejected', () => {
  assert.throws(() => parsePutScannerBackup('{broken'), /not valid JSON/);
  assert.throws(() => validatePutScannerBackup({ format: 'other', schemaVersion: 1 }), /not a Put Scanner backup/);
  assert.throws(() => validatePutScannerBackup({ format: 'put-scanner-backup', schemaVersion: 3 }), /newer than this app supports/);
});

test('validation failures do not alter current state', () => {
  const storage = seededStorage();
  const before = new Map(storage.values);
  assert.throws(() => applyPutScannerBackup(storage, {
    format: 'put-scanner-backup',
    schemaVersion: 1,
    exportedAt: '2026-08-13T23:42:00.000Z',
    appVersion: '1.0.0',
    data: { portfolio: 'not-an-array', watchlist: [], preferences: {} },
  }), /data\.portfolio: Portfolio data must be an array/);
  assert.deepEqual(storage.values, before);
});

test('missing optional preferences preserve the browser preferences already in place', () => {
  const backup = createPutScannerBackup(seededStorage());
  backup.data.preferences.data = {};
  const destination = new MemoryStorage({
    [PORTFOLIO_STORAGE_KEY]: '[]',
    [WATCHLIST_STORAGE_KEY]: '[]',
    [THEME_STORAGE_KEY]: 'light',
    [PORTFOLIO_MARK_BASIS_KEY]: 'last',
    [PORTFOLIO_GROUP_MODE_KEY]: 'none',
  });
  applyPutScannerBackup(destination, backup);
  assert.equal(destination.getItem(THEME_STORAGE_KEY), 'light');
  assert.equal(destination.getItem(PORTFOLIO_MARK_BASIS_KEY), 'last');
  assert.equal(destination.getItem(PORTFOLIO_GROUP_MODE_KEY), 'none');
});

test('a write failure rolls back keys already changed', () => {
  const backup = createPutScannerBackup(seededStorage());
  const destination = new MemoryStorage({
    [PORTFOLIO_STORAGE_KEY]: JSON.stringify([openTrade({ id: 'keep-me' })]),
    [WATCHLIST_STORAGE_KEY]: JSON.stringify([watchlistItem({ note: 'keep this too' })]),
  });
  const beforePortfolio = destination.getItem(PORTFOLIO_STORAGE_KEY);
  const beforeWatchlist = destination.getItem(WATCHLIST_STORAGE_KEY);
  destination.failOnKey = WATCHLIST_STORAGE_KEY;
  assert.throws(() => applyPutScannerBackup(destination, backup), /Current data was restored/);
  assert.equal(destination.getItem(PORTFOLIO_STORAGE_KEY), beforePortfolio);
  assert.equal(destination.getItem(WATCHLIST_STORAGE_KEY), beforeWatchlist);
});

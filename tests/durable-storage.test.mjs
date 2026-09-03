import test from 'node:test';
import assert from 'node:assert/strict';
import {
  migratePortfolioState,
  PORTFOLIO_STORAGE_KEY,
  readPortfolioTrades,
  toDurablePortfolioState,
  writePortfolioTrades,
} from '../src/lib/portfolioStorage.ts';
import {
  LEGACY_WATCHLIST_STORAGE_KEY,
  migrateWatchlistState,
  readWatchlist,
  toDurableWatchlistState,
  WATCHLIST_STORAGE_KEY,
  writeWatchlist,
} from '../src/lib/watchlist.ts';
import { migratePreferencesState, readDurablePreferences } from '../src/lib/durablePreferences.ts';
import { writeValidatedStorageValue } from '../src/lib/durableStorage.ts';
import { SHOW_NOMINAL_YIELD_KEY } from '../src/lib/optionTablePreferences.ts';
import { RECOMMENDATIONS_MINIMUM_DTE_KEY } from '../src/lib/recommendationPreferences.ts';
import { PORTFOLIO_MARK_BASIS_KEY } from '../src/lib/portfolioMarkPreference.ts';
import {
  PORTFOLIO_EXPIRY_GROUPS_KEY,
  PORTFOLIO_GROUP_MODE_KEY,
  PORTFOLIO_UNDERLYING_GROUPS_KEY,
} from '../src/lib/portfolioSchedulePreferences.ts';
import { LEGACY_THEME_STORAGE_KEY, THEME_STORAGE_KEY } from '../src/lib/themePreference.ts';

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
    this.writes = [];
    this.failOnKey = null;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (key === this.failOnKey) throw new Error('quota exceeded');
    this.writes.push([key, String(value)]);
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }
}

const trade = (overrides = {}) => ({
  id: 'trade-1',
  ticker: 'TQQQ',
  optionType: 'put',
  strike: 50,
  expiration: '2026-10-16',
  contracts: 2,
  soldPrice: 1.25,
  soldDate: '2026-08-13',
  status: 'open',
  notes: 'owner fact',
  createdAt: '2026-08-13T12:00:00.000Z',
  updatedAt: '2026-08-13T12:00:00.000Z',
  latestMarketData: { optionBid: 0.9, optionAsk: 1.1, volume: 120, refreshedAt: '2026-08-13T13:00:00.000Z' },
  ...overrides,
});

const item = (overrides = {}) => ({
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
  note: 'wait for red day',
  status: 'live',
  snapshot: { bid: 1.2, ask: 1.3, openInterest: 200 },
  ...overrides,
});

test('portfolio distinguishes valid legacy, valid empty, and missing without writing', () => {
  const populated = new MemoryStorage({ [PORTFOLIO_STORAGE_KEY]: JSON.stringify([trade()]) });
  const result = readPortfolioTrades(populated);
  assert.equal(result.status, 'ok');
  assert.equal(result.schemaVersion, 0);
  assert.equal(result.data[0].id, 'trade-1');
  assert.equal(result.data[0].latestMarketData.optionBid, 0.9);
  assert.equal(populated.writes.length, 0);

  const empty = new MemoryStorage({ [PORTFOLIO_STORAGE_KEY]: '[]' });
  assert.deepEqual(readPortfolioTrades(empty), {
    status: 'ok', data: [], schemaVersion: 0, source: 'legacy', updatedAt: null, revision: 0,
  });
  assert.equal(empty.writes.length, 0);
  assert.equal(readPortfolioTrades(new MemoryStorage()).status, 'missing');
});

test('portfolio corruption, wrong roots, partial corruption, and future schemas preserve raw storage', () => {
  const cases = [
    '{broken',
    JSON.stringify({ trades: [] }),
    JSON.stringify([trade(), trade({ id: 'trade-2', strike: 'not-a-strike' })]),
  ];
  for (const raw of cases) {
    const storage = new MemoryStorage({ [PORTFOLIO_STORAGE_KEY]: raw });
    assert.equal(readPortfolioTrades(storage).status, 'corrupt');
    assert.equal(storage.getItem(PORTFOLIO_STORAGE_KEY), raw);
    assert.equal(storage.writes.length, 0);
  }

  const futureRaw = JSON.stringify({ schemaVersion: 99, updatedAt: null, revision: 0, data: [] });
  const future = new MemoryStorage({ [PORTFOLIO_STORAGE_KEY]: futureRaw });
  assert.deepEqual(readPortfolioTrades(future), { status: 'unsupported_version', version: 99, rawValue: futureRaw });
  assert.equal(future.writes.length, 0);
});

test('portfolio migration is pure, excludes market state, preserves ids, and requires controlled ids', () => {
  const raw = [trade()];
  const migrated = migratePortfolioState(0, raw);
  assert.equal(migrated.status, 'ok');
  assert.equal(migrated.state.data[0].id, 'trade-1');
  assert.equal('latestMarketData' in migrated.state.data[0], false);
  assert.equal(migrated.state.localMarketData['trade-1'].volume, 120);
  assert.equal(raw[0].latestMarketData.optionAsk, 1.1);

  const missingId = trade({ id: undefined });
  assert.equal(migratePortfolioState(0, [missingId]).status, 'error');
  const controlled = migratePortfolioState(0, [missingId], { createMissingId: () => 'controlled-id' });
  assert.equal(controlled.status, 'ok');
  assert.equal(controlled.state.data[0].id, 'controlled-id');
});

test('portfolio controlled write creates a canonical envelope and roundtrips local market state', () => {
  const original = trade();
  const storage = new MemoryStorage({ [PORTFOLIO_STORAGE_KEY]: JSON.stringify([original]) });
  const changed = { ...original, notes: 'changed by owner' };
  const write = writePortfolioTrades(storage, [changed], { now: new Date('2026-08-14T01:00:00.000Z') });
  assert.deepEqual(write, { status: 'ok', written: true });
  const stored = JSON.parse(storage.getItem(PORTFOLIO_STORAGE_KEY));
  assert.equal(stored.schemaVersion, 1);
  assert.equal(stored.revision, 1);
  assert.equal(stored.updatedAt, '2026-08-14T01:00:00.000Z');
  assert.equal('latestMarketData' in stored.data[0], false);
  assert.equal(stored.localMarketData['trade-1'].optionAsk, 1.1);

  const roundtrip = readPortfolioTrades(storage);
  assert.equal(roundtrip.status, 'ok');
  assert.equal(roundtrip.source, 'canonical');
  assert.deepEqual(JSON.parse(JSON.stringify(roundtrip.data)), JSON.parse(JSON.stringify([changed])));
  assert.deepEqual(JSON.parse(JSON.stringify(toDurablePortfolioState(roundtrip.data))), stored.data);

  const marketOnly = { ...changed, latestMarketData: { ...changed.latestMarketData, optionBid: 0.8 } };
  writePortfolioTrades(storage, [marketOnly], { now: new Date('2026-08-15T01:00:00.000Z') });
  const afterMarketRefresh = JSON.parse(storage.getItem(PORTFOLIO_STORAGE_KEY));
  assert.equal(afterMarketRefresh.updatedAt, '2026-08-14T01:00:00.000Z');
  assert.equal(afterMarketRefresh.revision, 1);
});

test('watchlist has the same safe read semantics and deterministic current-key precedence', () => {
  const populated = new MemoryStorage({ [WATCHLIST_STORAGE_KEY]: JSON.stringify([item()]) });
  const result = readWatchlist(populated);
  assert.equal(result.status, 'ok');
  assert.equal(result.schemaVersion, 0);
  assert.equal(result.data[0].snapshot.ask, 1.3);
  assert.equal(populated.writes.length, 0);

  const empty = new MemoryStorage({ [WATCHLIST_STORAGE_KEY]: '[]' });
  assert.equal(readWatchlist(empty).status, 'ok');
  assert.deepEqual(readWatchlist(empty).data, []);
  assert.equal(readWatchlist(new MemoryStorage()).status, 'missing');

  const primaryRaw = '{broken';
  const precedence = new MemoryStorage({
    [WATCHLIST_STORAGE_KEY]: primaryRaw,
    [LEGACY_WATCHLIST_STORAGE_KEY]: JSON.stringify([item()]),
  });
  assert.equal(readWatchlist(precedence).status, 'corrupt');
  assert.equal(precedence.getItem(WATCHLIST_STORAGE_KEY), primaryRaw);
  assert.notEqual(precedence.getItem(LEGACY_WATCHLIST_STORAGE_KEY), null);
  assert.equal(precedence.writes.length, 0);
});

test('watchlist rejects wrong roots, partial corruption, and unsupported schemas without writes', () => {
  const cases = [
    JSON.stringify({ items: [] }),
    JSON.stringify([item(), item({ id: 'bad', ticker: '' })]),
  ];
  for (const raw of cases) {
    const storage = new MemoryStorage({ [WATCHLIST_STORAGE_KEY]: raw });
    assert.equal(readWatchlist(storage).status, 'corrupt');
    assert.equal(storage.getItem(WATCHLIST_STORAGE_KEY), raw);
    assert.equal(storage.writes.length, 0);
  }
  const raw = JSON.stringify({ schemaVersion: 2, updatedAt: null, revision: 0, data: [] });
  const storage = new MemoryStorage({ [WATCHLIST_STORAGE_KEY]: raw });
  assert.equal(readWatchlist(storage).status, 'unsupported_version');
  assert.equal(storage.getItem(WATCHLIST_STORAGE_KEY), raw);
  assert.equal(storage.writes.length, 0);
});

test('watchlist canonical migration excludes snapshots and preserves contract identity', () => {
  const migrated = migrateWatchlistState(0, [item()]);
  assert.equal(migrated.status, 'ok');
  assert.equal(migrated.state.data[0].id, 'TQQQ|put|2026-10-16|50');
  assert.equal('snapshot' in migrated.state.data[0], false);
  assert.equal('status' in migrated.state.data[0], false);
  assert.equal('updatedAt' in migrated.state.data[0], false);
  assert.equal(migrated.state.localState['TQQQ|put|2026-10-16|50'].snapshot.openInterest, 200);

  const missingNaturalId = migrateWatchlistState(0, [item({ id: undefined })]);
  assert.equal(missingNaturalId.status, 'ok');
  assert.equal(missingNaturalId.state.data[0].id, 'TQQQ|put|2026-10-16|50');
});

test('watchlist controlled writes preserve legacy key and roundtrip local quote state', () => {
  const legacyRaw = JSON.stringify([item()]);
  const storage = new MemoryStorage({ [LEGACY_WATCHLIST_STORAGE_KEY]: legacyRaw });
  const changed = { ...item(), note: 'changed by owner' };
  assert.deepEqual(writeWatchlist(storage, [changed], { now: new Date('2026-08-14T02:00:00.000Z') }), {
    status: 'ok', written: true,
  });
  assert.equal(storage.getItem(LEGACY_WATCHLIST_STORAGE_KEY), legacyRaw);
  const stored = JSON.parse(storage.getItem(WATCHLIST_STORAGE_KEY));
  assert.equal(stored.schemaVersion, 1);
  assert.equal('snapshot' in stored.data[0], false);
  assert.equal(stored.localState[changed.id].snapshot.bid, 1.2);
  const roundtrip = readWatchlist(storage);
  assert.equal(roundtrip.status, 'ok');
  assert.equal(roundtrip.data[0].id, changed.id);
  assert.equal(roundtrip.data[0].note, changed.note);
  assert.equal(roundtrip.data[0].status, 'live');
  assert.equal(roundtrip.data[0].snapshot.ask, 1.3);
  assert.deepEqual(toDurableWatchlistState(roundtrip.data), stored.data);

  const quoteOnly = { ...roundtrip.data[0], snapshot: { ...roundtrip.data[0].snapshot, bid: 1.1 } };
  writeWatchlist(storage, [quoteOnly], { now: new Date('2026-08-15T02:00:00.000Z') });
  const afterQuoteRefresh = JSON.parse(storage.getItem(WATCHLIST_STORAGE_KEY));
  assert.equal(afterQuoteRefresh.updatedAt, '2026-08-14T02:00:00.000Z');
  assert.equal(afterQuoteRefresh.revision, 1);
});

test('portable preferences read legacy keys strictly and exclude session/debug keys', () => {
  const storage = new MemoryStorage({
    [LEGACY_THEME_STORAGE_KEY]: 'darkBlue',
    [PORTFOLIO_MARK_BASIS_KEY]: 'bid',
    [PORTFOLIO_GROUP_MODE_KEY]: 'underlying',
    [PORTFOLIO_EXPIRY_GROUPS_KEY]: JSON.stringify({ '2026-10-16': true }),
    [PORTFOLIO_UNDERLYING_GROUPS_KEY]: JSON.stringify({ TQQQ: false }),
    [SHOW_NOMINAL_YIELD_KEY]: 'true',
    [RECOMMENDATIONS_MINIMUM_DTE_KEY]: 'false',
    'put_scanner:last_url:v1': '/options/TQQQ',
    'put_scanner_debug:v1': 'true',
  });
  const result = readDurablePreferences(storage);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.data, {
    theme: 'dark-blue',
    portfolioMarkBasis: 'bid',
    portfolioGroupMode: 'underlying',
    collapsedExpirationGroups: { '2026-10-16': true },
    collapsedUnderlyingGroups: { TQQQ: false },
    showNominalYield: true,
    recommendationsOnlyAtLeast60Dte: false,
  });
  assert.equal('put_scanner:last_url:v1' in result.data, false);
  assert.equal(migratePreferencesState(1, { theme: 'dark', debug: true }).status, 'error');
  assert.equal(readDurablePreferences(new MemoryStorage({ 'put_scanner:last_url:v1': '/portfolio' })).status, 'missing');
});

test('preference precedence does not hide a corrupt current theme behind a valid legacy theme', () => {
  const storage = new MemoryStorage({
    [THEME_STORAGE_KEY]: 'not-a-theme',
    [LEGACY_THEME_STORAGE_KEY]: 'light',
  });
  assert.equal(readDurablePreferences(storage).status, 'corrupt');
  assert.equal(storage.writes.length, 0);
});

test('serialization and storage failures preserve the previous value', () => {
  const storage = new MemoryStorage({ durable: 'keep-me' });
  const cyclic = {};
  cyclic.self = cyclic;
  const serialization = writeValidatedStorageValue(storage, 'durable', cyclic, () => {});
  assert.equal(serialization.status, 'error');
  assert.equal(storage.getItem('durable'), 'keep-me');

  storage.failOnKey = 'durable';
  const write = writeValidatedStorageValue(storage, 'durable', { ok: true }, parsed => {
    assert.deepEqual(parsed, { ok: true });
  });
  assert.equal(write.status, 'error');
  assert.equal(storage.getItem('durable'), 'keep-me');
});

test('corrupt and unsupported durable reads cannot be overwritten by ordinary writers', () => {
  const corruptPortfolio = new MemoryStorage({ [PORTFOLIO_STORAGE_KEY]: '{broken' });
  assert.equal(writePortfolioTrades(corruptPortfolio, []).status, 'error');
  assert.equal(corruptPortfolio.getItem(PORTFOLIO_STORAGE_KEY), '{broken');

  const unsupportedWatchlist = JSON.stringify({ schemaVersion: 8, updatedAt: null, revision: 0, data: [] });
  const storage = new MemoryStorage({ [WATCHLIST_STORAGE_KEY]: unsupportedWatchlist });
  assert.equal(writeWatchlist(storage, []).status, 'error');
  assert.equal(storage.getItem(WATCHLIST_STORAGE_KEY), unsupportedWatchlist);
});

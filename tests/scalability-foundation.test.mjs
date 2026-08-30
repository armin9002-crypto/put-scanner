import test from 'node:test';
import assert from 'node:assert/strict';
import { mapWithConcurrency } from '../shared/concurrency.js';
import { buildEtfPulseDataset, ETF_PULSE_CONCURRENCY } from '../api/_lib/etfPulseDataset.js';
import { acquireOptionChains, canonicalOptionChainKey, planOptionChainRequests } from '../src/lib/optionChainRequests.ts';
import { buildEtfPulseRows, getEtfPulseUniverse } from '../src/lib/etfPulseData.ts';
import { requestMarketData } from '../src/lib/marketDataRequest.ts';
import { getRequestDiagnosticsSnapshot, resetRequestDiagnosticsForTests, setRequestDiagnosticsEnabledForTests } from '../src/lib/requestDiagnostics.ts';
import { archiveExpiredOpenTrades } from '../src/lib/portfolioExpirationArchive.ts';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test('shared worker pool preserves association, isolates failures, and enforces its limit', async () => {
  let active = 0;
  let maxActive = 0;
  const settled = await mapWithConcurrency([0, 1, 2, 3, 4, 5], 3, async value => {
    active += 1;
    maxActive = Math.max(maxActive, active);
    await delay(3);
    active -= 1;
    if (value === 2) throw new Error('fixture failure');
    return value * 10;
  });
  assert.equal(maxActive, 3);
  assert.deepEqual(settled.map(result => result.status), ['fulfilled', 'fulfilled', 'rejected', 'fulfilled', 'fulfilled', 'fulfilled']);
  assert.equal(settled[4].value, 40);
});

test('ETF Pulse backend deduplicates histories, caps Yahoo work, and keeps partial success', async () => {
  const calls = new Map();
  let active = 0;
  let maxActive = 0;
  const dataset = await buildEtfPulseDataset({
    tickers: ['SPY', 'QQQ', 'SPY', 'TQQQ', 'BROKEN'],
    concurrency: ETF_PULSE_CONCURRENCY,
    fetchHistory: async ticker => {
      calls.set(ticker, (calls.get(ticker) ?? 0) + 1);
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(3);
      active -= 1;
      if (ticker === 'BROKEN') throw new Error('unavailable');
      return { ticker, timeframe: '2Y', points: [], latestPrice: 1 };
    },
  });
  assert.deepEqual([...calls.values()], [1, 1, 1, 1]);
  assert.ok(maxActive <= ETF_PULSE_CONCURRENCY);
  assert.deepEqual(Object.keys(dataset.histories), ['SPY', 'QQQ', 'TQQQ']);
  assert.deepEqual(dataset.errors, [{ ticker: 'BROKEN', message: 'unavailable' }]);
});

test('ETF Pulse browser performs one dataset acquisition, reuses its row cache, and preserves calculations', async () => {
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  setRequestDiagnosticsEnabledForTests(true);
  resetRequestDiagnosticsForTests();
  globalThis.localStorage = new MemoryStorage();
  const points = Array.from({ length: 300 }, (_, index) => ({
    timestamp: 1_700_000_000 + index * 86_400,
    date: new Date((1_700_000_000 + index * 86_400) * 1000).toISOString(),
    price: 100 + index,
  }));
  const universe = getEtfPulseUniverse();
  assert.equal(universe.length, 44);
  let browserCalls = 0;
  globalThis.fetch = async () => {
    browserCalls += 1;
    return Response.json({
      datasetVersion: 1,
      fetchedAt: 1_800_000_000_000,
      tickers: universe.map(etf => etf.ticker),
      histories: Object.fromEntries(universe.map(etf => [etf.ticker, { ticker: etf.ticker, timeframe: '2Y', points, latestPrice: 500 }])),
      errors: [],
    }, { headers: { 'X-PutScanner-Upstream-Requests': '44', 'X-PutScanner-Dataset-Version': '1', 'X-PutScanner-Max-Observed-Concurrency': '6' } });
  };
  try {
    const first = await buildEtfPulseRows();
    const second = await buildEtfPulseRows();
    assert.equal(browserCalls, 1);
    assert.equal(second.rows.length, 44);
    const spy = first.rows.find(row => row.ticker === 'SPY');
    assert.equal(spy.price, 500);
    assert.equal(spy.sma20, 389.5);
    assert.equal(spy.rsi14, 100);
    assert.equal(spy.high52Week, 399);
    assert.ok(Math.abs(spy.returns.fiveDay - (399 / 394 - 1)) < 1e-12);
    const diagnostics = getRequestDiagnosticsSnapshot()['etf-pulse'];
    assert.equal(diagnostics.serverEndpointResponses, 1);
    assert.equal(diagnostics.yahooUpstreamAttempts, 44);
    assert.equal(diagnostics.maxObservedConcurrency, 6);
    assert.equal(diagnostics.lastDatasetVersion, '1');

    globalThis.fetch = async () => { throw new Error('refresh unavailable'); };
    const stale = await buildEtfPulseRows({ forceRefresh: true });
    assert.equal(stale.stale, true);
    assert.deepEqual(stale.rows, first.rows);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousStorage;
    setRequestDiagnosticsEnabledForTests(null);
  }
});

test('10 contracts sharing 3 chains acquire 3 chains with cache-first reuse and diagnostics', async () => {
  setRequestDiagnosticsEnabledForTests(true);
  resetRequestDiagnosticsForTests();
  const suffix = Date.now();
  const items = Array.from({ length: 10 }, (_, index) => ({ ticker: ['SPY', 'QQQ', 'TQQQ'][index % 3], expirationTimestamp: 2_000_000_000 + (index % 3) }));
  assert.equal(planOptionChainRequests(items).requests.length, 3);
  let networkCalls = 0;
  const fetchChain = (ticker, expirationTimestamp) => requestMarketData({
    key: `test_chain:${suffix}:${canonicalOptionChainKey(ticker, expirationTimestamp)}`,
    source: 'test:watchlist', endpoint: 'options', softTtlMs: 60_000, hardTtlMs: 120_000, schemaVersion: 1,
    validator: value => value?.ticker === ticker,
    fetcher: async () => { networkCalls += 1; await delay(3); return { ticker, expirationTimestamp }; },
  }).then(result => result.data);
  try {
    const first = await acquireOptionChains(items, { source: 'test:watchlist', limit: 3, fetchChain });
    const second = await acquireOptionChains(items, { source: 'test:watchlist', limit: 3, fetchChain });
    assert.equal(first.uniqueCount, 3);
    assert.equal(first.maxObservedConcurrency, 3);
    assert.equal(first.byKey.get(canonicalOptionChainKey('SPY', 2_000_000_000)).ticker, 'SPY');
    assert.equal(second.byKey.size, 3);
    assert.equal(networkCalls, 3);
    const diagnostics = getRequestDiagnosticsSnapshot().options;
    assert.equal(diagnostics.chainsDeduplicated, 14);
    assert.equal(diagnostics.maxObservedConcurrency, 3);
  } finally { setRequestDiagnosticsEnabledForTests(null); }
});

test('failed chain remains associated with its key so callers can retain prior snapshots', async () => {
  const items = [{ ticker: 'SPY', expirationTimestamp: 1 }, { ticker: 'QQQ', expirationTimestamp: 2 }];
  const result = await acquireOptionChains(items, {
    source: 'test:failure',
    fetchChain: async ticker => { if (ticker === 'QQQ') throw new Error('failed'); return { ticker }; },
  });
  assert.deepEqual(result.byKey.get('SPY|1'), { ticker: 'SPY' });
  assert.equal(result.byKey.get('QQQ|2'), null);
  assert.equal(result.failedKeys.has('QQQ|2'), true);
});

test('Portfolio 20-position refresh shares 6 chains and applies each result by canonical key', async () => {
  const items = Array.from({ length: 20 }, (_, index) => ({
    ticker: `ETF${index % 6}`,
    expirationTimestamp: 2_100_000_000 + (index % 6),
  }));
  let calls = 0;
  const acquired = await acquireOptionChains(items, {
    source: 'test:portfolio',
    limit: 3,
    fetchChain: async (ticker, expirationTimestamp) => {
      calls += 1;
      await delay(2);
      return { ticker, expirationTimestamp, mark: calls };
    },
  });
  assert.equal(calls, 6);
  assert.equal(acquired.uniqueCount, 6);
  assert.equal(acquired.maxObservedConcurrency, 3);
  items.forEach(item => {
    const chain = acquired.byKey.get(canonicalOptionChainKey(item.ticker, item.expirationTimestamp));
    assert.equal(chain.ticker, item.ticker);
    assert.equal(chain.expirationTimestamp, item.expirationTimestamp);
  });
});

test('expiration repair reuses one rich ticker history and never re-resolves immutable trades', async () => {
  const base = (id, expiration, strike) => ({
    id, ticker: 'SPY', strike, expiration, contracts: 1, premium: 1, soldDate: '2024-01-02', status: 'open',
    entrySnapshot: {}, latestMarketData: {}, createdAt: '2024-01-02T00:00:00Z', updatedAt: '2024-01-02T00:00:00Z',
  });
  const points = [
    { timestamp: Date.parse('2024-01-19T00:00:00Z') / 1000, date: '2024-01-19T00:00:00Z', price: 480 },
    { timestamp: Date.parse('2024-02-16T00:00:00Z') / 1000, date: '2024-02-16T00:00:00Z', price: 500 },
  ];
  let richLookups = 0;
  let networkLookups = 0;
  const first = await archiveExpiredOpenTrades([
    base('a', '2024-01-19', 470), base('b', '2024-01-19', 475), base('c', '2024-02-16', 490),
  ], {
    now: new Date('2026-08-14T00:00:00Z'),
    findRichHistory: () => { richLookups += 1; return { ticker: 'SPY', displayTicker: 'SPY', timeframe: '2Y', points, corporateActions: [], fetchedAt: Date.now(), metadata: { interval: '1d' } }; },
    fetchClose: async () => { networkLookups += 1; return null; },
  });
  assert.equal(richLookups, 1);
  assert.equal(networkLookups, 0);
  assert.deepEqual(first.trades.map(trade => trade.expirationClosePrice), [480, 480, 500]);
  const second = await archiveExpiredOpenTrades(first.trades, { now: new Date('2026-08-14T00:00:00Z'), fetchClose: async () => { networkLookups += 1; return null; } });
  assert.equal(second.changed, false);
  assert.equal(networkLookups, 0);
});

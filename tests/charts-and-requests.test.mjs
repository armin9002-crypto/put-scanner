import test from 'node:test';
import assert from 'node:assert/strict';
import { getChartHistory } from '../src/lib/chartHistory.ts';
import { calculateTrueLeverage, getTrueLeverageForPeriod } from '../src/lib/trueLeverage.ts';
import { getMarketProviderHealth, requestMarketData } from '../src/lib/marketDataRequest.ts';
import { rateLimitError } from './fixtures/yahoo-options.mjs';

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.sessionStorage = new MemoryStorage();
const optionsFor = (key, overrides = {}) => ({ key, source: 'unit', endpoint: 'options', softTtlMs: 1_000, hardTtlMs: 5_000, schemaVersion: 1, validator: value => Number.isFinite(value?.value), fetcher: async () => ({ value: 1 }), ...overrides });

test('broker distinguishes soft/hard expiration and invalidates schema changes', async () => {
  const realNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  try {
    let calls = 0;
    const options = optionsFor('ttl', { fetcher: async () => ({ value: ++calls }) });
    assert.equal((await requestMarketData(options)).meta.source, 'network');
    now += 500;
    assert.equal((await requestMarketData(options)).meta.freshness, 'fresh');
    now += 1_000;
    assert.equal((await requestMarketData(options)).meta.freshness, 'stale');
    now += 5_000;
    assert.equal((await requestMarketData(options)).data.value, 2);
    localStorage.setItem('schema', JSON.stringify({ data: { value: 7 }, fetchedAt: now, softExpiresAt: now + 1000, hardExpiresAt: now + 5000, schemaVersion: 1 }));
    const changed = await requestMarketData(optionsFor('schema', { schemaVersion: 2, fetcher: async () => ({ value: 8 }) }));
    assert.equal(changed.data.value, 8);
  } finally { Date.now = realNow; }
});

test('broker dedupes in-flight work and marks the joined caller', async () => {
  let calls = 0;
  const options = optionsFor('dedupe', { fetcher: async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 5)); return { value: 2 }; } });
  const [first, second] = await Promise.all([requestMarketData(options), requestMarketData(options)]);
  assert.equal(calls, 1);
  assert.equal(first.meta.deduped || second.meta.deduped, true);
});

test('429 uses stale fallback and circuit resets after cooldown', async () => {
  const realNow = Date.now;
  let now = 2_000_000;
  Date.now = () => now;
  try {
    const base = optionsFor('circuit', { softTtlMs: 10, hardTtlMs: 100_000 });
    await requestMarketData(base);
    now += 20;
    for (let index = 0; index < 3; index += 1) assert.equal((await requestMarketData({ ...base, mode: 'revalidate', fetcher: async () => { throw rateLimitError; } })).meta.staleFallbackUsed, true);
    assert.equal((await requestMarketData({ ...base, mode: 'revalidate', fetcher: async () => ({ value: 9 }) })).meta.networkCall, false);
    assert.ok(getMarketProviderHealth().options.circuitOpenUntil > now);
    now += 46_000;
    assert.equal((await requestMarketData({ ...base, mode: 'revalidate', fetcher: async () => ({ value: 9 }) })).data.value, 9);
    assert.equal(getMarketProviderHealth().options.consecutiveFailures, 0);
  } finally { Date.now = realNow; }
});

const point = (timestamp, price) => ({ timestamp, date: new Date(timestamp * 1000).toISOString(), price });

test('true leverage handles overlap, near-zero proxies, and direction divergence', () => {
  const etf = [point(10, 100), point(20, 110), point(30, 120)];
  const proxy = [point(15, 100), point(20, 105), point(30, 110)];
  assert.ok(Math.abs(getTrueLeverageForPeriod(etf, proxy).leverage - (10 / 11)) < 1e-12);
  assert.equal(calculateTrueLeverage(0.1, 0.004), null);
  assert.equal(calculateTrueLeverage(0.1, -0.05), -2);
});

test('1Y daily history supplies 6M/3M/YTD with adequate coverage', async () => {
  const now = Math.floor(Date.now() / 1000);
  const points = [400, 250, 150, 60, 1].map(days => point(now - days * 86400, 100 + days));
  await requestMarketData({ key: 'chart_history_cache:DAILY:1Y', source: 'unit', endpoint: 'chart-history', softTtlMs: 999999, hardTtlMs: 999999, schemaVersion: 2, validator: () => true, fetcher: async () => ({ ticker: 'DAILY', displayTicker: 'DAILY', timeframe: '1Y', points, fetchedAt: Date.now(), metadata: { interval: '1d' } }) });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('unexpected request'); };
  try { for (const timeframe of ['6M', '3M', 'YTD']) assert.equal((await getChartHistory('DAILY', timeframe)).metadata.derivedFrom, '1Y'); }
  finally { globalThis.fetch = realFetch; }
});

test('5Y weekly supplies 3Y but not a daily timeframe', async () => {
  const now = Math.floor(Date.now() / 1000);
  const points = [1500, 1000, 500, 1].map(days => point(now - days * 86400, 100 + days));
  await requestMarketData({ key: 'chart_history_cache:WEEKLY:5Y', source: 'unit', endpoint: 'chart-history', softTtlMs: 999999, hardTtlMs: 999999, schemaVersion: 2, validator: () => true, fetcher: async () => ({ ticker: 'WEEKLY', displayTicker: 'WEEKLY', timeframe: '5Y', points, fetchedAt: Date.now(), metadata: { interval: '1wk' } }) });
  assert.equal((await getChartHistory('WEEKLY', '3Y')).metadata.derivedFrom, '5Y');
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ticker: 'WEEKLY', displayTicker: 'WEEKLY', timeframe: '1Y', points: [point(now - 10, 1), point(now, 2)], fetchedAt: Date.now(), metadata: { interval: '1d' } });
  try { assert.equal((await getChartHistory('WEEKLY', '1Y')).metadata.derivedFrom, undefined); }
  finally { globalThis.fetch = realFetch; }
});

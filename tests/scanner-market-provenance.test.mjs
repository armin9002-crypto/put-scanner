import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { requestMarketData } from '../src/lib/marketDataRequest.ts';
import {
  acquireScannerMarketContext,
  compactScannerMarketFreshness,
  SCANNER_MARKET_SYMBOLS,
  summarizeScannerMarketContext,
} from '../src/lib/scannerMarketContext.ts';
import { REQUEST_BUDGET_LEDGER } from '../src/lib/requestBudgets.ts';

const OBSERVED_AT = Date.parse('2026-09-11T14:00:00Z');

function sparklineResult(overrides = {}) {
  return {
    data: { price: 100, change: 1, changePercent: 1, previousClose: 99, sparkline: [99, 100] },
    freshness: 'fresh',
    source: 'network',
    observedAt: OBSERVED_AT,
    cachedAt: OBSERVED_AT + 1,
    staleFallbackUsed: false,
    ...overrides,
  };
}

async function acquire(fetchResult, previous = {}, mode = 'cache-first') {
  return acquireScannerMarketContext(previous, { mode, fetchResult });
}

test('Scanner market context reports all-current and all-cached evidence without restamping observation time', async () => {
  const current = await acquire(async () => sparklineResult());
  assert.equal(current.requestCount, 4);
  assert.equal(current.failedCount, 0);
  assert.equal(summarizeScannerMarketContext(current.context).freshness, 'current');
  assert.ok(Object.values(current.context).every(item => item.observedAt === OBSERVED_AT));

  const cached = await acquire(async () => sparklineResult({ source: 'persistent' }));
  const summary = summarizeScannerMarketContext(cached.context);
  assert.equal(summary.freshness, 'cached-current');
  assert.equal(summary.observedAt, OBSERVED_AT);
  assert.ok(Object.values(cached.context).every(item => item.freshness === 'cached-current'));
});

test('one retained stale symbol controls desktop aggregate freshness and keeps its original observation', async () => {
  const retainedAt = OBSERVED_AT - 45 * 60 * 1000;
  const result = await acquire(async ticker => ticker === '^VIX'
    ? sparklineResult({ source: 'stale-fallback', freshness: 'stale', staleFallbackUsed: true, observedAt: retainedAt })
    : sparklineResult());
  const summary = summarizeScannerMarketContext(result.context);
  assert.equal(summary.freshness, 'retained-stale');
  assert.equal(summary.observedAt, retainedAt);
  assert.equal(result.context.VIX.observedAt, retainedAt);
  assert.equal(result.context.VIX.freshness, 'retained-stale');
  assert.equal(result.failedCount, 1);
});

test('stale-on-error retains prior evidence while a first-load failure is unavailable', async () => {
  const prior = (await acquire(async () => sparklineResult())).context;
  const retained = await acquire(async ticker => {
    if (ticker === 'SPY') throw new Error('provider unavailable');
    return sparklineResult({ observedAt: OBSERVED_AT + 60_000 });
  }, prior, 'revalidate');
  assert.equal(retained.context.SPY.freshness, 'retained-stale');
  assert.equal(retained.context.SPY.observedAt, OBSERVED_AT);
  assert.equal(retained.context.SPY.data.price, 100);

  const unavailable = await acquire(async ticker => {
    if (ticker === 'SPY') throw new Error('provider unavailable');
    return sparklineResult();
  });
  assert.equal(unavailable.context.SPY.freshness, 'unavailable');
  assert.equal(unavailable.context.SPY.observedAt, null);
  assert.equal(summarizeScannerMarketContext(unavailable.context).freshness, 'unavailable');
});

test('explicit Scanner refresh revalidates all four symbol paths and uses the bounded request ledger', async () => {
  const calls = [];
  await acquire(async (ticker, options) => {
    calls.push({ ticker, mode: options.mode });
    return sparklineResult();
  }, {}, 'revalidate');
  assert.deepEqual(calls.map(call => call.ticker), SCANNER_MARKET_SYMBOLS.map(symbol => symbol.requestTicker));
  assert.ok(calls.every(call => call.mode === 'revalidate'));
  assert.deepEqual(REQUEST_BUDGET_LEDGER['scanner-market-refresh'].expected, {
    browserRequests: 4,
    functionInvocations: 4,
    providerAcquisitions: 4,
  });
});

test('explicit sparkline revalidation does not accept an 11-minute local record inside the hard TTL', async () => {
  const realNow = Date.now;
  let now = OBSERVED_AT;
  let calls = 0;
  Date.now = () => now;
  const options = {
    key: `sparkline-f1-${Math.random()}`,
    source: 'fetchSparkline',
    endpoint: 'price',
    softTtlMs: 10 * 60 * 1000,
    hardTtlMs: 60 * 60 * 1000,
    schemaVersion: 1,
    storage: 'none',
    allowStaleOnError: true,
    validator: value => value?.price > 0,
    fetcher: async () => ({ price: 100 + ++calls }),
  };
  try {
    const initial = await requestMarketData(options);
    now += 11 * 60 * 1000;
    const cached = await requestMarketData(options);
    assert.equal(calls, 1);
    assert.equal(cached.meta.freshness, 'stale');
    assert.equal(cached.meta.observedAt, initial.meta.observedAt);

    const refreshed = await requestMarketData({ ...options, mode: 'revalidate' });
    assert.equal(calls, 2);
    assert.equal(refreshed.meta.source, 'network');
    assert.equal(refreshed.meta.observedAt, now);
  } finally {
    Date.now = realNow;
  }
});

test('desktop and compact mobile presentations expose retained and unavailable state', async () => {
  const retained = sparklineResult({ source: 'stale-fallback', freshness: 'stale', staleFallbackUsed: true });
  assert.match(compactScannerMarketFreshness({ freshness: 'retained-stale', observedAt: retained.observedAt }), /^Stale · /);
  assert.equal(compactScannerMarketFreshness({ freshness: 'unavailable', observedAt: null }), 'Unavailable');

  const [api, home, mobile] = await Promise.all([
    readFile(new URL('../src/lib/api.ts', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/HomePage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/mobile/MobileMarketStrip.tsx', import.meta.url), 'utf8'),
  ]);
  assert.match(api, /mode: options\.mode \?\? 'cache-first'/);
  assert.match(home, /evidenceFreshness=\{marketSummary\.freshness\}/);
  assert.match(home, /loadMarketData\(true\)/);
  assert.doesNotMatch(home, /setLastMarketUpdate\(new Date\(\)\)/);
  assert.match(mobile, /data-evidence-freshness=\{item\.evidenceFreshness\}/);
  assert.match(mobile, /compactScannerMarketFreshness/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import priceHandler from '../api/price.js';
import pricesHandler from '../api/prices.js';
import optionsHandler from '../api/options.js';
import { invalidateYahooSession, noteYahooFailure } from '../api/_lib/yahoo.js';
import { normalLiquidResponse } from './fixtures/yahoo-options.mjs';
import { isTrustedOptionAvailabilityObservation, optionAvailabilityNeedsRevalidation } from '../src/lib/optionAvailability.ts';
import { normalizeScreenerExpirationAvailability } from '../src/lib/screenerAcquisition.ts';

test('small server clock skew preserves observed availability without trusting implausible future evidence', () => {
  const now = Date.parse('2026-10-02T15:00:00Z');
  const observedAt = now + 506;
  const future = Date.parse('2026-11-20T00:00:00Z') / 1000;
  const result = normalizeScreenerExpirationAvailability({ fetchedAt: observedAt, complete: false,
    expirationsByTicker: { TQQQ: [future], QQUP: [] }, errors: [{ ticker: 'SOXL', message: 'incomplete' }] }, false, now);
  assert.deepEqual(result.expirationsByTicker, { TQQQ: [future], QQUP: [] });
  assert.equal(result.observedAtByTicker.TQQQ, observedAt);
  assert.equal(optionAvailabilityNeedsRevalidation(observedAt, now), false);
  assert.equal(isTrustedOptionAvailabilityObservation(now + 300001, now), false);
  assert.equal(isTrustedOptionAvailabilityObservation(now - 7 * 86400000, now), false);
});

function response() {
  return { statusCode: 200, headers: new Map(),
    setHeader(key, value) { this.headers.set(key.toLowerCase(), value); },
    getHeader(key) { return this.headers.get(key.toLowerCase()); },
    status(value) { this.statusCode = value; return this; },
    json(value) { this.body = value; return this; },
  };
}

test('HTTP revalidation acquires once and is not stored by CDN; ordinary reads remain cacheable', async t => {
  invalidateYahooSession();
  t.after(invalidateYahooSession);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    calls++;
    if (String(url).includes('/quote/')) return new Response('{"crumb":"test-only"}');
    if (String(url).includes('/options/')) return Response.json(normalLiquidResponse);
    const chart = { meta: { regularMarketPrice: 101, chartPreviousClose: 100, regularMarketTime: Math.floor(Date.now() / 1000) }, indicators: { quote: [{ close: [100, 101] }] } };
    return Response.json(String(url).includes('/spark?')
      ? { spark: { result: [{ symbol: 'TST', response: [chart] }] } }
      : { chart: { result: [chart] } });
  });
  for (const handler of [priceHandler, pricesHandler, optionsHandler]) {
    for (const revalidate of [undefined, '1']) {
      const res = response();
      const before = calls;
      await handler({ query: { ticker: 'TST', tickers: 'TST', revalidate }, headers: {} }, res);
      assert.equal(res.statusCode, 200);
      assert.match(res.getHeader('Cache-Control'), revalidate ? /no-store/ : /s-maxage/);
      assert.equal(calls - before, handler === optionsHandler && !revalidate ? 2 : 1);
    }
  }
});

test('HTTP cache revalidation does not override an open Yahoo options circuit', async t => {
  invalidateYahooSession();
  t.after(invalidateYahooSession);
  let optionCalls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('/quote/')) return new Response('{"crumb":"test-only"}');
    optionCalls++;
    return Response.json(normalLiquidResponse);
  });
  for (let i = 0; i < 3; i++) noteYahooFailure('options');
  const res = response();
  await optionsHandler({ query: { ticker: 'TST', revalidate: '1' }, headers: {} }, res);
  assert.equal(res.statusCode, 500);
  assert.match(res.body.error, /cooling down/);
  assert.equal(optionCalls, 0);
});

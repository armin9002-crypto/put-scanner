import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScreenerExpirationAvailability, retainScreenerExpirationEvidence, classifyScreenerExpirationEvidence, fetchScreenerExpirationAvailability } from '../src/lib/screenerAcquisition.ts';
import { buildExpirationState, tickerMatchesScannerExpiration } from '../src/lib/scannerUpdateState.ts';
import { primeMarketDataCache, clearMarketDataCache } from '../src/lib/marketDataRequest.ts';
import { SCREENER_TICKERS } from '../shared/screenerUniverse.js';

const now = Date.parse('2026-09-14T17:00:00Z');
const future = Date.parse('2026-10-16T00:00:00Z') / 1000;
const past = Date.parse('2026-09-11T00:00:00Z') / 1000;
const hour = 3600000;
const payload = (entries, extra = {}) => ({ datasetVersion: 4, fetchedAt: now, complete: false, expirationsByTicker: entries, errors: [], diagnostics: {}, ...extra });
function eligible(result, ticker, filter = 'all') {
  const state = buildExpirationState(result.expirationsByTicker, result.complete ? 'complete' : 'partial', result.errors);
  return tickerMatchesScannerExpiration(ticker, filter, state.availability, true, new Date(now), state.coverage);
}

test('partial ticker positives and authoritative negatives stay distinct from unknown/global errors', () => {
  const result = normalizeScreenerExpirationAvailability(payload({ TQQQ: [future], QQUP: [] }, { errors: [{ ticker: 'UPRO', message: 'incomplete' }] }), false, now);
  assert.equal(eligible(result, 'TQQQ'), true);
  assert.equal(eligible(result, 'QQUP'), false);
  assert.equal(eligible(result, 'UPRO'), false);
  assert.equal(classifyScreenerExpirationEvidence(result, 'QQUP', future), 'absent');
  assert.equal(classifyScreenerExpirationEvidence(result, 'UPRO', future), 'unknown');
  const global = normalizeScreenerExpirationAvailability(payload({ TQQQ: [future] }, { errors: [{ message: 'global failure' }] }), false, now);
  assert.equal(eligible(global, 'TQQQ'), false);
});

test('failed partial refresh retains only bounded positive evidence without restamping across repeated failures', () => {
  const previous = payload({ TQQQ: [past, future], QQUP: [] }, { fetchedAt: now - 3 * hour });
  const failure = payload({}, { errors: [{ ticker: 'TQQQ', message: 'timeout' }, { ticker: 'QQUP', message: 'incomplete' }] });
  const merged = retainScreenerExpirationEvidence(failure, previous, now);
  const result = normalizeScreenerExpirationAvailability(merged, false, now);
  assert.deepEqual(result.expirationsByTicker, { TQQQ: [future] });
  assert.equal(result.observedAtByTicker.TQQQ, previous.fetchedAt);
  assert.equal(eligible(result, 'TQQQ', `date_${future}`), true);
  assert.equal(classifyScreenerExpirationEvidence(result, 'QQUP', future), 'unknown');
  assert.equal(result.refreshErrors.length, 2);
  const again = retainScreenerExpirationEvidence({ ...failure, fetchedAt: now + hour }, merged, now + hour);
  assert.equal(again.retainedExpirationsByTicker.TQQQ.fetchedAt, previous.fetchedAt);
  const expired = normalizeScreenerExpirationAvailability(again, false, now + 5 * hour);
  assert.deepEqual(expired.expirationsByTicker, {});
});

test('authoritative updates replace retained positive evidence and instruments reappear dynamically', () => {
  const previous = payload({ QQUP: [future] }, { fetchedAt: now - hour });
  const negative = retainScreenerExpirationEvidence(payload({ QQUP: [] }), previous, now);
  assert.equal(eligible(normalizeScreenerExpirationAvailability(negative, false, now), 'QQUP'), false);
  const positive = normalizeScreenerExpirationAvailability(payload({ QQUP: [future] }), false, now);
  assert.equal(eligible(positive, 'QQUP'), true);
  assert.equal(eligible(positive, 'QQUP', `date_${future}`), true);
});

test('whole request fallback drops negatives and expired dates; provider observation age bounds CDN evidence', () => {
  const previous = payload({ TQQQ: [past, future], QQUP: [], UPRO: [past] }, { fetchedAt: now - 3 * hour });
  const fallback = normalizeScreenerExpirationAvailability(previous, true, now);
  assert.deepEqual(fallback.expirationsByTicker, { TQQQ: [future] });
  assert.equal(fallback.fetchedAt, previous.fetchedAt);
  assert.equal(fallback.complete, false);
  assert.deepEqual(normalizeScreenerExpirationAvailability(previous, false, now + 5 * hour).expirationsByTicker, {});
});

test('real shared request cache revalidates after soft TTL and retains positive evidence on HTTP failure', async () => {
  const key = 'screener_expirations_v4';
  const originalFetch = globalThis.fetch;
  const observed = Date.now() - 3 * hour;
  const dynamicFuture = Math.floor((Date.now() + 20 * 86400000) / 1000);
  const previous = payload(Object.fromEntries(SCREENER_TICKERS.map(ticker => [ticker, ticker === 'TQQQ' ? [dynamicFuture] : []])), { complete: true, fetchedAt: observed });
  primeMarketDataCache({ key, softTtlMs: 2 * hour, hardTtlMs: 8 * hour, schemaVersion: 4, storage: 'session', validator: () => true }, previous, observed);
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({ error: 'unavailable' }, { status: 502 }); };
  try {
    const result = await fetchScreenerExpirationAvailability();
    assert.equal(requests, 1);
    assert.deepEqual(result.expirationsByTicker, { TQQQ: [dynamicFuture] });
    assert.equal(result.fetchedAt, observed);
    assert.equal(result.complete, false);
  } finally { globalThis.fetch = originalFetch; clearMarketDataCache(key, 'session'); }
});

test('QQUP stays in the registry while authoritative discovery drives absence, unknown, and reappearance', async () => {
  const { buildScreenerExpirationDataset } = await import('../api/_lib/screenerBatch.js');
  const { ETF_LIST } = await import('../src/lib/etfs.ts');
  assert.ok(ETF_LIST.some(etf => etf.ticker === 'QQUP'));
  const positive = { optionChain: { result: [{ expirationDates: [future], options: [{ expirationDate: future, puts: [{ strike: 10 }] }] }] } };
  const negative = { optionChain: { result: [{ expirationDates: [], options: [] }] } };
  const incomplete = { optionChain: { result: [{ quote: { regularMarketPrice: 10 } }] } };
  for (const [response, status, show] of [[negative, 'absent', false], [incomplete, 'unknown', false], [positive, 'present', true]]) {
    const dataset = await buildScreenerExpirationDataset({ fetchOptions: async ticker => ticker === 'QQUP' ? response : positive });
    assert.equal(dataset.complete, response !== incomplete, 'authoritative no-options does not make discovery incomplete');
    const result = normalizeScreenerExpirationAvailability({ ...dataset, fetchedAt: now }, false, now);
    assert.equal(classifyScreenerExpirationEvidence(result, 'QQUP', future), status);
    assert.equal(eligible(result, 'QQUP'), show);
    assert.equal(eligible(result, 'QQUP', `date_${future}`), show);
    assert.equal(eligible(result, 'TQQQ'), true);
  }
});

test('open Scanner state expires retained evidence locally and observes the canonical market day boundary', async () => {
  const { nextScannerExpirationCheckAt, revalidateScannerExpirationState } = await import('../src/lib/scannerUpdateState.ts');
  const observed = now - 8 * hour + 60000;
  const state = buildExpirationState({ TQQQ: [future] }, 'partial', [], 'retained', { TQQQ: observed }, new Date(now));
  assert.equal(nextScannerExpirationCheckAt(state, now), now + 60000);
  const expired = revalidateScannerExpirationState(state, new Date(now + 60000));
  assert.deepEqual(expired.availability, {});
  assert.equal(nextScannerExpirationCheckAt(expired, now + 60000), null);
  const beforeDstMidnight = Date.parse('2026-11-02T04:30:00Z');
  const dstState = buildExpirationState({ TQQQ: [future] }, 'complete', [], null, { TQQQ: beforeDstMidnight }, new Date(beforeDstMidnight));
  assert.equal(nextScannerExpirationCheckAt(dstState, beforeDstMidnight), Date.parse('2026-11-02T05:00:00Z'));
});

test('normalized ticker keys preserve successes and a mixed-case authoritative negative overrides retention', () => {
  const previous = payload({ QQUP: [future] }, { fetchedAt: now - hour });
  const current = payload({ ' qqup ': [], tqqq: [future] });
  const merged = retainScreenerExpirationEvidence(current, previous, now);
  const result = normalizeScreenerExpirationAvailability(merged, false, now);
  assert.deepEqual(result.expirationsByTicker, { QQUP: [], TQQQ: [future] });
  assert.equal(eligible(result, 'QQUP'), false);
  assert.equal(eligible(result, 'TQQQ'), true);
});

test('a returned dated put chain proves that expiration even when provider list metadata is missing', async () => {
  const { buildScreenerExpirationDataset } = await import('../api/_lib/screenerBatch.js');
  const dataset = await buildScreenerExpirationDataset({ fetchOptions: async () => ({ optionChain: { result: [{ options: [{ expirationDate: future, puts: [{ strike: 10 }] }] }] } }) });
  assert.equal(dataset.complete, true);
  assert.deepEqual(dataset.expirationsByTicker.QQUP, [future]);
  const unknown = await buildScreenerExpirationDataset({ fetchOptions: async () => ({ optionChain: { result: [{ options: [{ puts: [{ strike: 10 }] }] }] } }) });
  assert.equal(unknown.complete, false);
  assert.equal(unknown.expirationsByTicker.QQUP, undefined);
});

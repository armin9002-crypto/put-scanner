import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeScreenerExpirationAvailability, retainScreenerExpirationEvidence, classifyScreenerExpirationEvidence, fetchScreenerExpirationAvailability } from '../src/lib/screenerAcquisition.ts';
import { buildExpirationState, nextScannerExpirationSessionCheckAt, retainScannerPositiveEvidenceAfterFailure, scannerExpirationStateNeedsRevalidation, tickerMatchesScannerExpiration } from '../src/lib/scannerUpdateState.ts';
import { primeMarketDataCache, clearMarketDataCache } from '../src/lib/marketDataRequest.ts';
import { SCREENER_TICKERS } from '../shared/screenerUniverse.js';
import { resolveScreenerExpirationDataset, SCREENER_EXPIRATION_EVIDENCE_CACHE_KEY } from '../api/_lib/screenerExpirationEvidence.js';

const now = Date.parse('2026-09-14T17:00:00Z');
const future = Date.parse('2026-10-16T00:00:00Z') / 1000;
const past = Date.parse('2026-09-11T00:00:00Z') / 1000;
const hour = 3600000;
const payload = (entries, extra = {}) => ({ datasetVersion: 4, fetchedAt: now, complete: false, expirationsByTicker: entries, errors: [], diagnostics: {}, ...extra });
function eligible(result, ticker, filter = 'all') {
  const state = buildExpirationState(result.expirationsByTicker, result.complete ? 'complete' : 'partial', result.errors);
  return tickerMatchesScannerExpiration(ticker, filter, state.availability, true, new Date(now), state.coverage);
}

function runtimeCache(initial = null) {
  const values = new Map(initial ? [[SCREENER_EXPIRATION_EVIDENCE_CACHE_KEY, initial]] : []);
  return {
    values,
    async get(key) { return values.get(key); },
    async set(key, value) { values.set(key, value); },
  };
}

function completeBackendDataset(fetchedAt, dates = [past, future]) {
  return {
    datasetVersion: 4,
    fetchedAt,
    complete: true,
    expirationsByTicker: Object.fromEntries(SCREENER_TICKERS.map(ticker => [ticker, dates])),
    errors: [],
    diagnostics: { upstreamRequests: 84, maxObservedConcurrency: 3, circuitBreakerRejections: 0 },
  };
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
  const expired = normalizeScreenerExpirationAvailability(again, false, now + 4 * 86400000);
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
  assert.deepEqual(normalizeScreenerExpirationAvailability(previous, false, now + 4 * 86400000).expirationsByTicker, {});
});

test('real shared request cache retains positive evidence after a failed next-session refresh', async () => {
  const key = 'screener_expirations_v4';
  const originalFetch = globalThis.fetch;
  const observed = Date.parse('2026-09-18T21:00:00Z');
  const mondayOpen = Date.parse('2026-09-21T14:00:00Z');
  const dynamicFuture = Math.floor(Date.parse('2026-10-16T00:00:00Z') / 1000);
  const previous = payload(Object.fromEntries(SCREENER_TICKERS.map(ticker => [ticker, ticker === 'TQQQ' ? [dynamicFuture] : []])), { complete: true, fetchedAt: observed });
  primeMarketDataCache({ key, softTtlMs: 2 * hour, hardTtlMs: 14 * 86400000, schemaVersion: 4, storage: 'local', validator: () => true }, previous, observed);
  let requests = 0;
  globalThis.fetch = async () => { requests++; return Response.json({ error: 'unavailable' }, { status: 502 }); };
  try {
    const result = await fetchScreenerExpirationAvailability({ nowMs: mondayOpen });
    assert.equal(requests, 1);
    assert.deepEqual(result.expirationsByTicker, { TQQQ: [dynamicFuture] });
    assert.equal(result.fetchedAt, observed);
    assert.equal(result.complete, false);
  } finally { globalThis.fetch = originalFetch; clearMarketDataCache(key, 'local'); }
});

test('closed-market cold bootstrap serves backend last-known-good evidence to an empty client without provider traffic', async () => {
  const friday = Date.parse('2026-09-18T20:00:00Z');
  const sunday = Date.parse('2026-09-20T18:00:00Z');
  const backend = completeBackendDataset(friday);
  const cache = runtimeCache(backend);
  let acquisitionCalls = 0;
  const resolved = await resolveScreenerExpirationDataset({
    cache,
    nowMs: sunday,
    acquire: async () => { acquisitionCalls += 1; throw new Error('must not acquire on a retained closed-market bootstrap'); },
  });
  assert.equal(acquisitionCalls, 0);
  assert.equal(resolved.source, 'last-known-good');
  assert.equal(resolved.dataset.fetchedAt, friday);
  assert.equal(resolved.dataset.retainedFromLastKnownGood, true);
  assert.equal(resolved.dataset.expirationsByTicker.TQQQ.includes(past / 1), false);
  assert.deepEqual(resolved.dataset.expirationsByTicker.TQQQ, [future]);

  const originalFetch = globalThis.fetch;
  const key = 'screener_expirations_v4';
  clearMarketDataCache(key, 'local');
  globalThis.fetch = async () => Response.json(resolved.dataset);
  try {
    const client = await fetchScreenerExpirationAvailability({ nowMs: sunday });
    assert.equal(client.complete, true);
    assert.equal(client.fetchedAt, friday);
    assert.equal(client.observedAtByTicker.TQQQ, friday);
    assert.equal(client.retainedFromLastKnownGood, true);
    assert.deepEqual(client.expirationsByTicker.TQQQ, [future]);
    assert.equal(eligible(client, 'TQQQ'), true);
  } finally {
    globalThis.fetch = originalFetch;
    clearMarketDataCache(key, 'local');
  }
});

test('last-known-good expiration evidence is replaced only by newer complete data', async () => {
  const friday = Date.parse('2026-09-18T20:00:00Z');
  const monday = Date.parse('2026-09-21T14:00:00Z');
  const cache = runtimeCache(completeBackendDataset(friday));
  const partial = {
    ...completeBackendDataset(monday),
    complete: false,
    expirationsByTicker: { QQUP: [] },
    errors: [{ ticker: 'TQQQ', message: 'Yahoo incomplete off-hours response' }],
  };
  const retainedAfterPartial = await resolveScreenerExpirationDataset({
    cache,
    freshRequested: true,
    nowMs: monday,
    acquire: async () => partial,
  });
  assert.equal(retainedAfterPartial.source, 'last-known-good');
  assert.equal(retainedAfterPartial.dataset.fetchedAt, monday);
  assert.deepEqual(retainedAfterPartial.dataset.expirationsByTicker.QQUP, []);
  const mergedClient = normalizeScreenerExpirationAvailability(retainedAfterPartial.dataset, false, monday);
  assert.deepEqual(mergedClient.expirationsByTicker.QQUP, []);
  assert.deepEqual(mergedClient.expirationsByTicker.TQQQ, [future]);
  assert.equal(mergedClient.observedAtByTicker.TQQQ, friday);
  assert.equal(cache.values.get(SCREENER_EXPIRATION_EVIDENCE_CACHE_KEY).fetchedAt, friday);

  const newer = await resolveScreenerExpirationDataset({
    cache,
    freshRequested: true,
    nowMs: monday,
    acquire: async () => completeBackendDataset(monday, [future]),
  });
  assert.equal(newer.source, 'network-complete');
  assert.equal(cache.values.get(SCREENER_EXPIRATION_EVIDENCE_CACHE_KEY).fetchedAt, monday);
});

test('without any trusted backend snapshot, a closed-market partial bootstrap stays incomplete and fail-closed', async () => {
  const sunday = Date.parse('2026-09-20T18:00:00Z');
  const cache = runtimeCache();
  const partial = {
    ...completeBackendDataset(sunday),
    complete: false,
    expirationsByTicker: {},
    errors: [{ message: 'Yahoo incomplete off-hours response' }],
  };
  const resolved = await resolveScreenerExpirationDataset({ cache, nowMs: sunday, acquire: async () => partial });
  assert.equal(resolved.source, 'network-partial');
  assert.equal(resolved.dataset.complete, false);
  assert.equal(cache.values.has(SCREENER_EXPIRATION_EVIDENCE_CACHE_KEY), false);
  const client = normalizeScreenerExpirationAvailability(resolved.dataset, false, sunday);
  assert.equal(client.complete, false);
  assert.deepEqual(client.expirationsByTicker, {});
  assert.equal(eligible(client, 'TQQQ'), false);
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

test('open Scanner state keeps structural evidence through the closed weekend and observes the canonical market day boundary', async () => {
  const { nextScannerExpirationCheckAt, revalidateScannerExpirationState } = await import('../src/lib/scannerUpdateState.ts');
  const observed = Date.parse('2026-09-18T21:00:00Z');
  const saturday = Date.parse('2026-09-19T18:00:00Z');
  const state = buildExpirationState({ TQQQ: [future] }, 'complete', [], 'retained', { TQQQ: observed }, new Date(saturday));
  assert.deepEqual(state.availability, { TQQQ: [future] });
  assert.equal(nextScannerExpirationCheckAt(state, saturday), Date.parse('2026-09-20T04:00:00Z'));
  const monday = revalidateScannerExpirationState(state, new Date('2026-09-21T14:00:00Z'));
  assert.deepEqual(monday.availability, { TQQQ: [future] });
  const expired = revalidateScannerExpirationState(state, new Date('2026-09-24T14:00:00Z'));
  assert.deepEqual(expired.availability, {});
  assert.equal(nextScannerExpirationCheckAt(expired, Date.parse('2026-09-24T14:00:00Z')), null);
  const beforeDstMidnight = Date.parse('2026-11-02T04:30:00Z');
  const dstState = buildExpirationState({ TQQQ: [future] }, 'complete', [], null, { TQQQ: beforeDstMidnight }, new Date(beforeDstMidnight));
  assert.equal(nextScannerExpirationCheckAt(dstState, beforeDstMidnight), Date.parse('2026-11-02T05:00:00Z'));
});

test('Scanner session lifecycle is quiet until Monday open and retains bounded positives after a failed reacquisition', async () => {
  const friday = Date.parse('2026-09-18T20:00:00Z');
  const saturday = Date.parse('2026-09-19T18:00:00Z');
  const sunday = Date.parse('2026-09-20T18:00:00Z');
  const mondayPreOpen = Date.parse('2026-09-21T13:00:00Z');
  const mondayOpen = Date.parse('2026-09-21T13:30:00Z');
  const state = buildExpirationState(
    { TQQQ: [future], QQUP: [] },
    'complete',
    [],
    null,
    { TQQQ: friday, QQUP: friday },
    new Date(friday),
  );

  assert.equal(scannerExpirationStateNeedsRevalidation(state, saturday), false);
  assert.equal(scannerExpirationStateNeedsRevalidation(state, sunday), false);
  assert.equal(scannerExpirationStateNeedsRevalidation(state, mondayPreOpen), false);
  assert.equal(scannerExpirationStateNeedsRevalidation(state, mondayOpen), true);
  assert.equal(nextScannerExpirationSessionCheckAt(state, friday), mondayOpen);

  const retained = retainScannerPositiveEvidenceAfterFailure(state, new Date(mondayOpen));
  assert.deepEqual(retained.availability, { TQQQ: [future] });
  assert.equal(retained.observedAtByTicker.TQQQ, friday);
  assert.equal(retained.observedAtByTicker.QQUP, undefined);
  assert.equal(tickerMatchesScannerExpiration('TQQQ', 'all', retained.availability, true, new Date(mondayOpen), retained.coverage), true);
  assert.equal(tickerMatchesScannerExpiration('QQUP', 'all', retained.availability, true, new Date(mondayOpen), retained.coverage), false);
});

test('Friday optionability keeps its original observation across weekend, expires only past dates, and revalidates in the next session', async () => {
  const { isTrustedOptionAvailabilityObservation, optionAvailabilityNeedsRevalidation } = await import('../src/lib/optionAvailability.ts');
  const friday = Date.parse('2026-09-18T21:00:00Z');
  const saturday = Date.parse('2026-09-19T18:00:00Z');
  const sunday = Date.parse('2026-09-20T18:00:00Z');
  const mondayPreOpen = Date.parse('2026-09-21T13:00:00Z');
  const mondayOpen = Date.parse('2026-09-21T14:00:00Z');
  const fridayExpiration = Date.parse('2026-09-18T00:00:00Z') / 1000;
  const futureExpiration = Date.parse('2026-10-16T00:00:00Z') / 1000;
  const source = payload({ TQQQ: [fridayExpiration, futureExpiration] }, { fetchedAt: friday, complete: true });
  for (const asOf of [saturday, sunday, mondayPreOpen]) {
    const result = normalizeScreenerExpirationAvailability(source, false, asOf);
    assert.deepEqual(result.expirationsByTicker, { TQQQ: [futureExpiration] });
    assert.equal(result.observedAtByTicker.TQQQ, friday);
    assert.equal(eligible(result, 'TQQQ'), true);
    assert.equal(isTrustedOptionAvailabilityObservation(friday, asOf), true);
    assert.equal(optionAvailabilityNeedsRevalidation(friday, asOf), false);
  }
  assert.equal(optionAvailabilityNeedsRevalidation(friday, mondayOpen), true);
  assert.equal(optionAvailabilityNeedsRevalidation(mondayOpen, Date.parse('2026-09-21T21:00:00Z')), false, 'same-session after-hours remains quiet');
  const failed = normalizeScreenerExpirationAvailability(source, true, mondayOpen);
  assert.deepEqual(failed.expirationsByTicker, { TQQQ: [futureExpiration] });
  assert.equal(failed.observedAtByTicker.TQQQ, friday);
  assert.equal(failed.complete, false);
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

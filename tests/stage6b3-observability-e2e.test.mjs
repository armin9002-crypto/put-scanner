import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { observeMarketRequest } from '../api/_lib/requestObservability.js';
import { assertWithinRequestBudget, failedScreenerRetryBudget, REQUEST_BUDGETS, uniqueChainRefreshBudget } from '../src/lib/requestBudgets.ts';
import { getDevelopmentRequestSummary, getRequestDiagnosticsSnapshot, resetRequestDiagnosticsForTests, setRequestDiagnosticsEnabledForTests, fetchObservedMarketData } from '../src/lib/requestDiagnostics.ts';
import { requestMarketData } from '../src/lib/marketDataRequest.ts';
import { notifyLocalStorageFailure, subscribeToLocalStorageFailures } from '../src/lib/storageFeedback.ts';
import { persistShowNominalYield } from '../src/lib/optionTablePreferences.ts';

class MockResponse extends EventEmitter {
  headers = new Map();
  statusCode = 200;
  writableEnded = false;
  setHeader(name, value) { this.headers.set(name.toLowerCase(), String(value)); }
  getHeader(name) { return this.headers.get(name.toLowerCase()); }
  status(value) { this.statusCode = value; return this; }
  json(value) { this.writableEnded = true; this.body = value; return this; }
}

test('server observer echoes a safe correlation id and logs counts without market or account payloads', () => {
  const req = new EventEmitter();
  req.method = 'GET';
  req.headers = { 'x-putscanner-request-id': 'ps-browser-safe-123' };
  const res = new MockResponse();
  const logs = [];
  const originalInfo = console.info;
  console.info = value => logs.push(JSON.parse(value));
  try {
    const observation = observeMarketRequest(req, res, { endpoint: 'prices' });
    observation.setCounts({ tickerCount: 3, expiryCount: 0 });
    res.setHeader('X-PutScanner-Upstream-Requests', '1');
    res.setHeader('X-PutScanner-Cache-Strategy', 'public');
    res.status(200).json({ secretTicker: 'TQQQ', premium: 123 });
  } finally { console.info = originalInfo; }
  assert.equal(res.getHeader('X-PutScanner-Request-Id'), 'ps-browser-safe-123');
  assert.equal(res.getHeader('X-PutScanner-Failure-Category'), 'none');
  assert.match(res.getHeader('X-PutScanner-Server-Duration-Ms'), /^\d+$/);
  assert.deepEqual(logs.map(log => ({ endpoint: log.endpoint, tickerCount: log.tickerCount, providerAttemptCount: log.providerAttemptCount, outcome: log.outcome })), [{ endpoint: 'prices', tickerCount: 3, providerAttemptCount: 1, outcome: 'success' }]);
  assert.equal(JSON.stringify(logs).includes('TQQQ'), false);
  assert.equal(JSON.stringify(logs).includes('premium'), false);
});

test('browser observer sends correlation ids and summarizes diagnostic response headers in memory only', async () => {
  setRequestDiagnosticsEnabledForTests(true);
  resetRequestDiagnosticsForTests();
  const realFetch = globalThis.fetch;
  let sentId = '';
  globalThis.fetch = async (_input, init) => {
    sentId = new Headers(init.headers).get('X-PutScanner-Request-Id');
    return Response.json({}, { headers: {
      'X-PutScanner-Request-Id': sentId,
      'X-PutScanner-Upstream-Requests': '2',
      'X-PutScanner-Retry-Count': '1',
      'X-PutScanner-Server-Duration-Ms': '7',
      'X-PutScanner-Cache-Status': 'MISS',
      'X-PutScanner-Failure-Category': 'none',
    } });
  };
  try { await fetchObservedMarketData('options', '/api/options', undefined, 'unit'); }
  finally { globalThis.fetch = realFetch; }
  assert.match(sentId, /^ps-/);
  assert.deepEqual(getDevelopmentRequestSummary(), { browserRequests: 1, vercelResponses: 1, providerAttempts: 2, retries: 1, failures: 0, aborted: 0, byEndpoint: { options: { browserRequests: 1, providerAttempts: 2, failures: 0 } } });
});

test('consumer abort stops obsolete broker work without a failure or stale fallback', async () => {
  setRequestDiagnosticsEnabledForTests(true);
  resetRequestDiagnosticsForTests();
  const controller = new AbortController();
  let fetcherAborted = false;
  const promise = requestMarketData({
    key: 'stage6b3-abort', source: 'unit-abort', endpoint: 'options', softTtlMs: 1, hardTtlMs: 1,
    schemaVersion: 1, storage: 'none', signal: controller.signal, validator: () => true,
    fetcher: signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => { fetcherAborted = true; reject(signal.reason); }, { once: true })),
  });
  controller.abort(new DOMException('Superseded', 'AbortError'));
  await assert.rejects(promise, error => error.name === 'AbortError');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(fetcherAborted, true);
  assert.equal(getRequestDiagnosticsSnapshot().options.aborted, 1);
  assert.equal(getRequestDiagnosticsSnapshot().options.failures, 0);
});

test('request budgets reject material request multiplication and failed Screener retry scales by failed batches only', () => {
  assert.doesNotThrow(() => assertWithinRequestBudget('ticker-detail', REQUEST_BUDGETS['ticker-detail']));
  assert.throws(() => assertWithinRequestBudget('ticker-detail', { browserRequests: 2, vercelResponses: 2, providerAttempts: 8 }), /budget exceeded/);
  assert.deepEqual(failedScreenerRetryBudget(2), { browserRequests: 2, vercelResponses: 2, providerAttempts: 18 });
  assert.ok(failedScreenerRetryBudget(2).browserRequests < REQUEST_BUDGETS['screener-full-scan'].browserRequests);
  assert.deepEqual(uniqueChainRefreshBudget(20, 6), { browserRequests: 7, vercelResponses: 7, providerAttempts: 7 });
  assert.deepEqual(uniqueChainRefreshBudget(21, 6), { browserRequests: 7, vercelResponses: 7, providerAttempts: 8 });
});

test('local storage failure feedback is transient and contains no durable data', () => {
  let calls = 0;
  const unsubscribe = subscribeToLocalStorageFailures(() => { calls += 1; });
  persistShowNominalYield(true, { setItem() { throw new Error('quota fixture'); } });
  unsubscribe();
  notifyLocalStorageFailure();
  assert.equal(calls, 1);
});

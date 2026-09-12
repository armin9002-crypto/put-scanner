import assert from 'node:assert/strict';
import test from 'node:test';

import { mapWithConcurrency } from '../shared/concurrency.js';
import { requestMarketData } from '../src/lib/marketDataRequest.ts';
import { updateScannerSnapshotForTicker } from '../src/lib/scannerOptionSnapshot.ts';

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test('Scanner snapshot worker cancellation stops queued tasks and aborts active tasks', async () => {
  const controller = new AbortController();
  const started = [];
  const tasks = Array.from({ length: 8 }, (_, index) => async () => {
    started.push(index);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, 100);
      controller.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(controller.signal.reason ?? new DOMException('aborted', 'AbortError'));
      }, { once: true });
    });
    return index;
  });

  const settledPromise = mapWithConcurrency(tasks, 3, task => task(), { signal: controller.signal });
  await delay(5);
  controller.abort(new DOMException('Scanner route closed', 'AbortError'));
  const settled = await settledPromise;

  assert.deepEqual(started, [0, 1, 2], 'only the bounded active set began before cancellation');
  assert.equal(settled.length, tasks.length);
  assert.ok(settled.every(result => result.status === 'rejected'));
});

test('abandoned Scanner snapshot update propagates abort and never completes as trusted data', async () => {
  const controller = new AbortController();
  let receivedSignal;
  const update = updateScannerSnapshotForTicker({
    ticker: 'TQQQ',
    scannerPrice: 100,
    expirationDates: [1_798_761_600],
    signal: controller.signal,
    fetchChain: async (_expiration, signal) => {
      receivedSignal = signal;
      return new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason ?? new DOMException('aborted', 'AbortError')), { once: true });
        void resolve;
      });
    },
  });
  await delay(5);
  assert.equal(receivedSignal, controller.signal);
  controller.abort(new DOMException('Scanner route closed', 'AbortError'));
  await assert.rejects(update, error => error?.name === 'AbortError');
});

test('aborted market-data responses cannot populate the trusted cache', async () => {
  const key = `scanner-cancellation-test-${Date.now()}-${Math.random()}`;
  const controller = new AbortController();
  let fetches = 0;
  const request = options => requestMarketData({
    key,
    source: 'test:scanner-snapshot-cancellation',
    endpoint: 'options',
    softTtlMs: 60_000,
    hardTtlMs: 120_000,
    schemaVersion: 1,
    signal: options?.signal,
    validator: value => value?.trusted === true,
    fetcher: async () => {
      fetches += 1;
      await delay(25);
      return { trusted: true, fetches };
    },
  });

  const abandoned = request({ signal: controller.signal });
  await delay(5);
  controller.abort(new DOMException('Scanner route closed', 'AbortError'));
  await assert.rejects(abandoned, error => error?.name === 'AbortError');
  await delay(35);

  const replacement = await request();
  assert.equal(replacement.data.fetches, 2, 'the replacement request ran instead of receiving an aborted cache entry');
  assert.equal(fetches, 2);
});

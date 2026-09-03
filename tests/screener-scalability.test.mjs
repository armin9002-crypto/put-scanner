import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { mapWithConcurrency } from '../shared/concurrency.js';
import {
  SCREENER_BROWSER_CONCURRENCY,
  SCREENER_CHUNKS,
  SCREENER_SERVER_CONCURRENCY,
  SCREENER_TICKERS,
} from '../shared/screenerUniverse.js';
import { buildScreenerBatch, buildScreenerExpirationDataset, planRepresentativeExpirations, responseBytes, SCREENER_BATCH_MAX_BYTES } from '../api/_lib/screenerBatch.js';
import { calculateIvVsRealizedVolFromCloses, currentAtmIvFromOptionData } from '../api/_lib/ivRank.js';
import {
  createLatestScreenerScanGate,
  fetchScreenerBatch,
  planScreenerBatches,
  retryFailedScreenerBatches,
  runScreenerBatchScan,
  screenerDatasetScopeKey,
} from '../src/lib/screenerAcquisition.ts';
import { canonicalOptionChainKey } from '../src/lib/optionChainRequests.ts';
import { calculateYieldPercent } from '../src/lib/optionMetrics.ts';
import { calculatePutDelta } from '../src/lib/putDelta.ts';
import { ETF_LIST } from '../src/lib/etfs.ts';
import { applyScreenerFilters, buildScreenerRows } from '../src/lib/screenerRows.ts';
import { getScreenerScanDiagnostics, resetRequestDiagnosticsForTests, setRequestDiagnosticsEnabledForTests } from '../src/lib/requestDiagnostics.ts';

const EXPIRATION_ONE = 1_800_576_000;
const EXPIRATION_TWO = 1_801_180_800;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

function yahooChain(ticker, expiration = EXPIRATION_ONE, expirationDates = [EXPIRATION_ONE, EXPIRATION_TWO], putCount = 2) {
  return {
    optionChain: {
      result: [{
        quote: { regularMarketPrice: 100 },
        expirationDates,
        options: [{
          expirationDate: expiration,
          puts: Array.from({ length: putCount }, (_, index) => ({
            contractSymbol: `${ticker}FIXTUREP${index}`,
            strike: 90 + index * 5,
            lastPrice: 2.2 + index,
            lastTradeDate: 1_799_000_000,
            bid: 2 + index,
            ask: 2.5 + index,
            delta: index === 0 ? -0.2 : null,
            impliedVolatility: 0.8,
            volume: 20 + index,
            openInterest: 100 + index,
          })),
        }],
      }],
    },
  };
}

function batchPayload(plan, overrides = {}) {
  return {
    datasetVersion: 2,
    chunkId: plan.chunkId,
    targetDate: plan.targetDate,
    fetchedAt: Date.now(),
    complete: true,
    tickers: Object.fromEntries(plan.chunkTickers.map(ticker => [ticker, {
      ticker,
      expirationDates: [EXPIRATION_ONE, EXPIRATION_TWO],
      initialExpiration: EXPIRATION_ONE,
      initial: yahooChain(ticker),
      additionalChains: { [EXPIRATION_TWO]: yahooChain(ticker, EXPIRATION_TWO) },
      ivVsRealizedRange: 42,
    }])),
    errors: [],
    diagnostics: {
      plannedEtfs: plan.chunkTickers.length,
      plannedOptionChains: plan.chunkTickers.length * 2,
      uniqueChains: plan.chunkTickers.length * 2,
      upstreamRequests: plan.chunkTickers.length * 3,
      maxObservedConcurrency: SCREENER_SERVER_CONCURRENCY,
      circuitBreakerRejections: 0,
      elapsedMs: 10,
    },
    ...overrides,
  };
}

const networkMeta = {
  freshness: 'fresh', source: 'network', fetchedAt: Date.now(), networkCall: true,
  deduped: false, staleFallbackUsed: false,
};

test('Screener universe is covered once by 14 stable, fixed-order chunks', () => {
  assert.equal(SCREENER_TICKERS.length, 42);
  assert.equal(SCREENER_CHUNKS.length, 14);
  assert.ok(SCREENER_CHUNKS.every(chunk => chunk.tickers.length === 3));
  assert.deepEqual(SCREENER_CHUNKS.flatMap(chunk => chunk.tickers), [...SCREENER_TICKERS]);
  assert.equal(new Set(SCREENER_CHUNKS.flatMap(chunk => chunk.tickers)).size, 42);
  assert.deepEqual(SCREENER_TICKERS, ETF_LIST.map(etf => etf.ticker));
  assert.deepEqual(SCREENER_CHUNKS[0], { id: 0, tickers: ['AGQ', 'BOIL', 'BRZU'] });
  assert.deepEqual(SCREENER_CHUNKS[13], { id: 13, tickers: ['UYM', 'WEBL', 'YINN'] });
});

test('batch planning is deterministic and only structural expiration changes alter acquisition keys', () => {
  const selected = ['TQQQ', 'AGQ', 'YINN'];
  const all = planScreenerBatches(selected, 'all');
  const thirtyDte = planScreenerBatches(selected, 'lte_30dte');
  const exact = planScreenerBatches(selected, `date_${EXPIRATION_TWO}`);
  assert.deepEqual(all.map(plan => plan.chunkId), [0, 9, 13]);
  assert.deepEqual(all.map(plan => plan.cacheKey), thirtyDte.map(plan => plan.cacheKey));
  assert.notDeepEqual(all.map(plan => plan.cacheKey), exact.map(plan => plan.cacheKey));
  assert.equal(screenerDatasetScopeKey('__ALL__', 'all'), screenerDatasetScopeKey('__ALL__', 'lte_30dte'));
  assert.notEqual(screenerDatasetScopeKey('__ALL__', 'all'), screenerDatasetScopeKey('__ALL__', `date_${EXPIRATION_TWO}`));
  assert.notEqual(screenerDatasetScopeKey('__ALL__', 'all'), screenerDatasetScopeKey('TQQQ', 'all'));
  assert.deepEqual(all[1].chunkTickers, ['TECL', 'TNA', 'TQQQ']);
  assert.deepEqual(all[1].selectedTickers, ['TQQQ']);
});

test('server batch reuses initial options for realized-vol context, isolates failures, and caps Yahoo concurrency at three', async () => {
  const startedAt = Date.now();
  let active = 0;
  let maximum = 0;
  const optionCalls = new Map();
  const begin = async onAttempt => {
    onAttempt?.();
    active += 1;
    maximum = Math.max(maximum, active);
    await delay(3);
    active -= 1;
  };
  const dataset = await buildScreenerBatch({
    chunkId: 0,
    concurrency: SCREENER_SERVER_CONCURRENCY,
    fetchOptions: async (ticker, date, options) => {
      const key = canonicalOptionChainKey(ticker, date ?? EXPIRATION_ONE);
      optionCalls.set(key, (optionCalls.get(key) ?? 0) + 1);
      await begin(options.onAttempt);
      if (ticker === 'BOIL' && date === EXPIRATION_TWO) throw new Error('fixture chain failure');
      return yahooChain(ticker, date ?? EXPIRATION_ONE);
    },
    fetchVolatilityContext: async (ticker, options) => {
      assert.ok(options.optionData, `${ticker} volatility context should reuse its initial chain`);
      await begin(options.onAttempt);
      return { currentIV: 80, rangePosition: 40, observationPercent: 50 };
    },
  });
  assert.ok(maximum <= SCREENER_SERVER_CONCURRENCY);
  assert.equal(dataset.diagnostics.maxObservedConcurrency, maximum);
  assert.equal(dataset.diagnostics.upstreamRequests, 9);
  assert.equal([...optionCalls.values()].every(count => count === 1), true);
  assert.equal(optionCalls.size, 6);
  assert.equal(dataset.complete, false);
  assert.equal(dataset.errors.length, 1);
  assert.equal(Object.keys(dataset.tickers).length, 3);
  assert.equal(dataset.tickers.AGQ.ivVsRealizedRange, 40);
  assert.deepEqual(Object.keys(dataset.tickers.BOIL.additionalChains), []);
  assert.ok(Date.now() - startedAt < 1_000, 'deterministic mocked cold-batch fixture should complete well below one second');
});

test('Recommendations representative planner measures three selected tenors plus bounded discovery and volatility work', async () => {
  const nowMs = Date.parse('2026-09-02T15:00:00.000Z');
  const day = Math.floor(Date.parse('2026-09-02T00:00:00.000Z') / 1_000);
  const expirations = [30, 60, 90, 180, 365, 400].map(dte => day + dte * 86_400);
  const optionCalls = [];
  const dataset = await buildScreenerBatch({
    chunkId: 0,
    representativeExpirationPlan: true,
    minimumDte: 60,
    maximumDte: 365,
    maximumExpirations: 3,
    nowMs,
    fetchOptions: async (ticker, date, options) => {
      options.onAttempt?.();
      optionCalls.push({ ticker, date });
      return yahooChain(ticker, date ?? expirations[0], expirations);
    },
    fetchVolatilityContext: async (_ticker, options) => {
      options.onAttempt?.();
      return { currentIV: 80, rangePosition: 40, observationPercent: 50 };
    },
  });
  const planned = planRepresentativeExpirations(expirations, { nowMs, minimumDte: 60, maximumDte: 365, maximumCount: 3 });
  assert.deepEqual(planned.selected, [expirations[1], expirations[2], expirations[4]]);
  assert.ok(Object.values(dataset.tickers).every(ticker => ticker.selectedExpirationDates.length === 3));
  assert.equal(dataset.diagnostics.plannedOptionChains, 12, 'three discovery chains plus nine selected representative chains');
  assert.equal(optionCalls.length, 12);
  assert.equal(dataset.diagnostics.upstreamRequests, 15, 'option work plus one reused-input volatility calculation per ETF');
  assert.equal(dataset.complete, true);
});

test('expiration discovery consolidates seven browser calls behind one bounded partial-safe dataset', async () => {
  let active = 0;
  let maximum = 0;
  let calls = 0;
  const dataset = await buildScreenerExpirationDataset({
    fetchOptions: async (ticker, options) => {
      calls += 1;
      options.onAttempt?.();
      active += 1;
      maximum = Math.max(maximum, active);
      await delay(2);
      active -= 1;
      if (ticker === 'LABU') throw new Error('fixture expiration failure');
      return yahooChain(ticker);
    },
  });
  assert.equal(calls, 7);
  assert.ok(maximum <= SCREENER_SERVER_CONCURRENCY);
  assert.equal(dataset.diagnostics.upstreamRequests, 7);
  assert.equal(Object.keys(dataset.expirationsByTicker).length, 6);
  assert.deepEqual(dataset.errors, [{ ticker: 'LABU', message: 'fixture expiration failure' }]);
});

test('full scan caps browser concurrency at two and combined simulated upstream work at six', async () => {
  setRequestDiagnosticsEnabledForTests(true);
  resetRequestDiagnosticsForTests();
  let browserActive = 0;
  let browserMaximum = 0;
  let upstreamActive = 0;
  let combinedMaximum = 0;
  let progress = 0;
  const result = await runScreenerBatchScan({
    scanId: 'full-concurrency-fixture',
    selectedTickers: SCREENER_TICKERS,
    expFilter: 'all',
    fetchBatch: async plan => {
      browserActive += 1;
      browserMaximum = Math.max(browserMaximum, browserActive);
      await mapWithConcurrency([0, 1, 2, 3, 4, 5], SCREENER_SERVER_CONCURRENCY, async () => {
        upstreamActive += 1;
        combinedMaximum = Math.max(combinedMaximum, upstreamActive);
        await delay(2);
        upstreamActive -= 1;
      });
      browserActive -= 1;
      return { payload: batchPayload(plan), meta: networkMeta };
    },
    onProgress: current => { progress = current; },
  });
  assert.equal(result.plannedBatches, 14);
  assert.equal(result.completedBatches, 14);
  assert.equal(result.initialResults.size, 42);
  assert.equal(progress, 42);
  assert.ok(browserMaximum <= SCREENER_BROWSER_CONCURRENCY);
  assert.ok(combinedMaximum <= SCREENER_BROWSER_CONCURRENCY * SCREENER_SERVER_CONCURRENCY);
  const diagnostics = getScreenerScanDiagnostics();
  assert.equal(diagnostics.browserBatchRequests, 14);
  assert.equal(diagnostics.maxClientBatchConcurrency, 2);
  assert.equal(diagnostics.maxServerYahooConcurrency, 3);
  setRequestDiagnosticsEnabledForTests(null);
});

test('batch acquisition dedupes in-flight and warm requests while partial data revalidates', async () => {
  const previousFetch = globalThis.fetch;
  const fullPlan = planScreenerBatches(['YINN'], `date_${EXPIRATION_TWO}`)[0];
  let fullCalls = 0;
  globalThis.fetch = async () => {
    fullCalls += 1;
    await delay(5);
    return Response.json(batchPayload(fullPlan));
  };
  try {
    const [first, deduped] = await Promise.all([fetchScreenerBatch(fullPlan), fetchScreenerBatch(fullPlan)]);
    const warm = await fetchScreenerBatch(fullPlan);
    assert.equal(fullCalls, 1);
    assert.equal(first.meta.networkCall, true);
    assert.equal(deduped.meta.deduped, true);
    assert.equal(warm.meta.networkCall, false);

    const partialPlan = planScreenerBatches(['YINN'], `date_${EXPIRATION_TWO + 86_400}`)[0];
    let partialCalls = 0;
    globalThis.fetch = async () => {
      partialCalls += 1;
      if (partialCalls === 2) return new Response('temporary failure', { status: 503 });
      const complete = partialCalls >= 3;
      return Response.json(batchPayload(partialPlan, {
        complete,
        errors: complete ? [] : [{ ticker: 'WEBL', message: 'fixture partial' }],
      }));
    };
    const partial = await fetchScreenerBatch(partialPlan);
    const stalePartial = await fetchScreenerBatch(partialPlan);
    const recovered = await fetchScreenerBatch(partialPlan);
    assert.equal(partial.payload.complete, false);
    assert.equal(stalePartial.meta.staleFallbackUsed, true);
    assert.equal(recovered.payload.complete, true);
    assert.equal(partialCalls, 3);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test('one failed batch preserves successful batches and retry reconstruction has no duplicate rows', async () => {
  const selected = SCREENER_TICKERS.slice(0, 6);
  const first = await runScreenerBatchScan({
    scanId: 'partial-batch-fixture',
    selectedTickers: selected,
    expFilter: 'all',
    fetchBatch: async plan => {
      if (plan.chunkId === 1) throw new Error('fixture batch unavailable');
      return { payload: batchPayload(plan), meta: networkMeta };
    },
  });
  assert.equal(first.initialResults.size, 3);
  assert.equal(first.completedBatches, 1);
  assert.deepEqual(first.failedBatchIds, [1]);
  assert.deepEqual(first.errors, [{ batchId: 1, message: 'fixture batch unavailable' }]);

  let retryCalls = 0;
  const retried = await retryFailedScreenerBatches({
    scanId: 'retry-batch-fixture',
    selectedTickers: selected,
    expFilter: 'all',
    failedBatchIds: first.failedBatchIds,
    previous: first,
    fetchBatch: async plan => { retryCalls += 1; return { payload: batchPayload(plan), meta: networkMeta }; },
  });
  const rebuilt = buildScreenerRows(retried, 'all');
  assert.equal(retried.initialResults.size, 6);
  assert.equal(retried.chainsByKey.size, 12);
  assert.equal(retryCalls, 1);
  assert.deepEqual(retried.failedBatchIds, []);
  assert.equal(new Set(rebuilt.rows.map(row => `${row.ticker}|${row.expDate}|${row.strike}`)).size, rebuilt.rows.length);
});

test('an all-failed Screener scan exposes no partial data and a normal full retry reacquires every failed batch', async () => {
  const selected = SCREENER_TICKERS.slice(0, 6);
  const failed = await runScreenerBatchScan({
    scanId: 'all-failed-fixture',
    selectedTickers: selected,
    expFilter: 'all',
    fetchBatch: async plan => { throw new Error(`fixture batch ${plan.chunkId} unavailable`); },
  });
  assert.equal(failed.initialResults.size, 0);
  assert.equal(failed.completedBatches, 0);
  assert.deepEqual(failed.failedBatchIds, [0, 1]);
  assert.equal(failed.errors.length, 2);

  let retryCalls = 0;
  const recovered = await retryFailedScreenerBatches({
    scanId: 'all-failed-retry-fixture',
    selectedTickers: selected,
    expFilter: 'all',
    failedBatchIds: failed.failedBatchIds,
    previous: failed,
    fetchBatch: async plan => {
      retryCalls += 1;
      return { payload: batchPayload(plan), meta: networkMeta };
    },
  });
  assert.equal(retryCalls, 2);
  assert.equal(recovered.initialResults.size, 6);
  assert.deepEqual(recovered.failedBatchIds, []);
});

test('a stale failed-batch retry is aborted and cannot publish into a newer generation', async () => {
  const selected = SCREENER_TICKERS.slice(0, 6);
  const previous = await runScreenerBatchScan({
    scanId: 'stale-retry-previous',
    selectedTickers: selected,
    expFilter: 'all',
    fetchBatch: async plan => {
      if (plan.chunkId === 1) throw new Error('fixture retry scope');
      return { payload: batchPayload(plan), meta: networkMeta };
    },
  });
  const gate = createLatestScreenerScanGate();
  const publications = [];
  const older = gate.begin();
  let oldRetryStarted;
  const started = new Promise(resolve => { oldRetryStarted = resolve; });
  const olderPromise = retryFailedScreenerBatches({
    scanId: older.id,
    selectedTickers: selected,
    expFilter: 'all',
    failedBatchIds: previous.failedBatchIds,
    previous,
    signal: older.signal,
    fetchBatch: async plan => new Promise((resolve, reject) => {
      oldRetryStarted();
      const onAbort = () => reject(older.signal.reason ?? new DOMException('Aborted', 'AbortError'));
      older.signal.addEventListener('abort', onAbort, { once: true });
      setTimeout(() => {
        older.signal.removeEventListener('abort', onAbort);
        resolve({ payload: batchPayload(plan), meta: networkMeta });
      }, 100);
    }),
  });
  await started;
  const newer = gate.begin();
  const newerResult = await runScreenerBatchScan({
    scanId: newer.id,
    selectedTickers: selected.slice(0, 3),
    expFilter: 'all',
    signal: newer.signal,
    fetchBatch: async plan => ({ payload: batchPayload(plan), meta: networkMeta }),
  });
  const olderResult = await olderPromise;
  if (older.isCurrent()) publications.push({ generation: 'A', result: olderResult });
  if (newer.isCurrent()) publications.push({ generation: 'B', result: newerResult });
  assert.equal(older.signal.aborted, true);
  assert.deepEqual(publications.map(publication => publication.generation), ['B']);
  assert.equal(publications[0].result.initialResults.size, 3);
});

test('latest-scan gate aborts and invalidates an older scan before state publication', () => {
  const gate = createLatestScreenerScanGate();
  const older = gate.begin();
  const newer = gate.begin();
  assert.equal(older.signal.aborted, true);
  assert.equal(older.isCurrent(), false);
  assert.equal(newer.signal.aborted, false);
  assert.equal(newer.isCurrent(), true);
  gate.cancel();
  assert.equal(newer.signal.aborted, true);
  assert.equal(newer.isCurrent(), false);
});

test('Screener row reconstruction preserves pricing, Greeks, yields, filters, and exact-date counts', () => {
  const first = {
    expirations: [{ date: EXPIRATION_ONE, label: 'One', dte: 10 }, { date: EXPIRATION_TWO, label: 'Two', dte: 17 }],
    currentPrice: 100,
    puts: [
      { strike: 90, last: 2.2, lastTradeDate: 1_799_000_000, bid: 2, ask: 2.5, delta: -0.2, impliedVolatility: 80, volume: 20, openInterest: 100 },
      { strike: 95, last: 3.2, lastTradeDate: 1_799_000_000, bid: 3, ask: 3.5, delta: null, impliedVolatility: 60, volume: 30, openInterest: 120 },
    ],
  };
  const second = { ...first, puts: [first.puts[0]] };
  const data = {
    initialResults: new Map([['TQQQ', first]]),
    chainsByKey: new Map([
      [canonicalOptionChainKey('TQQQ', EXPIRATION_ONE), first],
      [canonicalOptionChainKey('TQQQ', EXPIRATION_TWO), second],
    ]),
    ivVsRealizedRangeByTicker: new Map([['TQQQ', 42]]),
  };
  const all = buildScreenerRows(data, 'all');
  assert.equal(all.rows.length, 3);
  assert.equal(all.rows[0].ticker, 'TQQQ');
  assert.equal(all.rows[0].delta, -0.2);
  assert.ok(Math.abs(all.rows[1].delta - calculatePutDelta(100, 95, 10 / 365, 0.045, 0.6)) < 1e-12);
  assert.deepEqual(
    { nominal: all.rows[0].nomYieldBid, annualized: all.rows[0].annYieldBid },
    calculateYieldPercent(2, 90, 10),
  );
  assert.equal(all.rows[0].moneynessPct, 10);
  assert.equal(all.rows[0].volOI, 0.2);
  assert.equal(all.rows[0].ivVsRealizedRange, 42);
  assert.deepEqual(Object.keys(all.rows[0]), [
    'ticker', 'currentPrice', 'expDate', 'expLabel', 'dte', 'strike', 'moneynessPct', 'moneynessLabel',
    'moneynessColor', 'delta', 'bid', 'last', 'lastTradeDate', 'ask', 'iv', 'nomYieldBid', 'nomYieldAsk',
    'nomYieldLast', 'annYieldBid', 'annYieldAsk', 'annYieldLast', 'volume', 'openInterest', 'volOI', 'ivVsRealizedRange',
  ]);
  const exact = buildScreenerRows(data, `date_${EXPIRATION_TWO}`);
  assert.equal(exact.rows.length, 1);
  assert.equal(exact.rows[0].expDate, EXPIRATION_TWO);
  assert.equal(applyScreenerFilters(all.rows, { deltaFilter: 'below_0.25', moneynessFilter: 'all', yieldFilter: 'all', oiFilter: '>50', volFilter: '>10', ivVsRealizedRangeFilter: '20_to_50' }).length, 2);
});

test('IV-versus-realized-range extraction preserves the audited calculation under truthful names', () => {
  const optionData = yahooChain('TQQQ');
  assert.equal(currentAtmIvFromOptionData(optionData), 80);
  const closes = Array.from({ length: 60 }, (_, index) => 100 + Math.sin(index / 3) * 4 + index * 0.4);
  const result = calculateIvVsRealizedVolFromCloses(80, closes);
  assert.equal(result.currentIV, 80);
  assert.equal(result.rangePosition, 100);
  assert.equal(result.observationPercent, 100);
  assert.ok(result.realizedVolLow < result.realizedVolHigh);
  assert.equal(result.observationCount, 56);
});

test('representative three-ticker payload remains below the endpoint guard and functions keep a 60-second ceiling', async () => {
  const plan = planScreenerBatches(['AGQ'], 'all')[0];
  const payload = batchPayload(plan);
  plan.chunkTickers.forEach(ticker => {
    payload.tickers[ticker].initial = yahooChain(ticker, EXPIRATION_ONE, [EXPIRATION_ONE, EXPIRATION_TWO], 100);
    payload.tickers[ticker].additionalChains[EXPIRATION_TWO] = yahooChain(ticker, EXPIRATION_TWO, [EXPIRATION_ONE, EXPIRATION_TWO], 100);
  });
  const bytes = responseBytes(payload);
  assert.ok(bytes > 100_000);
  assert.ok(bytes < SCREENER_BATCH_MAX_BYTES);
  const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.equal(vercel.functions['api/screener-batch.js'].maxDuration, 60);
  assert.equal(vercel.functions['api/screener-expirations.js'].maxDuration, 60);
});

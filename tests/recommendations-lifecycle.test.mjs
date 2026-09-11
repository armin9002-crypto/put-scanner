import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { withEtfPulseTechnicalAssessment } from '../src/lib/etfPulseMetrics.ts';
import { buildEtfPulseRows, ETF_PULSE_CURRENTNESS_MAX_AGE_MS, ETF_PULSE_ROW_CACHE_KEY, getEtfPulseUniverse } from '../src/lib/etfPulseData.ts';
import { createLatestScreenerScanGate } from '../src/lib/screenerAcquisition.ts';
import { recommendationRunDescription } from '../src/lib/recommendations/presentation.ts';
import {
  RecommendationAcquisitionError,
  RecommendationEngineError,
  classifyRecommendationRefreshError,
} from '../src/lib/recommendations/refreshLifecycle.ts';
import { refreshRecommendations } from '../src/lib/recommendations/acquisition.ts';
import { buildRecommendationVisualFixture } from '../src/lib/recommendations/visualFixtures.ts';

const AS_OF_MS = Date.parse('2026-09-02T15:00:00.000Z');

function pulseRow(ticker, overrides = {}) {
  return withEtfPulseTechnicalAssessment({
    ticker,
    name: `${ticker} fixture`,
    type: 'Sector',
    leverage: '3x',
    underlying: 'Fixture exposure',
    price: 100,
    returns: { oneDay: 0.01, fiveDay: 0.02, thirtyDay: 0.05, threeMonth: 0.1, sixMonth: 0.18, yearToDate: 0.22, oneYear: 0.3 },
    rsi14: 52,
    realizedVolatility20: 0.42,
    sma20: 100,
    sma50: 98,
    sma200: 90,
    distance20: 0,
    distance50: 0.02,
    distance200: 0.1,
    high52Week: 120,
    low52Week: 50,
    percentOf52WeekHigh: 0.83,
    position52Week: 0.71,
    drawdown52Week: -0.16,
    recentDrawdown30: -0.02,
    ...overrides,
  });
}

function pulseResult(overrides = {}) {
  const row = pulseRow('TQQQ');
  return {
    rows: [row],
    fetchedAt: AS_OF_MS,
    total: 1,
    loaded: 1,
    failed: 0,
    errors: [],
    currentRows: 1,
    retainedRows: 0,
    unavailableRows: 0,
    stale: false,
    rowEvidence: { TQQQ: { freshness: 'current', observedAt: AS_OF_MS, source: 'network' } },
    ...overrides,
  };
}

function emptyScan() {
  return {
    initialResults: new Map(),
    chainsByKey: new Map(),
    ivVsRealizedRangeByTicker: new Map(),
    errors: [],
    plannedBatches: 0,
    completedBatches: 0,
    failedBatchIds: [],
  };
}

test('terminal state matrix keeps complete NO TRADE separate from incomplete analysis', () => {
  const actionable = buildRecommendationVisualFixture('actionable');
  const noTrade = buildRecommendationVisualFixture('no-trade');
  const incompleteWithOpportunity = buildRecommendationVisualFixture('incomplete');
  const incompleteWithoutOpportunity = { ...noTrade, operationalStatus: 'INCOMPLETE', runVerdict: null };

  assert.equal(actionable.operationalStatus, 'COMPLETE');
  assert.equal(actionable.runVerdict, 'OPPORTUNITIES_FOUND');
  assert.equal(noTrade.operationalStatus, 'COMPLETE');
  assert.equal(noTrade.runVerdict, 'NO_TRADE');
  assert.equal(incompleteWithOpportunity.operationalStatus, 'INCOMPLETE');
  assert.equal(incompleteWithOpportunity.runVerdict, 'OPPORTUNITIES_FOUND');
  assert.equal(incompleteWithoutOpportunity.runVerdict, null);
  assert.match(recommendationRunDescription(noTrade), /complete analyzed opportunity set/);
  assert.match(recommendationRunDescription(incompleteWithOpportunity), /local deterministic criteria/);
  assert.match(recommendationRunDescription(incompleteWithoutOpportunity), /does not establish NO TRADE/);
});

test('refresh orchestration classifies acquisition and deterministic engine failures', async () => {
  await assert.rejects(
    refreshRecommendations({
      scanId: 'lifecycle-provider-error',
      dependencies: { loadPulse: async () => { throw new Error('provider unavailable'); } },
    }),
    error => error instanceof RecommendationAcquisitionError && classifyRecommendationRefreshError(error) === 'acquisition',
  );

  await assert.rejects(
    refreshRecommendations({
      scanId: 'lifecycle-engine-error',
      dependencies: {
        loadPulse: async () => pulseResult(),
        scan: async () => emptyScan(),
        runEngine: async () => { throw new Error('worker failed'); },
      },
    }),
    error => error instanceof RecommendationEngineError && classifyRecommendationRefreshError(error) === 'engine',
  );
});

test('refresh progress exposes only real indeterminate and determinate phases', async () => {
  const progress = [];
  await refreshRecommendations({
    scanId: 'lifecycle-progress',
    dependencies: {
      loadPulse: async options => {
        options.onProgress?.({ loaded: 4, total: 86, phase: 'processing', ticker: 'TQQQ' });
        return pulseResult();
      },
      scan: async options => {
        options.onProgress?.(1, 1);
        return emptyScan();
      },
      runEngine: async () => buildRecommendationVisualFixture('actionable'),
    },
    onProgress: next => progress.push(next),
  });

  assert.deepEqual(progress[0], { stage: 'UNDERLYINGS', completed: 0, total: 0, ticker: 'TQQQ', indeterminate: true });
  assert.deepEqual(progress[1], { stage: 'CONTRACTS', completed: 1, total: 1 });
  assert.deepEqual(progress[2], { stage: 'DECISION', completed: 0, total: 1 });
  assert.deepEqual(progress[3], { stage: 'DECISION', completed: 1, total: 1 });
  assert.ok(progress.every(item => item.indeterminate === true ? item.total === 0 : item.completed <= item.total));
});

test('recommendation refresh reuses current technical context and makes one aggregate refresh when stale', async () => {
  let now = AS_OF_MS;
  let cached = pulseResult({ fetchedAt: AS_OF_MS - 60 * 60 * 1000 });
  let loaderCalls = 0;
  let aggregateRefreshes = 0;
  const snapshots = [];
  const loadPulse = async options => {
    loaderCalls += 1;
    assert.equal(options.maxAgeMs, ETF_PULSE_CURRENTNESS_MAX_AGE_MS);
    assert.equal(options.refreshIntent, 'recommendations');
    if (now - cached.fetchedAt > options.maxAgeMs) {
      aggregateRefreshes += 1;
      cached = pulseResult({ fetchedAt: now });
    }
    return cached;
  };
  const dependencies = {
    loadPulse,
    scan: async () => emptyScan(),
    runEngine: async snapshot => {
      snapshots.push(snapshot);
      return buildRecommendationVisualFixture('actionable');
    },
    now: () => now,
  };

  await refreshRecommendations({ scanId: 'lifecycle-current-context', dependencies });
  assert.equal(loaderCalls, 1);
  assert.equal(aggregateRefreshes, 0);
  assert.equal(snapshots[0].coverage.provenance.pulseFetchedAt, AS_OF_MS - 60 * 60 * 1000);

  now = AS_OF_MS + 7 * 60 * 60 * 1000;
  await refreshRecommendations({ scanId: 'lifecycle-stale-context', dependencies });
  assert.equal(loaderCalls, 2);
  assert.equal(aggregateRefreshes, 1);
  assert.equal(snapshots[1].coverage.provenance.pulseFetchedAt, now);
});

test('retained technical context remains retained-stale and is never restamped current', async () => {
  const retainedAt = AS_OF_MS - 2 * 24 * 60 * 60 * 1000;
  let seenSnapshot;
  const retained = pulseResult({
    fetchedAt: AS_OF_MS,
    stale: true,
    currentRows: 0,
    retainedRows: 1,
    rowEvidence: { TQQQ: { freshness: 'retained-stale', observedAt: retainedAt, source: 'snapshot', retentionReason: 'aggregate refresh failed' } },
  });
  const result = await refreshRecommendations({
    scanId: 'lifecycle-retained',
    dependencies: {
      loadPulse: async () => retained,
      scan: async () => emptyScan(),
      runEngine: async snapshot => {
        seenSnapshot = snapshot;
        return buildRecommendationVisualFixture('no-trade');
      },
    },
  });
  assert.equal(result.snapshot.coverage.provenance.pulseFreshness, 'retained-stale');
  assert.equal(result.snapshot.coverage.provenance.pulseFetchedAt, AS_OF_MS);
  assert.equal(seenSnapshot.underlyings.find(row => row.ticker === 'TQQQ').evidenceFreshness, 'retained-stale');
  assert.equal(seenSnapshot.underlyings.find(row => row.ticker === 'TQQQ').observedAt, retainedAt);
});

test('latest-generation gate cancels obsolete work and cannot let stale work publish', () => {
  const gate = createLatestScreenerScanGate();
  const first = gate.begin();
  const second = gate.begin();
  assert.equal(first.signal.aborted, true);
  assert.equal(first.isCurrent(), false);
  assert.equal(second.isCurrent(), true);
  gate.cancel();
  assert.equal(second.signal.aborted, true);
  assert.equal(second.isCurrent(), false);
});

test('mobile Recommendations keeps compact rationale previews and an accessible full-copy path', () => {
  const page = readFileSync('src/pages/RecommendationsPage.tsx', 'utf8');
  const styles = readFileSync('src/index.css', 'utf8');
  assert.match(page, /recommendation-card__copy-preview/);
  assert.match(page, /Read full WHY THIS/);
  assert.match(page, /Read full MAIN TRADE-OFF/);
  assert.match(styles, /\.recommendation-card__copy-preview[\s\S]*-webkit-line-clamp: 2/);
  assert.doesNotMatch(styles, /\.recommendation-card__copy\s*\{\s*display:\s*none/);
});

test('6-hour technical-context policy remains explicit in the real Pulse loader', async () => {
  const originalFetch = globalThis.fetch;
  const originalStorage = globalThis.localStorage;
  const values = new Map();
  const fetchedAt = Date.now() - 60 * 60 * 1000;
  const rows = getEtfPulseUniverse().map(item => pulseRow(item.ticker));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  } });
  values.set(ETF_PULSE_ROW_CACHE_KEY, JSON.stringify({ rows, fetchedAt, total: rows.length, loaded: rows.length, failed: 0, errors: [] }));
  globalThis.fetch = async () => { throw new Error('network should not be reached for cached-current context'); };
  try {
    assert.equal(ETF_PULSE_CURRENTNESS_MAX_AGE_MS, 6 * 60 * 60 * 1000);
    const result = await buildEtfPulseRows({ maxAgeMs: ETF_PULSE_CURRENTNESS_MAX_AGE_MS, refreshIntent: 'recommendations' });
    assert.equal(result.rows.length, rows.length);
    assert.equal(result.rowEvidence.TQQQ.freshness, 'cached-current');
    assert.equal(result.fetchedAt, fetchedAt);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalStorage === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalStorage });
  }
});

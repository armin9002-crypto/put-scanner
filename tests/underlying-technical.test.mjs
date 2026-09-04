import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildEtfPulseRow } from '../src/lib/etfPulseMetrics.ts';
import { readEtfPulseRowsCache } from '../src/lib/etfPulseData.ts';
import { analyzeRegime } from '../src/lib/marketRead/regime.ts';
import { assessUnderlying } from '../src/lib/recommendations/underlying.ts';

const ETF = { ticker: 'TEST', name: 'Test ETF', type: 'Sector', leverage: '3x', underlying: 'Test Index' };

function points(prices) {
  return prices.map((price, index) => ({
    timestamp: 1_700_000_000 + index * 86_400,
    date: new Date((1_700_000_000 + index * 86_400) * 1_000).toISOString(),
    price,
  }));
}

function healthyBase(count) {
  return Array.from({ length: count }, (_, index) => 100 * Math.exp(0.001 * index) * (1 + 0.006 * Math.sin(index * 1.7)));
}

function stateHistories() {
  const pullbackBase = healthyBase(305);
  const pullbackAnchor = pullbackBase.at(-1);
  const oversoldBase = healthyBase(305);
  const oversoldAnchor = oversoldBase.at(-1);
  const recoveryBase = healthyBase(293);
  const recoveryAnchor = recoveryBase.at(-1);
  const extendedBase = healthyBase(310);
  const extendedAnchor = extendedBase.at(-1);
  const transitionBase = healthyBase(280);
  const transitionAnchor = transitionBase.at(-1);
  const brokenBase = healthyBase(260);
  const brokenAnchor = brokenBase.at(-1);
  return {
    STRONG_TREND: healthyBase(320),
    CONSTRUCTIVE_PULLBACK: [
      ...pullbackBase,
      ...[-0.008, -0.016, -0.024, -0.032, -0.04, -0.035, -0.04, -0.033, -0.038, -0.032, -0.036, -0.03, -0.034, -0.028, -0.032]
        .map(change => pullbackAnchor * (1 + change)),
    ],
    OVERSOLD_INTACT: [
      ...oversoldBase,
      ...Array.from({ length: 10 }, (_, index) => oversoldAnchor * (1 - 0.005 * (index + 1))),
    ],
    RECOVERY_RECLAIM: [
      ...recoveryBase,
      ...Array.from({ length: 20 }, (_, index) => recoveryAnchor * (1 - 0.005 * (index + 1))),
      ...Array.from({ length: 7 }, (_, index) => recoveryAnchor * 0.9 * (1 + 0.012 * (index + 1))),
    ],
    EXTENDED: [
      ...extendedBase,
      ...Array.from({ length: 10 }, (_, index) => extendedAnchor * (1 + 0.018 * (index + 1))),
    ],
    TRANSITION_DETERIORATING: [
      ...transitionBase,
      ...Array.from({ length: 40 }, (_, index) => transitionAnchor * (1 - 0.003 * (index + 1))),
    ],
    BROKEN_TREND: [
      ...brokenBase,
      ...Array.from({ length: 60 }, (_, index) => brokenAnchor * (1 - 0.007 * (index + 1))),
    ],
    RANGE_NEUTRAL: Array(320).fill(100),
    INSUFFICIENT_DATA: Array(100).fill(100),
  };
}

function regime() {
  return {
    label: 'Healthy Risk-On', confidence: 'High', explanation: 'Fixture', marketRead: 'Fixture',
    putSellingImplication: 'Fixture', favor: [], avoid: [], drivers: [], warnings: [],
    stats: {
      spyTrend: 'Uptrend', qqqTrend: 'Uptrend', breadthAbove50: 0.8, breadthAbove200: 0.8,
      downtrendCount: 0, oversoldCount: 0, overboughtCount: 0, medianThirtyDayReturn: 0.05,
      medianRealizedVolatility20: 0.4, spyRsi: 55, qqqRsi: 55, spyPosition52Week: 0.8,
      qqqPosition52Week: 0.8, vixTrend: null, vxnTrend: null,
      biggestThirtyDayWinners: [], biggestThirtyDayLosers: [],
    },
    fetchedAt: 1_800_000_000_000,
  };
}

class MemoryStorage {
  values = new Map();
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

test('shared close-history assessment recognizes all nine deterministic technical states', () => {
  for (const [expectedState, prices] of Object.entries(stateHistories())) {
    const row = buildEtfPulseRow(ETF, points(prices));
    assert.equal(row.technicalAssessment.state, expectedState, expectedState);
    assert.equal(row.technicalAssessment.version, 1);
    assert.doesNotMatch(JSON.stringify(row.technicalAssessment), /NaN|Infinity/);
  }
});

test('technical metrics expose orthogonal structure, momentum, recovery, and volatility evidence', () => {
  const row = buildEtfPulseRow(ETF, points(stateHistories().RECOVERY_RECLAIM));
  const metrics = row.technicalAssessment.metrics;
  assert.equal(row.technicalAssessment.evidenceQuality, 'HIGH');
  assert.ok(Number.isFinite(metrics.sma20Slope5));
  assert.ok(Number.isFinite(metrics.sma50Slope10));
  assert.ok(Number.isFinite(metrics.sma200Slope20));
  assert.ok(Number.isFinite(metrics.persistenceAbove50));
  assert.ok(Number.isFinite(metrics.persistenceAbove200));
  assert.ok(Number.isFinite(metrics.rsi14Change5));
  assert.ok(Number.isFinite(metrics.recoveryFromLow20));
  assert.ok(Number.isFinite(metrics.realizedVolatility60));
  assert.ok(Number.isFinite(metrics.realizedVolatilityAcceleration));
});

test('date T assessment uses only observations at or before T', () => {
  const history = points(stateHistories().BROKEN_TREND);
  const boundary = history[279];
  const fromPrefix = buildEtfPulseRow(ETF, history.slice(0, 280));
  const fromFullHistoryAtBoundary = buildEtfPulseRow(ETF, history, 999, boundary.timestamp);
  assert.deepEqual(fromFullHistoryAtBoundary.technicalAssessment, fromPrefix.technicalAssessment);
  assert.equal(fromFullHistoryAtBoundary.price, boundary.price, 'a later quote cannot leak into an as-of assessment');
});

test('missing close history stays missing and never manufactures a technical state', () => {
  const row = buildEtfPulseRow(ETF, points(Array(40).fill(100)));
  assert.equal(row.sma50, null);
  assert.equal(row.sma200, null);
  assert.equal(row.sma200Slope20, null);
  assert.equal(row.technicalAssessment.metrics.distance200, null);
  assert.equal(row.technicalAssessment.evidenceQuality, 'LOW');
  assert.equal(row.technicalAssessment.state, 'INSUFFICIENT_DATA');
});

test('identical ETF Pulse input produces a byte-equivalent shared assessment', () => {
  const history = points(stateHistories().CONSTRUCTIVE_PULLBACK);
  const first = buildEtfPulseRow(ETF, history).technicalAssessment;
  const second = buildEtfPulseRow(ETF, history).technicalAssessment;
  assert.deepEqual(second, first);
  assert.equal(JSON.stringify(second), JSON.stringify(first));
});

test('ETF Pulse and Recommendations consume the exact same per-underlying assessment', () => {
  const row = buildEtfPulseRow(ETF, points(stateHistories().STRONG_TREND));
  const recommendation = assessUnderlying(row, regime());
  assert.strictEqual(recommendation.technicalAssessment, row.technicalAssessment);
  assert.equal(recommendation.technicalAssessment.state, 'STRONG_TREND');
  const oversold = buildEtfPulseRow(ETF, points(stateHistories().OVERSOLD_INTACT));
  const oversoldRecommendation = assessUnderlying(oversold, regime());
  assert.equal(oversoldRecommendation.technicalAssessment.state, 'OVERSOLD_INTACT');
  assert.equal(oversoldRecommendation.qualification, 'WATCH', 'oversold intact is context, not an automatic bullish qualification');
});

test('broad Market Regime remains separate from ticker technical state', () => {
  const spy = buildEtfPulseRow({ ...ETF, ticker: 'SPY' }, points(stateHistories().STRONG_TREND));
  const qqq = buildEtfPulseRow({ ...ETF, ticker: 'QQQ' }, points(stateHistories().RANGE_NEUTRAL));
  const market = analyzeRegime([spy, qqq], 1_800_000_000_000);
  assert.equal('state' in market, false);
  assert.equal(market.stats.spyTrend, spy.trend);
  assert.equal(market.stats.qqqTrend, qqq.trend);
  assert.equal(spy.technicalAssessment.state, 'STRONG_TREND');
  assert.equal(qqq.technicalAssessment.state, 'RANGE_NEUTRAL');
});

test('legacy v2 row cache upgrades locally to v3 without a market request', () => {
  const previousStorage = globalThis.localStorage;
  const previousFetch = globalThis.fetch;
  const storage = new MemoryStorage();
  const current = buildEtfPulseRow(ETF, points(stateHistories().STRONG_TREND));
  const {
    technicalAssessment: _technicalAssessment,
    rsi14Change5: _rsi14Change5,
    realizedVolatility60: _realizedVolatility60,
    realizedVolatilityAcceleration: _realizedVolatilityAcceleration,
    sma20Slope5: _sma20Slope5,
    sma50Slope10: _sma50Slope10,
    sma200Slope20: _sma200Slope20,
    persistenceAbove50: _persistenceAbove50,
    persistenceAbove200: _persistenceAbove200,
    recoveryFromLow20: _recoveryFromLow20,
    ...legacyRow
  } = current;
  storage.setItem('etf_pulse_rows:v2', JSON.stringify({
    rows: [legacyRow], fetchedAt: Date.now(), total: 1, loaded: 1, failed: 0, errors: [],
  }));
  let requests = 0;
  globalThis.localStorage = storage;
  globalThis.fetch = async () => { requests += 1; throw new Error('unexpected request'); };
  try {
    const upgraded = readEtfPulseRowsCache();
    assert.equal(requests, 0);
    assert.equal(upgraded.rows[0].technicalAssessment.version, 1);
    assert.ok(storage.getItem('etf_pulse_rows:v3'));
  } finally {
    globalThis.localStorage = previousStorage;
    globalThis.fetch = previousFetch;
  }
});

test('shared technical calculation layer contains no request path', () => {
  const sources = [
    readFileSync(new URL('../src/lib/underlyingTechnical.ts', import.meta.url), 'utf8'),
    readFileSync(new URL('../src/lib/etfPulseMetrics.ts', import.meta.url), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(sources, /\bfetch\s*\(|requestMarketData|fetchObservedMarketData|\/api\//);
});

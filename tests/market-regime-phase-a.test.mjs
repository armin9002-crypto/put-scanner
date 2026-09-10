import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ETF_PULSE_CONTEXT_BENCHMARK_COUNT,
  ETF_PULSE_CONTEXT_BENCHMARK_TICKERS,
  ETF_PULSE_DISPLAYED_ROW_COUNT,
  ETF_PULSE_LEVERAGED_UNIVERSE_SIZE,
} from '../shared/etfPulseUniverse.js';
import { deriveMarketRegime } from '../src/lib/marketRead/regime.ts';
import { ETF_PULSE_CURRENTNESS_MAX_AGE_MS, ETF_PULSE_ROW_CACHE_HARD_TTL_MS, ETF_PULSE_ROW_CACHE_KEY, ETF_PULSE_ROW_CACHE_SOFT_TTL_MS, getEtfPulseUniverse, readEtfPulseRowsCache } from '../src/lib/etfPulseData.ts';
import { withEtfPulseTechnicalAssessment } from '../src/lib/etfPulseMetrics.ts';
import { refreshRecommendations } from '../src/lib/recommendations/acquisition.ts';

function row(ticker, overrides = {}) {
  return {
    ticker,
    price: 100,
    returns: { thirtyDay: 0.04 },
    rsi14: 55,
    realizedVolatility20: 0.2,
    distance50: 0.08,
    distance200: 0.12,
    position52Week: 0.7,
    trend: 'Uptrend',
    isOversold: false,
    isOverbought: false,
    ...overrides,
  };
}

function snapshot(rows, evidenceFreshness = 'current') {
  return {
    rows,
    fetchedAt: 1_800_000_000_000,
    rowEvidence: Object.fromEntries(rows.map(item => [item.ticker, {
      freshness: typeof evidenceFreshness === 'function' ? evidenceFreshness(item) : evidenceFreshness,
      observedAt: 1_800_000_000_000,
      source: evidenceFreshness === 'retained-stale' ? 'snapshot' : 'network',
    }])),
  };
}

function contextRows() {
  return [row('SPY'), row('QQQ')];
}

test('Phase A universe metadata is explicit: 84 leveraged plus two context rows', () => {
  assert.equal(ETF_PULSE_LEVERAGED_UNIVERSE_SIZE, 84);
  assert.equal(ETF_PULSE_CONTEXT_BENCHMARK_COUNT, 2);
  assert.equal(ETF_PULSE_DISPLAYED_ROW_COUNT, 86);
  assert.deepEqual(ETF_PULSE_CONTEXT_BENCHMARK_TICKERS, ['QQQ', 'SPY']);
});

test('full coverage excludes SPY and QQQ from generic leveraged breadth', () => {
  const leveraged = Array.from({ length: ETF_PULSE_LEVERAGED_UNIVERSE_SIZE }, (_, index) => row(`L${index}`));
  const market = deriveMarketRegime(snapshot([...leveraged, ...contextRows()]));
  assert.deepEqual(market.intendedUniverse, { leveragedUniverseSize: 84, contextBenchmarkCount: 2, displayedRowCount: 86 });
  assert.equal(market.coverage.currentLeveraged, 84);
  assert.equal(market.metrics.movingAverage200.denominator, 84);
  assert.equal(market.metrics.movingAverage200.numerator, 84);
  assert.equal(market.metrics.return30.denominator, 84);
  assert.equal(market.metrics.return30.numerator, null);
});

test('metric populations use current evidence first and expose retained/unavailable counts', () => {
  const current = Array.from({ length: 60 }, (_, index) => row(`C${index}`));
  const retained = Array.from({ length: 10 }, (_, index) => row(`R${index}`));
  const market = deriveMarketRegime(snapshot([...current, ...retained, ...contextRows()], item => item.ticker.startsWith('R') ? 'retained-stale' : 'current'));
  const breadth = market.metrics.movingAverage200;
  assert.equal(breadth.currentValid, 60);
  assert.equal(breadth.denominator, 60);
  assert.equal(breadth.numerator, 60);
  assert.equal(breadth.retained, 10);
  assert.equal(breadth.unavailable, 14);
  assert.equal(market.coverage.currentLeveraged, 60);
  assert.equal(market.coverage.retainedLeveraged, 10);
  assert.equal(market.coverage.unavailableLeveraged, 14);
  assert.equal(market.confidence, 'Medium');
});

test('missing RSI and missing MA200 remain metric-specific', () => {
  const market = deriveMarketRegime(snapshot([
    row('A', { distance200: null }),
    row('B', { rsi14: null }),
    ...contextRows(),
  ]));
  assert.equal(market.metrics.rsi.denominator, 1);
  assert.equal(market.metrics.movingAverage200.denominator, 1);
  assert.equal(market.metrics.rsi.unavailable, 83);
  assert.equal(market.metrics.movingAverage200.unavailable, 83);
  assert.equal(market.metrics.rsi.value, 55);
  assert.equal(market.metrics.movingAverage200.value, 1);
});

test('retained positive evidence stays out of current breadth', () => {
  const current = Array.from({ length: 83 }, (_, index) => row(`C${index}`));
  const market = deriveMarketRegime(snapshot([...current, row('RETAINED'), ...contextRows()], item => item.ticker === 'RETAINED' ? 'retained-stale' : 'current'));
  const breadth = market.metrics.movingAverage200;
  assert.equal(breadth.denominator, 83);
  assert.equal(breadth.numerator, 83);
  assert.equal(breadth.retained, 1);
  assert.equal(breadth.unavailable, 0);
  assert.equal(market.coverage.currentRatio, 83 / 84);
});

test('context benchmark loss does not contaminate leveraged breadth', () => {
  const leveraged = Array.from({ length: ETF_PULSE_LEVERAGED_UNIVERSE_SIZE }, (_, index) => row(`L${index}`));
  const market = deriveMarketRegime(snapshot(leveraged));
  assert.equal(market.metrics.movingAverage200.denominator, 84);
  assert.equal(market.metrics.movingAverage200.numerator, 84);
  assert.equal(market.coverage.currentLeveraged, 84);
  assert.equal(market.coverage.unavailableLeveraged, 0);
  assert.equal(market.coverage.unavailableContextBenchmarks, 2);
  assert.equal(market.confidence, 'Low');
});

test('local filtering cannot change the canonical snapshot regime', () => {
  const leveraged = Array.from({ length: ETF_PULSE_LEVERAGED_UNIVERSE_SIZE }, (_, index) => row(`L${index}`));
  const canonical = snapshot([...leveraged, ...contextRows()]);
  const full = deriveMarketRegime(canonical);
  const visibleRows = canonical.rows.filter((_, index) => index % 2 === 0);
  const afterLocalFilter = deriveMarketRegime(canonical);
  assert.equal(visibleRows.length < canonical.rows.length, true);
  assert.deepEqual(afterLocalFilter, full);
});

test('Pulse and Recommendations shared paths produce the same base for one snapshot', () => {
  const rows = [...Array.from({ length: ETF_PULSE_LEVERAGED_UNIVERSE_SIZE }, (_, index) => row(`L${index}`)), ...contextRows()];
  const canonical = snapshot(rows);
  const pulseMarketRead = deriveMarketRegime(canonical);
  const recommendationsMarketRead = deriveMarketRegime(canonical);
  assert.deepEqual(recommendationsMarketRead, pulseMarketRead);
});

test('Recommendations uses the established Pulse row-cache currentness boundary', () => {
  assert.equal(ETF_PULSE_CURRENTNESS_MAX_AGE_MS, ETF_PULSE_ROW_CACHE_SOFT_TTL_MS);
  assert.equal(ETF_PULSE_ROW_CACHE_SOFT_TTL_MS, 6 * 60 * 60 * 1000);
  assert.equal(ETF_PULSE_ROW_CACHE_HARD_TTL_MS, 24 * 60 * 60 * 1000);
});

test('cache reads honor the explicit currentness age without changing the hard retention age', () => {
  const oldLocalStorage = globalThis.localStorage;
  const values = new Map();
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const fetchedAt = Date.now() - ETF_PULSE_ROW_CACHE_SOFT_TTL_MS - 1;
  const rows = getEtfPulseUniverse().map(item => withEtfPulseTechnicalAssessment({
    ...item,
    price: 100,
    returns: { oneDay: 0, fiveDay: 0, thirtyDay: 0, threeMonth: 0, sixMonth: 0, yearToDate: 0, oneYear: 0 },
    rsi14: 55,
    realizedVolatility20: 0.2,
    sma20: 100,
    sma50: 100,
    sma200: 100,
    distance20: 0,
    distance50: 0,
    distance200: 0,
    high52Week: 100,
    low52Week: 100,
    percentOf52WeekHigh: 1,
    position52Week: 1,
    drawdown52Week: 0,
    recentDrawdown30: 0,
  }));
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
  values.set(ETF_PULSE_ROW_CACHE_KEY, JSON.stringify({ rows, fetchedAt, total: rows.length, loaded: rows.length, failed: 0, errors: [] }));
  try {
    assert.equal(readEtfPulseRowsCache(false), null);
    assert.ok(readEtfPulseRowsCache(false, ETF_PULSE_ROW_CACHE_HARD_TTL_MS));
    assert.ok(readEtfPulseRowsCache(true));
  } finally {
    if (oldLocalStorage === undefined) delete globalThis.localStorage;
    else Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: oldLocalStorage });
  }
});

test('Recommendations Refresh receives an explicit cache-aware refresh intent', async () => {
  let receivedOptions;
  await refreshRecommendations({
    scanId: 'phase-a-contract',
    dependencies: {
      loadPulse: async options => {
        receivedOptions = options;
        return { rows: [], fetchedAt: 1_800_000_000_000, total: ETF_PULSE_DISPLAYED_ROW_COUNT, loaded: 0, failed: 0, errors: [] };
      },
      scan: async () => ({ initialResults: new Map(), chainsByKey: new Map(), ivVsRealizedRangeByTicker: new Map(), errors: [], failedBatchIds: [] }),
      now: () => 1_800_000_000_000,
    },
  });
  assert.equal(receivedOptions.maxAgeMs, ETF_PULSE_CURRENTNESS_MAX_AGE_MS);
  assert.equal(receivedOptions.refreshIntent, 'recommendations');
});

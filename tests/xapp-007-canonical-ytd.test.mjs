import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCanonicalYtdView,
  marketYearForAsOf,
  resolveCanonicalYtdBaseline,
} from '../shared/ytdBaseline.js';
import { deriveYtdChartHistory } from '../src/lib/chartHistory.ts';
import { calculateChartPeriodReturn, calculateSimpleReturn } from '../src/lib/chartReturns.ts';
import { calculateYtdReturn } from '../src/lib/etfPulseMetrics.ts';
import { getTrueLeverageForPeriod, getYtdTrueLeverage } from '../src/lib/trueLeverage.ts';

const AS_OF = '2026-09-07T16:00:00Z';
const point = (instant, price, date = new Date(instant).toISOString()) => ({
  timestamp: Date.parse(instant) / 1_000,
  date,
  price,
});

const etfHistory = [
  point('2025-12-30T20:00:00Z', 100),
  point('2026-01-02T20:00:00Z', 110),
  point('2026-09-04T20:00:00Z', 121),
];
const proxyHistory = [
  point('2025-12-30T21:00:00Z', 200),
  point('2026-01-02T21:00:00Z', 202),
  point('2026-09-04T21:00:00Z', 220),
];

test('XAPP-024 cross-surface fixture uses the prior-year close, never the first January close', () => {
  const baseline = resolveCanonicalYtdBaseline(etfHistory, AS_OF);
  assert.equal(baseline?.marketDate, '2025-12-30');
  assert.equal(baseline?.price, 100);
  assert.ok(Math.abs(calculateYtdReturn(etfHistory, AS_OF) - 0.21) < 1e-12);

  const chart = deriveYtdChartHistory({
    ticker: 'TST', displayTicker: 'TST', timeframe: '1Y', points: etfHistory,
    corporateActions: [], latestPrice: 121, fetchedAt: 1,
  }, AS_OF);
  assert.deepEqual(chart.points.map(item => item.price), [110, 121], 'the plotted series begins in the current year');
  assert.equal(chart.ytdBaseline?.price, 100, 'the calculation reference remains separate');
  assert.ok(Math.abs(calculateChartPeriodReturn(chart, 'YTD').percent - 21) < 1e-12);
  assert.ok(Math.abs(calculateSimpleReturn(chart.ytdBaseline?.price, chart.points.at(-1)?.price).percent - 21) < 1e-12);

  const proxyChart = deriveYtdChartHistory({
    ticker: 'BASE', displayTicker: 'BASE', timeframe: '1Y', points: proxyHistory,
    corporateActions: [], latestPrice: 220, fetchedAt: 1,
  }, AS_OF);
  const leverage = getYtdTrueLeverage(
    [...chart.ytdPreYearPoints, ...chart.points],
    [...proxyChart.ytdPreYearPoints, ...proxyChart.points],
    AS_OF,
  );
  assert.ok(Math.abs(leverage.etfReturn - 0.21) < 1e-12);
  assert.ok(Math.abs(leverage.proxyReturn - 0.10) < 1e-12);
  assert.ok(Math.abs(leverage.leverage - 2.10) < 1e-12);
});

test('YTD alignment matches New York market dates when raw daily timestamps differ', () => {
  const result = getYtdTrueLeverage(etfHistory, proxyHistory, AS_OF);
  assert.ok(Math.abs(result.leverage - 2.1) < 1e-12);
  assert.notEqual(etfHistory[0].timestamp, proxyHistory[0].timestamp);
  assert.notEqual(etfHistory.at(-1).timestamp, proxyHistory.at(-1).timestamp);
});

test('missing pre-year evidence and stale prior-year-only history fail closed', () => {
  const currentOnly = etfHistory.slice(1);
  assert.equal(calculateYtdReturn(currentOnly, AS_OF), null);
  assert.equal(calculateYtdReturn([etfHistory[1]], AS_OF), null);
  assert.ok(Math.abs(calculateYtdReturn(etfHistory.slice(0, 2), AS_OF) - 0.10) < 1e-12);
  assert.equal(calculateYtdReturn([point('2025-12-29T20:00:00Z', 90), etfHistory[0]], AS_OF), null);

  const missingProxyBaseline = getYtdTrueLeverage(etfHistory, proxyHistory.slice(1), AS_OF);
  assert.equal(missingProxyBaseline.proxyReturn, null);
  assert.equal(missingProxyBaseline.leverage, null);
});

test('baseline resolution is valid, deterministic, unsorted, duplicate-safe, and data-driven over holidays', () => {
  const history = [
    point('2023-01-03T21:00:00Z', 121),
    point('2022-12-30T19:00:00Z', 99),
    point('2022-12-29T21:00:00Z', 95),
    point('2022-12-30T21:00:00Z', 100),
    point('2022-12-28T21:00:00Z', 0),
    point('2022-12-27T21:00:00Z', NaN),
    { timestamp: Date.parse('2022-12-31T21:00:00Z') / 1_000, date: 'malformed', price: Infinity },
  ];
  const baseline = resolveCanonicalYtdBaseline(history, '2023-01-03T22:00:00Z');
  assert.equal(baseline?.marketDate, '2022-12-30', 'the final valid provider session need not be December 31');
  assert.equal(baseline?.price, 100, 'the later raw observation wins a duplicate market date');
  assert.deepEqual(resolveCanonicalYtdBaseline([...history].reverse(), '2023-01-03T22:00:00Z'), baseline);
  assert.equal(resolveCanonicalYtdBaseline(history.slice(0, 1), '2023-01-03T22:00:00Z'), null);
});

test('New York, not UTC, determines the applicable year at rollover', () => {
  const rollover = '2026-01-01T02:00:00Z';
  const history = [
    point('2024-12-31T20:00:00Z', 80),
    point('2025-01-02T20:00:00Z', 90),
    point('2025-12-30T20:00:00Z', 100),
  ];
  assert.equal(marketYearForAsOf(rollover), 2025);
  assert.equal(resolveCanonicalYtdBaseline(history, rollover)?.price, 80);
  assert.deepEqual(buildCanonicalYtdView(history, rollover).points.map(item => item.price), [90, 100]);
});

test('non-YTD True Leverage retains exact-timestamp period behavior', () => {
  const etf = [point('2026-01-02T20:00:00Z', 100), point('2026-01-05T20:00:00Z', 120)];
  const proxy = [point('2026-01-02T20:00:00Z', 100), point('2026-01-05T20:00:00Z', 110)];
  assert.ok(Math.abs(getTrueLeverageForPeriod(etf, proxy).leverage - 2) < 1e-12);
  assert.equal(getTrueLeverageForPeriod(etf, [point('2026-01-02T21:00:00Z', 100), point('2026-01-05T21:00:00Z', 110)]).leverage, null);
});

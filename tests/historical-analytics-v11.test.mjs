import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildPortfolioHistoricalStateSeries,
  buildPortfolioStateObservationDates,
} from '../src/lib/portfolioHistoricalStateAnalytics.ts';
import {
  buildHistoryAnalytics,
  buildHistoryInstrumentScope,
  buildExpirationPeriodRealizedPnl,
  buildRealizedPnlChartScale,
  calculateBlendedCapture,
  classifyHistoryInstrument,
  historyRealizedIrr,
} from '../src/lib/portfolioHistoryAnalytics.ts';
import { buildRollingHistoricalAnalyticsSeries } from '../src/lib/rollingHistoricalAnalytics.ts';
import { calculateSimpleAnnualizedValue } from '../src/lib/optionMetrics.ts';
import { calculateOriginalAnnualizedYield, calculateOriginalDte } from '../src/lib/portfolioMetrics.ts';
import { REQUEST_BUDGET_LEDGER } from '../src/lib/requestBudgets.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = new Date('2026-01-12T17:00:00.000Z');
const trade = (overrides = {}) => ({
  id: 'trade', ticker: 'TST', optionType: 'put', strike: 50, expiration: '2026-01-10', contracts: 1,
  soldPrice: 2, soldDate: '2026-01-01', status: 'open', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});
const closeTo = (actual, expected, tolerance = 1e-9) => {
  assert.equal(typeof actual, 'number');
  assert.equal(typeof expected, 'number');
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected));
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);
};

test('portfolio-state analytics reconstruct strict EOD lifecycle boundaries and safe coverage', () => {
  const rows = [
    trade({ id: 'open', strike: 50 }),
    trade({ id: 'closed', strike: 100, soldDate: '2026-01-02', expiration: '2026-01-20', status: 'closed', closeDate: '2026-01-05', closePrice: 1 }),
    trade({ id: 'assigned', strike: 25, soldDate: '2026-01-03', expiration: '2026-01-18', status: 'assigned', resolvedDate: '2026-01-06', realizedPnl: -100 }),
    trade({ id: 'expired', strike: 60, soldDate: '2026-01-04', expiration: '2026-01-07', status: 'expired', resolutionType: 'expired_worthless', resolvedDate: '2026-01-11' }),
    trade({ id: 'same-day', strike: 80, soldDate: '2026-01-04', expiration: '2026-01-20', status: 'closed', closeDate: '2026-01-04', closePrice: 1 }),
    trade({ id: 'unsafe', strike: 90, soldDate: '2026-01-02', expiration: '2026-01-20', status: 'assigned' }),
  ];
  const gross = buildPortfolioHistoricalStateSeries(rows, 'grossRiskExposure', now);
  assert.equal(gross.observationDates[0], '2026-01-01');
  assert.equal(gross.observationDates.at(-1), '2026-01-12');
  assert.equal(gross.observationDates.length, 12);
  assert.deepEqual(buildPortfolioStateObservationDates('2026-01-09', '2026-01-12'), ['2026-01-09', '2026-01-10', '2026-01-11', '2026-01-12']);
  assert.equal(gross.points.find(point => point.date === '2026-01-04').value, 23_500);
  assert.equal(gross.points.find(point => point.date === '2026-01-05').value, 13_500, 'closed trade is absent on its terminal date');
  assert.equal(gross.points.find(point => point.date === '2026-01-10').value, 0, 'open status is still bounded by expiration');
  assert.equal(gross.coverage.excludedUnsafeTerminalTrades, 1);
  assert.deepEqual(gross.coverage.excludedTradeIds, ['unsafe']);

  const dte = buildPortfolioHistoricalStateSeries(rows, 'averageRemainingDte', now);
  const jan4 = dte.points.find(point => point.date === '2026-01-04');
  const expected = (6 * 5_000 + 16 * 10_000 + 14 * 2_500 + 3 * 6_000) / 23_500;
  assert.ok(Math.abs(jan4.value - expected) < 1e-12);
  assert.equal(dte.points.find(point => point.date === '2026-01-10').value, null);
});

test('partial 3M, 6M, and 12M Premium Run Rate annualizes the actual available interval', () => {
  const row = trade({ soldDate: '2026-01-15', expiration: '2027-01-15', soldPrice: 1 });
  for (const windowMonths of [3, 6, 12]) {
    const series = buildRollingHistoricalAnalyticsSeries([row], 'premiumRunRate', windowMonths, new Date('2026-02-15T17:00:00.000Z'));
    const first = series.points[0];
    const latest = series.points.at(-1);
    assert.equal(first.date, '2026-01-15');
    assert.equal(first.fullWindow, false);
    assert.equal(first.effectiveWindowStart, '2026-01-15');
    assert.equal(first.availableDays, 0);
    assert.equal(first.value, null);
    assert.equal(first.flow.annualizationFactor, null);
    assert.equal(latest.fullWindow, false);
    assert.equal(latest.availableDays, 31);
    closeTo(latest.flow.annualizationFactor, 365 / 31);
    closeTo(latest.value, 100 * 365 / 31);
    assert.notEqual(latest.value, 100 * (12 / windowMonths), 'partial history must not use the selected-window factor');
  }
});

test('first and one-day Premium observations remain deterministic without NaN or Infinity', () => {
  const row = trade({ soldDate: '2026-01-15', expiration: '2027-01-15', soldPrice: 1 });
  const series = buildRollingHistoricalAnalyticsSeries([row], 'premiumRunRate', 6, new Date('2026-01-16T17:00:00.000Z'));
  assert.equal(calculateSimpleAnnualizedValue(100, 0), null);
  assert.equal(series.points[0].value, null);
  assert.equal(series.points[0].flow.annualizationFactor, null);
  assert.equal(series.points.at(-1).availableDays, 1);
  assert.equal(series.points.at(-1).value, 36_500);
  assert.ok(series.points.every(point => point.value == null || Number.isFinite(point.value)));
  assert.doesNotMatch(JSON.stringify(series), /NaN|Infinity/);
});

test('full 3M, 6M, and 12M Premium Run Rate preserves the selected ×4, ×2, and ×1 factors', () => {
  const row = trade({ soldDate: '2026-01-15', expiration: '2028-01-21', soldPrice: 1 });
  for (const [windowMonths, asOf, expectedFactor] of [
    [3, '2026-04-15T17:00:00.000Z', 4],
    [6, '2026-07-15T17:00:00.000Z', 2],
    [12, '2027-01-15T17:00:00.000Z', 1],
  ]) {
    const latest = buildRollingHistoricalAnalyticsSeries([row], 'premiumRunRate', windowMonths, new Date(asOf)).points.at(-1);
    assert.equal(latest.fullWindow, true);
    assert.equal(latest.requestedWindowStart, '2026-01-15');
    assert.equal(latest.flow.annualizationFactor, expectedFactor);
    assert.equal(latest.value, 100 * expectedFactor);
  }
});

test('partial-to-full Premium Run Rate boundary changes only by the documented annualization convention', () => {
  const row = trade({ soldDate: '2026-01-15', expiration: '2027-01-15', soldPrice: 1 });
  const build = () => buildRollingHistoricalAnalyticsSeries([row], 'premiumRunRate', 3, new Date('2026-04-15T17:00:00.000Z'));
  const series = build();
  const full = series.points.at(-1);
  const partial = series.points.filter(point => !point.fullWindow && point.value != null).at(-1);
  assert.equal(partial.flow.trailingValue, full.flow.trailingValue);
  closeTo(partial.value, 100 * 365 / partial.availableDays);
  assert.equal(full.value, 400);
  closeTo(full.value - partial.value, 400 - 100 * 365 / partial.availableDays);
  assert.deepEqual(build(), series, 'identical dates and trades must produce an identical boundary');
});

test('the Premium correction leaves every unrelated rolling metric on its canonical calculation', () => {
  const row = trade({
    soldDate: '2026-01-15', expiration: '2026-06-19', soldPrice: 1.5, strike: 50,
    status: 'closed', closeDate: '2026-02-10', closePrice: 0.5, realizedPnl: 100,
    entryDelta: -0.2, entryIv: 42,
  });
  const latest = metric => buildRollingHistoricalAnalyticsSeries([row], metric, 6, new Date('2026-02-15T17:00:00.000Z')).points.at(-1).value;
  closeTo(latest('entryAy'), calculateOriginalAnnualizedYield(row));
  assert.equal(latest('entryIv'), 42);
  assert.equal(latest('entryDelta'), -0.2);
  assert.equal(latest('originalDte'), calculateOriginalDte(row));
  closeTo(latest('realizedIrr'), historyRealizedIrr(row));
});

test('historical analytics retains an exact zero-request ledger', () => {
  assert.deepEqual(REQUEST_BUDGET_LEDGER['portfolio-rolling-historical-analytics'].expected, {
    browserRequests: 0,
    functionInvocations: 0,
    providerAcquisitions: 0,
  });
  assert.equal(REQUEST_BUDGET_LEDGER['portfolio-rolling-historical-analytics'].providerHttpAttemptCeiling, 0);
});

test('expiration-period P&L uses expiration only and reconciles aggregate premium capture', () => {
  const rows = [
    trade({ id: 'early-close', soldDate: '2025-12-01', expiration: '2026-03-20', status: 'closed', closeDate: '2026-01-02', strike: 50, soldPrice: 2, closePrice: 1 }),
    trade({ id: 'march-expiry', soldDate: '2026-01-01', expiration: '2026-03-27', status: 'expired', resolutionType: 'expired_worthless', strike: 100, soldPrice: 1 }),
    trade({ id: 'april-loss', soldDate: '2026-02-01', expiration: '2026-04-17', status: 'closed', closeDate: '2026-02-20', strike: 25, soldPrice: 1, closePrice: 2 }),
  ];
  const months = buildExpirationPeriodRealizedPnl(rows, 'month');
  assert.deepEqual(months.map(bucket => bucket.periodKey), ['2026-03', '2026-04']);
  assert.equal(months[0].tradeCount, 2);
  assert.equal(months[0].premium, 300);
  assert.equal(months[0].realizedPnl, 200);
  assert.equal(months[0].captured, 2 / 3);
  assert.deepEqual(buildExpirationPeriodRealizedPnl(rows, 'quarter').map(bucket => bucket.periodKey), ['2026-Q1', '2026-Q2']);
  assert.deepEqual(buildExpirationPeriodRealizedPnl(rows, 'year').map(bucket => bucket.periodKey), ['2026']);
  assert.equal(buildExpirationPeriodRealizedPnl(rows, 'year')[0].captured, 0.25);
});

test('ETF-only History scope is metadata-confirmed, reversible, and capture remains blended', () => {
  const etfWinner = trade({ id: 'etf-winner', ticker: 'SPY', status: 'closed', closeDate: '2026-01-05', closePrice: 0 });
  const unknownLoser = trade({ id: 'unknown-loser', ticker: 'AAPL', status: 'closed', closeDate: '2026-01-05', soldPrice: 2, closePrice: 4 });
  const rows = [etfWinner, unknownLoser];
  assert.equal(classifyHistoryInstrument('SPY'), 'etf');
  assert.equal(classifyHistoryInstrument('AAPL'), 'unknown');
  const etfScope = buildHistoryInstrumentScope(rows, true);
  assert.deepEqual(etfScope.trades.map(item => item.id), ['etf-winner']);
  assert.deepEqual(etfScope.excludedUnknownTickers, ['AAPL']);
  assert.deepEqual(buildHistoryInstrumentScope(rows, false).trades, rows);
  assert.equal(buildHistoryAnalytics(etfScope.trades).realizedPnl, 200);
  assert.equal(buildHistoryAnalytics(rows).realizedPnl, 0);
  assert.equal(calculateBlendedCapture(1_000, 10_000), 0.1);
  assert.equal(calculateBlendedCapture(-100, 100), -1);
  assert.equal(calculateBlendedCapture(100, 0), null);
});

test('Realized chart scale uses a proportional dynamic zero and adaptive slot geometry', async () => {
  assert.ok(buildRealizedPnlChartScale([10, 100]).zeroRatio > 0.85);
  assert.ok(buildRealizedPnlChartScale([-100, -10]).zeroRatio < 0.15);
  assert.ok(Math.abs(buildRealizedPnlChartScale([-100, 100]).zeroRatio - 0.5) < 1e-12);
  const page = await readFile(path.join(root, 'src/pages/PortfolioPage.tsx'), 'utf8');
  const chart = await readFile(path.join(root, 'src/components/RollingHistoricalAnalyticsChart.tsx'), 'utf8');
  assert.match(page, /const minimumSlotWidth = 62/);
  assert.match(page, /const contentWidth = Math\.max\(availableWidth, buckets\.length \* minimumSlotWidth \+ plotInset \* 2\)/);
  assert.match(page, /const scrolls = contentWidth > availableWidth \+ 1/);
  assert.match(page, /data-scroll-mode=\{scrolls \? 'contained' : 'fit'\}/);
  assert.match(page, /getRealizedHistoryMetricValue/);
  assert.match(page, /data-chart-metric=\{metric\}/);
  assert.match(page, /Realized history metric/);
  assert.match(page, /Blended Capture/);
  assert.match(chart, /rolling-historical-analytics__line--\$\{segment\.kind\}/);
  assert.match(chart, /kind: 'solid' \| 'partial' \| 'gap'/);
  assert.match(chart, /selectedPoint\.fullWindow/);
  assert.match(chart, /formatAvailableMonths/);
  assert.match(chart, /of \$\{point\.requestedWindowMonths\} months available/);
  assert.doesNotMatch(chart, /synthetic/i);
});

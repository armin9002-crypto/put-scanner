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
  buildExpirationPeriodRealizedPnl,
  buildRealizedPnlChartScale,
} from '../src/lib/portfolioHistoryAnalytics.ts';
import { buildRollingHistoricalAnalyticsSeries } from '../src/lib/rollingHistoricalAnalytics.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const now = new Date('2026-01-12T17:00:00.000Z');
const trade = (overrides = {}) => ({
  id: 'trade', ticker: 'TST', optionType: 'put', strike: 50, expiration: '2026-01-10', contracts: 1,
  soldPrice: 2, soldDate: '2026-01-01', status: 'open', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

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

test('rolling prefix windows use effective history, preserve requested metadata, and keep the selected annualization factor', () => {
  const asOf = new Date('2026-03-01T17:00:00.000Z');
  const series = buildRollingHistoricalAnalyticsSeries([
    trade({ id: 'first', soldDate: '2026-01-15', expiration: '2026-06-19', soldPrice: 1 }),
    trade({ id: 'second', soldDate: '2026-02-01', expiration: '2026-07-17', soldPrice: 2 }),
  ], 'premiumRunRate', 6, asOf);
  const first = series.points[0];
  const latest = series.points.at(-1);
  assert.equal(first.date, '2026-01-15');
  assert.equal(first.fullWindow, false);
  assert.equal(first.requestedWindowStart, '2025-07-15');
  assert.equal(first.effectiveWindowStart, '2026-01-15');
  assert.equal(first.availableDays, 0);
  assert.equal(first.value, 200, 'one $100 premium is annualized by the selected 6M factor of two');
  assert.equal(latest.fullWindow, false);
  assert.equal(latest.flow.annualizationFactor, 2);
  assert.equal(latest.value, 600);
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

test('P&L chart scale uses a proportional dynamic zero and UI contains bounded fit/scroll geometry', async () => {
  assert.ok(buildRealizedPnlChartScale([10, 100]).zeroRatio > 0.85);
  assert.ok(buildRealizedPnlChartScale([-100, -10]).zeroRatio < 0.15);
  assert.ok(Math.abs(buildRealizedPnlChartScale([-100, 100]).zeroRatio - 0.5) < 1e-12);
  const page = await readFile(path.join(root, 'src/pages/PortfolioPage.tsx'), 'utf8');
  const chart = await readFile(path.join(root, 'src/components/RollingHistoricalAnalyticsChart.tsx'), 'utf8');
  assert.match(page, /buckets\.length > 30/);
  assert.match(page, /data-scroll-mode=\{scrolls \? 'contained' : 'fit'\}/);
  assert.match(page, /Realized P&L period/);
  assert.match(chart, /rolling-historical-analytics__line--\$\{segment\.kind\}/);
  assert.match(chart, /kind: 'solid' \| 'partial' \| 'gap'/);
  assert.match(chart, /selectedPoint\.fullWindow/);
  assert.match(chart, /formatAvailableMonths/);
  assert.match(chart, /of \$\{point\.requestedWindowMonths\} months available/);
  assert.doesNotMatch(chart, /synthetic/i);
});

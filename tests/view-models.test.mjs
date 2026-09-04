import test from 'node:test';
import assert from 'node:assert/strict';
import { getReturnForPeriod, heatmapTileStyle, matchesTrend, sortValue, trendStyle } from '../src/lib/etfPulseViewModel.ts';
import { diagnosticForOutcome, snapshotProgressLabel, summarizeSnapshotOutcomes } from '../src/lib/scannerUpdateState.ts';
import { withEtfPulseTechnicalAssessment } from '../src/lib/etfPulseMetrics.ts';

test('scanner refresh summaries and diagnostics stay deterministic outside the page component', () => {
  const outcomes = [
    { status: 'updated', expanded: false },
    { status: 'updated', expanded: true },
    { status: 'unavailable', expanded: false, reason: 'no quote' },
    { status: 'failed', expanded: false },
  ];
  assert.deepEqual(summarizeSnapshotOutcomes(outcomes), { updated: 2, expanded: 1, unavailable: 1, failed: 1 });
  assert.equal(snapshotProgressLabel({ current: 4, total: 4, updated: 2, expanded: 1, unavailable: 1, failed: 1, complete: true }), 'Updated 2 · Expanded 1 · Unavailable 1 · Failed 1');
  assert.deepEqual(diagnosticForOutcome(outcomes[2]), { status: 'unavailable', reason: 'no quote' });
});

test('ETF Pulse view model maps periods, filters trends, and produces stable visual categories', () => {
  const row = withEtfPulseTechnicalAssessment({
    ticker: 'TST', name: 'Test', type: 'Sector', leverage: '3x', underlying: 'Test', price: 100,
    returns: { oneDay: 0.01, fiveDay: 0.02, thirtyDay: 0.03, threeMonth: 0.04, sixMonth: 0.05, yearToDate: 0.06, oneYear: 0.07 },
    rsi14: 60, realizedVolatility20: 0.4, sma20: 95, sma50: 90, sma200: 80,
    distance20: 0.05, distance50: 0.1, distance200: 0.25, high52Week: 105, low52Week: 70,
    percentOf52WeekHigh: 0.95, position52Week: 0.86, drawdown52Week: -0.05, recentDrawdown30: 0,
  });
  assert.equal(getReturnForPeriod(row, 'YTD'), 0.06);
  assert.equal(sortValue(row, 'ticker'), 'TST');
  assert.equal(matchesTrend(row, 'STRONG_TREND'), true);
  assert.equal(trendStyle(row).label, 'Strong Trend');
  assert.equal(heatmapTileStyle(-0.25).color, 'var(--red)');
});

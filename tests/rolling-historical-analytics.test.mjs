import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { calculateOriginalAnnualizedYield, calculateOriginalDte } from '../src/lib/portfolioMetrics.ts';
import { historyRealizedIrr } from '../src/lib/portfolioHistoryAnalytics.ts';
import { canonicalHistoricalRealizedDate } from '../src/lib/portfolioRealizedEconomics.ts';
import { REQUEST_BUDGET_LEDGER } from '../src/lib/requestBudgets.ts';
import { PORTFOLIO_HISTORICAL_STATE_METRIC_CONFIGS } from '../src/lib/portfolioHistoricalStateAnalytics.ts';
import {
  ROLLING_HISTORICAL_METRIC_CONFIGS,
  ROLLING_WINDOW_MONTHS,
  buildRollingHistoricalAnalyticsSeries,
  buildRollingObservationDates,
  subtractRollingCalendarMonths,
} from '../src/lib/rollingHistoricalAnalytics.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const asOf = new Date('2026-09-01T02:00:00.000Z'); // 2026-08-31 in New York.
const trade = (overrides = {}) => ({
  id: 'trade',
  ticker: 'TST',
  optionType: 'put',
  strike: 50,
  expiration: '2026-12-18',
  contracts: 1,
  soldPrice: 2,
  soldDate: '2025-01-01',
  status: 'open',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  ...overrides,
});
const terminalPoint = series => series.points.at(-1);
const close = (actual, expected, message, tolerance = 1e-12) => {
  assert.ok(actual != null, `${message}: expected a number`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
};

test('the product surface separates six rolling metrics from two portfolio-state metrics', () => {
  assert.deepEqual(ROLLING_WINDOW_MONTHS, [3, 6, 12]);
  assert.deepEqual(
    ROLLING_HISTORICAL_METRIC_CONFIGS.map(config => config.key),
    ['realizedIrr', 'entryAy', 'premiumRunRate', 'entryDelta', 'entryIv', 'originalDte'],
  );
  assert.equal(new Set(ROLLING_HISTORICAL_METRIC_CONFIGS.map(config => config.key)).size, 6);
  assert.deepEqual(PORTFOLIO_HISTORICAL_STATE_METRIC_CONFIGS.map(config => config.key), ['grossRiskExposure', 'averageRemainingDte']);
  for (const config of ROLLING_HISTORICAL_METRIC_CONFIGS) {
    assert.ok(config.label && config.formatterCategory && config.tooltipMetadata.length > 0);
    assert.match(config.title(6), /6M/);
    assert.match(config.subtitle(6), /6 calendar months/);
  }
});

test('all metrics and lookbacks share the earliest-entry domain, Friday grid, and New York terminal date', () => {
  const trades = [
    trade({ id: 'earliest', soldDate: '2025-01-01' }),
    trade({ id: 'later', soldDate: '2026-06-01' }),
    trade({ id: 'future', soldDate: '2026-09-02' }),
    trade({ id: 'invalid-date', soldDate: '2026-02-31' }),
  ];
  const baseline = buildRollingHistoricalAnalyticsSeries(trades, 'entryAy', 3, asOf);
  assert.deepEqual(baseline.domain, { startDate: '2025-01-01', endDate: '2026-08-31' });
  assert.equal(baseline.observationDates[0], '2025-01-01');
  assert.equal(baseline.observationDates.at(-1), '2026-08-31');
  assert.equal(new Date(`${baseline.observationDates.at(-2)}T00:00:00Z`).getUTCDay(), 5);
  baseline.observationDates.slice(1, -1).forEach(date => assert.equal(new Date(`${date}T00:00:00Z`).getUTCDay(), 5));

  for (const config of ROLLING_HISTORICAL_METRIC_CONFIGS) {
    for (const months of ROLLING_WINDOW_MONTHS) {
      const series = buildRollingHistoricalAnalyticsSeries(trades, config.key, months, asOf);
      assert.deepEqual(series.domain, baseline.domain);
      assert.deepEqual(series.observationDates, baseline.observationDates);
      assert.deepEqual(series.points.map(point => point.date), baseline.observationDates);
    }
  }
  assert.deepEqual(buildRollingHistoricalAnalyticsSeries([], 'entryIv', 3, asOf).points, []);
});

test('observation dates are deterministic when the domain has no Friday and do not duplicate a Friday terminal', () => {
  assert.deepEqual(buildRollingObservationDates('2026-08-29', '2026-08-31'), ['2026-08-29', '2026-08-31']);
  assert.deepEqual(buildRollingObservationDates('2026-08-28', '2026-08-28'), ['2026-08-28']);
  assert.deepEqual(buildRollingObservationDates('bad', '2026-08-28'), []);
});

test('calendar lookbacks clamp month ends, use inclusive boundaries, and calculate valid partial windows', () => {
  assert.equal(subtractRollingCalendarMonths('2026-05-31', 3), '2026-02-28');
  assert.equal(subtractRollingCalendarMonths('2024-05-31', 3), '2024-02-29');
  assert.equal(subtractRollingCalendarMonths('2026-08-31', 6), '2026-02-28');
  assert.equal(subtractRollingCalendarMonths('2026-02-31', 3), null);

  const earliest = trade({ id: 'origin', soldDate: '2026-01-01', expiration: '2026-02-01', entryIv: 30 });
  for (const months of ROLLING_WINDOW_MONTHS) {
    const series = buildRollingHistoricalAnalyticsSeries([earliest], 'entryIv', months, asOf);
    const partial = series.points.find(point => point.requestedWindowStart < '2026-01-01');
    assert.equal(partial?.fullWindow, false);
    assert.equal(partial?.value, 30);
    assert.equal(partial?.effectiveWindowStart, '2026-01-01');
    assert.equal(partial?.requestedWindowMonths, months);
    assert.ok(partial?.availableDays >= 0);
  }

  const rows = [
    trade({ id: 'origin', soldDate: '2025-01-01' }),
    trade({ id: 'boundary', soldDate: '2026-05-31', entryIv: 40 }),
    trade({ id: 'before', soldDate: '2026-05-30', entryIv: 100 }),
  ];
  const point = terminalPoint(buildRollingHistoricalAnalyticsSeries(rows, 'entryIv', 3, asOf));
  assert.equal(point.windowStartDate, '2026-05-31');
  assert.equal(point.value, 40, 'the inclusive start event is included and the prior calendar day is excluded');
});

test('Entry Delta and Entry IV are Gross-Risk weighted with signed zero and explicit coverage', () => {
  const rows = [
    trade({ id: 'origin', soldDate: '2025-01-01' }),
    trade({ id: 'small', soldDate: '2026-05-31', strike: 50, entryDelta: -0.2, entryIv: 40 }),
    trade({ id: 'large', soldDate: '2026-06-30', strike: 50, contracts: 3, entryDelta: -0.4, entryIv: 80 }),
    trade({ id: 'missing', soldDate: '2026-07-15', strike: 100, entryDelta: undefined, entryIv: undefined }),
    trade({ id: 'zero', soldDate: '2026-08-01', strike: 50, entryDelta: 0, entryIv: 0 }),
  ];
  const delta = terminalPoint(buildRollingHistoricalAnalyticsSeries(rows, 'entryDelta', 3, asOf));
  close(delta.value, (-0.2 * 5_000 + -0.4 * 15_000) / 25_000, 'signed Entry Delta');
  assert.deepEqual(delta.coverage, {
    totalEligibleTrades: 4,
    representedTrades: 3,
    totalEligibleGrossRisk: 35_000,
    representedGrossRisk: 25_000,
    representedRiskPercent: 25_000 / 35_000,
  });
  assert.equal(delta.tradesIncluded, 3);
  assert.equal(delta.grossRiskRepresented, 25_000);

  const iv = terminalPoint(buildRollingHistoricalAnalyticsSeries(rows, 'entryIv', 3, asOf));
  close(iv.value, (40 * 5_000 + 80 * 15_000) / 20_000, 'Entry IV percentage points');
  assert.deepEqual(iv.coverage, {
    totalEligibleTrades: 4,
    representedTrades: 2,
    totalEligibleGrossRisk: 35_000,
    representedGrossRisk: 20_000,
    representedRiskPercent: 20_000 / 35_000,
  });
});

test('weighted entry metrics return null rather than zero when all observations are missing', () => {
  const rows = [
    trade({ id: 'origin', soldDate: '2025-01-01' }),
    trade({ id: 'missing', soldDate: '2026-07-15', strike: 100, entryIv: undefined }),
  ];
  const point = terminalPoint(buildRollingHistoricalAnalyticsSeries(rows, 'entryIv', 3, asOf));
  assert.equal(point.value, null);
  assert.equal(point.tradesIncluded, 0);
  assert.equal(point.coverage.representedTrades, 0);
  assert.equal(point.coverage.representedRiskPercent, 0);
});

test('Entry AY and Original DTE reuse canonical values and Gross-Risk weighting', () => {
  const first = trade({
    id: 'first', soldDate: '2026-05-31', expiration: '2026-06-30', strike: 50, soldPrice: 1,
  });
  const second = trade({
    id: 'second', soldDate: '2026-06-30', expiration: '2026-08-29', strike: 100, contracts: 2, soldPrice: 4,
  });
  const zeroPremium = trade({
    id: 'zero-premium', soldDate: '2026-07-15', expiration: '2026-08-14', strike: 25, soldPrice: 0,
  });
  const rows = [trade({ id: 'origin', soldDate: '2025-01-01' }), first, second, zeroPremium];
  const risks = [5_000, 20_000, 2_500];
  const entryAy = terminalPoint(buildRollingHistoricalAnalyticsSeries(rows, 'entryAy', 3, asOf));
  const expectedAy = [first, second, zeroPremium]
    .reduce((sum, item, index) => sum + calculateOriginalAnnualizedYield(item) * risks[index], 0)
    / risks.reduce((sum, risk) => sum + risk, 0);
  close(entryAy.value, expectedAy, 'canonical Entry AY');
  assert.equal(entryAy.tradesIncluded, 3, 'zero is a represented AY value');

  const dte = terminalPoint(buildRollingHistoricalAnalyticsSeries(rows, 'originalDte', 3, asOf));
  const expectedDte = [first, second, zeroPremium]
    .reduce((sum, item, index) => sum + calculateOriginalDte(item) * risks[index], 0)
    / risks.reduce((sum, risk) => sum + risk, 0);
  close(dte.value, expectedDte, 'canonical Original DTE');
});

test('Realized IRR uses actual close, expiration, and assignment resolution dates only', () => {
  const earlyClose = trade({
    id: 'early-close', soldDate: '2026-01-01', expiration: '2027-01-15', status: 'closed',
    closeDate: '2026-06-15', closePrice: 1, strike: 50, soldPrice: 2,
  });
  const lateArchivedExpiration = trade({
    id: 'expired', soldDate: '2026-01-01', expiration: '2026-07-01', status: 'expired',
    resolutionType: 'expired_worthless', resolvedDate: '2026-08-25', closeDate: '2026-07-01',
    strike: 100, soldPrice: 4,
  });
  const assignedLoss = trade({
    id: 'assigned', soldDate: '2026-01-01', expiration: '2026-06-01', status: 'assigned',
    resolvedDate: '2026-08-01', realizedPnl: -100, strike: 25, soldPrice: 1,
  });
  const open = trade({ id: 'open', soldDate: '2026-06-15', status: 'open', strike: 200 });
  const origin = trade({ id: 'origin', soldDate: '2025-01-01', status: 'open' });

  assert.equal(canonicalHistoricalRealizedDate(earlyClose), '2026-06-15');
  assert.equal(canonicalHistoricalRealizedDate(lateArchivedExpiration), '2026-07-01');
  assert.equal(canonicalHistoricalRealizedDate(assignedLoss), '2026-08-01');
  assert.equal(canonicalHistoricalRealizedDate(open), null);
  assert.equal(canonicalHistoricalRealizedDate(trade({ status: 'closed', closeDate: '2026-02-31' })), null);

  const resolved = [earlyClose, lateArchivedExpiration, assignedLoss];
  const risks = [5_000, 10_000, 2_500];
  const expected = resolved.reduce((sum, item, index) => sum + historyRealizedIrr(item) * risks[index], 0)
    / risks.reduce((sum, risk) => sum + risk, 0);
  const point = terminalPoint(buildRollingHistoricalAnalyticsSeries([origin, ...resolved, open], 'realizedIrr', 3, asOf));
  close(point.value, expected, 'event-dated Realized IRR');
  assert.equal(point.tradesIncluded, 3);
  assert.equal(point.grossRiskRepresented, 17_500);
  assert.equal(point.coverage, undefined, 'realized metadata does not mix in entry coverage');
  assert.ok(historyRealizedIrr(assignedLoss) < 0, 'negative realized returns remain signed');
});

test('premium flow includes open and resolved originations, preserves 3/6/12 factors, and uses zero for a quiet full window', () => {
  const origin = trade({ id: 'origin', soldDate: '2024-01-01' });
  const open = trade({ id: 'open', soldDate: '2026-05-31', strike: 50, soldPrice: 1 });
  const resolved = trade({
    id: 'resolved', soldDate: '2026-06-30', strike: 100, contracts: 2, soldPrice: 2,
    status: 'closed', closeDate: '2026-07-15', closePrice: 1,
  });
  const rows = [origin, open, resolved];
  const premiumRaw = 500;
  for (const months of ROLLING_WINDOW_MONTHS) {
    const factor = 12 / months;
    const premium = terminalPoint(buildRollingHistoricalAnalyticsSeries(rows, 'premiumRunRate', months, asOf));
    assert.equal(premium.value, premiumRaw * factor);
    assert.deepEqual(premium.flow, {
      tradesOriginated: 2,
      trailingValue: premiumRaw,
      annualizationFactor: factor,
      annualizedValue: premiumRaw * factor,
    });
  }

  const quiet = terminalPoint(buildRollingHistoricalAnalyticsSeries([origin], 'premiumRunRate', 3, asOf));
  assert.equal(quiet.value, 0);
  assert.deepEqual(quiet.flow, {
    tradesOriginated: 0,
    trailingValue: 0,
    annualizationFactor: 4,
    annualizedValue: 0,
  });
});

test('all six rolling terminal calculations reconcile to manual fixture economics', () => {
  const origin = trade({ id: 'origin', soldDate: '2025-01-01' });
  const entry = trade({
    id: 'entry', soldDate: '2026-06-01', expiration: '2026-07-01', strike: 50,
    contracts: 2, soldPrice: 1.5, entryDelta: -0.25, entryIv: 55,
  });
  const realized = trade({
    id: 'realized', soldDate: '2026-06-15', expiration: '2026-07-15', strike: 100,
    soldPrice: 4, entryDelta: -0.5, entryIv: 75, status: 'expired', resolutionType: 'expired_worthless',
    resolvedDate: '2026-08-20',
  });
  const rows = [origin, entry, realized];
  const riskOne = 10_000;
  const riskTwo = 10_000;
  const totalRisk = riskOne + riskTwo;
  const expected = {
    realizedIrr: historyRealizedIrr(realized),
    entryAy: (calculateOriginalAnnualizedYield(entry) * riskOne + calculateOriginalAnnualizedYield(realized) * riskTwo) / totalRisk,
    premiumRunRate: (300 + 400) * 4,
    entryDelta: (-0.25 * riskOne + -0.5 * riskTwo) / totalRisk,
    entryIv: (55 * riskOne + 75 * riskTwo) / totalRisk,
    originalDte: 30,
  };
  for (const [metric, value] of Object.entries(expected)) {
    close(terminalPoint(buildRollingHistoricalAnalyticsSeries(rows, metric, 3, asOf)).value, value, metric);
  }
});

test('the calculation engine remains local, derived, raw-number-only, and free of storage or request paths', async () => {
  const source = await readFile(path.join(root, 'src/lib/rollingHistoricalAnalytics.ts'), 'utf8');
  assert.doesNotMatch(source, /fetch\s*\(|supabase|localStorage|sessionStorage|indexedDB|portfolioRepository|\.insert\s*\(|\.update\s*\(|\.delete\s*\(/i);
  assert.doesNotMatch(source, /toLocaleString|Intl\.NumberFormat|toFixed\s*\(/);
  assert.doesNotMatch(source, /interpolat|smooth/i);
  assert.match(source, /calculateOriginalAnnualizedYield/);
  assert.match(source, /calculateOriginalDte/);
  assert.match(source, /historyRealizedIrr/);
  assert.match(source, /calculateEquityAtRisk/);
  assert.deepEqual(REQUEST_BUDGET_LEDGER['portfolio-rolling-historical-analytics'], {
    expected: { browserRequests: 0, functionInvocations: 0, providerAcquisitions: 0 },
    ceiling: { browserRequests: 0, functionInvocations: 0, providerAcquisitions: 0 },
    providerHttpAttemptCeiling: 0,
    fixture: 'rolling metric/window, portfolio-state metric, P&L period, hover, and chart-date changes derive from in-memory Portfolio trades only',
  });
});

test('Portfolio renders the configured rolling chart below History with local controls and accessible touch inspection', async () => {
  const chart = await readFile(path.join(root, 'src/components/RollingHistoricalAnalyticsChart.tsx'), 'utf8');
  const portfolio = await readFile(path.join(root, 'src/pages/PortfolioPage.tsx'), 'utf8');
  const css = await readFile(path.join(root, 'src/index.css'), 'utf8');
  const docs = await readFile(path.join(root, 'docs/UI_ROLLING_HISTORICAL_ANALYTICS.md'), 'utf8');

  assert.match(portfolio, /RollingHistoricalAnalyticsChart/);
  assert.match(portfolio, /rollingTrades=\{trades\}/);
  assert.match(portfolio, /<RollingHistoricalAnalyticsChart trades=\{rollingTrades\} \/>/);
  assert.match(chart, /buildRollingHistoricalAnalyticsSeries\(trades, metric, windowMonths\)/);
  assert.match(chart, /useState<HistoricalMetric>\('entryAy'\)/);
  assert.match(chart, /useState<RollingWindowMonths>\(6\)/);
  assert.match(chart, /ROLLING_HISTORICAL_METRIC_CONFIGS\.map/);
  assert.match(chart, /ROLLING_WINDOW_MONTHS\.map/);
  assert.match(chart, /getNiceYAxisScale/);
  assert.match(chart, /buildMetricYAxisScale/);
  assert.match(chart, /preserveAspectRatio="none"/);
  assert.match(chart, /ResizeObserver/);
  assert.match(chart, /data-rolling-plot-width/);
  assert.match(chart, /data-rolling-current-value/);
  assert.match(chart, /data-rolling-hover-value/);
  assert.match(chart, /setSelectedIndex\(null\)/);
  assert.match(chart, /rolling-historical-analytics__current-value/);
  assert.match(chart, /rolling-historical-analytics__metadata/);
  assert.match(chart, /rolling-historical-analytics__zero/);
  assert.match(chart, /buildLabelIndexes/);
  assert.match(chart, /buildValueLabelIndexes/);
  assert.match(chart, /temporalAnchors/);
  assert.match(chart, /isFiniteValue\(point\.value\) \? \[\{ point, index \}\] : \[\]/);
  assert.match(chart, /onPointerMove/);
  assert.match(chart, /onPointerDown/);
  assert.match(chart, /Valid partial rolling windows are dotted/i);
  assert.match(chart, /data-rolling-domain-start/);
  assert.match(chart, /aria-label=\{`\$\{series\.config\.title/);
  assert.match(chart, /sr-only/);
  assert.doesNotMatch(chart, /fetch\s*\(|localStorage|sessionStorage|supabase|smooth|interpolat/i);
  assert.match(css, /\.rolling-historical-analytics__svg/);
  assert.match(css, /touch-action: pan-y/);
  assert.match(css, /\.rolling-historical-analytics__line/);
  assert.match(css, /\.rolling-historical-analytics__current-value/);
  assert.match(css, /\.rolling-historical-analytics__zero/);
  assert.match(css, /\.rolling-historical-analytics__value-label/);
  assert.match(css, /overflow-y: hidden/);
  assert.match(docs, /full strategy-history x-domain/);
  assert.match(docs, /compare, overlay, or dual-axis/);
});

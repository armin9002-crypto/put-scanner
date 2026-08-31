import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHistoryGroupAggregates,
  buildHistoryGroups,
  calculateHistoryTotalRealizedIrr,
  calculateHistoryWeightedEntryDelta,
  historyEntryNominalYield,
  historyGrossRisk,
  historyPercentCaptured,
  historyPremium,
  historyRealizedIrr,
  historyRealizedPnl,
} from '../src/lib/portfolioHistoryAnalytics.ts';

const trade = (overrides = {}) => ({
  id: 'trade',
  ticker: 'TST',
  optionType: 'put',
  strike: 50,
  expiration: '2026-12-18',
  contracts: 1,
  soldPrice: 2,
  soldDate: '2026-01-01',
  status: 'closed',
  closePrice: 1,
  closeDate: '2026-02-01',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-02-01T00:00:00Z',
  ...overrides,
});

function assertClose(actual, expected, message, tolerance = 1e-12) {
  assert.ok(actual != null, `${message}: expected a numeric value`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
}

test('History group additive totals reuse canonical row economics and expose quote-independent Gross Risk', () => {
  const first = trade({
    id: 'first',
    strike: 50,
    contracts: 2,
    soldPrice: 2,
    closePrice: 0.5,
    latestMarketData: { underlyingPrice: 1, optionAsk: 99, refreshedAt: '2026-08-30T12:00:00Z' },
  });
  const second = trade({
    id: 'second',
    strike: 100,
    contracts: 1,
    soldPrice: 4,
    status: 'expired',
    closePrice: 0,
    closeDate: '2026-12-18',
    resolutionType: 'expired_worthless',
  });
  const aggregates = buildHistoryGroupAggregates([first, second]);

  assert.equal(historyGrossRisk(first), 10_000);
  assert.equal(aggregates.tradeCount, 2);
  assert.equal(aggregates.contractCount, 3);
  assert.equal(aggregates.grossRisk, historyGrossRisk(first) + historyGrossRisk(second));
  assert.equal(aggregates.premium, historyPremium(first) + historyPremium(second));
  assert.equal(aggregates.realizedPnl, historyRealizedPnl(first) + historyRealizedPnl(second));
});

test('Wtd. Avg. Days Held uses Gross Risk, excludes missing values, and fails closed without exposure', () => {
  const tenDays = trade({ id: 'ten-days', strike: 50, closeDate: '2026-01-11' });
  const thirtyDays = trade({ id: 'thirty-days', strike: 50, contracts: 3, closeDate: '2026-01-31' });
  const missingDays = trade({ id: 'missing-days', strike: 100, soldDate: 'not-a-date', closeDate: undefined, status: 'assigned', realizedPnl: 0 });
  const aggregates = buildHistoryGroupAggregates([tenDays, thirtyDays, missingDays]);

  assert.equal(aggregates.weightedAverageDaysHeld, (10 * 5_000 + 30 * 15_000) / 20_000);
  assert.equal(buildHistoryGroupAggregates([]).weightedAverageDaysHeld, null);
  assert.equal(buildHistoryGroupAggregates([trade({ strike: 0 })]).weightedAverageDaysHeld, null);
});

test('Wtd. Avg. NY follows canonical Entry NY Gross-Risk weighting and reconciles to group economics', () => {
  const small = trade({ id: 'small-ny', strike: 50, contracts: 1, soldPrice: 2 });
  const large = trade({ id: 'large-ny', strike: 100, contracts: 2, soldPrice: 5 });
  const invalidGrossRisk = trade({ id: 'invalid-gross-risk', strike: 0, soldPrice: 2 });
  const zeroNy = trade({ id: 'zero-ny', strike: 25, soldPrice: 0, closePrice: 0 });
  const valid = [small, large, zeroNy];
  const aggregates = buildHistoryGroupAggregates([...valid, invalidGrossRisk]);
  const premium = valid.reduce((sum, item) => sum + historyPremium(item), 0);
  const grossRisk = valid.reduce((sum, item) => sum + historyGrossRisk(item), 0);

  assertClose(aggregates.weightedAverageNy, premium / grossRisk, 'Entry NY reconciliation');
});

test('VIX and Entry Delta use Gross-Risk weighting, preserve zero, exclude missing values, and report coverage', () => {
  const items = [
    trade({ id: 'small-known', strike: 50, entryVixClose: 20, entryDelta: -0.2 }),
    trade({ id: 'large-known', strike: 50, contracts: 3, entryVixClose: 30, entryDelta: -0.4 }),
    trade({ id: 'missing', strike: 100, entryVixClose: undefined, entryDelta: undefined }),
    trade({ id: 'zero-known', strike: 50, entryVixClose: 0, entryDelta: 0 }),
  ];
  const aggregates = buildHistoryGroupAggregates(items);
  const establishedDelta = calculateHistoryWeightedEntryDelta(items);

  assert.equal(aggregates.weightedAverageEntryVix, (20 * 5_000 + 30 * 15_000 + 0 * 5_000) / 25_000);
  assert.equal(aggregates.entryVixCoverage, 25_000 / 35_000);
  assert.equal(aggregates.weightedAverageEntryDelta, (-0.2 * 5_000 + -0.4 * 15_000 + 0 * 5_000) / 25_000);
  assert.equal(aggregates.entryDeltaCoverage, 25_000 / 35_000);
  assert.deepEqual(
    [aggregates.weightedAverageEntryDelta, aggregates.entryDeltaCoverage],
    [establishedDelta.value, establishedDelta.coverage],
    'group Entry Delta reuses the established historical weighting convention',
  );
});

test('Wtd. Avg. and Total Realized IRR share the Gross-Risk-weighted position convention', () => {
  const highReturnSmallExposure = trade({
    id: 'high-return-small', strike: 10, soldPrice: 8, closePrice: 1,
    soldDate: '2025-01-01', closeDate: '2026-01-01', expiration: '2026-12-18',
  });
  const smallLossLargeExposure = trade({
    id: 'small-loss-large', strike: 100, soldPrice: 1, closePrice: 2,
    soldDate: '2025-01-01', closeDate: '2026-01-01', expiration: '2026-12-18',
  });
  const missingIrr = trade({
    id: 'missing-irr', strike: 50, status: 'assigned', soldDate: 'bad-date', resolvedDate: undefined, closeDate: undefined, realizedPnl: 0,
  });
  const known = [highReturnSmallExposure, smallLossLargeExposure];
  const positionIrrs = known.map(historyRealizedIrr);
  const expected = known.reduce((sum, item, index) => sum + positionIrrs[index] * historyGrossRisk(item), 0)
    / known.reduce((sum, item) => sum + historyGrossRisk(item), 0);
  const weightedAverage = buildHistoryGroupAggregates([...known, missingIrr]).weightedAverageRealizedIrr;
  const arithmeticMean = (positionIrrs[0] + positionIrrs[1]) / 2;
  const totalRealizedIrr = calculateHistoryTotalRealizedIrr(known);

  assertClose(weightedAverage, expected, 'exposure-weighted individual IRRs');
  assert.ok(Math.abs(weightedAverage - arithmeticMean) > 0.1, 'different notionals make the result differ from an arithmetic mean');
  assertClose(totalRealizedIrr, weightedAverage, 'headline and grouped Realized IRR semantics');
});

test('Wtd. Avg. % Captured uses Premium weighting and reconciles winners, losses, and values above 100%', () => {
  const winner = trade({ id: 'winner', strike: 50, soldPrice: 2, closePrice: 1 });
  const loser = trade({ id: 'loser', strike: 60, soldPrice: 4, closePrice: 6 });
  const aboveOne = trade({ id: 'above-one', strike: 20, soldPrice: 1, status: 'assigned', closePrice: undefined, closeDate: undefined, resolvedDate: '2026-02-01', realizedPnl: 150 });
  const known = [winner, loser, aboveOne];
  const missing = trade({ id: 'missing-captured', status: 'expired_price_pending', closePrice: undefined, closeDate: undefined, resolutionType: 'expired_price_pending', percentCaptured: undefined });
  const aggregates = buildHistoryGroupAggregates([...known, missing]);
  const totalKnownPnl = known.reduce((sum, item) => sum + historyRealizedPnl(item), 0);
  const totalKnownPremium = known.reduce((sum, item) => sum + historyPremium(item), 0);

  assert.deepEqual(known.map(historyPercentCaptured), [0.5, -0.5, 1.5]);
  assertClose(aggregates.weightedAveragePercentCaptured, totalKnownPnl / totalKnownPremium, 'Premium-weighted capture reconciliation');
});

test('Year, Expiry, and Underlying grouping apply identical aggregate economics to the same rows', () => {
  const rows = [
    trade({ id: 'group-one', ticker: 'AAA', expiration: '2027-06-18', strike: 50, entryVixClose: 20, entryDelta: -0.2 }),
    trade({ id: 'group-two', ticker: 'AAA', expiration: '2027-06-18', strike: 100, entryVixClose: 30, entryDelta: -0.4 }),
  ];
  const aggregateKeys = Object.keys(buildHistoryGroupAggregates(rows));
  const economics = mode => {
    const group = buildHistoryGroups(rows, mode)[0];
    return Object.fromEntries(aggregateKeys.map(key => [key, group[key]]));
  };

  assert.deepEqual(economics('year'), economics('expiration'));
  assert.deepEqual(economics('year'), economics('underlying'));
  assert.equal(buildHistoryGroups(rows, 'year')[0].label, '2027', 'Year remains the option expiration year');
});

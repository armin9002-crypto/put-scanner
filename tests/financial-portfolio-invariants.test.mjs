import assert from 'node:assert/strict';
import test from 'node:test';
import * as m from '../src/lib/portfolioMetrics.ts';
import * as h from '../src/lib/portfolioHistoryAnalytics.ts';
import { getPortfolioTotals } from '../src/lib/portfolioAnalytics.ts';
import { buildOpenContractPositions, buildHistoricalContractPositions } from '../src/lib/portfolioContractPositions.ts';
import { resolveExpiredTradeWithClose } from '../src/lib/portfolioExpirationArchive.ts';
import { canonicalHistoricalRealizedPnl } from '../src/lib/portfolioRealizedEconomics.ts';

const NOW = new Date('2026-09-01T16:00:00Z');
const quote = (overrides = {}) => ({ underlyingPrice: 53.25, optionBid: 0.321234567, optionAsk: 0.456789123, optionLast: 0.4, delta: -0.287654321, iv: 61.234567, refreshedAt: NOW.toISOString(), availabilityStatus: 'live', ...overrides });
const trade = (overrides = {}) => ({ id: 'lot', ticker: 'TST', optionType: 'put', strike: 50.125, expiration: '2026-09-18', contracts: 3, soldPrice: 1.234567, soldDate: '2026-08-20', status: 'open', createdAt: '2026-08-20T15:00:00Z', updatedAt: '2026-08-20T15:00:00Z', latestMarketData: quote(), ...overrides });
const near = (a, b) => { assert.ok(Number.isFinite(a) && Number.isFinite(b)); assert.ok(Math.abs(a - b) < 1e-9, `${a} != ${b}`); };

test('all open bases reconcile premium, liability, capture, entry/current yields at full precision', t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const row = trade(), premium = row.soldPrice * 300, gross = row.strike * 300;
  near(m.calculatePremiumCollected(row), premium);
  near(m.calculateEquityAtRisk(row), gross);
  near(m.calculateNetCapitalAtRisk(row), gross - premium);
  near(m.calculateOriginalNominalYield(row), row.soldPrice / row.strike);
  near(m.calculateOriginalAnnualizedYield(row), row.soldPrice / row.strike * 365 / 29);
  for (const [basis, mark] of [['bid', quote().optionBid], ['mid', (quote().optionBid + quote().optionAsk) / 2], ['ask', quote().optionAsk], ['last', quote().optionLast]]) {
    near(m.calculateCurrentPositionValue(row, basis), -mark * 300);
    near(m.calculateTotalGainLoss(row, basis), premium - mark * 300);
    near(m.calculateUnrealizedPnl(row, basis), premium - mark * 300);
    near(m.calculatePercentCaptured(row, basis), (premium - mark * 300) / premium);
    near(m.calculateCurrentNominalYield(row, basis), mark / row.strike);
    near(m.calculateCurrentAnnualizedYield(row, basis), mark / row.strike * 365 / 17);
    near(m.calculateRemainingAnnualizedYieldToExpiry(row, basis), mark / (row.strike - mark) * 365 / 17);
    const headline = m.calculatePortfolioMarkSummary([row], basis), totals = getPortfolioTotals([row], basis);
    near(headline.totalGainLoss, totals.totalGainLoss);
    near(totals.currentNY, mark / row.strike);
    near(totals.currentAY, mark / row.strike * 365 / 17);
    near(totals.originalAY, row.soldPrice / row.strike * 365 / 29);
  }
  for (const mark of [0.1, 2, 1e-10]) {
    const current = trade({ latestMarketData: quote({ optionAsk: mark }) });
    near(m.calculatePercentCaptured(current, 'ask'), (row.soldPrice - mark) / row.soldPrice);
    near(m.calculateCurrentPositionValue(current, 'ask'), -mark * 300);
  }
  assert.ok(m.calculatePercentCaptured(trade({ latestMarketData: quote({ optionAsk: 2 }) }), 'ask') < 0);
  assert.equal(m.calculatePercentCaptured(trade({ soldPrice: 0 }), 'ask'), null);
});

test('missing and valuation-only observations preserve intentional availability differences', t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const absent = trade({ latestMarketData: undefined });
  const summary = m.calculatePortfolioMarkSummary([trade(), absent], 'ask');
  for (const field of ['totalCurrentValue', 'totalGainLoss', 'percentCaptured', 'portfolioCurrentNominalYield']) assert.equal(summary[field], null);
  near(summary.portfolioCurrentAnnualizedYield, quote().optionAsk / 50.125 * 365 / 17);
  const fallback = trade({ latestMarketData: quote({ optionBid: null, optionAsk: null, optionLast: 0.123456789, lastFallbackOnly: true, optionIntegrityStatus: 'invalid', lastTradeDate: Date.parse('2024-01-03T16:00Z') / 1000 }) });
  for (const basis of ['bid', 'ask', 'mid', 'last']) {
    near(m.calculateCurrentPositionValue(fallback, basis), -0.123456789 * 300);
    near(m.calculateCurrentNominalYield(fallback, basis), 0.123456789 / 50.125);
  }
  assert.equal(m.calculateWeightedAverageDelta([fallback], NOW), null);
});

test('I/J/K expiration and buyback economics reconcile with History despite redundant snapshots', () => {
  const base = trade(), before = structuredClone(base), premium = base.soldPrice * 300, gross = base.strike * 300;
  for (const underlying of [55.123456789, 47.987654321]) {
    const resolved = resolveExpiredTradeWithClose(base, underlying, base.expiration, 'expiration_close', undefined, '2026-09-21T12:00:00Z');
    const intrinsic = Math.max(base.strike - underlying, 0) * 300, pnl = premium - intrinsic;
    near(resolved.finalOptionValue, intrinsic);
    near(resolved.realizedPnl, pnl);
    near(canonicalHistoricalRealizedPnl(resolved), pnl);
    near(h.historyRealizedPnl({ ...resolved, realizedPnl: 999999, premiumCollected: 1 }), pnl);
    near(h.historyFinalValue(resolved), intrinsic);
    assert.equal(h.historyDaysHeld(resolved), 29, 'expiration date, not maintenance date');
    near(h.historyRealizedIrr(resolved), pnl / gross * 365 / 29);
    near(h.historyPercentCaptured(resolved), pnl / premium);
    if (intrinsic === 0) near(h.historyRealizedIrr(resolved), m.calculateOriginalAnnualizedYield(base));
    else { assert.ok(pnl < 0); assert.equal(resolved.status, 'expired'); assert.equal(resolved.resolutionType, 'expired_itm'); }
  }
  for (const closePrice of [0.123456789, 2.987654321]) {
    const closed = { ...base, status: 'closed', closePrice, closeDate: '2026-08-25', realizedPnl: 999999, daysHeld: 99 };
    const pnl = (base.soldPrice - closePrice) * 300;
    near(h.historyRealizedPnl(closed), pnl);
    near(h.historyFinalValue(closed), closePrice * 300);
    assert.equal(h.historyDaysHeld(closed), 5);
    near(h.historyRealizedIrr(closed), pnl / gross * 365 / 5);
    assert.equal(h.historyRealizedIrr({ ...closed, closeDate: base.soldDate }), null);
  }
  assert.deepEqual(base, before);
});

test('assignment participates only with known durable realized option economics', () => {
  const assigned = trade({ status: 'assigned', resolvedDate: '2026-08-30' });
  assert.equal(h.historyRealizedPnl(assigned), null);
  assert.equal(h.historyRealizedIrr(assigned), null);
  const supplied = { ...assigned, realizedPnl: -12.345678901 };
  near(h.historyRealizedPnl(supplied), supplied.realizedPnl);
  near(h.historyRealizedIrr(supplied), supplied.realizedPnl / (50.125 * 300) * 365 / 10);
});

test('L lot weights survive grouping, distinct entry dates, missing Greeks and alternate History groups', t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const rows = [
    trade({ id: 'a', contracts: 1, soldPrice: 1.111111, soldDate: '2026-08-01', entryDelta: -0.2, entryIv: 40 }),
    trade({ id: 'b', contracts: 2, soldPrice: 2.222222, soldDate: '2026-08-05', entryDelta: undefined, entryIv: undefined }),
  ];
  const before = structuredClone(rows), positions = buildOpenContractPositions(rows, 'ask');
  assert.equal(positions.length, 1);
  const premium = 1.111111 * 100 + 2.222222 * 200;
  const expectedAy = (1.111111 / 50.125 * 365 / 48 + 2 * 2.222222 / 50.125 * 365 / 44) / 3;
  near(positions[0].positionMetrics.premiumCollected, premium);
  near(m.calculateOriginalAnnualizedYield(positions[0]), expectedAy);
  near(m.calculatePortfolioMarkSummary(rows, 'ask').totalGainLoss, m.calculatePortfolioMarkSummary(positions, 'ask').totalGainLoss);
  near(m.calculatePortfolioMarkSummary(positions, 'ask').portfolioOriginalAnnualizedYield, expectedAy);
  assert.deepEqual(rows, before);
  const resolved = rows.map((row, i) => ({ ...row, status: 'closed', closePrice: i ? 3.222222 : 0.111111, closeDate: i ? '2026-08-20' : '2026-08-10' }));
  const other = trade({ id: 'other', ticker: 'OTHER', expiration: '2027-01-15', contracts: 2, strike: 80, soldPrice: 3, soldDate: '2026-08-10', status: 'closed', closePrice: 1.5, closeDate: '2026-08-30', entryDelta: 0, entryIv: 70 });
  const all = [...resolved, other], totals = h.buildHistoryGroupAggregates(all);
  near(totals.realizedPnl, 100 - 200 + 300);
  near(totals.premium, premium + 600);
  near(totals.weightedAveragePercentCaptured, 200 / (premium + 600));
  const knownRisk = 50.125 * 100 + 80 * 200, allRisk = 50.125 * 300 + 80 * 200;
  near(totals.weightedAverageEntryDelta, -0.2 * 50.125 * 100 / knownRisk);
  near(totals.entryDeltaCoverage, knownRisk / allRisk);
  near(totals.weightedAverageEntryIv, (40 * 50.125 * 100 + 70 * 80 * 200) / knownRisk);
  near(totals.entryIvCoverage, knownRisk / allRisk);
  near(totals.weightedAverageRealizedIrr, (100 * 365 / 9 - 200 * 365 / 15 + 300 * 365 / 20) / allRisk);
  near(h.calculateHistoryTotalRealizedIrr(all), totals.weightedAverageRealizedIrr);
  for (const mode of ['year', 'expiration', 'underlying', 'none']) {
    const groups = h.buildHistoryGroups(all, mode);
    for (const field of ['premium', 'grossRisk', 'realizedPnl']) near(groups.reduce((sum, group) => sum + group[field], 0), totals[field]);
  }
  const historyPositions = buildHistoricalContractPositions(resolved);
  near(h.historyRealizedIrr(historyPositions[0]), (100 * 365 / 9 - 200 * 365 / 15) / (50.125 * 300));
  near(h.historyRealizedPnl(historyPositions[0]), -100);
  // Group headers consume contract rows; headline/footer consume raw lots.
  // A missing lot metric must not acquire the weight of its whole contract.
  const projectedTotals = h.buildHistoryGroupAggregates(buildHistoricalContractPositions(all));
  for (const field of ['premium', 'grossRisk', 'realizedPnl', 'weightedAverageEntryDelta', 'weightedAverageEntryIv', 'entryDeltaCoverage', 'entryIvCoverage', 'weightedAverageRealizedIrr', 'weightedAveragePercentCaptured']) near(projectedTotals[field], totals[field]);
  assert.equal(projectedTotals.tradeCount, 2, 'display position count stays distinct from entry count');
});

test('weighted Delta and DTE use raw exposure and exclude unavailable Delta weights', t => {
  t.mock.timers.enable({ apis: ['Date'], now: NOW });
  const rows = [
    trade({ contracts: 1, strike: 50, latestMarketData: quote({ delta: -0.123456789 }) }),
    trade({ id: 'b', contracts: 2, strike: 80, expiration: '2026-10-16', latestMarketData: quote({ delta: -0.345678912 }) }),
    trade({ id: 'missing', contracts: 1, strike: 100, latestMarketData: quote({ delta: null }) }),
  ];
  near(m.calculateWeightedAverageDelta(rows, NOW), (-0.123456789 * 5000 - 0.345678912 * 16000) / 21000);
  near(m.calculateTotalDeltaExposure(rows, NOW), -0.123456789 * 100 - 0.345678912 * 200);
  near(m.calculateGrossRiskWeightedRemainingDte(rows), (17 * 15000 + 45 * 16000) / 31000);
});

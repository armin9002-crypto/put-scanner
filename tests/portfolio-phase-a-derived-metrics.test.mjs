import assert from 'node:assert/strict';
import test from 'node:test';
import {
  calculateCurrentAnnualizedYield,
  calculateDistanceToBreakeven,
  calculateDistanceToStrike,
  calculateEquityAtRisk,
  calculateGrossRiskWeightedRemainingDte,
  calculatePortfolioMarkSummary,
  calculateRemainingDte,
  calculateTotalDeltaExposure,
  calculateWeightedAverageDelta,
} from '../src/lib/portfolioMetrics.ts';
import { getPortfolioTotals } from '../src/lib/portfolioAnalytics.ts';
import { getPortfolioPositionHealthLevel } from '../src/lib/portfolioScheduleSorting.ts';
import {
  assessPortfolioAttention,
  buildNeedsAttention,
} from '../src/lib/portfolioPolicies.ts';
import {
  buildHistoryGroupAggregates,
  historyEntryNominalYield,
} from '../src/lib/portfolioHistoryAnalytics.ts';
import { isPortfolioQuoteDecisionEligible, getPortfolioQuoteFreshness } from '../src/lib/portfolioQuoteFreshness.ts';
import { resolvePortfolioMark } from '../src/lib/portfolioValuation.ts';

const now = new Date('2026-09-10T16:00:00.000Z');

function trade(overrides = {}) {
  return {
    id: 'trade',
    ticker: 'SPY',
    optionType: 'put',
    strike: 100,
    expiration: '2027-01-15',
    contracts: 1,
    soldPrice: 2,
    soldDate: '2026-01-02',
    status: 'open',
    createdAt: '2026-01-02T15:00:00Z',
    updatedAt: '2026-01-02T15:00:00Z',
    latestMarketData: {
      underlyingPrice: 110,
      optionBid: 1,
      optionAsk: 2,
      optionLast: 1.5,
      delta: -0.2,
      refreshedAt: now.toISOString(),
      availabilityStatus: 'live',
    },
    ...overrides,
    ...(overrides.latestMarketData ? { latestMarketData: { ...{
      underlyingPrice: 110,
      optionBid: 1,
      optionAsk: 2,
      optionLast: 1.5,
      delta: -0.2,
      refreshedAt: now.toISOString(),
      availabilityStatus: 'live',
    }, ...overrides.latestMarketData } } : {}),
  };
}

test('Weighted Avg DTE uses Gross Risk and excludes missing or invalid DTE without zero coercion', () => {
  const first = trade({ id: 'first', strike: 50, expiration: '2027-01-15', contracts: 1 });
  const second = trade({ id: 'second', strike: 150, expiration: '2027-02-19', contracts: 2 });
  const missing = trade({ id: 'missing', strike: 500, expiration: 'not-a-date', contracts: 4 });
  const expected = (
    calculateRemainingDte(first) * calculateEquityAtRisk(first)
    + calculateRemainingDte(second) * calculateEquityAtRisk(second)
  ) / (calculateEquityAtRisk(first) + calculateEquityAtRisk(second));

  assert.equal(calculateGrossRiskWeightedRemainingDte([first, second, missing]), expected);
  assert.equal(getPortfolioTotals([first, second, missing], 'ask').averageDte, expected);
});

test('Current AY excludes only invalid positions and keeps valid marks, including accepted stale Last valuation', () => {
  const current = trade({ id: 'current' });
  const unavailable = trade({ id: 'unavailable', entrySnapshot: { underlyingPrice: 90 }, latestMarketData: undefined });
  const summary = calculatePortfolioMarkSummary([current, unavailable], 'ask');
  assert.equal(summary.portfolioCurrentAnnualizedYield, calculateCurrentAnnualizedYield(current, 'ask'));

  const staleLast = trade({
    id: 'stale-last',
    latestMarketData: {
      underlyingPrice: 110,
      optionBid: null,
      optionAsk: null,
      optionMid: null,
      optionLast: 1,
      delta: null,
      lastFallbackOnly: true,
      availabilityStatus: 'stale',
      refreshedAt: '2024-01-03T15:00:00Z',
      lastTradeDate: '2024-01-03T15:00:00Z',
    },
  });
  assert.deepEqual(resolvePortfolioMark(staleLast, 'ask'), { value: 1, source: 'last_fallback' });
  assert.equal(getPortfolioQuoteFreshness(staleLast, now).label, 'Stale Last');
  assert.equal(calculatePortfolioMarkSummary([staleLast], 'ask').portfolioCurrentAnnualizedYield, calculateCurrentAnnualizedYield(staleLast, 'ask'));
});

test('Weighted Avg Delta and exposure use only current decision-eligible Delta evidence', () => {
  const currentSmall = trade({ id: 'current-small', strike: 50, latestMarketData: { delta: -0.2 } });
  const currentLarge = trade({ id: 'current-large', strike: 100, latestMarketData: { delta: -0.4 } });
  const staleRetained = trade({ id: 'stale-retained', strike: 200, latestMarketData: { delta: -0.9, availabilityStatus: 'stale' } });
  const unavailable = trade({ id: 'unavailable', strike: 300, latestMarketData: { delta: -0.8, availabilityStatus: 'unavailable' } });
  const entryOnly = trade({ id: 'entry-only', strike: 400, latestMarketData: { delta: null }, entryDelta: -0.99 });
  const all = [currentSmall, currentLarge, staleRetained, unavailable, entryOnly];
  const expected = (-0.2 * calculateEquityAtRisk(currentSmall) - 0.4 * calculateEquityAtRisk(currentLarge))
    / (calculateEquityAtRisk(currentSmall) + calculateEquityAtRisk(currentLarge));

  assert.equal(isPortfolioQuoteDecisionEligible(currentSmall, now), true);
  assert.equal(isPortfolioQuoteDecisionEligible(staleRetained, now), false);
  assert.equal(calculateWeightedAverageDelta(all, now), expected);
  assert.equal(calculateTotalDeltaExposure(all, now), -60);
});

test('Current distance and Health never fall back to the historical entry underlying', () => {
  const noCurrentUnderlying = trade({
    id: 'entry-only-underlying',
    entrySnapshot: { underlyingPrice: 90 },
    latestMarketData: { underlyingPrice: null, delta: -0.4 },
  });
  assert.equal(calculateDistanceToStrike(noCurrentUnderlying), null);
  assert.equal(calculateDistanceToBreakeven(noCurrentUnderlying), null);
  assert.equal(getPortfolioPositionHealthLevel(noCurrentUnderlying), 'Unknown');
});

test('Needs Attention exposes deterministic reasons and stable tie ordering without exposing scores', () => {
  const threatened = trade({ id: 'threatened', ticker: 'ZZZ', expiration: '2026-09-15', latestMarketData: { underlyingPrice: 40, delta: -0.4 } });
  const stale = trade({ id: 'stale', ticker: 'STALE', latestMarketData: { availabilityStatus: 'stale', delta: -0.8 } });
  const tiedA = trade({ id: 'a', ticker: 'AAA', latestMarketData: { underlyingPrice: 110, delta: null } });
  const tiedB = trade({ id: 'b', ticker: 'BBB', latestMarketData: { underlyingPrice: 110, delta: null } });
  const assessment = assessPortfolioAttention(threatened, now);
  assert.ok(assessment.reasonCodes.includes('BELOW_BREAKEVEN'));
  assert.ok(assessment.reasonCodes.includes('NEAR_STRIKE'));
  assert.ok(assessment.reasonCodes.includes('ELEVATED_CURRENT_DELTA'));
  assert.ok(assessment.reasonCodes.includes('NEAR_MATURITY'));
  assert.ok(assessment.reasons.length > 0);
  const staleAssessment = assessPortfolioAttention(stale, now);
  assert.deepEqual(staleAssessment.reasonCodes, ['NEEDS_FRESH_QUOTE']);
  assert.deepEqual(buildNeedsAttention([tiedB, tiedA], now).map(item => item.id), ['a', 'b']);
});

test('History group aggregates expose distinct Gross-Risk-weighted Entry AY and Entry NY', () => {
  const first = trade({ id: 'history-a', strike: 50, soldPrice: 1, status: 'closed', closeDate: '2026-02-01', closePrice: 0.5 });
  const second = trade({ id: 'history-b', strike: 100, soldPrice: 4, contracts: 2, status: 'closed', closeDate: '2026-03-01', closePrice: 1 });
  const aggregate = buildHistoryGroupAggregates([first, second]);
  const grossRisk = calculateEquityAtRisk(first) + calculateEquityAtRisk(second);
  const expectedNy = (historyEntryNominalYield(first) * calculateEquityAtRisk(first) + historyEntryNominalYield(second) * calculateEquityAtRisk(second)) / grossRisk;
  assert.equal(aggregate.weightedAverageNy, expectedNy);
  assert.ok(Number.isFinite(aggregate.weightedAverageAy));
});

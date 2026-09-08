import test from 'node:test';
import assert from 'node:assert/strict';

import { getOptionLastTradeFreshness } from '../src/lib/optionLastTradeFreshness.ts';
import {
  CALCULATED_PUT_DELTA_MODEL,
  calculatePutDelta,
  resolvePutDeltaWithSource,
} from '../src/lib/putDelta.ts';
import {
  exactOptionTradeSessionAge,
  usMarketDateIso,
} from '../src/lib/usMarketCalendar.ts';
import { canonicalOptionChainKey } from '../src/lib/optionChainRequests.ts';
import { buildScreenerRows, isRecentScreenerTrade } from '../src/lib/screenerRows.ts';
import { discoverContractPricing, recommendationTradingSessionAge } from '../src/lib/recommendations/pricing.ts';
import { buildRecommendationVisualFixture } from '../src/lib/recommendations/visualFixtures.ts';

const AS_OF = '2026-09-30T16:00:00Z';
const EXPIRATION = Math.floor(Date.parse('2026-10-30T00:00:00Z') / 1_000);

function chain(overrides = {}) {
  return {
    expirations: [{ date: EXPIRATION, label: 'Oct 30', dte: 999 }],
    currentPrice: 100,
    puts: [{
      strike: 95,
      last: 2,
      lastTradeDate: Math.floor(Date.parse('2026-09-29T15:00:00Z') / 1_000),
      bid: 1.9,
      ask: 2.1,
      delta: null,
      impliedVolatility: 40,
      volume: 10,
      openInterest: 100,
      ...overrides,
    }],
  };
}

function screenerData(data) {
  return {
    initialResults: new Map([['TST', data]]),
    chainsByKey: new Map([[canonicalOptionChainKey('TST', EXPIRATION), data]]),
    ivVsRealizedRangeByTicker: new Map([['TST', null]]),
  };
}

test('exact option transaction age counts New York trading sessions, not calendar days', () => {
  assert.equal(exactOptionTradeSessionAge('2026-09-04T19:30:00Z', '2026-09-04T20:00:00Z'), 0);
  assert.equal(exactOptionTradeSessionAge('2026-09-04T19:30:00Z', '2026-09-06T16:00:00Z'), 0, 'weekend does not add a session');
  assert.equal(exactOptionTradeSessionAge('2026-09-04T19:30:00Z', '2026-09-08T16:00:00Z'), 1, 'Labor Day is closed');
  assert.equal(exactOptionTradeSessionAge('2026-09-03T19:30:00Z', '2026-09-08T16:00:00Z'), 2, 'Friday and Tuesday are the two sessions');
});

test('transaction age uses New York rollover and accepts seconds or milliseconds', () => {
  const rollover = '2026-09-04T00:30:00Z';
  assert.equal(usMarketDateIso(rollover), '2026-09-03');
  assert.equal(exactOptionTradeSessionAge(rollover, '2026-09-04T16:00:00Z'), 1);

  const timestampMs = Date.parse('2026-09-04T19:30:00Z');
  assert.equal(exactOptionTradeSessionAge(timestampMs / 1_000, '2026-09-08T16:00:00Z'), 1);
  assert.equal(exactOptionTradeSessionAge(timestampMs, '2026-09-08T16:00:00Z'), 1);
});

test('missing, invalid, and future Last Trade evidence fails closed', () => {
  for (const value of [null, undefined, NaN, 0, 'not-a-date', '2026-02-30', new Date('invalid')]) {
    assert.equal(exactOptionTradeSessionAge(value, AS_OF), null, `invalid value ${String(value)}`);
  }
  assert.equal(exactOptionTradeSessionAge('2026-10-01T15:00:00Z', AS_OF), null);
  assert.equal(exactOptionTradeSessionAge('2026-09-05T15:00:00Z', AS_OF), null, 'a non-session Last Trade date is unavailable');
});

test('product freshness policies consume canonical session age independently', () => {
  const row = lastTradeDate => ({ lastTradeDate });
  assert.equal(isRecentScreenerTrade(row('2026-09-09T15:00:00Z'), AS_OF), true, '15 sessions remains Recent');
  assert.equal(isRecentScreenerTrade(row('2026-09-08T15:00:00Z'), AS_OF), false, '16 sessions is not Recent');
  assert.equal(isRecentScreenerTrade(row(null), AS_OF), false);
  assert.deepEqual(getOptionLastTradeFreshness('2026-09-28T15:00:00Z', AS_OF), { freshness: 'recent', ageSessions: 2, label: null, color: 'var(--green)' });
  assert.deepEqual(getOptionLastTradeFreshness('2026-09-25T15:00:00Z', AS_OF), { freshness: 'stale', ageSessions: 3, label: 'Stale', color: 'var(--yellow)' });
  assert.equal(recommendationTradingSessionAge('2026-09-04T19:30:00Z', '2026-09-08T16:00:00Z'), 1);
});

test('provider and calculated Delta retain source without numerical model drift', () => {
  const provider = resolvePutDeltaWithSource({ providerDelta: 0.22, underlyingPrice: null, strike: 95, dte: 30, impliedVolatilityPercent: 40 });
  assert.deepEqual(provider, { delta: -0.22, source: 'provider' });

  const calculated = resolvePutDeltaWithSource({ providerDelta: null, underlyingPrice: 100, strike: 95, dte: 30, impliedVolatilityPercent: 40 });
  assert.equal(calculated?.source, 'calculated');
  assert.equal(calculated?.modelVersion, CALCULATED_PUT_DELTA_MODEL.version);
  assert.ok(Math.abs(calculated.delta - calculatePutDelta(100, 95, 30 / 365, 0.045, 0.4)) < 1e-12);
  assert.equal(CALCULATED_PUT_DELTA_MODEL.annualRiskFreeRate, 0.045);
  assert.equal(CALCULATED_PUT_DELTA_MODEL.dayCount, 365);

  for (const input of [
    { underlyingPrice: null, strike: 95, dte: 30, impliedVolatilityPercent: 40 },
    { underlyingPrice: 100, strike: 95, dte: 30, impliedVolatilityPercent: null },
    { underlyingPrice: 100, strike: null, dte: 30, impliedVolatilityPercent: 40 },
  ]) {
    assert.equal(resolvePutDeltaWithSource({ providerDelta: null, ...input }), null);
  }
});

test('Screener and Recommendation pricing retain the same Delta provenance', () => {
  const providerChain = chain({ delta: -0.2 });
  const providerRow = buildScreenerRows(screenerData(providerChain), 'all', { asOf: AS_OF }).rows[0];
  assert.equal(providerRow.delta, -0.2);
  assert.equal(providerRow.deltaSource, 'provider');

  const calculatedChain = chain();
  const calculatedRow = buildScreenerRows(screenerData(calculatedChain), 'all', { asOf: AS_OF }).rows[0];
  assert.equal(calculatedRow.deltaSource, 'calculated');
  assert.ok(Number.isFinite(calculatedRow.delta));

  const pricing = discoverContractPricing({
    strike: 95,
    dte: 30,
    chain: calculatedChain,
    asOf: AS_OF,
  });
  const candidateEvidence = pricing.surface.neighbors.find(neighbor => neighbor.side === 'CANDIDATE');
  assert.equal(candidateEvidence?.delta, calculatedRow.delta);
  assert.equal(candidateEvidence?.deltaSource, 'calculated');
  assert.equal(candidateEvidence?.deltaModelVersion, CALCULATED_PUT_DELTA_MODEL.version);

  const recommendationCandidate = buildRecommendationVisualFixture('actionable').candidates.find(candidate => candidate.ticker === 'TQQQ');
  assert.equal(recommendationCandidate?.canonicalRow.deltaSource, 'provider');
  assert.equal(recommendationCandidate?.economics.deltaSource, 'provider');
  assert.equal(recommendationCandidate?.pricing.surface.neighbors.find(neighbor => neighbor.side === 'CANDIDATE')?.deltaSource, 'provider');

  const invalidChain = chain({ bid: 3, ask: 1, delta: -0.2, integrity: { status: 'invalid', reasonCodes: ['CROSSED_MARKET'] } });
  const invalidRows = buildScreenerRows(screenerData(invalidChain), 'all', { asOf: AS_OF }).rows;
  assert.equal(invalidRows[0].integrityStatus, 'invalid');
  assert.equal(invalidRows[0].delta, null);
  assert.equal(invalidRows[0].deltaSource, null);
});

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  calculateDte,
  calculateMoneyness,
  calculateVolumeOpenInterestRatio,
  calculateYieldPercent,
} from '../src/lib/optionMetrics.ts';
import { calculateCalendarDte } from '../src/lib/scannerOptionSnapshot.ts';
import { usMarketDateIso } from '../src/lib/usMarketCalendar.ts';
import { applyScreenerFilters, buildScreenerRows } from '../src/lib/screenerRows.ts';
import { canonicalOptionChainKey } from '../src/lib/optionChainRequests.ts';

const expiry = Math.floor(Date.parse('2026-10-16T00:00:00Z') / 1000);
const asOf = new Date('2026-09-28T16:00:00Z');

function chain(currentPrice, overrides = {}) {
  if (arguments.length === 0) currentPrice = 100;
  return {
    expirations: [{ date: expiry, label: 'Oct 16', dte: 999 }],
    currentPrice,
    puts: [{
      strike: 90,
      bid: 1,
      ask: 1.1,
      last: 1,
      lastTradeDate: null,
      delta: null,
      impliedVolatility: 40,
      volume: 0,
      openInterest: 100,
      ...overrides,
    }],
  };
}

function screenerData(value, overrides = {}) {
  const data = arguments.length === 0 ? chain() : chain(value, overrides);
  return {
    initialResults: new Map([['TST', data]]),
    chainsByKey: new Map([[canonicalOptionChainKey('TST', expiry), data]]),
    ivVsRealizedRangeByTicker: new Map([['TST', null]]),
  };
}

test('DTE uses the canonical New York market date and preserves calendar-day signs', () => {
  assert.equal(usMarketDateIso(new Date('2026-09-08T03:30:00Z')), '2026-09-07');
  assert.equal(calculateDte('2026-09-08', new Date('2026-09-08T03:30:00Z')), 1);
  assert.equal(calculateDte(Math.floor(Date.parse('2026-09-08T00:00:00Z') / 1000), new Date('2026-09-07T16:00:00Z')), 1);

  assert.equal(calculateDte('2026-01-01', new Date('2026-01-01T04:30:00Z')), 1, 'winter rollover');
  assert.equal(calculateDte('2026-03-09', new Date('2026-03-09T03:30:00Z')), 1, 'DST rollover');
  assert.equal(calculateDte('2026-09-07', new Date('2026-09-04T16:00:00Z')), 3, 'weekend counts');
  assert.equal(calculateDte('2026-11-26', new Date('2026-11-25T16:00:00Z')), 1, 'holiday counts');
  assert.equal(calculateDte('2026-09-07', new Date('2026-09-07T16:00:00Z')), 0, 'expiration day');
  assert.equal(calculateDte('2026-09-07', new Date('2026-09-08T16:00:00Z')), -1, 'day after expiration');
  assert.equal(calculateCalendarDte(expiry, asOf), 18);

  for (const invalid of [null, undefined, NaN, 'not-a-date', '2026-02-30', new Date('invalid')]) {
    assert.equal(calculateDte(invalid, asOf), null, `invalid expiration ${String(invalid)}`);
  }
  assert.equal(calculateDte(expiry, new Date('invalid')), null, 'invalid as-of is unavailable');
});

test('current screener DTE recomputes from exact expiration instead of stale cached metadata', () => {
  const built = buildScreenerRows(screenerData(), 'all', { asOf });
  assert.equal(built.expirations[0].dte, 18);
  assert.equal(built.rows[0].dte, 18);
  assert.equal(built.rows[0].annYieldBid, calculateYieldPercent(1, 90, 18).annualized);
});

test('unknown spot remains unavailable while provider Delta may remain usable', () => {
  for (const spot of [null, undefined, 0, -1, NaN]) {
    const built = buildScreenerRows(screenerData(spot), 'all', { asOf });
    const row = built.rows[0];
    assert.equal(row.currentPrice, null, `spot ${String(spot)} is not displayed as zero`);
    assert.equal(row.moneynessPct, null, `spot ${String(spot)} has no moneyness`);
    assert.deepEqual(applyScreenerFilters([row], {
      deltaFilter: 'all', moneynessFilter: 'otm_only', yieldFilter: 'all', oiFilter: 'all', volFilter: 'all', ivVsRealizedRangeFilter: 'all',
    }), [], `spot ${String(spot)} cannot pass moneyness filtering`);
  }

  const providerDelta = buildScreenerRows(screenerData(null, { delta: -0.2 }), 'all', { asOf }).rows[0];
  assert.equal(providerDelta.delta, -0.2);
  const calculatedDelta = buildScreenerRows(screenerData(100), 'all', { asOf }).rows[0];
  assert.ok(Number.isFinite(calculatedDelta.delta));
  assert.equal(calculatedDelta.moneynessPct, 10);
});

test('Vol/OI accepts zero volume and rejects invalid or non-positive open interest', () => {
  assert.equal(calculateVolumeOpenInterestRatio(0, 100), 0);
  assert.equal(calculateVolumeOpenInterestRatio(10, 100), 0.1);
  for (const [volume, openInterest] of [
    [10, 0], [10, null], [null, 100], [NaN, 100], [-1, 100], [10, NaN], [10, -1],
  ]) {
    assert.equal(calculateVolumeOpenInterestRatio(volume, openInterest), null);
  }
  assert.equal(buildScreenerRows(screenerData(), 'all', { asOf }).rows[0].volOI, 0);
});

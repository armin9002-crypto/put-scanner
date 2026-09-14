import test from 'node:test';
import assert from 'node:assert/strict';
import { applyScreenerFilters } from '../src/lib/screenerRows.ts';

const baseCriteria = {
  deltaFilter: 'all',
  moneynessFilter: 'all',
  yieldFilter: 'all',
  oiFilter: 'all',
  volFilter: 'all',
  ivVsRealizedRangeFilter: 'all',
  recentTradesOnly: false,
};

function row(ticker, annYieldBid, annYieldLast) {
  return {
    ticker,
    annYieldBid,
    annYieldLast,
    delta: -0.2,
    moneynessPct: 10,
    openInterest: 100,
    volume: 20,
    ivVsRealizedRange: 40,
    lastTradeDate: null,
  };
}

test('AY Last uses canonical Last value independently from AY Bid', () => {
  const rows = [row('BID-HIGH', 20, 4), row('LAST-HIGH', 4, 20)];

  const filtered = applyScreenerFilters(rows, { ...baseCriteria, yieldLastFilter: '>10' });

  assert.deepEqual(filtered.map(item => item.ticker), ['LAST-HIGH']);
});

test('AY Last applies the existing threshold and unavailable value conventions', () => {
  const rows = [row('ABOVE', 1, 10.01), row('BOUNDARY', 1, 10), row('MISSING', 1, null)];

  assert.deepEqual(
    applyScreenerFilters(rows, { ...baseCriteria, yieldLastFilter: '>10' }).map(item => item.ticker),
    ['ABOVE'],
  );
  assert.deepEqual(
    applyScreenerFilters(rows, { ...baseCriteria, yieldLastFilter: 'all' }),
    rows,
    'All leaves null AY Last rows available',
  );
});

test('AY Last refinement is a pure local operation and does not alter acquisition criteria', () => {
  const rows = [row('LOCAL', 12, 8)];
  const criteria = { ...baseCriteria, yieldLastFilter: '>5' };
  const before = JSON.stringify(rows);

  assert.equal(applyScreenerFilters(rows, criteria)[0], rows[0]);
  assert.equal(JSON.stringify(rows), before);
  assert.equal(criteria.yieldLastFilter, '>5');
  assert.equal(criteria.yieldFilter, 'all');
});

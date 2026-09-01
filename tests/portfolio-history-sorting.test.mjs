import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHistoryGroups } from '../src/lib/portfolioHistoryAnalytics.ts';
import {
  getHistorySortValue,
  sortHistoryGroups,
  sortHistoryTrades,
} from '../src/lib/portfolioHistorySorting.ts';

const trade = (overrides = {}) => ({
  id: 'history-trade',
  ticker: 'TST',
  optionType: 'put',
  strike: 50,
  expiration: '2026-08-21',
  contracts: 1,
  soldPrice: 2,
  soldDate: '2026-07-01',
  status: 'closed',
  closePrice: 1,
  closeDate: '2026-08-01',
  createdAt: '2026-07-01T00:00:00Z',
  updatedAt: '2026-08-01T00:00:00Z',
  ...overrides,
});

test('History sorting uses raw numeric values, keeps zero valid, and places unavailable values last', () => {
  const rows = [
    trade({ id: 'missing', soldPrice: Number.NaN }),
    trade({ id: 'high', soldPrice: 0.94326667 }),
    trade({ id: 'zero', soldPrice: 0 }),
    trade({ id: 'low', soldPrice: 0.73326 }),
  ];
  assert.equal(getHistorySortValue(rows[1], 'soldPrice'), 0.94326667);
  assert.deepEqual(sortHistoryTrades(rows, 'soldPrice', 'asc').map(row => row.id), ['zero', 'low', 'high', 'missing']);
  assert.deepEqual(sortHistoryTrades(rows, 'soldPrice', 'desc').map(row => row.id), ['high', 'low', 'zero', 'missing']);
});

test('History sorting uses chronological dates, canonical metrics, labels, and stable ties', () => {
  const rows = [
    trade({ id: 'later', ticker: 'ZZZ', expiration: '2027-01-15', soldDate: '2026-08-10', strike: 100, entryDelta: -0.2, resolutionType: 'expired_worthless', status: 'expired', expirationClosePrice: 110 }),
    trade({ id: 'same-first', ticker: 'AAA', expiration: '2026-09-18', soldDate: '2026-07-10', strike: 50, entryDelta: undefined }),
    trade({ id: 'same-second', ticker: 'BBB', expiration: '2026-09-18', soldDate: '2026-07-10', strike: 50, entryDelta: undefined }),
  ];
  assert.deepEqual(sortHistoryTrades(rows, 'expiration', 'asc').map(row => row.id), ['same-first', 'same-second', 'later']);
  assert.deepEqual(sortHistoryTrades(rows, 'entry', 'desc').map(row => row.id), ['later', 'same-first', 'same-second']);
  assert.deepEqual(sortHistoryTrades(rows, 'ticker', 'asc').map(row => row.id), ['same-first', 'same-second', 'later']);
  assert.deepEqual(sortHistoryTrades(rows, 'ticker', 'desc').map(row => row.id), ['later', 'same-second', 'same-first']);
  assert.deepEqual(sortHistoryTrades(rows, 'entryDelta', 'asc').map(row => row.id), ['later', 'same-first', 'same-second']);
  assert.deepEqual(sortHistoryTrades(rows, 'entryDelta', 'desc').map(row => row.id), ['later', 'same-first', 'same-second']);
  assert.equal(getHistorySortValue(rows[0], 'outcome'), 'Expired Worthless');
});

test('History grouped sorting preserves group order and subtotals while sorting rows within each group', () => {
  const rows = [
    trade({ id: 'year-2027-high', ticker: 'ZZZ', expiration: '2027-12-17', soldPrice: 4 }),
    trade({ id: 'year-2026', ticker: 'MID', expiration: '2026-09-18', soldPrice: 3 }),
    trade({ id: 'year-2027-low', ticker: 'AAA', expiration: '2027-05-21', soldPrice: 1 }),
  ];
  const groups = buildHistoryGroups(rows, 'year');
  const sorted = sortHistoryGroups(groups, 'soldPrice', 'asc');
  assert.deepEqual(sorted.map(group => group.label), ['2027', '2026']);
  assert.deepEqual(sorted[0].trades.map(row => row.id), ['year-2027-low', 'year-2027-high']);
  assert.equal(sorted[0].grossRisk, groups[0].grossRisk);
  assert.equal(sorted[0].premium, groups[0].premium);

  const flat = sortHistoryGroups(buildHistoryGroups(rows, 'none'), 'soldPrice', 'desc');
  assert.deepEqual(flat[0].trades.map(row => row.id), ['year-2027-high', 'year-2026', 'year-2027-low']);
});

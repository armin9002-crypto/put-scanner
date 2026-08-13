import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExpirationScheduleGroups } from '../src/lib/portfolioAnalytics.ts';
import { calculateCurrentOptionMark, calculatePortfolioMarkSummary, calculatePortfolioSummary } from '../src/lib/portfolioMetrics.ts';
import { isExpiredUnresolvedOpenTrade, markExpirationPricePending, resolveExpiredTradeWithClose, selectExpirationClose } from '../src/lib/portfolioExpirationArchive.ts';
import { readCollapsedExpirationGroups, setAllExpirationGroupsCollapsed, toggleCollapsedExpirationGroup } from '../src/lib/portfolioSchedulePreferences.ts';

const trade = (overrides = {}) => ({
  id: 't1', ticker: 'TST', optionType: 'put', strike: 50, expiration: '2027-01-15', contracts: 2,
  soldPrice: 2, soldDate: '2026-01-15', status: 'open', createdAt: '2026-01-15T00:00:00Z', updatedAt: '2026-01-15T00:00:00Z',
  latestMarketData: { underlyingPrice: 60, optionBid: 1, optionAsk: 1.4, optionLast: 1.1, optionMid: 1.2, delta: -0.2 }, ...overrides,
});

test('portfolio totals and bid/ask/last reconciliation use production formulas', () => {
  const open = trade();
  assert.equal(calculateCurrentOptionMark(open, 'bid'), 1);
  assert.equal(calculateCurrentOptionMark(open, 'ask'), 1.4);
  assert.equal(calculateCurrentOptionMark(open, 'last'), 1.1);
  const summary = calculatePortfolioSummary([open]);
  assert.equal(summary.totalPremiumCollected, 400);
  assert.equal(summary.totalEquityAtRisk, 10_000);
  assert.equal(summary.totalNetCapitalAtRisk, 9_600);
  const ask = calculatePortfolioMarkSummary([open], 'ask');
  assert.equal(ask.totalCurrentValue, -280);
  assert.equal(ask.totalGainLoss, 120);
  assert.equal(ask.percentCaptured, 0.3);
});

test('expiration groups sort chronologically, exclude archives, and reconcile totals', () => {
  const trades = [trade({ id: 'late', expiration: '2027-02-19', contracts: 3 }), trade({ id: 'early' }), trade({ id: 'closed', status: 'closed' })];
  const groups = buildExpirationScheduleGroups(trades, 'ask');
  assert.deepEqual(groups.map(group => group.expiration), ['2027-01-15', '2027-02-19']);
  assert.deepEqual(groups.map(group => group.contractCount), [2, 3]);
  assert.equal(groups.reduce((sum, group) => sum + group.premiumCollected, 0), 1_000);
});

test('expiration collapse state is independent per group and safely parsed', () => {
  const one = toggleCollapsedExpirationGroup({}, '2027-01-15');
  const two = toggleCollapsedExpirationGroup(one, '2027-02-19');
  assert.deepEqual(toggleCollapsedExpirationGroup(two, '2027-01-15'), { '2027-01-15': false, '2027-02-19': true });
  assert.deepEqual(setAllExpirationGroupsCollapsed(['a', 'b'], true), { a: true, b: true });
  assert.deepEqual(readCollapsedExpirationGroups({ getItem: () => '{"a":true,"bad":"yes"}' }), { a: true });
});

test('expiration close selection prefers exact date then nearest prior trading day', () => {
  const points = [{ timestamp: 1, date: '2026-06-18', price: 49 }, { timestamp: 2, date: '2026-06-19', price: 51 }, { timestamp: 3, date: '2026-06-22', price: 55 }];
  assert.deepEqual(selectExpirationClose(points, '2026-06-19'), { closePrice: 51, closeDate: '2026-06-19', warning: undefined });
  const prior = selectExpirationClose(points, '2026-06-21');
  assert.equal(prior.closeDate, '2026-06-19');
  assert.match(prior.warning, /prior trading-day/);
});

test('expired positions resolve worthless or ITM and retain pending fallback state', () => {
  const expired = trade({ expiration: '2026-06-19' });
  assert.equal(isExpiredUnresolvedOpenTrade(expired, new Date('2026-06-20T12:00:00Z')), true);
  const worthless = resolveExpiredTradeWithClose(expired, 55, '2026-06-19', 'expiration_close', undefined, '2026-06-20T12:00:00Z');
  assert.equal(worthless.resolutionType, 'expired_worthless');
  assert.equal(worthless.finalOptionValue, 0);
  assert.equal(worthless.realizedPnl, 400);
  const itm = resolveExpiredTradeWithClose(expired, 45, '2026-06-19', 'manual_expiration_close', undefined, '2026-06-20T12:00:00Z');
  assert.equal(itm.resolutionType, 'expired_itm');
  assert.equal(itm.finalOptionValue, 1_000);
  assert.equal(itm.realizedPnl, -600);
  assert.equal(markExpirationPricePending(expired).status, 'expired_price_pending');
});

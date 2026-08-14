import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExpirationScheduleGroups, buildFlatScheduleTrades, buildUnderlyingScheduleGroups } from '../src/lib/portfolioAnalytics.ts';
import { calculateCurrentOptionMark, calculatePortfolioMarkSummary, calculatePortfolioSummary } from '../src/lib/portfolioMetrics.ts';
import { isExpiredUnresolvedOpenTrade, markExpirationPricePending, resolveExpiredTradeWithClose, selectExpirationClose } from '../src/lib/portfolioExpirationArchive.ts';
import { resolveEntryVixFromPoints, resolvePortfolioEntryVix, selectEntryVixClose, unresolvedEntryVixDates } from '../src/lib/portfolioEntryVix.ts';
import { persistPortfolioGroupMode, readCollapsedExpirationGroups, readCollapsedUnderlyingGroups, readPortfolioGroupMode, setAllExpirationGroupsCollapsed, toggleCollapsedExpirationGroup } from '../src/lib/portfolioSchedulePreferences.ts';
import { normalizePortfolioTrade } from '../src/lib/portfolioStorage.ts';

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

test('underlying groups sort A-Z, reconcile the same totals, and expose useful ticker metadata', () => {
  const trades = [
    trade({ id: 'boil-late', ticker: 'BOIL', expiration: '2027-02-19', contracts: 3, latestMarketData: { underlyingPrice: 61, optionAsk: 1.4, delta: -0.2, refreshedAt: '2026-08-13T12:00:00Z' } }),
    trade({ id: 'tqqq', ticker: 'TQQQ', contracts: 1 }),
    trade({ id: 'boil-early', ticker: 'BOIL', contracts: 2 }),
  ];
  const expiryGroups = buildExpirationScheduleGroups(trades, 'ask');
  const tickerGroups = buildUnderlyingScheduleGroups(trades, 'ask');
  assert.deepEqual(tickerGroups.map(group => group.ticker), ['BOIL', 'TQQQ']);
  assert.equal(tickerGroups[0].expirationCount, 2);
  assert.equal(tickerGroups[0].contractCount, 5);
  assert.equal(tickerGroups[0].underlyingPrice, 61);
  assert.equal(tickerGroups.reduce((sum, group) => sum + group.premiumCollected, 0), expiryGroups.reduce((sum, group) => sum + group.premiumCollected, 0));
  assert.equal(tickerGroups.reduce((sum, group) => sum + group.grossRisk, 0), expiryGroups.reduce((sum, group) => sum + group.grossRisk, 0));
});

test('None mode contains every open trade once and reconciles unchanged overall totals', () => {
  const trades = [trade({ id: 'one', ticker: 'SOXL' }), trade({ id: 'two', ticker: 'LABU', expiration: '2027-02-19' }), trade({ id: 'closed', status: 'closed' })];
  const flat = buildFlatScheduleTrades(trades);
  assert.deepEqual(flat.map(item => item.id), ['one', 'two']);
  assert.equal(new Set(flat.map(item => item.id)).size, flat.length);
  const totals = calculatePortfolioSummary(flat);
  const markTotals = calculatePortfolioMarkSummary(flat, 'ask');
  const expiryGroups = buildExpirationScheduleGroups(trades, 'ask');
  const underlyingGroups = buildUnderlyingScheduleGroups(trades, 'ask');
  for (const groups of [expiryGroups, underlyingGroups]) {
    assert.equal(groups.reduce((sum, group) => sum + group.premiumCollected, 0), totals.totalPremiumCollected);
    assert.equal(groups.reduce((sum, group) => sum + group.grossRisk, 0), totals.totalEquityAtRisk);
    assert.equal(groups.reduce((sum, group) => sum + group.netCapitalAtRisk, 0), totals.totalNetCapitalAtRisk);
    assert.equal(groups.reduce((sum, group) => sum + group.currentValue, 0), markTotals.totalCurrentValue);
    assert.equal(groups.reduce((sum, group) => sum + group.totalGainLoss, 0), markTotals.totalGainLoss);
    const blendedDelta = groups.reduce((sum, group) => sum + group.weightedAverageDelta * group.grossRisk, 0) / groups.reduce((sum, group) => sum + group.grossRisk, 0);
    assert.equal(blendedDelta, markTotals.weightedAverageDelta);
  }
});

test('expiration collapse state is independent per group and safely parsed', () => {
  const one = toggleCollapsedExpirationGroup({}, '2027-01-15');
  const two = toggleCollapsedExpirationGroup(one, '2027-02-19');
  assert.deepEqual(toggleCollapsedExpirationGroup(two, '2027-01-15'), { '2027-01-15': false, '2027-02-19': true });
  assert.deepEqual(setAllExpirationGroupsCollapsed(['a', 'b'], true), { a: true, b: true });
  assert.deepEqual(readCollapsedExpirationGroups({ getItem: () => '{"a":true,"bad":"yes"}' }), { a: true });
  assert.deepEqual(readCollapsedUnderlyingGroups({ getItem: () => '{"BOIL":true}' }), { BOIL: true });
  assert.equal(readPortfolioGroupMode({ getItem: () => 'expiration' }), 'expiration');
  assert.equal(readPortfolioGroupMode({ getItem: () => 'underlying' }), 'underlying');
  assert.equal(readPortfolioGroupMode({ getItem: () => 'none' }), 'none');
  assert.equal(readPortfolioGroupMode({ getItem: () => null }), 'expiration');
  assert.equal(readPortfolioGroupMode({ getItem: () => 'unexpected' }), 'expiration');
  let persistedMode = null;
  persistPortfolioGroupMode('none', { setItem: (_key, value) => { persistedMode = value; } });
  assert.equal(persistedMode, 'none');
});

test('entry VIX selects the official close or nearest prior trading close and persists once', () => {
  const points = [
    { timestamp: Date.parse('2026-06-18T00:00:00Z') / 1000, date: '2026-06-18', price: 20.5 },
    { timestamp: Date.parse('2026-06-19T00:00:00Z') / 1000, date: '2026-06-19', price: 22.25 },
    { timestamp: Date.parse('2026-06-22T00:00:00Z') / 1000, date: '2026-06-22', price: 24 },
  ];
  assert.deepEqual(selectEntryVixClose(points, '2026-06-19'), { close: 22.25, closeDate: '2026-06-19', source: 'historical_close' });
  assert.deepEqual(selectEntryVixClose(points, '2026-06-21'), { close: 22.25, closeDate: '2026-06-19', source: 'nearest_prior_close' });
  assert.equal(selectEntryVixClose(points, '2026-06-17'), null);

  const openTrades = [trade({ id: 'exact', soldDate: '2026-06-19' }), trade({ id: 'weekend', soldDate: '2026-06-21' })];
  assert.deepEqual(unresolvedEntryVixDates(openTrades), ['2026-06-19', '2026-06-21']);
  const resolved = resolveEntryVixFromPoints(openTrades, points, '2026-06-23T00:00:00Z');
  assert.equal(resolved.changed, true);
  assert.equal(resolved.resolved, 2);
  assert.equal(resolved.trades[1].entryVixSource, 'nearest_prior_close');
  const normalized = normalizePortfolioTrade(resolved.trades[1]);
  assert.equal(normalized.entryVixClose, 22.25);
  assert.equal(normalized.entryVixDate, '2026-06-19');
  const repeat = resolveEntryVixFromPoints(resolved.trades, points);
  assert.equal(repeat.changed, false);
  assert.equal(repeat.resolved, 0);
  assert.deepEqual(unresolvedEntryVixDates(repeat.trades), []);
});

test('entry VIX batches many missing entry dates into one request and never refetches persisted values', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({
      ticker: '^VIX',
      timeframe: 'custom',
      fetchedAt: Date.now(),
      metadata: { interval: '1d' },
      points: [
        { timestamp: Date.parse('2025-01-02T00:00:00Z') / 1000, date: '2025-01-02', price: 17 },
        { timestamp: Date.parse('2025-02-03T00:00:00Z') / 1000, date: '2025-02-03', price: 19 },
      ],
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const many = [trade({ id: 'jan', soldDate: '2025-01-02' }), trade({ id: 'feb', soldDate: '2025-02-03' })];
    const first = await resolvePortfolioEntryVix(many);
    assert.equal(requests, 1);
    assert.equal(first.networkRequests, 1);
    assert.equal(first.resolved, 2);
    const second = await resolvePortfolioEntryVix(first.trades);
    assert.equal(requests, 1);
    assert.equal(second.networkRequests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
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

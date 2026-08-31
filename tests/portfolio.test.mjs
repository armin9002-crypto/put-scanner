import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExpirationScheduleGroups, buildFlatScheduleTrades, buildUnderlyingScheduleGroups } from '../src/lib/portfolioAnalytics.ts';
import { calculateCurrentOptionMark, calculatePortfolioMarkSummary, calculatePortfolioSummary } from '../src/lib/portfolioMetrics.ts';
import { assessExpirationCorporateActionBasis, isExpiredUnresolvedOpenTrade, markExpirationPricePending, resolveExpiredTradeWithClose, selectExpirationClose } from '../src/lib/portfolioExpirationArchive.ts';
import { resolveEntryVixFromPoints, resolvePortfolioEntryVix, selectEntryVixClose, unresolvedEntryVixDates } from '../src/lib/portfolioEntryVix.ts';
import { persistPortfolioGroupMode, readCollapsedExpirationGroups, readCollapsedUnderlyingGroups, readPortfolioGroupMode, setAllExpirationGroupsCollapsed, toggleCollapsedExpirationGroup } from '../src/lib/portfolioSchedulePreferences.ts';
import { normalizePortfolioTrade, readPortfolioTrades, writePortfolioTrades } from '../src/lib/portfolioStorage.ts';
import { normalizeManualHistoricalEntryDelta } from '../src/lib/portfolioEntryDelta.ts';
import { prepareManualTradeForSave, resolvePreparedManualTrade } from '../src/lib/portfolioHistoricalTrade.ts';
import { buildHistoryAnalytics, buildHistoryGroups, buildMonthlyRealizedPnl, historyDaysHeld, historyFinalValue, historyPercentCaptured, historyPremium, historyPriceAtExpiration, historyRealizedIrr, historyRealizedPnl } from '../src/lib/portfolioHistoryAnalytics.ts';
import { confirmPortfolioTradeExpiredWorthless, isManualWorthlessConfirmationEligible } from '../src/lib/portfolioRealizedEconomics.ts';
import {
  getPortfolioPositionHealthLevel,
  getPortfolioScheduleSortValue,
  sortExpirationPortfolioScheduleGroups,
  sortFlatPortfolioSchedule,
  sortUnderlyingPortfolioScheduleGroups,
} from '../src/lib/portfolioScheduleSorting.ts';

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

test('every meaningful Portfolio Schedule field sorts by its raw value with missing values last', () => {
  const lower = trade({
    id: 'lower', ticker: 'AAA', expiration: '2027-01-15', strike: 50, contracts: 1, soldPrice: 1,
    entryVixClose: 15,
    latestMarketData: { underlyingPrice: 80, optionBid: 0.1, optionAsk: 0.2, optionLast: 0.15, delta: -0.1, iv: 0.2, volume: 900, openInterest: 100 },
  });
  const higher = trade({
    id: 'higher', ticker: 'ZZZ', expiration: '2028-01-21', strike: 100, contracts: 3, soldPrice: 4,
    entryVixClose: 25,
    latestMarketData: { underlyingPrice: 105, optionBid: 1.5, optionAsk: 2, optionLast: 1.8, delta: -0.3, iv: 0.5, volume: 10, openInterest: 500 },
  });
  const missing = trade({
    id: 'missing', ticker: ' ', expiration: 'invalid', strike: Number.NaN, contracts: Number.NaN, soldPrice: Number.NaN,
    entryVixClose: Number.NaN, entrySnapshot: {}, latestMarketData: {},
  });
  const fields = [
    'ticker', 'expiration', 'dte', 'health', 'strike', 'contracts', 'soldPrice', 'premium', 'grossRisk',
    'netCapitalRisk', 'currentMark', 'currentValue', 'pnl', 'percentCaptured', 'delta', 'breakeven',
    'underlying', 'distanceToStrike', 'iv', 'entryVix', 'openInterest', 'originalNy', 'originalAy',
    'currentNy', 'currentAy',
  ];

  for (const field of fields) {
    assert.notEqual(getPortfolioScheduleSortValue(lower, field, 'ask'), null, `${field} lower fixture`);
    assert.notEqual(getPortfolioScheduleSortValue(higher, field, 'ask'), null, `${field} higher fixture`);
    assert.equal(getPortfolioScheduleSortValue(missing, field, 'ask'), null, `${field} missing fixture`);
    const ascending = sortFlatPortfolioSchedule([missing, higher, lower], field, 'asc', 'ask');
    const descending = sortFlatPortfolioSchedule([missing, lower, higher], field, 'desc', 'ask');
    assert.equal(ascending.at(-1).id, 'missing', `${field} ascending null placement`);
    assert.equal(descending.at(-1).id, 'missing', `${field} descending null placement`);
    assert.deepEqual(descending.slice(0, 2).map(item => item.id), ascending.slice(0, 2).map(item => item.id).reverse(), `${field} direction`);
  }
});

test('Health sorting follows risk severity rather than alphabetical labels', () => {
  const healthTrade = (id, underlying, delta = -0.1) => trade({ id, latestMarketData: { underlyingPrice: underlying, optionAsk: 1.4, delta } });
  const fixtures = [
    healthTrade('healthy', 70),
    healthTrade('monitor', 65),
    healthTrade('elevated', 62),
    healthTrade('risky', 55),
    healthTrade('threatened', 47),
    trade({ id: 'unknown', latestMarketData: {} }),
  ];
  assert.deepEqual(fixtures.map(getPortfolioPositionHealthLevel), ['Healthy', 'Monitor', 'Elevated', 'Risky', 'Threatened', 'Unknown']);
  assert.deepEqual(sortFlatPortfolioSchedule(fixtures, 'health', 'asc', 'ask').map(item => item.id), ['healthy', 'monitor', 'elevated', 'risky', 'threatened', 'unknown']);
  assert.deepEqual(sortFlatPortfolioSchedule(fixtures, 'health', 'desc', 'ask').map(item => item.id), ['threatened', 'risky', 'elevated', 'monitor', 'healthy', 'unknown']);
});

test('group sorting changes only the relevant group order and keeps child rows attached', () => {
  const trades = [
    trade({ id: 'boil-late-low', ticker: 'BOIL', expiration: '2028-01-21', soldPrice: 1 }),
    trade({ id: 'boil-late-high', ticker: 'BOIL', expiration: '2028-01-21', soldPrice: 3 }),
    trade({ id: 'tqqq-early', ticker: 'TQQQ', expiration: '2027-01-15', soldPrice: 2 }),
  ];
  const expiryGroups = buildExpirationScheduleGroups(trades, 'ask');
  const expiryDescending = sortExpirationPortfolioScheduleGroups(expiryGroups, 'expiration', 'desc', 'ask');
  assert.deepEqual(expiryDescending.map(group => group.expiration), ['2028-01-21', '2027-01-15']);
  assert.deepEqual(expiryDescending.flatMap(group => group.trades.map(item => item.id)).sort(), trades.map(item => item.id).sort());
  const expiryRows = sortExpirationPortfolioScheduleGroups(expiryGroups, 'soldPrice', 'desc', 'ask');
  assert.deepEqual(expiryRows.map(group => group.expiration), ['2027-01-15', '2028-01-21']);
  assert.deepEqual(expiryRows[1].trades.map(item => item.id), ['boil-late-high', 'boil-late-low']);

  const tickerGroups = buildUnderlyingScheduleGroups(trades, 'ask');
  const tickerDescending = sortUnderlyingPortfolioScheduleGroups(tickerGroups, 'ticker', 'desc', 'ask');
  assert.deepEqual(tickerDescending.map(group => group.ticker), ['TQQQ', 'BOIL']);
  assert.deepEqual(tickerDescending.flatMap(group => group.trades.map(item => item.id)).sort(), trades.map(item => item.id).sort());
  const tickerRows = sortUnderlyingPortfolioScheduleGroups(tickerGroups, 'soldPrice', 'desc', 'ask');
  assert.deepEqual(tickerRows.map(group => group.ticker), ['BOIL', 'TQQQ']);
  assert.deepEqual(tickerRows[0].trades.map(item => item.id), ['boil-late-high', 'boil-late-low']);
});

test('OI / Volume sorting deliberately uses Open Interest as its primary value', () => {
  const highVolume = trade({ id: 'high-volume', latestMarketData: { underlyingPrice: 60, optionAsk: 1.4, volume: 10_000, openInterest: 100 } });
  const highOi = trade({ id: 'high-oi', latestMarketData: { underlyingPrice: 60, optionAsk: 1.4, volume: 1, openInterest: 500 } });
  assert.deepEqual(sortFlatPortfolioSchedule([highVolume, highOi], 'openInterest', 'desc', 'ask').map(item => item.id), ['high-oi', 'high-volume']);
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

const historicalInput = (overrides = {}) => ({
  ticker: 'TQQQ', optionType: 'put', strike: 50, expiration: '2025-06-20', contracts: 2,
  soldPrice: 1.2345, soldDate: '2025-05-01', status: 'open', notes: '', ...overrides,
});

test('historical held-to-expiration saves derive worthless and ITM economics through the canonical resolver', async () => {
  let acquisitions = 0;
  const worthlessPrepared = prepareManualTradeForSave(historicalInput(), null, { mode: 'historical', historicalOutcome: 'held_to_expiration' }, '2026-08-30T12:00:00Z');
  assert.equal(worthlessPrepared.needsExpirationLookup, true);
  const worthless = await resolvePreparedManualTrade(worthlessPrepared, {
    nowIso: '2026-08-30T12:00:00Z',
    lookup: async () => { acquisitions += 1; return { closePrice: 55, closeDate: '2025-06-20', basisStatus: 'provider_no_actions', basisCheckedFrom: '2025-05-01' }; },
  });
  assert.equal(acquisitions, 1, 'one cold explicit save performs one bounded acquisition');
  assert.equal(worthless.resolutionType, 'expired_worthless');
  assert.deepEqual([worthless.expirationBasisStatus, worthless.expirationBasisCheckedFrom], ['provider_no_actions', '2025-05-01']);
  assert.equal(worthless.finalOptionValue, 0);
  assert.ok(Math.abs(historyPremium(worthless) - 246.9) < 1e-10);
  assert.ok(Math.abs(historyRealizedPnl(worthless) - 246.9) < 1e-10);

  const itm = await resolvePreparedManualTrade(prepareManualTradeForSave(
    historicalInput(), null, { mode: 'historical', historicalOutcome: 'held_to_expiration' }, '2026-08-30T12:00:00Z',
  ), { lookup: async () => ({ closePrice: 45, closeDate: '2025-06-20' }) });
  assert.equal(itm.resolutionType, 'expired_itm');
  assert.equal(itm.status, 'expired');
  assert.equal(itm.finalOptionValue, 1_000);
  assert.ok(Math.abs(historyRealizedPnl(itm) - -753.1) < 1e-10);
  assert.notEqual(historyRealizedIrr(itm), null);
});

test('historical bought-back trades use close economics, including a buyback on expiration day, with no expiration lookup', async () => {
  const closedInput = historicalInput({ closePrice: 0.5, closeDate: '2025-06-10' });
  const prepared = prepareManualTradeForSave(closedInput, null, { mode: 'historical', historicalOutcome: 'closed' }, '2026-08-30T12:00:00Z');
  assert.equal(prepared.needsExpirationLookup, false);
  let acquisitions = 0;
  const closed = await resolvePreparedManualTrade(prepared, { lookup: async () => { acquisitions += 1; return null; } });
  assert.equal(acquisitions, 0);
  assert.equal(closed.status, 'closed');
  assert.equal(closed.closeDate, '2025-06-10');
  assert.ok(Math.abs(historyRealizedPnl(closed) - 146.9) < 1e-10);

  const sameDay = prepareManualTradeForSave(
    historicalInput({ closePrice: 0.25, closeDate: '2025-06-20' }),
    null,
    { mode: 'historical', historicalOutcome: 'closed' },
  ).trade;
  assert.equal(sameDay.status, 'closed');
  assert.equal(sameDay.closeDate, sameDay.expiration);
  assert.ok(Math.abs(historyRealizedPnl(sameDay) - 196.9) < 1e-10);
});

test('historical manual Entry Delta accepts either sign, preserves zero, and stores canonical manual provenance', () => {
  assert.equal(normalizeManualHistoricalEntryDelta(0.2271), -0.2271);
  assert.equal(normalizeManualHistoricalEntryDelta(-0.2271), -0.2271);
  assert.equal(normalizeManualHistoricalEntryDelta(0), 0);
  assert.throws(() => normalizeManualHistoricalEntryDelta(1.01), RangeError);
  const prepared = prepareManualTradeForSave(historicalInput({
    entryDelta: normalizeManualHistoricalEntryDelta(0.1235),
    entryDeltaSource: 'manual',
    entryDeltaCapturedAt: '2026-08-30T12:00:00Z',
  }), null, { mode: 'historical', historicalOutcome: 'closed' }).trade;
  assert.deepEqual([prepared.entryDelta, prepared.entryDeltaSource], [-0.1235, 'manual']);
});

test('historical expiration corporate-action guard is deterministic across provider events and contract boundaries', async () => {
  const prepared = prepareManualTradeForSave(historicalInput({ ticker: 'SOXL' }), null, { mode: 'historical', historicalOutcome: 'held_to_expiration' });
  const unavailable = await resolvePreparedManualTrade(prepared, { lookup: async () => null });
  assert.equal(unavailable.status, 'expired_price_pending');
  assert.equal(historyRealizedPnl(unavailable), null);

  const action = (ticker, type, date, details = {}) => ({
    ticker,
    type,
    timestamp: Date.parse(`${date}T00:00:00Z`) / 1000,
    date: `${date}T00:00:00Z`,
    ...details,
  });
  const start = '2025-05-01';
  const expiration = '2025-06-20';
  const forwardSplit = action('TQQQ', 'split', '2025-06-01', { splitRatio: '2:1', numerator: 2, denominator: 1 });
  const reverseSplit = action('SOXL', 'split', '2025-06-02', { splitRatio: '1:10', numerator: 1, denominator: 10 });
  const ordinaryDividend = action('LABU', 'dividend', '2025-06-03', { amount: 0.08 });
  const capitalGain = action('SSO', 'capital_gain', '2025-06-04', { amount: 1.25 });
  const specialDividend = action('TQQQ', 'dividend', '2025-06-05', { amount: 15 });

  assert.equal(assessExpirationCorporateActionBasis([], '2025-05-01', '2025-06-20').safe, true);
  for (const fixture of [forwardSplit, reverseSplit, ordinaryDividend, capitalGain, specialDividend]) {
    const assessment = assessExpirationCorporateActionBasis([fixture], start, expiration);
    assert.equal(assessment.safe, false, `${fixture.ticker} ${fixture.type} remains fail-closed`);
    assert.match(assessment.warning, /adjusted option deliverables/);
  }

  assert.equal(assessExpirationCorporateActionBasis([
    action('TQQQ', 'split', '2025-04-30', { splitRatio: '2:1' }),
  ], start, expiration).safe, true, 'an event before entry does not affect the entered contract basis');
  assert.equal(assessExpirationCorporateActionBasis([
    action('SOXL', 'split', '2025-05-01', { splitRatio: '1:10' }),
  ], start, expiration).safe, true, 'an effective event on entry day is already reflected in that day\'s listed contract');
  assert.equal(assessExpirationCorporateActionBasis([
    action('LABU', 'dividend', '2025-06-21', { amount: 0.25 }),
  ], start, expiration).safe, true, 'an event after expiration is irrelevant');
  assert.equal(assessExpirationCorporateActionBasis([
    action('SSO', 'capital_gain', '2025-04-15', { amount: 0.5 }),
    action('SSO', 'dividend', '2025-06-10', { amount: 0.25 }),
    action('SSO', 'split', '2025-07-01', { splitRatio: '2:1' }),
  ], start, expiration).safe, false, 'multiple events fail closed when any ambiguous event is in contract');
  assert.equal(assessExpirationCorporateActionBasis([
    action('TQQQ', 'split', expiration, { splitRatio: '2:1' }),
  ], start, expiration).safe, false, 'expiration-date actions are inside the contract window');
  assert.equal(assessExpirationCorporateActionBasis(null, start, expiration).safe, false);
  assert.equal(assessExpirationCorporateActionBasis(undefined, start, expiration).safe, false);
  assert.equal(assessExpirationCorporateActionBasis([], 'invalid', expiration).safe, false);

  const basis = assessExpirationCorporateActionBasis([reverseSplit], start, expiration);
  const blocked = await resolvePreparedManualTrade(prepared, { lookup: async () => { throw new Error(basis.warning); } });
  assert.equal(blocked.status, 'expired_price_pending');
  assert.match(blocked.resolutionWarning, /adjusted option deliverables/);
});

test('manual worthless confirmation is eligibility-gated, request-free, canonical, durable, and correctable', async () => {
  const pending = markExpirationPricePending(trade({
    id: 'manual-worthless',
    ticker: 'SOXL',
    expiration: '2025-06-20',
    soldDate: '2025-05-01',
    soldPrice: 1.2345,
    contracts: 2,
    entryVixClose: 20.4,
    entryVixDate: '2025-05-01',
    entryVixSource: 'historical_close',
    entryDelta: -0.23,
    entryDeltaSource: 'manual',
    entryDeltaCapturedAt: '2026-08-30T12:00:00Z',
  }), 'Expiration economics remain pending because Yahoo reported an in-contract corporate action (dividend); adjusted option deliverables are not stored.', '2026-08-30T12:00:00Z');
  const now = new Date('2026-08-30T12:00:00Z');
  assert.equal(isManualWorthlessConfirmationEligible(pending, now), true);
  assert.equal(isManualWorthlessConfirmationEligible({ ...pending, status: 'open' }, now), false);
  assert.equal(isManualWorthlessConfirmationEligible({ ...pending, status: 'closed' }, now), false);
  assert.equal(isManualWorthlessConfirmationEligible({ ...pending, status: 'assigned' }, now), false);
  assert.equal(isManualWorthlessConfirmationEligible({ ...pending, expiration: '2027-01-15' }, now), false);

  const originalFetch = globalThis.fetch;
  let providerRequests = 0;
  globalThis.fetch = async () => {
    providerRequests += 1;
    throw new Error('manual confirmation must not acquire provider data');
  };
  let confirmed;
  try {
    confirmed = confirmPortfolioTradeExpiredWorthless(pending, now);
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.ok(confirmed);
  assert.equal(providerRequests, 0);
  assert.deepEqual(
    [confirmed.status, confirmed.resolutionType, confirmed.resolutionSource, confirmed.resolvedDate, confirmed.closeDate],
    ['expired', 'expired_worthless', 'manual_worthless_confirmation', '2025-06-20', '2025-06-20'],
  );
  assert.deepEqual(
    [confirmed.expirationClosePrice, confirmed.expirationCloseDate, confirmed.expirationBasisStatus, confirmed.expirationBasisCheckedFrom],
    [undefined, undefined, undefined, undefined],
    'manual outcome knowledge never creates or claims an underlying expiration price',
  );
  assert.equal(confirmed.resolutionWarning, undefined);
  assert.equal(historyFinalValue(confirmed), 0);
  assert.equal(confirmed.finalOptionValue, 0);
  assert.ok(Math.abs(historyPremium(confirmed) - 246.9) < 1e-12);
  assert.ok(Math.abs(historyRealizedPnl(confirmed) - 246.9) < 1e-12);
  assert.equal(historyPercentCaptured(confirmed), 1);
  assert.equal(historyDaysHeld(confirmed), 50);
  assert.equal(historyPriceAtExpiration(confirmed), null);
  const expectedIrr = Math.pow(1 + 246.9 / 9_753.1, 365.25 / 50) - 1;
  assert.ok(Math.abs(historyRealizedIrr(confirmed) - expectedIrr) < 1e-12);
  assert.deepEqual(
    [confirmed.entryVixClose, confirmed.entryVixDate, confirmed.entryDelta, confirmed.entryDeltaSource],
    [20.4, '2025-05-01', -0.23, 'manual'],
  );

  const analytics = buildHistoryAnalytics([confirmed]);
  assert.deepEqual([analytics.resolvedTrades, analytics.blendedCapture, analytics.counts.expired_worthless, analytics.totalHistoricalNotional], [1, 1, 1, 10_000]);
  assert.ok(Math.abs(analytics.realizedPnl - 246.9) < 1e-12);
  assert.ok(Math.abs(analytics.premiumCollected - 246.9) < 1e-12);
  assert.equal(analytics.weightedAverageEntryDelta, -0.23);
  assert.notEqual(analytics.totalRealizedIrr, null);
  for (const mode of ['year', 'expiration', 'underlying', 'none']) {
    const group = buildHistoryGroups([confirmed], mode)[0];
    assert.ok(Math.abs(group.premium - 246.9) < 1e-12);
    assert.ok(Math.abs(group.realizedPnl - 246.9) < 1e-12);
    assert.equal(group.weightedAveragePercentCaptured, 1);
  }
  const monthly = buildMonthlyRealizedPnl([confirmed]);
  assert.deepEqual([monthly[0].month, monthly[0].trades], ['2025-06', 1]);
  assert.ok(Math.abs(monthly[0].premiumCollected - 246.9) < 1e-12);
  assert.ok(Math.abs(monthly[0].realizedPnl - 246.9) < 1e-12);

  class MemoryStorage {
    constructor() { this.values = new Map(); }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
  }
  const storage = new MemoryStorage();
  assert.equal(writePortfolioTrades(storage, [confirmed]).status, 'ok');
  const reloaded = readPortfolioTrades(storage).data[0];
  assert.equal(reloaded.resolutionSource, 'manual_worthless_confirmation');
  assert.equal(reloaded.expirationClosePrice, undefined);

  let editLookups = 0;
  const preparedEdit = prepareManualTradeForSave({ ...reloaded, notes: 'reviewed later' }, reloaded, { mode: 'historical', historicalOutcome: 'held_to_expiration' }, '2026-09-01T12:00:00Z');
  assert.equal(preparedEdit.needsExpirationLookup, false, 'ordinary edits preserve explicit user attestation without retrying Yahoo');
  const edited = await resolvePreparedManualTrade(preparedEdit, { lookup: async () => { editLookups += 1; return null; } });
  assert.equal(editLookups, 0);
  assert.equal(edited.resolutionSource, 'manual_worthless_confirmation');
  assert.equal(edited.expirationClosePrice, undefined);

  const corrected = resolveExpiredTradeWithClose(edited, 45, edited.expiration, 'manual_expiration_close', undefined, '2026-09-02T12:00:00Z');
  assert.deepEqual(
    [corrected.resolutionType, corrected.resolutionSource, corrected.expirationClosePrice, corrected.finalOptionValue],
    ['expired_itm', 'manual_expiration_close', 45, 1_000],
    'an explicit later expiration close reuses the canonical resolver and replaces the attestation safely',
  );
  assert.ok(Math.abs(historyRealizedPnl(corrected) - -753.1) < 1e-12);
});

test('realized edits reconcile every dependent value and survive serialization without stale snapshots', () => {
  const existing = normalizePortfolioTrade({
    ...historicalInput({ status: 'closed', closePrice: 0.5, closeDate: '2025-06-10' }),
    id: 'realized-edit', createdAt: '2025-05-01T12:00:00Z', updatedAt: '2025-06-10T12:00:00Z',
    premiumCollected: 100, realizedPnl: 0, percentCaptured: 0, daysHeld: 1,
    entryDelta: -0.2, entryDeltaSource: 'provider', entryDeltaCapturedAt: '2025-05-01T15:00:00Z',
  });
  assert.ok(existing);
  const edited = prepareManualTradeForSave({
    ...historicalInput({ soldPrice: 2.3456, closePrice: 0.5, closeDate: '2025-06-10' }),
    entryDelta: -0.31, entryDeltaSource: 'manual', entryDeltaCapturedAt: '2026-08-30T12:00:00Z',
  }, existing, { mode: 'historical', historicalOutcome: 'closed' }, '2026-08-30T12:00:00Z').trade;
  assert.equal(edited.soldPrice, 2.3456, 'four-decimal Sold Price remains canonical');
  assert.equal(edited.premiumCollected, 469.12);
  assert.equal(edited.realizedPnl, 369.12);
  assert.equal(historyPremium(edited), 469.12);
  assert.equal(historyRealizedPnl(edited), 369.12);
  assert.deepEqual([edited.entryDelta, edited.entryDeltaSource], [-0.31, 'manual']);
  const analytics = buildHistoryAnalytics([edited]);
  const group = buildHistoryGroups([edited], 'expiration')[0];
  assert.equal(analytics.premiumCollected, 469.12);
  assert.equal(analytics.realizedPnl, 369.12);
  assert.equal(group.premium, 469.12);
  assert.equal(group.realizedPnl, 369.12);
  assert.notEqual(historyRealizedIrr(edited), null);

  class MemoryStorage {
    constructor() { this.values = new Map(); }
    getItem(key) { return this.values.get(key) ?? null; }
    setItem(key, value) { this.values.set(key, String(value)); }
    removeItem(key) { this.values.delete(key); }
  }
  const storage = new MemoryStorage();
  assert.equal(writePortfolioTrades(storage, [edited]).status, 'ok');
  const reloaded = readPortfolioTrades(storage).data[0];
  assert.deepEqual(
    [reloaded.soldPrice, reloaded.premiumCollected, reloaded.realizedPnl, reloaded.entryDelta, reloaded.entryDeltaSource],
    [2.3456, 469.12, 369.12, -0.31, 'manual'],
  );
});

test('historical identity edits invalidate dependent snapshots while unrelated edits remain request-free', () => {
  const existing = resolveExpiredTradeWithClose(trade({
    id: 'held-edit', ticker: 'TQQQ', expiration: '2025-06-20', soldDate: '2025-05-01', status: 'open',
    entryDelta: -0.25, entryDeltaSource: 'provider', entryDeltaCapturedAt: '2025-05-01T15:00:00Z',
    entryVixClose: 20, entryVixDate: '2025-05-01', entryVixSource: 'historical_close',
    entrySnapshot: { underlyingPrice: 70, delta: -0.25 },
  }), 55, '2025-06-20', 'expiration_close');
  const noteAndManualDelta = prepareManualTradeForSave({
    ...existing, notes: 'corrected', entryDelta: -0.3, entryDeltaSource: 'manual', entryDeltaCapturedAt: '2026-08-30T12:00:00Z',
  }, existing, { mode: 'historical', historicalOutcome: 'held_to_expiration' });
  assert.equal(noteAndManualDelta.needsExpirationLookup, false);
  assert.equal(noteAndManualDelta.trade.entryDelta, -0.3);
  const legacyEconomicEdit = prepareManualTradeForSave({ ...existing, soldPrice: 2.5 }, existing, { mode: 'historical', historicalOutcome: 'held_to_expiration' });
  assert.equal(legacyEconomicEdit.needsExpirationLookup, true, 'an old expiration close is not reused for changed economics without basis provenance');

  const identityEdit = prepareManualTradeForSave({ ...existing, ticker: 'SOXL' }, existing, { mode: 'historical', historicalOutcome: 'held_to_expiration' });
  assert.equal(identityEdit.needsExpirationLookup, true);
  assert.equal(identityEdit.trade.entrySnapshot, undefined);
  assert.equal(identityEdit.trade.latestMarketData, undefined);
  assert.equal(identityEdit.trade.entryDelta, undefined, 'automatic contract Delta is invalidated with contract identity');
  assert.equal(identityEdit.trade.expirationClosePrice, undefined);
  assert.equal(identityEdit.trade.realizedPnl, undefined);
});

test('confirmed assignment preserves established economics and resolution date without inventing stock accounting', () => {
  const existing = trade({
    id: 'assigned-edit', status: 'assigned', resolvedDate: '2026-06-21', realizedPnl: -500,
    premiumCollected: 400, percentCaptured: -1.25, daysHeld: 157,
  });
  const edited = prepareManualTradeForSave({ ...existing, notes: 'broker-confirmed assignment' }, existing, { mode: 'historical', historicalOutcome: 'assigned' }).trade;
  assert.equal(edited.status, 'assigned');
  assert.equal(edited.resolvedDate, '2026-06-21');
  assert.equal(edited.realizedPnl, -500);
  assert.equal(edited.closePrice, undefined);
});

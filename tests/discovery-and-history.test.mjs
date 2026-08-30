import test from 'node:test';
import assert from 'node:assert/strict';
import { passesScannerLiquidityFilter, sortScannerEtfs } from '../src/lib/scannerDiscovery.ts';
import {
  buildHistoryAnalytics,
  buildHistoryGroups,
  buildHistoryRealizedCashFlows,
  buildMonthlyRealizedPnl,
  calculateHistoryTotalRealizedIrr,
  calculateHistoryWeightedEntryDelta,
  calculateTotalHistoricalNotional,
  calculateXirr,
  filterHistoryTrades,
  historyDaysHeld,
  historyEntryNominalYield,
  historyEntryVix,
  historyFinalValue,
  historyPriceAtExpiration,
  historyRealizedIrr,
  historyRealizedPnl,
} from '../src/lib/portfolioHistoryAnalytics.ts';

const etfs = ['BBB', 'AAA', 'CCC'].map(ticker => ({ ticker, name: ticker, leverage: '3x', underlying: ticker, type: 'Sector' }));
const snapshot = (label, score, iv) => ({ liquidityLabel: label, liquidityScore: score, atmPutIv: iv });

test('Scanner IV and liquidity sorting is deterministic and keeps unavailable values last', () => {
  const snapshots = { AAA: snapshot('liquid', 72, 80), BBB: snapshot('liquid', 85, 60) };
  assert.deepEqual(sortScannerEtfs(etfs, 'iv60', {}, snapshots).map(etf => etf.ticker), ['AAA', 'BBB', 'CCC']);
  assert.deepEqual(sortScannerEtfs(etfs, 'liquidity', {}, snapshots).map(etf => etf.ticker), ['BBB', 'AAA', 'CCC']);
});

test('Scanner return, drawdown, and price sorts use cached card fields only', () => {
  const prices = {
    AAA: { price: 20, fiveDay: 0.1, oneMonth: 0.2, threeMonth: -0.1, fiftyTwoWeekHighPct: -5 },
    BBB: { price: 10, fiveDay: 0.2, oneMonth: -0.1, threeMonth: 0.3, fiftyTwoWeekHighPct: -30 },
  };
  assert.deepEqual(sortScannerEtfs(etfs, 'fiveDay', prices, {}).map(etf => etf.ticker), ['BBB', 'AAA', 'CCC']);
  assert.deepEqual(sortScannerEtfs(etfs, 'drawdown52w', prices, {}).map(etf => etf.ticker), ['BBB', 'AAA', 'CCC']);
  assert.deepEqual(sortScannerEtfs(etfs, 'priceLow', prices, {}).map(etf => etf.ticker), ['BBB', 'AAA', 'CCC']);
});

test('Scanner liquidity filters use the requested Medium+ and Liquid+ thresholds without side effects', () => {
  assert.equal(passesScannerLiquidityFilter(snapshot('medium', 50, 40), 'mediumPlus'), true);
  assert.equal(passesScannerLiquidityFilter(snapshot('medium', 50, 40), 'liquidPlus'), false);
  assert.equal(passesScannerLiquidityFilter(snapshot('very_liquid', 90, 40), 'liquidPlus'), true);
  assert.equal(passesScannerLiquidityFilter(null, 'mediumPlus'), false);
});

const trade = (overrides = {}) => ({
  id: 't', ticker: 'TST', optionType: 'put', strike: 50, expiration: '2026-08-21', contracts: 1,
  soldPrice: 2, soldDate: '2026-07-01', status: 'expired', resolutionType: 'expired_worthless',
  resolvedDate: '2026-08-22', createdAt: '2026-07-01T00:00:00Z', updatedAt: '2026-08-22T00:00:00Z', ...overrides,
});

test('history analytics excludes pending records and reconciles blended capture by premium', () => {
  const worthless = trade({ id: 'worthless' });
  const closed = trade({ id: 'closed', status: 'closed', resolutionType: undefined, closePrice: 1, closeDate: '2026-08-10', soldPrice: 3, contracts: 2 });
  const itm = trade({ id: 'itm', resolutionType: 'expired_itm', realizedPnl: -100, premiumCollected: 200 });
  const pending = trade({ id: 'pending', status: 'expired_price_pending', resolutionType: 'expired_price_pending' });
  const analytics = buildHistoryAnalytics([worthless, closed, itm, pending]);
  assert.equal(historyRealizedPnl(worthless), 200);
  assert.equal(historyRealizedPnl(closed), 400);
  assert.equal(analytics.realizedPnl, 500);
  assert.equal(analytics.premiumCollected, 1_000);
  assert.equal(analytics.blendedCapture, 0.5);
  assert.equal(analytics.resolvedTrades, 3);
  assert.equal(filterHistoryTrades([worthless, closed, itm], 'closed').length, 1);
});

test('history days held excludes missing dates and monthly P&L groups by resolution month', () => {
  const august = trade({ id: 'august' });
  const september = trade({ id: 'september', status: 'closed', resolutionType: undefined, closeDate: '2026-09-05', closePrice: 1 });
  assert.equal(historyDaysHeld(august), 52);
  assert.equal(historyDaysHeld(trade({ soldDate: '' })), null);
  const months = buildMonthlyRealizedPnl([august, september]);
  assert.deepEqual(months.map(month => month.month), ['2026-08', '2026-09']);
  assert.deepEqual(months.map(month => month.trades), [1, 1]);
});

test('realized IRR compounds realized return on net risk over actual calendar days', () => {
  const winner = trade({ soldDate: '2026-01-01', closeDate: '2027-01-01', daysHeld: 7, status: 'closed', resolutionType: undefined, closePrice: 1 });
  const expected = Math.pow(1 + 100 / 4_800, 365.25 / 365) - 1;
  assert.ok(Math.abs(historyRealizedIrr(winner) - expected) < 1e-12);
  assert.equal(historyRealizedIrr(trade({ daysHeld: 365, realizedPnl: -4_800 })), -1);
  assert.equal(historyRealizedIrr(trade({ daysHeld: 365, realizedPnl: -5_000 })), null);
  assert.equal(historyRealizedIrr(trade({ soldDate: '2026-08-21', resolvedDate: '2026-08-21', daysHeld: 99 })), null);
  assert.equal(historyRealizedIrr(trade({ soldDate: '' })), null);
});

test('Total Realized IRR is one combined date-aware money-weighted return, not averaged position IRRs', () => {
  const first = trade({ id: 'first', soldDate: '2026-01-01', closeDate: '2027-01-01', status: 'closed', resolutionType: undefined, closePrice: 1 });
  const second = trade({ id: 'second', strike: 100, soldDate: '2026-07-01', closeDate: '2027-03-01', status: 'closed', resolutionType: undefined, soldPrice: 4, closePrice: 5 });
  const trades = [first, second];
  const cashFlows = buildHistoryRealizedCashFlows(trades);
  const combined = calculateHistoryTotalRealizedIrr(trades);
  assert.ok(cashFlows && combined != null);
  assert.ok(Math.abs(calculateHistoryTotalRealizedIrr([first]) - historyRealizedIrr(first)) < 1e-9, 'one closed position reconciles to its individual realized IRR');
  const origin = Date.parse(`${cashFlows[0].date}T00:00:00Z`);
  const npv = cashFlows.reduce((sum, flow) => sum + flow.amount / Math.pow(1 + combined, (Date.parse(`${flow.date}T00:00:00Z`) - origin) / 86_400_000 / 365.25), 0);
  assert.ok(Math.abs(npv) < 1e-5, 'the combined result zeroes the aggregate dated cash flows');
  const weightedAverage = (historyRealizedIrr(first) * 4_800 + historyRealizedIrr(second) * 9_600) / 14_400;
  assert.ok(Math.abs(combined - weightedAverage) > 1e-4, 'it is not a net-risk weighted average of individual IRRs');
});

test('realized XIRR handles expiry, early close, loss, years, and undefined/non-unique cases', () => {
  const expiry = trade({ id: 'expiry', soldDate: '2024-01-01', expiration: '2026-01-01', resolvedDate: '2026-01-01' });
  const earlyLoss = trade({ id: 'loss', status: 'closed', resolutionType: undefined, soldDate: '2025-06-01', closeDate: '2025-08-01', closePrice: 3 });
  const assigned = trade({ id: 'assigned', status: 'assigned', resolutionType: undefined, soldDate: '2025-09-01', resolvedDate: '2026-01-01', realizedPnl: -500 });
  assert.ok(calculateHistoryTotalRealizedIrr([expiry, earlyLoss, assigned]) != null);
  assert.equal(calculateHistoryTotalRealizedIrr([]), null);
  assert.equal(calculateHistoryTotalRealizedIrr([trade({ soldDate: '2026-08-21', resolvedDate: '2026-08-21' })]), null);
  assert.equal(calculateXirr([
    { date: '2025-01-01', amount: -100 },
    { date: '2026-01-01', amount: 230 },
    { date: '2027-01-01', amount: -132 },
  ]), null, 'multiple real roots fail closed');
  assert.equal(calculateXirr([{ date: '2025-01-01', amount: -100 }, { date: '2026-01-01', amount: -50 }]), null, 'no positive return flow is undefined');
});

test('History Entry Delta uses signed Gross Risk weighting and reports notional coverage', () => {
  const items = [
    trade({ id: 'small', strike: 50, entryDelta: -0.2 }),
    trade({ id: 'large', strike: 100, contracts: 2, entryDelta: -0.4 }),
    trade({ id: 'zero', strike: 25, entryDelta: 0 }),
    trade({ id: 'unknown', strike: 100, entryDelta: undefined }),
  ];
  const weighted = calculateHistoryWeightedEntryDelta(items);
  assert.equal(weighted.value, (-0.2 * 5_000 + -0.4 * 20_000) / 27_500);
  assert.equal(weighted.coverage, 27_500 / 37_500);
  assert.equal(calculateTotalHistoricalNotional(items), 37_500);
  assert.equal(calculateHistoryWeightedEntryDelta([items[3]]).value, null);
});

test('History grouping uses expiration year and canonical group P&L with deterministic fallbacks', () => {
  const trades = [
    trade({ id: 'a', ticker: 'AAA', expiration: '2027-05-21', realizedPnl: 100 }),
    trade({ id: 'b', ticker: 'BBB', expiration: '2027-12-17', realizedPnl: -25 }),
    trade({ id: 'c', ticker: 'AAA', expiration: '2026-09-18', realizedPnl: 50 }),
    trade({ id: 'bad', ticker: 'CCC', expiration: 'bad-date', realizedPnl: 10 }),
  ];
  const years = buildHistoryGroups(trades, 'year');
  assert.deepEqual(years.map(group => group.label), ['2027', '2026', 'Unknown']);
  assert.equal(years[0].realizedPnl, 75);
  assert.equal(years[0].tradeCount, 2);
  assert.deepEqual(buildHistoryGroups(trades, 'expiration').map(group => group.label), ['2027-12-17', '2027-05-21', '2026-09-18', 'Unknown']);
  assert.deepEqual(buildHistoryGroups(trades, 'underlying').map(group => group.label), ['AAA', 'BBB', 'CCC']);
  assert.deepEqual(buildHistoryGroups(trades, 'none').map(group => group.label), ['All History']);
});

test('History data helpers use original entry economics and stored snapshots only', () => {
  const item = trade({ entryVixClose: 21.5, expirationClosePrice: 48, finalOptionValue: 200 });
  assert.equal(historyEntryNominalYield(item), 200 / 4_800);
  assert.equal(historyEntryVix(item), 21.5);
  assert.equal(historyPriceAtExpiration(item), 48);
  assert.equal(historyFinalValue(item), 200);
  assert.equal(historyEntryVix(trade({ entryVixClose: undefined, latestMarketData: { vix: 99 } })), null);
  assert.equal(historyPriceAtExpiration(trade({ expirationClosePrice: undefined })), null);
});

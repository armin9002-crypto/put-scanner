import test from 'node:test';
import assert from 'node:assert/strict';
import { passesScannerLiquidityFilter, sortScannerEtfs } from '../src/lib/scannerDiscovery.ts';
import {
  buildHistoryAnalytics,
  buildHistoryGroups,
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

test('monthly realized P&L uses expiration YYYY-MM, including early closes, losses, and distinct years', () => {
  const august = trade({ id: 'august' });
  const earlySeptember = trade({ id: 'early-september', expiration: '2026-09-18', status: 'closed', resolutionType: undefined, closeDate: '2026-05-01', closePrice: 1 });
  const priorYearLoss = trade({ id: 'prior-year-loss', expiration: '2025-09-19', soldDate: '2025-01-01', status: 'closed', resolutionType: undefined, closeDate: '2025-05-01', closePrice: 3 });
  const pending = trade({ id: 'pending', expiration: '2027-09-17', status: 'expired_price_pending', resolutionType: 'expired_price_pending' });
  assert.equal(historyDaysHeld(august), 51, 'held-to-expiration uses the contract expiration, not the later maintenance timestamp');
  assert.equal(historyDaysHeld(trade({ soldDate: '' })), null);
  const months = buildMonthlyRealizedPnl([august, earlySeptember, priorYearLoss, pending, trade({ id: 'invalid-expiry', expiration: 'bad-date' })]);
  assert.deepEqual(months.map(month => month.month), ['2025-09', '2026-08', '2026-09']);
  assert.deepEqual(months.map(month => month.trades), [1, 1, 1]);
  assert.deepEqual(months.map(month => month.realizedPnl), [-100, 200, 100]);
});

test('realized IRR simply annualizes realized P&L on Gross Risk over actual calendar days', () => {
  const winner = trade({ soldDate: '2026-01-01', closeDate: '2027-01-01', daysHeld: 7, status: 'closed', resolutionType: undefined, closePrice: 1 });
  const expected = (100 / 5_000) * (365 / 365);
  assert.ok(Math.abs(historyRealizedIrr(winner) - expected) < 1e-12);
  assert.equal(historyRealizedIrr(trade({ status: 'assigned', resolutionType: undefined, soldDate: '2025-08-21', resolvedDate: '2026-08-21', daysHeld: 365, realizedPnl: -4_800 })), -0.96);
  assert.equal(historyRealizedIrr(trade({ status: 'assigned', resolutionType: undefined, soldDate: '2025-08-21', resolvedDate: '2026-08-21', daysHeld: 365, realizedPnl: -5_000 })), -1);
  assert.equal(historyRealizedIrr(trade({ soldDate: '2026-08-21', resolvedDate: '2026-08-21', daysHeld: 99 })), null);
  assert.equal(historyRealizedIrr(trade({ soldDate: '' })), null);
});

test('Total Realized IRR is the Gross-Risk-weighted average of valid position Realized IRRs', () => {
  const first = trade({ id: 'first', soldDate: '2026-01-01', closeDate: '2027-01-01', status: 'closed', resolutionType: undefined, closePrice: 1 });
  const second = trade({ id: 'second', strike: 100, soldDate: '2026-07-01', closeDate: '2027-03-01', status: 'closed', resolutionType: undefined, soldPrice: 4, closePrice: 5 });
  const trades = [first, second];
  const combined = calculateHistoryTotalRealizedIrr(trades);
  assert.ok(combined != null);
  assert.ok(Math.abs(calculateHistoryTotalRealizedIrr([first]) - historyRealizedIrr(first)) < 1e-9, 'one closed position reconciles to its individual realized IRR');
  const weightedAverage = (historyRealizedIrr(first) * 5_000 + historyRealizedIrr(second) * 10_000) / 15_000;
  assert.ok(Math.abs(combined - weightedAverage) < 1e-12);
});

test('generic XIRR utility remains isolated and handles undefined/non-unique cases', () => {
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
    trade({ id: 'a', ticker: 'AAA', expiration: '2027-05-21', status: 'closed', resolutionType: undefined, closeDate: '2026-08-10', closePrice: 1 }),
    trade({ id: 'b', ticker: 'BBB', expiration: '2027-12-17', status: 'closed', resolutionType: undefined, closeDate: '2026-08-10', closePrice: 2.25 }),
    trade({ id: 'c', ticker: 'AAA', expiration: '2026-09-18', status: 'closed', resolutionType: undefined, closeDate: '2026-08-10', closePrice: 1.5 }),
    trade({ id: 'bad', ticker: 'CCC', expiration: 'bad-date', status: 'closed', resolutionType: undefined, closeDate: '2026-08-10', closePrice: 1.9 }),
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
  assert.equal(historyEntryNominalYield(item), 200 / 5_000);
  assert.equal(historyEntryVix(item), 21.5);
  assert.equal(historyPriceAtExpiration(item), 48);
  assert.equal(historyFinalValue(item), 200);
  assert.equal(historyEntryVix(trade({ entryVixClose: undefined, latestMarketData: { vix: 99 } })), null);
  assert.equal(historyPriceAtExpiration(trade({ expirationClosePrice: undefined })), null);
});

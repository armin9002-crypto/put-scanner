import test from 'node:test';
import assert from 'node:assert/strict';
import { passesScannerLiquidityFilter, sortScannerEtfs } from '../src/lib/scannerDiscovery.ts';
import { buildHistoryAnalytics, buildMonthlyRealizedPnl, filterHistoryTrades, historyDaysHeld, historyRealizedIrr, historyRealizedPnl } from '../src/lib/portfolioHistoryAnalytics.ts';

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

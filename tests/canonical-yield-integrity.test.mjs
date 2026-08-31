import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  calculateAnnualizedYield,
  calculateNominalYield,
  calculateYieldPercent,
} from '../src/lib/optionMetrics.ts';
import {
  calculateCurrentAnnualizedYield,
  calculateCurrentNominalYield,
  calculateEquityAtRisk,
  calculateOriginalAnnualizedYield,
  calculateOriginalNominalYield,
  calculatePortfolioMarkSummary,
  calculatePremiumCollected,
} from '../src/lib/portfolioMetrics.ts';
import {
  buildHistoryGroupAggregates,
  calculateHistoryTotalRealizedIrr,
  historyEntryNominalYield,
  historyGrossRisk,
  historyPremium,
  historyRealizedIrr,
} from '../src/lib/portfolioHistoryAnalytics.ts';
import { applyScreenerFilters, buildScreenerRows } from '../src/lib/screenerRows.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');
const close = (actual, expected, message, tolerance = 1e-12) => {
  assert.ok(actual != null, `${message}: expected a number`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
};
const isoAtUtcOffset = days => {
  const now = new Date();
  const utc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days);
  return new Date(utc).toISOString().slice(0, 10);
};
const portfolioTrade = (overrides = {}) => ({
  id: 'open', ticker: 'TST', optionType: 'put', strike: 55, contracts: 1,
  soldPrice: 0.5, soldDate: isoAtUtcOffset(-11), expiration: isoAtUtcOffset(19), status: 'open',
  latestMarketData: { optionBid: 0.2, optionAsk: 0.25, optionLast: 0.3 },
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  ...overrides,
});
const historyTrade = (overrides = {}) => ({
  id: 'history', ticker: 'TST', optionType: 'put', strike: 50, contracts: 1,
  soldPrice: 2, soldDate: '2026-01-01', expiration: '2026-01-31', status: 'expired',
  resolutionType: 'expired_worthless', resolvedDate: '2026-01-31',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-31T00:00:00Z',
  ...overrides,
});

test('owner screenshot fixtures use sold price or mark divided by strike at full precision', () => {
  const soxl = portfolioTrade({ strike: 30, soldPrice: 0.73326 });
  const tqqq = portfolioTrade({ strike: 40.5, soldPrice: 1.25325 });
  close(calculateOriginalNominalYield(soxl), 0.73326 / 30, 'SOXL Entry NY');
  close(calculateOriginalNominalYield(tqqq), 1.25325 / 40.5, 'TQQQ Entry NY');
  assert.ok(Math.abs(calculateOriginalNominalYield(soxl) - (0.73326 / (30 - 0.73326))) > 1e-4, 'Entry NY never removes Premium from the denominator');

  close(calculateNominalYield(0.25, 55), 0.25 / 55, 'Current NY fixture');
  close(calculateAnnualizedYield(0.25, 55, 19), (0.25 / 55) * 365 / 19, 'Current AY fixture');
});

test('zero is a valid NY/AY input while invalid strike and non-positive annualization days are unavailable', () => {
  assert.equal(calculateNominalYield(0, 50), 0);
  assert.equal(calculateAnnualizedYield(0, 50, 30), 0);
  assert.equal(calculateNominalYield(null, 50), null);
  assert.equal(calculateNominalYield(1, 0), null);
  assert.equal(calculateAnnualizedYield(1, 50, 0), null);
  assert.equal(calculateAnnualizedYield(1, 50, -1), null);
});

test('Entry NY is invariant to contract count and reconciles Premium to Gross Risk', () => {
  const one = portfolioTrade({ strike: 30, soldPrice: 0.73326, contracts: 1 });
  const hundred = portfolioTrade({ strike: 30, soldPrice: 0.73326, contracts: 100 });
  const expected = 0.73326 / 30;
  close(calculatePremiumCollected(one) / calculateEquityAtRisk(one), expected, 'one-contract identity');
  close(calculatePremiumCollected(hundred) / calculateEquityAtRisk(hundred), expected, 'hundred-contract identity');
  assert.equal(calculateOriginalNominalYield(one), calculateOriginalNominalYield(hundred));
});

test('Bid, Ask, and Last Portfolio marks update Current NY and Current AY on the matching price basis', () => {
  const trade = portfolioTrade();
  for (const [basis, mark] of [['bid', 0.2], ['ask', 0.25], ['last', 0.3]]) {
    close(calculateCurrentNominalYield(trade, basis), mark / 55, `${basis} Current NY`);
    close(calculateCurrentAnnualizedYield(trade, basis), (mark / 55) * 365 / 19, `${basis} Current AY`);
  }
});

test('worthless expiration makes Realized IRR identical to Entry AY', () => {
  const worthless = historyTrade({ strike: 30, soldPrice: 0.73326 });
  const entryAy = calculateOriginalAnnualizedYield(worthless);
  const realizedIrr = historyRealizedIrr(worthless);
  close(entryAy, (0.73326 / 30) * 365 / 30, 'Entry AY');
  close(realizedIrr, entryAy, 'worthless-expiration identity');
});

test('early close and losing trade Realized IRR use actual P&L and actual Days Held', () => {
  const earlyClose = historyTrade({
    status: 'closed', resolutionType: undefined, closeDate: '2026-01-11', closePrice: 0.5, contracts: 2,
  });
  close(historyRealizedIrr(earlyClose), (300 / 10_000) * 365 / 10, 'partial-premium early close');
  assert.notEqual(historyRealizedIrr(earlyClose), (400 / 10_000) * 365 / 30, 'original Premium and Original DTE are not substituted');

  const loss = historyTrade({
    status: 'closed', resolutionType: undefined, closeDate: '2026-01-21', closePrice: 3, contracts: 2,
  });
  close(historyRealizedIrr(loss), (-200 / 10_000) * 365 / 20, 'realized loss');
  assert.ok(historyRealizedIrr(loss) < 0);
});

test('History NY and group Wtd. Avg. NY use Gross Risk and reconcile to group Premium divided by group Gross Risk', () => {
  const trades = [
    historyTrade({ id: 'small', strike: 30, soldPrice: 0.73326 }),
    historyTrade({ id: 'large', strike: 40.5, soldPrice: 1.25325, contracts: 2 }),
    historyTrade({ id: 'zero', strike: 20, soldPrice: 0 }),
  ];
  close(historyEntryNominalYield(trades[0]), 0.73326 / 30, 'History row Entry NY');
  const group = buildHistoryGroupAggregates(trades);
  const premium = trades.reduce((sum, trade) => sum + historyPremium(trade), 0);
  const grossRisk = trades.reduce((sum, trade) => sum + historyGrossRisk(trade), 0);
  close(group.weightedAverageNy, premium / grossRisk, 'group Wtd. Avg. NY');
});

test('Portfolio Entry/Current AY headlines and Total Realized IRR use Gross-Risk weighting', () => {
  const open = [
    portfolioTrade({ id: 'a', strike: 50, soldPrice: 1, latestMarketData: { optionBid: 0.1, optionAsk: 0.2, optionLast: 0.15 } }),
    portfolioTrade({ id: 'b', strike: 100, soldPrice: 4, contracts: 2, latestMarketData: { optionBid: 0.5, optionAsk: 0.8, optionLast: 0.6 } }),
  ];
  const summary = calculatePortfolioMarkSummary(open, 'ask');
  const grossRisk = open.map(calculateEquityAtRisk);
  const totalRisk = grossRisk.reduce((sum, value) => sum + value, 0);
  const expectedEntryAy = open.reduce((sum, trade, index) => sum + calculateOriginalAnnualizedYield(trade) * grossRisk[index], 0) / totalRisk;
  const expectedCurrentAy = open.reduce((sum, trade, index) => sum + calculateCurrentAnnualizedYield(trade, 'ask') * grossRisk[index], 0) / totalRisk;
  close(summary.portfolioOriginalAnnualizedYield, expectedEntryAy, 'Entry Wtd. Avg. AY');
  close(summary.portfolioCurrentAnnualizedYield, expectedCurrentAy, 'Current Wtd. Avg. AY');
  close(summary.portfolioOriginalNominalYield, open.reduce((sum, trade) => sum + calculatePremiumCollected(trade), 0) / totalRisk, 'aggregate Entry NY');

  const realized = [
    historyTrade({ id: 'winner', strike: 50, soldPrice: 2 }),
    historyTrade({ id: 'loss', strike: 100, contracts: 2, soldPrice: 2, status: 'closed', resolutionType: undefined, closeDate: '2026-01-16', closePrice: 3 }),
  ];
  const expectedTotal = realized.reduce((sum, trade) => sum + historyRealizedIrr(trade) * historyGrossRisk(trade), 0)
    / realized.reduce((sum, trade) => sum + historyGrossRisk(trade), 0);
  close(calculateHistoryTotalRealizedIrr(realized), expectedTotal, 'Total Realized IRR');
  close(buildHistoryGroupAggregates(realized).weightedAverageRealizedIrr, expectedTotal, 'group Wtd. Avg. Realized IRR');
});

test('Screener display and filter reuse the same canonical Bid/Ask/Last NY/AY row values', () => {
  const expiration = 1_800_576_000;
  const chain = {
    expirations: [{ date: expiration, label: 'Fixture', dte: 19 }],
    currentPrice: 60,
    puts: [{ strike: 55, bid: 0.25, ask: 0.4, last: 0.3, delta: -0.2, impliedVolatility: 40, volume: 20, openInterest: 100 }],
  };
  const row = buildScreenerRows({
    initialResults: new Map([['TST', chain]]),
    chainsByKey: new Map([[`TST:${expiration}`, chain]]),
    ivVsRealizedRangeByTicker: new Map([['TST', 40]]),
  }, 'all').rows[0];
  for (const [basis, price] of [['Bid', 0.25], ['Ask', 0.4], ['Last', 0.3]]) {
    const canonical = calculateYieldPercent(price, 55, 19);
    close(row[`nomYield${basis}`], canonical.nominal, `${basis} displayed NY`);
    close(row[`annYield${basis}`], canonical.annualized, `${basis} displayed AY`);
  }
  const filtered = applyScreenerFilters([row], {
    deltaFilter: 'all', moneynessFilter: 'all', yieldFilter: '5_to_10',
    oiFilter: 'all', volFilter: 'all', ivVsRealizedRangeFilter: 'all',
  });
  assert.deepEqual(filtered, [row], 'AY Bid filter consumes the same unrounded row value that is displayed and sorted');
});

test('Scanner, ticker detail, Option Drawer, Watchlist, Screener, and Portfolio route yield values through canonical helpers', async () => {
  const [options, drawer, watchlist, screener, portfolioMetrics] = await Promise.all([
    read('src/pages/OptionsPage.tsx'),
    read('src/components/OptionDetailDrawer.tsx'),
    read('src/pages/WatchlistPage.tsx'),
    read('src/lib/screenerRows.ts'),
    read('src/lib/portfolioMetrics.ts'),
  ]);
  for (const source of [options, watchlist, screener]) {
    assert.match(source, /calculateYieldPercent\([^\n]*bid/);
    assert.match(source, /calculateYieldPercent\([^\n]*ask/);
    assert.match(source, /calculateYieldPercent\([^\n]*last/);
  }
  assert.match(drawer, /calculateSecuredCashYield\(activeSoldPrice, option\.strike\)/);
  assert.match(drawer, /calculateAnnualizedSecuredCashYield\(activeSoldPrice, option\.strike, dte\)/);
  assert.match(portfolioMetrics, /calculateNominalYield\(trade\.soldPrice, trade\.strike\)/);
  assert.match(portfolioMetrics, /calculateAnnualizedYield\(trade\.soldPrice, trade\.strike, calculateOriginalDte\(trade\)\)/);
});

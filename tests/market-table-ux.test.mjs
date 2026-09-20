import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  annualizedYieldFieldForNominal,
  OPTION_YIELD_DISPLAY_ORDER,
  visibleOptionYieldFields,
} from '../src/lib/optionQuoteDisplay.ts';
import {
  applyScreenerFilters,
  isRecentScreenerTrade,
} from '../src/lib/screenerRows.ts';
import { isUsEquityTradingSession } from '../src/lib/usMarketCalendar.ts';
import { buildWatchlistGroups } from '../src/lib/watchlistPresentation.ts';

function timestampForMarketDate(iso) {
  return Math.floor(Date.parse(`${iso}T15:00:00Z`) / 1000);
}

function sessionDateAgo(current, age) {
  const date = new Date(`${current}T12:00:00Z`);
  let remaining = age;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() - 1);
    if (isUsEquityTradingSession(date)) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

function row(lastTradeDate) {
  return {
    ticker: 'TQQQ',
    currentPrice: 60,
    expDate: 1_800_000_000,
    expLabel: '01/15/27',
    dte: 100,
    strike: 55,
    moneynessPct: 8,
    moneynessLabel: '8.3% OTM',
    moneynessColor: 'var(--green)',
    delta: -0.2,
    bid: 1,
    last: 1,
    lastTradeDate,
    ask: 1.1,
    iv: 50,
    nomYieldBid: 1,
    nomYieldAsk: 1.1,
    nomYieldLast: 1,
    annYieldBid: 3,
    annYieldAsk: 3.3,
    annYieldLast: 3,
    volume: 10,
    openInterest: 100,
    volOI: 0.1,
    ivVsRealizedRange: 40,
  };
}

const allCriteria = { deltaFilter: 'all', moneynessFilter: 'all', yieldFilter: 'all', oiFilter: 'all', volFilter: 'all', ivVsRealizedRangeFilter: 'all' };

test('yield visibility keeps annualized fields primary and remaps nominal sort fields canonically', () => {
  assert.deepEqual(visibleOptionYieldFields(false), ['annYieldLast', 'annYieldBid', 'annYieldAsk']);
  assert.deepEqual(visibleOptionYieldFields(true), OPTION_YIELD_DISPLAY_ORDER);
  assert.equal(annualizedYieldFieldForNominal('nomYieldLast'), 'annYieldLast');
  assert.equal(annualizedYieldFieldForNominal('nomYieldBid'), 'annYieldBid');
  assert.equal(annualizedYieldFieldForNominal('nomYieldAsk'), 'annYieldAsk');
  assert.equal(annualizedYieldFieldForNominal('annYieldBid'), 'annYieldBid');
});

test('recent trades uses exact trading-session age, including weekend and holiday boundaries', () => {
  const current = '2025-07-07';
  assert.equal(isRecentScreenerTrade(row(timestampForMarketDate(current)), current), true);
  assert.equal(isRecentScreenerTrade(row(timestampForMarketDate(sessionDateAgo(current, 15))), current), true);
  assert.equal(isRecentScreenerTrade(row(timestampForMarketDate(sessionDateAgo(current, 16))), current), false);
  assert.equal(isRecentScreenerTrade(row(timestampForMarketDate('2025-07-03')), current), true, 'July 4 holiday is not counted');
  assert.equal(isRecentScreenerTrade(row(timestampForMarketDate('2025-07-03')), '2025-07-07'), true, 'weekend is not counted');
  assert.equal(isRecentScreenerTrade(row(null), current), false);
});

test('recent trades is part of the local screener filter and No restores stale or missing rows', () => {
  const rows = [row(timestampForMarketDate('2025-07-07')), row(null), row(timestampForMarketDate('2025-06-11'))];
  assert.equal(applyScreenerFilters(rows, { ...allCriteria, recentTradesOnly: true }, { currentMarketDate: '2025-07-07' }).length, 1);
  assert.equal(applyScreenerFilters(rows, { ...allCriteria, recentTradesOnly: false }, { currentMarketDate: '2025-07-07' }).length, 3);
});

test('watchlist groups preserve canonical group order and only sort inside groups', () => {
  const rows = [
    { id: 'B-late', ticker: 'B', expiryTimestamp: 2, expiryFormatted: '01/02/27', strike: 90, dte: 10, lastTradeDate: null },
    { id: 'A-high', ticker: 'A', expiryTimestamp: 1, expiryFormatted: '01/01/27', strike: 95, dte: 5, lastTradeDate: 2 },
    { id: 'A-low', ticker: 'A', expiryTimestamp: 1, expiryFormatted: '01/01/27', strike: 90, dte: 20, lastTradeDate: 1 },
  ];
  assert.deepEqual(buildWatchlistGroups(rows, 'underlying').map(group => [group.label, group.rows.map(item => item.id)]), [
    ['A', ['A-low', 'A-high']], ['B', ['B-late']],
  ]);
  assert.deepEqual(buildWatchlistGroups(rows, 'expiry', { field: 'dte', direction: 'asc' }).map(group => [group.label, group.rows.map(item => item.id)]), [
    ['01/01/27', ['A-high', 'A-low']], ['01/02/27', ['B-late']],
  ]);
  const lastTradeSorted = buildWatchlistGroups(rows, 'underlying', { field: 'lastTradeDate', direction: 'desc' });
  assert.deepEqual(lastTradeSorted[0].rows.map(item => item.id), ['A-high', 'A-low']);
  assert.equal(lastTradeSorted[0].rows.at(-1).lastTradeDate, 1);
});

test('watchlist default grouping orders expiry/ticker first and ignores legacy labels for expiry headers', () => {
  const rows = [
    { id: 'TQQQ-late', ticker: 'TQQQ', expiry: '2027-02-19', expiryTimestamp: 2, expiryFormatted: '02/19/27', strike: 80 },
    { id: 'TQQQ-early-high', ticker: 'TQQQ', expiry: '2027-01-15', expiryTimestamp: 1, expiryFormatted: 'Jan 15', strike: 55 },
    { id: 'TQQQ-early-low', ticker: 'TQQQ', expiry: '2027-01-15', expiryTimestamp: 1, expiryFormatted: "Jan 15 '27", strike: 50 },
    { id: 'A-early', ticker: 'A', expiry: '2027-01-15', expiryTimestamp: 1, expiryFormatted: '01/15/27', strike: 40 },
  ];

  assert.deepEqual(buildWatchlistGroups(rows, 'underlying').find(group => group.label === 'TQQQ').rows.map(row => row.id), [
    'TQQQ-early-low', 'TQQQ-early-high', 'TQQQ-late',
  ]);
  assert.deepEqual(buildWatchlistGroups(rows, 'expiry').find(group => group.key === '1').rows.map(row => row.id), [
    'A-early', 'TQQQ-early-low', 'TQQQ-early-high',
  ]);
  assert.equal(buildWatchlistGroups(rows, 'expiry').find(group => group.key === '1').label, "Jan 15 '27");
});

test('changing Watchlist Group By clears explicit sort overrides for canonical grouped ordering', () => {
  const source = readFileSync(new URL('../src/pages/WatchlistPage.tsx', import.meta.url), 'utf8');
  const handler = source.slice(source.indexOf('function handleGroupModeChange'), source.indexOf('function handleSortSelection'));
  assert.match(handler, /setSortOverride\(mode === 'none' \? \{ field: 'dte', direction: 'asc' \} : null\)/);
  assert.match(handler, /setSortField\('dte'\)/);
  assert.match(handler, /setSortDir\('asc'\)/);
});

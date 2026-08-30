import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { canonicalOptionChainKey } from '../src/lib/optionChainRequests.ts';
import { mergePortfolioLifecycleResults, mergePortfolioMarketRefresh } from '../src/lib/portfolioMarketRefresh.ts';
import { PORTFOLIO_CLOSE_POLICY, buildCloseCandidates, getPortfolioAttentionScore } from '../src/lib/portfolioPolicies.ts';
import { readPortfolioTrades, writePortfolioTrades } from '../src/lib/portfolioStorage.ts';
import { buildScreenerRows } from '../src/lib/screenerRows.ts';
import { mergeWatchlistRefreshItems } from '../src/lib/watchlist.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

class MemoryStorage {
  constructor() { this.values = new Map(); }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const isoDaysFromNow = days => {
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today + days * 86_400_000).toISOString().split('T')[0];
};

function chain(ticker, expirations, selectedIndex = 0, dtes = expirations.map((_, index) => index * 7)) {
  return {
    expirations: expirations.map((date, index) => ({ date, label: `${ticker}-${index}`, dte: dtes[index] })),
    currentPrice: 100,
    puts: [{ strike: 90, bid: 2, ask: 2.5, last: 2.2, lastTradeDate: expirations[selectedIndex] - 86_400, delta: -0.2, impliedVolatility: 40, volume: 10, openInterest: 100 }],
  };
}

function portfolioTrade(overrides = {}) {
  return {
    id: 'trade-1', ticker: 'TQQQ', optionType: 'put', strike: 50, expiration: isoDaysFromNow(30), contracts: 1,
    soldPrice: 2, soldDate: isoDaysFromNow(-10), status: 'open', notes: '',
    createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z',
    entrySnapshot: { underlyingPrice: 65 },
    latestMarketData: { underlyingPrice: 65, optionBid: 1, optionAsk: 1.2, optionLast: 1.1, delta: -0.2, refreshedAt: new Date().toISOString(), availabilityStatus: 'live' },
    ...overrides,
  };
}

function watchlistItem(id, overrides = {}) {
  const [ticker = 'TQQQ'] = id.split('|');
  return {
    id, ticker, expiry: '2026-10-16', expiryTimestamp: 1_792_108_800, expiryFormatted: "Oct 16 '26",
    strike: 50, optionType: 'put', addedAt: 1, savedAt: 1, note: '', status: 'saved', ...overrides,
  };
}

test('Screener selects nearest expirations per ticker and preserves truthful 0-DTE semantics', () => {
  const aDates = [1_800_000_000, 1_800_604_800];
  const bDates = [1_801_209_600, 1_801_814_400];
  const aFirst = chain('AAA', aDates, 0, [0, 7]);
  const aSecond = chain('AAA', aDates, 1, [0, 7]);
  const bFirst = chain('BBB', bDates, 0, [14, 21]);
  const bSecond = chain('BBB', bDates, 1, [14, 21]);
  const result = buildScreenerRows({
    initialResults: new Map([['AAA', aFirst], ['BBB', bFirst]]),
    chainsByKey: new Map([
      [canonicalOptionChainKey('AAA', aDates[0]), aFirst],
      [canonicalOptionChainKey('AAA', aDates[1]), aSecond],
      [canonicalOptionChainKey('BBB', bDates[0]), bFirst],
      [canonicalOptionChainKey('BBB', bDates[1]), bSecond],
    ]),
    ivVsRealizedRangeByTicker: new Map([['AAA', 40], ['BBB', 50]]),
  }, 'all');

  assert.deepEqual(result.rows.map(row => `${row.ticker}:${row.expDate}`), [
    `AAA:${aDates[0]}`, `AAA:${aDates[1]}`, `BBB:${bDates[0]}`, `BBB:${bDates[1]}`,
  ]);
  assert.equal(result.rows[0].dte, 0);
  assert.equal(result.rows[0].annYieldBid, null);
  assert.equal(result.rows[0].delta, -0.2, 'provider Delta remains valid at 0 DTE');
});

test('a stale Watchlist refresh cannot resurrect removals or overwrite current durable notes', () => {
  const removed = watchlistItem('TQQQ|put|2026-10-16|50', { note: 'removed' });
  const retained = watchlistItem('SOXL|put|2026-10-16|50', { ticker: 'SOXL', note: 'current note' });
  const addedDuringRefresh = watchlistItem('LABU|put|2026-10-16|50', { ticker: 'LABU', note: 'new' });
  const refreshed = [
    { ...removed, status: 'live', snapshot: { bid: 1 } },
    { ...retained, note: 'stale note', status: 'live', snapshot: { bid: 2 } },
  ];
  const merged = mergeWatchlistRefreshItems([retained, addedDuringRefresh], refreshed);
  assert.deepEqual(merged.map(item => item.id), [retained.id, addedDuringRefresh.id]);
  assert.equal(merged[0].note, 'current note');
  assert.equal(merged[0].snapshot.bid, 2);
  assert.equal(merged[1].note, 'new');
});

test('Portfolio quote reconciliation preserves edits/deletions and writes zero durable revision', () => {
  const removedBaseline = portfolioTrade({ id: 'removed' });
  const retainedBaseline = portfolioTrade({ id: 'retained' });
  const refreshed = [
    { ...removedBaseline, latestMarketData: { ...removedBaseline.latestMarketData, optionBid: 0.7, refreshedAt: new Date(Date.now() + 60_000).toISOString() } },
    { ...retainedBaseline, latestMarketData: { ...retainedBaseline.latestMarketData, optionBid: 0.8, refreshedAt: new Date(Date.now() + 60_000).toISOString() } },
  ];
  const editedCurrent = { ...retainedBaseline, notes: 'edited while refreshing', updatedAt: '2026-08-27T11:00:00.000Z' };
  const addedCurrent = portfolioTrade({ id: 'added', ticker: 'SOXL' });
  const merged = mergePortfolioMarketRefresh([editedCurrent, addedCurrent], refreshed);
  assert.deepEqual(merged.map(trade => trade.id), ['retained', 'added']);
  assert.equal(merged[0].notes, 'edited while refreshing');
  assert.equal(merged[0].latestMarketData.optionBid, 0.8);

  const storage = new MemoryStorage();
  writePortfolioTrades(storage, [editedCurrent, addedCurrent], { now: new Date('2026-08-27T10:00:00.000Z') });
  const before = readPortfolioTrades(storage);
  writePortfolioTrades(storage, merged, { now: new Date('2026-08-27T13:00:00.000Z') });
  const after = readPortfolioTrades(storage);
  assert.equal(after.revision, before.revision);
  assert.equal(after.updatedAt, before.updatedAt);
  assert.equal(after.data[0].latestMarketData.optionBid, 0.8);
});

test('passive Portfolio lifecycle reconciliation never resurrects a deletion or overwrites a durable edit', () => {
  const removed = portfolioTrade({ id: 'removed' });
  const edited = portfolioTrade({ id: 'edited' });
  const resolved = [
    { ...removed, status: 'expired', updatedAt: '2026-08-27T12:00:00.000Z' },
    { ...edited, status: 'expired', updatedAt: '2026-08-27T12:00:00.000Z' },
  ];
  const editedCurrent = { ...edited, strike: 55, updatedAt: '2026-08-27T11:00:00.000Z' };
  const merged = mergePortfolioLifecycleResults([editedCurrent], [removed, edited], resolved);
  assert.deepEqual(merged, [editedCurrent]);
});

test('centralized Portfolio policies preserve exact Close Candidate thresholds and deterministic attention ranking', () => {
  assert.deepEqual(PORTFOLIO_CLOSE_POLICY, {
    highCapture: 0.75,
    standardCapture: 0.5,
    lowAnnualizedRemainingLiability: 0.05,
    smallRemainingOptionMark: 0.05,
    nearExpiryDte: 14,
    nearExpiryBreakevenCushion: 0.2,
  });
  const candidate = portfolioTrade({
    expiration: isoDaysFromNow(10),
    latestMarketData: { underlyingPrice: 65, optionBid: 0.5, optionAsk: 0.6, optionLast: 0.55, delta: -0.15, refreshedAt: new Date().toISOString(), availabilityStatus: 'live' },
  });
  assert.deepEqual(buildCloseCandidates([candidate], 'bid')[0].reasons, ['75%+ captured', 'near expiry with cushion']);

  const threatened = portfolioTrade({ latestMarketData: { underlyingPrice: 45, optionBid: 2, optionAsk: 2.2, optionLast: 2.1, delta: -0.7, refreshedAt: new Date().toISOString(), availabilityStatus: 'live' } });
  const healthy = portfolioTrade({ latestMarketData: { underlyingPrice: 90, optionBid: 1, optionAsk: 1.2, optionLast: 1.1, delta: -0.05, refreshedAt: new Date().toISOString(), availabilityStatus: 'live' } });
  const unavailable = portfolioTrade({ entrySnapshot: undefined, latestMarketData: undefined });
  assert.ok(getPortfolioAttentionScore(threatened) > getPortfolioAttentionScore(unavailable));
  assert.ok(getPortfolioAttentionScore(unavailable) > getPortfolioAttentionScore(healthy));
});

test('page state guards expose retryable failures, supersession, canonical drawer metrics, and quote-only Portfolio refresh', async () => {
  const [scanner, screener, watchlist, portfolio, pulse, drawer] = await Promise.all([
    read('src/pages/HomePage.tsx'),
    read('src/pages/ScreenerPage.tsx'),
    read('src/pages/WatchlistPage.tsx'),
    read('src/pages/PortfolioPage.tsx'),
    read('src/pages/EtfPulsePage.tsx'),
    read('src/components/OptionDetailDrawer.tsx'),
  ]);
  assert.match(scanner, /priceRequestGenerationRef/);
  assert.match(scanner, /if \(timeoutId\) clearTimeout\(timeoutId\)/);
  assert.match(screener, /setLoaded\(false\)/);
  assert.match(screener, /setLoadError/);
  assert.match(screener, /Run Screener to retry/);
  assert.match(watchlist, /Tap refresh to retry/);
  assert.match(watchlist, /refreshInFlightRef\.current/);
  assert.match(watchlist, /refreshGenerationRef\.current/);
  assert.match(pulse, /requestGenerationRef/);
  assert.match(drawer, /Nominal Yield/);
  assert.match(drawer, /Annualized Yield/);
  assert.doesNotMatch(drawer, /Net-Risk Return/);

  const refreshStart = portfolio.indexOf('const handleRefreshOpenTrades');
  const refreshEnd = portfolio.indexOf('const handleRetryResolve', refreshStart);
  const refreshSource = portfolio.slice(refreshStart, refreshEnd);
  assert.doesNotMatch(refreshSource, /archiveExpiredOpenTrades|resolvePortfolioEntryVix/);
  assert.match(refreshSource, /mergePortfolioMarketRefresh/);
  assert.match(refreshSource, /quoteRefreshInFlightRef\.current/);
  assert.match(refreshSource, /quoteRefreshGenerationRef\.current/);
  assert.match(watchlist, /AY Bid/);
  assert.match(screener, /AY Bid/);
});

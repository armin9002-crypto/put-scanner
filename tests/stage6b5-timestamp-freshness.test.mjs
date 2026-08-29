import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canonicalizeMarketTime,
  normalizeMarketTimestamp,
} from '../src/lib/marketTimestamp.ts';
import {
  elapsedUsEquityTradingSessions,
  isUsEquityMarketHoliday,
  isUsEquityTradingSession,
  usEquityMarketHolidayDates,
} from '../src/lib/usMarketCalendar.ts';
import { getPortfolioQuoteFreshness } from '../src/lib/portfolioQuoteFreshness.ts';
import { normalizeOptionChainData } from '../src/lib/yahooOptionAdapter.ts';

const NOW = Date.parse('2026-08-31T16:00:00.000Z');
const trade = (market) => ({
  id: 'timestamp-test', ticker: 'TQQQ', optionType: 'put', strike: 50, expiration: '2026-10-16', contracts: 1,
  soldPrice: 2, soldDate: '2026-08-28', status: 'open', createdAt: '2026-08-28T15:00:00.000Z', updatedAt: '2026-08-28T15:00:00.000Z',
  latestMarketData: market,
});

test('canonical timestamps normalize seconds, milliseconds, ISO values and fail closed', () => {
  assert.equal(normalizeMarketTimestamp(1_756_560_000, { nowMs: NOW }), 1_756_560_000_000);
  assert.equal(normalizeMarketTimestamp(1_756_560_000_000, { nowMs: NOW }), 1_756_560_000_000);
  assert.equal(normalizeMarketTimestamp('2026-08-31T15:00:00.000Z', { nowMs: NOW }), Date.parse('2026-08-31T15:00:00Z'));
  assert.equal(normalizeMarketTimestamp(0, { nowMs: NOW }), null);
  assert.equal(normalizeMarketTimestamp('not-a-date', { nowMs: NOW }), null);
  assert.equal(normalizeMarketTimestamp('2026-02-30', { nowMs: NOW }), null);
  assert.equal(normalizeMarketTimestamp('170000000000000000000', { nowMs: NOW }), null);
  assert.equal(normalizeMarketTimestamp(NOW + 86_400_000, { nowMs: NOW }), null);
  const canonical = canonicalizeMarketTime({ observedAt: NOW - 60_000, providerMarketAt: NOW - 120_000, lastTradeAt: NOW - 300_000, cachedAt: NOW, nowMs: NOW });
  assert.equal(canonical.timestampSource, 'provider_market_time');
  assert.equal(canonical.providerMarketAt, NOW - 120_000);
  assert.equal(canonical.cachedAt, NOW);
});

test('Yahoo provider market time is retained as underlying provenance, never per-contract quote time', () => {
  const providerMs = Date.parse('2026-08-28T15:00:00.000Z');
  const value = normalizeOptionChainData({ optionChain: { result: [{ quote: { regularMarketPrice: 65, regularMarketTime: Math.floor(providerMs / 1000) }, expirationDates: [], options: [{ puts: [{ strike: 50, lastPrice: 1, bid: 0, ask: 1, lastTradeDate: Math.floor((providerMs - 86_400_000) / 1000) }], calls: [] }] }] } }, 'TQQQ', undefined, 'test', 'network', null);
  assert.equal(value.chainMeta?.providerMarketTime, Math.floor(providerMs / 1000));
  assert.equal(value.chainMeta?.timestampSource, 'provider_market_time');
  assert.equal('providerQuoteAt' in value.puts[0], false);
  const invalid = normalizeOptionChainData({ optionChain: { result: [{ quote: { regularMarketPrice: 65, regularMarketTime: Math.floor((Date.now() + 86_400_000) / 1000) }, expirationDates: [], options: [{ puts: [{ strike: 50 }], calls: [] }] }] } }, 'TQQQ', undefined, 'test', 'network', null);
  assert.equal(invalid.chainMeta?.providerMarketTime, null);
});

test('local equity calendar covers weekends, federal closures, Good Friday, Juneteenth and observed dates', () => {
  assert.equal(isUsEquityTradingSession('2026-08-31'), true);
  assert.equal(isUsEquityTradingSession('2026-08-29'), false);
  assert.equal(isUsEquityMarketHoliday('2024-03-29'), true); // Good Friday
  assert.equal(isUsEquityMarketHoliday('2024-05-27'), true); // Memorial Day
  assert.equal(isUsEquityMarketHoliday('2024-06-19'), true); // Juneteenth
  assert.equal(isUsEquityMarketHoliday('2021-06-19'), false); // not a regular closure before 2022
  assert.equal(isUsEquityMarketHoliday('2021-07-05'), true); // Independence observed Monday
  assert.equal(isUsEquityMarketHoliday('2021-12-31'), true); // New Year's Day 2022 observed
  assert.equal(isUsEquityMarketHoliday('2024-11-28'), true); // Thanksgiving
  assert.equal(isUsEquityMarketHoliday('2024-12-25'), true); // Christmas
  assert.equal(usEquityMarketHolidayDates(2026).has('2026-11-26'), true);
  assert.equal(elapsedUsEquityTradingSessions('2024-03-28', '2024-04-01'), 1);
  assert.equal(elapsedUsEquityTradingSessions('2026-08-28', '2026-08-31'), 1);
});

test('Portfolio freshness uses provider market time, ignores cache reads, and separates last trade age', () => {
  const fresh = getPortfolioQuoteFreshness(trade({ underlyingPrice: 65, optionBid: 1, refreshedAt: '2026-08-31T15:00:00Z', providerMarketAt: '2026-08-31T15:30:00Z', cachedAt: '2026-08-31T15:59:00Z', lastTradeDate: '2026-08-20T15:00:00Z', availabilityStatus: 'live' }), new Date(NOW));
  assert.equal(fresh.state, 'fresh');
  assert.equal(fresh.freshnessTimestampSource, 'provider_market_time');
  assert.ok(fresh.lastTradeSessionAge > 1);

  const oldProvider = getPortfolioQuoteFreshness(trade({ underlyingPrice: 65, optionBid: 1, refreshedAt: '2026-08-31T15:00:00Z', providerMarketAt: '2026-08-27T15:00:00Z', cachedAt: '2026-08-31T15:59:00Z', availabilityStatus: 'live' }), new Date(NOW));
  assert.equal(oldProvider.state, 'stale');
  const fallback = getPortfolioQuoteFreshness(trade({ underlyingPrice: 65, optionBid: 1, refreshedAt: '2026-08-31T15:00:00Z', providerMarketAt: 'future', cachedAt: '2026-08-31T15:59:00Z', availabilityStatus: 'live' }), new Date(NOW));
  assert.equal(fallback.state, 'fresh');
  assert.equal(fallback.freshnessTimestampSource, 'observed_at');
  const noObservation = getPortfolioQuoteFreshness(trade({ underlyingPrice: 65, optionBid: 1, cachedAt: '2026-08-31T15:59:00Z', availabilityStatus: 'live' }), new Date(NOW));
  assert.equal(noObservation.state, 'unavailable');
});

test('freshness is quiet over overnight, weekend, holiday and DST date boundaries', () => {
  const friday = getPortfolioQuoteFreshness(trade({ underlyingPrice: 65, refreshedAt: '2026-08-28T20:00:00Z', availabilityStatus: 'live' }), new Date('2026-08-30T18:00:00Z'));
  assert.equal(friday.state, 'fresh');
  const monday = getPortfolioQuoteFreshness(trade({ underlyingPrice: 65, refreshedAt: '2026-08-28T20:00:00Z', availabilityStatus: 'live' }), new Date('2026-08-31T18:00:00Z'));
  assert.equal(monday.state, 'aging');
  const mondayPreOpen = getPortfolioQuoteFreshness(trade({ underlyingPrice: 65, refreshedAt: '2026-08-28T20:00:00Z', availabilityStatus: 'live' }), new Date('2026-08-31T12:00:00Z'));
  assert.equal(mondayPreOpen.state, 'aging');
  const mondayAfterClose = getPortfolioQuoteFreshness(trade({ underlyingPrice: 65, refreshedAt: '2026-08-31T15:00:00Z', availabilityStatus: 'live' }), new Date('2026-08-31T23:00:00Z'));
  assert.equal(mondayAfterClose.state, 'fresh');
  const goodFriday = getPortfolioQuoteFreshness(trade({ underlyingPrice: 65, refreshedAt: '2024-03-28T20:00:00Z', availabilityStatus: 'live' }), new Date('2024-04-01T18:00:00Z'));
  assert.equal(goodFriday.state, 'aging');
  const memorial = getPortfolioQuoteFreshness(trade({ underlyingPrice: 65, refreshedAt: '2024-05-24T20:00:00Z', availabilityStatus: 'live' }), new Date('2024-05-28T18:00:00Z'));
  assert.equal(memorial.state, 'aging');
  const independenceObserved = getPortfolioQuoteFreshness(trade({ underlyingPrice: 65, refreshedAt: '2021-07-02T20:00:00Z', availabilityStatus: 'live' }), new Date('2021-07-06T18:00:00Z'));
  assert.equal(independenceObserved.state, 'aging');
  const dst = getPortfolioQuoteFreshness(trade({ underlyingPrice: 65, refreshedAt: '2026-03-06T20:00:00Z', availabilityStatus: 'live' }), new Date('2026-03-09T18:00:00Z'));
  assert.equal(dst.state, 'aging');
});

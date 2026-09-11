import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { assessPutOptionSurface, trustedOptionPrice } from '../src/lib/optionMarketIntegrity.ts';
import { normalizeOptionChainData } from '../src/lib/yahooOptionAdapter.ts';
import { isValidOptionsChain, OPTIONS_CACHE_SCHEMA_VERSION, primeOptionsMarketDataCache } from '../src/lib/optionChainCache.ts';
import { primeMarketDataCache, requestMarketData } from '../src/lib/marketDataRequest.ts';
import { buildScannerOptionSnapshot } from '../src/lib/scannerOptionSnapshot.ts';
import { buildScreenerRows, applyScreenerFilters } from '../src/lib/screenerRows.ts';
import { retainWatchlistSnapshotAfterInvalidRefresh } from '../src/lib/watchlist.ts';
import { retainPortfolioMarketAfterUntrustedRefresh } from '../src/lib/portfolioMarketRefresh.ts';
import { entrySnapshotFromExactChain } from '../src/lib/portfolioEntryDelta.ts';
import { discoverContractPricing } from '../src/lib/recommendations/pricing.ts';

const EXPIRATION = Math.floor(Date.UTC(2026, 9, 16) / 1_000);

function option(strike, bid, ask, extra = {}) {
  return {
    strike, bid, ask, last: bid, lastTradeDate: 1_780_000_000,
    delta: -0.2, impliedVolatility: 55, volume: 20, openInterest: 200,
    ...extra,
  };
}

function chain(puts, integrity, extraMeta = {}) {
  return {
    expirations: [{ date: EXPIRATION, label: 'Oct 16', dte: 40 }],
    puts,
    currentPrice: 120,
    chainMeta: {
      ticker: 'UPRO', requestedExpiration: EXPIRATION, returnedExpiration: EXPIRATION,
      expirationDate: EXPIRATION, fetchedAt: Date.parse('2026-09-04T15:00:00Z'),
      source: 'network', putCount: puts.length, integrity, ...extraMeta,
    },
  };
}

const dirtyUpro = [
  option(105, 0.70, 4.80), option(106, 0.80, 4.90), option(107, 8.00, 10.20),
  option(108, 8.10, 10.40), option(109, 8.20, 10.50), option(110, 2.90, 3.50),
];

test('UPRO dirty surface keeps raw facts but blocks executable pricing', () => {
  const result = assessPutOptionSurface(dirtyUpro);
  const strike107 = result.puts.find(put => put.strike === 107);
  assert.equal(strike107.bid, 8);
  assert.equal(strike107.integrity.status, 'invalid');
  assert.equal(trustedOptionPrice(strike107, 'bid'), null);
  assert.ok(result.integrity.invalidCount >= 4);
  assert.notEqual(result.integrity.status, 'clean');
});

test('Yahoo normalization attaches canonical integrity without erasing provider evidence', () => {
  const response = { optionChain: { result: [{
    quote: { regularMarketPrice: 120 }, expirationDates: [EXPIRATION],
    options: [{ expirationDate: EXPIRATION, puts: dirtyUpro.map(put => ({
      strike: put.strike, bid: put.bid, ask: put.ask, lastPrice: put.last,
      impliedVolatility: 0.55, volume: put.volume, openInterest: put.openInterest,
    })), calls: [] }],
  }] } };
  const normalized = normalizeOptionChainData(response, 'UPRO', EXPIRATION, 'fixture', 'network', null);
  const strike107 = normalized.puts.find(put => put.strike === 107);
  assert.equal(strike107.rawBid, 8);
  assert.equal(strike107.bid, 8);
  assert.equal(strike107.integrity.status, 'invalid');
  assert.notEqual(normalized.chainMeta.integrity.status, 'clean');
});

test('clean UPRO-like surface has no false invalidation', () => {
  const result = assessPutOptionSurface([
    option(105, 0.70, 0.80), option(106, 0.90, 1.00), option(107, 1.10, 1.20),
    option(108, 1.35, 1.45), option(109, 1.60, 1.75), option(110, 1.90, 2.05),
  ]);
  assert.equal(result.integrity.status, 'clean');
  assert.ok(result.puts.every(put => put.integrity.status === 'clean'));
});

test('localized bad island leaves distant healthy strikes usable', () => {
  const base = Array.from({ length: 25 }, (_, index) => {
    const strike = 90 + index;
    const bid = 0.2 + index * 0.25;
    return option(strike, bid, bid + 0.15);
  });
  base[17] = option(107, 8, 10.2);
  base[18] = option(108, 8.1, 10.4);
  base[19] = option(109, 8.2, 10.5);
  base[20] = option(110, 2.9, 3.5);
  const result = assessPutOptionSurface(base);
  assert.equal(result.integrity.status, 'degraded');
  assert.equal(result.puts.find(put => put.strike === 90).integrity.status, 'clean');
  assert.equal(result.puts.find(put => put.strike === 114).integrity.status, 'clean');
});

test('same-contract crossed market is hard invalid', () => {
  const result = assessPutOptionSurface([option(100, 2.05, 2)]);
  assert.equal(result.puts[0].integrity.status, 'invalid');
  assert.ok(result.puts[0].integrity.reasonCodes.includes('CROSSED_MARKET'));
});

test('zero quote sentinels stay unavailable and do not contaminate executable envelopes', () => {
  const result = assessPutOptionSurface([option(100, 1, 1.1), option(105, 0, 0), option(110, 2, 2.2)]);
  assert.equal(result.integrity.status, 'clean');
  assert.ok(result.puts.every(put => put.integrity.status === 'clean'));
});

test('supplied malformed contract identity is hard invalid', () => {
  const result = assessPutOptionSurface([option(100, 1, 1.1, { contractSymbol: 'UPRO-MALFORMED' })]);
  assert.equal(result.puts[0].integrity.status, 'invalid');
  assert.ok(result.puts[0].integrity.reasonCodes.includes('CONTRACT_IDENTITY_MISMATCH'));
});

test('returned expiration mismatch invalidates the chain and its contracts', () => {
  const result = assessPutOptionSurface([option(100, 1, 1.1)], { requestedExpiration: EXPIRATION, returnedExpiration: EXPIRATION + 86_400 });
  assert.equal(result.integrity.status, 'invalid');
  assert.equal(result.puts[0].integrity.status, 'invalid');
  assert.ok(result.integrity.reasonCodes.includes('CHAIN_EXPIRATION_MISMATCH'));
});

test('put vertical maximum-value violation is hard invalid', () => {
  const result = assessPutOptionSurface([option(100, 0.8, 1), option(105, 7, 7.2)]);
  assert.ok(result.puts.every(put => put.integrity.status === 'invalid'));
  assert.ok(result.integrity.reasonCodes.includes('PUT_VERTICAL_MAX_VALUE'));
});

test('bad fresh chain cannot replace a trusted cache record', async () => {
  const key = `integrity-cache-${Date.now()}-${Math.random()}`;
  const goodAssessment = assessPutOptionSurface([option(100, 1, 1.1), option(105, 2, 2.1)]);
  const badAssessment = assessPutOptionSurface([option(100, 5, 1), option(105, 7, 2)]);
  const good = chain(goodAssessment.puts, goodAssessment.integrity);
  const bad = chain(badAssessment.puts, badAssessment.integrity);
  const originalTime = Date.now() - 1_000;
  const cacheOptions = { key, softTtlMs: 60_000, hardTtlMs: 120_000, schemaVersion: OPTIONS_CACHE_SCHEMA_VERSION, validator: value => isValidOptionsChain(value, EXPIRATION), storage: 'none' };
  assert.equal(primeMarketDataCache(cacheOptions, good, originalTime), true);
  const result = await requestMarketData({ ...cacheOptions, source: 'test', endpoint: 'options', mode: 'revalidate', allowStaleOnError: true, fetcher: async () => bad });
  assert.equal(result.meta.source, 'stale-fallback');
  assert.equal(result.meta.fetchedAt, originalTime);
  assert.equal(result.data.puts[0].bid, 1);
});

test('UNKNOWN non-empty expiration evidence is rejected without poisoning a prior exact-expiry cache record', async () => {
  const key = `expiration-cache-${Date.now()}-${Math.random()}`;
  const assessment = assessPutOptionSurface([option(100, 1, 1.1), option(105, 2, 2.1)]);
  const good = chain(assessment.puts, assessment.integrity, { expirationEvidence: 'match' });
  const unknown = chain(assessment.puts, assessment.integrity, {
    requestedExpiration: null,
    returnedExpiration: null,
    expirationDate: null,
    expirationEvidence: 'unknown',
  });
  const originalTime = Date.now() - 2_000;
  const cacheOptions = { key, softTtlMs: 60_000, hardTtlMs: 120_000, schemaVersion: OPTIONS_CACHE_SCHEMA_VERSION, validator: value => isValidOptionsChain(value, EXPIRATION), storage: 'none' };
  assert.equal(isValidOptionsChain(unknown, EXPIRATION), false);
  assert.equal(primeOptionsMarketDataCache('UPRO', EXPIRATION, unknown), false, 'the requested cache key is not returned-expiration evidence');
  assert.equal(primeMarketDataCache(cacheOptions, good, originalTime), true);
  const result = await requestMarketData({ ...cacheOptions, source: 'test', endpoint: 'options', mode: 'revalidate', allowStaleOnError: true, fetcher: async () => unknown });
  assert.equal(result.meta.source, 'stale-fallback');
  assert.equal(result.meta.fetchedAt, originalTime);
  assert.equal(result.data.chainMeta.expirationEvidence, 'match');
});

test('Watchlist retains prior trusted snapshot and timestamp after invalid refresh', () => {
  const prior = { id: 'UPRO|put|2026-10-16|107', ticker: 'UPRO', expiry: '2026-10-16', expiryTimestamp: EXPIRATION, expiryFormatted: 'Oct 16', strike: 107, optionType: 'put', addedAt: 1, savedAt: 1, updatedAt: 1234, note: '', status: 'live', snapshot: { bid: 1.2, ask: 1.3, annualizedYieldBid: 12 } };
  const next = retainWatchlistSnapshotAfterInvalidRefresh(prior, { underlyingPrice: 120, dte: 40, reasonCodes: ['PUT_EXECUTABLE_MONOTONICITY'] });
  assert.equal(next.snapshot.bid, 1.2);
  assert.equal(next.updatedAt, 1234);
  assert.equal(next.status, 'quote_inconsistent');
});

test('Watchlist without a trusted prior quote remains explicitly invalid and unavailable', () => {
  const prior = { id: 'UPRO|put|2026-10-16|107', ticker: 'UPRO', expiry: '2026-10-16', expiryTimestamp: EXPIRATION, expiryFormatted: 'Oct 16', strike: 107, optionType: 'put', addedAt: 1, savedAt: 1, updatedAt: 1234, note: '', status: 'saved' };
  const next = retainWatchlistSnapshotAfterInvalidRefresh(prior, { underlyingPrice: 120, dte: 40, reasonCodes: ['CROSSED_MARKET'] });
  assert.equal(next.updatedAt, 1234);
  assert.equal(next.snapshot.bid, undefined);
  assert.equal(next.snapshot.integrityStatus, 'invalid');
});

test('Portfolio retains a trusted mark and honest quote time after invalid refresh', () => {
  const trade = { id: 'lot', ticker: 'UPRO', optionType: 'put', strike: 107, expiration: '2026-10-16', contracts: 1, soldPrice: 2, soldDate: '2026-09-04', status: 'open', createdAt: '2026-09-04T14:00:00Z', updatedAt: '2026-09-04T14:00:00Z', latestMarketData: { optionBid: 1.2, optionAsk: 1.3, optionMid: 1.25, refreshedAt: '2026-09-04T15:00:00Z', availabilityStatus: 'live' } };
  const next = retainPortfolioMarketAfterUntrustedRefresh(trade, { attemptedAt: '2026-09-04T16:00:00Z', kind: 'quote_inconsistent', underlyingPrice: 121, dte: 40, reasonCodes: ['PUT_EXECUTABLE_MONOTONICITY'] });
  assert.equal(next.latestMarketData.optionBid, 1.2);
  assert.equal(next.latestMarketData.refreshedAt, '2026-09-04T15:00:00Z');
  assert.equal(next.latestMarketData.availabilityStatus, 'stale');
  assert.equal(next.latestMarketData.optionIntegrityStatus, 'degraded');
  assert.equal(next.latestMarketData.latestRefreshAttemptAt, '2026-09-04T16:00:00Z');
});

test('Portfolio without a trusted prior mark remains unavailable', () => {
  const trade = { id: 'lot', ticker: 'UPRO', optionType: 'put', strike: 107, expiration: '2026-10-16', contracts: 1, soldPrice: 2, soldDate: '2026-09-04', status: 'open', createdAt: 'x', updatedAt: 'x' };
  const next = retainPortfolioMarketAfterUntrustedRefresh(trade, { attemptedAt: '2026-09-04T16:00:00Z', kind: 'quote_inconsistent', underlyingPrice: 121, dte: 40, reasonCodes: ['CROSSED_MARKET'] });
  assert.equal(next.latestMarketData.optionBid, null);
  assert.equal(next.latestMarketData.availabilityStatus, 'unavailable');
  assert.equal(next.latestMarketData.optionIntegrityStatus, 'invalid');
  assert.equal(next.latestMarketData.refreshedAt, undefined);
});

test('invalid exact contract cannot become durable Entry Delta or IV', () => {
  const assessed = assessPutOptionSurface([option(107, 8, 3.5)]);
  const result = entrySnapshotFromExactChain({ ticker: 'UPRO', strike: 107, expiration: '2026-10-16', soldDate: '2026-09-04', status: 'open' }, chain(assessed.puts, assessed.integrity), new Date('2026-09-04T16:00:00Z'));
  assert.equal(result.status, 'unavailable');
  assert.match(result.reason, /inconsistent/i);
});

test('Scanner excludes invalid IV/liquidity observations without removing the ETF', () => {
  const assessed = assessPutOptionSurface([
    option(95, 0.8, 0.9, { impliedVolatility: 50 }),
    option(100, 5, 1, { impliedVolatility: 999 }),
    option(105, 2, 2.2, { impliedVolatility: 52 }),
  ]);
  const snapshot = buildScannerOptionSnapshot('UPRO', chain(assessed.puts, assessed.integrity), { date: EXPIRATION, dte: 40, tier: 'normal', confidence: 'normal' }, new Date('2026-09-04T16:00:00Z'), 100);
  assert.equal(snapshot.ticker, 'UPRO');
  assert.notEqual(snapshot.atmPutIv, 999);
});

test('Screener preserves contract existence but invalid AY cannot pass a yield filter', () => {
  const assessed = assessPutOptionSurface([option(107, 8, 3.5)]);
  const normalizedChain = chain(assessed.puts, assessed.integrity);
  const data = { initialResults: new Map([['UPRO', normalizedChain]]), chainsByKey: new Map([[`UPRO|${EXPIRATION}`, normalizedChain]]), ivVsRealizedRangeByTicker: new Map([['UPRO', 50]]) };
  const rows = buildScreenerRows(data, 'all', { asOf: '2026-09-06T12:00:00Z' }).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bid, 8);
  assert.equal(rows[0].integrityStatus, 'invalid');
  assert.equal(rows[0].annYieldBid, null);
  assert.equal(applyScreenerFilters(rows, { deltaFilter: 'all', moneynessFilter: 'all', yieldFilter: '>5', oiFilter: 'all', volFilter: 'all', ivVsRealizedRangeFilter: 'all' }).length, 0);
});

test('Recommendations consume canonical integrity without changing clean-market policy', () => {
  const assessed = assessPutOptionSurface([option(105, 0.7, 0.8), option(107, 8, 3.5), option(110, 2.9, 3.5)]);
  const pricing = discoverContractPricing({ strike: 107, dte: 40, chain: chain(assessed.puts, assessed.integrity), asOf: '2026-09-04T16:00:00Z' });
  assert.equal(pricing.directBid, null);
  assert.equal(pricing.provenance, 'INSUFFICIENT_PRICING_EVIDENCE');
});

test('84-symbol scale remains bounded and compact', () => {
  const started = performance.now();
  let contracts = 0;
  for (let chainIndex = 0; chainIndex < 252; chainIndex += 1) {
    const puts = Array.from({ length: 36 }, (_, strikeIndex) => option(50 + strikeIndex, 0.1 + strikeIndex * 0.2, 0.2 + strikeIndex * 0.2));
    const result = assessPutOptionSurface(puts);
    contracts += result.integrity.contractCount;
    assert.ok(result.integrity.reasonCodes.length <= 7);
    assert.ok(result.puts.every(put => put.integrity.reasonCodes.length <= 7));
  }
  assert.equal(contracts, 9_072);
  assert.ok(performance.now() - started < 2_000);
});

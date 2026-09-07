import { RejectedOptionChainError, isValidOptionsChain } from '../src/lib/optionChainCache.ts';
import { requestMarketData, peekMarketData } from '../src/lib/marketDataRequest.ts';
import { acquirePortfolioValuationChain, requiresPortfolioLastFallback } from '../src/lib/portfolioMarketRefresh.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { findExactPortfolioPut, portfolioExactLast, retainPortfolioMarketAfterUntrustedRefresh, mergePortfolioMarketRefresh } from '../src/lib/portfolioMarketRefresh.ts';
import { resolvePortfolioMark } from '../src/lib/portfolioValuation.ts';
import { calculateCurrentOptionMark, calculateCurrentPositionValue, calculateUnrealizedPnl, calculatePercentCaptured, calculateCurrentAnnualizedYield, calculatePortfolioMarkSummary } from '../src/lib/portfolioMetrics.ts';
import { getPortfolioQuoteFreshness, isPortfolioQuoteDecisionEligible } from '../src/lib/portfolioQuoteFreshness.ts';
import { assessPortfolioAttention, buildCloseCandidates } from '../src/lib/portfolioPolicies.ts';
import { trustedOptionPrice } from '../src/lib/optionMarketIntegrity.ts';

const now = new Date('2026-09-07T16:00:00Z');
const old = '2024-01-03T15:00:00Z';
const lastTradeDate = Date.parse(old) / 1000;
const trade = { id: 'leap', ticker: 'LABU', optionType: 'put', strike: 40, expiration: '2028-01-21', contracts: 2, soldPrice: 8, soldDate: '2026-01-02', status: 'open', createdAt: old, updatedAt: old };
const put = { strike: 40, last: 5, rawLastPrice: 5, lastTradeDate, bid: 8, ask: 3, delta: -0.4, impliedVolatility: 80, volume: 0, openInterest: 2, integrity: { status: 'invalid', reasonCodes: ['CROSSED_MARKET'] } };
const chain = { puts: [put], currentPrice: 50, expirations: [], chainMeta: { ticker: 'LABU', returnedExpiration: Date.parse('2028-01-21T00:00:00Z') / 1000, fetchedAt: now.getTime() } };
const fallback = () => retainPortfolioMarketAfterUntrustedRefresh(trade, { kind: 'quote_inconsistent', attemptedAt: now.toISOString(), exactLast: portfolioExactLast(findExactPortfolioPut(trade, chain), now.toISOString()), reasonCodes: ['CROSSED_MARKET'] });

test('LEAP A: current selected Bid/Ask/Last retains the normal hierarchy', () => {
  const current = { ...trade, latestMarketData: { optionBid: 4, optionAsk: 6, optionLast: 5, availabilityStatus: 'live' } };
  for (const [basis, value] of [['bid', 4], ['ask', 6], ['last', 5]]) assert.deepEqual(resolvePortfolioMark(current, basis), { value, source: 'selected' });
});

test('LEAP B/C/F: raw exact old Last values Portfolio only, without current Greeks or execution signals', () => {
  const next = fallback();
  for (const basis of ['bid', 'ask', 'last']) {
    assert.deepEqual(resolvePortfolioMark(next, basis), { value: 5, source: 'last_fallback' });
    assert.equal(calculateCurrentOptionMark(next, basis), 5);
    assert.equal(calculateCurrentPositionValue(next, basis), -1000);
    assert.equal(calculateUnrealizedPnl(next, basis), 600);
    assert.equal(calculatePercentCaptured(next, basis), 0.375);
    assert.ok(calculateCurrentAnnualizedYield(next, basis) > 0);
    const totals = calculatePortfolioMarkSummary([next], basis);
    assert.equal(totals.totalCurrentValue, -1000);
    assert.equal(totals.totalGainLoss, 600);
    assert.deepEqual(buildCloseCandidates([next], basis, now), []);
  }
  assert.equal(next.latestMarketData.lastTradeDate, lastTradeDate);
  assert.equal(next.updatedAt, old);
  for (const field of ['delta', 'iv', 'volume', 'openInterest', 'optionBid', 'optionAsk']) assert.equal(next.latestMarketData[field], null);
  assert.equal(getPortfolioQuoteFreshness(next, now).label, 'Stale Last');
  assert.equal(isPortfolioQuoteDecisionEligible(next, now), false);
  assert.equal(assessPortfolioAttention(next, now).needsFreshQuote, true);
  assert.equal(trustedOptionPrice(put, 'last'), null);
});

test('LEAP D: absent contract and provider failure retain original Last provenance', () => {
  const previous = fallback();
  for (const kind of ['unavailable', 'refresh_failed']) {
    const next = retainPortfolioMarketAfterUntrustedRefresh(previous, { kind, attemptedAt: '2026-09-08T16:00:00Z' });
    assert.equal(calculateCurrentOptionMark(next, 'bid'), 5);
    assert.equal(next.latestMarketData.lastTradeDate, lastTradeDate);
    assert.equal(next.latestMarketData.refreshedAt, previous.latestMarketData.refreshedAt);
    assert.equal(next.latestMarketData.lastObservedAt, previous.latestMarketData.lastObservedAt);
  }
  assert.deepEqual(mergePortfolioMarketRefresh([], [previous]), []);
  const edited = { ...trade, strike: 41 };
  assert.equal(mergePortfolioMarketRefresh([edited], [previous])[0], edited);
});

test('LEAP E: never synthesize Last from entry, another contract, zero, or nonfinite data', () => {
  for (const price of [0, -5, NaN, Infinity, null]) assert.equal(portfolioExactLast({ ...put, last: price, rawLastPrice: price }, old), undefined);
  const next = retainPortfolioMarketAfterUntrustedRefresh({ ...trade, entrySnapshot: { last: 5 } }, { kind: 'unavailable', attemptedAt: now.toISOString() });
  assert.equal(calculateCurrentOptionMark(next, 'bid'), null);
  for (const candidate of [{ ...chain, chainMeta: { ...chain.chainMeta, ticker: 'SPY' } }, { ...chain, chainMeta: { ...chain.chainMeta, returnedExpiration: 1 } }, { ...chain, puts: [{ ...put, strike: 40.001 }] }, { ...chain, puts: [{ ...put, contractSymbol: 'LABU280121C00040000' }] }]) assert.equal(findExactPortfolioPut(trade, candidate), null);
  assert.equal(findExactPortfolioPut(trade, { ...chain, puts: [{ ...put, contractSymbol: 'LABU280121P00040000' }] }).last, 5);
});

test('whole-chain rejection exposes already acquired Last only to Portfolio, with one request and no invalid cache write', async () => {
  const rejected = { ...chain, chainMeta: { ...chain.chainMeta, integrity: { status: 'invalid' } } };
  const options = { key: 'test-portfolio-rejected-chain', endpoint: 'options', source: 'test', mode: 'revalidate', softTtlMs: 1000, hardTtlMs: 10000, schemaVersion: 5, validator: isValidOptionsChain };
  let requests = 0;
  const acquire = () => requestMarketData({ ...options, fetcher: async () => { requests++; await Promise.resolve(); throw new RejectedOptionChainError(rejected); } }).then(result => result.data);
  const [portfolio, strict] = await Promise.allSettled([acquirePortfolioValuationChain(acquire), acquire()]);
  assert.equal(portfolio.status, 'fulfilled');
  assert.equal(portfolio.value, rejected);
  assert.equal(strict.status, 'rejected');
  assert.equal(requests, 1);
  assert.equal(peekMarketData(options), null);
  assert.equal(isValidOptionsChain(rejected), false);
});

test('retained Last observation age never defeats newer refresh reconciliation', () => {
  const previous = { ...trade, latestMarketData: { optionLast: 5, lastFallbackOnly: true, lastTradeDate, lastObservedAt: old, refreshedAt: now.toISOString(), availabilityStatus: 'stale' } };
  const next = retainPortfolioMarketAfterUntrustedRefresh(previous, { kind: 'unavailable', attemptedAt: '2026-09-08T16:00:00Z' });
  const merged = mergePortfolioMarketRefresh([previous], [next])[0];
  assert.equal(merged.latestMarketData.lastObservedAt, old);
  assert.equal(merged.latestMarketData.lastTradeDate, lastTradeDate);
  assert.equal(merged.latestMarketData.latestRefreshAttemptAt, '2026-09-08T16:00:00Z');
});

test('recent trusted Last remains normal; old or undated Last without quotes is fallback-only', () => {
  const unquoted = { ...put, bid: null, ask: null, integrity: { status: 'clean' } };
  assert.equal(requiresPortfolioLastFallback(unquoted, now), true);
  assert.equal(requiresPortfolioLastFallback({ ...unquoted, lastTradeDate: null }, now), true);
  assert.equal(requiresPortfolioLastFallback({ ...unquoted, lastTradeDate: now.getTime() / 1000 }, now), false);
  assert.equal(requiresPortfolioLastFallback({ ...unquoted, bid: 4, ask: 6 }, now), false);
});

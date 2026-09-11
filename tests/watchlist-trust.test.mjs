import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getOptionChainExpirationEvidence,
} from '../src/lib/optionExpiryNavigation.ts';
import { normalizeOptionChainData } from '../src/lib/yahooOptionAdapter.ts';
import { acquireOptionChains } from '../src/lib/optionChainRequests.ts';
import { CALCULATED_PUT_DELTA_MODEL } from '../src/lib/putDelta.ts';
import { makeWatchlistId } from '../src/lib/watchlist.ts';
import { isWatchlistRefreshCurrent, mergeWatchlistRefreshItem } from '../src/lib/watchlistRefresh.ts';
import { normalLiquidResponse } from './fixtures/yahoo-options.mjs';

const EXPIRATION = Math.floor(Date.parse('2027-01-15T00:00:00Z') / 1_000);
const OTHER_EXPIRATION = Math.floor(Date.parse('2027-01-22T00:00:00Z') / 1_000);
const OBSERVED_AT = Date.parse('2026-09-09T15:00:00Z');

function item(snapshot) {
  return {
    id: makeWatchlistId('TQQQ', '2027-01-15', 50),
    ticker: 'TQQQ',
    expiry: '2027-01-15',
    expiryTimestamp: EXPIRATION,
    expiryFormatted: "Jan 15 '27",
    strike: 50,
    optionType: 'put',
    addedAt: Date.parse('2026-09-01T12:00:00Z'),
    savedAt: Date.parse('2026-09-01T12:00:00Z'),
    note: 'keep this note',
    ...(snapshot ? { snapshot } : {}),
  };
}

function snapshot() {
  return {
    underlyingPrice: 100,
    bid: 2,
    ask: 2.2,
    last: 2.1,
    lastTradeDate: OBSERVED_AT / 1_000,
    delta: -0.2,
    deltaSource: 'provider',
    deltaModelVersion: null,
    iv: 40,
    observedAt: OBSERVED_AT,
    evidenceFreshness: 'current',
    evidenceSource: 'network',
    integrityStatus: 'clean',
  };
}

function put(overrides = {}) {
  return {
    strike: 50,
    last: 2.1,
    lastTradeDate: OBSERVED_AT / 1_000,
    bid: 2,
    ask: 2.2,
    delta: -0.2,
    impliedVolatility: 40,
    volume: 10,
    openInterest: 100,
    contractSymbol: null,
    integrity: { status: 'clean', reasonCodes: [] },
    ...overrides,
  };
}

function chain({ meta = {}, contract = put() } = {}) {
  return {
    expirations: [{ date: EXPIRATION, label: "Jan 15 '27", dte: 128 }],
    puts: [contract],
    currentPrice: 100,
    chainMeta: {
      ticker: 'TQQQ',
      requestedExpiration: EXPIRATION,
      returnedExpiration: EXPIRATION,
      expirationDate: EXPIRATION,
      expirationEvidence: 'match',
      fetchedAt: Date.parse('2026-09-09T16:00:00Z'),
      source: 'network',
      putCount: 1,
      ...meta,
    },
  };
}

test('expiration evidence has strict MATCH, MISMATCH, and UNKNOWN states', () => {
  assert.equal(getOptionChainExpirationEvidence({ returnedExpiration: EXPIRATION }, EXPIRATION), 'match');
  assert.equal(getOptionChainExpirationEvidence({ returnedExpiration: OTHER_EXPIRATION }, EXPIRATION), 'mismatch');
  assert.equal(getOptionChainExpirationEvidence({ requestedExpiration: EXPIRATION }, EXPIRATION), 'unknown');
  assert.equal(getOptionChainExpirationEvidence({ returnedExpiration: EXPIRATION, expirationDate: OTHER_EXPIRATION }, EXPIRATION), 'mismatch');
  assert.equal(getOptionChainExpirationEvidence({}, EXPIRATION, [EXPIRATION, EXPIRATION]), 'match');
  assert.equal(getOptionChainExpirationEvidence({}, EXPIRATION, [EXPIRATION, null]), 'unknown');
  assert.equal(getOptionChainExpirationEvidence({ expirationEvidence: 'unknown' }, EXPIRATION, [EXPIRATION]), 'match');
});

test('normalization never manufactures returned expiration from the request', () => {
  const response = structuredClone(normalLiquidResponse);
  response.optionChain.result[0].options[0].expirationDate = undefined;
  response.optionChain.result[0].options[0].puts.forEach(contract => { delete contract.contractSymbol; });
  response.optionChain.result[0].options[0].calls.forEach(contract => { delete contract.contractSymbol; });

  const normalized = normalizeOptionChainData(response, 'TQQQ', EXPIRATION, 'watchlist-trust', 'network', null);
  assert.equal(normalized.chainMeta.returnedExpiration, null);
  assert.equal(normalized.chainMeta.expirationDate, null);
  assert.equal(normalized.chainMeta.expirationEvidence, 'unknown');
  assert.equal(getOptionChainExpirationEvidence(normalized.chainMeta, EXPIRATION, normalized.puts.map(contract => contract.contractSymbol)), 'unknown');
});

test('valid exact returned expiration publishes Watchlist economics unchanged', () => {
  const result = mergeWatchlistRefreshItem(item(), chain(), 100, false);
  assert.equal(result.status, 'live');
  assert.equal(result.snapshot.bid, 2);
  assert.equal(result.snapshot.delta, -0.2);
  assert.equal(result.snapshot.deltaSource, 'provider');
  assert.equal(result.snapshot.deltaModelVersion, null);
});

test('Watchlist exact strike selection is order-independent and never chooses the neighboring strike', () => {
  const saved = { ...item(snapshot()), id: makeWatchlistId('TQQQ', '2027-01-15', 100.005), strike: 100.005 };
  const near = put({ strike: 100, bid: 9, contractSymbol: 'TQQQ270115P00100000' });
  const exact = put({ strike: 100.005, bid: 2.5, contractSymbol: 'TQQQ270115P00100005' });
  for (const puts of [[near, exact], [exact, near]]) {
    const data = chain();
    data.puts = puts;
    data.chainMeta.putCount = puts.length;
    const result = mergeWatchlistRefreshItem(saved, data, 100, false);
    assert.equal(result.status, 'live');
    assert.equal(result.snapshot.bid, 2.5);
  }
});

test('Watchlist near-only and inconsistent OCC identities are rejected while the trusted snapshot is retained', () => {
  const prior = snapshot();
  const saved = { ...item(prior), id: makeWatchlistId('TQQQ', '2027-01-15', 100.005), strike: 100.005 };
  const rejectedContracts = [
    put({ strike: 100, bid: 9, contractSymbol: 'TQQQ270115P00100000' }),
    put({ strike: 100.005, bid: 8, contractSymbol: 'SQQQ270115P00100005' }),
    put({ strike: 100.005, bid: 7, contractSymbol: 'TQQQ270115C00100005' }),
    put({ strike: 100.005, bid: 6, contractSymbol: 'TQQQ270122P00100005' }),
  ];
  for (const contract of rejectedContracts) {
    const data = chain({ contract });
    const result = mergeWatchlistRefreshItem(saved, data, 100, false);
    assert.equal(result.status, 'unavailable');
    assert.equal(result.snapshot.bid, prior.bid);
    assert.equal(result.snapshot.observedAt, OBSERVED_AT);
    assert.equal(result.snapshot.evidenceFreshness, 'retained-stale');
  }

  const wrongTickerChain = chain({ meta: { ticker: 'SQQQ' }, contract: put({ strike: 100.005 }) });
  const result = mergeWatchlistRefreshItem(saved, wrongTickerChain, 100, false);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.snapshot.bid, prior.bid);
});

test('an exact canonical contract symbol can prove the saved contract when chain metadata is absent', () => {
  const result = mergeWatchlistRefreshItem(item(), chain({
    meta: { returnedExpiration: null, expirationDate: null, expirationEvidence: 'unknown' },
    contract: put({ contractSymbol: 'TQQQ270115P00050000' }),
  }), 100, false);
  assert.equal(result.status, 'live');
  assert.equal(result.snapshot.bid, 2);
});

test('known mismatch rejects publication and retains the saved contract', () => {
  const prior = snapshot();
  const result = mergeWatchlistRefreshItem(item(prior), chain({
    meta: { returnedExpiration: OTHER_EXPIRATION, expirationDate: OTHER_EXPIRATION, expirationEvidence: 'mismatch' },
  }), 100, false);
  assert.equal(result.id, item().id);
  assert.equal(result.note, 'keep this note');
  assert.equal(result.status, 'refresh_failed');
  assert.equal(result.snapshot.refreshReason, 'expiration_mismatch');
  assert.equal(result.snapshot.bid, prior.bid);
  assert.equal(result.snapshot.observedAt, OBSERVED_AT);
});

test('UNKNOWN expiration rejects publication and retains trusted economics and observation time', () => {
  const prior = snapshot();
  const result = mergeWatchlistRefreshItem(item(prior), chain({
    meta: { returnedExpiration: null, expirationDate: null, expirationEvidence: 'unknown' },
  }), 100, false);
  assert.equal(result.status, 'refresh_failed');
  assert.equal(result.snapshot.refreshReason, 'expiration_unverified');
  assert.equal(result.snapshot.evidenceFreshness, 'retained-stale');
  assert.equal(result.snapshot.bid, prior.bid);
  assert.equal(result.snapshot.ask, prior.ask);
  assert.equal(result.snapshot.last, prior.last);
  assert.equal(result.snapshot.delta, prior.delta);
  assert.equal(result.snapshot.deltaSource, prior.deltaSource);
  assert.equal(result.snapshot.observedAt, OBSERVED_AT);
  assert.equal(result.updatedAt, undefined);
});

test('UNKNOWN expiration leaves a saved contract with unavailable economics when no snapshot exists', () => {
  const result = mergeWatchlistRefreshItem(item(), chain({
    meta: { returnedExpiration: null, expirationDate: null, expirationEvidence: 'unknown' },
  }), 100, false);
  assert.equal(result.status, 'refresh_failed');
  assert.equal(result.note, 'keep this note');
  assert.equal(result.snapshot.evidenceFreshness, 'unavailable');
  assert.equal(result.snapshot.refreshReason, 'expiration_unverified');
  assert.equal(result.snapshot.bid, undefined);
  assert.equal(result.snapshot.ask, undefined);
  assert.equal(result.snapshot.last, undefined);
  assert.equal(result.snapshot.delta, undefined);
});

test('invalid quote evidence cannot poison the prior trusted snapshot', () => {
  const prior = snapshot();
  const result = mergeWatchlistRefreshItem(item(prior), chain({
    contract: put({ bid: 3, ask: 1, integrity: { status: 'invalid', reasonCodes: ['CROSSED_MARKET'] } }),
  }), 100, false);
  assert.equal(result.status, 'quote_inconsistent');
  assert.equal(result.snapshot.bid, prior.bid);
  assert.equal(result.snapshot.ask, prior.ask);
  assert.equal(result.snapshot.observedAt, OBSERVED_AT);
  assert.equal(result.snapshot.deltaSource, 'provider');
});

test('retained calculated Delta keeps its source and model version', () => {
  const prior = { ...snapshot(), delta: -0.31, deltaSource: 'calculated', deltaModelVersion: CALCULATED_PUT_DELTA_MODEL.version };
  const result = mergeWatchlistRefreshItem(item(prior), chain({
    meta: { returnedExpiration: null, expirationDate: null, expirationEvidence: 'unknown' },
  }), 100, false);
  assert.equal(result.snapshot.delta, prior.delta);
  assert.equal(result.snapshot.deltaSource, 'calculated');
  assert.equal(result.snapshot.deltaModelVersion, CALCULATED_PUT_DELTA_MODEL.version);
});

test('calculated and unavailable Delta preserve the canonical source contract', () => {
  const calculated = mergeWatchlistRefreshItem(item(), chain({
    contract: put({ delta: null }),
  }), 100, false);
  assert.equal(calculated.snapshot.deltaSource, 'calculated');
  assert.equal(calculated.snapshot.deltaModelVersion, CALCULATED_PUT_DELTA_MODEL.version);

  const unavailable = mergeWatchlistRefreshItem(item(), chain({
    contract: put({ delta: null, impliedVolatility: null }),
  }), null, false);
  assert.equal(unavailable.snapshot.delta, null);
  assert.equal(unavailable.snapshot.deltaSource, null);
  assert.equal(unavailable.snapshot.deltaModelVersion, null);
});

test('stale generations and aborted refreshes cannot publish', async () => {
  assert.equal(isWatchlistRefreshCurrent(2, 2), true);
  assert.equal(isWatchlistRefreshCurrent(1, 2), false);
  assert.equal(isWatchlistRefreshCurrent(2, 2, { aborted: true }), false);
  assert.equal(isWatchlistRefreshCurrent(1, 2, { aborted: true }), false);

  let currentGeneration = 1;
  const publications = [];
  const refreshA = new Promise(resolve => setTimeout(() => {
    if (isWatchlistRefreshCurrent(1, currentGeneration)) publications.push('A');
    resolve();
  }, 10));
  currentGeneration = 2;
  const refreshB = new Promise(resolve => setTimeout(() => {
    if (isWatchlistRefreshCurrent(2, currentGeneration)) publications.push('B');
    resolve();
  }, 0));
  await Promise.all([refreshA, refreshB]);
  assert.deepEqual(publications, ['B']);
});

test('Watchlist chain acquisition remains deduplicated at the request boundary', async () => {
  let calls = 0;
  const acquired = await acquireOptionChains([
    { ticker: 'TQQQ', expirationTimestamp: EXPIRATION },
    { ticker: 'TQQQ', expirationTimestamp: EXPIRATION },
    { ticker: 'SPY', expirationTimestamp: EXPIRATION },
  ], {
    source: 'Watchlist:test',
    limit: 3,
    fetchChain: async () => {
      calls += 1;
      return chain();
    },
  });
  assert.equal(calls, 2);
  assert.equal(acquired.uniqueCount, 2);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOptionChainData, parseYahooOptionSymbol } from '../src/lib/yahooOptionAdapter.ts';
import { buildScannerOptionSnapshot, rankScannerSnapshotExpirations, selectScannerSnapshotExpiration } from '../src/lib/scannerOptionSnapshot.ts';
import { EXPIRATIONS, malformedResponse, missingFieldsResponse, normalLiquidResponse, oneSidedResponse, sparseResponse, staleTradeResponse, zeroBidResponse } from './fixtures/yahoo-options.mjs';

const NOW = new Date('2026-08-12T12:00:00Z');
const normalize = response => normalizeOptionChainData(response, 'TST', EXPIRATIONS[0], 'fixture', 'network', null);
const candidate = selectScannerSnapshotExpiration(EXPIRATIONS, NOW);

test('normalizes Yahoo units, timestamps, put delta sign, expiration metadata, and deduplicated sorted strikes', () => {
  const raw = structuredClone(normalLiquidResponse);
  raw.optionChain.result[0].options[0].puts.push({ ...raw.optionChain.result[0].options[0].puts[1], bid: null, ask: null, lastTradeDate: 1704067200 });
  const chain = normalize(raw);
  assert.deepEqual(chain.puts.map(put => put.strike), [68, 70, 72, 98, 102]);
  assert.equal(chain.puts[1].impliedVolatility, 48);
  assert.equal(chain.puts[1].delta, -0.2);
  assert.equal(chain.puts[1].lastTradeDate, 1791936000);
  assert.equal(chain.chainMeta.putCount, 5);
  assert.equal(chain.chainMeta.callCount, 1);
  assert.equal(chain.expirations.length, 3);
});

test('preserves valid zero bids while normalizing missing fields to null', () => {
  assert.equal(normalize(zeroBidResponse).puts.find(put => put.strike === 70).bid, 0);
  const missing = normalize(missingFieldsResponse).puts;
  assert.equal(missing[0].volume, null);
  assert.equal(missing[0].lastTradeDate, null);
  assert.equal(missing[1].impliedVolatility, null);
});

test('rejects call symbols from put rows and handles malformed payloads deterministically', () => {
  const parsed = parseYahooOptionSymbol('TST261016C00110000');
  assert.deepEqual(parsed, { expiration: EXPIRATIONS[0], type: 'C', strike: 110 });
  const malformed = normalize(malformedResponse);
  assert.deepEqual(malformed.puts, []);
  assert.equal(malformed.currentPrice, 0);
});

test('selects nearest 60 DTE expiration with stable tier ordering', () => {
  const ranked = rankScannerSnapshotExpirations(EXPIRATIONS, NOW);
  assert.equal(ranked[0].date, EXPIRATIONS[0]);
  assert.equal(ranked[0].dte, 65);
  assert.equal(ranked[0].tier, 'ideal');
});

test('interpolates ATM IV and independently selects the 30% OTM liquidity strike', () => {
  const snapshot = buildScannerOptionSnapshot('TST', normalize(normalLiquidResponse), candidate, NOW);
  assert.equal(snapshot.atmIvMethod, 'interpolated');
  assert.equal(snapshot.atmPutIv, 50);
  assert.equal(snapshot.atmLowerStrike, 98);
  assert.equal(snapshot.atmUpperStrike, 102);
  assert.equal(snapshot.liquidityStrike, 70);
  assert.equal(snapshot.liquidityLabel, 'very_liquid');
});

test('falls back to nearest ATM IV and still evaluates sparse liquidity', () => {
  const snapshot = buildScannerOptionSnapshot('TST', normalize(sparseResponse), candidate, NOW);
  assert.equal(snapshot.atmIvMethod, 'nearest_strike');
  assert.equal(snapshot.atmStrike, 100);
  assert.notEqual(snapshot.liquidityLabel, 'unavailable');
});

test('caps one-sided and zero-bid liquidity classifications', () => {
  const oneSided = buildScannerOptionSnapshot('TST', normalize(oneSidedResponse), candidate, NOW);
  const zeroBid = buildScannerOptionSnapshot('TST', normalize(zeroBidResponse), candidate, NOW);
  assert.ok(['illiquid', 'thin', 'medium'].includes(oneSided.liquidityLabel));
  assert.ok(['illiquid', 'thin'].includes(zeroBid.liquidityLabel));
});

test('stale last trade lowers liquidity score without making the quote unavailable', () => {
  const fresh = buildScannerOptionSnapshot('TST', normalize(normalLiquidResponse), candidate, NOW);
  const stale = buildScannerOptionSnapshot('TST', normalize(staleTradeResponse), candidate, NOW);
  assert.ok(stale.liquidityScore < fresh.liquidityScore);
  assert.notEqual(stale.liquidityLabel, 'unavailable');
});

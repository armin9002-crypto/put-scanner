import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildOptionDrawerQuoteState,
  formatOptionQuoteValue,
  selectDefaultSoldPrice,
} from '../src/lib/optionQuoteDisplay.ts';

const NOW = '2026-09-08T16:00:00Z';
const RECENT_LAST = '2026-09-04T15:00:00Z';
const STALE_LAST = '2026-09-01T15:00:00Z';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function state(input) {
  return buildOptionDrawerQuoteState(input, NOW);
}

test('XAPP-015 route parity: clean positive quote has one shared basis contract', () => {
  const inputs = ['options', 'screener', 'watchlist', 'recommendations', 'portfolio']
    .map(() => ({ last: 2.1, lastTradeDate: RECENT_LAST, bid: 2, ask: 2.2, integrityStatus: 'clean' }));
  const states = inputs.map(state);
  for (const result of states) {
    assert.equal(result.trustedBid, 2);
    assert.equal(result.trustedAsk, 2.2);
    assert.equal(result.mid, 2.1);
    assert.deepEqual(result.defaultSoldPrice, { basis: 'bid', value: 2 });
  }
  assert.deepEqual(states.map(result => ({ bid: result.trustedBid, ask: result.trustedAsk, mid: result.mid, default: result.defaultSoldPrice })), Array(5).fill({ bid: 2, ask: 2.2, mid: 2.1, default: { basis: 'bid', value: 2 } }));
});

test('XAPP-015 zero or missing Bid never becomes a sold-price credit or Mid', () => {
  const zeroBid = state({ last: 2, lastTradeDate: RECENT_LAST, bid: 0, ask: 2.2, integrityStatus: 'clean' });
  const missingBid = state({ last: 2, lastTradeDate: RECENT_LAST, bid: null, ask: 2.2, integrityStatus: 'clean' });
  assert.equal(zeroBid.trustedBid, null);
  assert.equal(zeroBid.mid, null);
  assert.deepEqual(zeroBid.defaultSoldPrice, { basis: 'last', value: 2 });
  assert.equal(missingBid.trustedBid, null);
  assert.equal(missingBid.mid, null);
  assert.deepEqual(missingBid.defaultSoldPrice, { basis: 'last', value: 2 });
  assert.equal(formatOptionQuoteValue('bid', 0, value => `$${value.toFixed(2)}`), 'No Bid');
});

test('XAPP-015 stale, very stale, and unknown-age Last stay explicit reference only', () => {
  for (const lastTradeDate of [STALE_LAST, '2026-08-20T15:00:00Z', null]) {
    const result = state({ last: 2, lastTradeDate, bid: null, ask: null, integrityStatus: 'clean' });
    assert.equal(result.trustedLast, 2);
    assert.equal(result.defaultSoldPrice, null);
  }
  assert.equal(state({ last: 2, lastTradeDate: STALE_LAST, bid: null, ask: null, integrityStatus: 'clean' }).lastTradeFreshness.freshness, 'stale');
  assert.equal(state({ last: 2, lastTradeDate: null, bid: null, ask: null, integrityStatus: 'clean' }).lastTradeFreshness.freshness, 'unavailable');
  assert.deepEqual(selectDefaultSoldPrice({ last: 2, lastTradeDate: RECENT_LAST, bid: null, ask: null }, NOW), { basis: 'last', value: 2 });
  assert.equal(selectDefaultSoldPrice({ last: 2, lastTradeDate: STALE_LAST, bid: null, ask: null }, NOW), null);
});

test('XAPP-015 invalid quotes fail closed while degraded positive quotes remain usable with status', () => {
  const invalid = state({ last: 2.1, lastTradeDate: RECENT_LAST, bid: 2.2, ask: 2, integrityStatus: 'invalid' });
  assert.equal(invalid.trustedBid, null);
  assert.equal(invalid.trustedAsk, null);
  assert.equal(invalid.mid, null);
  assert.equal(invalid.defaultSoldPrice, null);
  assert.equal(invalid.rawBid, 2.2);

  const degraded = state({ last: 2.1, lastTradeDate: RECENT_LAST, bid: 2, ask: 2.2, integrityStatus: 'degraded' });
  assert.equal(degraded.integrityStatus, 'degraded');
  assert.equal(degraded.mid, 2.1);
  assert.deepEqual(degraded.defaultSoldPrice, { basis: 'bid', value: 2 });
});

test('XAPP-015 valuation-only Portfolio Last cannot enter generic Drawer authority', () => {
  const result = state({ last: 2, lastTradeDate: RECENT_LAST, bid: null, ask: null, integrityStatus: 'degraded', lastFallbackOnly: true });
  assert.equal(result.trustedLast, null);
  assert.equal(result.defaultSoldPrice, null);
});

test('XAPP-015 Portfolio drawer adapter has a current-quote firewall', async () => {
  const source = await readFile(path.join(ROOT, 'src/pages/PortfolioPage.tsx'), 'utf8');
  const start = source.indexOf('const openDrawer = useCallback');
  const end = source.indexOf('\n  const sortButton =', start);
  const adapter = source.slice(start, end);
  assert.doesNotMatch(adapter, /entrySnapshot\?\.(bid|ask|last)/);
  assert.match(adapter, /market\?\.optionBid/);
  assert.match(adapter, /market\?\.optionAsk/);
  assert.match(adapter, /lastFallbackOnly/);
  assert.match(adapter, /optionIntegrityStatus/);
});

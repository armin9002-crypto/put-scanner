import test from 'node:test';
import assert from 'node:assert/strict';

import { filterEtfPulseOpportunityRows, summarizeEtfPulseOptionability } from '../src/lib/etfPulseData.ts';
import { ETF_PULSE_LEVERAGED_TICKERS } from '../shared/etfPulseUniverse.js';

const future = Math.floor(Date.parse('2026-10-16T00:00:00Z') / 1_000);
const row = ticker => ({ ticker });

test('ETF Pulse keeps context benchmarks while filtering leveraged rows by trusted future put availability', () => {
  const rows = ['TQQQ', 'QQUP', 'AGQ', 'QQQ', 'SPY'].map(row);
  const initial = filterEtfPulseOpportunityRows(rows, {
    expirationsByTicker: { TQQQ: [future], QQUP: [], AGQ: [] },
    errors: [{ ticker: 'AGQ', message: 'unknown' }],
  }, new Date('2026-09-19T18:00:00Z'));

  assert.deepEqual(initial.map(item => item.ticker), ['TQQQ', 'QQQ', 'SPY']);

  const later = filterEtfPulseOpportunityRows(rows, {
    expirationsByTicker: { TQQQ: [future], QQUP: [future], AGQ: [future] },
    errors: [],
  }, new Date('2026-09-21T14:00:00Z'));
  assert.deepEqual(later.map(item => item.ticker), ['TQQQ', 'QQUP', 'AGQ', 'QQQ', 'SPY']);
});

test('ETF Pulse coverage distinguishes confirmed, unknown, and authoritative no-options leveraged names', () => {
  const confirmed = ETF_PULSE_LEVERAGED_TICKERS.slice(0, 72);
  const noOptions = ETF_PULSE_LEVERAGED_TICKERS.slice(72, 83);
  const unknown = ETF_PULSE_LEVERAGED_TICKERS[83];
  const coverage = summarizeEtfPulseOptionability({
    expirationsByTicker: Object.fromEntries([...confirmed.map(ticker => [ticker, [future]]), ...noOptions.map(ticker => [ticker, []])]),
    errors: [{ ticker: unknown, message: 'temporary discovery failure' }],
  }, new Date('2026-09-21T14:00:00Z'));

  assert.deepEqual(coverage, { total: 84, confirmed: 72, temporarilyUnverified: 1, noOptions: 11 });
  const complete = summarizeEtfPulseOptionability({
    expirationsByTicker: Object.fromEntries(ETF_PULSE_LEVERAGED_TICKERS.map(ticker => [ticker, [future]])),
    errors: [],
  }, new Date('2026-09-21T14:00:00Z'));
  assert.deepEqual(complete, { total: 84, confirmed: 84, temporarilyUnverified: 0, noOptions: 0 });
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { filterEtfPulseOpportunityRows } from '../src/lib/etfPulseData.ts';

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

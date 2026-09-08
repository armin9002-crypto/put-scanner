import test from 'node:test';
import assert from 'node:assert/strict';

import {
  coverageState,
  determinateProgress,
  evidenceFreshnessFromChainMeta,
  evidenceFreshnessFromRequestMeta,
  indeterminateProgress,
} from '../src/lib/evidence.ts';
import { normalizeOptionChainData } from '../src/lib/yahooOptionAdapter.ts';
import { getEtfPulseUniverse, buildEtfPulseRows } from '../src/lib/etfPulseData.ts';
import { buildEtfPulseRow } from '../src/lib/etfPulseMetrics.ts';
import { assessUnderlying } from '../src/lib/recommendations/underlying.ts';

const response = {
  optionChain: {
    result: [{
      quote: { regularMarketPrice: 100, regularMarketTime: 1_800_000_000 },
      expirationDates: [1_900_000_000],
      options: [{ expirationDate: 1_900_000_000, puts: [{ strike: 90, bid: 1, ask: 1.1, lastPrice: 1.05, lastTradeDate: 1_799_000_000 }], calls: [] }],
    }],
  },
};

test('Prompt #4 shared grammar keeps run, evidence, and progress orthogonal', () => {
  assert.equal(evidenceFreshnessFromRequestMeta({ source: 'network', staleFallbackUsed: false }), 'current');
  assert.equal(evidenceFreshnessFromRequestMeta({ source: 'persistent', staleFallbackUsed: false }), 'cached-current');
  assert.equal(evidenceFreshnessFromRequestMeta({ source: 'stale-fallback', staleFallbackUsed: true }), 'retained-stale');
  assert.equal(evidenceFreshnessFromChainMeta({ source: 'cache', staleFallbackUsed: false }), 'cached-current');
  assert.equal(evidenceFreshnessFromChainMeta({ source: 'stale', staleFallbackUsed: true }), 'retained-stale');
  assert.equal(coverageState(5, 5, 0), 'complete');
  assert.equal(coverageState(5, 3, 2), 'partial');
  assert.equal(coverageState(5, 0, 5), 'failed');
  assert.deepEqual(indeterminateProgress('aggregate acquisition'), { kind: 'indeterminate', stage: 'aggregate acquisition' });
  assert.deepEqual(determinateProgress('refresh tasks', 'ETFs', 7, 30), { kind: 'determinate', stage: 'refresh tasks', unit: 'ETFs', completed: 7, total: 30 });
});

test('normalization preserves the original evidence observation instead of restamping retained data', () => {
  const chain = normalizeOptionChainData(response, 'TST', 1_900_000_000, 'prompt4', 'network', null, {
    observedAt: 1_700_000_000_000,
    cachedAt: 1_700_100_000_000,
    freshness: 'stale',
    staleFallbackUsed: true,
    retentionReason: 'Provider refresh failed',
  });
  assert.equal(chain.chainMeta.fetchedAt, 1_700_000_000_000);
  assert.equal(chain.chainMeta.cachedAt, 1_700_100_000_000);
  assert.equal(chain.chainMeta.staleFallbackUsed, true);
  assert.equal(chain.chainMeta.retentionReason, 'Provider refresh failed');
  assert.equal(evidenceFreshnessFromChainMeta(chain.chainMeta), 'retained-stale');
});

test('retained positive Pulse technical evidence cannot qualify as current-positive authority', () => {
  const etf = getEtfPulseUniverse()[0];
  const points = Array.from({ length: 300 }, (_, index) => ({
    timestamp: 1_700_000_000 + index * 86_400,
    date: new Date((1_700_000_000 + index * 86_400) * 1000).toISOString(),
    price: 100 + index,
  }));
  const current = buildEtfPulseRow(etf, points, 399);
  const retained = { ...current, evidenceFreshness: 'retained-stale' };
  const regime = { label: 'Healthy Risk-On' };
  const assessment = assessUnderlying(retained, regime);
  assert.equal(assessment.qualification, 'WATCH');
  assert.ok(assessment.reasonCodes.includes('EVIDENCE_GAPS'));
});

test('Pulse aggregate progress is not synthesized from local row construction', async () => {
  const previousFetch = globalThis.fetch;
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  const phases = [];
  globalThis.fetch = async () => Response.json({
    datasetVersion: 2,
    fetchedAt: 1_800_000_000_000,
    tickers: getEtfPulseUniverse().map(etf => etf.ticker),
    histories: Object.fromEntries(getEtfPulseUniverse().map(etf => [etf.ticker, { ticker: etf.ticker, timeframe: '2Y', points: [], latestPrice: null }])),
    errors: [],
  });
  try {
    await buildEtfPulseRows({ forceRefresh: true, onProgress: progress => phases.push(progress.phase) });
    assert.equal(phases[0], 'acquiring');
    assert.ok(phases.includes('processing'));
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.localStorage = previousStorage;
  }
});

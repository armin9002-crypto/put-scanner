import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { getChartPeriodBaselineReference, calculateChartPeriodReturn } from '../src/lib/chartReturns.ts';
import { passesScannerLiquidityFilter } from '../src/lib/scannerDiscovery.ts';
import {
  buildExpirationState,
  scannerExpirationMatch,
  snapshotIssueLabel,
  snapshotProgressDetails,
  tickerMatchesScannerExpiration,
} from '../src/lib/scannerUpdateState.ts';

const root = new URL('../', import.meta.url);
const read = relative => readFileSync(new URL(relative, root), 'utf8');

function chart(overrides = {}) {
  return {
    ticker: 'TST',
    displayTicker: 'TST',
    timeframe: '5D',
    points: [
      { timestamp: 1, date: '2026-01-02', price: 101 },
      { timestamp: 2, date: '2026-01-03', price: 106 },
    ],
    corporateActions: [],
    previousClose: 99,
    latestPrice: 106,
    fetchedAt: 1,
    ...overrides,
  };
}

test('Scanner A chart references use the selected timeframe baseline and truthful label', () => {
  assert.deepEqual(getChartPeriodBaselineReference(chart({ timeframe: '1D' }), '1D'), { value: 99, label: 'Prev close' });
  assert.deepEqual(getChartPeriodBaselineReference(chart(), '5D'), { value: 101, label: 'Period start' });
  assert.deepEqual(getChartPeriodBaselineReference(chart({ timeframe: 'YTD', ytdBaseline: { timestamp: 0, date: '2025-12-31', price: 98, marketDate: '2025-12-31' } }), 'YTD'), { value: 98, label: 'Year start' });
  assert.deepEqual(getChartPeriodBaselineReference(chart({ timeframe: 'All' }), 'All'), { value: 101, label: 'Series start' });
  assert.deepEqual(calculateChartPeriodReturn(chart(), '5D'), { change: 5, percent: (5 / 101) * 100 });
});

test('Scanner A expiration coverage distinguishes PRESENT, ABSENT, and UNKNOWN', () => {
  const target = 1_800_000_000;
  const state = buildExpirationState({ AAA: [target], BBB: [] }, 'partial', [{ ticker: 'CCC', message: 'batch failed' }]);
  assert.equal(state.coverage, 'partial');
  assert.equal(scannerExpirationMatch('AAA', `date_${target}`, state.availability, state.coverage), 'present');
  assert.equal(scannerExpirationMatch('BBB', `date_${target}`, state.availability, state.coverage), 'absent');
  assert.equal(scannerExpirationMatch('CCC', `date_${target}`, state.availability, state.coverage), 'unknown');
  assert.equal(tickerMatchesScannerExpiration('CCC', `date_${target}`, state.availability, true, new Date(), state.coverage), true);
  assert.equal(tickerMatchesScannerExpiration('BBB', `date_${target}`, state.availability, true, new Date(), state.coverage), false);
});

test('Scanner A incomplete coverage never presents a categorical no-match state', () => {
  const source = read('src/pages/HomePage.tsx');
  assert.match(source, /No confirmed matches yet · availability incomplete/);
  assert.match(source, /confirmed .* unverified/);
  assert.match(source, /expirationState\.coverage/);
});

test('Scanner A degraded evidence remains visible but cannot satisfy Liquid+', () => {
  const snapshot = label => ({ liquidityLabel: label, liquidityScore: 90, atmPutIv: 40 });
  assert.equal(passesScannerLiquidityFilter({ ...snapshot('liquid'), integrityStatus: 'clean' }, 'liquidPlus'), true);
  assert.equal(passesScannerLiquidityFilter({ ...snapshot('liquid'), integrityStatus: 'degraded' }, 'liquidPlus'), false);
  assert.equal(passesScannerLiquidityFilter({ ...snapshot('liquid'), integrityStatus: 'invalid' }, 'liquidPlus'), false);
  assert.equal(passesScannerLiquidityFilter({ ...snapshot('liquid'), integrityStatus: 'degraded' }, 'all'), true);
  assert.equal(passesScannerLiquidityFilter(null, 'all'), true);
});

test('Scanner A refresh acknowledgement uses the actual settled run denominator', () => {
  const progress = { current: 32, total: 32, updated: 19, expanded: 2, unavailable: 1, failed: 1, complete: true };
  assert.equal(snapshotIssueLabel(progress), '2 issues / 32 checked');
  assert.equal(snapshotProgressDetails(progress), 'Last refresh: 32 checked · 19 updated · 1 unavailable · 1 failed');
  const source = read('src/pages/HomePage.tsx');
  assert.match(source, /const tickers = \[\.\.\.new Set\(filtered\.map/);
  assert.match(source, /total: tickers\.length/);
  assert.match(source, /SnapshotIssueDisclosure/);
});

test('Scanner A evidence has one controlled owner and preserves mobile navigation', () => {
  const home = read('src/pages/HomePage.tsx');
  const card = read('src/components/ETFCard.tsx');
  const mobile = read('src/components/mobile/MobileEtfRow.tsx');
  const evidence = read('src/components/ScannerSnapshotEvidence.tsx');
  assert.match(home, /activeEvidence/);
  assert.match(home, /<ScannerEvidencePopover/);
  assert.doesNotMatch(card, /ScannerSnapshotTooltip|group-hover\/snapshot:opacity-100/);
  assert.match(card, /onEvidenceOpen/);
  assert.match(mobile, /event\.stopPropagation\(\)/);
  assert.match(mobile, /<Link/);
  assert.match(evidence, /window\.addEventListener\('resize'/);
  assert.match(evidence, /window\.addEventListener\('scroll'/);
  assert.doesNotMatch(evidence, /aria-modal/);
});

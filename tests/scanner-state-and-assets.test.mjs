import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatFundAssets } from '../src/lib/fundAssets.ts';
import { DEFAULT_SCANNER_STATE, parseScannerState, resolveScannerExpiration, serializeScannerState } from '../src/lib/scannerState.ts';

test('Scanner URL state parses and serializes all persistent filters', () => {
  const params = new URLSearchParams('expiry=2026-10-16&leverage=3x&type=Country&q=yin&sort=iv60&liquidity=liquidPlus');
  const state = parseScannerState(params);
  assert.equal(state.expiration, `date_${Date.parse('2026-10-16T00:00:00Z') / 1000}`);
  assert.deepEqual({ ...state, expiration: 'date_1792108800' }, {
    search: 'yin', leverage: '3x', type: 'Country', expiration: 'date_1792108800', sort: 'iv60', liquidity: 'liquidPlus',
  });
  assert.equal(serializeScannerState(state).get('expiry'), '2026-10-16');
});

test('Scanner URL state uses defaults for missing or invalid parameters', () => {
  assert.deepEqual(parseScannerState(new URLSearchParams()), DEFAULT_SCANNER_STATE);
  assert.deepEqual(parseScannerState(new URLSearchParams('expiry=nope&leverage=9x&type=Bad&sort=wat&liquidity=none')), DEFAULT_SCANNER_STATE);
});

test('Scanner expiration restoration keeps valid dates and falls back to nearest valid date', () => {
  assert.equal(resolveScannerExpiration('date_200', [100, 200, 300]), 'date_200');
  assert.equal(resolveScannerExpiration('date_240', [100, 200, 300]), 'date_200');
  assert.equal(resolveScannerExpiration('date_240', []), 'all');
  assert.equal(resolveScannerExpiration('lte_30dte', [100], false), 'all');
});

test('Scanner reset returns every criterion and the local query to canonical defaults', () => {
  const source = readFileSync(new URL('../src/pages/HomePage.tsx', import.meta.url), 'utf8');
  const resetStart = source.indexOf('const resetScannerFilters = useCallback');
  assert.notEqual(resetStart, -1, 'Scanner has one shared reset path');
  const resetBody = source.slice(resetStart, source.indexOf('  const updateVisibleOptionSnapshots', resetStart));
  for (const [setter, field] of [['Search', 'search'], ['LeverageFilter', 'leverage'], ['TypeFilter', 'type'], ['ExpFilter', 'expiration'], ['ScannerSort', 'sort'], ['LiquidityFilter', 'liquidity']]) {
    assert.match(resetBody, new RegExp(`set${setter}\\(DEFAULT_SCANNER_STATE\\.${field}\\)`));
  }
  assert.doesNotMatch(resetBody, /navigate|fetchOptions|fetchBatchPrices|updateVisibleOptionSnapshots/);
  assert.match(source, /Reset Filters/);
  assert.match(source, /activeControlCount/);
  assert.equal(serializeScannerState(DEFAULT_SCANNER_STATE).toString(), '', 'canonical defaults serialize without stale URL criteria');
});

test('Option-chain rows keep deliberate selection interactions without rich hover cards', () => {
  const source = readFileSync(new URL('../src/pages/OptionsPage.tsx', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /OptionQuickTooltip|group-hover:block|group-focus-within:block/);
  assert.match(source, /onKeyDown=\{event => \{[\s\S]*?setSelectedOption\(put\)/);
  assert.match(source, /tabIndex=\{0\}/);
  assert.match(source, /onClick=\{\(\) => setSelectedOption\(put\)\}/);
  assert.match(source, /event\.stopPropagation\(\);[\s\S]*?toggleWatchlist\(put\)/);
});

test('fund Assets formatting is compact and never fabricates missing values', () => {
  assert.equal(formatFundAssets(185_400_000_000), '$185.4B');
  assert.equal(formatFundAssets(24_800_000_000), '$24.8B');
  assert.equal(formatFundAssets(3_200_000_000), '$3.2B');
  assert.equal(formatFundAssets(842_000_000), '$842M');
  assert.equal(formatFundAssets(76_000_000), '$76M');
  assert.equal(formatFundAssets(100_000), '<$1M');
  assert.equal(formatFundAssets(null), '—');
});

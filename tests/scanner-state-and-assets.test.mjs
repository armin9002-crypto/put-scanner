import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatFundAssets } from '../src/lib/fundAssets.ts';
import { ETF_LIST } from '../src/lib/etfs.ts';
import { passesScannerLiquidityFilter } from '../src/lib/scannerDiscovery.ts';
import { DEFAULT_SCANNER_STATE, parseScannerState, resolveScannerExpiration, serializeScannerState } from '../src/lib/scannerState.ts';
import { buildExpirationState, tickerMatchesScannerExpiration } from '../src/lib/scannerUpdateState.ts';

test('Scanner URL state parses and serializes all persistent filters', () => {
  const params = new URLSearchParams('expiry=2026-10-16&leverage=3x&type=Country&q=yin&sort=iv60&liquidity=liquidPlus');
  const state = parseScannerState(params);
  assert.equal(state.expiration, `date_${Date.parse('2026-10-16T00:00:00Z') / 1000}`);
  assert.deepEqual({ ...state, expiration: 'date_1792108800' }, {
    search: 'yin', leverage: '3x', type: 'Country', expiration: 'date_1792108800', sort: 'iv60', liquidity: 'liquidPlus',
  });
  assert.equal(serializeScannerState(state).get('expiry'), '2026-10-16');
});

test('Crypto is a round-trippable Scanner type containing the three approved ETF exposures', () => {
  const state = parseScannerState(new URLSearchParams('type=Crypto'));
  assert.equal(state.type, 'Crypto');
  assert.equal(serializeScannerState(state).get('type'), 'Crypto');
  assert.deepEqual(ETF_LIST.filter(etf => etf.type === 'Crypto').map(etf => etf.ticker), ['BITX', 'ETHU', 'SOLT']);
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

test('Scanner expiration state uses market-wide membership and treats partial failures as unknown', () => {
  const now = new Date('2026-09-06T12:00:00Z');
  const oct23 = Date.parse('2026-10-23T00:00:00Z') / 1_000;
  const feb19 = Date.parse('2027-02-19T00:00:00Z') / 1_000;
  const availability = { AAA: [oct23, feb19], BBB: [oct23], CCC: [feb19] };
  const state = buildExpirationState(availability);
  assert.deepEqual(state.expirations.map(expiration => expiration.date), [oct23, feb19]);
  assert.equal(tickerMatchesScannerExpiration('AAA', `date_${feb19}`, availability, true, now), true);
  assert.equal(tickerMatchesScannerExpiration('BBB', `date_${feb19}`, availability, true, now), false);
  assert.equal(tickerMatchesScannerExpiration('DDD', `date_${feb19}`, availability, true, now), true, 'missing partial data must not hide a ticker');
  assert.equal(tickerMatchesScannerExpiration('BBB', `date_${feb19}`, availability, false, now), true, 'local cache is not authoritative while discovery loads');
  assert.equal(passesScannerLiquidityFilter(null, 'all'), true, 'a failed liquidity snapshot must not remove an ETF from the unfiltered universe');
});

test('Scanner desktop and mobile expose six type choices with full Commodity text and a header liquidity action', () => {
  const source = readFileSync(new URL('../src/pages/HomePage.tsx', import.meta.url), 'utf8');
  assert.match(source, /TYPE_OPTIONS = \['All', 'Broad Index', 'Sector', 'Commodity', 'Country', 'Crypto'\]/);
  assert.match(source, /grid-cols-6/);
  assert.doesNotMatch(source, /Commod\./);
  assert.match(source, /scanner-control-plane__utilities[\s\S]*Update missing or stale IV60 and liquidity snapshots/);
});

test('Scanner aggregate price and fund-asset paths remain bounded for 84 symbols', () => {
  const pricesEndpoint = readFileSync(new URL('../api/prices.js', import.meta.url), 'utf8');
  const fundEndpoint = readFileSync(new URL('../api/fund-metadata.js', import.meta.url), 'utf8');
  assert.equal(ETF_LIST.length, 84);
  assert.ok(encodeURIComponent(ETF_LIST.map(etf => etf.ticker).join(',')).length < 2_000);
  assert.match(pricesEndpoint, /index \+= 20/);
  assert.match(pricesEndpoint, /mapWithConcurrency\(chunks, 3/);
  assert.match(fundEndpoint, /symbols\.length > 100/);
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

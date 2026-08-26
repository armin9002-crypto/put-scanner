import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ETF_PULSE_SYMBOLS,
  SCANNER_SYMBOLS,
  SCREENER_SYMBOLS,
  SYMBOL_REGISTRY,
  getSymbolMetadata,
} from '../shared/symbolRegistry.js';
import { ETF_PULSE_TICKERS } from '../shared/etfPulseUniverse.js';
import { SCREENER_TICKERS } from '../shared/screenerUniverse.js';
import { ETF_LIST, getScannerEtf } from '../src/lib/etfs.ts';
import { optionChainMatchesRequestedExpiration } from '../src/lib/optionExpiryNavigation.ts';
import { isPastWatchlistExpirationDte } from '../src/lib/watchlist.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('the symbol registry preserves every current visible universe without duplication', () => {
  assert.equal(SYMBOL_REGISTRY.length, 46);
  assert.equal(new Set(SYMBOL_REGISTRY.map(symbol => symbol.ticker)).size, SYMBOL_REGISTRY.length);
  assert.equal(SCANNER_SYMBOLS.length, 42);
  assert.deepEqual(SCANNER_SYMBOLS.map(symbol => symbol.ticker), ETF_LIST.map(etf => etf.ticker));
  assert.deepEqual(SCREENER_SYMBOLS.map(symbol => symbol.ticker), [...SCREENER_TICKERS]);
  assert.deepEqual(ETF_PULSE_SYMBOLS.map(symbol => symbol.ticker), [...ETF_PULSE_TICKERS]);
  assert.equal(ETF_PULSE_SYMBOLS.length, 44);
});

test('registry selectors normalize routes and distinguish context indices', () => {
  assert.equal(getScannerEtf(' tqqq ')?.ticker, 'TQQQ');
  assert.equal(getScannerEtf('NVDA'), null);
  assert.equal(getSymbolMetadata('vix')?.ticker, '^VIX');
  assert.equal(getSymbolMetadata('^VXN')?.assetType, 'index');
  assert.equal(getSymbolMetadata('SPY')?.leveraged, false);
});

test('watchlist keeps expiration-day contracts live and expires them the following day', () => {
  assert.equal(isPastWatchlistExpirationDte(-1), true);
  assert.equal(isPastWatchlistExpirationDte(0), false);
  assert.equal(isPastWatchlistExpirationDte(1), false);
  assert.equal(isPastWatchlistExpirationDte(null), false);
});

test('expiration validation rejects a provider fallback while allowing metadata-free legacy fixtures', () => {
  assert.equal(optionChainMatchesRequestedExpiration({ returnedExpiration: 2_000 }, 2_000), true);
  assert.equal(optionChainMatchesRequestedExpiration({ expirationDate: 2_000 }, 2_000), true);
  assert.equal(optionChainMatchesRequestedExpiration({ returnedExpiration: 3_000 }, 2_000), false);
  assert.equal(optionChainMatchesRequestedExpiration(null, 2_000), true);
});

test('option detail gates unsupported symbols and chart publication is latest-request-only', async () => {
  const optionsPage = await readFile(path.join(root, 'src/pages/OptionsPage.tsx'), 'utf8');
  const chartModal = await readFile(path.join(root, 'src/components/InteractivePriceChartModal.tsx'), 'utf8');
  assert.match(optionsPage, /if \(!ticker \|\| !etf\) return;/);
  assert.match(optionsPage, /optionChainMatchesRequestedExpiration\(opts\.chainMeta, expDate\)/);
  assert.match(optionsPage, /requestGeneration !== requestGenerationRef\.current/);
  assert.match(chartModal, /requestGeneration !== chartRequestGenerationRef\.current/);
  assert.match(chartModal, /chartRequestGenerationRef\.current \+= 1/);
});

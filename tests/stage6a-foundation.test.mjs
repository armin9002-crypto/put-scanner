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
import { classifyHistoryInstrument } from '../src/lib/portfolioHistoryAnalytics.ts';
import { getPortfolioEtfMetadata } from '../src/lib/portfolioAnalytics.ts';
import { isPastWatchlistExpirationDte } from '../src/lib/watchlist.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NEW_LEVERAGED_ETFS = [
  'BIB', 'BITX', 'CHAU', 'DRN', 'EFO', 'EQQQ', 'ETHU', 'EZJ', 'FNGG', 'JNUG', 'KORU', 'MEXX', 'PILL', 'QQQU',
  'QQUP', 'QQXL', 'RETL', 'RXL', 'SAA', 'SKYU', 'SOLT', 'SPXL', 'TBXU', 'TEXU', 'TPOR', 'TSXU', 'TTXU', 'UBOT',
  'UCC', 'UCOP', 'UCYB', 'UGE', 'UMDD', 'UPAL', 'UPLT', 'UPV', 'URAA', 'URE', 'URSP', 'UXI', 'WANT', 'XPP',
];

test('the symbol registry preserves every current visible universe without duplication', () => {
  assert.equal(SYMBOL_REGISTRY.length, 88);
  assert.equal(new Set(SYMBOL_REGISTRY.map(symbol => symbol.ticker)).size, SYMBOL_REGISTRY.length);
  assert.equal(SCANNER_SYMBOLS.length, 84);
  assert.deepEqual(SCANNER_SYMBOLS.map(symbol => symbol.ticker), ETF_LIST.map(etf => etf.ticker));
  assert.deepEqual(SCREENER_SYMBOLS.map(symbol => symbol.ticker), [...SCREENER_TICKERS]);
  assert.equal(SCREENER_SYMBOLS.length, 84);
  assert.deepEqual(ETF_PULSE_SYMBOLS.map(symbol => symbol.ticker), [...ETF_PULSE_TICKERS]);
  assert.equal(ETF_PULSE_SYMBOLS.length, 86);
  assert.equal(ETF_PULSE_SYMBOLS.filter(symbol => symbol.leveraged).length, 84);
});

test('the approved leveraged expansion has exact membership, leverage, category, and ETF invariants', () => {
  const newSymbols = SCANNER_SYMBOLS.filter(symbol => NEW_LEVERAGED_ETFS.includes(symbol.ticker));
  assert.deepEqual(newSymbols.map(symbol => symbol.ticker).sort(), [...NEW_LEVERAGED_ETFS].sort());
  assert.equal(newSymbols.length, 42);
  assert.deepEqual(Object.fromEntries([2, 3].map(multiple => [multiple, newSymbols.filter(symbol => symbol.leverageMultiple === multiple).length])), { 2: 33, 3: 9 });
  assert.deepEqual(Object.fromEntries(['Sector', 'Country', 'Commodity', 'Broad Index', 'Crypto'].map(category => [category, newSymbols.filter(symbol => symbol.etfCategory === category).length])), {
    Sector: 21, Country: 7, Commodity: 6, 'Broad Index': 5, Crypto: 3,
  });
  assert.deepEqual(Object.fromEntries([2, 3].map(multiple => [multiple, SCANNER_SYMBOLS.filter(symbol => symbol.leverageMultiple === multiple).length])), { 2: 52, 3: 32 });
  assert.deepEqual(Object.fromEntries(['Sector', 'Broad Index', 'Commodity', 'Country', 'Crypto'].map(category => [category, SCANNER_SYMBOLS.filter(symbol => symbol.etfCategory === category).length])), {
    Sector: 38, 'Broad Index': 16, Commodity: 14, Country: 13, Crypto: 3,
  });
  for (const ticker of ['BITX', 'ETHU', 'SOLT']) {
    assert.deepEqual({ assetType: getSymbolMetadata(ticker)?.assetType, leveraged: getSymbolMetadata(ticker)?.leveraged, leverageMultiple: getSymbolMetadata(ticker)?.leverageMultiple }, {
      assetType: 'etf', leveraged: true, leverageMultiple: 2,
    });
  }
  assert.ok(NEW_LEVERAGED_ETFS.every(ticker => classifyHistoryInstrument(ticker) === 'etf'));
  assert.equal(getPortfolioEtfMetadata('BITX').category, 'Crypto');
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

test('expiration validation rejects MISMATCH and UNKNOWN while allowing canonical contract-derived MATCH', () => {
  assert.equal(optionChainMatchesRequestedExpiration({ returnedExpiration: 2_000 }, 2_000), true);
  assert.equal(optionChainMatchesRequestedExpiration({ expirationDate: 2_000 }, 2_000), true);
  assert.equal(optionChainMatchesRequestedExpiration({ returnedExpiration: 3_000 }, 2_000), false);
  assert.equal(optionChainMatchesRequestedExpiration(null, 2_000), false, 'UNKNOWN returned evidence cannot prove the requested expiration');
  assert.equal(optionChainMatchesRequestedExpiration(null, 2_000, [2_000, 2_000]), true, 'canonical contract identities can prove MATCH');
  assert.equal(optionChainMatchesRequestedExpiration(null, 2_000, [2_000, null]), false, 'ambiguous contract identity remains UNKNOWN');
});

test('option detail accepts normalized on-demand symbols and chart publication is latest-request-only', async () => {
  const optionsPage = await readFile(path.join(root, 'src/pages/OptionsPage.tsx'), 'utf8');
  const chartModal = await readFile(path.join(root, 'src/components/InteractivePriceChartModal.tsx'), 'utf8');
  assert.match(optionsPage, /if \(!ticker\) return;/);
  assert.match(optionsPage, /resolveTickerDetailInstrument\(ticker \?\? '', optionsData\?\.instrument\)/);
  assert.match(optionsPage, /optionChainMatchesRequestedExpiration\(opts\.chainMeta, expDate, opts\.puts\.map/);
  assert.match(optionsPage, /requestGeneration !== requestGenerationRef\.current/);
  assert.match(chartModal, /requestGeneration !== chartRequestGenerationRef\.current/);
  assert.match(chartModal, /chartRequestGenerationRef\.current \+= 1/);
});

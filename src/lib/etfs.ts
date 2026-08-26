import type { ETFInfo } from './types';
import { SCANNER_SYMBOLS, normalizeSymbolTicker } from '../../shared/symbolRegistry.js';

export const ETF_LIST: ETFInfo[] = SCANNER_SYMBOLS.map(symbol => ({
  ticker: symbol.ticker,
  name: symbol.name,
  leverage: `${symbol.leverageMultiple}x`,
  underlying: symbol.exposure ?? symbol.name,
  type: symbol.etfCategory ?? 'Broad Index',
}));

const ETF_BY_TICKER = new Map(ETF_LIST.map(etf => [etf.ticker, etf]));

export function getScannerEtf(ticker: string | null | undefined): ETFInfo | null {
  return ETF_BY_TICKER.get(normalizeSymbolTicker(ticker)) ?? null;
}

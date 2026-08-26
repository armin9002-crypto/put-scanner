import { SCREENER_SYMBOLS } from './symbolRegistry.js';

export const SCREENER_TICKERS = Object.freeze(SCREENER_SYMBOLS.map(symbol => symbol.ticker));

export const SCREENER_PREFETCH_TICKERS = Object.freeze(['TQQQ', 'LABU', 'SSO', 'SOXL', 'UPRO', 'TNA', 'FAS']);
export const SCREENER_CHUNK_SIZE = 3;
export const SCREENER_SERVER_CONCURRENCY = 3;
export const SCREENER_BROWSER_CONCURRENCY = 2;

export function getScreenerChunks() {
  const chunks = [];
  for (let index = 0; index < SCREENER_TICKERS.length; index += SCREENER_CHUNK_SIZE) {
    chunks.push(Object.freeze({ id: chunks.length, tickers: Object.freeze(SCREENER_TICKERS.slice(index, index + SCREENER_CHUNK_SIZE)) }));
  }
  return Object.freeze(chunks);
}

export const SCREENER_CHUNKS = getScreenerChunks();

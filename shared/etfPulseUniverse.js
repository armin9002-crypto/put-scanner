import { ETF_PULSE_SYMBOLS } from './symbolRegistry.js';

export const ETF_PULSE_LEVERAGED_SYMBOLS = Object.freeze(ETF_PULSE_SYMBOLS.filter(symbol => symbol.leveraged));
export const ETF_PULSE_CONTEXT_BENCHMARK_SYMBOLS = Object.freeze(ETF_PULSE_SYMBOLS.filter(symbol => !symbol.leveraged));
export const ETF_PULSE_LEVERAGED_TICKERS = Object.freeze(ETF_PULSE_LEVERAGED_SYMBOLS.map(symbol => symbol.ticker));
export const ETF_PULSE_CONTEXT_BENCHMARK_TICKERS = Object.freeze(ETF_PULSE_CONTEXT_BENCHMARK_SYMBOLS.map(symbol => symbol.ticker));
export const ETF_PULSE_TICKERS = Object.freeze(ETF_PULSE_SYMBOLS.map(symbol => symbol.ticker));
export const ETF_PULSE_LEVERAGED_UNIVERSE_SIZE = ETF_PULSE_LEVERAGED_TICKERS.length;
export const ETF_PULSE_CONTEXT_BENCHMARK_COUNT = ETF_PULSE_CONTEXT_BENCHMARK_TICKERS.length;
export const ETF_PULSE_DISPLAYED_ROW_COUNT = ETF_PULSE_TICKERS.length;

import { ETF_PULSE_SYMBOLS } from './symbolRegistry.js';

export const ETF_PULSE_TICKERS = Object.freeze(ETF_PULSE_SYMBOLS.map(symbol => symbol.ticker));

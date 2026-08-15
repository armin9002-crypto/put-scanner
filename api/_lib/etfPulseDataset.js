import { mapWithConcurrency } from '../../shared/concurrency.js';
import { ETF_PULSE_TICKERS } from '../../shared/etfPulseUniverse.js';
import { fetchYahooChartHistory } from './chartHistory.js';

export const ETF_PULSE_DATASET_VERSION = 1;
export const ETF_PULSE_CONCURRENCY = 6;
const HISTORY_CONFIG = { range: '2y', interval: '1d', maxPoints: 800 };

export async function buildEtfPulseDataset(options = {}) {
  const tickers = [...new Set(options.tickers ?? ETF_PULSE_TICKERS)];
  const fetchHistory = options.fetchHistory ?? (ticker => fetchYahooChartHistory({
    ticker,
    timeframe: '2Y',
    config: HISTORY_CONFIG,
    endpoint: 'etf-pulse-history',
    timeoutMs: 6_000,
  }));
  let maxObservedConcurrency = 0;
  const settled = await mapWithConcurrency(tickers, options.concurrency ?? ETF_PULSE_CONCURRENCY, fetchHistory, {
    signal: options.signal,
    onActiveChange: active => { maxObservedConcurrency = Math.max(maxObservedConcurrency, active); },
  });
  const histories = {};
  const errors = [];
  let circuitBreakerRejections = 0;
  settled.forEach((result, index) => {
    const ticker = tickers[index];
    if (result.status === 'fulfilled') histories[ticker] = result.value;
    else {
      if (result.reason?.code === 'YAHOO_CIRCUIT_OPEN') circuitBreakerRejections += 1;
      errors.push({ ticker, message: result.reason instanceof Error ? result.reason.message : 'History unavailable' });
    }
  });
  return {
    datasetVersion: ETF_PULSE_DATASET_VERSION,
    fetchedAt: Date.now(),
    tickers,
    histories,
    errors,
    diagnostics: {
      upstreamRequests: tickers.length - circuitBreakerRejections,
      uniqueTickers: tickers.length,
      maxObservedConcurrency,
      circuitBreakerRejections,
    },
  };
}

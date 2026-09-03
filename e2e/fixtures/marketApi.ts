import type { Page, Route } from '@playwright/test';
import { ETF_PULSE_TICKERS } from '../../shared/etfPulseUniverse.js';
import { SCREENER_CHUNKS } from '../../shared/screenerUniverse.js';

const EXPIRATION = 1_798_761_600;
const NEAR_EXPIRATION = 1_789_689_600;
const SECOND_EXPIRATION = 1_801_180_800;

type MarketFixtureOptions = {
  failScreenerChunkOnce?: number;
  optionCount?: number;
  firstOptionBid?: number | null;
  firstOptionAsk?: number | null;
  firstOptionLast?: number | null;
  firstOptionVolume?: number | null;
  firstOptionOpenInterest?: number | null;
};

function optionChain(ticker: string, expiration = EXPIRATION, putCount = 2, overrides: MarketFixtureOptions = {}) {
  const count = Math.max(2, putCount);
  const expiry = new Date(expiration * 1000);
  const contractDate = `${String(expiry.getUTCFullYear()).slice(-2)}${String(expiry.getUTCMonth() + 1).padStart(2, '0')}${String(expiry.getUTCDate()).padStart(2, '0')}`;
  const puts = [
    { contractSymbol: `${ticker}${contractDate}P00090000`, strike: 90, lastPrice: overrides.firstOptionLast === undefined ? 2.1 : overrides.firstOptionLast, lastTradeDate: 1_788_000_000, bid: overrides.firstOptionBid === undefined ? 2 : overrides.firstOptionBid, ask: overrides.firstOptionAsk === undefined ? 2.2 : overrides.firstOptionAsk, change: 0.1, percentChange: 5, impliedVolatility: 0.48, volume: overrides.firstOptionVolume === undefined ? 120 : overrides.firstOptionVolume, openInterest: overrides.firstOptionOpenInterest === undefined ? 900 : overrides.firstOptionOpenInterest, delta: -0.2 },
    { contractSymbol: `${ticker}${contractDate}P00095000`, strike: 95, lastPrice: 3.4, lastTradeDate: 1_788_000_000, bid: 3.2, ask: 3.6, change: 0.2, percentChange: 6, impliedVolatility: 0.52, volume: 80, openInterest: 700, delta: -0.32 },
    ...Array.from({ length: Math.max(0, count - 2) }, (_, index) => {
      const strike = 96 + index;
      return {
        contractSymbol: `${ticker}${contractDate}P${String(strike * 1000).padStart(8, '0')}`,
        strike,
        lastPrice: 3.6 + index * 0.04,
        lastTradeDate: 1_788_000_000,
        bid: 3.4 + index * 0.04,
        ask: 3.8 + index * 0.04,
        change: 0.1,
        percentChange: 3,
        impliedVolatility: 0.52 + index * 0.001,
        volume: 70 + index,
        openInterest: 650 + index * 4,
        delta: -0.34 - index * 0.004,
      };
    }),
  ].slice(0, count);
  return { optionChain: { result: [{
    quote: { symbol: ticker, regularMarketPrice: 100, regularMarketChange: 1.25, regularMarketChangePercent: 1.27 },
    expirationDates: [NEAR_EXPIRATION, EXPIRATION, SECOND_EXPIRATION],
    options: [{ expirationDate: expiration, puts }],
  }], error: null } };
}

function chart(ticker: string) {
  const points = Array.from({ length: 260 }, (_, index) => ({ timestamp: 1_770_000_000 + index * 86_400, date: new Date((1_770_000_000 + index * 86_400) * 1000).toISOString(), price: 80 + index * 0.08 + Math.sin(index / 8) }));
  return { ticker, displayTicker: ticker.replace('^', ''), timeframe: '2Y', points, previousClose: 99, latestPrice: points.at(-1)?.price ?? 100, fetchedAt: 1_798_000_000_000, metadata: { range: '2y', interval: '1d', sourcePoints: points.length } };
}

function json(route: Route, body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  const requestId = route.request().headers()['x-putscanner-request-id'] || 'ps-e2e-server';
  const providerAttempts = extraHeaders['X-PutScanner-Provider-Attempts']
    ?? extraHeaders['X-PutScanner-Upstream-Requests']
    ?? '1';
  return route.fulfill({ status, contentType: 'application/json', headers: {
    'X-PutScanner-Request-Id': requestId,
    'X-PutScanner-Server-Duration-Ms': '4',
    'X-PutScanner-Retry-Count': '0',
    'X-PutScanner-Cache-Status': 'E2E',
    'X-PutScanner-Failure-Category': status < 400 ? 'none' : 'provider',
    'X-PutScanner-Upstream-Requests': '1',
    'X-PutScanner-Provider-Attempts': providerAttempts,
    ...extraHeaders,
  }, body: JSON.stringify(body) });
}

export async function installDeterministicMarketApi(page: Page, options: MarketFixtureOptions = {}) {
  const counts = new Map<string, number>();
  const delays = new Map<string, number>();
  const failNext = new Set<string>();
  const failuresRemaining = new Map<string, number>();
  const unavailableRequestedExpiry = new Set<string>();
  const aborted = new Map<string, number>();
  page.on('requestfailed', request => {
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) return;
    const endpoint = url.pathname.slice('/api/'.length);
    aborted.set(endpoint, (aborted.get(endpoint) ?? 0) + 1);
  });
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') return route.fallback();
    return route.abort('blockedbyclient');
  });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const endpoint = url.pathname.slice('/api/'.length);
    counts.set(endpoint, (counts.get(endpoint) ?? 0) + 1);
    const delayMs = delays.get(endpoint) ?? 0;
    if (delayMs > 0) await new Promise(resolve => setTimeout(resolve, delayMs));
    const remainingFailures = failuresRemaining.get(endpoint) ?? 0;
    if (remainingFailures > 0) {
      failuresRemaining.set(endpoint, remainingFailures - 1);
      return json(route, { error: 'E2E controlled failure' }, 503);
    }
    if (failNext.delete(endpoint)) return json(route, { error: 'E2E controlled failure' }, 503);
    if (endpoint === 'options') return json(route, optionChain((url.searchParams.get('ticker') || 'TQQQ').toUpperCase(), Number(url.searchParams.get('date')) || EXPIRATION, options.optionCount, options));
    if (endpoint === 'ticker-detail') {
      const ticker = (url.searchParams.get('ticker') || 'TQQQ').toUpperCase();
      const requestedExpiration = Number(url.searchParams.get('date')) || EXPIRATION;
      const optionsPayload = optionChain(ticker, unavailableRequestedExpiry.has(ticker) ? NEAR_EXPIRATION : requestedExpiration, options.optionCount, options);
      if (unavailableRequestedExpiry.has(ticker)) optionsPayload.optionChain.result[0].expirationDates = [NEAR_EXPIRATION, SECOND_EXPIRATION];
      return json(route, { availability: ticker === 'AAPL' ? 'no_options' : 'optionable', options: optionsPayload, extendedPrice: { price: 100, change: 1, changePercent: 1, fiveDay: 2, oneMonth: 4, threeMonth: 8, fiftyTwoWeekHighPct: -5, previousClose: 99, sparkline: [98, 99, 100] }, volatilityContext: { currentIV: 48, rangePosition: 52, observationPercent: 55, realizedVolLow: 20, realizedVolHigh: 60, observationCount: 252 } }, 200, { 'X-PutScanner-Upstream-Requests': '3' });
    }
    if (endpoint === 'prices') {
      const tickers = (url.searchParams.get('tickers') || 'TQQQ').split(',');
      return json(route, Object.fromEntries(tickers.map((ticker, index) => [ticker, { price: 100 + index, change: 1, changePct: 1, high52w: 120, low52w: 60, fiveDay: 2, oneMonth: 4, threeMonth: 8, fiftyTwoWeekHighPct: -16.7, posIn52wRange: 66 }])), 200, { 'X-PutScanner-Upstream-Requests': '1' });
    }
    if (endpoint === 'price') return json(route, { price: 100, change: 1, changePct: 1, previousClose: 99, sparkline: [98, 98.5, 99, 100], fiveDay: 2, oneMonth: 4, threeMonth: 8, fiftyTwoWeekHighPct: -5 });
    if (endpoint === 'fund-metadata') return json(route, Object.fromEntries((url.searchParams.get('symbols') || '').split(',').filter(Boolean).map(symbol => [symbol, 10_000_000_000])));
    if (endpoint === 'volatility-context' || endpoint === 'ivrank') return json(route, { currentIV: 48, rangePosition: 52, observationPercent: 55, realizedVolLow: 20, realizedVolHigh: 60, observationCount: 252 });
    if (endpoint === 'holdings') return json(route, { ticker: 'TQQQ', name: 'ProShares UltraPro QQQ', holdings: [{ symbol: 'NVDA', name: 'NVIDIA', weight: 8 }], topHoldingsCount: 1, topHoldingsWeight: 8, source: 'E2E', fetchedAt: 1_798_000_000_000 });
    if (endpoint === 'chart-history') {
      const payload = chart((url.searchParams.get('ticker') || 'TQQQ').toUpperCase());
      return json(route, url.searchParams.has('start') || url.searchParams.has('end') ? { ...payload, timeframe: 'custom' } : payload);
    }
    if (endpoint === 'screener-expirations') return json(route, { datasetVersion: 2, fetchedAt: 1_798_000_000_000, complete: true, expirationsByTicker: Object.fromEntries(SCREENER_CHUNKS.flatMap(chunk => chunk.tickers).map(ticker => [ticker, [NEAR_EXPIRATION, EXPIRATION, SECOND_EXPIRATION]])), errors: [], diagnostics: { upstreamRequests: 7, maxObservedConcurrency: 3, circuitBreakerRejections: 0 } }, 200, { 'X-PutScanner-Upstream-Requests': '7' });
    if (endpoint === 'screener-batch') {
      const chunkId = Number(url.searchParams.get('chunk'));
      const chunk = SCREENER_CHUNKS[chunkId];
      const attemptKey = `screener-${chunkId}`;
      const attempt = (counts.get(attemptKey) ?? 0) + 1;
      counts.set(attemptKey, attempt);
      if (options.failScreenerChunkOnce === chunkId && attempt === 1) return json(route, { error: 'E2E temporary batch failure' }, 503);
      const tickers = Object.fromEntries(chunk.tickers.map(ticker => [ticker, { ticker, expirationDates: [NEAR_EXPIRATION, EXPIRATION, SECOND_EXPIRATION], initialExpiration: NEAR_EXPIRATION, initial: optionChain(ticker, NEAR_EXPIRATION, options.optionCount, options), additionalChains: { [EXPIRATION]: optionChain(ticker, EXPIRATION, options.optionCount, options), [SECOND_EXPIRATION]: optionChain(ticker, SECOND_EXPIRATION, options.optionCount, options) }, ivVsRealizedRange: 50 }]));
      return json(route, { datasetVersion: 2, chunkId, targetDate: null, fetchedAt: 1_798_000_000_000, complete: true, tickers, errors: [], diagnostics: { plannedEtfs: 3, plannedOptionChains: 9, uniqueChains: 9, upstreamRequests: 9, maxObservedConcurrency: 3, circuitBreakerRejections: 0, elapsedMs: 5 } }, 200, { 'X-PutScanner-Upstream-Requests': '9' });
    }
    if (endpoint === 'etf-pulse') {
      const histories = Object.fromEntries(ETF_PULSE_TICKERS.map(ticker => [ticker, chart(ticker)]));
      return json(route, { datasetVersion: 1, fetchedAt: 1_798_000_000_000, tickers: [...ETF_PULSE_TICKERS], histories, errors: [], diagnostics: { upstreamRequests: ETF_PULSE_TICKERS.length, uniqueTickers: ETF_PULSE_TICKERS.length, maxObservedConcurrency: 6, circuitBreakerRejections: 0 } }, 200, { 'X-PutScanner-Upstream-Requests': String(ETF_PULSE_TICKERS.length) });
    }
    return json(route, { error: `Unmocked endpoint: ${endpoint}` }, 501);
  });
  return { counts, delays, failNext, failuresRemaining, unavailableRequestedExpiry, aborted };
}

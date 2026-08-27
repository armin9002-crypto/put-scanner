import { mapWithConcurrency } from '../../shared/concurrency.js';
import {
  SCREENER_CHUNKS,
  SCREENER_PREFETCH_TICKERS,
  SCREENER_SERVER_CONCURRENCY,
} from '../../shared/screenerUniverse.js';
import { fetchYahooVolatilityContext } from './ivRank.js';
import { fetchYahooOptions, normalizeTimestampSeconds } from './yahoo.js';

export const SCREENER_BATCH_VERSION = 2;
export const SCREENER_BATCH_TIMEOUT_MS = 6_000;
export const SCREENER_BATCH_MAX_BYTES = 750_000;

function compactContract(contract) {
  return {
    contractSymbol: contract?.contractSymbol ?? null,
    strike: contract?.strike ?? null,
    lastPrice: contract?.lastPrice ?? null,
    lastTradeDate: contract?.lastTradeDate ?? null,
    bid: contract?.bid ?? null,
    ask: contract?.ask ?? null,
    delta: contract?.delta ?? null,
    gamma: contract?.gamma ?? null,
    theta: contract?.theta ?? null,
    vega: contract?.vega ?? null,
    greeks: contract?.greeks,
    impliedVolatility: contract?.impliedVolatility ?? null,
    volume: contract?.volume ?? null,
    openInterest: contract?.openInterest ?? null,
  };
}

export function compactYahooOptionData(data) {
  const result = data?.optionChain?.result?.[0];
  if (!result) return { optionChain: { result: [] } };
  const chain = result.options?.[0];
  return {
    optionChain: {
      result: [{
        quote: { regularMarketPrice: result.quote?.regularMarketPrice ?? null },
        expirationDates: Array.isArray(result.expirationDates) ? result.expirationDates : [],
        options: chain ? [{
          expirationDate: chain.expirationDate ?? null,
          puts: Array.isArray(chain.puts) ? chain.puts.map(compactContract) : [],
        }] : [],
      }],
    },
  };
}

function optionMetadata(data) {
  const result = data?.optionChain?.result?.[0];
  const expirationDates = [...new Set((result?.expirationDates ?? []).map(normalizeTimestampSeconds).filter(value => value != null))].sort((a, b) => a - b);
  const returnedExpiration = normalizeTimestampSeconds(result?.options?.[0]?.expirationDate) ?? expirationDates[0] ?? null;
  return { expirationDates, returnedExpiration };
}

function errorMessage(error) {
  return error instanceof Error ? error.message : 'Yahoo acquisition failed';
}

export async function buildScreenerBatch(options = {}) {
  const chunk = SCREENER_CHUNKS.find(candidate => candidate.id === options.chunkId);
  if (!chunk) throw new RangeError('Invalid Screener chunk');
  const concurrency = options.concurrency ?? SCREENER_SERVER_CONCURRENCY;
  const fetchOptions = options.fetchOptions ?? ((ticker, date, requestOptions) => fetchYahooOptions(ticker, date, requestOptions));
  const fetchVolatilityContext = options.fetchVolatilityContext ?? options.fetchIvRank ?? ((ticker, requestOptions) => fetchYahooVolatilityContext(ticker, requestOptions));
  let upstreamRequests = 0;
  let maxObservedConcurrency = 0;
  let circuitBreakerRejections = 0;
  const onAttempt = () => { upstreamRequests += 1; };
  const errors = [];
  const tickerResults = {};
  const initialRaw = new Map();
  const startedAt = Date.now();
  const observe = active => { maxObservedConcurrency = Math.max(maxObservedConcurrency, active); };

  const initial = await mapWithConcurrency(chunk.tickers, concurrency, async ticker => {
    const data = await fetchOptions(ticker, null, { timeoutMs: SCREENER_BATCH_TIMEOUT_MS, onAttempt, signal: options.signal });
    return { ticker, data };
  }, { signal: options.signal, onActiveChange: observe });

  initial.forEach((result, index) => {
    const ticker = chunk.tickers[index];
    if (result.status === 'rejected') {
      if (result.reason?.code === 'YAHOO_CIRCUIT_OPEN') circuitBreakerRejections += 1;
      errors.push({ ticker, stage: 'initial', message: errorMessage(result.reason) });
      return;
    }
    const data = result.value.data;
    const metadata = optionMetadata(data);
    initialRaw.set(ticker, data);
    tickerResults[ticker] = {
      ticker,
      expirationDates: metadata.expirationDates,
      initialExpiration: metadata.returnedExpiration,
      initial: compactYahooOptionData(data),
      additionalChains: {},
      ivVsRealizedRange: null,
    };
  });

  const phaseTwoTasks = [];
  for (const [ticker, data] of initialRaw) {
    const metadata = optionMetadata(data);
    phaseTwoTasks.push({ kind: 'volatility-context', ticker, data });
    const targets = options.targetDate != null
      ? (metadata.expirationDates.includes(options.targetDate) ? [options.targetDate] : [])
      : metadata.expirationDates.slice(0, 2);
    [...new Set(targets)].filter(date => date !== metadata.returnedExpiration).forEach(date => {
      phaseTwoTasks.push({ kind: 'chain', ticker, date });
    });
  }

  const phaseTwo = await mapWithConcurrency(phaseTwoTasks, concurrency, async task => {
    if (task.kind === 'volatility-context') {
      return { ...task, value: await fetchVolatilityContext(task.ticker, { optionData: task.data, timeoutMs: SCREENER_BATCH_TIMEOUT_MS, onAttempt, signal: options.signal }) };
    }
    return { ...task, value: await fetchOptions(task.ticker, task.date, { timeoutMs: SCREENER_BATCH_TIMEOUT_MS, onAttempt, signal: options.signal }) };
  }, { signal: options.signal, onActiveChange: observe });

  phaseTwo.forEach((result, index) => {
    const task = phaseTwoTasks[index];
    if (result.status === 'rejected') {
      if (result.reason?.code === 'YAHOO_CIRCUIT_OPEN') circuitBreakerRejections += 1;
      errors.push({ ticker: task.ticker, stage: task.kind, expiration: task.date, message: errorMessage(result.reason) });
      return;
    }
    if (task.kind === 'volatility-context') tickerResults[task.ticker].ivVsRealizedRange = Number.isFinite(result.value.value?.rangePosition) ? result.value.value.rangePosition : null;
    else tickerResults[task.ticker].additionalChains[String(task.date)] = compactYahooOptionData(result.value.value);
  });

  const plannedOptionChains = initialRaw.size + phaseTwoTasks.filter(task => task.kind === 'chain').length;
  return {
    datasetVersion: SCREENER_BATCH_VERSION,
    chunkId: chunk.id,
    targetDate: options.targetDate ?? null,
    fetchedAt: Date.now(),
    complete: errors.length === 0,
    tickers: tickerResults,
    errors,
    diagnostics: {
      plannedEtfs: chunk.tickers.length,
      plannedOptionChains,
      uniqueChains: plannedOptionChains,
      upstreamRequests,
      maxObservedConcurrency,
      circuitBreakerRejections,
      elapsedMs: Date.now() - startedAt,
    },
  };
}

export async function buildScreenerExpirationDataset(options = {}) {
  const fetchOptions = options.fetchOptions ?? ((ticker, requestOptions) => fetchYahooOptions(ticker, null, requestOptions));
  let upstreamRequests = 0;
  let maxObservedConcurrency = 0;
  let circuitBreakerRejections = 0;
  const onAttempt = () => { upstreamRequests += 1; };
  const settled = await mapWithConcurrency(SCREENER_PREFETCH_TICKERS, options.concurrency ?? SCREENER_SERVER_CONCURRENCY, async ticker => ({
    ticker,
    data: await fetchOptions(ticker, { timeoutMs: SCREENER_BATCH_TIMEOUT_MS, onAttempt, signal: options.signal }),
  }), {
    signal: options.signal,
    onActiveChange: active => { maxObservedConcurrency = Math.max(maxObservedConcurrency, active); },
  });
  const expirationsByTicker = {};
  const errors = [];
  settled.forEach((result, index) => {
    const ticker = SCREENER_PREFETCH_TICKERS[index];
    if (result.status === 'fulfilled') expirationsByTicker[ticker] = optionMetadata(result.value.data).expirationDates;
    else {
      if (result.reason?.code === 'YAHOO_CIRCUIT_OPEN') circuitBreakerRejections += 1;
      errors.push({ ticker, message: errorMessage(result.reason) });
    }
  });
  return {
    datasetVersion: SCREENER_BATCH_VERSION,
    fetchedAt: Date.now(),
    complete: errors.length === 0,
    expirationsByTicker,
    errors,
    diagnostics: { upstreamRequests, maxObservedConcurrency, circuitBreakerRejections },
  };
}

export function responseBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

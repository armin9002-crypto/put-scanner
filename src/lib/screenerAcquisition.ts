import { mapWithConcurrency } from '../../shared/concurrency.js';
import {
  SCREENER_BROWSER_CONCURRENCY,
  SCREENER_CHUNKS,
  type ScreenerChunk,
} from '../../shared/screenerUniverse.js';
import { requestMarketData, peekMarketData, type MarketDataRequestMeta } from './marketDataRequest.ts';
import { primeOptionsMarketDataCache } from './optionChainCache.ts';
import { canonicalOptionChainKey } from './optionChainRequests.ts';
import {
  beginScreenerScanDiagnostics,
  finishScreenerScanDiagnostics,
  observeScreenerClientConcurrency,
  fetchObservedMarketData,
  recordScreenerScanBatch,
} from './requestDiagnostics.ts';
import type { OptionsChainData, OptionChainSource } from './types.ts';
import { normalizeOptionChainData } from './yahooOptionAdapter.ts';

const SCREENER_DATASET_VERSION = 2;
const BATCH_SOFT_TTL_MS = 5 * 60 * 1_000;
const BATCH_HARD_TTL_MS = 45 * 60 * 1_000;
const EXPIRATION_SOFT_TTL_MS = 2 * 60 * 60 * 1_000;
const EXPIRATION_HARD_TTL_MS = 8 * 60 * 60 * 1_000;

interface BatchTickerPayload {
  ticker: string;
  expirationDates: number[];
  initialExpiration: number | null;
  initial: unknown;
  additionalChains: Record<string, unknown>;
  ivVsRealizedRange: number | null;
}

export interface ScreenerBatchPayload {
  datasetVersion: number;
  chunkId: number;
  targetDate: number | null;
  fetchedAt: number;
  complete: boolean;
  tickers: Record<string, BatchTickerPayload>;
  errors: Array<{ ticker?: string; stage?: string; expiration?: number; message: string }>;
  diagnostics: {
    plannedEtfs: number;
    plannedOptionChains: number;
    uniqueChains: number;
    upstreamRequests: number;
    maxObservedConcurrency: number;
    circuitBreakerRejections: number;
    elapsedMs: number;
  };
}

interface ScreenerExpirationPayload {
  datasetVersion: number;
  fetchedAt: number;
  complete: boolean;
  expirationsByTicker: Record<string, number[]>;
  errors: Array<{ ticker?: string; message: string }>;
  diagnostics: {
    upstreamRequests: number;
    maxObservedConcurrency: number;
    circuitBreakerRejections: number;
  };
}

export interface ScreenerBatchPlan {
  chunkId: number;
  chunkTickers: readonly string[];
  selectedTickers: string[];
  targetDate: number | null;
  cacheKey: string;
}

export interface ScreenerBatchFetchResult {
  payload: ScreenerBatchPayload;
  meta: MarketDataRequestMeta;
}

export interface ScreenerScanResult {
  initialResults: Map<string, OptionsChainData>;
  chainsByKey: Map<string, OptionsChainData>;
  ivVsRealizedRangeByTicker: Map<string, number | null>;
  errors: Array<{ batchId: number; ticker?: string; message: string }>;
  plannedBatches: number;
  completedBatches: number;
  failedBatchIds: number[];
}

export interface LatestScreenerScan {
  id: string;
  signal: AbortSignal;
  isCurrent: () => boolean;
}

export function createLatestScreenerScanGate() {
  let generation = 0;
  let controller: AbortController | null = null;
  return {
    begin(): LatestScreenerScan {
      generation += 1;
      controller?.abort();
      controller = new AbortController();
      const currentGeneration = generation;
      return {
        id: `screener-${currentGeneration}-${Date.now()}`,
        signal: controller.signal,
        isCurrent: () => currentGeneration === generation && controller?.signal.aborted === false,
      };
    },
    cancel(): void {
      generation += 1;
      controller?.abort();
      controller = null;
    },
  };
}

export function screenerTargetDate(expFilter: string): number | null {
  if (!expFilter.startsWith('date_')) return null;
  const value = Number.parseInt(expFilter.slice(5), 10);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function planScreenerBatches(selectedTickers: readonly string[], expFilter: string): ScreenerBatchPlan[] {
  const selected = new Set(selectedTickers.map(ticker => ticker.trim().toUpperCase()));
  const targetDate = screenerTargetDate(expFilter);
  return (SCREENER_CHUNKS as readonly ScreenerChunk[]).flatMap(chunk => {
    const selectedInChunk = chunk.tickers.filter(ticker => selected.has(ticker));
    if (selectedInChunk.length === 0) return [];
    return [{
      chunkId: chunk.id,
      chunkTickers: chunk.tickers,
      selectedTickers: [...selectedInChunk],
      targetDate,
      cacheKey: `screener_batch_v${SCREENER_DATASET_VERSION}_${chunk.id}_${targetDate ?? 'nearest'}`,
    }];
  });
}

function isBatchPayload(value: ScreenerBatchPayload): boolean {
  return value != null
    && value.datasetVersion === SCREENER_DATASET_VERSION
    && Number.isInteger(value.chunkId)
    && typeof value.complete === 'boolean'
    && value.tickers != null
    && typeof value.tickers === 'object'
    && Array.isArray(value.errors)
    && value.diagnostics != null;
}

function isExpirationPayload(value: ScreenerExpirationPayload): boolean {
  return value != null
    && value.datasetVersion === SCREENER_DATASET_VERSION
    && typeof value.complete === 'boolean'
    && value.expirationsByTicker != null
    && typeof value.expirationsByTicker === 'object'
    && Array.isArray(value.errors);
}

function responseError(response: Response, fallback: string): Error & { status?: number } {
  const error = new Error(fallback) as Error & { status?: number };
  error.status = response.status;
  return error;
}

export async function fetchScreenerBatch(plan: ScreenerBatchPlan, options: { signal?: AbortSignal; forceRefresh?: boolean } = {}): Promise<ScreenerBatchFetchResult> {
  const requestOptions = {
    key: plan.cacheKey,
    softTtlMs: BATCH_SOFT_TTL_MS,
    hardTtlMs: BATCH_HARD_TTL_MS,
    schemaVersion: SCREENER_DATASET_VERSION,
    validator: isBatchPayload,
    storage: 'none' as const,
  };
  const cached = peekMarketData<ScreenerBatchPayload>(requestOptions);
  const result = await requestMarketData<ScreenerBatchPayload>({
    ...requestOptions,
    source: 'Screener:batch',
    endpoint: 'screener-batch',
    mode: options.forceRefresh || (cached && !cached.data.complete) ? 'revalidate' : 'cache-first',
    priority: 'bulk_manual',
    allowStaleOnError: true,
    timeoutMs: 58_000,
    signal: options.signal,
    fetcher: async signal => {
      const query = new URLSearchParams({ chunk: String(plan.chunkId) });
      if (plan.targetDate != null) query.set('date', String(plan.targetDate));
      const response = await fetchObservedMarketData('screener-batch', `/api/screener-batch?${query}`, { signal }, 'Screener:batch');
      if (!response.ok) throw responseError(response, `Screener batch ${plan.chunkId + 1} failed (${response.status})`);
      return response.json() as Promise<ScreenerBatchPayload>;
    },
  });
  return { payload: result.data, meta: result.meta };
}

function sourceFromMeta(meta: MarketDataRequestMeta): OptionChainSource {
  if (meta.source === 'network') return 'network';
  if (meta.source === 'stale-fallback' || meta.freshness === 'stale') return 'stale';
  return 'cache';
}

function normalizeBatchChain(raw: unknown, ticker: string, date: number | undefined, meta: MarketDataRequestMeta): OptionsChainData {
  return normalizeOptionChainData(raw, ticker, date, `screener:${ticker}:${date ?? 'initial'}`, sourceFromMeta(meta), null);
}

function primeOptionsChainCache(ticker: string, date: number | undefined, data: OptionsChainData): boolean {
  return primeOptionsMarketDataCache(ticker, date, data);
}

export async function runScreenerBatchScan(options: {
  scanId: string;
  selectedTickers: readonly string[];
  expFilter: string;
  signal?: AbortSignal;
  forceRefresh?: boolean;
  fetchBatch?: (plan: ScreenerBatchPlan) => Promise<ScreenerBatchFetchResult>;
  onProgress?: (completedEtfs: number, totalEtfs: number) => void;
}): Promise<ScreenerScanResult> {
  const plans = planScreenerBatches(options.selectedTickers, options.expFilter);
  const selected = new Set(options.selectedTickers.map(ticker => ticker.trim().toUpperCase()));
  const fetchBatch = options.fetchBatch ?? (plan => fetchScreenerBatch(plan, { signal: options.signal, forceRefresh: options.forceRefresh }));
  const initialResults = new Map<string, OptionsChainData>();
  const chainsByKey = new Map<string, OptionsChainData>();
  const ivVsRealizedRangeByTicker = new Map<string, number | null>();
  const errors: ScreenerScanResult['errors'] = [];
  let completedEtfs = 0;
  let rejectedBatchFailures = 0;
  const failedBatchIds = new Set<number>();
  beginScreenerScanDiagnostics(options.scanId, selected.size, plans.length);

  const settled = await mapWithConcurrency(plans, SCREENER_BROWSER_CONCURRENCY, async plan => {
    try {
      if (options.signal?.aborted) throw new DOMException('Operation aborted', 'AbortError');
      const result = await fetchBatch(plan);
      return { plan, result };
    } finally {
      completedEtfs += plan.selectedTickers.length;
      options.onProgress?.(completedEtfs, selected.size);
    }
  }, {
    signal: options.signal,
    onActiveChange: active => {
      observeScreenerClientConcurrency(options.scanId, active);
    },
  });

  settled.forEach((batchResult, index) => {
    const plan = plans[index];
    if (batchResult.status === 'rejected') {
      if (batchResult.reason?.name !== 'AbortError') {
        failedBatchIds.add(plan.chunkId);
        rejectedBatchFailures += 1;
        errors.push({ batchId: plan.chunkId, message: batchResult.reason instanceof Error ? batchResult.reason.message : 'Screener batch failed' });
      }
      return;
    }
    const { payload, meta } = batchResult.value.result;
    if (!payload.complete || payload.errors.length > 0) failedBatchIds.add(plan.chunkId);
    recordScreenerScanBatch(options.scanId, {
      networkCall: meta.networkCall,
      plannedOptionChains: payload.diagnostics.plannedOptionChains,
      uniqueChains: payload.diagnostics.uniqueChains,
      upstreamRequests: payload.diagnostics.upstreamRequests,
      maxServerConcurrency: payload.diagnostics.maxObservedConcurrency,
      failures: payload.errors.length,
      circuitBreakerRejections: payload.diagnostics.circuitBreakerRejections,
    });
    payload.errors.forEach(error => errors.push({ batchId: plan.chunkId, ticker: error.ticker, message: error.message }));
    Object.values(payload.tickers).forEach(tickerPayload => {
      const ticker = tickerPayload.ticker.trim().toUpperCase();
      if (!selected.has(ticker)) return;
      const initial = normalizeBatchChain(tickerPayload.initial, ticker, undefined, meta);
      initialResults.set(ticker, initial);
      primeOptionsChainCache(ticker, undefined, initial);
      if (tickerPayload.initialExpiration != null) {
        chainsByKey.set(canonicalOptionChainKey(ticker, tickerPayload.initialExpiration), initial);
        primeOptionsChainCache(ticker, tickerPayload.initialExpiration, initial);
      }
      Object.entries(tickerPayload.additionalChains).forEach(([rawDate, rawChain]) => {
        const date = Number(rawDate);
        if (!Number.isInteger(date) || date <= 0) return;
        const chain = normalizeBatchChain(rawChain, ticker, date, meta);
        chainsByKey.set(canonicalOptionChainKey(ticker, date), chain);
        primeOptionsChainCache(ticker, date, chain);
      });
      ivVsRealizedRangeByTicker.set(ticker, Number.isFinite(tickerPayload.ivVsRealizedRange) ? tickerPayload.ivVsRealizedRange : null);
    });
  });
  finishScreenerScanDiagnostics(options.scanId, rejectedBatchFailures);

  return {
    initialResults,
    chainsByKey,
    ivVsRealizedRangeByTicker,
    errors,
    plannedBatches: plans.length,
    completedBatches: settled.filter(result => result.status === 'fulfilled').length,
    failedBatchIds: [...failedBatchIds].sort((a, b) => a - b),
  };
}

export async function retryFailedScreenerBatches(options: {
  scanId: string;
  selectedTickers: readonly string[];
  expFilter: string;
  failedBatchIds: readonly number[];
  previous: ScreenerScanResult;
  signal?: AbortSignal;
  fetchBatch?: (plan: ScreenerBatchPlan) => Promise<ScreenerBatchFetchResult>;
  onProgress?: (completedEtfs: number, totalEtfs: number) => void;
}): Promise<ScreenerScanResult> {
  const failed = new Set(options.failedBatchIds);
  const retryTickers = planScreenerBatches(options.selectedTickers, options.expFilter)
    .filter(plan => failed.has(plan.chunkId))
    .flatMap(plan => plan.selectedTickers);
  if (retryTickers.length === 0) return options.previous;
  const retried = await runScreenerBatchScan({
    scanId: options.scanId,
    selectedTickers: retryTickers,
    expFilter: options.expFilter,
    signal: options.signal,
    forceRefresh: true,
    fetchBatch: options.fetchBatch,
    onProgress: options.onProgress,
  });
  return {
    initialResults: new Map([...options.previous.initialResults, ...retried.initialResults]),
    chainsByKey: new Map([...options.previous.chainsByKey, ...retried.chainsByKey]),
    ivVsRealizedRangeByTicker: new Map([...options.previous.ivVsRealizedRangeByTicker, ...retried.ivVsRealizedRangeByTicker]),
    errors: [...options.previous.errors.filter(error => !failed.has(error.batchId)), ...retried.errors],
    plannedBatches: options.previous.plannedBatches,
    completedBatches: Math.max(0, options.previous.plannedBatches - retried.failedBatchIds.length),
    failedBatchIds: retried.failedBatchIds,
  };
}

export async function fetchScreenerExpirations(): Promise<Array<{ date: number; dte: number }>> {
  const key = `screener_expirations_v${SCREENER_DATASET_VERSION}`;
  const result = await requestMarketData<ScreenerExpirationPayload>({
    key,
    source: 'Screener:expirations',
    endpoint: 'screener-expirations',
    softTtlMs: EXPIRATION_SOFT_TTL_MS,
    hardTtlMs: EXPIRATION_HARD_TTL_MS,
    schemaVersion: SCREENER_DATASET_VERSION,
    mode: 'cache-first',
    priority: 'background_reuse',
    allowStaleOnError: true,
    timeoutMs: 45_000,
    storage: 'session',
    validator: isExpirationPayload,
    fetcher: async signal => {
      const response = await fetchObservedMarketData('screener-expirations', '/api/screener-expirations', { signal }, 'Screener:expirations');
      if (!response.ok) throw responseError(response, `Screener expirations failed (${response.status})`);
      return response.json() as Promise<ScreenerExpirationPayload>;
    },
  });
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()) / 1_000;
  const dates = new Set<number>();
  Object.values(result.data.expirationsByTicker).forEach(values => values.forEach(value => {
    if (Number.isInteger(value) && value > 0) dates.add(value);
  }));
  return [...dates].sort((a, b) => a - b).map(date => ({ date, dte: Math.max(0, Math.round((date - todayUtc) / 86_400)) }));
}

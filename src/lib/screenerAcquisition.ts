import { mapWithConcurrency } from '../../shared/concurrency.js';
import {
  SCREENER_BROWSER_CONCURRENCY,
  SCREENER_CHUNKS,
  SCREENER_TICKERS,
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
import { calculateDte } from './optionMetrics.ts';

const SCREENER_DATASET_VERSION = 4;
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
  eligibleExpirationDates: number[];
  selectedExpirationDates: number[];
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

export interface ScreenerExpirationAvailability {
  expirationsByTicker: Record<string, number[]>;
  complete: boolean;
  errors: Array<{ ticker?: string; message: string }>;
}

export type ScreenerExpirationEvidence = 'present' | 'absent' | 'unknown';

/**
 * An expiration is only allowed to be called absent when the provider gave a
 * complete, ticker-specific discovery response with no matching error.
 */
export function classifyScreenerExpirationEvidence(
  availability: ScreenerExpirationAvailability,
  ticker: string,
  expirationDate: number,
): ScreenerExpirationEvidence {
  const normalizedTicker = ticker.trim().toUpperCase();
  if (!availability.complete || availability.errors.some(error => error.ticker == null || error.ticker.trim().toUpperCase() === normalizedTicker)) return 'unknown';
  const dates = availability.expirationsByTicker[normalizedTicker];
  if (!Array.isArray(dates)) return 'unknown';
  return dates.includes(expirationDate) ? 'present' : 'absent';
}

export interface ScreenerBatchPlan {
  chunkId: number;
  chunkTickers: readonly string[];
  selectedTickers: string[];
  targetDate: number | null;
  cacheKey: string;
  recommendationUniverse?: {
    minimumDte: number;
    maximumDte: number;
    maximumExpirations: number;
  };
}

export interface ScreenerBatchFetchResult {
  payload: ScreenerBatchPayload;
  meta: MarketDataRequestMeta;
}

export interface ScreenerCoverage {
  plannedBatches: number;
  successfulBatches: number;
  failedBatches: number;
  retainedBatches: number;
  plannedUnderlyings: number;
  analyzedUnderlyings: number;
  incompleteUnderlyings: number;
  acquiredChains: number;
  acquiredContracts: number;
}

export function emptyScreenerCoverage(): ScreenerCoverage {
  return {
    plannedBatches: 0,
    successfulBatches: 0,
    failedBatches: 0,
    retainedBatches: 0,
    plannedUnderlyings: 0,
    analyzedUnderlyings: 0,
    incompleteUnderlyings: 0,
    acquiredChains: 0,
    acquiredContracts: 0,
  };
}

export interface ScreenerScanResult {
  initialResults: Map<string, OptionsChainData>;
  chainsByKey: Map<string, OptionsChainData>;
  ivVsRealizedRangeByTicker: Map<string, number | null>;
  errors: Array<{ batchId: number; ticker?: string; message: string }>;
  plannedBatches: number;
  completedBatches: number;
  failedBatchIds: number[];
  retainedBatchIds?: number[];
  batchProvenance?: Array<{ batchId: number; source: MarketDataRequestMeta['source']; fetchedAt: number; staleFallbackUsed: boolean }>;
  incompleteTickers?: string[];
  coverage?: ScreenerCoverage;
  expirationPlansByTicker: Map<string, {
    availableExpirationDates: number[];
    eligibleExpirationDates: number[];
    selectedExpirationDates: number[];
    discoveryExpiration: number | null;
  }>;
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

/** Stable key for the criteria that actually change the upstream Screener dataset. */
export function screenerDatasetScopeKey(selectedTickerKey: string, expFilter: string): string {
  return `${selectedTickerKey}::${screenerTargetDate(expFilter) ?? 'standard-expirations'}`;
}

export function planScreenerBatches(
  selectedTickers: readonly string[],
  expFilter: string,
  recommendationUniverse?: ScreenerBatchPlan['recommendationUniverse'],
): ScreenerBatchPlan[] {
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
      cacheKey: `screener_batch_v${SCREENER_DATASET_VERSION}_${chunk.id}_${targetDate ?? (recommendationUniverse ? `representative_${recommendationUniverse.minimumDte}_${recommendationUniverse.maximumDte}_${recommendationUniverse.maximumExpirations}` : 'nearest')}`,
      recommendationUniverse,
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
  if (!(value != null
    && value.datasetVersion === SCREENER_DATASET_VERSION
    && typeof value.complete === 'boolean'
    && value.expirationsByTicker != null
    && typeof value.expirationsByTicker === 'object'
    && Array.isArray(value.errors))) return false;
  const expected = new Set(SCREENER_TICKERS as readonly string[]);
  const received = Object.keys(value.expirationsByTicker).map(ticker => ticker.trim().toUpperCase());
  if (received.some(ticker => !expected.has(ticker))) return false;
  return !value.complete || received.length === expected.size;
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
      const query = new URLSearchParams({ chunk: String(plan.chunkId), v: String(SCREENER_DATASET_VERSION) });
      if (plan.targetDate != null) query.set('date', String(plan.targetDate));
      if (plan.recommendationUniverse) {
        query.set('recommendations', '1');
        query.set('minDte', String(plan.recommendationUniverse.minimumDte));
        query.set('maxDte', String(plan.recommendationUniverse.maximumDte));
      }
      const response = await fetchObservedMarketData('screener-batch', `/api/screener-batch?${query}`, { signal }, 'Screener:batch');
      if (!response.ok) throw responseError(response, `Screener batch ${plan.chunkId + 1} failed (${response.status})`);
      return response.json() as Promise<ScreenerBatchPayload>;
    },
  });
  return { payload: result.data, meta: result.meta };
}

function sourceFromMeta(meta: MarketDataRequestMeta): OptionChainSource {
  if (meta.source === 'network') return 'network';
  if (meta.source === 'stale-fallback') return 'stale';
  return 'cache';
}

function normalizeBatchChain(raw: unknown, ticker: string, date: number | undefined, meta: MarketDataRequestMeta): OptionsChainData {
  return normalizeOptionChainData(raw, ticker, date, `screener:${ticker}:${date ?? 'initial'}`, sourceFromMeta(meta), null, {
    observedAt: meta.fetchedAt,
    cachedAt: meta.cachedAt,
    freshness: meta.freshness,
    staleFallbackUsed: meta.staleFallbackUsed,
    retentionReason: meta.staleFallbackUsed ? 'Screener batch refresh failed; prior batch evidence was retained.' : null,
  });
}

function primeOptionsChainCache(ticker: string, date: number | undefined, data: OptionsChainData): boolean {
  return primeOptionsMarketDataCache(ticker, date, data);
}

function acquiredContractCount(chainsByKey: Map<string, OptionsChainData>): number {
  const contracts = new Set<string>();
  chainsByKey.forEach((chain, chainKey) => {
    chain.puts.forEach(put => {
      const contractIdentity = put.contractSymbol ?? `strike:${put.strike}`;
      contracts.add(`${chainKey}|${contractIdentity}`);
    });
  });
  return contracts.size;
}

function fallbackCoverage(result: ScreenerScanResult): ScreenerCoverage {
  const incomplete = result.incompleteTickers?.length ?? Math.max(0, result.plannedBatches - result.completedBatches);
  return {
    plannedBatches: result.plannedBatches,
    successfulBatches: Math.max(0, result.completedBatches - result.failedBatchIds.length),
    failedBatches: result.failedBatchIds.length,
    retainedBatches: result.retainedBatchIds?.length ?? 0,
    plannedUnderlyings: result.initialResults.size + incomplete,
    analyzedUnderlyings: result.initialResults.size,
    incompleteUnderlyings: incomplete,
    acquiredChains: result.chainsByKey.size,
    acquiredContracts: acquiredContractCount(result.chainsByKey),
  };
}

export async function runScreenerBatchScan(options: {
  scanId: string;
  selectedTickers: readonly string[];
  expFilter: string;
  signal?: AbortSignal;
  forceRefresh?: boolean;
  recommendationUniverse?: ScreenerBatchPlan['recommendationUniverse'];
  fetchBatch?: (plan: ScreenerBatchPlan) => Promise<ScreenerBatchFetchResult>;
  onProgress?: (completedEtfs: number, totalEtfs: number) => void;
}): Promise<ScreenerScanResult> {
  const plans = planScreenerBatches(options.selectedTickers, options.expFilter, options.recommendationUniverse);
  const selected = new Set(options.selectedTickers.map(ticker => ticker.trim().toUpperCase()));
  const fetchBatch = options.fetchBatch ?? (plan => fetchScreenerBatch(plan, { signal: options.signal, forceRefresh: options.forceRefresh }));
  const initialResults = new Map<string, OptionsChainData>();
  const chainsByKey = new Map<string, OptionsChainData>();
  const ivVsRealizedRangeByTicker = new Map<string, number | null>();
  const errors: ScreenerScanResult['errors'] = [];
  let completedEtfs = 0;
  let rejectedBatchFailures = 0;
  const failedBatchIds = new Set<number>();
  const successfulBatchIds = new Set<number>();
  const retainedBatchIds = new Set<number>();
  const incompleteTickers = new Set<string>();
  const batchProvenance: ScreenerScanResult['batchProvenance'] = [];
  const expirationPlansByTicker = new Map<string, {
    availableExpirationDates: number[];
    eligibleExpirationDates: number[];
    selectedExpirationDates: number[];
    discoveryExpiration: number | null;
  }>();
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
        plan.selectedTickers.forEach(ticker => incompleteTickers.add(ticker));
        rejectedBatchFailures += 1;
        errors.push({ batchId: plan.chunkId, message: batchResult.reason instanceof Error ? batchResult.reason.message : 'Screener batch failed' });
      }
      return;
    }
    const { payload, meta } = batchResult.value.result;
    const normalizedPayloadTickers = new Set(Object.keys(payload.tickers).map(ticker => ticker.trim().toUpperCase()));
    const relevantErrors = payload.errors.filter(error => error.ticker == null || selected.has(error.ticker.trim().toUpperCase()));
    const missingSelectedTickers = plan.selectedTickers.filter(ticker => !normalizedPayloadTickers.has(ticker));
    const batchIncomplete = !payload.complete || relevantErrors.length > 0 || meta.staleFallbackUsed;
    if (batchIncomplete) {
      failedBatchIds.add(plan.chunkId);
      if (meta.staleFallbackUsed) plan.selectedTickers.forEach(ticker => incompleteTickers.add(ticker));
      missingSelectedTickers.forEach(ticker => incompleteTickers.add(ticker));
      relevantErrors.forEach(error => {
        if (error.ticker) incompleteTickers.add(error.ticker.trim().toUpperCase());
      });
      if (missingSelectedTickers.length === 0 && relevantErrors.every(error => error.ticker == null)) {
        plan.selectedTickers.forEach(ticker => incompleteTickers.add(ticker));
      }
    } else {
      successfulBatchIds.add(plan.chunkId);
    }
    if (meta.staleFallbackUsed) retainedBatchIds.add(plan.chunkId);
    batchProvenance?.push({ batchId: plan.chunkId, source: meta.source, fetchedAt: meta.fetchedAt, staleFallbackUsed: meta.staleFallbackUsed });
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
      const selectedExpirations = Array.isArray(tickerPayload.selectedExpirationDates)
        ? tickerPayload.selectedExpirationDates.filter(date => Number.isInteger(date) && date > 0)
        : initial.expirations.slice(0, 2).map(expiration => expiration.date);
      const eligibleExpirations = Array.isArray(tickerPayload.eligibleExpirationDates)
        ? tickerPayload.eligibleExpirationDates.filter(date => Number.isInteger(date) && date > 0)
        : selectedExpirations;
      expirationPlansByTicker.set(ticker, {
        availableExpirationDates: initial.expirations.map(expiration => expiration.date),
        eligibleExpirationDates: eligibleExpirations,
        selectedExpirationDates: selectedExpirations,
        discoveryExpiration: tickerPayload.initialExpiration,
      });
      if (tickerPayload.initialExpiration != null && selectedExpirations.includes(tickerPayload.initialExpiration)) {
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
    retainedBatchIds: [...retainedBatchIds].sort((a, b) => a - b),
    batchProvenance,
    incompleteTickers: [...incompleteTickers].sort(),
    coverage: {
      plannedBatches: plans.length,
      successfulBatches: successfulBatchIds.size,
      failedBatches: failedBatchIds.size,
      retainedBatches: retainedBatchIds.size,
      plannedUnderlyings: selected.size,
      analyzedUnderlyings: initialResults.size,
      incompleteUnderlyings: incompleteTickers.size,
      acquiredChains: chainsByKey.size,
      acquiredContracts: acquiredContractCount(chainsByKey),
    },
    expirationPlansByTicker,
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
    recommendationUniverse: undefined,
    fetchBatch: options.fetchBatch,
    onProgress: options.onProgress,
  });
  const previousCoverage = options.previous.coverage ?? fallbackCoverage(options.previous);
  const mergedInitialResults = new Map([...options.previous.initialResults, ...retried.initialResults]);
  const mergedChainsByKey = new Map([...options.previous.chainsByKey, ...retried.chainsByKey]);
  const incompleteTickers = new Set(options.previous.incompleteTickers ?? []);
  retryTickers.forEach(ticker => incompleteTickers.delete(ticker));
  (retried.incompleteTickers ?? []).forEach(ticker => incompleteTickers.add(ticker));
  return {
    initialResults: mergedInitialResults,
    chainsByKey: mergedChainsByKey,
    ivVsRealizedRangeByTicker: new Map([...options.previous.ivVsRealizedRangeByTicker, ...retried.ivVsRealizedRangeByTicker]),
    errors: [...options.previous.errors.filter(error => !failed.has(error.batchId)), ...retried.errors],
    plannedBatches: options.previous.plannedBatches,
    completedBatches: Math.max(0, options.previous.plannedBatches - retried.failedBatchIds.length),
    failedBatchIds: retried.failedBatchIds,
    retainedBatchIds: retried.retainedBatchIds,
    batchProvenance: [...(options.previous.batchProvenance ?? []).filter(item => !failed.has(item.batchId)), ...(retried.batchProvenance ?? [])],
    incompleteTickers: [...incompleteTickers].sort(),
    coverage: {
      plannedBatches: previousCoverage.plannedBatches,
      successfulBatches: previousCoverage.successfulBatches + (retried.coverage?.successfulBatches ?? 0),
      failedBatches: retried.failedBatchIds.length,
      retainedBatches: retried.retainedBatchIds?.length ?? 0,
      plannedUnderlyings: previousCoverage.plannedUnderlyings,
      analyzedUnderlyings: mergedInitialResults.size,
      incompleteUnderlyings: incompleteTickers.size,
      acquiredChains: mergedChainsByKey.size,
      acquiredContracts: acquiredContractCount(mergedChainsByKey),
    },
    expirationPlansByTicker: new Map([...options.previous.expirationPlansByTicker, ...retried.expirationPlansByTicker]),
  };
}

async function fetchScreenerExpirationPayload(options: { signal?: AbortSignal } = {}): Promise<ScreenerExpirationPayload> {
  const key = `screener_expirations_v${SCREENER_DATASET_VERSION}`;
  const cacheOptions = {
    key,
    softTtlMs: EXPIRATION_SOFT_TTL_MS,
    hardTtlMs: EXPIRATION_HARD_TTL_MS,
    schemaVersion: SCREENER_DATASET_VERSION,
    storage: 'session' as const,
    validator: isExpirationPayload,
  };
  const cached = peekMarketData<ScreenerExpirationPayload>(cacheOptions);
  const result = await requestMarketData<ScreenerExpirationPayload>({
    ...cacheOptions,
    source: 'Screener:expirations',
    endpoint: 'screener-expirations',
    mode: cached && !cached.data.complete ? 'revalidate' : 'cache-first',
    signal: options.signal,
    priority: 'background_reuse',
    allowStaleOnError: true,
    timeoutMs: 45_000,
    fetcher: async signal => {
      const response = await fetchObservedMarketData('screener-expirations', `/api/screener-expirations?v=${SCREENER_DATASET_VERSION}`, { signal }, 'Screener:expirations');
      if (!response.ok) throw responseError(response, `Screener expirations failed (${response.status})`);
      return response.json() as Promise<ScreenerExpirationPayload>;
    },
  });
  return result.data;
}

export async function fetchScreenerExpirationAvailability(options: { signal?: AbortSignal } = {}): Promise<ScreenerExpirationAvailability> {
  const payload = await fetchScreenerExpirationPayload(options);
  const expirationsByTicker = Object.fromEntries(Object.entries(payload.expirationsByTicker).map(([ticker, values]) => [
    ticker.trim().toUpperCase(),
    [...new Set(values.filter(value => Number.isInteger(value) && value > 0))].sort((a, b) => a - b),
  ]));
  return { expirationsByTicker, complete: payload.complete, errors: payload.errors };
}

export async function fetchScreenerExpirations(options: { signal?: AbortSignal } = {}): Promise<Array<{ date: number; dte: number }>> {
  const availability = await fetchScreenerExpirationAvailability(options);
  const dates = new Set<number>();
  Object.values(availability.expirationsByTicker).forEach(values => values.forEach(value => {
    if (Number.isInteger(value) && value > 0) dates.add(value);
  }));
  return [...dates]
    .sort((a, b) => a - b)
    .map(date => ({ date, dte: calculateDte(date) }))
    .filter((expiration): expiration is { date: number; dte: number } => expiration.dte != null && expiration.dte >= 0);
}

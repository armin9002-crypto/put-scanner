import { SCREENER_TICKERS } from '../../../shared/screenerUniverse.js';
import { buildEtfPulseRows, getEtfPulseUniverse, type EtfPulseLoadResult, type EtfPulseProgress } from '../etfPulseData.ts';
import { withEtfPulseTechnicalAssessment, type EtfPulseRow } from '../etfPulseMetrics.ts';
import { analyzeRegime } from '../marketRead/regime.ts';
import { postureFromRegime } from '../marketRead/posture.ts';
import { runScreenerBatchScan, type ScreenerScanResult } from '../screenerAcquisition.ts';
import { buildScreenerRows } from '../screenerRows.ts';
import { runRecommendationEngine } from './engine.ts';
import { assessUnderlyingUniverse } from './underlying.ts';
import {
  RECOMMENDATION_ENGINE_VERSION,
  RECOMMENDATION_POLICY_VERSION,
  recommendationUniverse,
  type RecommendationChainSnapshot,
  type RecommendationRun,
  type RecommendationSnapshot,
} from './types.ts';

export interface RecommendationRefreshProgress {
  stage: 'UNDERLYINGS' | 'CONTRACTS' | 'DECISION';
  completed: number;
  total: number;
  ticker?: string;
}

export interface RecommendationRefreshResult {
  snapshot: RecommendationSnapshot;
  run: RecommendationRun;
}

interface RecommendationAcquisitionDependencies {
  loadPulse: (options: { signal?: AbortSignal; onProgress?: (progress: EtfPulseProgress) => void }) => Promise<EtfPulseLoadResult>;
  scan: (options: {
    scanId: string;
    selectedTickers: readonly string[];
    expFilter: string;
    signal?: AbortSignal;
    onProgress?: (completedEtfs: number, totalEtfs: number) => void;
    recommendationUniverse?: { minimumDte: number; maximumDte: number; maximumExpirations: number };
  }) => Promise<ScreenerScanResult>;
  now: () => number;
}

const defaultDependencies: RecommendationAcquisitionDependencies = {
  loadPulse: options => buildEtfPulseRows({ ...options, forceRefresh: false }),
  scan: runScreenerBatchScan,
  now: Date.now,
};

let inMemoryRun: RecommendationRun | null = null;

export function getInMemoryRecommendationRun(): RecommendationRun | null {
  return inMemoryRun?.engineVersion === RECOMMENDATION_ENGINE_VERSION && inMemoryRun.policyVersion === RECOMMENDATION_POLICY_VERSION
    ? inMemoryRun
    : null;
}

export function publishInMemoryRecommendationRun(run: RecommendationRun): void {
  if (run.engineVersion === RECOMMENDATION_ENGINE_VERSION && run.policyVersion === RECOMMENDATION_POLICY_VERSION) inMemoryRun = run;
}

export function clearInMemoryRecommendationRunForTests(): void {
  inMemoryRun = null;
}

function unavailablePulseRow(ticker: string): EtfPulseRow {
  const metadata = getEtfPulseUniverse().find(item => item.ticker === ticker);
  return withEtfPulseTechnicalAssessment({
    ticker,
    name: metadata?.name ?? ticker,
    type: metadata?.type ?? 'Broad Index',
    leverage: metadata?.leverage ?? '—',
    underlying: metadata?.underlying ?? ticker,
    price: null,
    returns: { oneDay: null, fiveDay: null, thirtyDay: null, threeMonth: null, sixMonth: null, yearToDate: null, oneYear: null },
    rsi14: null,
    realizedVolatility20: null,
    sma20: null,
    sma50: null,
    sma200: null,
    distance20: null,
    distance50: null,
    distance200: null,
    high52Week: null,
    low52Week: null,
    percentOf52WeekHigh: null,
    position52Week: null,
    drawdown52Week: null,
    recentDrawdown30: null,
    error: 'ETF Pulse technical context unavailable',
  });
}

function canonicalUnderlyingRows(result: EtfPulseLoadResult): EtfPulseRow[] {
  const byTicker = new Map(result.rows.map(row => [row.ticker, row]));
  return [...SCREENER_TICKERS].sort().map(ticker => byTicker.get(ticker) ?? unavailablePulseRow(ticker));
}

function chainSnapshots(scan: ScreenerScanResult): RecommendationChainSnapshot[] {
  return [...scan.chainsByKey.entries()]
    .flatMap(([key, data]) => {
      const separator = key.lastIndexOf('|');
      const ticker = key.slice(0, separator);
      const expiration = Number(key.slice(separator + 1));
      return ticker && Number.isInteger(expiration) && expiration > 0 ? [{ ticker, expiration, data }] : [];
    })
    .sort((left, right) => left.ticker.localeCompare(right.ticker) || left.expiration - right.expiration);
}

export async function refreshRecommendations(options: {
  scanId: string;
  onlyEvaluateAtLeast60Dte?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: RecommendationRefreshProgress) => void;
  dependencies?: Partial<RecommendationAcquisitionDependencies>;
}): Promise<RecommendationRefreshResult> {
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  const asOf = new Date(dependencies.now()).toISOString();
  const universe = recommendationUniverse(options.onlyEvaluateAtLeast60Dte ?? true);
  const pulseResult = await dependencies.loadPulse({
    signal: options.signal,
    onProgress: progress => options.onProgress?.({ stage: 'UNDERLYINGS', completed: progress.loaded, total: progress.total, ticker: progress.ticker }),
  });
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Operation aborted', 'AbortError');
  const underlyings = canonicalUnderlyingRows(pulseResult);
  const marketRegime = analyzeRegime(pulseResult.rows, pulseResult.fetchedAt);
  const posture = postureFromRegime(marketRegime);
  const assessments = assessUnderlyingUniverse(underlyings, marketRegime);
  const hardFailed = assessments.filter(assessment => assessment.qualification === 'HARD_FAIL').map(assessment => assessment.ticker).sort();
  const requestedForOptionScan = assessments.filter(assessment => assessment.qualification !== 'HARD_FAIL').map(assessment => assessment.ticker).sort();
  const scan = await dependencies.scan({
    scanId: options.scanId,
    selectedTickers: requestedForOptionScan,
    expFilter: 'all',
    recommendationUniverse: {
      minimumDte: universe.minimumDte,
      maximumDte: universe.maximumDte,
      maximumExpirations: universe.maxExpirationsPerUnderlying,
    },
    signal: options.signal,
    onProgress: (completed, total) => options.onProgress?.({ stage: 'CONTRACTS', completed, total }),
  });
  if (options.signal?.aborted) throw options.signal.reason ?? new DOMException('Operation aborted', 'AbortError');
  options.onProgress?.({ stage: 'DECISION', completed: 0, total: 1 });
  const built = buildScreenerRows(scan, 'all');
  const chains = chainSnapshots(scan);
  const expirationPlansByTicker = scan.expirationPlansByTicker ?? new Map(
    [...scan.initialResults.entries()].map(([ticker, data]) => {
      const availableExpirationDates = data.expirations.map(expiration => expiration.date);
      const selectedExpirationDates = chains.filter(chain => chain.ticker === ticker).map(chain => chain.expiration);
      return [ticker, {
        availableExpirationDates,
        eligibleExpirationDates: selectedExpirationDates,
        selectedExpirationDates,
        discoveryExpiration: data.chainMeta?.returnedExpiration ?? data.expirations[0]?.date ?? null,
      }];
    }),
  );
  const successful = [...scan.initialResults.keys()].sort();
  const failedByTicker = new Map<string, string>();
  requestedForOptionScan.filter(ticker => !scan.initialResults.has(ticker)).forEach(ticker => failedByTicker.set(ticker, 'No option-chain dataset returned.'));
  pulseResult.errors.forEach(error => {
    if ((SCREENER_TICKERS as readonly string[]).includes(error.ticker)) failedByTicker.set(error.ticker, error.message);
  });
  scan.errors.forEach(error => {
    if (error.ticker) failedByTicker.set(error.ticker, error.message);
  });
  const expirationsCovered = successful.map(ticker => ({
    ticker,
    expirationDates: chains.filter(chain => chain.ticker === ticker).map(chain => chain.expiration).sort((left, right) => left - right),
  }));
  const snapshot: RecommendationSnapshot = {
    asOf,
    engineVersion: RECOMMENDATION_ENGINE_VERSION,
    policyVersion: RECOMMENDATION_POLICY_VERSION,
    universe,
    market: { regime: marketRegime, posture },
    underlyings,
    chains,
    screenerRows: built.rows,
    coverage: {
      trackedUnderlyings: [...SCREENER_TICKERS].sort(),
      hardFailedBeforeChainAcquisition: hardFailed,
      requestedForOptionScan,
      successfullyAnalyzedUnderlyings: successful,
      failedUnderlyings: [...failedByTicker.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([ticker, message]) => ({ ticker, message })),
      failedBatches: [...scan.failedBatchIds].sort((left, right) => left - right),
      expirationsCovered,
      expirationPlans: [...expirationPlansByTicker.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([ticker, plan]) => ({ ticker, ...plan })),
      contractsEvaluated: built.rows.length,
      pulse: {
        requested: pulseResult.total,
        loaded: pulseResult.loaded,
        failed: pulseResult.failed,
        stale: pulseResult.stale === true,
      },
      provenance: {
        pulseFetchedAt: pulseResult.fetchedAt,
        chainSources: chains.map(chain => ({
          ticker: chain.ticker,
          expiration: chain.expiration,
          source: chain.data.chainMeta?.source ?? 'unknown',
          fetchedAt: chain.data.chainMeta?.fetchedAt ?? null,
        })),
      },
    },
  };
  const run = runRecommendationEngine(snapshot);
  options.onProgress?.({ stage: 'DECISION', completed: 1, total: 1 });
  return { snapshot, run };
}

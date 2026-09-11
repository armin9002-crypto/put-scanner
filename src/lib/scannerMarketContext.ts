import type { SparklineRequestResult } from './api.ts';
import type { EvidenceFreshness } from './evidence.ts';
import type { RefreshMode } from './marketDataRequest.ts';

export const SCANNER_MARKET_SYMBOLS = [
  { ticker: 'QQQ', requestTicker: 'QQQ', chartTicker: 'QQQ', isVolatility: false },
  { ticker: 'SPY', requestTicker: 'SPY', chartTicker: 'SPY', isVolatility: false },
  { ticker: 'VIX', requestTicker: '^VIX', chartTicker: '^VIX', isVolatility: true },
  { ticker: 'VXN', requestTicker: '^VXN', chartTicker: '^VXN', isVolatility: true },
] as const;

export type ScannerMarketTicker = typeof SCANNER_MARKET_SYMBOLS[number]['ticker'];

export interface ScannerMarketEvidence {
  ticker: ScannerMarketTicker;
  data: SparklineRequestResult['data'] | null;
  observedAt: number | null;
  cachedAt: number | null;
  source: SparklineRequestResult['source'] | 'unknown';
  freshness: EvidenceFreshness;
  retentionReason: string | null;
}

export type ScannerMarketContext = Partial<Record<ScannerMarketTicker, ScannerMarketEvidence>>;

export interface ScannerMarketAcquisition {
  context: ScannerMarketContext;
  requestCount: number;
  failedCount: number;
}

function evidenceFromResult(ticker: ScannerMarketTicker, result: SparklineRequestResult): ScannerMarketEvidence {
  const retained = result.staleFallbackUsed || result.source === 'stale-fallback' || result.freshness !== 'fresh';
  return {
    ticker,
    data: result.data,
    observedAt: Number.isFinite(result.observedAt) ? result.observedAt : null,
    cachedAt: Number.isFinite(result.cachedAt) ? result.cachedAt ?? null : null,
    source: result.source,
    freshness: retained ? 'retained-stale' : result.source === 'network' ? 'current' : 'cached-current',
    retentionReason: retained
      ? result.staleFallbackUsed
        ? 'Refresh failed; prior market evidence was retained.'
        : 'Cached market evidence is older than accepted currentness.'
      : null,
  };
}

function retainedAfterFailure(ticker: ScannerMarketTicker, previous: ScannerMarketEvidence | undefined): ScannerMarketEvidence {
  if (!previous?.data) {
    return {
      ticker,
      data: null,
      observedAt: null,
      cachedAt: null,
      source: 'unknown',
      freshness: 'unavailable',
      retentionReason: 'Market evidence is unavailable.',
    };
  }
  return {
    ...previous,
    freshness: 'retained-stale',
    retentionReason: 'Refresh failed; prior market evidence was retained.',
  };
}

export async function acquireScannerMarketContext(
  previous: ScannerMarketContext,
  options: {
    mode: RefreshMode;
    signal?: AbortSignal;
    fetchResult: (ticker: string, options: { mode: RefreshMode; signal?: AbortSignal }) => Promise<SparklineRequestResult>;
  },
): Promise<ScannerMarketAcquisition> {
  const settled = await Promise.allSettled(SCANNER_MARKET_SYMBOLS.map(symbol => (
    options.fetchResult(symbol.requestTicker, { mode: options.mode, signal: options.signal })
  )));
  const context: ScannerMarketContext = {};
  let failedCount = 0;
  settled.forEach((result, index) => {
    const symbol = SCANNER_MARKET_SYMBOLS[index];
    if (result.status === 'fulfilled') {
      context[symbol.ticker] = evidenceFromResult(symbol.ticker, result.value);
      if (result.value.staleFallbackUsed) failedCount += 1;
    } else {
      context[symbol.ticker] = retainedAfterFailure(symbol.ticker, previous[symbol.ticker]);
      failedCount += 1;
    }
  });
  return { context, requestCount: SCANNER_MARKET_SYMBOLS.length, failedCount };
}

const FRESHNESS_RANK: Record<EvidenceFreshness, number> = {
  current: 0,
  'cached-current': 1,
  'retained-stale': 2,
  unavailable: 3,
};

export function summarizeScannerMarketContext(context: ScannerMarketContext): {
  freshness: EvidenceFreshness;
  observedAt: number | null;
  source: string;
  availableCount: number;
} {
  const evidence = SCANNER_MARKET_SYMBOLS.map(symbol => context[symbol.ticker]).filter((item): item is ScannerMarketEvidence => item != null);
  const worst = evidence.reduce<EvidenceFreshness>((state, item) => (
    FRESHNESS_RANK[item.freshness] > FRESHNESS_RANK[state] ? item.freshness : state
  ), evidence.length === SCANNER_MARKET_SYMBOLS.length ? 'current' : 'unavailable');
  const observedTimes = evidence
    .filter(item => item.freshness !== 'unavailable' && item.observedAt != null)
    .map(item => item.observedAt as number);
  const sources = [...new Set(evidence.map(item => item.source).filter(source => source !== 'unknown'))];
  return {
    freshness: worst,
    observedAt: observedTimes.length > 0 ? Math.min(...observedTimes) : null,
    source: sources.length === 1 ? sources[0] : sources.length > 1 ? 'mixed' : 'unknown',
    availableCount: evidence.filter(item => item.data != null).length,
  };
}

export function scannerMarketFreshnessLabel(evidence: Pick<ScannerMarketEvidence, 'freshness'> | undefined): string {
  if (!evidence || evidence.freshness === 'unavailable') return 'Unavailable';
  if (evidence.freshness === 'retained-stale') return 'Stale';
  if (evidence.freshness === 'cached-current') return 'Cached';
  return 'Current';
}

export function compactScannerMarketFreshness(evidence: Pick<ScannerMarketEvidence, 'freshness' | 'observedAt'> | undefined): string {
  const state = scannerMarketFreshnessLabel(evidence);
  if (!evidence || evidence.observedAt == null || evidence.freshness === 'unavailable') return state;
  const time = new Date(evidence.observedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return `${state} · ${time}`;
}

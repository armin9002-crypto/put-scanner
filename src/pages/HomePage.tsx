import { lazy, Suspense, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { fetchBatchPricesResult, fetchOptions, fetchSparklineResult, fetchWithConcurrencyLimit } from '../lib/api';
import type { SparklineData } from '../lib/api';
import type { BatchPriceData } from '../lib/cache';
import ETFCard from '../components/ETFCard';
import ScannerEvidencePopover from '../components/ScannerSnapshotEvidence';
import ExpirationFilter, { buildExpirationOptions } from '../components/ExpirationFilter';
import SparklineChart from '../components/SparklineChart';
import ErrorBoundary from '../components/ErrorBoundary';
import DataFreshness, { type DataFreshnessStatus } from '../components/DataFreshness';
import { Loader2, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import {
  cacheScannerOptionSnapshot,
  getCachedScannerExpirations,
  getScannerOptionSnapshots,
  getScannerSnapshotDiagnostics,
  hasScannerSnapshotData,
  isScannerOptionSnapshotStale,
  recordScannerSnapshotDiagnostic,
  updateScannerSnapshotForTicker,
  type ScannerOptionSnapshot,
  type ScannerSnapshotDiagnostic,
  type ScannerSnapshotUpdateOutcome,
} from '../lib/scannerOptionSnapshot';

const InteractivePriceChartModal = lazy(() => import('../components/InteractivePriceChartModal'));

const LEVERAGE_OPTIONS = ['All', '2x', '3x'] as const;
const TYPE_OPTIONS = ['All', 'Broad Index', 'Sector', 'Commodity', 'Country', 'Crypto'] as const;

import { ETF_LIST } from '../lib/etfs';
import {
  buildCachedExpirationState,
  buildExpirationState,
  diagnosticForOutcome,
  snapshotIssueLabel,
  snapshotProgressDetails,
  snapshotProgressLabel,
  summarizeSnapshotOutcomes,
  scannerExpirationMatch,
  tickerMatchesScannerExpiration,
  type CachedExpirationState,
  type SnapshotUpdateProgress,
} from '../lib/scannerUpdateState';
import { fetchScreenerExpirationAvailability } from '../lib/screenerAcquisition';
import { passesScannerLiquidityFilter, sortScannerEtfs, type ScannerLiquidityFilter, type ScannerSort } from '../lib/scannerDiscovery';
import { fetchFundAssets, type FundAssetsData } from '../lib/fundAssets';
import { DEFAULT_SCANNER_STATE, parseScannerState, resolveScannerExpiration, serializeScannerState, type ScannerState } from '../lib/scannerState';
import { saveLastScannerUrl } from '../lib/scannerNavigation';
import { buildScannerOptionsPath } from '../lib/optionExpiryNavigation';
import { createOptionsNavigationState } from '../lib/optionsNavigation';
import { useResponsiveMode } from '../lib/responsive';
import MobileBottomSheet from '../components/mobile/MobileBottomSheet';
import MobileMarketStrip from '../components/mobile/MobileMarketStrip';
import MobileEtfRow from '../components/mobile/MobileEtfRow';
import AnalyzeTickerForm from '../components/AnalyzeTickerForm';
import { PageHeader, SectionHeader } from '../components/ui/PageHeader';
import { acquireScannerMarketContext, summarizeScannerMarketContext, type ScannerMarketContext } from '../lib/scannerMarketContext';

const SCANNER_PRICE_TICKERS = ETF_LIST.map(etf => etf.ticker);

const SORT_OPTIONS: Array<{ value: ScannerSort; label: string }> = [
  { value: 'default', label: 'Default' }, { value: 'iv60', label: 'IV60 High → Low' },
  { value: 'liquidity', label: 'Liquidity' }, { value: 'fiveDay', label: '5D Return' },
  { value: 'oneMonth', label: '1M Return' }, { value: 'threeMonth', label: '3M Return' },
  { value: 'drawdown52w', label: '52W Drawdown' }, { value: 'priceHigh', label: 'Price High → Low' },
  { value: 'priceLow', label: 'Price Low → High' },
];

function marketChangeColor(changePercent: number): string {
  return changePercent >= 0 ? 'var(--green)' : 'var(--red)';
}

function chartReferenceClose(data: SparklineData): number | null {
  if (data.previousClose != null && Number.isFinite(data.previousClose)) return data.previousClose;
  // Yahoo can omit chartPreviousClose on thin intraday responses; first print is a graceful visual fallback.
  return data.sparkline.length > 0 ? data.sparkline[0] : null;
}

function ScannerResultCount({ count }: { count: number }) {
  return <span className="scanner-results-count" aria-live="polite" aria-atomic="true"><span key={count} className="scanner-results-count__value">{count}</span> results</span>;
}

function MarketChartCard({
  ticker,
  chartTicker,
  data,
  loading,
  onRefresh,
  onOpenChart,
}: {
  ticker: 'QQQ' | 'SPY' | 'VIX' | 'VXN';
  chartTicker: string;
  data: SparklineData | null;
  loading: boolean;
  onRefresh: () => void;
  onOpenChart: (ticker: string, displayTicker: string) => void;
}) {
  const changePct = data?.changePercent ?? 0;
  const color = data ? marketChangeColor(changePct) : 'var(--yellow)';
  const prefix = ticker === 'VIX' || ticker === 'VXN' ? '' : '$';

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => data && onOpenChart(chartTicker, ticker)}
      onKeyDown={(event) => {
        if ((event.key === 'Enter' || event.key === ' ') && data) {
          event.preventDefault();
          onOpenChart(chartTicker, ticker);
        }
      }}
      className="scanner-market-card surface-inset min-w-0 cursor-pointer p-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
      style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
      aria-label={`Open ${ticker} interactive price chart`}
    >
      <div className="flex items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{ticker}</span>
          <span className="text-[9px] font-medium px-1 py-0.5 rounded" style={{ color: 'var(--text-dim)', backgroundColor: 'var(--surface-alt)' }}>1D</span>
        </div>
        <button
          onClick={(event) => {
            event.stopPropagation();
            onRefresh();
          }}
          disabled={loading}
          className="p-1 rounded transition-opacity hover:opacity-70 disabled:opacity-50"
          aria-label="Refresh market charts"
        >
          <RefreshCw className={`w-3 h-3 ${loading ? 'animate-spin' : ''}`} style={{ color: 'var(--text-muted)' }} />
        </button>
      </div>
      {loading && !data ? (
        <div className="flex items-center justify-center h-[28px]">
          <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-muted)' }} />
        </div>
      ) : data && data.sparkline.length >= 2 ? (
        <>
          <SparklineChart
            data={data.sparkline}
            color={color}
            width={150}
            height={48}
            referenceValue={chartReferenceClose(data)}
          />
          <div className="flex items-center justify-between gap-2 mt-0.5">
            <span className="text-xs font-mono font-semibold tabular-nums truncate" style={{ color: 'var(--text)' }}>
              {prefix}{data.price.toFixed(2)}
            </span>
            <span className="text-[10px] font-mono tabular-nums whitespace-nowrap" style={{ color }}>
              {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
            </span>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center h-[28px] text-xs" style={{ color: 'var(--text-dim)' }}>Market data unavailable</div>
      )}
    </div>
  );
}

function SnapshotIssueDisclosure({
  issue,
  details,
  rows,
}: {
  issue: string | null;
  details: string | null;
  rows: Array<{ ticker: string; status: string; reason: string }>;
}) {
  if (!issue) return null;
  return (
    <details className="scanner-issue-disclosure">
      <summary className="scanner-liquidity-issues" data-visible="true" aria-label="Show liquidity refresh issue details">{issue}</summary>
      <div className="scanner-issue-disclosure__body surface-inset" id="scanner-liquidity-issue-details">
        {details && <div className="mb-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>{details}</div>}
        {rows.length > 0 ? rows.map(row => <div key={row.ticker} className="break-words"><strong>{row.ticker}</strong> — {row.status} — {row.reason}</div>) : <div>No issue details were returned.</div>}
      </div>
    </details>
  );
}

export default function HomePage() {
  const { isPhone } = useResponsiveMode();
  const [searchParams, setSearchParams] = useSearchParams();
  const initialExpirationStateRef = useRef<CachedExpirationState | null>(null);
  if (!initialExpirationStateRef.current) initialExpirationStateRef.current = buildCachedExpirationState();
  const initialScannerStateRef = useRef<ScannerState | null>(null);
  if (!initialScannerStateRef.current) {
    const parsed = parseScannerState(searchParams);
    initialScannerStateRef.current = parsed;
  }
  const initialScannerState = initialScannerStateRef.current!;
  const [search, setSearch] = useState(initialScannerState.search);
  const [leverageFilter, setLeverageFilter] = useState<string>(initialScannerState.leverage);
  const [typeFilter, setTypeFilter] = useState<string>(initialScannerState.type);
  const [expFilter, setExpFilter] = useState(initialScannerState.expiration);
  const [scannerSort, setScannerSort] = useState<ScannerSort>(initialScannerState.sort);
  const [liquidityFilter, setLiquidityFilter] = useState<ScannerLiquidityFilter>(initialScannerState.liquidity);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [expirationState, setExpirationState] = useState<CachedExpirationState>(initialExpirationStateRef.current!);
  const [expirationDatesLoading, setExpirationDatesLoading] = useState(true);
  const [optionSnapshots, setOptionSnapshots] = useState<Record<string, ScannerOptionSnapshot>>(() => getScannerOptionSnapshots());
  const [snapshotDiagnostics, setSnapshotDiagnostics] = useState<Record<string, ScannerSnapshotDiagnostic>>(() => getScannerSnapshotDiagnostics());
  const [snapshotIssueRows, setSnapshotIssueRows] = useState<{ ticker: string; status: string; reason: string }[]>([]);
  const [snapshotProgress, setSnapshotProgress] = useState<SnapshotUpdateProgress | null>(null);
  const snapshotUpdateRunningRef = useRef(false);
  const [activeEvidence, setActiveEvidence] = useState<{ ticker: string; anchor: HTMLButtonElement } | null>(null);
  const activeEvidenceRef = useRef<{ ticker: string; anchor: HTMLButtonElement } | null>(null);
  activeEvidenceRef.current = activeEvidence;
  const { expirations: availableExps, availability: expiryAvailability } = expirationState;
  const expirationAvailabilityReady = expirationState.coverage !== 'cached';

  // Batch price data
  const [prices, setPrices] = useState<BatchPriceData>({});
  const [pricesLoading, setPricesLoading] = useState(true);
  const [pricesError, setPricesError] = useState<string | null>(null);
  const [pricesUpdatedAt, setPricesUpdatedAt] = useState<number | null>(null);
  const [pricesFreshness, setPricesFreshness] = useState<DataFreshnessStatus>('updating');
  const [fundAssets, setFundAssets] = useState<FundAssetsData>({});
  const priceRequestGenerationRef = useRef(0);
  const priceAbortRef = useRef<AbortController | null>(null);

  // Market sparkline data (manual refresh only)
  const [marketContext, setMarketContext] = useState<ScannerMarketContext>({});
  const marketContextRef = useRef<ScannerMarketContext>({});
  marketContextRef.current = marketContext;
  const [marketLoading, setMarketLoading] = useState(true);
  const [marketRefreshFailed, setMarketRefreshFailed] = useState(false);
  const [chartModal, setChartModal] = useState<{ ticker: string; displayTicker: string } | null>(null);
  const marketAbortRef = useRef<AbortController | null>(null);

  // Load batch prices with 10-second hard timeout
  const loadPrices = useCallback(async (forceRefresh = false) => {
    priceAbortRef.current?.abort(new DOMException('Superseded Scanner price request', 'AbortError'));
    const controller = new AbortController();
    priceAbortRef.current = controller;
    const requestGeneration = ++priceRequestGenerationRef.current;
    setPricesLoading(true);
    setPricesError(null);
    setPricesFreshness('updating');
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    try {
      const fetchPromise = fetchBatchPricesResult(SCANNER_PRICE_TICKERS, { mode: forceRefresh ? 'revalidate' : 'cache-first', signal: controller.signal });
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          controller.abort(new DOMException('Scanner price request timed out', 'TimeoutError'));
          reject(new Error('Request timed out'));
        }, 10000);
      });
      const response = await Promise.race([fetchPromise, timeoutPromise]);
      if (requestGeneration !== priceRequestGenerationRef.current) return;
      if (!response) throw new Error('Price data unavailable');
      const data = response.data as BatchPriceData;

      if (!data || Object.keys(data).length === 0) {
        setPricesError('Price data unavailable');
      } else {
        const validCount = Object.values(data).filter(value => value?.price != null && value.price > 0).length;
        if (validCount < 10) {
          setPricesError('Partial data received — some prices unavailable');
        }
        setPrices(data);
        setPricesUpdatedAt(response.fetchedAt);
        setPricesFreshness(response.staleFallbackUsed ? 'failed' : response.cacheSource === 'network' ? 'fresh' : response.freshness === 'stale' ? 'stale' : 'cached');
        if (response.staleFallbackUsed) setPricesError('Refresh failed - showing cached prices');
      }
    } catch (err: unknown) {
      if (requestGeneration !== priceRequestGenerationRef.current) return;
      const abortReason = controller.signal.reason as { name?: unknown } | undefined;
      if ((err as { name?: unknown })?.name === 'AbortError' && abortReason?.name !== 'TimeoutError') return;
      setPricesError(abortReason?.name === 'TimeoutError' ? 'Request timed out' : err instanceof Error ? err.message : 'Price data unavailable');
      setPricesFreshness('failed');
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (priceAbortRef.current === controller) priceAbortRef.current = null;
      if (requestGeneration === priceRequestGenerationRef.current) setPricesLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadPrices();
    return () => {
      priceRequestGenerationRef.current += 1;
      priceAbortRef.current?.abort(new DOMException('Scanner route closed', 'AbortError'));
      priceAbortRef.current = null;
    };
  }, [loadPrices]);

  useEffect(() => {
    const controller = new AbortController();
    fetchFundAssets(SCANNER_PRICE_TICKERS, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setFundAssets(current => ({ ...current, ...data })); })
      .catch(() => { /* preserve any cached/previous Assets values */ });
    return () => controller.abort(new DOMException('Scanner route closed', 'AbortError'));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setExpirationDatesLoading(true);
    fetchScreenerExpirationAvailability({ signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setExpirationState(buildExpirationState(
          result.expirationsByTicker,
          result.complete ? 'complete' : 'partial',
          result.errors,
        ));
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setExpirationState(current => ({
            ...current,
            coverage: 'failed',
            errors: [...current.errors, { message: 'Expiration availability refresh failed.' }],
            retentionReason: 'Expiration refresh failed; prior availability evidence was retained.',
          }));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setExpirationDatesLoading(false);
      });
    return () => controller.abort(new DOMException('Scanner route closed', 'AbortError'));
  }, []);

  useEffect(() => {
    if (!expirationAvailabilityReady) return;
    setExpFilter(current => resolveScannerExpiration(
      current,
      availableExps.filter(expiration => expiration.dte > 30).map(expiration => expiration.date),
      availableExps.some(expiration => expiration.dte <= 30),
    ));
  }, [availableExps, expirationAvailabilityReady]);

  const serializedScannerState = serializeScannerState({
    search,
    leverage: leverageFilter,
    type: typeFilter,
    expiration: expFilter,
    sort: scannerSort,
    liquidity: liquidityFilter,
  }).toString();
  const currentSearchParams = searchParams.toString();
  useEffect(() => {
    if (serializedScannerState !== currentSearchParams) {
      setSearchParams(serializedScannerState, { replace: true });
    }
    saveLastScannerUrl(serializedScannerState ? `/?${serializedScannerState}` : '/');
  }, [currentSearchParams, serializedScannerState, setSearchParams]);

  // Load market sparklines (manual refresh only, with cache)
  const loadMarketData = useCallback(async (explicitRefresh = false) => {
    marketAbortRef.current?.abort(new DOMException('Superseded Scanner chart request', 'AbortError'));
    const controller = new AbortController();
    marketAbortRef.current = controller;
    setMarketLoading(true);
    setMarketRefreshFailed(false);
    try {
      const acquisition = await acquireScannerMarketContext(marketContextRef.current, {
        mode: explicitRefresh ? 'revalidate' : 'cache-first',
        signal: controller.signal,
        fetchResult: fetchSparklineResult,
      });
      if (controller.signal.aborted) return;
      setMarketContext(acquisition.context);
      setMarketRefreshFailed(acquisition.failedCount > 0);
    } catch {
      if (!controller.signal.aborted) setMarketRefreshFailed(true);
    }
    if (marketAbortRef.current === controller) {
      marketAbortRef.current = null;
      setMarketLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadMarketData(false);
    return () => {
      marketAbortRef.current?.abort(new DOMException('Scanner route closed', 'AbortError'));
      marketAbortRef.current = null;
    };
  }, [loadMarketData]);

  const marketSummary = useMemo(() => summarizeScannerMarketContext(marketContext), [marketContext]);
  const qqqData = marketContext.QQQ?.data ?? null;
  const spyData = marketContext.SPY?.data ?? null;
  const vixData = marketContext.VIX?.data ?? null;
  const vxnData = marketContext.VXN?.data ?? null;
  const marketFreshnessStatus: DataFreshnessStatus = marketLoading
    ? 'updating'
    : marketRefreshFailed
      ? 'failed'
      : marketSummary.freshness === 'current'
        ? 'fresh'
        : marketSummary.freshness === 'cached-current'
          ? 'cached'
          : 'stale';

  const openEvidence = useCallback((ticker: string, anchor: HTMLButtonElement) => {
    setActiveEvidence({ ticker, anchor });
  }, []);

  const closeEvidence = useCallback((restoreFocus = false) => {
    const active = activeEvidenceRef.current;
    setActiveEvidence(null);
    if (restoreFocus && active?.anchor.isConnected) active.anchor.focus();
  }, []);

  const handleSearchChange = useCallback((value: string) => {
    closeEvidence();
    setSearch(value);
  }, [closeEvidence]);

  const handleLeverageChange = useCallback((value: string) => {
    closeEvidence();
    setLeverageFilter(value);
  }, [closeEvidence]);

  const handleTypeChange = useCallback((value: string) => {
    closeEvidence();
    setTypeFilter(value);
  }, [closeEvidence]);

  const handleSortChange = useCallback((value: ScannerSort) => {
    closeEvidence();
    setScannerSort(value);
  }, [closeEvidence]);

  const handleLiquidityChange = useCallback((value: ScannerLiquidityFilter) => {
    closeEvidence();
    setLiquidityFilter(value);
  }, [closeEvidence]);

  const candidates = useMemo(() => {
    const q = search.toLowerCase().trim();
    return ETF_LIST.filter(e => {
      if (q && !e.ticker.toLowerCase().includes(q) && !e.underlying.toLowerCase().includes(q) && !e.name.toLowerCase().includes(q)) {
        return false;
      }
      if (leverageFilter !== 'All' && !e.leverage.includes(leverageFilter)) {
        return false;
      }
      if (typeFilter !== 'All' && e.type !== typeFilter) {
        return false;
      }
      if (!passesScannerLiquidityFilter(optionSnapshots[e.ticker], liquidityFilter)) return false;
      return true;
    });
  }, [search, leverageFilter, typeFilter, liquidityFilter, optionSnapshots]);

  const filtered = useMemo(() => {
    const matches = candidates.filter(etf => tickerMatchesScannerExpiration(
      etf.ticker,
      expFilter,
      expiryAvailability,
      expirationAvailabilityReady,
      new Date(),
      expirationState.coverage,
    ));
    return sortScannerEtfs(matches, scannerSort, prices, optionSnapshots);
  }, [candidates, expFilter, expiryAvailability, expirationAvailabilityReady, expirationState.coverage, prices, scannerSort, optionSnapshots]);

  const expirationScope = useMemo(() => {
    if (expFilter === 'all') return null;
    return candidates.reduce((summary, etf) => {
      const match = scannerExpirationMatch(etf.ticker, expFilter, expiryAvailability, expirationState.coverage);
      if (match === 'present') summary.confirmed += 1;
      if (match === 'unknown') summary.unverified += 1;
      return summary;
    }, { confirmed: 0, unverified: 0 });
  }, [candidates, expFilter, expirationState.coverage, expiryAvailability]);

  useEffect(() => {
    if (!activeEvidence) return;
    if (!filtered.some(etf => etf.ticker === activeEvidence.ticker) || !activeEvidence.anchor.isConnected) closeEvidence();
  }, [activeEvidence, closeEvidence, filtered]);

  const expDropdownOptions = useMemo(() => buildExpirationOptions(availableExps, expFilter), [availableExps, expFilter]);

  const handleExpirationChange = useCallback((value: string) => {
    closeEvidence();
    setExpFilter(value);
  }, [closeEvidence]);

  const resetScannerFilters = useCallback(() => {
    closeEvidence();
    setSearch(DEFAULT_SCANNER_STATE.search);
    setLeverageFilter(DEFAULT_SCANNER_STATE.leverage);
    setTypeFilter(DEFAULT_SCANNER_STATE.type);
    setExpFilter(DEFAULT_SCANNER_STATE.expiration);
    setScannerSort(DEFAULT_SCANNER_STATE.sort);
    setLiquidityFilter(DEFAULT_SCANNER_STATE.liquidity);
  }, [closeEvidence]);

  const updateVisibleOptionSnapshots = useCallback(async () => {
    closeEvidence();
    if (snapshotUpdateRunningRef.current) return;
    const tickers = [...new Set(filtered.map(etf => etf.ticker.trim().toUpperCase()))]
      .filter(ticker => isScannerOptionSnapshotStale(optionSnapshots[ticker]) || snapshotDiagnostics[ticker]?.status === 'failed');
    setSnapshotIssueRows([]);
    if (tickers.length === 0) {
      setSnapshotProgress({ current: 0, total: 0, updated: 0, expanded: 0, unavailable: 0, failed: 0, complete: true });
      return;
    }

    snapshotUpdateRunningRef.current = true;
    setSnapshotProgress({ current: 0, total: tickers.length, updated: 0, expanded: 0, unavailable: 0, failed: 0, complete: false });
    const tasks = tickers.map(ticker => async () => {
      try {
        const outcome = await updateScannerSnapshotForTicker({
          ticker,
          scannerPrice: prices[ticker]?.price ?? null,
          expirationDates: getCachedScannerExpirations(ticker) ?? [],
          fetchChain: expiration => fetchOptions(
            ticker,
            expiration,
            { source: expiration == null ? 'Scanner:updateSnapshot:discovery' : 'Scanner:updateSnapshot:selected' },
          ),
        });
        if (outcome.snapshot && hasScannerSnapshotData(outcome.snapshot)) {
          cacheScannerOptionSnapshot(outcome.snapshot);
        }
        return outcome;
      } finally {
        setSnapshotProgress(current => current ? { ...current, current: current.current + 1 } : current);
      }
    });

    try {
      const settled = await fetchWithConcurrencyLimit(tasks, 3);
      const outcomes = settled.map(result => result.status === 'fulfilled'
        ? result.value
        : {
          status: 'failed',
          snapshot: null,
          expanded: false,
          reason: result.reason instanceof Error ? result.reason.message : 'Snapshot update failed.',
          requestCount: 0,
          requestedExpirations: [],
        } satisfies ScannerSnapshotUpdateOutcome);
      const issues = outcomes.flatMap((outcome, index) => {
        const diagnostic = diagnosticForOutcome(outcome);
        if (!diagnostic) return [];
        recordScannerSnapshotDiagnostic(tickers[index], diagnostic.status, diagnostic.reason);
        return [{ ticker: tickers[index], ...diagnostic }];
      });
      setSnapshotIssueRows(issues);
      const summary = summarizeSnapshotOutcomes(outcomes);
      setOptionSnapshots(getScannerOptionSnapshots());
      setSnapshotDiagnostics(getScannerSnapshotDiagnostics());
      setSnapshotProgress(current => current ? { ...current, ...summary, complete: true } : current);
    } finally {
      snapshotUpdateRunningRef.current = false;
    }
  }, [closeEvidence, filtered, optionSnapshots, prices, snapshotDiagnostics]);

  const activeControlCount = [
    search.trim().length > 0,
    leverageFilter !== DEFAULT_SCANNER_STATE.leverage,
    typeFilter !== DEFAULT_SCANNER_STATE.type,
    expFilter !== DEFAULT_SCANNER_STATE.expiration,
    liquidityFilter !== DEFAULT_SCANNER_STATE.liquidity,
    scannerSort !== DEFAULT_SCANNER_STATE.sort,
  ].filter(Boolean).length;
  const snapshotIssue = snapshotIssueLabel(snapshotProgress) ?? (snapshotIssueRows.length ? `${snapshotIssueRows.length} issues / ${snapshotProgress?.total ?? 0} checked` : null);
  const snapshotDetails = snapshotProgressDetails(snapshotProgress);
  const scannerEvidenceSurface = activeEvidence && (
    <ScannerEvidencePopover
      id={`scanner-option-snapshot-${activeEvidence.ticker}`}
      ticker={activeEvidence.ticker}
      anchor={activeEvidence.anchor}
      snapshot={optionSnapshots[activeEvidence.ticker] ?? null}
      diagnostic={snapshotDiagnostics[activeEvidence.ticker] ?? null}
      onClose={closeEvidence}
    />
  );

  if (isPhone) {
    const marketItems = [
      { ticker: 'SPY', evidence: marketContext.SPY, chartTicker: 'SPY', isVolatility: false },
      { ticker: 'QQQ', evidence: marketContext.QQQ, chartTicker: 'QQQ', isVolatility: false },
      { ticker: 'VIX', evidence: marketContext.VIX, chartTicker: '^VIX', isVolatility: true },
      { ticker: 'VXN', evidence: marketContext.VXN, chartTicker: '^VXN', isVolatility: true },
    ];
    return (
      <div className="mobile-route-page min-h-[100dvh]" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="mobile-scanner-controls px-3.5 pb-3 pt-3">
          <div className="mobile-scanner-analyze mb-3 rounded-xl p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <AnalyzeTickerForm
              compact
              value={search}
              onValueChange={handleSearchChange}
              placeholder="Filter / Search by Ticker"
              submitLabel="Go to Option Chain"
              ariaLabel="Filter Scanner or go to option chain"
            />
          </div>
          <div className="mobile-scanner-filter-row grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <label className="min-w-0">
              <span className="sr-only">Expiration</span>
              <select value={expFilter} onChange={event => handleExpirationChange(event.target.value)} className="scanner-filter-control mobile-control-field w-full" aria-label="Scanner expiration" aria-busy={expirationDatesLoading}>
                {expDropdownOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => setMobileFiltersOpen(true)} className="scanner-filter-control pressable mobile-control-button" aria-haspopup="dialog">
              <SlidersHorizontal className="h-4 w-4" /> Filters{activeControlCount > 0 ? ` ${activeControlCount}` : ''}
            </button>
          </div>

          <p className="mt-2 text-[10px] leading-4" style={{ color: 'var(--text-dim)' }}>Selected expiration confirms exact listed availability; IV60 and liquidity use a bounded ~60 DTE benchmark.</p>

        </div>

        <MobileMarketStrip items={marketItems.map(item => ({
          ticker: item.ticker,
          price: item.evidence?.data?.price ?? null,
          changePercent: item.evidence?.data?.changePercent ?? null,
          isVolatility: item.isVolatility,
          loading: marketLoading,
          evidenceFreshness: item.evidence?.freshness ?? 'unavailable',
          observedAt: item.evidence?.observedAt ?? null,
          source: item.evidence?.source ?? 'unknown',
          onOpen: () => item.evidence?.data && setChartModal({ ticker: item.chartTicker, displayTicker: item.ticker }),
        }))} />

        <div className="mobile-scanner-results-header flex items-center justify-between gap-3 border-y px-3.5 py-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>ETF opportunities</h2>
            {expirationScope && <p className="text-[10px]" style={{ color: expirationScope.unverified > 0 || expirationState.coverage !== 'complete' ? 'var(--yellow)' : 'var(--text-muted)' }}>{expirationScope.confirmed} confirmed · {expirationScope.unverified} unverified{expirationState.coverage !== 'complete' ? ' · availability incomplete' : ''}</p>}
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}><ScannerResultCount count={filtered.length} /> · {expDropdownOptions.find(option => option.value === expFilter)?.label ?? 'All dates'}</p>
          </div>
          {(pricesLoading || marketLoading) && <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }}><Loader2 className="h-3 w-3 animate-spin" /> Updating</span>}
        </div>

        <div className="mobile-financial-list">
          {pricesLoading && Object.keys(prices).length === 0 ? Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="mobile-etf-row mobile-etf-row--skeleton animate-pulse"><div className="h-4 w-20 rounded" style={{ backgroundColor: 'var(--border)' }} /><div className="mt-3 h-3 w-44 rounded" style={{ backgroundColor: 'var(--border)' }} /><div className="mt-5 h-3 w-full rounded" style={{ backgroundColor: 'var(--border)' }} /></div>
          )) : filtered.map(etf => (
            <MobileEtfRow
              key={etf.ticker}
              etf={etf}
              to={buildScannerOptionsPath(etf.ticker, expFilter)}
              navigationState={createOptionsNavigationState('scanner', { path: serializedScannerState ? `/?${serializedScannerState}` : '/' })}
              priceData={prices[etf.ticker] ?? null}
              optionSnapshot={optionSnapshots[etf.ticker] ?? null}
              optionDiagnostic={snapshotDiagnostics[etf.ticker] ?? null}
              isEvidenceOpen={activeEvidence?.ticker === etf.ticker}
              onEvidenceOpen={anchor => openEvidence(etf.ticker, anchor)}
              onEvidenceClose={closeEvidence}
              netAssets={fundAssets[etf.ticker] ?? null}
            />
          ))}
        </div>

        {expirationScope && expirationState.coverage !== 'complete' && expirationScope.confirmed === 0 && <div className="px-4 py-3 text-center text-[11px]" style={{ color: 'var(--yellow)' }}>No confirmed matches yet · availability incomplete. Unverified ETFs remain available below.</div>}
        {filtered.length === 0 && !pricesLoading && <div className="mobile-scanner-empty-state px-6 py-12 text-center"><p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{expirationScope && expirationState.coverage !== 'complete' ? 'No confirmed matches yet · availability incomplete' : 'No matching ETFs'}</p><p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Try clearing search or widening your filters.</p><button type="button" onClick={resetScannerFilters} className="tap-target mt-3 rounded-lg px-4 text-xs font-semibold" style={{ color: 'var(--accent-light)', backgroundColor: 'var(--accent-bg)' }}>Reset Filters</button></div>}

        {mobileFiltersOpen && (
          <MobileBottomSheet
            title="Scanner filters"
            description="Refine the ETF opportunity list"
            onClose={() => setMobileFiltersOpen(false)}
            footer={<div className="grid grid-cols-2 gap-2"><button type="button" onClick={resetScannerFilters} className="mobile-sheet-action secondary">Reset Filters</button><button type="button" onClick={() => setMobileFiltersOpen(false)} className="mobile-sheet-action primary">Apply</button></div>}
          >
            <div className="space-y-5">
              <fieldset>
                <legend className="mobile-sheet-label">Leverage</legend>
                <div className="grid grid-cols-3 gap-2">{LEVERAGE_OPTIONS.map(option => <button type="button" key={option} onClick={() => handleLeverageChange(option)} className="scanner-filter-control mobile-choice" data-selected={leverageFilter === option}>{option}</button>)}</div>
              </fieldset>
              <fieldset>
                <legend className="mobile-sheet-label">Type</legend>
                <div className="grid grid-cols-2 gap-2">{TYPE_OPTIONS.map(option => <button type="button" key={option} onClick={() => handleTypeChange(option)} className="scanner-filter-control mobile-choice" data-selected={typeFilter === option}>{option === 'Broad Index' ? 'Broad' : option}</button>)}</div>
              </fieldset>
              <fieldset>
                <legend className="mobile-sheet-label">Liquidity</legend>
                <div className="grid grid-cols-3 gap-2">{([['all', 'All'], ['mediumPlus', 'Medium+'], ['liquidPlus', 'Liquid+']] as const).map(([value, label]) => <button type="button" key={value} onClick={() => handleLiquidityChange(value)} className="scanner-filter-control mobile-choice" data-selected={liquidityFilter === value}>{label}</button>)}</div>
              </fieldset>
              <label className="block"><span className="mobile-sheet-label">Sort</span><select value={scannerSort} onChange={event => handleSortChange(event.target.value as ScannerSort)} className="scanner-filter-control mobile-control-field w-full">{SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void updateVisibleOptionSnapshots()} disabled={snapshotUpdateRunningRef.current} className="mobile-sheet-action secondary min-w-0 flex-1 whitespace-normal">{snapshotProgress && !snapshotProgress.complete ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{snapshotProgressLabel(snapshotProgress)}</button>
                <SnapshotIssueDisclosure issue={snapshotIssue} details={snapshotDetails} rows={snapshotIssueRows} />
              </div>
            </div>
          </MobileBottomSheet>
        )}

        {scannerEvidenceSurface}
        {chartModal && <ErrorBoundary title="Chart unavailable" message="The chart modal could not render. Close it and try again."><Suspense fallback={null}><InteractivePriceChartModal isOpen ticker={chartModal.ticker} displayTicker={chartModal.displayTicker} onClose={() => setChartModal(null)} /></Suspense></ErrorBoundary>}
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="page-frame page-frame--standard scanner-page">
        <PageHeader
          title="Scanner"
          actions={<div className="scanner-command-search"><AnalyzeTickerForm compact value={search} onValueChange={handleSearchChange} placeholder="Filter / Search by Ticker" submitLabel="Go to Option Chain" ariaLabel="Filter Scanner or go to option chain" /></div>}
        />

        <section className="scanner-workspace surface-card" aria-label="Scanner workspace">
          <section className="scanner-control-plane scanner-desktop-controls" aria-label="Opportunity Set filters">
          <div className="scanner-control-plane__header">
            <div>
              <div className="scanner-control-plane__eyebrow">Opportunity set</div>
              <div className="scanner-control-plane__title">Set expiry and criteria</div>
            </div>
            <div className="scanner-control-plane__utilities">
              <div className="scanner-control-plane__summary">{activeControlCount} active controls</div>
              <button type="button" onClick={() => void updateVisibleOptionSnapshots()} disabled={snapshotUpdateRunningRef.current} className="scanner-control-plane__update inline-flex h-8 flex-none items-center gap-1 rounded-md px-2 text-[10px] font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)', color: 'var(--text-muted)' }} title={snapshotDetails ?? 'Update missing or stale IV60 and liquidity snapshots for visible ETFs'}>{snapshotProgress && !snapshotProgress.complete ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}{snapshotProgressLabel(snapshotProgress)}</button>
              <SnapshotIssueDisclosure issue={snapshotIssue} details={snapshotDetails} rows={snapshotIssueRows} />
              {snapshotDetails && <span className="scanner-refresh-summary" aria-live="polite">{snapshotDetails}</span>}
              <button
                type="button"
                onClick={resetScannerFilters}
                disabled={activeControlCount === 0}
                className="button-ghost scanner-reset-filters inline-flex h-8 items-center rounded-md px-2 text-[10px] font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="Reset Filters"
                title={activeControlCount === 0 ? 'Filters are already at their defaults' : 'Return Scanner filters to their defaults'}
              >
                Reset Filters
              </button>
            </div>
          </div>
            <div className="scanner-control-plane__toolbar">
              <div className="scanner-control-plane__criteria">
            <div className="grid grid-cols-[86px_minmax(96px,1fr)_70px_62px] items-end gap-1">
              <div className="min-w-0">
                <span className="mb-1 block text-[9px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Leverage</span>
                <div className="flex gap-1">
                  {LEVERAGE_OPTIONS.map(opt => <button key={opt} onClick={() => handleLeverageChange(opt)} className="scanner-filter-control pressable h-8 w-[26px] rounded-md px-0 text-[11px] font-medium" style={{ backgroundColor: leverageFilter === opt ? 'var(--accent)' : 'var(--surface-alt)', color: leverageFilter === opt ? 'white' : 'var(--text-muted)', border: `1px solid ${leverageFilter === opt ? 'var(--accent)' : 'var(--border)'}` }}>{opt}</button>)}
                </div>
              </div>
              <div className="scanner-control-plane__expiration"><ExpirationFilter value={expFilter} onChange={handleExpirationChange} options={expDropdownOptions} loadingDates={expirationDatesLoading} datesLoaded={availableExps.length > 0} /><p className="mt-1 text-[10px] leading-4" style={{ color: 'var(--text-dim)' }}>Selected expiration confirms exact listed availability; IV60 and liquidity use a bounded ~60 DTE benchmark.</p></div>
              <label className="min-w-0"><span className="mb-1 block text-[9px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Sort</span><select value={scannerSort} onChange={event => handleSortChange(event.target.value as ScannerSort)} className="scanner-filter-control h-8 w-full rounded-md px-1.5 text-[11px] outline-none" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>{SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <label className="min-w-0"><span className="mb-1 block text-[9px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Liquidity</span><select value={liquidityFilter} onChange={event => handleLiquidityChange(event.target.value as ScannerLiquidityFilter)} className="scanner-filter-control h-8 w-full rounded-md px-1.5 text-[11px] outline-none" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}><option value="all">All</option><option value="mediumPlus">Medium+</option><option value="liquidPlus">Liquid+</option></select></label>
            </div>
              </div>
              <div className="scanner-control-plane__types min-w-0"><span className="mb-1 block text-[9px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Type</span><div className="grid min-w-0 grid-cols-6 gap-1">{TYPE_OPTIONS.map(opt => <button key={opt} title={opt} onClick={() => handleTypeChange(opt)} className="scanner-filter-control pressable h-8 min-w-0 truncate rounded-md px-1 text-[10px] font-medium" style={{ backgroundColor: typeFilter === opt ? 'var(--accent)' : 'var(--surface-alt)', color: typeFilter === opt ? 'white' : 'var(--text-muted)', border: `1px solid ${typeFilter === opt ? 'var(--accent)' : 'var(--border)'}` }}>{opt === 'Broad Index' ? 'Broad' : opt}</button>)}</div></div>
            </div>
          </section>
          <section className="scanner-market-rail" aria-label="Market context">
            <div className="scanner-market-rail__header">
              <div>
                <div className="scanner-market-rail__eyebrow">Market context</div>
                <div className="scanner-market-rail__title">Index pulse</div>
              </div>
              <DataFreshness updatedAt={marketSummary.observedAt} status={marketFreshnessStatus} evidenceFreshness={marketSummary.freshness} source={`Yahoo Finance (${marketSummary.source})`} label="Market" />
            </div>
            <div className="scanner-market-rail__grid">
              <MarketChartCard ticker="SPY" chartTicker="SPY" data={spyData} loading={marketLoading} onRefresh={() => void loadMarketData(true)} onOpenChart={(chartTicker, displayTicker) => setChartModal({ ticker: chartTicker, displayTicker })} />
              <MarketChartCard ticker="VIX" chartTicker="^VIX" data={vixData} loading={marketLoading} onRefresh={() => void loadMarketData(true)} onOpenChart={(chartTicker, displayTicker) => setChartModal({ ticker: chartTicker, displayTicker })} />
              <MarketChartCard ticker="QQQ" chartTicker="QQQ" data={qqqData} loading={marketLoading} onRefresh={() => void loadMarketData(true)} onOpenChart={(chartTicker, displayTicker) => setChartModal({ ticker: chartTicker, displayTicker })} />
              <MarketChartCard ticker="VXN" chartTicker="^VXN" data={vxnData} loading={marketLoading} onRefresh={() => void loadMarketData(true)} onOpenChart={(chartTicker, displayTicker) => setChartModal({ ticker: chartTicker, displayTicker })} />
            </div>
          </section>
        </section>

        <section aria-label="ETF opportunities">
          <SectionHeader title="ETF opportunities" actions={<div className="scanner-results-meta"><DataFreshness updatedAt={pricesUpdatedAt} status={pricesFreshness} label="Scanner prices" />{pricesError && <span className="scanner-status-line__error">{pricesError}</span>}{expirationScope && <span className="scanner-expiration-coverage">{expirationScope.confirmed} confirmed · {expirationScope.unverified} unverified{expirationState.coverage !== 'complete' ? ' · incomplete' : ''}</span>}<ScannerResultCount count={filtered.length} /></div>} />
          <div className="scanner-results-grid">
          {filtered.map(etf => (
            <ETFCard
              key={etf.ticker}
              etf={etf}
              to={buildScannerOptionsPath(etf.ticker, expFilter)}
              navigationState={createOptionsNavigationState('scanner', { path: serializedScannerState ? `/?${serializedScannerState}` : '/' })}
              priceData={prices[etf.ticker] ?? null}
              optionSnapshot={optionSnapshots[etf.ticker] ?? null}
              optionDiagnostic={snapshotDiagnostics[etf.ticker] ?? null}
              isEvidenceOpen={activeEvidence?.ticker === etf.ticker}
              onEvidenceOpen={anchor => openEvidence(etf.ticker, anchor)}
              onEvidenceClose={closeEvidence}
              netAssets={fundAssets[etf.ticker] ?? null}
              priceError={!pricesLoading && !!pricesError && !prices[etf.ticker]}
              onRetry={() => loadPrices(true)}
            />
          ))}
          </div>

        {expirationScope && expirationState.coverage !== 'complete' && expirationScope.confirmed === 0 && <div className="scanner-incomplete-availability" role="status">No confirmed matches yet · availability incomplete. Unverified ETFs remain available below.</div>}
        {filtered.length === 0 && (
          <div className="scanner-empty-state surface-inset">
            <p className="font-semibold" style={{ color: 'var(--text)' }}>{expirationScope && expirationState.coverage !== 'complete' ? 'No confirmed matches yet · availability incomplete' : 'No ETFs match your filters.'}</p>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Try clearing search or widening the opportunity set.</p>
            <button type="button" className="button-secondary mt-3 rounded-md px-3 py-1.5 text-xs" onClick={resetScannerFilters}>Reset Filters</button>
          </div>
        )}
        </section>

        <footer className="mt-8 pb-6 text-center">
          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Data delayed up to 15 minutes. Not financial advice.</p>
        </footer>
      </div>

      {scannerEvidenceSurface}
      {chartModal && (
        <ErrorBoundary title="Chart unavailable" message="The chart modal could not render. Close it and try again.">
          <Suspense fallback={null}>
            <InteractivePriceChartModal
              isOpen
              ticker={chartModal.ticker}
              displayTicker={chartModal.displayTicker}
              onClose={() => setChartModal(null)}
            />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}

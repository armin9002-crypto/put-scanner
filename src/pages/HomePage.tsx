import { lazy, Suspense, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { fetchBatchPricesResult, fetchOptions, fetchSparkline, fetchWithConcurrencyLimit } from '../lib/api';
import type { SparklineData } from '../lib/api';
import type { BatchPriceData } from '../lib/cache';
import ETFCard from '../components/ETFCard';
import ExpirationFilter, { buildExpirationOptions } from '../components/ExpirationFilter';
import SparklineChart from '../components/SparklineChart';
import ErrorBoundary from '../components/ErrorBoundary';
import DataFreshness, { type DataFreshnessStatus } from '../components/DataFreshness';
import { Search, Loader2, RefreshCw, SlidersHorizontal, ChevronDown } from 'lucide-react';
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

const HARDCODED_TICKERS = 'AGQ,BOIL,BRZU,BULZ,CURE,CWEB,DDM,DFEN,DIG,DPST,DUSL,EDC,ERX,EURL,FAS,FNGU,GUSH,HIBL,INDL,LABU,MIDU,NAIL,NUGT,QLD,ROM,SOXL,SSO,TECL,TNA,TQQQ,UCO,UDOW,UGL,UPRO,URTY,USD,UTSL,UWM,UYG,UYM,WEBL,YINN';

const LEVERAGE_OPTIONS = ['All', '2x', '3x'] as const;
const TYPE_OPTIONS = ['All', 'Broad Index', 'Sector', 'Commodity', 'Country'] as const;

// Import ETF_LIST for filtering only
import { ETF_LIST } from '../lib/etfs';
import {
  buildCachedExpirationState,
  diagnosticForOutcome,
  snapshotProgressLabel,
  summarizeSnapshotOutcomes,
  type CachedExpirationState,
  type SnapshotUpdateProgress,
} from '../lib/scannerUpdateState';
import { passesScannerLiquidityFilter, sortScannerEtfs, type ScannerLiquidityFilter, type ScannerSort } from '../lib/scannerDiscovery';
import { fetchFundAssets, type FundAssetsData } from '../lib/fundAssets';
import { parseScannerState, resolveScannerExpiration, serializeScannerState, type ScannerState } from '../lib/scannerState';
import { saveLastScannerUrl, type ScannerNavigationState } from '../lib/scannerNavigation';
import { useResponsiveMode } from '../lib/responsive';
import MobileBottomSheet from '../components/mobile/MobileBottomSheet';
import MobileMarketStrip from '../components/mobile/MobileMarketStrip';
import MobileEtfRow from '../components/mobile/MobileEtfRow';

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
      className="rounded-lg p-2 min-w-0 cursor-pointer transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
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
        <div className="flex items-center justify-center h-[48px] sm:h-[52px]">
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
          <div className="flex items-center justify-between gap-2 mt-1">
            <span className="text-xs font-mono font-semibold tabular-nums truncate" style={{ color: 'var(--text)' }}>
              {prefix}{data.price.toFixed(2)}
            </span>
            <span className="text-[10px] font-mono tabular-nums whitespace-nowrap" style={{ color }}>
              {changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%
            </span>
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center h-[70px] text-xs" style={{ color: 'var(--text-dim)' }}>Market data unavailable</div>
      )}
    </div>
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
    const expirations = initialExpirationStateRef.current.expirations;
    initialScannerStateRef.current = {
      ...parsed,
      expiration: resolveScannerExpiration(parsed.expiration, expirations.filter(expiration => expiration.dte > 30).map(expiration => expiration.date), expirations.some(expiration => expiration.dte <= 30)),
    };
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
  const [optionSnapshots, setOptionSnapshots] = useState<Record<string, ScannerOptionSnapshot>>(() => getScannerOptionSnapshots());
  const [snapshotDiagnostics, setSnapshotDiagnostics] = useState<Record<string, ScannerSnapshotDiagnostic>>(() => getScannerSnapshotDiagnostics());
  const [snapshotProgress, setSnapshotProgress] = useState<SnapshotUpdateProgress | null>(null);
  const snapshotUpdateRunningRef = useRef(false);
  const { expirations: availableExps, availability: expiryAvailability } = expirationState;

  // Batch price data
  const [prices, setPrices] = useState<BatchPriceData>({});
  const [pricesLoading, setPricesLoading] = useState(true);
  const [pricesError, setPricesError] = useState<string | null>(null);
  const [pricesUpdatedAt, setPricesUpdatedAt] = useState<number | null>(null);
  const [pricesFreshness, setPricesFreshness] = useState<DataFreshnessStatus>('updating');
  const [fundAssets, setFundAssets] = useState<FundAssetsData>({});
  const skeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Market sparkline data (manual refresh only)
  const [qqqData, setQqqData] = useState<SparklineData | null>(null);
  const [spyData, setSpyData] = useState<SparklineData | null>(null);
  const [vixData, setVixData] = useState<SparklineData | null>(null);
  const [vxnData, setVxnData] = useState<SparklineData | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [lastMarketUpdate, setLastMarketUpdate] = useState<Date | null>(null);
  const [marketRefreshFailed, setMarketRefreshFailed] = useState(false);
  const [chartModal, setChartModal] = useState<{ ticker: string; displayTicker: string } | null>(null);

  // Load batch prices with 10-second hard timeout
  const loadPrices = useCallback(async (forceRefresh = false) => {
    setPricesLoading(true);
    setPricesError(null);
    setPricesFreshness('updating');

    // Max 10 seconds for skeleton loader
    if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current);
    skeletonTimerRef.current = setTimeout(() => {
      setPricesLoading(false);
      setPrices(current => {
        if (Object.keys(current).length === 0) setPricesError('Price data unavailable');
        return current;
      });
    }, 10000);

    try {
      const tickers = HARDCODED_TICKERS.split(',');
      const fetchPromise = fetchBatchPricesResult(tickers, { mode: forceRefresh ? 'revalidate' : 'cache-first' });

      // 10-second hard timeout
      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out')), 10000)
      );

      const response = await Promise.race([fetchPromise, timeoutPromise]);
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
      setPricesError(err instanceof Error ? err.message : 'Price data unavailable');
      setPricesFreshness('failed');
    } finally {
      if (skeletonTimerRef.current) {
        clearTimeout(skeletonTimerRef.current);
        skeletonTimerRef.current = null;
      }
      setPricesLoading(false);
    }
  }, []);

  useEffect(() => { loadPrices(); }, [loadPrices]);

  useEffect(() => {
    let cancelled = false;
    fetchFundAssets(HARDCODED_TICKERS.split(','))
      .then(data => { if (!cancelled) setFundAssets(current => ({ ...current, ...data })); })
      .catch(() => { /* preserve any cached/previous Assets values */ });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    setExpFilter(current => resolveScannerExpiration(
      current,
      availableExps.filter(expiration => expiration.dte > 30).map(expiration => expiration.date),
      availableExps.some(expiration => expiration.dte <= 30),
    ));
  }, [availableExps]);

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
  const loadMarketData = useCallback(async () => {
    setMarketLoading(true);
    setMarketRefreshFailed(false);
    try {
      const [qqq, spy, vix, vxn] = await Promise.allSettled([
        fetchSparkline('QQQ'),
        fetchSparkline('SPY'),
        fetchSparkline('^VIX'),
        fetchSparkline('^VXN'),
      ]);
      if (qqq.status === 'fulfilled') setQqqData(qqq.value);
      if (spy.status === 'fulfilled') setSpyData(spy.value);
      if (vix.status === 'fulfilled') setVixData(vix.value);
      if (vxn.status === 'fulfilled') setVxnData(vxn.value);
      const fulfilled = [qqq, spy, vix, vxn].filter(result => result.status === 'fulfilled').length;
      if (fulfilled > 0) setLastMarketUpdate(new Date());
      setMarketRefreshFailed(fulfilled < 4);
    } catch { /* ignore */ }
    setMarketLoading(false);
  }, []);

  useEffect(() => { loadMarketData(); }, [loadMarketData]);

  useEffect(() => {
    if (!snapshotProgress?.complete) return;
    const timer = window.setTimeout(() => setSnapshotProgress(null), 12_000);
    return () => window.clearTimeout(timer);
  }, [snapshotProgress?.complete]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const dateToDte = new Map(availableExps.map(exp => [exp.date, exp.dte]));
    const matches = ETF_LIST.filter(e => {
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
      if (expFilter === 'lte_30dte') {
        const dates = expiryAvailability[e.ticker] ?? [];
        if (!dates.some(date => (dateToDte.get(date) ?? Infinity) <= 30)) {
          return false;
        }
      } else if (expFilter.startsWith('date_')) {
        const targetDate = Number(expFilter.replace('date_', ''));
        const dates = expiryAvailability[e.ticker] ?? [];
        if (!dates.includes(targetDate)) {
          return false;
        }
      }
      return true;
    });
    return sortScannerEtfs(matches, scannerSort, prices, optionSnapshots);
  }, [search, leverageFilter, typeFilter, liquidityFilter, scannerSort, prices, optionSnapshots, expFilter, expiryAvailability, availableExps]);

  const expDropdownOptions = useMemo(() => buildExpirationOptions(availableExps), [availableExps]);

  const handleExpirationChange = useCallback((value: string) => {
    setExpFilter(value);
  }, []);

  const updateVisibleOptionSnapshots = useCallback(async () => {
    if (snapshotUpdateRunningRef.current) return;
    const tickers = [...new Set(filtered.map(etf => etf.ticker.trim().toUpperCase()))]
      .filter(ticker => isScannerOptionSnapshotStale(optionSnapshots[ticker]));
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
        if (outcome.status !== 'updated') {
          const diagnostic = diagnosticForOutcome(outcome);
          if (diagnostic) recordScannerSnapshotDiagnostic(ticker, diagnostic.status, diagnostic.reason);
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
      const summary = summarizeSnapshotOutcomes(outcomes);
      setOptionSnapshots(getScannerOptionSnapshots());
      setSnapshotDiagnostics(getScannerSnapshotDiagnostics());
      setExpirationState(buildCachedExpirationState());
      setSnapshotProgress(current => current ? { ...current, ...summary, complete: true } : current);
    } finally {
      snapshotUpdateRunningRef.current = false;
    }
  }, [filtered, optionSnapshots, prices]);

  const mobileActiveFilterCount = [
    leverageFilter !== 'All',
    typeFilter !== 'All',
    liquidityFilter !== 'all',
    scannerSort !== 'default',
  ].filter(Boolean).length;

  if (isPhone) {
    const marketItems = [
      { ticker: 'SPY', data: spyData, chartTicker: 'SPY', isVolatility: false },
      { ticker: 'QQQ', data: qqqData, chartTicker: 'QQQ', isVolatility: false },
      { ticker: 'VIX', data: vixData, chartTicker: '^VIX', isVolatility: true },
      { ticker: 'VXN', data: vxnData, chartTicker: '^VXN', isVolatility: true },
    ];
    const resetMobileFilters = () => {
      setLeverageFilter('All');
      setTypeFilter('All');
      setLiquidityFilter('all');
      setScannerSort('default');
    };

    return (
      <div className="mobile-route-page min-h-[100dvh]" style={{ backgroundColor: 'var(--bg)' }}>
        <MobileMarketStrip items={marketItems.map(item => ({
          ticker: item.ticker,
          price: item.data?.price ?? null,
          changePercent: item.data?.changePercent ?? null,
          isVolatility: item.isVolatility,
          loading: marketLoading,
          onOpen: () => item.data && setChartModal({ ticker: item.chartTicker, displayTicker: item.ticker }),
        }))} />

        <div className="px-3.5 pb-3 pt-3">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
            <label className="min-w-0">
              <span className="sr-only">Expiration</span>
              <select value={expFilter} onChange={event => handleExpirationChange(event.target.value)} className="mobile-control-field w-full" aria-label="Scanner expiration">
                {expDropdownOptions.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
            <button type="button" onClick={() => setMobileFiltersOpen(true)} className="pressable mobile-control-button" aria-haspopup="dialog">
              <SlidersHorizontal className="h-4 w-4" /> Filters{mobileActiveFilterCount > 0 ? ` ${mobileActiveFilterCount}` : ''}
            </button>
          </div>

          <label className="relative mt-2 block">
            <span className="sr-only">Search ETFs</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: 'var(--text-dim)' }} />
            <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search ETFs" className="mobile-control-field w-full pl-10" />
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 border-y px-3.5 py-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold" style={{ color: 'var(--text)' }}>ETF opportunities</h2>
            <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{filtered.length} results · {expDropdownOptions.find(option => option.value === expFilter)?.label ?? 'All dates'}</p>
          </div>
          {(pricesLoading || marketLoading) && <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--text-muted)' }}><Loader2 className="h-3 w-3 animate-spin" /> Updating</span>}
        </div>

        <div className="mobile-financial-list">
          {pricesLoading && Object.keys(prices).length === 0 ? Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="mobile-etf-row animate-pulse"><div className="h-4 w-20 rounded" style={{ backgroundColor: 'var(--border)' }} /><div className="mt-3 h-3 w-44 rounded" style={{ backgroundColor: 'var(--border)' }} /><div className="mt-5 h-3 w-full rounded" style={{ backgroundColor: 'var(--border)' }} /></div>
          )) : filtered.map(etf => (
            <MobileEtfRow
              key={etf.ticker}
              etf={etf}
              to={`/options/${etf.ticker}`}
              navigationState={{ fromScanner: true } satisfies ScannerNavigationState}
              priceData={prices[etf.ticker] ?? null}
              optionSnapshot={optionSnapshots[etf.ticker] ?? null}
              optionDiagnostic={snapshotDiagnostics[etf.ticker] ?? null}
              netAssets={fundAssets[etf.ticker] ?? null}
            />
          ))}
        </div>

        {filtered.length === 0 && !pricesLoading && <div className="px-6 py-12 text-center"><p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>No matching ETFs</p><p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Try clearing search or widening your filters.</p><button type="button" onClick={resetMobileFilters} className="tap-target mt-3 rounded-lg px-4 text-xs font-semibold" style={{ color: 'var(--accent-light)', backgroundColor: 'var(--accent-bg)' }}>Reset filters</button></div>}

        {mobileFiltersOpen && (
          <MobileBottomSheet
            title="Scanner filters"
            description="Refine the ETF opportunity list"
            onClose={() => setMobileFiltersOpen(false)}
            footer={<div className="grid grid-cols-2 gap-2"><button type="button" onClick={resetMobileFilters} className="mobile-sheet-action secondary">Reset</button><button type="button" onClick={() => setMobileFiltersOpen(false)} className="mobile-sheet-action primary">Apply</button></div>}
          >
            <div className="space-y-5">
              <fieldset>
                <legend className="mobile-sheet-label">Leverage</legend>
                <div className="grid grid-cols-3 gap-2">{LEVERAGE_OPTIONS.map(option => <button type="button" key={option} onClick={() => setLeverageFilter(option)} className="mobile-choice" data-selected={leverageFilter === option}>{option}</button>)}</div>
              </fieldset>
              <fieldset>
                <legend className="mobile-sheet-label">Type</legend>
                <div className="grid grid-cols-2 gap-2">{TYPE_OPTIONS.map(option => <button type="button" key={option} onClick={() => setTypeFilter(option)} className="mobile-choice" data-selected={typeFilter === option}>{option === 'Broad Index' ? 'Broad' : option}</button>)}</div>
              </fieldset>
              <fieldset>
                <legend className="mobile-sheet-label">Liquidity</legend>
                <div className="grid grid-cols-3 gap-2">{([['all', 'All'], ['mediumPlus', 'Medium+'], ['liquidPlus', 'Liquid+']] as const).map(([value, label]) => <button type="button" key={value} onClick={() => setLiquidityFilter(value)} className="mobile-choice" data-selected={liquidityFilter === value}>{label}</button>)}</div>
              </fieldset>
              <label className="block"><span className="mobile-sheet-label">Sort</span><select value={scannerSort} onChange={event => setScannerSort(event.target.value as ScannerSort)} className="mobile-control-field w-full">{SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
              <button type="button" onClick={() => void updateVisibleOptionSnapshots()} disabled={snapshotUpdateRunningRef.current} className="mobile-sheet-action secondary w-full">{snapshotProgress && !snapshotProgress.complete ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}{snapshotProgressLabel(snapshotProgress)}</button>
            </div>
          </MobileBottomSheet>
        )}

        {chartModal && <ErrorBoundary title="Chart unavailable" message="The chart modal could not render. Close it and try again."><Suspense fallback={null}><InteractivePriceChartModal isOpen ticker={chartModal.ticker} displayTicker={chartModal.displayTicker} onClose={() => setChartModal(null)} /></Suspense></ErrorBoundary>}
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-4 sm:py-5">
        <div className="relative mb-3">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Filter by ticker or underlying index..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3.5 sm:py-3 rounded-xl text-base sm:text-sm outline-none transition-all"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(360px,500px)_minmax(0,1fr)] xl:grid-cols-[minmax(420px,520px)_minmax(0,1fr)] lg:items-start gap-3 mb-4">
          {/* Filters */}
          <div className="scanner-filter-card w-full rounded-xl p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <button
              type="button"
              className="pressable flex min-h-11 w-full items-center justify-between gap-3 sm:hidden"
              aria-expanded={mobileFiltersOpen}
              aria-controls="scanner-filter-controls"
              onClick={() => setMobileFiltersOpen(current => !current)}
            >
              <span className="flex min-w-0 items-center gap-2 text-left">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg" style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-light)' }}>
                  <SlidersHorizontal className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Expiration & filters</span>
                  <span className="block truncate text-sm font-semibold" style={{ color: 'var(--text)' }}>{expDropdownOptions.find(option => option.value === expFilter)?.label ?? 'Any expiration'}</span>
                </span>
              </span>
              <ChevronDown className={`h-4 w-4 flex-none transition-transform ${mobileFiltersOpen ? 'rotate-180' : ''}`} style={{ color: 'var(--text-muted)' }} />
            </button>

            <div id="scanner-filter-controls" className={`scanner-filter-controls ${mobileFiltersOpen ? 'is-open' : ''}`}>
            <div className="grid grid-cols-1 sm:grid-cols-[auto_minmax(200px,1fr)] gap-3 sm:items-end">
              <div>
                <span className="block text-xs font-medium uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Leverage</span>
                <div className="grid grid-cols-3 gap-1.5 sm:flex">
                  {LEVERAGE_OPTIONS.map(opt => (
                    <button
                      key={opt}
                      onClick={() => setLeverageFilter(opt)}
                      className="pressable px-3 py-2 sm:py-1 rounded-lg text-sm font-medium transition-all min-h-[44px] sm:min-h-0"
                      style={{
                        backgroundColor: leverageFilter === opt ? 'var(--accent)' : 'var(--surface-alt)',
                        color: leverageFilter === opt ? 'white' : 'var(--text-muted)',
                        border: leverageFilter === opt ? 'none' : '1px solid var(--border)',
                      }}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>

              <ExpirationFilter
                value={expFilter}
                onChange={handleExpirationChange}
                options={expDropdownOptions}
                loadingDates={false}
                datesLoaded
              />
            </div>

            <div className="mt-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="block text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Type</span>
                <button
                  type="button"
                  onClick={() => void updateVisibleOptionSnapshots()}
                  disabled={snapshotUpdateRunningRef.current}
                  className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-medium whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-60"
                  style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
                  title="Update missing or stale IV60 and liquidity snapshots for visible ETFs"
                >
                  {snapshotProgress && !snapshotProgress.complete && <Loader2 className="h-3 w-3 animate-spin" />}
                  {snapshotProgressLabel(snapshotProgress)}
                </button>
              </div>
              <div className="grid grid-cols-2 min-[430px]:grid-cols-3 sm:flex gap-1.5 min-w-0">
                {TYPE_OPTIONS.map(opt => (
                  <button
                    key={opt}
                    onClick={() => setTypeFilter(opt)}
                    className="pressable px-2.5 py-2 sm:px-3 sm:py-1 rounded-lg text-sm font-medium transition-all min-h-[44px] sm:min-h-0 truncate"
                    style={{
                      backgroundColor: typeFilter === opt ? 'var(--accent)' : 'var(--surface-alt)',
                      color: typeFilter === opt ? 'white' : 'var(--text-muted)',
                      border: typeFilter === opt ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    {opt}
                  </button>
                ))}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <label className="min-w-0">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Sort</span>
                  <select value={scannerSort} onChange={event => setScannerSort(event.target.value as ScannerSort)} className="h-9 w-full rounded-lg px-2 text-xs outline-none" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                    {SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="min-w-0">
                  <span className="mb-1 block text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Liquidity</span>
                  <select value={liquidityFilter} onChange={event => setLiquidityFilter(event.target.value as ScannerLiquidityFilter)} className="h-9 w-full rounded-lg px-2 text-xs outline-none" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                    <option value="all">All</option><option value="mediumPlus">Medium+</option><option value="liquidPlus">Liquid+</option>
                  </select>
                </label>
              </div>
            </div>
            </div>
          </div>

          <div className="scanner-market-strip mobile-scroll-row grid grid-cols-1 min-[390px]:grid-cols-2 xl:grid-cols-4 gap-2 min-w-0">
            <MarketChartCard ticker="SPY" chartTicker="SPY" data={spyData} loading={marketLoading} onRefresh={loadMarketData} onOpenChart={(chartTicker, displayTicker) => setChartModal({ ticker: chartTicker, displayTicker })} />
            <MarketChartCard ticker="VIX" chartTicker="^VIX" data={vixData} loading={marketLoading} onRefresh={loadMarketData} onOpenChart={(chartTicker, displayTicker) => setChartModal({ ticker: chartTicker, displayTicker })} />
            <MarketChartCard ticker="QQQ" chartTicker="QQQ" data={qqqData} loading={marketLoading} onRefresh={loadMarketData} onOpenChart={(chartTicker, displayTicker) => setChartModal({ ticker: chartTicker, displayTicker })} />
            <MarketChartCard ticker="VXN" chartTicker="^VXN" data={vxnData} loading={marketLoading} onRefresh={loadMarketData} onOpenChart={(chartTicker, displayTicker) => setChartModal({ ticker: chartTicker, displayTicker })} />
          </div>
        </div>

        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <DataFreshness updatedAt={pricesUpdatedAt} status={pricesFreshness} label="Scanner prices" />
          <DataFreshness updatedAt={lastMarketUpdate} status={marketLoading ? 'updating' : marketRefreshFailed ? 'failed' : lastMarketUpdate ? 'fresh' : 'cached'} label="Market charts" />
        </div>

        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h1 className="text-base font-bold tracking-tight" style={{ color: 'var(--text)' }}>ETFs</h1>
          <span className="text-xs font-medium tabular-nums" style={{ color: 'var(--text-dim)' }}>{filtered.length} results</span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
          {filtered.map(etf => (
            <ETFCard
              key={etf.ticker}
              etf={etf}
              to={`/options/${etf.ticker}`}
              navigationState={{ fromScanner: true } satisfies ScannerNavigationState}
              priceData={prices[etf.ticker] ?? null}
              optionSnapshot={optionSnapshots[etf.ticker] ?? null}
              optionDiagnostic={snapshotDiagnostics[etf.ticker] ?? null}
              netAssets={fundAssets[etf.ticker] ?? null}
              priceError={!pricesLoading && !!pricesError && !prices[etf.ticker]}
              onRetry={() => loadPrices(true)}
            />
          ))}
        </div>

        {filtered.length === 0 && (
          <div className="text-center py-16">
            <p style={{ color: 'var(--text-muted)' }}>No ETFs match your filters.</p>
          </div>
        )}

        <footer className="mt-12 pb-6 text-center">
          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Data delayed up to 15 minutes. Not financial advice.</p>
        </footer>
      </div>

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

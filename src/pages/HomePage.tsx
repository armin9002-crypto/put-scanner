import { lazy, Suspense, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { fetchBatchPricesResult, fetchOptions, fetchSparkline, fetchWithConcurrencyLimit } from '../lib/api';
import type { SparklineData } from '../lib/api';
import type { BatchPriceData } from '../lib/cache';
import ETFCard from '../components/ETFCard';
import ExpirationFilter, { buildExpirationOptions, formatExpirationDropdownLabel } from '../components/ExpirationFilter';
import SparklineChart from '../components/SparklineChart';
import ErrorBoundary from '../components/ErrorBoundary';
import { Search, Loader2, RefreshCw } from 'lucide-react';
import {
  cacheScannerOptionSnapshot,
  calculateCalendarDte,
  getAllCachedScannerExpirations,
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

interface CachedExpirationState {
  expirations: { date: number; label: string; dte: number }[];
  availability: Record<string, number[]>;
}

interface SnapshotUpdateProgress {
  current: number;
  total: number;
  updated: number;
  expanded: number;
  unavailable: number;
  failed: number;
  complete: boolean;
}

function buildCachedExpirationState(): CachedExpirationState {
  const availability = getAllCachedScannerExpirations();
  const expirationMap = new Map<number, { date: number; label: string; dte: number }>();
  Object.values(availability).flat().forEach(date => {
    const dte = calculateCalendarDte(date);
    if (dte <= 0 || expirationMap.has(date)) return;
    expirationMap.set(date, {
      date,
      label: formatExpirationDropdownLabel(date),
      dte,
    });
  });
  return {
    expirations: [...expirationMap.values()].sort((a, b) => a.date - b.date),
    availability,
  };
}

function summarizeSnapshotOutcomes(outcomes: ScannerSnapshotUpdateOutcome[]): Pick<
  SnapshotUpdateProgress,
  'updated' | 'expanded' | 'unavailable' | 'failed'
> {
  return outcomes.reduce((summary, outcome) => {
    if (outcome.status === 'updated') summary.updated += 1;
    if (outcome.status === 'updated' && outcome.expanded) summary.expanded += 1;
    if (outcome.status === 'unavailable') summary.unavailable += 1;
    if (outcome.status === 'failed') summary.failed += 1;
    return summary;
  }, { updated: 0, expanded: 0, unavailable: 0, failed: 0 });
}

function snapshotProgressLabel(progress: SnapshotUpdateProgress | null): string {
  if (!progress) return 'Update IV / Liquidity';
  if (!progress.complete) return `Updating ${progress.current}/${progress.total}`;
  if (progress.total === 0) return 'IV / Liquidity Current';
  return `Updated ${progress.updated} · Expanded ${progress.expanded} · Unavailable ${progress.unavailable} · Failed ${progress.failed}`;
}

function diagnosticForOutcome(outcome: ScannerSnapshotUpdateOutcome): { status: ScannerSnapshotDiagnostic['status']; reason: string } | null {
  if (outcome.status === 'failed') {
    return { status: 'failed', reason: outcome.reason ?? 'Snapshot update failed.' };
  }
  if (outcome.status === 'unavailable') {
    return { status: 'unavailable', reason: outcome.reason ?? 'No usable snapshot could be constructed.' };
  }
  return null;
}

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
  const [search, setSearch] = useState('');
  const [leverageFilter, setLeverageFilter] = useState<string>('All');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [expFilter, setExpFilter] = useState('all');
  const [expirationState, setExpirationState] = useState<CachedExpirationState>(() => buildCachedExpirationState());
  const [optionSnapshots, setOptionSnapshots] = useState<Record<string, ScannerOptionSnapshot>>(() => getScannerOptionSnapshots());
  const [snapshotDiagnostics, setSnapshotDiagnostics] = useState<Record<string, ScannerSnapshotDiagnostic>>(() => getScannerSnapshotDiagnostics());
  const [snapshotProgress, setSnapshotProgress] = useState<SnapshotUpdateProgress | null>(null);
  const snapshotUpdateRunningRef = useRef(false);
  const { expirations: availableExps, availability: expiryAvailability } = expirationState;

  // Batch price data
  const [prices, setPrices] = useState<BatchPriceData>({});
  const [pricesLoading, setPricesLoading] = useState(true);
  const [pricesError, setPricesError] = useState<string | null>(null);
  const skeletonTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Market sparkline data (manual refresh only)
  const [qqqData, setQqqData] = useState<SparklineData | null>(null);
  const [spyData, setSpyData] = useState<SparklineData | null>(null);
  const [vixData, setVixData] = useState<SparklineData | null>(null);
  const [vxnData, setVxnData] = useState<SparklineData | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [lastMarketUpdate, setLastMarketUpdate] = useState<Date | null>(null);
  const [chartModal, setChartModal] = useState<{ ticker: string; displayTicker: string } | null>(null);

  // Load batch prices with 10-second hard timeout
  const loadPrices = useCallback(async (forceRefresh = false) => {
    setPricesLoading(true);
    setPricesError(null);

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
        if (response.staleFallbackUsed) setPricesError('Refresh failed - showing cached prices');
      }
    } catch (err: unknown) {
      setPricesError(err instanceof Error ? err.message : 'Price data unavailable');
    } finally {
      if (skeletonTimerRef.current) {
        clearTimeout(skeletonTimerRef.current);
        skeletonTimerRef.current = null;
      }
      setPricesLoading(false);
    }
  }, []);

  useEffect(() => { loadPrices(); }, [loadPrices]);

  // Load market sparklines (manual refresh only, with cache)
  const loadMarketData = useCallback(async () => {
    setMarketLoading(true);
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
      setLastMarketUpdate(new Date());
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
  }, [search, leverageFilter, typeFilter, expFilter, expiryAvailability, availableExps]);

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
          <div className="w-full rounded-xl p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="grid grid-cols-1 sm:grid-cols-[auto_minmax(200px,1fr)] gap-3 sm:items-end">
              <div>
                <span className="block text-xs font-medium uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Leverage</span>
                <div className="grid grid-cols-3 gap-1.5 sm:flex">
                  {LEVERAGE_OPTIONS.map(opt => (
                    <button
                      key={opt}
                      onClick={() => setLeverageFilter(opt)}
                      className="px-3 py-2 sm:py-1 rounded-lg text-sm font-medium transition-all min-h-[44px] sm:min-h-0"
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
                    className="px-2.5 py-2 sm:px-3 sm:py-1 rounded-lg text-sm font-medium transition-all min-h-[44px] sm:min-h-0 truncate"
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
            </div>
          </div>

          <div className="grid grid-cols-1 min-[390px]:grid-cols-2 xl:grid-cols-4 gap-2 min-w-0">
            <MarketChartCard ticker="SPY" chartTicker="SPY" data={spyData} loading={marketLoading} onRefresh={loadMarketData} onOpenChart={(chartTicker, displayTicker) => setChartModal({ ticker: chartTicker, displayTicker })} />
            <MarketChartCard ticker="VIX" chartTicker="^VIX" data={vixData} loading={marketLoading} onRefresh={loadMarketData} onOpenChart={(chartTicker, displayTicker) => setChartModal({ ticker: chartTicker, displayTicker })} />
            <MarketChartCard ticker="QQQ" chartTicker="QQQ" data={qqqData} loading={marketLoading} onRefresh={loadMarketData} onOpenChart={(chartTicker, displayTicker) => setChartModal({ ticker: chartTicker, displayTicker })} />
            <MarketChartCard ticker="VXN" chartTicker="^VXN" data={vxnData} loading={marketLoading} onRefresh={loadMarketData} onOpenChart={(chartTicker, displayTicker) => setChartModal({ ticker: chartTicker, displayTicker })} />
          </div>
        </div>

        {lastMarketUpdate && (
          <div className="text-[10px] mb-4" style={{ color: 'var(--text-dim)' }}>
            Market data updated: {lastMarketUpdate.toLocaleTimeString()}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
          {filtered.map(etf => (
            <ETFCard
              key={etf.ticker}
              etf={etf}
              to={`/options/${etf.ticker}`}
              priceData={prices[etf.ticker] ?? null}
              optionSnapshot={optionSnapshots[etf.ticker] ?? null}
              optionDiagnostic={snapshotDiagnostics[etf.ticker] ?? null}
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

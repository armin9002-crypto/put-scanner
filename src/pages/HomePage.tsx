import { lazy, Suspense, useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearBatchPriceCache, fetchBatchPrices, fetchOptions, fetchSparkline, fetchWithConcurrencyLimit } from '../lib/api';
import type { SparklineData } from '../lib/api';
import { getExpirationsCache, setExpirationsCache } from '../lib/cache';
import type { BatchPriceData } from '../lib/cache';
import ETFCard from '../components/ETFCard';
import ExpirationFilter, { buildExpirationOptions, formatExpirationDropdownLabel } from '../components/ExpirationFilter';
import SparklineChart from '../components/SparklineChart';
import ErrorBoundary from '../components/ErrorBoundary';
import { Search, Loader2, RefreshCw } from 'lucide-react';

const InteractivePriceChartModal = lazy(() => import('../components/InteractivePriceChartModal'));

const HARDCODED_TICKERS = 'AGQ,BOIL,BRZU,BULZ,CURE,CWEB,DDM,DFEN,DIG,DPST,DUSL,EDC,ERX,EURL,FAS,FNGU,GUSH,HIBL,INDL,LABU,MIDU,NAIL,NUGT,QLD,ROM,SOXL,SSO,TECL,TNA,TQQQ,UCO,UDOW,UGL,UPRO,URTY,USD,UTSL,UWM,UYG,UYM,WEBL,YINN';

const LEVERAGE_OPTIONS = ['All', '2x', '3x'] as const;
const TYPE_OPTIONS = ['All', 'Broad Index', 'Sector', 'Commodity', 'Country'] as const;
const EXPIRY_AVAILABILITY_CACHE_KEY = 'scanner_expiry_availability_cache_v1';
const EXPIRY_AVAILABILITY_TTL = 2 * 60 * 60 * 1000;

// Import ETF_LIST for filtering only
import { ETF_LIST } from '../lib/etfs';

interface ExpiryAvailabilityCache {
  expirations: { date: number; label: string; dte: number }[];
  availability: Record<string, number[]>;
}

function getExpiryAvailabilityCache(): ExpiryAvailabilityCache | null {
  try {
    const raw = localStorage.getItem(EXPIRY_AVAILABILITY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (Date.now() - parsed.timestamp > EXPIRY_AVAILABILITY_TTL) {
      localStorage.removeItem(EXPIRY_AVAILABILITY_CACHE_KEY);
      return null;
    }
    return parsed.data as ExpiryAvailabilityCache;
  } catch {
    return null;
  }
}

function setExpiryAvailabilityCache(data: ExpiryAvailabilityCache): void {
  try {
    localStorage.setItem(EXPIRY_AVAILABILITY_CACHE_KEY, JSON.stringify({ data, timestamp: Date.now() }));
  } catch { /* ignore unavailable storage */ }
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
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [leverageFilter, setLeverageFilter] = useState<string>('All');
  const [typeFilter, setTypeFilter] = useState<string>('All');
  const [expFilter, setExpFilter] = useState('all');
  const [availableExps, setAvailableExps] = useState<{ date: number; label: string; dte: number }[]>([]);
  const [expiryAvailability, setExpiryAvailability] = useState<Record<string, number[]>>({});
  const [datesLoaded, setDatesLoaded] = useState(false);
  const [loadingDates, setLoadingDates] = useState(false);

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
  const loadPrices = useCallback(async (clearCache = false) => {
    if (clearCache) clearBatchPriceCache();
    setPricesLoading(true);
    setPricesError(null);

    // Max 10 seconds for skeleton loader
    if (skeletonTimerRef.current) clearTimeout(skeletonTimerRef.current);
    skeletonTimerRef.current = setTimeout(() => {
      setPricesLoading(false);
      if (Object.keys(prices).length === 0) {
        setPricesError('Price data unavailable');
      }
    }, 10000);

    try {
      const tickers = HARDCODED_TICKERS.split(',');
      const fetchPromise = fetchBatchPrices(tickers);

      // 10-second hard timeout
      const timeoutPromise = new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Request timed out')), 10000)
      );

      const data = await Promise.race([fetchPromise, timeoutPromise]) as BatchPriceData;

      if (!data || Object.keys(data).length === 0) {
        setPricesError('Price data unavailable');
      } else {
        const validCount = Object.values(data).filter(value => value?.price != null && value.price > 0).length;
        if (validCount < 10) {
          setPricesError('Partial data received — some prices unavailable');
        }
        setPrices(data);
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
  }, [prices]);

  useEffect(() => { loadPrices(); }, []);

  useEffect(() => {
    const availabilityCache = getExpiryAvailabilityCache();
    if (availabilityCache && availabilityCache.expirations.length > 0) {
      setAvailableExps(availabilityCache.expirations);
      setExpiryAvailability(availabilityCache.availability);
      setDatesLoaded(true);
      return;
    }

    const cached = getExpirationsCache();
    if (cached && cached.expirations.length > 0) {
      setAvailableExps(cached.expirations);
    }

    let cancelled = false;
    (async () => {
      setLoadingDates(true);
      const tasks = ETF_LIST.map(etf => async () => {
        try {
          const data = await fetchOptions(etf.ticker);
          return { ticker: etf.ticker, data };
        } catch {
          return null;
        }
      });
      const results = await fetchWithConcurrencyLimit(tasks, 5);
      if (cancelled) return;

      const allExps = new Map<number, { date: number; label: string; dte: number }>();
      const availability: Record<string, number[]> = {};
      for (const result of results) {
        if (result.status !== 'fulfilled' || !result.value) continue;
        const { ticker, data } = result.value;
        availability[ticker] = data.expirations.map(exp => exp.date);
        for (const exp of data.expirations) {
          if (!allExps.has(exp.date)) {
            allExps.set(exp.date, {
              date: exp.date,
              label: formatExpirationDropdownLabel(exp.date),
              dte: exp.dte,
            });
          }
        }
      }

      const sorted = Array.from(allExps.values()).sort((a, b) => a.date - b.date);
      setAvailableExps(sorted);
      setExpiryAvailability(availability);
      setDatesLoaded(true);
      setLoadingDates(false);
      setExpirationsCache(sorted);
      setExpiryAvailabilityCache({ expirations: sorted, availability });
    })();

    return () => { cancelled = true; };
  }, []);

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
                loadingDates={loadingDates}
                datesLoaded={datesLoaded}
              />
            </div>

            <div className="mt-3">
              <span className="block text-xs font-medium uppercase tracking-wider mb-1.5" style={{ color: 'var(--text-muted)' }}>Type</span>
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
              onClick={() => navigate(`/options/${etf.ticker}`)}
              priceData={prices[etf.ticker] ?? null}
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

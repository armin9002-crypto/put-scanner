import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearBatchPriceCache, fetchBatchPrices, fetchOptions, fetchSparkline, fetchWithConcurrencyLimit } from '../lib/api';
import type { SparklineData } from '../lib/api';
import { getExpirationsCache, setExpirationsCache } from '../lib/cache';
import type { BatchPriceData } from '../lib/cache';
import ETFCard from '../components/ETFCard';
import ExpirationFilter, { buildExpirationOptions, formatExpirationDropdownLabel } from '../components/ExpirationFilter';
import SparklineChart from '../components/SparklineChart';
import { Search, ShieldCheck, Loader2, RefreshCw } from 'lucide-react';

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

function vixColor(vix: number): string {
  if (vix < 15) return 'var(--green)';
  if (vix < 20) return 'var(--yellow)';
  if (vix < 30) return 'var(--orange)';
  return 'var(--red)';
}

function vixLabel(vix: number): { text: string; color: string } {
  if (vix < 15) return { text: 'Low', color: 'var(--green)' };
  if (vix < 20) return { text: 'Moderate', color: 'var(--yellow)' };
  if (vix < 30) return { text: 'Elevated', color: 'var(--orange)' };
  return { text: 'High', color: 'var(--red)' };
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
  const [vixData, setVixData] = useState<SparklineData | null>(null);
  const [marketLoading, setMarketLoading] = useState(true);
  const [lastMarketUpdate, setLastMarketUpdate] = useState<Date | null>(null);

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
        const validCount = Object.values(data).filter((v: any) => v?.price != null && v.price > 0).length;
        if (validCount < 10) {
          setPricesError('Partial data received — some prices unavailable');
        }
        setPrices(data);
      }
    } catch (err: any) {
      setPricesError(err.message || 'Price data unavailable');
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
      const [qqq, vix] = await Promise.allSettled([
        fetchSparkline('QQQ'),
        fetchSparkline('^VIX'),
      ]);
      if (qqq.status === 'fulfilled') setQqqData(qqq.value);
      if (vix.status === 'fulfilled') setVixData(vix.value);
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

  const qqqUp = qqqData ? qqqData.changePercent >= 0 : true;
  const qqqLineColor = qqqUp ? 'var(--green)' : 'var(--red)';
  const vixLineColor = vixData ? vixColor(vixData.price) : 'var(--yellow)';
  const vixStatus = vixData ? vixLabel(vixData.price) : { text: '', color: '' };

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <header className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ backgroundColor: 'var(--accent-bg)' }}>
              <ShieldCheck className="w-5 h-5" style={{ color: 'var(--accent)' }} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>Put Premium Scanner</h1>
              <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Leveraged ETF Options Screener</p>
            </div>
          </div>
        </header>

        <div className="relative mb-4">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            placeholder="Filter by ticker or underlying index..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-11 pr-4 py-3.5 sm:py-3 rounded-xl text-sm outline-none transition-all"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
          />
        </div>

        <div className="flex flex-col lg:flex-row lg:flex-wrap lg:items-start gap-4 mb-6">
          {/* Filters */}
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Leverage</span>
            <div className="flex gap-1.5">
              {LEVERAGE_OPTIONS.map(opt => (
                <button
                  key={opt}
                  onClick={() => setLeverageFilter(opt)}
                  className="px-3 py-1.5 sm:py-1 rounded-lg text-sm font-medium transition-all min-h-[44px] sm:min-h-0"
                  style={{
                    backgroundColor: leverageFilter === opt ? 'var(--accent)' : 'var(--surface)',
                    color: leverageFilter === opt ? 'white' : 'var(--text-muted)',
                    border: leverageFilter === opt ? 'none' : '1px solid var(--border)',
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>

            <span className="text-xs font-medium uppercase tracking-wider sm:ml-2" style={{ color: 'var(--text-muted)' }}>Type</span>
            <div className="flex gap-1.5">
              {TYPE_OPTIONS.map(opt => (
                <button
                  key={opt}
                  onClick={() => setTypeFilter(opt)}
                  className="px-3 py-1.5 sm:py-1 rounded-lg text-sm font-medium transition-all min-h-[44px] sm:min-h-0"
                  style={{
                    backgroundColor: typeFilter === opt ? 'var(--accent)' : 'var(--surface)',
                    color: typeFilter === opt ? 'white' : 'var(--text-muted)',
                    border: typeFilter === opt ? 'none' : '1px solid var(--border)',
                  }}
                >
                  {opt}
                </button>
              ))}
            </div>

            <ExpirationFilter
              value={expFilter}
              onChange={handleExpirationChange}
              options={expDropdownOptions}
              loadingDates={loadingDates}
              datesLoaded={datesLoaded}
            />
          </div>

          {/* Market Charts Widget - hidden on mobile, visible on lg+ */}
          <div className="hidden lg:flex items-start gap-4 lg:ml-auto">
            {/* QQQ Chart */}
            <div className="rounded-lg p-2" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>QQQ</span>
                <button onClick={loadMarketData} disabled={marketLoading} className="p-0.5 rounded transition-opacity hover:opacity-70 disabled:opacity-50">
                  <RefreshCw className={`w-3 h-3 ${marketLoading ? 'animate-spin' : ''}`} style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>
              {marketLoading && !qqqData ? (
                <div className="flex items-center justify-center" style={{ width: 160, height: 60 }}>
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-muted)' }} />
                </div>
              ) : qqqData && qqqData.sparkline.length >= 2 ? (
                <>
                  <SparklineChart data={qqqData.sparkline} color={qqqLineColor} width={160} height={60} />
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs font-mono font-semibold" style={{ color: 'var(--text)' }}>
                      ${qqqData.price.toFixed(2)}
                    </span>
                    <span className="text-[10px] font-mono" style={{ color: qqqUp ? 'var(--green)' : 'var(--red)' }}>
                      {qqqUp ? '+' : ''}{qqqData.changePercent.toFixed(2)}%
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center text-xs" style={{ width: 160, height: 60, color: 'var(--text-dim)' }}>Market data unavailable</div>
              )}
            </div>

            {/* VIX Chart */}
            <div className="rounded-lg p-2" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>VIX</span>
                <button onClick={loadMarketData} disabled={marketLoading} className="p-0.5 rounded transition-opacity hover:opacity-70 disabled:opacity-50">
                  <RefreshCw className={`w-3 h-3 ${marketLoading ? 'animate-spin' : ''}`} style={{ color: 'var(--text-muted)' }} />
                </button>
              </div>
              {marketLoading && !vixData ? (
                <div className="flex items-center justify-center" style={{ width: 160, height: 60 }}>
                  <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-muted)' }} />
                </div>
              ) : vixData && vixData.sparkline.length >= 2 ? (
                <>
                  <SparklineChart data={vixData.sparkline} color={vixLineColor} width={160} height={60} />
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-xs font-mono font-semibold" style={{ color: 'var(--text)' }}>
                      {vixData.price.toFixed(2)}
                    </span>
                    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ color: vixStatus.color, backgroundColor: `${vixStatus.color}15` }}>
                      {vixStatus.text}
                    </span>
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center text-xs" style={{ width: 160, height: 60, color: 'var(--text-dim)' }}>Market data unavailable</div>
              )}
            </div>
          </div>
        </div>

        {lastMarketUpdate && (
          <div className="text-[10px] mb-4" style={{ color: 'var(--text-dim)' }}>
            Market data updated: {lastMarketUpdate.toLocaleTimeString()}
          </div>
        )}

        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2">
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
    </div>
  );
}

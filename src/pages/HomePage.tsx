import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchBatchPrices, fetchSparkline } from '../lib/api';
import type { SparklineData } from '../lib/api';
import type { BatchPriceData } from '../lib/cache';
import ETFCard from '../components/ETFCard';
import SparklineChart from '../components/SparklineChart';
import { Search, ShieldCheck, Loader2, RefreshCw } from 'lucide-react';

const HARDCODED_TICKERS = 'AGQ,BNKU,BOIL,BULZ,CURE,CWEB,DDM,DFEN,DIG,DPST,ERX,FAS,FNGU,GDXU,GUSH,HIBL,INDL,LABU,MIDU,NAIL,NRGU,NUGT,OILU,PILL,QLD,RETL,ROM,RXL,SOXL,SSO,TECL,TNA,TPOR,TQQQ,UCO,UDOW,UGL,UPRO,UTSL,UWM,UYG,WANT,WEBL,YINN';

const LEVERAGE_OPTIONS = ['All', '2x', '3x'] as const;
const TYPE_OPTIONS = ['All', 'Broad Index', 'Sector', 'Commodity', 'Country'] as const;

// Import ETF_LIST for filtering only
import { ETF_LIST } from '../lib/etfs';

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
  const loadPrices = useCallback(async () => {
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
      return true;
    });
  }, [search, leverageFilter, typeFilter]);

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

        <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 sm:gap-3">
          {filtered.map(etf => (
            <ETFCard
              key={etf.ticker}
              etf={etf}
              onClick={() => navigate(`/options/${etf.ticker}`)}
              priceData={prices[etf.ticker] ?? null}
              priceError={!pricesLoading && !!pricesError && !prices[etf.ticker]}
              onRetry={loadPrices}
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

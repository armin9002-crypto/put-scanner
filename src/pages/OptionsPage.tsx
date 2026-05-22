import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { OptionsChainData, SortField, SortDirection } from '../lib/types';
import { ETF_LIST } from '../lib/etfs';
import { fetchOptions, fetchExtendedPrice, calculatePutDelta, formatPrice, formatYield, yieldColor, formatNumber, fetchIVRank } from '../lib/api';
import type { ExtendedPriceData, IVRankData } from '../lib/api';
import { addToWatchlist, removeFromWatchlist, isInWatchlist, makeWatchlistId } from '../lib/watchlist';
import type { WatchlistItem } from '../lib/watchlist';
import SparklineChart from '../components/SparklineChart';
import {
  ArrowLeft, RefreshCw, TrendingUp, TrendingDown, AlertCircle,
  ChevronUp, ChevronDown, Star
} from 'lucide-react';

interface EnrichedPut {
  strike: number;
  last: number | null;
  bid: number | null;
  ask: number | null;
  delta: number;
  impliedVolatility: number | null;
  volume: number | null;
  openInterest: number | null;
  volOI: number | null;
  nomYieldBid: number | null;
  annYieldBid: number | null;
  nomYieldAsk: number | null;
  annYieldAsk: number | null;
  nomYieldLast: number | null;
  annYieldLast: number | null;
  otmItmPct: number | null;
  otmItmLabel: string;
  otmItmColor: string;
}

function SkeletonRow({ colCount }: { colCount: number }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      {Array.from({ length: colCount }).map((_, i) => (
        <td key={i} className="px-2 py-1.5">
          <div className="h-3.5 w-16 rounded animate-pulse" style={{ backgroundColor: 'var(--border)' }} />
        </td>
      ))}
    </tr>
  );
}

function PerfCell({ label, value }: { label: string; value: number | null }) {
  if (value == null) {
    return (
      <div className="text-center">
        <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>{label}</div>
        <div className="text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>—</div>
      </div>
    );
  }
  const isPositive = value >= 0;
  const display = isPositive ? `+${value.toFixed(1)}%` : `${value.toFixed(1)}%`;
  return (
    <div className="text-center">
      <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>{label}</div>
      <div className="text-[10px] font-mono" style={{ color: isPositive ? 'var(--green)' : 'var(--red)' }}>{display}</div>
    </div>
  );
}

function FiftyTwoWeekCell({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <div className="text-center">
        <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>52W Hi</div>
        <div className="text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>—</div>
      </div>
    );
  }
  if (value >= -1) {
    return (
      <div className="text-center">
        <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>52W Hi</div>
        <div className="text-[10px] font-mono" style={{ color: 'var(--green)' }}>Near High</div>
      </div>
    );
  }
  return (
    <div className="text-center">
      <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>52W Hi</div>
      <div className="text-[10px] font-mono" style={{ color: 'var(--red)' }}>{value.toFixed(1)}%</div>
    </div>
  );
}

function PerfSkeleton() {
  return (
    <div className="grid grid-cols-4 gap-2">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="text-center">
          <div className="h-2.5 w-6 rounded animate-pulse mx-auto mb-1" style={{ backgroundColor: 'var(--border)' }} />
          <div className="h-3 w-10 rounded animate-pulse mx-auto" style={{ backgroundColor: 'var(--border)' }} />
        </div>
      ))}
    </div>
  );
}

function deltaColor(delta: number): string {
  const abs = Math.abs(delta);
  if (abs >= 0.7) return 'var(--red)';
  if (abs >= 0.4) return 'var(--orange)';
  if (abs >= 0.2) return 'var(--yellow)';
  return 'var(--text-muted)';
}

function ivColor(iv: number | null): string {
  if (iv == null) return 'var(--text-dim)';
  if (iv < 50) return 'var(--green)';
  if (iv < 100) return 'var(--yellow)';
  if (iv < 150) return 'var(--orange)';
  return 'var(--red)';
}

function ivRankColor(rank: number): string {
  if (rank >= 70) return 'var(--red)';
  if (rank >= 50) return 'var(--orange)';
  if (rank >= 30) return 'var(--yellow)';
  return 'var(--green)';
}

const EXPIRY_ROW_TOP = 44;
const TABLE_HEADER_TOP = 92;

export default function OptionsPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const navigate = useNavigate();
  const etf = ETF_LIST.find(e => e.ticker === ticker);

  const [optionsData, setOptionsData] = useState<OptionsChainData | null>(null);
  const [extendedPrice, setExtendedPrice] = useState<ExtendedPriceData | null>(null);
  const [selectedExp, setSelectedExp] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortField, setSortField] = useState<SortField>('strike');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [showVolOI, setShowVolOI] = useState(false);
  const [ivRankData, setIvRankData] = useState<IVRankData | null>(null);
  const [watchlistIds, setWatchlistIds] = useState<Set<string>>(new Set());

  // Ref guard to prevent duplicate fetches
  const fetchKeyRef = useRef<string>('');

  const loadData = useCallback(async (expDate?: number) => {
    if (!ticker) return;
    const key = `${ticker}:${expDate ?? 'default'}`;
    if (fetchKeyRef.current === key && optionsData) return;
    fetchKeyRef.current = key;

    setLoading(true);
    setError(null);
    try {
      const [opts, ext] = await Promise.all([
        fetchOptions(ticker, expDate),
        fetchExtendedPrice(ticker),
      ]);
      setOptionsData(opts);
      setExtendedPrice(ext);
      // Lazy-load IV Rank (non-blocking)
      fetchIVRank(ticker).then(setIvRankData).catch(() => {});
      if (!expDate && opts.expirations.length > 0) {
        setSelectedExp(opts.expirations[0].date);
      }
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message || 'Failed to load options data');
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  const loadExpiration = useCallback(async (expDate: number) => {
    if (!ticker) return;
    const key = `${ticker}:${expDate}`;
    if (fetchKeyRef.current === key) return;
    fetchKeyRef.current = key;

    setSelectedExp(expDate);
    setLoading(true);
    setError(null);
    try {
      // Only fetch options — preserve existing price state (Opt 5)
      const opts = await fetchOptions(ticker, expDate);
      setOptionsData(opts);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message || 'Failed to load expiration data');
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    fetchKeyRef.current = '';
    loadData();
  }, [ticker]);

  // Refresh watchlist state when selectedExp changes
  useEffect(() => {
    if (!ticker || !selectedExp) return;
    const ids = new Set<string>();
    const exp = optionsData?.expirations.find(e => e.date === selectedExp);
    if (exp) {
      const d = new Date(exp.date * 1000);
      const expiry = d.toISOString().split('T')[0];
      optionsData?.puts.forEach(p => {
        const id = makeWatchlistId(ticker, expiry, p.strike);
        if (isInWatchlist(id)) ids.add(id);
      });
    }
    setWatchlistIds(ids);
  }, [ticker, selectedExp, optionsData]);

  const toggleWatchlist = useCallback((put: { strike: number }) => {
    if (!ticker || !selectedExp) return;
    const exp = optionsData?.expirations.find(e => e.date === selectedExp);
    if (!exp) return;
    const d = new Date(exp.date * 1000);
    const expiry = d.toISOString().split('T')[0];
    const id = makeWatchlistId(ticker, expiry, put.strike);

    if (isInWatchlist(id)) {
      removeFromWatchlist(id);
      setWatchlistIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    } else {
      const item: WatchlistItem = {
        id,
        ticker,
        expiry,
        expiryFormatted: exp.label,
        strike: put.strike,
        addedAt: Date.now(),
        note: '',
      };
      addToWatchlist(item);
      setWatchlistIds(prev => new Set(prev).add(id));
    }
  }, [ticker, selectedExp, optionsData]);

  // Extract price from options response (Opt 5) — prefer extended price, fall back to options data
  const currentPrice = extendedPrice?.price ?? optionsData?.currentPrice ?? 0;
  const changePositive = extendedPrice ? extendedPrice.changePercent >= 0 : true;

  const enrichedPuts = useMemo((): EnrichedPut[] => {
    if (!optionsData?.puts) return [];
    const exp = optionsData.expirations.find(e => e.date === selectedExp);
    const dte = exp?.dte ?? 1;

    return optionsData.puts.map(p => {
      let delta: number;
      if (p.delta != null && p.delta !== 0) {
        delta = p.delta;
      } else {
        const sigma = p.impliedVolatility != null && p.impliedVolatility > 0
          ? p.impliedVolatility / 100
          : 0.80;
        delta = calculatePutDelta(currentPrice, p.strike, dte / 365, 0.045, sigma);
      }
      if (delta > 0) delta = -delta;
      if (delta > -0.01 && delta <= 0) delta = -0.01;

      const nomYieldBid = p.bid != null && p.bid !== 0 && p.strike > 0
        ? (p.bid / p.strike) * 100 : null;
      const annYieldBid = nomYieldBid != null ? nomYieldBid * (365 / dte) : null;
      const nomYieldAsk = p.ask != null && p.ask !== 0 && p.strike > 0
        ? (p.ask / p.strike) * 100 : null;
      const annYieldAsk = nomYieldAsk != null ? nomYieldAsk * (365 / dte) : null;
      const nomYieldLast = p.last != null && p.last !== 0 && p.strike > 0
        ? (p.last / p.strike) * 100 : null;
      const annYieldLast = nomYieldLast != null ? nomYieldLast * (365 / dte) : null;

      const volOI = (p.volume != null && p.volume > 0 && p.openInterest != null && p.openInterest > 0)
        ? p.volume / p.openInterest : null;

      let otmItmPct: number | null = null;
      let otmItmLabel = '';
      let otmItmColor = '';
      if (currentPrice > 0) {
        const ratio = Math.abs(p.strike - currentPrice) / currentPrice;
        if (ratio < 0.005) {
          otmItmLabel = 'ATM';
          otmItmColor = 'var(--yellow)';
        } else if (p.strike < currentPrice) {
          otmItmPct = ((currentPrice - p.strike) / currentPrice) * 100;
          otmItmLabel = otmItmPct.toFixed(1) + '% OTM';
          otmItmColor = 'var(--green)';
        } else {
          otmItmPct = ((p.strike - currentPrice) / currentPrice) * 100;
          otmItmLabel = otmItmPct.toFixed(1) + '% ITM';
          otmItmColor = 'var(--red)';
        }
      }

      return {
        strike: p.strike, last: p.last, bid: p.bid, ask: p.ask, delta,
        impliedVolatility: p.impliedVolatility, volume: p.volume, openInterest: p.openInterest, volOI,
        nomYieldBid, annYieldBid, nomYieldAsk, annYieldAsk, nomYieldLast, annYieldLast,
        otmItmPct, otmItmLabel, otmItmColor,
      };
    });
  }, [optionsData, selectedExp, currentPrice]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronUp className="w-3 h-3 opacity-40" style={{ color: 'var(--text-muted)' }} />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3" style={{ color: 'var(--accent)' }} />
      : <ChevronDown className="w-3 h-3" style={{ color: 'var(--accent)' }} />;
  }

  function getMoneyness(strike: number): 'itm' | 'otm' | 'atm' {
    if (currentPrice <= 0) return 'otm';
    const ratio = Math.abs(strike - currentPrice) / currentPrice;
    if (ratio < 0.005) return 'atm';
    return strike > currentPrice ? 'itm' : 'otm';
  }

  function rowBg(strike: number): string {
    const m = getMoneyness(strike);
    if (m === 'itm') return 'rgba(239,68,68,0.04)';
    if (m === 'atm') return 'rgba(234,179,8,0.06)';
    return 'rgba(34,197,94,0.03)';
  }

  // Column definitions
  const baseColumns: { field: SortField; label: string; fullLabel: string; align: string; widthClass: string; hideOnMobile?: boolean; hideOnTablet?: boolean }[] = [
    { field: 'strike', label: 'Strike', fullLabel: 'Strike', align: 'text-left', widthClass: 'w-24' },
    { field: 'last', label: 'Last', fullLabel: 'Last', align: 'text-right', widthClass: 'w-14', hideOnMobile: true },
    { field: 'bid', label: 'Bid', fullLabel: 'Bid', align: 'text-right', widthClass: 'w-14' },
    { field: 'ask', label: 'Ask', fullLabel: 'Ask', align: 'text-right', widthClass: 'w-14' },
    { field: 'delta', label: 'Delta', fullLabel: 'Delta', align: 'text-right', widthClass: 'w-14' },
    { field: 'otmItm', label: 'Moneyness', fullLabel: '% OTM / % ITM', align: 'text-right', widthClass: 'w-24', hideOnMobile: true },
    { field: 'iv', label: 'IV', fullLabel: 'IV', align: 'text-right', widthClass: 'w-14', hideOnMobile: true },
    { field: 'nomYieldBid', label: 'NY Bid', fullLabel: 'Nom. Yield (Bid)', align: 'text-right', widthClass: 'w-20', hideOnMobile: true, hideOnTablet: true },
    { field: 'annYieldBid', label: 'AY Bid', fullLabel: 'Ann. Yield (Bid)', align: 'text-right', widthClass: 'w-20' },
    { field: 'nomYieldAsk', label: 'NY Ask', fullLabel: 'Nom. Yield (Ask)', align: 'text-right', widthClass: 'w-20', hideOnMobile: true, hideOnTablet: true },
    { field: 'annYieldAsk', label: 'AY Ask', fullLabel: 'Ann. Yield (Ask)', align: 'text-right', widthClass: 'w-20', hideOnMobile: true },
    { field: 'nomYieldLast', label: 'NY Last', fullLabel: 'Nom. Yield (Last)', align: 'text-right', widthClass: 'w-20', hideOnMobile: true, hideOnTablet: true },
    { field: 'annYieldLast', label: 'AY Last', fullLabel: 'Ann. Yield (Last)', align: 'text-right', widthClass: 'w-20', hideOnMobile: true, hideOnTablet: true },
  ];

  const volOIColumns: { field: SortField; label: string; fullLabel: string; align: string; widthClass: string; hideOnMobile?: boolean; hideOnTablet?: boolean }[] = [
    { field: 'volume', label: 'Volume', fullLabel: 'Volume', align: 'text-right', widthClass: 'w-16', hideOnMobile: true },
    { field: 'openInterest', label: 'OI', fullLabel: 'Open Interest', align: 'text-right', widthClass: 'w-16', hideOnMobile: true },
    { field: 'volOI', label: 'Vol/OI', fullLabel: 'Volume / Open Interest', align: 'text-right', widthClass: 'w-14', hideOnMobile: true },
  ];

  const columns = showVolOI ? [...baseColumns, ...volOIColumns] : baseColumns;
  const colCount = columns.length;

  // Sparkline data
  const sparklineData = extendedPrice?.sparkline ?? [];
  const sparklineColor = changePositive ? 'var(--green)' : 'var(--red)';

  if (!etf) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="text-center">
          <p className="mb-4" style={{ color: 'var(--text-muted)' }}>ETF not found: {ticker}</p>
          <button onClick={() => navigate('/')} className="px-4 py-2 text-white rounded-lg text-sm" style={{ backgroundColor: 'var(--accent)' }}>Back to Scanner</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-6">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-lg transition-all min-h-[44px] min-w-[44px] flex items-center justify-center"
            style={{ color: 'var(--text-muted)' }}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 sm:gap-3">
              <h1 className="text-xl sm:text-2xl font-bold font-mono" style={{ color: 'var(--text)' }}>{etf.ticker}</h1>
              <span className="text-xs sm:text-sm truncate" style={{ color: 'var(--text-muted)' }}>{etf.name}</span>
            </div>
          </div>
        </div>

        {/* Price bar */}
        <div
          data-layout="price-header"
          className="rounded-xl p-3 sm:p-5 mb-4 sm:mb-6 bg-[#12121a]"
          style={{
            overflow: 'visible',
            height: 'auto',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 sm:gap-6">
            {/* Price + change */}
            <div className="flex-shrink-0">
              <span className="text-2xl sm:text-3xl font-bold font-mono" style={{ color: 'var(--text)' }}>
                ${currentPrice > 0 ? currentPrice.toFixed(2) : '—'}
              </span>
              {extendedPrice && (
                <div className="flex items-center gap-1.5 text-sm font-mono mt-1" style={{ color: changePositive ? 'var(--green)' : 'var(--red)' }}>
                  {changePositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  <span>{changePositive ? '+$' : '-$'}{Math.abs(extendedPrice.change).toFixed(2)}</span>
                  <span>({changePositive ? '+' : '-'}{Math.abs(extendedPrice.changePercent).toFixed(2)}%)</span>
                </div>
              )}
            </div>

            {/* Sparkline chart - hidden on mobile */}
            <div className="hidden sm:block flex-shrink-0">
              {loading && !extendedPrice ? (
                <div className="flex items-center justify-center" style={{ width: 220, height: 55 }}>
                  <div className="h-3.5 w-20 rounded animate-pulse" style={{ backgroundColor: 'var(--border)' }} />
                </div>
              ) : sparklineData.length >= 2 ? (
                <SparklineChart data={sparklineData} color={sparklineColor} width={220} height={55} fillGradient />
              ) : (
                <div className="flex items-center justify-center text-xs" style={{ width: 220, height: 55, color: 'var(--text-dim)' }}>No intraday data</div>
              )}
            </div>

            {/* Performance metrics - hidden on mobile */}
            <div className="hidden sm:block flex-shrink-0 min-w-[140px]">
              {loading && !extendedPrice ? (
                <PerfSkeleton />
              ) : extendedPrice ? (
                <div className="grid grid-cols-4 gap-2">
                  <PerfCell label="5D" value={extendedPrice.fiveDay} />
                  <PerfCell label="1M" value={extendedPrice.oneMonth} />
                  <PerfCell label="3M" value={extendedPrice.threeMonth} />
                  <FiftyTwoWeekCell value={extendedPrice.fiftyTwoWeekHighPct} />
                </div>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  <PerfCell label="5D" value={null} />
                  <PerfCell label="1M" value={null} />
                  <PerfCell label="3M" value={null} />
                  <FiftyTwoWeekCell value={null} />
                </div>
              )}
            </div>

            {/* IV Rank Badge */}
            {ivRankData && ivRankData.ivRank != null && (
              <div className="flex-shrink-0">
                <div
                  className="px-3 py-1.5 rounded-lg text-center"
                  style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}
                  title={`IV Rank: ${ivRankData.ivRank.toFixed(1)}% | IV Percentile: ${ivRankData.ivPercentile?.toFixed(1) ?? '—'}% | Current IV: ${ivRankData.currentIV?.toFixed(1) ?? '—'}%`}
                >
                  <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>IV Rank</div>
                  <div className="text-sm font-mono font-bold" style={{ color: ivRankColor(ivRankData.ivRank) }}>
                    {ivRankData.ivRank.toFixed(0)}%
                  </div>
                </div>
              </div>
            )}

            {/* Right side: last updated + refresh + vol/OI toggle */}
            <div className="flex items-center gap-2 sm:gap-3 text-xs sm:ml-auto" style={{ color: 'var(--text-muted)' }}>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer min-h-[44px] sm:min-h-0" style={{ color: 'var(--text-muted)' }}>
                <input
                  type="checkbox"
                  checked={showVolOI}
                  onChange={e => setShowVolOI(e.target.checked)}
                  className="rounded"
                />
                Show Volume / OI
              </label>
              {lastUpdated && (
                <span className="hidden sm:inline">Last updated: {lastUpdated.toLocaleTimeString()}</span>
              )}
              <button
                onClick={() => {
                  fetchKeyRef.current = '';
                  if (selectedExp) loadExpiration(selectedExp);
                  else loadData();
                }}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2.5 sm:py-2 rounded-lg disabled:opacity-50 transition-all min-h-[44px] sm:min-h-0"
                style={{ backgroundColor: 'var(--border)', color: 'var(--text)' }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span className="sm:inline">Refresh</span>
              </button>
            </div>
          </div>
        </div>

        {/* Expiration selector */}
        {optionsData && optionsData.expirations.length > 0 && (
          <div
            data-layout="expiry-row"
            className="sticky-stack flex gap-2 mb-4 sm:mb-6 overflow-x-auto pb-2 pt-2 -mx-4 px-4 sm:mx-0 sm:px-0 sm:flex-wrap bg-[#0a0a0f]"
            style={{
              top: EXPIRY_ROW_TOP,
              zIndex: 30,
              backgroundColor: 'var(--bg)',
              boxShadow: '0 1px 0 var(--border)',
            }}
          >
            {optionsData.expirations.map(exp => (
              <button
                key={exp.date}
                onClick={() => loadExpiration(exp.date)}
                className="px-3 py-2 sm:py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap flex-shrink-0 min-h-[44px] sm:min-h-0"
                style={{
                  backgroundColor: selectedExp === exp.date ? 'var(--accent)' : 'var(--surface)',
                  color: selectedExp === exp.date ? 'white' : 'var(--text-muted)',
                  border: selectedExp === exp.date ? 'none' : '1px solid var(--border)',
                  boxShadow: selectedExp === exp.date ? '0 0 12px var(--accent-border)' : 'none',
                }}
              >
                {exp.label} ({exp.dte} DTE)
              </button>
            ))}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="rounded-xl p-6 mb-6 flex items-center gap-3" style={{ backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <AlertCircle className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--red)' }} />
            <p className="text-sm" style={{ color: 'var(--red)' }}>{error}</p>
          </div>
        )}

        {/* Options table */}
        <div className="rounded-xl" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="overflow-x-auto xl:overflow-x-visible">
            <table className="w-full table-fixed text-xs">
              <thead>
                <tr style={{ backgroundColor: 'var(--surface-alt)', borderBottom: '1px solid var(--border)' }}>
                  <th
                    className="sticky-stack px-2 py-1.5 w-6 text-[11px]"
                    style={{
                      top: TABLE_HEADER_TOP,
                      zIndex: 20,
                      color: 'var(--text-muted)',
                      backgroundColor: 'var(--surface-alt)',
                    }}
                  ></th>
                  {columns.map(col => (
                    <th
                      key={col.field}
                      onClick={() => handleSort(col.field)}
                      title={col.fullLabel}
                      className={`sticky-stack px-2 py-1.5 text-[11px] uppercase tracking-wider font-medium cursor-pointer transition-colors select-none whitespace-nowrap ${col.align} ${col.widthClass} ${
                        col.field === 'strike' ? 'left-0 border-r' : ''
                      } ${col.hideOnMobile ? 'hidden md:table-cell' : ''} ${col.hideOnTablet ? 'hidden lg:table-cell' : ''}`}
                      style={{
                        top: TABLE_HEADER_TOP,
                        zIndex: col.field === 'strike' ? 22 : 20,
                        color: 'var(--text-muted)',
                        backgroundColor: 'var(--surface-alt)',
                        borderColor: 'var(--border)',
                      }}
                    >
                      <span className="inline-flex items-center gap-1">
                        {col.label}
                        <SortIcon field={col.field} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} colCount={colCount + 1} />)
                ) : (
                  (() => {
                    const byStrike = [...enrichedPuts].sort((a, b) => a.strike - b.strike);
                    const rows: JSX.Element[] = [];
                    let dividerInserted = false;

                    byStrike.forEach((put, idx) => {
                      if (!dividerInserted && put.strike >= currentPrice && idx > 0) {
                        rows.push(
                          <tr key="divider">
                            <td colSpan={colCount + 1} className="px-0 py-0">
                              <div className="relative py-1 px-4" style={{ backgroundColor: 'var(--accent-bg)', borderTop: '1px solid var(--accent-border)', borderBottom: '1px solid var(--accent-border)' }}>
                                <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>
                                  Current Price: ${currentPrice.toFixed(2)}
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                        dividerInserted = true;
                      }

                      const moneyness = getMoneyness(put.strike);
                      const rowIdx = rows.length;
                      const bg = rowBg(put.strike);
                      const altBg = rowIdx % 2 !== 0 ? 'var(--row-alt)' : 'transparent';
                      const expForId = optionsData?.expirations.find(e => e.date === selectedExp);
                      const expiryIso = expForId ? new Date(expForId.date * 1000).toISOString().split('T')[0] : '';
                      const wlId = makeWatchlistId(ticker ?? '', expiryIso, put.strike);
                      const isWatched = watchlistIds.has(wlId);

                      rows.push(
                        <tr
                          key={put.strike}
                          className="transition-colors"
                          style={{ borderBottom: '1px solid var(--border)', backgroundColor: altBg }}
                        >
                          <td className="px-2 py-1.5 text-center text-xs w-6">
                            <button
                              onClick={() => toggleWatchlist(put)}
                              className="transition-opacity hover:opacity-70 min-h-[44px] flex items-center justify-center"
                              title={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
                            >
                              <Star
                                className={`w-3.5 h-3.5 ${isWatched ? 'fill-current' : ''}`}
                                style={{ color: isWatched ? 'var(--accent-light)' : 'var(--text-dim)' }}
                              />
                            </button>
                          </td>
                          <td className="px-2 py-1.5 text-left text-xs whitespace-nowrap sticky left-0 z-[2] border-r w-24" style={{ borderColor: 'var(--border)', backgroundColor: bg }}>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-semibold tabular-nums" style={{ color: 'var(--text)' }}>{formatPrice(put.strike)}</span>
                              {moneyness === 'itm' && (
                                <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.2)' }}>ITM</span>
                              )}
                              {moneyness === 'otm' && (
                                <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: 'var(--green)', border: '1px solid rgba(34,197,94,0.2)' }}>OTM</span>
                              )}
                              {moneyness === 'atm' && (
                                <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: 'rgba(234,179,8,0.15)', color: 'var(--yellow)', border: '1px solid rgba(234,179,8,0.2)' }}>ATM</span>
                              )}
                            </div>
                          </td>
                          <td className="px-2 py-1.5 text-right text-xs font-mono tabular-nums hidden md:table-cell w-14" style={{ color: 'var(--text)' }}>{formatPrice(put.last)}</td>
                          <td className="px-2 py-1.5 text-right text-xs font-mono tabular-nums w-14" style={{ color: 'var(--text)' }}>{formatPrice(put.bid)}</td>
                          <td className="px-2 py-1.5 text-right text-xs font-mono tabular-nums w-14" style={{ color: 'var(--text)' }}>{formatPrice(put.ask)}</td>
                          <td className="px-2 py-1.5 text-right text-xs font-mono tabular-nums w-14" style={{ color: deltaColor(put.delta) }}>
                            {put.delta.toFixed(2)}
                          </td>
                          <td className="px-2 py-1.5 text-right text-xs font-mono tabular-nums hidden md:table-cell w-24" style={{ color: put.otmItmColor }}>
                            {put.otmItmLabel || '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right text-xs font-mono tabular-nums hidden md:table-cell w-14" style={{ color: ivColor(put.impliedVolatility) }}>
                            {put.impliedVolatility != null ? put.impliedVolatility.toFixed(1) + '%' : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right text-xs font-mono tabular-nums hidden lg:table-cell w-20" style={{ color: 'var(--text-secondary)' }}>
                            {put.nomYieldBid != null ? formatYield(put.nomYieldBid) : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right text-xs font-mono tabular-nums font-medium w-20" style={{ color: put.annYieldBid != null ? yieldColor(put.annYieldBid) : 'var(--text-dim)' }}>
                            {put.annYieldBid != null ? formatYield(put.annYieldBid) : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right text-xs font-mono tabular-nums hidden lg:table-cell w-20" style={{ color: 'var(--text-secondary)' }}>
                            {put.nomYieldAsk != null ? formatYield(put.nomYieldAsk) : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right text-xs font-mono tabular-nums font-medium hidden md:table-cell w-20" style={{ color: put.annYieldAsk != null ? yieldColor(put.annYieldAsk) : 'var(--text-dim)' }}>
                            {put.annYieldAsk != null ? formatYield(put.annYieldAsk) : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right text-xs font-mono tabular-nums hidden lg:table-cell w-20" style={{ color: 'var(--text-secondary)' }}>
                            {put.nomYieldLast != null ? formatYield(put.nomYieldLast) : '—'}
                          </td>
                          <td className="px-2 py-1.5 text-right text-xs font-mono tabular-nums font-medium hidden lg:table-cell w-20" style={{ color: put.annYieldLast != null ? yieldColor(put.annYieldLast) : 'var(--text-dim)' }}>
                            {put.annYieldLast != null ? formatYield(put.annYieldLast) : '—'}
                          </td>
                          {showVolOI && (
                            <>
                              <td className="px-2 py-1.5 text-right text-xs font-mono tabular-nums hidden md:table-cell w-16" style={{ color: 'var(--text-secondary)' }}>
                                {formatNumber(put.volume)}
                              </td>
                              <td className="px-2 py-1.5 text-right text-xs font-mono tabular-nums hidden md:table-cell w-16" style={{ color: 'var(--text-secondary)' }}>
                                {formatNumber(put.openInterest)}
                              </td>
                              <td className="px-2 py-1.5 text-right text-xs font-mono tabular-nums hidden md:table-cell w-14" style={{ color: 'var(--text-secondary)' }}>
                                {put.volOI != null ? put.volOI.toFixed(2) : '--'}
                              </td>
                            </>
                          )}
                        </tr>
                      );
                    });

                    return rows;
                  })()
                )}
              </tbody>
            </table>
          </div>
          {!loading && enrichedPuts.length === 0 && !error && (
            <div className="py-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No put options data available for this expiration.</div>
          )}
        </div>

        <footer className="mt-8 pb-6 text-center">
          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Data delayed up to 15 minutes. Not financial advice.</p>
        </footer>
      </div>
    </div>
  );
}

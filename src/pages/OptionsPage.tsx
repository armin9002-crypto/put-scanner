import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import type { ExpirationDate, OptionsChainData, SortField, SortDirection } from '../lib/types';
import { ETF_LIST } from '../lib/etfs';
import { fetchOptions, fetchExtendedPrice, calculatePutDelta, formatPrice, formatYield, yieldColor, formatNumber, fetchIVRank } from '../lib/api';
import type { ExtendedPriceData, IVRankData } from '../lib/api';
import { addToWatchlist, removeFromWatchlist, isInWatchlist, makeWatchlistId } from '../lib/watchlist';
import type { WatchlistItem } from '../lib/watchlist';
import { addPortfolioTrade } from '../lib/portfolioStorage';
import { calculateMoneyness, calculateYieldPercent } from '../lib/optionMetrics';
import SparklineChart from '../components/SparklineChart';
import ErrorBoundary from '../components/ErrorBoundary';
import {
  ArrowLeft, RefreshCw, TrendingUp, TrendingDown, AlertCircle,
  ChevronUp, ChevronDown, ChevronsUpDown, Star, BarChart3
} from 'lucide-react';

const OptionDetailDrawer = lazy(() => import('../components/OptionDetailDrawer'));
const InteractivePriceChartModal = lazy(() => import('../components/InteractivePriceChartModal'));

interface EnrichedPut {
  strike: number;
  last: number | null;
  lastTradeDate: number | null;
  bid: number | null;
  ask: number | null;
  delta: number;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
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

function OptionsEmptyState({
  type,
  onRefresh,
  loading,
}: {
  type: 'empty' | 'error';
  onRefresh: () => void;
  loading: boolean;
}) {
  const Icon = type === 'empty' ? BarChart3 : AlertCircle;
  const title = type === 'empty' ? 'No options data available' : 'Failed to load options data';
  const subtitle = type === 'empty'
    ? 'This ETF may have illiquid options or Yahoo Finance returned no data. Try refreshing or check back during market hours.'
    : 'Failed to load options data — click Refresh to try again.';

  return (
    <div
      className="rounded-xl py-16 px-6 text-center"
      style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <Icon className="w-10 h-10 mx-auto mb-4" style={{ color: 'var(--text-dim)' }} />
      <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text)' }}>{title}</h2>
      <p className="text-sm max-w-md mx-auto mb-6" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>
      <button
        onClick={onRefresh}
        disabled={loading}
        className="inline-flex items-center gap-2 px-4 py-2.5 sm:py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-all min-h-[44px] sm:min-h-0"
        style={{ backgroundColor: 'var(--accent)' }}
      >
        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        Refresh
      </button>
    </div>
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

function MobileStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>{label}</div>
      <div className="text-xs font-mono font-semibold tabular-nums truncate" style={{ color: color ?? 'var(--text)' }}>{value}</div>
    </div>
  );
}

function MobileOptionCard({
  put,
  moneyness,
  watched,
  showVolOI,
  onToggleWatchlist,
  onSelect,
}: {
  put: EnrichedPut;
  moneyness: 'itm' | 'otm' | 'atm';
  watched: boolean;
  showVolOI: boolean;
  onToggleWatchlist: () => void;
  onSelect: () => void;
}) {
  const statusColor = moneyness === 'itm'
    ? 'var(--green)'
    : moneyness === 'atm'
      ? 'var(--yellow)'
      : 'var(--red)';
  const statusBg = moneyness === 'itm'
    ? 'rgba(34,197,94,0.14)'
    : moneyness === 'atm'
      ? 'rgba(234,179,8,0.14)'
      : 'rgba(239,68,68,0.14)';
  const statusBorder = moneyness === 'itm'
    ? 'rgba(34,197,94,0.26)'
    : moneyness === 'atm'
      ? 'rgba(234,179,8,0.26)'
      : 'rgba(239,68,68,0.26)';
  const statusLabel = moneyness.toUpperCase();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
      className="mobile-option-card w-full rounded-xl p-3 text-left transition-all active:scale-[0.99]"
      style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <div className="flex items-start justify-between gap-2 min-w-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-base font-mono font-bold tabular-nums" style={{ color: 'var(--text)' }}>
              ${formatPrice(put.strike)} Put
            </span>
            <span
              className="rounded px-1.5 py-0.5 text-[10px] font-bold"
              style={{ backgroundColor: statusBg, color: statusColor, border: `1px solid ${statusBorder}` }}
            >
              {statusLabel}
            </span>
          </div>
          {put.otmItmLabel && (
            <div className="mt-0.5 text-xs font-mono tabular-nums" style={{ color: put.otmItmColor }}>
              {put.otmItmLabel}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={event => {
            event.stopPropagation();
            onToggleWatchlist();
          }}
          aria-label={watched ? 'Remove from watchlist' : 'Add to watchlist'}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg"
          style={{ color: watched ? 'var(--accent-light)' : 'var(--text-dim)' }}
        >
          <Star className={`h-4 w-4 ${watched ? 'fill-current' : ''}`} />
        </button>
      </div>

      <div className="mobile-option-card-grid mt-3 grid grid-cols-3 gap-2">
        <MobileStat label="Bid" value={formatPrice(put.bid)} color="var(--green)" />
        <MobileStat label="Ask" value={formatPrice(put.ask)} />
        <MobileStat label="AY Bid" value={put.annYieldBid != null ? formatYield(put.annYieldBid) : '—'} color={put.annYieldBid != null ? yieldColor(put.annYieldBid) : 'var(--text-dim)'} />
      </div>
      <div className="mobile-secondary-grid mt-2 grid grid-cols-3 gap-2">
        <MobileStat label="Delta" value={put.delta.toFixed(2)} color={deltaColor(put.delta)} />
        <MobileStat label="IV" value={put.impliedVolatility != null ? `${put.impliedVolatility.toFixed(1)}%` : '—'} color={ivColor(put.impliedVolatility)} />
        <MobileStat label="Last" value={formatPrice(put.last)} />
      </div>
      {showVolOI && (
        <div className="mobile-secondary-grid mt-2 grid grid-cols-3 gap-2 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
          <MobileStat label="Volume" value={formatNumber(put.volume)} />
          <MobileStat label="OI" value={formatNumber(put.openInterest)} />
          <MobileStat label="Vol/OI" value={put.volOI != null ? put.volOI.toFixed(2) : '—'} />
        </div>
      )}
    </div>
  );
}

const PRICE_HEADER_TOP = 56;
const EXPIRY_ROW_TOP = 144;

function parseExpiryParam(expiryParam: string | null): number | null {
  if (!expiryParam) return null;
  const numeric = Number(expiryParam);
  if (Number.isFinite(numeric)) return numeric;
  const isoMatch = expiryParam.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!isoMatch) return null;
  const [, year, month, day] = isoMatch;
  return Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day)) / 1000);
}

function resolvePreferredExpiration(
  expirations: ExpirationDate[],
  expiryParam: string | null
): { date: number | null; fromScanner: boolean } {
  if (expirations.length === 0) return { date: null, fromScanner: false };
  if (expiryParam === 'lte30' || expiryParam === 'lte_30dte') {
    const shortDated = expirations.find(exp => exp.dte <= 30);
    return {
      date: shortDated?.date ?? expirations[0].date,
      fromScanner: !!shortDated,
    };
  }
  const requestedDate = parseExpiryParam(expiryParam);
  if (requestedDate != null && expirations.some(exp => exp.date === requestedDate)) {
    return {
      date: requestedDate,
      fromScanner: requestedDate !== expirations[0].date,
    };
  }
  return { date: expirations[0].date, fromScanner: false };
}

export default function OptionsPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const expiryParam = searchParams.get('expiry');
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
  const [showScannerPreselectBadge, setShowScannerPreselectBadge] = useState(false);
  const [selectedOption, setSelectedOption] = useState<EnrichedPut | null>(null);
  const [showPriceChart, setShowPriceChart] = useState(false);

  const inFlightFetchKeyRef = useRef<string>('');

  const loadData = useCallback(async (expDate?: number, bypassCache = false, fresh = false) => {
    if (!ticker) return;
    const key = `${ticker}:${expDate ?? 'default'}:${fresh ? 'fresh' : bypassCache ? 'bypass' : 'cached'}`;
    if (inFlightFetchKeyRef.current === key) return;
    inFlightFetchKeyRef.current = key;

    setLoading(true);
    setError(null);
    try {
      const [initialOpts, ext] = await Promise.all([
        fetchOptions(ticker, expDate, { bypassCache, fresh, source: fresh ? 'OptionsPage:refresh' : 'OptionsPage:load' }),
        fetchExtendedPrice(ticker, { includeSparkline: true }),
      ]);
      const preferredExp = expDate
        ? { date: expDate, fromScanner: false }
        : resolvePreferredExpiration(initialOpts.expirations, expiryParam);
      const opts = !expDate && preferredExp.date && preferredExp.date !== initialOpts.expirations[0]?.date
        ? await fetchOptions(ticker, preferredExp.date, { bypassCache, fresh, source: fresh ? 'OptionsPage:refresh:selected' : 'OptionsPage:load:selected' })
        : initialOpts;
      setOptionsData(opts);
      setExtendedPrice(ext);
      // Lazy-load IV Rank (non-blocking)
      fetchIVRank(ticker).then(setIvRankData).catch(() => {});
      if (preferredExp.date) {
        setSelectedExp(preferredExp.date);
      }
      setShowScannerPreselectBadge(preferredExp.fromScanner);
      setLastUpdated(new Date());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load options data');
    } finally {
      inFlightFetchKeyRef.current = '';
      setLoading(false);
    }
  }, [ticker, expiryParam]);

  const loadExpiration = useCallback(async (expDate: number, bypassCache = false, fresh = false) => {
    if (!ticker) return;
    const key = `${ticker}:${expDate}:${fresh ? 'fresh' : bypassCache ? 'bypass' : 'cached'}`;
    if (inFlightFetchKeyRef.current === key) return;
    inFlightFetchKeyRef.current = key;

    setShowScannerPreselectBadge(false);
    setSelectedOption(null);
    setSelectedExp(expDate);
    setLoading(true);
    setError(null);
    try {
      // Only fetch options — preserve existing price state (Opt 5)
      const opts = await fetchOptions(ticker, expDate, { bypassCache, fresh, source: fresh ? 'OptionsPage:refreshExpiration' : 'OptionsPage:loadExpiration' });
      setOptionsData(opts);
      setLastUpdated(new Date());
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load expiration data');
    } finally {
      inFlightFetchKeyRef.current = '';
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => {
    inFlightFetchKeyRef.current = '';
    setSelectedOption(null);
    loadData();
  }, [ticker, expiryParam, loadData]);

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

  const currentPrice = extendedPrice?.price ?? optionsData?.currentPrice ?? 0;
  const changePositive = extendedPrice ? extendedPrice.changePercent >= 0 : true;

  const toggleWatchlist = useCallback((put: EnrichedPut) => {
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
        expiryTimestamp: exp.date,
        expiryFormatted: exp.label,
        strike: put.strike,
        optionType: 'put',
        addedAt: Date.now(),
        savedAt: Date.now(),
        updatedAt: Date.now(),
        note: '',
        status: 'saved',
        snapshot: {
          underlyingPrice: currentPrice > 0 ? currentPrice : null,
          bid: put.bid,
          ask: put.ask,
          last: put.last,
          lastTradeDate: put.lastTradeDate,
          delta: put.delta,
          iv: put.impliedVolatility,
          dte: exp.dte,
          volume: put.volume,
          openInterest: put.openInterest,
          nominalYieldBid: put.nomYieldBid,
          annualizedYieldBid: put.annYieldBid,
          annualizedYieldAsk: put.annYieldAsk,
          moneynessPct: put.otmItmPct,
          moneynessLabel: put.otmItmLabel,
        },
      };
      addToWatchlist(item);
      setWatchlistIds(prev => new Set(prev).add(id));
    }
  }, [ticker, selectedExp, optionsData, currentPrice]);

  // Extract price from options response (Opt 5) — prefer extended price, fall back to options data
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

      const bidYield = calculateYieldPercent(p.bid, p.strike, dte);
      const askYield = calculateYieldPercent(p.ask, p.strike, dte);
      const lastYield = calculateYieldPercent(p.last, p.strike, dte);

      const volOI = (p.volume != null && p.volume > 0 && p.openInterest != null && p.openInterest > 0)
        ? p.volume / p.openInterest : null;

      const moneyness = calculateMoneyness(currentPrice, p.strike);

      return {
        strike: p.strike, last: p.last, lastTradeDate: p.lastTradeDate, bid: p.bid, ask: p.ask, delta,
        gamma: p.gamma ?? null, theta: p.theta ?? null, vega: p.vega ?? null,
        impliedVolatility: p.impliedVolatility, volume: p.volume, openInterest: p.openInterest, volOI,
        nomYieldBid: bidYield.nominal,
        annYieldBid: bidYield.annualized,
        nomYieldAsk: askYield.nominal,
        annYieldAsk: askYield.annualized,
        nomYieldLast: lastYield.nominal,
        annYieldLast: lastYield.annualized,
        otmItmPct: moneyness.pct != null ? Math.abs(moneyness.pct) : null,
        otmItmLabel: moneyness.label === '—' ? '' : moneyness.label,
        otmItmColor: moneyness.color,
      };
    });
  }, [optionsData, selectedExp, currentPrice]);

  const sortedPuts = useMemo(() => {
    return [...enrichedPuts].sort((a, b) => {
      const getValue = (put: EnrichedPut): number | string | null => {
        switch (sortField) {
          case 'strike': return put.strike;
          case 'last': return put.last;
          case 'bid': return put.bid;
          case 'ask': return put.ask;
          case 'delta': return put.delta;
          case 'otmItm': return put.otmItmPct;
          case 'iv': return put.impliedVolatility;
          case 'volume': return put.volume;
          case 'openInterest': return put.openInterest;
          case 'volOI': return put.volOI;
          case 'nomYieldBid': return put.nomYieldBid;
          case 'annYieldBid': return put.annYieldBid;
          case 'nomYieldAsk': return put.nomYieldAsk;
          case 'annYieldAsk': return put.annYieldAsk;
          case 'nomYieldLast': return put.nomYieldLast;
          case 'annYieldLast': return put.annYieldLast;
          default: return put.strike;
        }
      };

      const aVal = getValue(a);
      const bVal = getValue(b);
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      const comparison = typeof aVal === 'number' && typeof bVal === 'number'
        ? aVal - bVal
        : String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? comparison : -comparison;
    });
  }, [enrichedPuts, sortField, sortDir]);

  function defaultSortDirection(field: SortField): SortDirection {
    return field.includes('Yield') ? 'desc' : 'asc';
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(defaultSortDirection(field));
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronsUpDown className="w-3 h-3 opacity-40" style={{ color: 'var(--text-muted)' }} />;
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
    if (m === 'itm') return 'rgba(34,197,94,0.03)';
    if (m === 'atm') return 'rgba(234,179,8,0.06)';
    return 'rgba(239,68,68,0.04)';
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
  const hasEmptyOptions = !loading && !!optionsData && (
    optionsData.expirations.length === 0 || optionsData.puts.length === 0
  );
  const selectedExpiration = optionsData?.expirations.find(exp => exp.date === selectedExp) ?? null;
  const chainMeta = optionsData?.chainMeta ?? null;
  const chainAgeMs = chainMeta ? Date.now() - chainMeta.fetchedAt : null;
  const staleCachedChain = chainMeta?.source === 'cache' && chainAgeMs != null && chainAgeMs > 10 * 60 * 1000;
  const chainSourceLabel = chainMeta?.source === 'fresh'
    ? 'Fresh chain'
    : chainMeta?.source === 'cache'
      ? 'Cached chain'
      : 'Network chain';
  const putRangeLabel = chainMeta?.putStrikeMin != null && chainMeta.putStrikeMax != null
    ? `$${formatPrice(chainMeta.putStrikeMin)}-$${formatPrice(chainMeta.putStrikeMax)}`
    : 'no put range';
  const chainWarnings = useMemo(() => {
    if (!chainMeta) return [];
    const warnings: string[] = [];
    if (chainMeta.putCount === 0 && (chainMeta.callCount ?? 0) > 0) {
      warnings.push('Yahoo returned call contracts but no put contracts for this expiration.');
    } else if (chainMeta.putCount === 0) {
      warnings.push('Yahoo returned no put contracts for this expiration.');
    } else if (chainMeta.putCount < 3) {
      warnings.push('Very few put strikes returned. Refresh or verify on Yahoo.');
    }
    if (staleCachedChain) {
      warnings.push('This chain is from local cache and is older than 10 minutes. Click Refresh for a fresh Yahoo chain.');
    }
    if (
      chainMeta.source === 'fresh' &&
      chainMeta.previousCachedPutCount != null &&
      chainMeta.previousCachedPutCount !== chainMeta.putCount
    ) {
      warnings.push(`Fresh refresh updated put strike count from ${chainMeta.previousCachedPutCount} to ${chainMeta.putCount}.`);
    }
    return warnings;
  }, [chainMeta, staleCachedChain]);
  const chainDebug = useMemo(() => ({
    ticker: chainMeta?.ticker ?? ticker ?? null,
    selectedExpirationDate: selectedExp,
    selectedExpirationLabel: selectedExpiration?.label ?? null,
    cacheKey: chainMeta?.cacheKey ?? null,
    fetchedAt: chainMeta?.fetchedAt ? new Date(chainMeta.fetchedAt).toISOString() : null,
    source: chainMeta?.source ?? null,
    currentPrice,
    putCount: chainMeta?.putCount ?? optionsData?.puts.length ?? 0,
    putStrikeRange: {
      min: chainMeta?.putStrikeMin ?? null,
      max: chainMeta?.putStrikeMax ?? null,
    },
    putStrikes: optionsData?.puts.map(put => put.strike) ?? [],
    callCount: chainMeta?.callCount ?? null,
    callStrikeRange: {
      min: chainMeta?.callStrikeMin ?? null,
      max: chainMeta?.callStrikeMax ?? null,
    },
    yahooExpirationDatesCount: chainMeta?.yahooExpirationDatesCount ?? null,
  }), [chainMeta, currentPrice, optionsData, selectedExp, selectedExpiration, ticker]);

  const handleRefresh = useCallback(() => {
    inFlightFetchKeyRef.current = '';
    if (selectedExp) loadExpiration(selectedExp, true, true);
    else loadData(undefined, true, true);
  }, [loadData, loadExpiration, selectedExp]);

  const mobileSortOptions: Array<{ field: SortField; label: string }> = [
    { field: 'strike', label: 'Strike' },
    { field: 'bid', label: 'Bid' },
    { field: 'ask', label: 'Ask' },
    { field: 'delta', label: 'Delta' },
    { field: 'annYieldBid', label: 'AY Bid' },
    { field: 'iv', label: 'IV' },
    { field: 'otmItm', label: 'Moneyness' },
  ];

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
    <div className="min-h-screen overflow-x-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="option-page-shell max-w-[1400px] mx-auto px-3 sm:px-5 lg:px-8 py-4 sm:py-6">
        {/* Header */}
        <div className="option-page-title-row flex items-center gap-2 sm:gap-4 mb-4 sm:mb-6 min-w-0">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-lg transition-all min-h-[44px] min-w-[44px] flex items-center justify-center"
            style={{ color: 'var(--text-muted)' }}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold font-mono" style={{ color: 'var(--text)' }}>{etf.ticker}</h1>
              <span className="text-xs sm:text-sm truncate" style={{ color: 'var(--text-muted)' }}>{etf.name}</span>
            </div>
          </div>
        </div>

        {/* Price bar */}
        <div
          data-layout="price-header"
          className="option-price-header sticky-stack mobile-static-sticky z-30 rounded-xl p-3 sm:p-5 mb-3 sm:mb-6 bg-[#12121a] border-b border-[#1e1e2e]"
          style={{
            top: PRICE_HEADER_TOP,
            zIndex: 30,
            overflow: 'visible',
            height: 'auto',
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
          }}
        >
          <div className="flex flex-wrap items-start sm:items-center gap-2 sm:gap-4 lg:gap-6 min-w-0">
            {/* Price + change */}
            <div className="flex-shrink-0 min-w-0">
              <span className="text-xl sm:text-3xl font-bold font-mono" style={{ color: 'var(--text)' }}>
                ${currentPrice > 0 ? currentPrice.toFixed(2) : '—'}
              </span>
              {extendedPrice && (
                <div className="flex items-center gap-1.5 text-xs sm:text-sm font-mono mt-1 min-w-0" style={{ color: changePositive ? 'var(--green)' : 'var(--red)' }}>
                  {changePositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  <span>{changePositive ? '+$' : '-$'}{Math.abs(extendedPrice.change).toFixed(2)}</span>
                  <span>({changePositive ? '+' : '-'}{Math.abs(extendedPrice.changePercent).toFixed(2)}%)</span>
                </div>
              )}
            </div>

            {/* Sparkline chart - hidden on mobile */}
            <div className="phone-landscape-hide hidden sm:block flex-shrink-0 min-w-0">
              {loading && !extendedPrice ? (
                <div className="flex items-center justify-center" style={{ width: 220, height: 55 }}>
                  <div className="h-3.5 w-20 rounded animate-pulse" style={{ backgroundColor: 'var(--border)' }} />
                </div>
              ) : sparklineData.length >= 2 ? (
                <button
                  type="button"
                  onClick={() => setShowPriceChart(true)}
                  className="block rounded-lg p-1 transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
                  aria-label={`Open ${ticker} interactive price chart`}
                >
                  <SparklineChart
                    data={sparklineData}
                    color={sparklineColor}
                    width={220}
                    height={55}
                    fillGradient
                    referenceValue={extendedPrice?.previousClose ?? null}
                  />
                </button>
              ) : (
                <div className="flex items-center justify-center text-xs" style={{ width: 220, height: 55, color: 'var(--text-dim)' }}>No intraday data</div>
              )}
            </div>

            {/* Performance metrics - hidden on mobile */}
            <div className="phone-landscape-hide hidden sm:block flex-shrink-0 min-w-[140px] lg:min-w-[160px]">
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
            <div data-mobile-controls className="flex w-full flex-wrap items-center gap-2 text-xs sm:ml-auto sm:w-auto sm:gap-3 min-w-0" style={{ color: 'var(--text-muted)' }}>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer min-h-[40px] sm:min-h-0" style={{ color: 'var(--text-muted)' }}>
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
                onClick={handleRefresh}
                disabled={loading}
                className="ml-auto sm:ml-0 flex items-center gap-1.5 px-3 py-2 sm:py-2 rounded-lg disabled:opacity-50 transition-all min-h-[40px] sm:min-h-0"
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
            className="option-expiry-row sticky-stack mobile-static-sticky touch-scroll z-20 flex gap-2 mb-3 sm:mb-6 overflow-x-auto pt-2 pb-2 -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap bg-[#0a0a0f]"
            style={{
              top: EXPIRY_ROW_TOP,
              zIndex: 20,
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
            {showScannerPreselectBadge && (
              <span
                className="self-center px-2 py-1 rounded-md text-[10px] whitespace-nowrap flex-shrink-0"
                style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
              >
                Pre-selected from Scanner
              </span>
            )}
          </div>
        )}

        {chainMeta && (
          <div
            className="mb-3 rounded-lg px-3 py-2 text-xs"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          >
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>
                {chainSourceLabel} loaded {new Date(chainMeta.fetchedAt).toLocaleTimeString()}
              </span>
              <span>{chainMeta.putCount} put strikes</span>
              <span>{putRangeLabel}</span>
              {selectedExp && <span>Exp {selectedExp}</span>}
              {staleCachedChain && (
                <span style={{ color: 'var(--yellow)' }}>Cached &gt;10m</span>
              )}
            </div>
            {chainWarnings.length > 0 && (
              <div className="mt-1 flex flex-col gap-0.5" style={{ color: 'var(--yellow)' }}>
                {chainWarnings.map(warning => (
                  <span key={warning}>{warning}</span>
                ))}
              </div>
            )}
            <details className="mt-1">
              <summary className="cursor-pointer select-none" style={{ color: 'var(--text-dim)' }}>
                Show chain diagnostics
              </summary>
              <pre
                className="mt-2 max-h-44 overflow-auto rounded-md p-2 text-[10px]"
                style={{ backgroundColor: 'var(--bg)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
              >
                {JSON.stringify(chainDebug, null, 2)}
              </pre>
            </details>
          </div>
        )}

        {/* Options table */}
        {error ? (
          <OptionsEmptyState type="error" onRefresh={handleRefresh} loading={loading} />
        ) : hasEmptyOptions ? (
          <OptionsEmptyState type="empty" onRefresh={handleRefresh} loading={loading} />
        ) : (
          <>
          <div className="option-mobile-chain space-y-3">
            <div
              className="option-chain-sort rounded-xl p-3"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                <div className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Option Chain
                </div>
                <div className="text-xs font-mono tabular-nums" style={{ color: 'var(--text-dim)' }}>
                  {sortedPuts.length} puts
                </div>
              </div>
              <div className="grid grid-cols-[1fr_auto] gap-2">
                <label className="min-w-0">
                  <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>Sort by</span>
                  <select
                    value={sortField}
                    onChange={event => setSortField(event.target.value as SortField)}
                    className="w-full rounded-lg px-3 py-2 text-base font-medium outline-none min-h-[44px]"
                    style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
                  >
                    {mobileSortOptions.map(option => (
                      <option key={option.field} value={option.field}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className="min-w-[104px]">
                  <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>Direction</span>
                  <select
                    value={sortDir}
                    onChange={event => setSortDir(event.target.value as SortDirection)}
                    className="w-full rounded-lg px-3 py-2 text-base font-medium outline-none min-h-[44px]"
                    style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
                  >
                    <option value="asc">Asc</option>
                    <option value="desc">Desc</option>
                  </select>
                </label>
              </div>
            </div>
            {loading ? (
              Array.from({ length: 5 }).map((_, index) => (
                <div
                  key={index}
                  className="h-28 rounded-xl animate-pulse"
                  style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
                />
              ))
            ) : (
              (() => {
                const cards: JSX.Element[] = [];
                let dividerInserted = false;
                const showCurrentPriceDivider = sortField === 'strike' && currentPrice > 0;

                sortedPuts.forEach(put => {
                  const shouldInsertDivider = showCurrentPriceDivider && !dividerInserted && (
                    sortDir === 'asc'
                      ? put.strike >= currentPrice
                      : put.strike <= currentPrice
                  );
                  if (shouldInsertDivider) {
                    cards.push(
                      <div
                        key="mobile-current-price-divider"
                        className="rounded-lg px-3 py-2 text-xs font-medium"
                        style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}
                      >
                        Current price: ${currentPrice.toFixed(2)}
                      </div>
                    );
                    dividerInserted = true;
                  }

                  const expForId = optionsData?.expirations.find(e => e.date === selectedExp);
                  const expiryIso = expForId ? new Date(expForId.date * 1000).toISOString().split('T')[0] : '';
                  const wlId = makeWatchlistId(ticker ?? '', expiryIso, put.strike);
                  cards.push(
                    <MobileOptionCard
                      key={put.strike}
                      put={put}
                      moneyness={getMoneyness(put.strike)}
                      watched={watchlistIds.has(wlId)}
                      showVolOI={showVolOI}
                      onToggleWatchlist={() => toggleWatchlist(put)}
                      onSelect={() => setSelectedOption(put)}
                    />
                  );
                });

                if (showCurrentPriceDivider && !dividerInserted && sortedPuts.length > 0) {
                  cards.push(
                    <div
                      key="mobile-current-price-divider-end"
                      className="rounded-lg px-3 py-2 text-xs font-medium"
                      style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}
                    >
                      Current price: ${currentPrice.toFixed(2)}
                    </div>
                  );
                }

                return cards;
              })()
            )}
          </div>

          <div className="option-desktop-chain rounded-xl max-w-full overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="max-h-[calc(100vh-230px)] min-h-[260px] max-w-full overflow-auto overscroll-contain sm:max-h-[calc(100vh-250px)]">
              <table className="min-w-[520px] md:min-w-[980px] lg:min-w-[1180px] xl:min-w-0 w-full table-fixed text-xs">
                <thead
                  className="bg-[#12121a]"
                  style={{
                    backgroundColor: 'var(--surface)',
                  }}
                >
                  <tr style={{ backgroundColor: 'var(--surface)' }}>
                    <th
                      className="sticky-stack top-0 z-30 px-1.5 sm:px-2 py-1.5 w-6 text-[10px] sm:text-[11px] bg-[#12121a]"
                      style={{
                        color: 'var(--text-muted)',
                        backgroundColor: 'var(--surface)',
                        borderBottom: '2px solid var(--border)',
                        boxShadow: '0 1px 0 var(--border), 0 6px 12px rgba(0,0,0,0.18)',
                      }}
                    ></th>
                    {columns.map(col => (
                      <th
                        key={col.field}
                        onClick={() => handleSort(col.field)}
                        title={col.fullLabel}
                        className={`sticky-stack top-0 px-1.5 sm:px-2 py-1.5 text-[10px] sm:text-[11px] uppercase tracking-wider font-medium cursor-pointer transition-colors select-none whitespace-nowrap bg-[#12121a] ${col.align} ${col.widthClass} ${
                          col.field === 'strike' ? 'left-0 z-40 border-r' : 'z-30'
                        } ${col.hideOnMobile ? 'hidden md:table-cell' : ''} ${col.hideOnTablet ? 'hidden lg:table-cell' : ''}`}
                        style={{
                          color: 'var(--text-muted)',
                          backgroundColor: 'var(--surface)',
                          borderColor: 'var(--border)',
                          borderBottom: '2px solid var(--border)',
                          boxShadow: '0 1px 0 var(--border), 0 6px 12px rgba(0,0,0,0.18)',
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
                    const rows: JSX.Element[] = [];
                    let dividerInserted = false;
                    const showCurrentPriceDivider = sortField === 'strike' && sortDir === 'asc';

                    sortedPuts.forEach((put, idx) => {
                      if (showCurrentPriceDivider && !dividerInserted && put.strike >= currentPrice && idx > 0) {
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
                      const isSelected = selectedOption?.strike === put.strike;
                      const rowBackground = isSelected ? 'var(--accent-bg)' : altBg;

                      rows.push(
                        <tr
                          key={put.strike}
                          onClick={() => setSelectedOption(put)}
                          className="transition-colors cursor-pointer"
                          style={{
                            borderBottom: '1px solid var(--border)',
                            backgroundColor: rowBackground,
                            boxShadow: isSelected ? 'inset 3px 0 0 var(--accent)' : 'none',
                          }}
                        >
                          <td className="px-1.5 sm:px-2 py-1.5 text-center text-xs w-6">
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                toggleWatchlist(put);
                              }}
                              className="transition-opacity hover:opacity-70 min-h-[44px] min-w-[32px] flex items-center justify-center"
                              title={isWatched ? 'Remove from watchlist' : 'Add to watchlist'}
                            >
                              <Star
                                className={`w-3.5 h-3.5 ${isWatched ? 'fill-current' : ''}`}
                                style={{ color: isWatched ? 'var(--accent-light)' : 'var(--text-dim)' }}
                              />
                            </button>
                          </td>
                          <td className="sticky-stack left-0 z-[2] px-1.5 sm:px-2 py-1.5 text-left text-xs whitespace-nowrap border-r w-24" style={{ borderColor: 'var(--border)', backgroundColor: isSelected ? 'var(--accent-bg)' : bg }}>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-semibold tabular-nums" style={{ color: 'var(--text)' }}>{formatPrice(put.strike)}</span>
                              {moneyness === 'itm' && (
                                <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: 'var(--green)', border: '1px solid rgba(34,197,94,0.2)' }}>ITM</span>
                              )}
                              {moneyness === 'otm' && (
                                <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.15)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.2)' }}>OTM</span>
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
          </>
        )}

        <footer className="mt-8 pb-6 text-center">
          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Data delayed up to 15 minutes. Not financial advice.</p>
        </footer>
      </div>

      {selectedOption && (
        <ErrorBoundary title="Option drawer unavailable" message="The option detail drawer could not render. Close it and try again.">
          <Suspense fallback={null}>
            <OptionDetailDrawer
              option={selectedOption}
              ticker={ticker ?? ''}
              expirationLabel={selectedExpiration?.label ?? ''}
              dte={selectedExpiration?.dte ?? null}
              underlyingPrice={currentPrice > 0 ? currentPrice : null}
              onAddToPortfolio={draft => {
                if (!ticker || !selectedExpiration) return;
                const expiration = new Date(selectedExpiration.date * 1000).toISOString().split('T')[0];
                addPortfolioTrade({
                  ticker,
                  optionType: 'put',
                  strike: draft.option.strike,
                  expiration,
                  contracts: draft.contracts,
                  soldPrice: draft.soldPrice,
                  soldDate: new Date().toISOString().split('T')[0],
                  status: 'open',
                  notes: '',
                  entrySnapshot: {
                    underlyingPrice: draft.underlyingPrice,
                    bid: draft.option.bid,
                    ask: draft.option.ask,
                    last: draft.option.last,
                    iv: draft.option.impliedVolatility,
                    delta: draft.option.delta,
                  },
                });
                setSelectedOption(null);
              }}
              onClose={() => setSelectedOption(null)}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {showPriceChart && (
        <ErrorBoundary title="Chart unavailable" message="The price chart could not render. Close it and try again.">
          <Suspense fallback={null}>
            <InteractivePriceChartModal
              isOpen
              ticker={ticker ?? ''}
              displayTicker={ticker ?? ''}
              onClose={() => setShowPriceChart(false)}
            />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}

import { lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { OptionsChainData, SortField, SortDirection } from '../lib/types';
import { fetchOptions, fetchTickerDetail, formatPrice, formatYield, yieldColor, formatNumber } from '../lib/api';
import type { ExtendedPriceData, TickerDetailAvailability, TickerDetailErrorCode, VolatilityContextData } from '../lib/api';
import { addToWatchlist, removeFromWatchlist, isInWatchlist, makeWatchlistId } from '../lib/watchlist';
import type { WatchlistItem } from '../lib/watchlist';
import { addPortfolioTrade } from '../lib/portfolioStorage';
import { calculateBidAskSpreadPercent, calculateMoneyness, calculateYieldPercent } from '../lib/optionMetrics';
import { resolvePutDeltaWithSource, type PutDeltaSource } from '../lib/putDelta';
import { entryDeltaFromExactChain, usMarketDateIso } from '../lib/portfolioEntryDelta';
import { compareNullableValue } from '../lib/metricValue';
import { normalizeAnalyzeTicker, resolveTickerDetailInstrument } from '../lib/tickerDetail';
import { formatOptionLastTradeDate, normalizeTimestampMs } from '../lib/format';
import { getOptionLastTradeFreshness } from '../lib/optionLastTradeFreshness';
import { persistShowNominalYield, readShowNominalYield } from '../lib/optionTablePreferences';
import { getUnderlyingHoldingsProxy } from '../lib/underlyingHoldingsProxies';
import { getLastScannerUrl, isScannerNavigationState } from '../lib/scannerNavigation';
import { getReturnedOptionExpiration, optionChainMatchesRequestedExpiration, parseRequestedOptionExpiry, resolveOptionExpirySelection } from '../lib/optionExpiryNavigation';
import {
  OPTION_QUOTE_DISPLAY_LABELS,
  OPTION_QUOTE_TABLE_DISPLAY_ORDER,
  OPTION_YIELD_DISPLAY_LABELS,
  OPTION_YIELD_DISPLAY_ORDER,
  isNominalYieldField,
  orderedOptionQuoteEntries,
  type OptionQuoteTableDisplayField,
  type OptionYieldDisplayField,
} from '../lib/optionQuoteDisplay';
import SparklineChart from '../components/SparklineChart';
import ErrorBoundary from '../components/ErrorBoundary';
import MobileOptionRow from '../components/mobile/MobileOptionRow';
import AccountControl from '../components/AccountControl';
import { useResponsiveMode } from '../lib/responsive';
import type { AddToPortfolioDraft } from '../components/OptionDetailDrawer';
import {
  ArrowLeft, RefreshCw, TrendingUp, TrendingDown, AlertCircle,
  ChevronUp, ChevronDown, ChevronsUpDown, Star, BarChart3, Layers
} from 'lucide-react';

const OptionDetailDrawer = lazy(() => import('../components/OptionDetailDrawer'));
const InteractivePriceChartModal = lazy(() => import('../components/InteractivePriceChartModal'));
const UnderlyingHoldingsModal = lazy(() => import('../components/UnderlyingHoldingsModal'));

interface EnrichedPut {
  strike: number;
  last: number | null;
  lastTradeDate: number | null;
  bid: number | null;
  ask: number | null;
  delta: number | null;
  deltaSource: PutDeltaSource | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  impliedVolatility: number | null;
  volume: number | null;
  openInterest: number | null;
  contractSymbol?: string | null;
  rawLastPrice?: number | null;
  rawBid?: number | null;
  rawAsk?: number | null;
  rawImpliedVolatility?: number | null;
  rawOpenInterest?: number | null;
  rawVolume?: number | null;
  rawLastTradeDate?: number | null;
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
  title: customTitle,
  subtitle: customSubtitle,
}: {
  type: 'empty' | 'error';
  onRefresh: () => void;
  loading: boolean;
  title?: string;
  subtitle?: string;
}) {
  const Icon = type === 'empty' ? BarChart3 : AlertCircle;
  const title = customTitle ?? (type === 'empty' ? 'No options data available' : 'Failed to load options data');
  const subtitle = type === 'empty'
    ? 'This ticker may not have listed options, or market data may be unavailable. Try again or return to Scanner.'
    : 'Market data could not be loaded. Try again or return to Scanner.';

  return (
    <div
      className="rounded-xl py-16 px-6 text-center"
      style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
    >
      <Icon className="w-10 h-10 mx-auto mb-4" style={{ color: 'var(--text-dim)' }} />
      <h2 className="text-lg font-semibold mb-2" style={{ color: 'var(--text)' }}>{title}</h2>
      <p className="text-sm max-w-md mx-auto mb-6" style={{ color: 'var(--text-muted)' }}>{customSubtitle ?? subtitle}</p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <button
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2.5 sm:py-2 text-white text-sm font-medium rounded-lg disabled:opacity-50 transition-all min-h-[44px] sm:min-h-0"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Try Again
        </button>
        <Link
          to="/"
          className="inline-flex min-h-[44px] items-center rounded-lg px-4 py-2.5 text-sm font-medium sm:min-h-0 sm:py-2"
          style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
        >
          Back to Scanner
        </Link>
      </div>
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

function deltaColor(delta: number | null): string {
  if (delta == null || !Number.isFinite(delta)) return 'var(--text-dim)';
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

function ivVsRealizedRangeColor(value: number): string {
  if (value >= 70) return 'var(--red)';
  if (value >= 50) return 'var(--orange)';
  if (value >= 30) return 'var(--yellow)';
  return 'var(--green)';
}

function getMidPrice(bid: number | null, ask: number | null): number | null {
  return bid != null && ask != null && Number.isFinite(bid) && Number.isFinite(ask) && bid > 0 && ask > 0
    ? (bid + ask) / 2
    : null;
}

function formatLastTradeDate(value: number | null | undefined): string {
  const timestamp = normalizeTimestampMs(value);
  if (timestamp == null) return '—';
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatSpreadPercent(bid: number | null, ask: number | null): string {
  const spread = calculateBidAskSpreadPercent(bid, ask);
  return spread != null ? `${(spread * 100).toFixed(1)}%` : '—';
}

function OptionQuickTooltip({ put, ticker, expirationLabel, dte }: { put: EnrichedPut; ticker: string; expirationLabel: string; dte: number | null }) {
  const stale = getOptionLastTradeFreshness(put.lastTradeDate);
  const lastTradeDate = formatLastTradeDate(put.lastTradeDate);
  const quoteText = orderedOptionQuoteEntries({
    last: put.last,
    bid: put.bid,
    mid: getMidPrice(put.bid, put.ask),
    ask: put.ask,
  }).map(({ label, value }) => `${label} ${formatPrice(value)}`).join(' · ');
  return (
    <div
      className="pointer-events-none absolute left-0 top-[calc(100%+4px)] z-50 hidden w-[320px] rounded-lg px-3 py-2 text-left text-xs opacity-0 shadow-xl transition-opacity group-hover:block group-hover:opacity-100 group-focus-within:block group-focus-within:opacity-100"
      style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', boxShadow: 'var(--shadow)' }}
    >
      <div className="mb-1 font-semibold" style={{ color: 'var(--text)' }}>
        {ticker} ${formatPrice(put.strike)} Put · {expirationLabel || '—'} · {dte != null ? `${dte} DTE` : '— DTE'}
      </div>
      <div className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>
        {quoteText}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-1.5 font-mono text-[11px] tabular-nums" style={{ color: stale.color }}>
        <span>Last Trade Date: {lastTradeDate}</span>
        {stale.label && <span>· {stale.label}</span>}
      </div>
      <div className="mt-1 font-mono text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
        Δ {put.delta != null ? put.delta.toFixed(2) : '—'} · IV {put.impliedVolatility != null ? `${put.impliedVolatility.toFixed(1)}%` : '—'} · {put.otmItmLabel || '—'}
      </div>
      <div className="mt-1 font-mono text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
        Spread {formatSpreadPercent(put.bid, put.ask)} · Ann. SCY Bid {put.annYieldBid != null ? formatYield(put.annYieldBid) : '—'} · Ann. SCY Ask {put.annYieldAsk != null ? formatYield(put.annYieldAsk) : '—'}
      </div>
      <div className="mt-1 font-mono text-[11px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
        Vol {formatNumber(put.volume)} · OI {formatNumber(put.openInterest)}
      </div>
    </div>
  );
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
  showNominalYield,
  onToggleWatchlist,
  onSelect,
}: {
  put: EnrichedPut;
  moneyness: 'itm' | 'otm' | 'atm';
  watched: boolean;
  showVolOI: boolean;
  showNominalYield: boolean;
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
        {OPTION_QUOTE_TABLE_DISPLAY_ORDER.map(field => <MobileStat key={field} label={OPTION_QUOTE_DISPLAY_LABELS[field]} value={formatPrice(put[field])} color={field === 'bid' ? 'var(--green)' : undefined} />)}
      </div>
      <div className={`mobile-secondary-grid mt-2 grid gap-2 ${showNominalYield ? 'grid-cols-4' : 'grid-cols-3'}`}>
        <MobileStat label="Delta" value={put.delta != null ? put.delta.toFixed(2) : '—'} color={deltaColor(put.delta)} />
        <MobileStat label="IV" value={put.impliedVolatility != null ? `${put.impliedVolatility.toFixed(1)}%` : '—'} color={ivColor(put.impliedVolatility)} />
        <MobileStat label="Ann. SCY Bid" value={put.annYieldBid != null ? formatYield(put.annYieldBid) : '—'} color={put.annYieldBid != null ? yieldColor(put.annYieldBid) : 'var(--text-dim)'} />
        {showNominalYield && <MobileStat label="SCY Bid" value={put.nomYieldBid != null ? formatYield(put.nomYieldBid) : '—'} />}
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

export default function OptionsPage() {
  const { isPhone } = useResponsiveMode();
  const navigate = useNavigate();
  const location = useLocation();
  const { ticker: routeTicker } = useParams<{ ticker: string }>();
  const routeNormalization = normalizeAnalyzeTicker(routeTicker ?? '');
  const ticker = routeNormalization.ticker ?? undefined;
  const [searchParams] = useSearchParams();
  const expiryParam = searchParams.get('expiry');
  const requestedExpiry = parseRequestedOptionExpiry(expiryParam);
  const openedFromScanner = isScannerNavigationState(location.state);

  const [optionsData, setOptionsData] = useState<OptionsChainData | null>(null);
  const [extendedPrice, setExtendedPrice] = useState<ExtendedPriceData | null>(null);
  const [selectedExp, setSelectedExp] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortField, setSortField] = useState<SortField>('strike');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');
  const [showVolOI, setShowVolOI] = useState(false);
  const [showNominalYield, setShowNominalYield] = useState(readShowNominalYield);
  const [volatilityContext, setVolatilityContext] = useState<VolatilityContextData | null>(null);
  const [detailAvailability, setDetailAvailability] = useState<TickerDetailAvailability | null>(null);
  const [detailErrorCode, setDetailErrorCode] = useState<TickerDetailErrorCode | null>(null);
  const [watchlistIds, setWatchlistIds] = useState<Set<string>>(new Set());
  const [showScannerPreselectBadge, setShowScannerPreselectBadge] = useState(false);
  const [selectedOption, setSelectedOption] = useState<EnrichedPut | null>(null);
  const [showPriceChart, setShowPriceChart] = useState(false);
  const [showUnderlyingHoldings, setShowUnderlyingHoldings] = useState(false);
  const [debugOptionsEnabled] = useState(() => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem('put_scanner_debug_options') === 'true';
    } catch {
      return false;
    }
  });

  const inFlightFetchKeyRef = useRef<string>('');
  const requestGenerationRef = useRef(0);
  const requestAbortRef = useRef<AbortController | null>(null);

  const handleShowNominalYieldChange = useCallback((value: boolean) => {
    setShowNominalYield(value);
    persistShowNominalYield(value);
  }, []);

  const loadData = useCallback(async (bypassCache = false, fresh = false) => {
    if (!ticker) return;
    const key = `${ticker}:${requestedExpiry ?? 'default'}:${fresh ? 'fresh' : bypassCache ? 'bypass' : 'cached'}`;
    if (inFlightFetchKeyRef.current === key) return;
    inFlightFetchKeyRef.current = key;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const requestGeneration = ++requestGenerationRef.current;

    setLoading(true);
    setError(null);
    try {
      const detail = await fetchTickerDetail(ticker, requestedExpiry ?? undefined, { bypassCache, fresh, signal: controller.signal }).catch(error => {
          const status = (error as Error & { status?: number }).status;
          if (requestedExpiry == null || (status !== 400 && status !== 404)) throw error;
          return fetchTickerDetail(ticker, undefined, { bypassCache, fresh, signal: controller.signal });
        });
      const initialOpts = detail.options;
      const ext = detail.extendedPrice;
      const returnedExpiration = getReturnedOptionExpiration(initialOpts.chainMeta);
      const preferredExp = resolveOptionExpirySelection(initialOpts.expirations, expiryParam, returnedExpiration);
      const opts = preferredExp.date && preferredExp.needsChainFetch
        ? await fetchOptions(ticker, preferredExp.date, { bypassCache, fresh, signal: controller.signal, source: fresh ? 'OptionsPage:refresh:fallback' : 'OptionsPage:load:fallback' })
        : initialOpts;
      if (preferredExp.date && !optionChainMatchesRequestedExpiration(opts.chainMeta, preferredExp.date)) {
        throw new Error('The requested expiration was unavailable. The previous chain was preserved.');
      }
      if (requestGeneration !== requestGenerationRef.current) return;
      setOptionsData(opts);
      setExtendedPrice(ext);
      setVolatilityContext(detail.volatilityContext);
      setDetailAvailability(detail.availability);
      setDetailErrorCode(null);
      if (preferredExp.date) {
        setSelectedExp(preferredExp.date);
      }
      setShowScannerPreselectBadge(openedFromScanner && preferredExp.requestedMatch);
      setLastUpdated(new Date());
    } catch (err: unknown) {
      if (requestGeneration !== requestGenerationRef.current) return;
      if ((err as { name?: unknown })?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to load options data');
      const code = (err as Error & { code?: TickerDetailErrorCode }).code;
      setDetailErrorCode(code === 'INVALID_INPUT' || code === 'INVALID_SYMBOL' ? code : 'PROVIDER_FAILURE');
    } finally {
      if (requestGeneration === requestGenerationRef.current) {
        inFlightFetchKeyRef.current = '';
        setLoading(false);
      }
    }
  }, [expiryParam, openedFromScanner, requestedExpiry, ticker]);

  const loadExpiration = useCallback(async (expDate: number, bypassCache = false, fresh = false) => {
    if (!ticker) return;
    const key = `${ticker}:${expDate}:${fresh ? 'fresh' : bypassCache ? 'bypass' : 'cached'}`;
    if (inFlightFetchKeyRef.current === key) return;
    inFlightFetchKeyRef.current = key;
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const requestGeneration = ++requestGenerationRef.current;

    setShowScannerPreselectBadge(false);
    setSelectedOption(null);
    setLoading(true);
    setError(null);
    try {
      // Only fetch options — preserve existing price state (Opt 5)
      const opts = await fetchOptions(ticker, expDate, { bypassCache, fresh, signal: controller.signal, source: fresh ? 'OptionsPage:refreshExpiration' : 'OptionsPage:loadExpiration' });
      if (!optionChainMatchesRequestedExpiration(opts.chainMeta, expDate)) {
        throw new Error('The requested expiration was unavailable. The previous chain was preserved.');
      }
      if (requestGeneration !== requestGenerationRef.current) return;
      setOptionsData(opts);
      setSelectedExp(expDate);
      setLastUpdated(new Date());
    } catch (err: unknown) {
      if (requestGeneration !== requestGenerationRef.current) return;
      if ((err as { name?: unknown })?.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to load expiration data');
    } finally {
      if (requestGeneration === requestGenerationRef.current) {
        inFlightFetchKeyRef.current = '';
        setLoading(false);
      }
    }
  }, [ticker]);

  useEffect(() => {
    inFlightFetchKeyRef.current = '';
    setSelectedOption(null);
    setOptionsData(null);
    setExtendedPrice(null);
    setSelectedExp(null);
    setVolatilityContext(null);
    setDetailAvailability(null);
    setDetailErrorCode(null);
    void loadData();
    return () => {
      requestGenerationRef.current += 1;
      requestAbortRef.current?.abort();
      inFlightFetchKeyRef.current = '';
    };
  }, [ticker, expiryParam, loadData]);

  useEffect(() => {
    if (!showNominalYield) {
      setSortField(current => current === 'nomYieldBid' ? 'annYieldBid' : current === 'nomYieldAsk' ? 'annYieldAsk' : current === 'nomYieldLast' ? 'annYieldLast' : current);
    }
  }, [showNominalYield]);

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
  const instrument = useMemo(() => resolveTickerDetailInstrument(ticker ?? '', optionsData?.instrument), [optionsData?.instrument, ticker]);
  const holdingsProxy = useMemo(() => getUnderlyingHoldingsProxy(ticker ?? ''), [ticker]);

  const toggleWatchlist = useCallback((put: EnrichedPut) => {
    if (!ticker || !selectedExp) return;
    const exp = optionsData?.expirations.find(e => e.date === selectedExp);
    if (!exp) return;
    const d = new Date(exp.date * 1000);
    const expiry = d.toISOString().split('T')[0];
    const id = makeWatchlistId(ticker, expiry, put.strike);

    if (isInWatchlist(id)) {
      const stored = removeFromWatchlist(id);
      setWatchlistIds(prev => {
        const next = new Set(prev);
        if (stored.some(item => item.id === id)) next.add(id);
        else next.delete(id);
        return next;
      });
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
      const stored = addToWatchlist(item);
      setWatchlistIds(prev => {
        const next = new Set(prev);
        if (stored.some(saved => saved.id === id)) next.add(id);
        else next.delete(id);
        return next;
      });
    }
  }, [ticker, selectedExp, optionsData, currentPrice]);

  // Extract price from options response (Opt 5) — prefer extended price, fall back to options data
  const enrichedPuts = useMemo((): EnrichedPut[] => {
    if (!optionsData?.puts) return [];
    const exp = optionsData.expirations.find(e => e.date === selectedExp);
    const dte = exp?.dte ?? 1;

    return optionsData.puts.map(p => {
      const resolvedDelta = resolvePutDeltaWithSource({
        providerDelta: p.delta,
        underlyingPrice: currentPrice,
        strike: p.strike,
        dte,
        impliedVolatilityPercent: p.impliedVolatility,
      });

      const bidYield = calculateYieldPercent(p.bid, p.strike, dte);
      const askYield = calculateYieldPercent(p.ask, p.strike, dte);
      const lastYield = calculateYieldPercent(p.last, p.strike, dte);

      const volOI = (p.volume != null && p.volume > 0 && p.openInterest != null && p.openInterest > 0)
        ? p.volume / p.openInterest : null;

      const moneyness = calculateMoneyness(currentPrice, p.strike);

      return {
        strike: p.strike, last: p.last, lastTradeDate: p.lastTradeDate, bid: p.bid, ask: p.ask,
        delta: resolvedDelta?.delta ?? null, deltaSource: resolvedDelta?.source ?? null,
        gamma: p.gamma ?? null, theta: p.theta ?? null, vega: p.vega ?? null,
        impliedVolatility: p.impliedVolatility, volume: p.volume, openInterest: p.openInterest, volOI,
        contractSymbol: p.contractSymbol,
        rawLastPrice: p.rawLastPrice,
        rawBid: p.rawBid,
        rawAsk: p.rawAsk,
        rawImpliedVolatility: p.rawImpliedVolatility,
        rawOpenInterest: p.rawOpenInterest,
        rawVolume: p.rawVolume,
        rawLastTradeDate: p.rawLastTradeDate,
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
          case 'lastTradeDate': return put.lastTradeDate;
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

      return compareNullableValue(getValue(a), getValue(b), sortDir);
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
  type OptionTableColumn = { field: SortField; label: string; fullLabel: string; align: string; widthClass: string; hideOnMobile?: boolean; hideOnTablet?: boolean };
  const quoteColumns: Record<OptionQuoteTableDisplayField, OptionTableColumn> = {
    last: { field: 'last', label: 'Last', fullLabel: 'Last', align: 'text-right', widthClass: 'w-14', hideOnMobile: true },
    bid: { field: 'bid', label: 'Bid', fullLabel: 'Bid', align: 'text-right', widthClass: 'w-14' },
    ask: { field: 'ask', label: 'Ask', fullLabel: 'Ask', align: 'text-right', widthClass: 'w-14' },
  };
  const yieldColumns: Record<OptionYieldDisplayField, OptionTableColumn> = {
    nomYieldLast: { field: 'nomYieldLast', label: OPTION_YIELD_DISPLAY_LABELS.nomYieldLast.short, fullLabel: OPTION_YIELD_DISPLAY_LABELS.nomYieldLast.full, align: 'text-right', widthClass: 'w-[72px]', hideOnMobile: true, hideOnTablet: true },
    annYieldLast: { field: 'annYieldLast', label: OPTION_YIELD_DISPLAY_LABELS.annYieldLast.short, fullLabel: OPTION_YIELD_DISPLAY_LABELS.annYieldLast.full, align: 'text-right', widthClass: 'w-[72px]', hideOnMobile: true, hideOnTablet: true },
    nomYieldBid: { field: 'nomYieldBid', label: OPTION_YIELD_DISPLAY_LABELS.nomYieldBid.short, fullLabel: OPTION_YIELD_DISPLAY_LABELS.nomYieldBid.full, align: 'text-right', widthClass: 'w-[72px]', hideOnMobile: true, hideOnTablet: true },
    annYieldBid: { field: 'annYieldBid', label: OPTION_YIELD_DISPLAY_LABELS.annYieldBid.short, fullLabel: OPTION_YIELD_DISPLAY_LABELS.annYieldBid.full, align: 'text-right', widthClass: 'w-[72px]' },
    nomYieldAsk: { field: 'nomYieldAsk', label: OPTION_YIELD_DISPLAY_LABELS.nomYieldAsk.short, fullLabel: OPTION_YIELD_DISPLAY_LABELS.nomYieldAsk.full, align: 'text-right', widthClass: 'w-[72px]', hideOnMobile: true, hideOnTablet: true },
    annYieldAsk: { field: 'annYieldAsk', label: OPTION_YIELD_DISPLAY_LABELS.annYieldAsk.short, fullLabel: OPTION_YIELD_DISPLAY_LABELS.annYieldAsk.full, align: 'text-right', widthClass: 'w-[72px]', hideOnMobile: true },
  };
  const baseColumns: OptionTableColumn[] = [
    { field: 'strike', label: 'Strike', fullLabel: 'Strike', align: 'text-left', widthClass: 'w-[88px]' },
    { field: 'lastTradeDate', label: 'Last Trade', fullLabel: 'Last Trade Date', align: 'text-right', widthClass: 'w-20', hideOnMobile: true },
    ...OPTION_QUOTE_TABLE_DISPLAY_ORDER.map(field => quoteColumns[field]),
    { field: 'delta', label: 'Delta', fullLabel: 'Delta', align: 'text-right', widthClass: 'w-12' },
    { field: 'otmItm', label: 'Moneyness', fullLabel: '% OTM / % ITM', align: 'text-right', widthClass: 'w-20', hideOnMobile: true },
    { field: 'iv', label: 'IV', fullLabel: 'IV', align: 'text-right', widthClass: 'w-12', hideOnMobile: true },
    ...OPTION_YIELD_DISPLAY_ORDER.map(field => yieldColumns[field]),
  ];

  const volOIColumns: OptionTableColumn[] = [
    { field: 'volume', label: 'Volume', fullLabel: 'Volume', align: 'text-right', widthClass: 'w-16', hideOnMobile: true },
    { field: 'openInterest', label: 'OI', fullLabel: 'Open Interest', align: 'text-right', widthClass: 'w-16', hideOnMobile: true },
    { field: 'volOI', label: 'Vol/OI', fullLabel: 'Volume / Open Interest', align: 'text-right', widthClass: 'w-14', hideOnMobile: true },
  ];

  const visibleYieldColumns = showNominalYield
    ? baseColumns
    : baseColumns.filter(column => !column.field.startsWith('nomYield'));
  const visibleYieldFields = OPTION_YIELD_DISPLAY_ORDER.filter(field => showNominalYield || !isNominalYieldField(field));
  const columns = showVolOI ? [...visibleYieldColumns, ...volOIColumns] : visibleYieldColumns;
  const colCount = columns.length;
  const hasEmptyOptions = !loading && !!optionsData && (detailAvailability === 'no_options' ||
    optionsData.expirations.length === 0 || optionsData.puts.length === 0
  );
  const selectedExpiration = optionsData?.expirations.find(exp => exp.date === selectedExp) ?? null;
  const chainMeta = optionsData?.chainMeta ?? null;
  const chainAgeMs = chainMeta ? Date.now() - chainMeta.fetchedAt : null;
  const staleCachedChain = chainMeta?.source === 'stale' || (chainMeta?.source === 'cache' && chainAgeMs != null && chainAgeMs > 10 * 60 * 1000);
  const freshnessLabel = chainMeta?.staleFallbackUsed
    ? 'Refresh failed - showing cached data'
    : staleCachedChain
    ? 'Cached - refresh for latest'
    : chainMeta?.source === 'fresh'
      ? 'Fresh'
      : chainMeta?.source === 'cache'
        ? 'Cached'
        : chainMeta?.source === 'network'
          ? 'Updated'
          : null;
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
    if (staleCachedChain && debugOptionsEnabled) {
      warnings.push('This chain is from local cache and is older than 10 minutes. Click Refresh for a fresh Yahoo chain.');
    }
    if (chainMeta.staleFallbackUsed) {
      warnings.push('Yahoo refresh failed. The last usable cached chain is still displayed.');
    }
    if (
      chainMeta.source === 'fresh' &&
      chainMeta.previousCachedPutCount != null &&
      chainMeta.previousCachedPutCount !== chainMeta.putCount
    ) {
      warnings.push(`Fresh refresh updated put strike count from ${chainMeta.previousCachedPutCount} to ${chainMeta.putCount}.`);
    }
    if (
      chainMeta.requestedExpiration != null &&
      chainMeta.returnedExpiration != null &&
      chainMeta.requestedExpiration !== chainMeta.returnedExpiration
    ) {
      warnings.push(`Requested expiration ${chainMeta.requestedExpiration} but Yahoo returned ${chainMeta.returnedExpiration}.`);
    }
    chainMeta.validationWarnings?.forEach(warning => warnings.push(warning));
    return warnings;
  }, [chainMeta, debugOptionsEnabled, staleCachedChain]);
  const chainDebug = useMemo(() => ({
    ticker: chainMeta?.ticker ?? ticker ?? null,
    selectedExpirationLabel: selectedExpiration?.label ?? null,
    selectedExpirationDate: selectedExp,
    requestedExpiration: chainMeta?.requestedExpiration ?? null,
    returnedExpiration: chainMeta?.returnedExpiration ?? null,
    expirationDate: chainMeta?.expirationDate ?? null,
    cacheKey: chainMeta?.cacheKey ?? null,
    fetchedAt: chainMeta?.fetchedAt ? new Date(chainMeta.fetchedAt).toISOString() : null,
    source: chainMeta?.source ?? null,
    fresh: chainMeta?.fresh ?? false,
    currentPrice,
    putCount: chainMeta?.putCount ?? optionsData?.puts.length ?? 0,
    displayedRowCount: enrichedPuts.length,
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
    previousCachedPutCount: chainMeta?.previousCachedPutCount ?? null,
    warnings: chainWarnings,
    displayedRows: enrichedPuts.map(put => ({
      strike: put.strike,
      contractSymbol: put.contractSymbol ?? null,
      last: put.last,
      bid: put.bid,
      ask: put.ask,
      delta: put.delta,
      impliedVolatility: put.impliedVolatility,
      volume: put.volume,
      openInterest: put.openInterest,
      lastTradeDate: put.lastTradeDate,
      rawLastPrice: put.rawLastPrice ?? null,
      rawBid: put.rawBid ?? null,
      rawAsk: put.rawAsk ?? null,
      rawImpliedVolatility: put.rawImpliedVolatility ?? null,
      rawVolume: put.rawVolume ?? null,
      rawOpenInterest: put.rawOpenInterest ?? null,
      rawLastTradeDate: put.rawLastTradeDate ?? null,
    })),
    validationWarnings: chainMeta?.validationWarnings ?? [],
  }), [chainMeta, chainWarnings, currentPrice, enrichedPuts, optionsData, selectedExp, selectedExpiration, ticker]);

  const copyChainDiagnostics = useCallback(() => {
    const text = JSON.stringify(chainDebug, null, 2);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }, [chainDebug]);

  const handleRefresh = useCallback(() => {
    inFlightFetchKeyRef.current = '';
    if (selectedExp) loadExpiration(selectedExp, true, true);
    else loadData(true, true);
  }, [loadData, loadExpiration, selectedExp]);

  const handleBackToScanner = useCallback(() => {
    if (isScannerNavigationState(location.state) && window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(getLastScannerUrl(), { replace: true });
  }, [location.state, navigate]);

  const mobileSortOptions: Array<{ field: SortField; label: string }> = [
    { field: 'strike', label: 'Strike' },
    ...OPTION_QUOTE_TABLE_DISPLAY_ORDER.map(field => ({ field, label: OPTION_QUOTE_DISPLAY_LABELS[field] })),
    { field: 'delta', label: 'Delta' },
    { field: 'annYieldBid', label: 'Ann. SCY Bid' },
    { field: 'iv', label: 'IV' },
    { field: 'otmItm', label: 'Moneyness' },
  ];

  // Sparkline data
  const sparklineData = extendedPrice?.sparkline ?? [];
  const sparklineColor = changePositive ? 'var(--green)' : 'var(--red)';

  if (!ticker || !instrument) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="max-w-md px-6 text-center">
          <h1 className="mb-2 text-lg font-semibold" style={{ color: 'var(--text)' }}>Invalid ticker</h1>
          <p className="mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>{routeNormalization.error ?? 'Enter a valid ticker symbol.'}</p>
          <Link to="/" className="inline-block px-4 py-2 text-white rounded-lg text-sm" style={{ backgroundColor: 'var(--accent)' }}>Back to Scanner</Link>
        </div>
      </div>
    );
  }

  if (isPhone) {
    const addSelectedToPortfolio = (draft: AddToPortfolioDraft) => {
      if (!ticker || !selectedExpiration) return;
      const now = new Date();
      const expiration = new Date(selectedExpiration.date * 1000).toISOString().split('T')[0];
      const soldDate = usMarketDateIso(now);
      const entryDeltaCapture = optionsData ? entryDeltaFromExactChain({ ticker, strike: draft.option.strike, expiration, soldDate, status: 'open' }, optionsData, now).capture : undefined;
      addPortfolioTrade({
        ticker,
        optionType: 'put',
        strike: draft.option.strike,
        expiration,
        contracts: draft.contracts,
        soldPrice: draft.soldPrice,
        soldDate,
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
        ...entryDeltaCapture,
      });
      setSelectedOption(null);
    };
    const mobileStaleText = (value: number | null | undefined) => {
      const freshness = getOptionLastTradeFreshness(value);
      return freshness.freshness === 'stale' || freshness.freshness === 'very_stale'
        ? `Last ${freshness.ageDays}d ago`
        : null;
    };

    return (
      <div className="mobile-route-page min-h-[100dvh]" style={{ backgroundColor: 'var(--bg)' }}>
        <header className="mobile-option-header sticky top-0 z-40" style={{ backgroundColor: 'color-mix(in srgb, var(--bg) 95%, transparent)', borderBottom: '1px solid var(--border)' }}>
          <div className="grid min-h-[58px] grid-cols-[78px_minmax(0,1fr)_132px] items-center px-1.5">
            <button type="button" onClick={handleBackToScanner} className="pressable flex min-h-11 items-center gap-0.5 rounded-lg px-1 text-[13px] font-semibold" style={{ color: 'var(--accent-light)' }} aria-label="Back to Scanner"><ArrowLeft className="h-5 w-5" /> Scanner</button>
            <button type="button" onClick={() => setShowPriceChart(true)} className="pressable min-w-0 text-center" aria-label={`Open ${ticker} price chart`}>
              <div className="truncate font-mono text-[17px] font-bold" style={{ color: 'var(--text)' }}>{ticker}</div>
              <div className="flex items-baseline justify-center gap-1.5 font-mono text-[12px]"><span style={{ color: 'var(--text)' }}>{currentPrice > 0 ? `$${currentPrice.toFixed(2)}` : '—'}</span>{extendedPrice && <span style={{ color: changePositive ? 'var(--green)' : 'var(--red)' }}>{extendedPrice.changePercent >= 0 ? '+' : ''}{extendedPrice.changePercent.toFixed(2)}%</span>}</div>
            </button>
            <div className="flex justify-end">
              {instrument.showHoldings && <button type="button" onClick={() => setShowUnderlyingHoldings(true)} className="pressable flex h-11 w-11 items-center justify-center rounded-lg" aria-label={`Open underlying holdings for ${ticker}`} style={{ color: 'var(--text-muted)' }}><Layers className="h-5 w-5" /></button>}
              <button type="button" onClick={handleRefresh} disabled={loading} className="pressable flex h-11 w-11 items-center justify-center rounded-lg disabled:opacity-50" aria-label="Refresh option chain" style={{ color: 'var(--text-muted)' }}><RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /></button>
              <AccountControl />
            </div>
          </div>
          {optionsData && optionsData.expirations.length > 0 && (
            <div className="mobile-scroll-row flex gap-1.5 overflow-x-auto px-3 pb-2">
              {optionsData.expirations.map(expiration => <button type="button" key={expiration.date} onClick={() => loadExpiration(expiration.date)} className="pressable min-h-11 flex-none rounded-lg px-3 text-[12px] font-semibold" aria-pressed={selectedExp === expiration.date} style={{ backgroundColor: selectedExp === expiration.date ? 'var(--accent)' : 'var(--surface)', color: selectedExp === expiration.date ? 'white' : 'var(--text-muted)', border: `1px solid ${selectedExp === expiration.date ? 'var(--accent)' : 'var(--border)'}` }}>{expiration.label} · {expiration.dte}D</button>)}
            </div>
          )}
        </header>

        <div className="flex min-h-[46px] items-center gap-2 border-b px-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <span className="mr-auto text-[13px] font-semibold" style={{ color: 'var(--text)' }}>Puts <span className="font-mono font-normal" style={{ color: 'var(--text-muted)' }}>{sortedPuts.length}</span></span>
          <label className="flex min-h-11 items-center gap-1 text-[10px] font-semibold" style={{ color: 'var(--text-muted)' }}><input type="checkbox" checked={showNominalYield} onChange={event => handleShowNominalYieldChange(event.target.checked)} className="rounded" /> SCY</label>
          <select value={sortField} onChange={event => setSortField(event.target.value as SortField)} className="min-h-11 rounded-lg px-2 text-[12px] outline-none" aria-label="Sort option chain" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>{mobileSortOptions.map(option => <option key={option.field} value={option.field}>{option.label}</option>)}</select>
          <button type="button" onClick={() => setSortDir(current => current === 'asc' ? 'desc' : 'asc')} className="pressable flex h-11 min-w-11 items-center justify-center rounded-lg text-[11px] font-semibold" aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`} style={{ color: 'var(--accent-light)' }}>{sortDir === 'asc' ? '↑' : '↓'}</button>
        </div>

        {freshnessLabel && <div className="border-b px-3 py-1 text-[10px]" style={{ borderColor: 'var(--border)', color: staleCachedChain ? 'var(--yellow)' : 'var(--text-dim)' }}>{freshnessLabel}</div>}
        {instrument.showLeveragedProductWarning && <div className="border-b px-3 py-2 text-[11px] leading-4" style={{ borderColor: 'var(--border)', color: 'var(--yellow)', backgroundColor: 'var(--surface)' }}>Leveraged ETF · daily reset and compounding make longer-period returns path dependent.</div>}

        {error ? <OptionsEmptyState type="error" onRefresh={handleRefresh} loading={loading} title={detailErrorCode === 'INVALID_SYMBOL' ? `We couldn't find ${ticker}.` : `We couldn't load options for ${ticker}.`} subtitle={detailErrorCode === 'INVALID_SYMBOL' ? 'Check the ticker and try again.' : 'Market data may be temporarily unavailable. Try again without changing or saving anything.'} /> : hasEmptyOptions ? <OptionsEmptyState type="empty" onRefresh={handleRefresh} loading={loading} title={`No listed puts found for ${ticker}`} subtitle="This ticker may not have listed options, or its option chain may currently be unavailable." /> : (
          <div className="mobile-financial-list">
            {loading && enrichedPuts.length === 0 ? Array.from({ length: 6 }).map((_, index) => <div key={index} className="mobile-option-row animate-pulse"><div className="h-4 w-24 rounded" style={{ backgroundColor: 'var(--border)' }} /><div className="mt-4 h-8 w-full rounded" style={{ backgroundColor: 'var(--border)' }} /><div className="mt-3 h-3 w-4/5 rounded" style={{ backgroundColor: 'var(--border)' }} /></div>) : sortedPuts.map(put => {
              const expirationIso = selectedExp ? new Date(selectedExp * 1000).toISOString().split('T')[0] : '';
              const watchlistId = makeWatchlistId(ticker ?? '', expirationIso, put.strike);
              return <MobileOptionRow key={put.strike} strike={put.strike} bid={put.bid} ask={put.ask} mid={getMidPrice(put.bid, put.ask)} last={put.last} annualYield={put.annYieldBid} nominalYield={put.nomYieldBid} showNominalYield={showNominalYield} delta={put.delta} impliedVolatility={put.impliedVolatility} openInterest={put.openInterest} moneynessLabel={put.otmItmLabel} moneynessColor={put.otmItmColor} staleText={mobileStaleText(put.lastTradeDate)} watched={watchlistIds.has(watchlistId)} onToggleWatchlist={() => toggleWatchlist(put)} onSelect={() => setSelectedOption(put)} />;
            })}
          </div>
        )}

        {selectedOption && <ErrorBoundary title="Option sheet unavailable" message="Close it and try again."><Suspense fallback={null}><OptionDetailDrawer option={selectedOption} ticker={ticker ?? ''} expirationLabel={selectedExpiration?.label ?? ''} dte={selectedExpiration?.dte ?? null} underlyingPrice={currentPrice > 0 ? currentPrice : null} onAddToPortfolio={addSelectedToPortfolio} onClose={() => setSelectedOption(null)} /></Suspense></ErrorBoundary>}
        {instrument.showHoldings && showUnderlyingHoldings && <ErrorBoundary title="Underlying holdings unavailable" message="Close it and try again."><Suspense fallback={null}><UnderlyingHoldingsModal proxy={holdingsProxy} onClose={() => setShowUnderlyingHoldings(false)} /></Suspense></ErrorBoundary>}
        {showPriceChart && <ErrorBoundary title="Chart unavailable" message="Close it and try again."><Suspense fallback={null}><InteractivePriceChartModal isOpen ticker={ticker ?? ''} displayTicker={ticker ?? ''} showLeverageContext={instrument.showLeverage} onClose={() => setShowPriceChart(false)} /></Suspense></ErrorBoundary>}
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="option-page-shell page-frame" style={{ '--page-max': '1480px' } as React.CSSProperties}>
        {/* Header */}
        <div className="option-page-title-row detail-identity-header flex items-center gap-2 sm:gap-4 mb-4 sm:mb-6 min-w-0">
          <button
            type="button"
            onClick={handleBackToScanner}
            aria-label="Back to Scanner"
            className="icon-button p-2 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center"
            style={{ color: 'var(--text-muted)' }}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold font-mono" style={{ color: 'var(--text)' }}>{instrument.ticker}</h1>
              <span className="text-xs sm:text-sm truncate" style={{ color: 'var(--text-muted)' }}>{instrument.name}</span>
              <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>{instrument.leveraged ? `${instrument.leverageMultiple ?? ''}x leveraged ETF` : instrument.assetType === 'etf' ? 'ETF' : instrument.assetType === 'stock' ? 'Stock' : 'Ticker'}</span>
            </div>
            {instrument.showLeveragedProductWarning && <p className="detail-identity-header__notice mt-1 text-[11px]" style={{ color: 'var(--yellow)' }}>Daily reset and compounding make longer-period returns path dependent.</p>}
          </div>
        </div>

        {/* Price bar */}
        <div
          data-layout="price-header"
          className="option-price-header detail-metric-rail surface-card sticky-stack mobile-static-sticky z-30 p-3 sm:p-4 mb-3 sm:mb-5"
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

            {/* ATM implied volatility versus the trailing realized-volatility range. */}
            {volatilityContext && volatilityContext.rangePosition != null && (
              <div className="flex-shrink-0">
                <div
                  className="px-3 py-1.5 rounded-lg text-center"
                  style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}
                  title={`Current ATM put IV (${volatilityContext.currentIV?.toFixed(1) ?? '—'}%) positioned within the trailing 1-year range of 4-week realized volatility (${volatilityContext.realizedVolLow?.toFixed(1) ?? '—'}%–${volatilityContext.realizedVolHigh?.toFixed(1) ?? '—'}%). This is not traditional historical IV Rank.`}
                >
                  <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>IV vs 1Y Realized Range</div>
                  <div className="text-sm font-mono font-bold" style={{ color: ivVsRealizedRangeColor(volatilityContext.rangePosition) }}>
                    {volatilityContext.rangePosition.toFixed(0)}%
                  </div>
                </div>
              </div>
            )}

            {instrument.showHoldings && <button
              type="button"
              onClick={() => setShowUnderlyingHoldings(true)}
              className="pressable min-h-[44px] flex-shrink-0 rounded-lg px-3 py-1.5 text-center transition-all hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-indigo-500/60"
              style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}
              title={holdingsProxy.meaningful && holdingsProxy.proxyTicker
                ? `${holdingsProxy.proxyTicker} holdings used as the underlying exposure proxy for ${holdingsProxy.sourceTicker}.`
                : holdingsProxy.reason}
              aria-label={`Open underlying holdings for ${holdingsProxy.sourceTicker}`}
            >
              <div className="flex items-center justify-center gap-1 text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>
                <Layers className="h-3 w-3" />
                Holdings
              </div>
              <div className="text-sm font-mono font-bold" style={{ color: holdingsProxy.meaningful ? 'var(--accent-light)' : 'var(--text-dim)' }}>
                {holdingsProxy.meaningful && holdingsProxy.proxyTicker ? holdingsProxy.proxyTicker : 'N/A'}
              </div>
            </button>}

            {/* Right side: last updated + refresh + vol/OI toggle */}
            <div data-mobile-controls className="flex w-full flex-wrap items-center gap-2 text-xs sm:ml-auto sm:w-auto sm:gap-3 min-w-0" style={{ color: 'var(--text-muted)' }}>
              <label className="flex items-center gap-1.5 text-xs cursor-pointer min-h-[44px] sm:min-h-0" style={{ color: 'var(--text-muted)' }}>
                <input
                  type="checkbox"
                  checked={showNominalYield}
                  onChange={event => handleShowNominalYieldChange(event.target.checked)}
                  className="rounded"
                />
                Show Secured-Cash Yield
              </label>
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
              {freshnessLabel && (
                <span className="text-[11px]" style={{ color: staleCachedChain ? 'var(--yellow)' : 'var(--text-dim)' }}>
                  {freshnessLabel}
                </span>
              )}
              <button
                onClick={handleRefresh}
                disabled={loading}
                className="pressable ml-auto sm:ml-0 flex items-center gap-1.5 px-3 py-2 sm:py-2 rounded-lg disabled:opacity-50 transition-all min-h-[44px] sm:min-h-0"
                style={{ backgroundColor: 'var(--border)', color: 'var(--text)' }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                <span className="sm:inline">Refresh</span>
              </button>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-[1.2fr_repeat(4,1fr)] gap-1.5 sm:hidden">
            <button
              type="button"
              onClick={() => setShowPriceChart(true)}
              className="pressable min-h-[44px] rounded-lg px-2 text-left"
              style={{ backgroundColor: 'var(--accent-bg)', border: '1px solid var(--accent-border)', color: 'var(--accent-light)' }}
            >
              <span className="block text-[9px] font-semibold uppercase tracking-wider">Price</span>
              <span className="block text-xs font-bold">Open chart</span>
            </button>
            {extendedPrice ? (
              <>
                <PerfCell label="5D" value={extendedPrice.fiveDay} />
                <PerfCell label="1M" value={extendedPrice.oneMonth} />
                <PerfCell label="3M" value={extendedPrice.threeMonth} />
                <FiftyTwoWeekCell value={extendedPrice.fiftyTwoWeekHighPct} />
              </>
            ) : (
              <>
                <PerfCell label="5D" value={null} />
                <PerfCell label="1M" value={null} />
                <PerfCell label="3M" value={null} />
                <FiftyTwoWeekCell value={null} />
              </>
            )}
          </div>
        </div>

        {/* Expiration selector */}
        {optionsData && optionsData.expirations.length > 0 && (
          <div
            data-layout="expiry-row"
            className="option-expiry-row detail-expiry-bar mobile-scroll-row sticky-stack mobile-static-sticky touch-scroll z-20 flex gap-2 mb-3 sm:mb-5 overflow-x-auto pt-2 pb-2 -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap"
            style={{
              top: EXPIRY_ROW_TOP,
              zIndex: 20,
              backgroundColor: 'var(--bg)',
              boxShadow: '0 1px 0 var(--border)',
            }}
          >
            {optionsData.expirations.map(exp => (
              <button
                type="button"
                key={exp.date}
                onClick={() => loadExpiration(exp.date)}
                aria-pressed={selectedExp === exp.date}
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

        {debugOptionsEnabled && chainMeta && (
          <div
            className="mb-3 rounded-lg px-3 py-2 text-xs"
            style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}
          >
            <details>
              <summary className="cursor-pointer select-none" style={{ color: 'var(--text-dim)' }}>
                Option chain diagnostics
              </summary>
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                <span>Source: {chainMeta.source}</span>
                <span>Fetched: {new Date(chainMeta.fetchedAt).toLocaleTimeString()}</span>
                <span>Puts: {chainMeta.putCount}</span>
                <span>Calls: {chainMeta.callCount ?? '—'}</span>
                <span>Req exp: {chainMeta.requestedExpiration ?? 'initial'}</span>
                <span>Returned exp: {chainMeta.returnedExpiration ?? '—'}</span>
              </div>
              {chainWarnings.length > 0 && (
                <div className="mt-2 flex flex-col gap-0.5" style={{ color: 'var(--yellow)' }}>
                  {chainWarnings.map(warning => (
                    <span key={warning}>{warning}</span>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={copyChainDiagnostics}
                className="mt-2 rounded-lg px-3 py-1.5 text-xs font-medium"
                style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}
              >
                Copy diagnostics JSON
              </button>
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
          <OptionsEmptyState type="error" onRefresh={handleRefresh} loading={loading} title={detailErrorCode === 'INVALID_SYMBOL' ? `We couldn't find ${ticker}.` : `We couldn't load options for ${ticker}.`} subtitle={detailErrorCode === 'INVALID_SYMBOL' ? 'Check the ticker and try again, or return to Scanner.' : 'Market data may be temporarily unavailable. Try again without changing or saving anything.'} />
        ) : hasEmptyOptions ? (
          <OptionsEmptyState
            type="empty"
            onRefresh={handleRefresh}
            loading={loading}
            title={`No listed puts found for ${ticker}`}
            subtitle={detailAvailability === 'no_options'
              ? 'This ticker may not have listed options, or its option chain may currently be unavailable.'
              : (chainMeta?.callCount ?? 0) > 0
              ? 'Yahoo returned calls but no puts for this expiration. Compare the app only against Yahoo’s Puts tab.'
              : 'Yahoo returned no put contracts for this expiration. Try Refresh or verify the selected expiration on Yahoo’s Puts tab.'}
          />
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
                      showNominalYield={showNominalYield}
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

          <div className="option-desktop-chain option-chain-surface rounded-xl max-w-full overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="option-chain-header">
              <div>
                <div className="option-chain-header__title">Put chain</div>
                <div className="option-chain-header__meta">{sortedPuts.length} contracts · {selectedExpiration?.label ?? 'Selected expiry'} · click a row to inspect</div>
              </div>
              {freshnessLabel && <span className="status-badge" data-status={staleCachedChain ? 'failed' : 'fresh'}>{freshnessLabel}</span>}
            </div>
            <div className="max-h-[calc(100dvh-230px)] min-h-[260px] max-w-full overflow-auto overscroll-contain sm:max-h-[calc(100dvh-250px)]">
              <table className="financial-table min-w-[520px] md:min-w-[980px] lg:min-w-[1180px] xl:min-w-0 w-full table-fixed text-xs">
                <thead
                  style={{
                    backgroundColor: 'var(--surface)',
                  }}
                >
                  <tr style={{ backgroundColor: 'var(--surface)' }}>
                    <th
                      className="sticky-stack top-0 z-30 px-1.5 sm:px-2 py-1.5 w-6 text-[10px] sm:text-[11px]"
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
                        className={`sticky-stack top-0 px-1.5 sm:px-2 py-1.5 text-[10px] sm:text-[11px] uppercase tracking-wider font-medium cursor-pointer transition-colors select-none whitespace-nowrap ${col.align} ${col.widthClass} ${
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
                      const quickExpirationLabel = expForId?.label ?? selectedExpiration?.label ?? '';
                      const quickDte = expForId?.dte ?? selectedExpiration?.dte ?? null;
                      const wlId = makeWatchlistId(ticker ?? '', expiryIso, put.strike);
                      const isWatched = watchlistIds.has(wlId);
                      const isSelected = selectedOption?.strike === put.strike;
                      const rowBackground = isSelected ? 'var(--accent-bg)' : altBg;

                      rows.push(
                        <tr
                          key={put.strike}
                          onClick={() => setSelectedOption(put)}
                          className="group transition-colors cursor-pointer"
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
                          <td className="sticky-stack left-0 z-[2] px-1.5 sm:px-2 py-1.5 text-left text-xs whitespace-nowrap border-r w-[88px] relative" style={{ borderColor: 'var(--border)', backgroundColor: isSelected ? 'var(--accent-bg)' : bg }}>
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
                            <OptionQuickTooltip put={put} ticker={ticker ?? ''} expirationLabel={quickExpirationLabel} dte={quickDte} />
                          </td>
                          <td className="w-20 px-1.5 py-1.5 text-right font-mono text-xs tabular-nums hidden md:table-cell" title={`${formatLastTradeDate(put.lastTradeDate)}${getOptionLastTradeFreshness(put.lastTradeDate).label ? ` · ${getOptionLastTradeFreshness(put.lastTradeDate).label}` : ''}`} style={{ color: getOptionLastTradeFreshness(put.lastTradeDate).color }}>{formatOptionLastTradeDate(put.lastTradeDate)}</td>
                          {OPTION_QUOTE_TABLE_DISPLAY_ORDER.map(field => <td key={field} className={`px-2 py-1.5 text-right text-xs font-mono tabular-nums w-14 ${field === 'last' ? 'hidden md:table-cell' : ''}`} style={{ color: 'var(--text)' }}>{formatPrice(put[field])}</td>)}
                          <td className="px-1.5 py-1.5 text-right text-xs font-mono tabular-nums w-12" style={{ color: deltaColor(put.delta) }}>
                            {put.delta != null ? put.delta.toFixed(2) : '—'}
                          </td>
                          <td className="px-1.5 py-1.5 text-right text-xs font-mono tabular-nums hidden md:table-cell w-20" style={{ color: put.otmItmColor }}>
                            {put.otmItmLabel || '—'}
                          </td>
                          <td className="px-1.5 py-1.5 text-right text-xs font-mono tabular-nums hidden md:table-cell w-12" style={{ color: ivColor(put.impliedVolatility) }}>
                            {put.impliedVolatility != null ? put.impliedVolatility.toFixed(1) + '%' : '—'}
                          </td>
                          {visibleYieldFields.map(field => {
                            const value = put[field];
                            const column = yieldColumns[field];
                            const nominal = isNominalYieldField(field);
                            return <td key={field} className={`${column.widthClass} px-1.5 py-1.5 text-right text-xs font-mono tabular-nums ${nominal ? '' : 'font-medium'} ${column.hideOnMobile ? 'hidden md:table-cell' : ''} ${column.hideOnTablet ? 'hidden lg:table-cell' : ''}`} style={{ color: nominal ? 'var(--text-secondary)' : value != null ? yieldColor(value) : 'var(--text-dim)' }}>{value != null ? formatYield(value) : '—'}</td>;
                          })}
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
                const now = new Date();
                const expiration = new Date(selectedExpiration.date * 1000).toISOString().split('T')[0];
                const soldDate = usMarketDateIso(now);
                const entryDeltaCapture = optionsData ? entryDeltaFromExactChain({ ticker, strike: draft.option.strike, expiration, soldDate, status: 'open' }, optionsData, now).capture : undefined;
                addPortfolioTrade({
                  ticker,
                  optionType: 'put',
                  strike: draft.option.strike,
                  expiration,
                  contracts: draft.contracts,
                  soldPrice: draft.soldPrice,
                  soldDate,
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
                  ...entryDeltaCapture,
                });
                setSelectedOption(null);
              }}
              onClose={() => setSelectedOption(null)}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {instrument.showHoldings && showUnderlyingHoldings && (
        <ErrorBoundary title="Underlying holdings unavailable" message="The holdings popup could not render. Close it and try again.">
          <Suspense fallback={null}>
            <UnderlyingHoldingsModal
              proxy={holdingsProxy}
              onClose={() => setShowUnderlyingHoldings(false)}
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
              showLeverageContext={instrument.showLeverage}
              onClose={() => setShowPriceChart(false)}
            />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}

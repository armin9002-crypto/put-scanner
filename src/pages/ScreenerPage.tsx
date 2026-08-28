import { lazy, Suspense, useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ETF_LIST } from '../lib/etfs';
import type { ETFInfo } from '../lib/types';
import { fetchSparkline, formatPrice, formatNumber } from '../lib/api';
import type { SparklineData } from '../lib/api';
import { getExpirationsCache, setExpirationsCache } from '../lib/cache';
import { createLatestScreenerScanGate, fetchScreenerExpirations, retryFailedScreenerBatches, runScreenerBatchScan, type ScreenerScanResult } from '../lib/screenerAcquisition';
import { applyScreenerFilters, buildScreenerRows, type ScreenerRow } from '../lib/screenerRows';
import SparklineChart from '../components/SparklineChart';
import ExpirationFilter, { buildExpirationOptions, formatExpirationDropdownLabel } from '../components/ExpirationFilter';
import ErrorBoundary from '../components/ErrorBoundary';
import type { OptionDetail } from '../components/OptionDetailDrawer';
import { Search, X, ChevronUp, ChevronDown, Loader2, AlertTriangle, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useResponsiveMode } from '../lib/responsive';
import MobileBottomSheet from '../components/mobile/MobileBottomSheet';
import MobileOptionRow from '../components/mobile/MobileOptionRow';
import { OPTION_QUOTE_TABLE_DISPLAY_ORDER, OPTION_YIELD_DISPLAY_LABELS, OPTION_YIELD_DISPLAY_ORDER, isNominalYieldField, type OptionQuoteTableDisplayField, type OptionYieldDisplayField } from '../lib/optionQuoteDisplay';
import { compareNullableValue } from '../lib/metricValue';
import { PageHeader } from '../components/ui/PageHeader';

const OptionDetailDrawer = lazy(() => import('../components/OptionDetailDrawer'));

type ScreenerSortField = 'ticker' | 'price' | 'expDate' | 'strike' | 'moneyness' | 'delta' | 'bid' | 'last' | 'ask' | 'iv' | 'nomYieldBid' | 'nomYieldAsk' | 'nomYieldLast' | 'annYieldBid' | 'annYieldAsk' | 'annYieldLast' | 'volume' | 'openInterest' | 'volOI' | 'ivVsRealizedRange';
type SortDir = 'asc' | 'desc';

interface ScreenerCriteria {
  selectedETFs: ETFInfo[];
  expFilter: string;
  deltaFilter: string;
  moneynessFilter: string;
  yieldFilter: string;
  oiFilter: string;
  volFilter: string;
  ivVsRealizedRangeFilter: string;
}

interface DrawerSelection {
  option: OptionDetail;
  ticker: string;
  expirationLabel: string;
  dte: number | null;
  underlyingPrice: number | null;
}

// --- Filter options ---

const DELTA_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'below_0.05', label: 'Below 0.05' },
  { value: 'below_0.10', label: 'Below 0.10' },
  { value: 'below_0.15', label: 'Below 0.15' },
  { value: 'below_0.20', label: 'Below 0.20' },
  { value: 'below_0.25', label: 'Below 0.25' },
  { value: 'below_0.30', label: 'Below 0.30' },
  { value: 'below_0.40', label: 'Below 0.40' },
  { value: 'delta_0.05_to_0.10', label: '0.05 to 0.10' },
  { value: '0.05_to_0.15', label: '0.05 to 0.15' },
  { value: '0.10_to_0.20', label: '0.10 to 0.20' },
  { value: '0.15_to_0.25', label: '0.15 to 0.25' },
  { value: '0.20_to_0.30', label: '0.20 to 0.30' },
  { value: '0.30_to_0.50', label: '0.30 to 0.50' },
  { value: 'above_0.50', label: 'Above 0.50' },
];

const MONEYNESS_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'otm_only', label: 'OTM Only' },
  { value: 'itm_only', label: 'ITM Only' },
  { value: '5+_otm', label: '5%+ OTM' },
  { value: '10+_otm', label: '10%+ OTM' },
  { value: '15+_otm', label: '15%+ OTM' },
  { value: '20+_otm', label: '20%+ OTM' },
  { value: '25+_otm', label: '25%+ OTM' },
  { value: '30+_otm', label: '30%+ OTM' },
  { value: '40+_otm', label: '40%+ OTM' },
  { value: '50+_otm', label: '50%+ OTM' },
  { value: '60+_otm', label: '60%+ OTM' },
  { value: '0-10_otm', label: '0-10% OTM' },
  { value: '10-20_otm', label: '10-20% OTM' },
  { value: '20-30_otm', label: '20-30% OTM' },
  { value: '30-40_otm', label: '30-40% OTM' },
  { value: '40-50_otm', label: '40-50% OTM' },
  { value: '50-60_otm', label: '50-60% OTM' },
  { value: 'any_itm', label: 'Any ITM' },
  { value: '0-10_itm', label: '0-10% ITM' },
  { value: '10+_itm', label: '10%+ ITM' },
];

const YIELD_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '>5', label: '>5%' },
  { value: '5_to_10', label: '5-10%' },
  { value: '5_to_15', label: '5-15%' },
  { value: '>10', label: '>10%' },
  { value: '10_to_15', label: '10-15%' },
  { value: '10_to_20', label: '10-20%' },
  { value: '>15', label: '>15%' },
  { value: '15_to_20', label: '15-20%' },
  { value: '>20', label: '>20%' },
  { value: '>30', label: '>30%' },
  { value: '>50', label: '>50%' },
  { value: '>75', label: '>75%' },
  { value: '>100', label: '>100%' },
];

const OI_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '>10', label: '>10' },
  { value: '>25', label: '>25' },
  { value: '>50', label: '>50' },
  { value: '>100', label: '>100' },
  { value: '>250', label: '>250' },
  { value: '>500', label: '>500' },
];

const VOL_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '>0', label: '>0 (has volume)' },
  { value: '>10', label: '>10' },
  { value: '>25', label: '>25' },
  { value: '>50', label: '>50' },
  { value: '>100', label: '>100' },
];

const IV_VS_REALIZED_RANGE_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'below_20', label: 'Below 20%' },
  { value: 'below_40', label: 'Below 40%' },
  { value: 'below_60', label: 'Below 60%' },
  { value: 'above_50', label: 'Above 50%' },
  { value: 'above_70', label: 'Above 70%' },
  { value: 'above_80', label: 'Above 80%' },
  { value: 'above_90', label: 'Above 90%' },
  { value: '20_to_50', label: '20% to 50%' },
  { value: '50_to_80', label: '50% to 80%' },
];

// --- Helpers ---

function optionDetailFromScreenerRow(row: ScreenerRow): OptionDetail {
  return {
    strike: row.strike,
    last: row.last,
    lastTradeDate: row.lastTradeDate,
    bid: row.bid,
    ask: row.ask,
    delta: row.delta,
    impliedVolatility: row.iv,
    volume: row.volume,
    openInterest: row.openInterest,
    volOI: row.volOI,
    nomYieldBid: row.nomYieldBid,
    annYieldBid: row.annYieldBid,
    nomYieldAsk: row.nomYieldAsk,
    annYieldAsk: row.annYieldAsk,
    nomYieldLast: row.nomYieldLast,
    annYieldLast: row.annYieldLast,
    otmItmPct: row.moneynessPct,
    otmItmLabel: row.moneynessLabel,
    otmItmColor: row.moneynessColor,
  };
}

function selectedEtfKey(etfs: ETFInfo[]): string {
  if (etfs.length === 0 || etfs.length === ETF_LIST.length) return '__ALL__';
  return etfs.map(etf => etf.ticker).sort().join('|');
}

function optionLabel(options: { value: string; label: string }[], value: string): string {
  return options.find(option => option.value === value)?.label ?? value;
}

function deltaColor(d: number | null): string {
  if (d == null || !Number.isFinite(d)) return 'var(--text-dim)';
  const abs = Math.abs(d);
  if (abs >= 0.7) return '#dc2626';
  if (abs >= 0.5) return '#ef4444';
  if (abs >= 0.3) return '#f97316';
  if (abs >= 0.15) return '#eab308';
  return 'var(--text-muted)';
}

function annYieldColor(y: number | null): string {
  if (y == null) return 'var(--text-dim)';
  if (y > 50) return 'var(--green)';
  if (y >= 25) return 'var(--orange)';
  if (y >= 10) return 'var(--yellow)';
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

// --- Component ---

export default function ScreenerPage() {
  const { isPhone } = useResponsiveMode();

  // Filters — default expiry to ≤30 DTE (Opt 3)
  const [selectedETFs, setSelectedETFs] = useState<ETFInfo[]>([]);
  const [etfSearch, setEtfSearch] = useState('');
  const [showEtfDropdown, setShowEtfDropdown] = useState(false);
  const [expFilter, setExpFilter] = useState('lte_30dte');
  const [availableExps, setAvailableExps] = useState<{ date: number; label: string; dte: number }[]>([]);
  const [datesLoaded, setDatesLoaded] = useState(false);
  const [loadingDates, setLoadingDates] = useState(false);
  const [deltaFilter, setDeltaFilter] = useState('all');
  const [moneynessFilter, setMoneynessFilter] = useState('all');
  const [yieldFilter, setYieldFilter] = useState('all');
  const [oiFilter, setOiFilter] = useState('all');
  const [volFilter, setVolFilter] = useState('all');
  const [ivVsRealizedRangeFilter, setIvVsRealizedRangeFilter] = useState('all');
  const [showVolOI, setShowVolOI] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);

  // Data state
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [lastLoadedCriteria, setLastLoadedCriteria] = useState<ScreenerCriteria | null>(null);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [slowWarning, setSlowWarning] = useState(false);
  const [scanFailureCount, setScanFailureCount] = useState(0);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryState, setRetryState] = useState<{ criteria: ScreenerCriteria; acquired: ScreenerScanResult } | null>(null);
  const [selectedOption, setSelectedOption] = useState<DrawerSelection | null>(null);

  // Confirmation dialog
  const [showConfirm, setShowConfirm] = useState(false);

  // Sort
  const [sortField, setSortField] = useState<ScreenerSortField>('annYieldBid');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Raw rows support network-free changes to non-structural filters.
  const rawRowsRef = useRef<ScreenerRow[]>([]);
  const scanGateRef = useRef(createLatestScreenerScanGate());

  useEffect(() => () => scanGateRef.current.cancel(), []);

  // VIX data — manual refresh only
  const [vixData, setVixData] = useState<SparklineData | null>(null);
  const [vixLoading, setVixLoading] = useState(true);
  const [lastVixUpdate, setLastVixUpdate] = useState<Date | null>(null);

  const loadVix = useCallback(async () => {
    setVixLoading(true);
    try {
      const data = await fetchSparkline('^VIX');
      setVixData(data);
      setLastVixUpdate(new Date());
    } catch { /* ignore */ }
    setVixLoading(false);
  }, []);

  useEffect(() => { loadVix(); }, [loadVix]);

  const vixLineColor = vixData ? vixColor(vixData.price) : 'var(--yellow)';
  const vixStatus = vixData ? vixLabel(vixData.price) : { text: '', color: '' };

  useEffect(() => {
    const cached = getExpirationsCache();
    if (cached && cached.expirations.length > 0) {
      setAvailableExps(cached.expirations);
      setDatesLoaded(true);
      return;
    }

    let cancelled = false;
    (async () => {
      setLoadingDates(true);
      try {
        const expirations = await fetchScreenerExpirations();
        if (cancelled) return;
        const sorted = expirations.map(expiration => ({
          ...expiration,
          label: formatExpirationDropdownLabel(expiration.date),
        }));
        setAvailableExps(sorted);
        setExpirationsCache(sorted);
      } catch { /* keep the date filter usable with its generic options */ }
      finally {
        if (!cancelled) {
          setDatesLoaded(true);
          setLoadingDates(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ETF dropdown
  const etfOptions = useMemo(() => {
    const q = etfSearch.toLowerCase().trim();
    if (!q) return ETF_LIST.filter(e => !selectedETFs.find(s => s.ticker === e.ticker));
    return ETF_LIST.filter(e =>
      !selectedETFs.find(s => s.ticker === e.ticker) &&
      (e.ticker.toLowerCase().includes(q) || e.name.toLowerCase().includes(q))
    );
  }, [etfSearch, selectedETFs]);

  const addETF = (etf: ETFInfo) => {
    setSelectedETFs(prev => [...prev, etf]);
    setEtfSearch('');
    setShowEtfDropdown(false);
  };

  const removeETF = (ticker: string) => {
    setSelectedETFs(prev => prev.filter(e => e.ticker !== ticker));
  };

  // Build expiration dropdown options from availableExps
  const expDropdownOptions = useMemo(() => {
    return buildExpirationOptions(availableExps);
  }, [availableExps]);

  // Nearest only shortcut
  const selectNearestOnly = () => {
    const nearest = availableExps[0];
    if (nearest) setExpFilter(`date_${nearest.date}`);
  };

  // Clear filters — reset to lte_30dte default
  const clearFilters = () => {
    setSelectedETFs([]);
    setEtfSearch('');
    setExpFilter('lte_30dte');
    setDeltaFilter('all');
    setMoneynessFilter('all');
    setYieldFilter('all');
    setOiFilter('all');
    setVolFilter('all');
    setIvVsRealizedRangeFilter('all');
  };

  // Snapshot the visible criteria so Load always uses the current controls.
  const getCurrentCriteria = useCallback((): ScreenerCriteria => ({
    selectedETFs,
    expFilter,
    deltaFilter,
    moneynessFilter,
    yieldFilter,
    oiFilter,
    volFilter,
    ivVsRealizedRangeFilter,
  }), [selectedETFs, expFilter, deltaFilter, moneynessFilter, yieldFilter, oiFilter, volFilter, ivVsRealizedRangeFilter]);

  const currentCriteria = useMemo(() => getCurrentCriteria(), [getCurrentCriteria]);

  const criteriaSummary = useMemo(() => {
    const selectedTickers = currentCriteria.selectedETFs.length === 0
      ? 'All ETFs'
      : currentCriteria.selectedETFs.map(etf => etf.ticker).join(', ');
    return [
      ['ETFs', selectedTickers],
      ['Expiration', optionLabel(expDropdownOptions, currentCriteria.expFilter)],
      ['Delta', optionLabel(DELTA_OPTIONS, currentCriteria.deltaFilter)],
      ['Moneyness', optionLabel(MONEYNESS_OPTIONS, currentCriteria.moneynessFilter)],
      ['Ann. Secured-Cash Yield Bid', optionLabel(YIELD_OPTIONS, currentCriteria.yieldFilter)],
      ['Min OI', optionLabel(OI_OPTIONS, currentCriteria.oiFilter)],
      ['Min Volume', optionLabel(VOL_OPTIONS, currentCriteria.volFilter)],
      ['IV vs 1Y Realized Range', optionLabel(IV_VS_REALIZED_RANGE_OPTIONS, currentCriteria.ivVsRealizedRangeFilter)],
    ];
  }, [currentCriteria, expDropdownOptions]);

  const hasStructuralCriteriaChanged = loaded && lastLoadedCriteria != null && (
    expFilter !== lastLoadedCriteria.expFilter ||
    selectedEtfKey(selectedETFs) !== selectedEtfKey(lastLoadedCriteria.selectedETFs)
  );

  useEffect(() => {
    if (hasStructuralCriteriaChanged) setRetryState(null);
  }, [hasStructuralCriteriaChanged]);

  // Client-side re-filtering — when filters change but data is already loaded
  useEffect(() => {
    if (!loaded || rawRowsRef.current.length === 0) return;
    setRows(applyScreenerFilters(rawRowsRef.current, currentCriteria));
  }, [currentCriteria, loaded]);

  // Load data
  const executeLoad = useCallback(async (criteria: ScreenerCriteria) => {
    const scan = scanGateRef.current.begin();
    setShowConfirm(false);
    setLoading(true);
    setLoaded(false);
    setSlowWarning(false);
    setScanFailureCount(0);
    setLoadError(null);
    setRetryState(null);
    rawRowsRef.current = [];
    setLastLoadedCriteria(null);
    setRows([]);
    setProgress({ current: 0, total: criteria.selectedETFs.length });
    const startTime = Date.now();
    const slowCheck = setInterval(() => {
      if (scan.isCurrent() && Date.now() - startTime > 30000) setSlowWarning(true);
    }, 1000);

    try {
      const acquired = await runScreenerBatchScan({
        scanId: scan.id,
        selectedTickers: criteria.selectedETFs.map(etf => etf.ticker),
        expFilter: criteria.expFilter,
        signal: scan.signal,
        onProgress: (current, total) => {
          if (scan.isCurrent()) setProgress({ current, total });
        },
      });
      if (!scan.isCurrent()) return;
      if (acquired.initialResults.size === 0) {
        throw new Error(acquired.errors[0]?.message ?? 'No Screener market data was returned. Try again.');
      }

      const built = buildScreenerRows(acquired, criteria.expFilter);
      const sortedExps = built.expirations.map(expiration => ({
        ...expiration,
        label: formatExpirationDropdownLabel(expiration.date),
      }));
      setAvailableExps(sortedExps);
      setDatesLoaded(true);
      setExpirationsCache(sortedExps);
      rawRowsRef.current = built.rows;
      setRows(applyScreenerFilters(built.rows, criteria));
      setScanFailureCount(acquired.errors.length);
      setRetryState(acquired.failedBatchIds.length > 0 ? { criteria, acquired } : null);
      setLoaded(true);
      setLastLoadedCriteria(criteria);

    } catch (error) {
      if (scan.isCurrent() && (error as Error)?.name !== 'AbortError') {
        setScanFailureCount(0);
        setLoadError(error instanceof Error ? error.message : 'The Screener could not load market data. Try again.');
      }
    } finally {
      clearInterval(slowCheck);
      if (scan.isCurrent()) setLoading(false);
    }
  }, []);

  const handleRetryFailedResults = useCallback(async () => {
    if (!retryState) return;
    const scan = scanGateRef.current.begin();
    const { criteria, acquired: previous } = retryState;
    setLoading(true);
    setLoadError(null);
    setProgress({ current: 0, total: previous.failedBatchIds.length });
    try {
      const acquired = await retryFailedScreenerBatches({
        scanId: scan.id,
        selectedTickers: criteria.selectedETFs.map(etf => etf.ticker),
        expFilter: criteria.expFilter,
        failedBatchIds: previous.failedBatchIds,
        previous,
        signal: scan.signal,
      });
      if (!scan.isCurrent()) return;
      const built = buildScreenerRows(acquired, criteria.expFilter);
      rawRowsRef.current = built.rows;
      setRows(applyScreenerFilters(built.rows, criteria));
      setScanFailureCount(acquired.errors.length);
      setRetryState(acquired.failedBatchIds.length > 0 ? { criteria, acquired } : null);
      setLoaded(true);
    } catch (error) {
      if (scan.isCurrent() && (error as { name?: unknown })?.name !== 'AbortError') {
        setLoadError('The failed Screener batches could not be retried.');
      }
    } finally {
      if (scan.isCurrent()) setLoading(false);
    }
  }, [retryState]);

  const handleLoad = useCallback(async () => {
    const criteria = getCurrentCriteria();
    if (criteria.selectedETFs.length === 0) {
      setShowConfirm(true);
      return;
    }
    await executeLoad(criteria);
    setMobileFiltersOpen(false);
  }, [executeLoad, getCurrentCriteria]);

  // Sorted rows
  const sortedRows = useMemo(() => {
    const sorted = [...rows];
    sorted.sort((a, b) => {
      let aVal: number | string | null, bVal: number | string | null;
      switch (sortField) {
        case 'ticker': aVal = a.ticker; bVal = b.ticker; break;
        case 'price': aVal = a.currentPrice; bVal = b.currentPrice; break;
        case 'expDate': aVal = a.dte; bVal = b.dte; break;
        case 'strike': aVal = a.strike; bVal = b.strike; break;
        case 'moneyness': aVal = a.moneynessPct; bVal = b.moneynessPct; break;
        case 'delta': aVal = a.delta; bVal = b.delta; break;
        case 'bid': aVal = a.bid; bVal = b.bid; break;
        case 'last': aVal = a.last; bVal = b.last; break;
        case 'ask': aVal = a.ask; bVal = b.ask; break;
        case 'iv': aVal = a.iv; bVal = b.iv; break;
        case 'nomYieldBid': aVal = a.nomYieldBid; bVal = b.nomYieldBid; break;
        case 'nomYieldAsk': aVal = a.nomYieldAsk; bVal = b.nomYieldAsk; break;
        case 'nomYieldLast': aVal = a.nomYieldLast; bVal = b.nomYieldLast; break;
        case 'annYieldBid': aVal = a.annYieldBid; bVal = b.annYieldBid; break;
        case 'annYieldAsk': aVal = a.annYieldAsk; bVal = b.annYieldAsk; break;
        case 'annYieldLast': aVal = a.annYieldLast; bVal = b.annYieldLast; break;
        case 'volume': aVal = a.volume; bVal = b.volume; break;
        case 'openInterest': aVal = a.openInterest; bVal = b.openInterest; break;
        case 'volOI': aVal = a.volOI; bVal = b.volOI; break;
        case 'ivVsRealizedRange': aVal = a.ivVsRealizedRange; bVal = b.ivVsRealizedRange; break;
        default: aVal = a.annYieldBid; bVal = b.annYieldBid;
      }
      return compareNullableValue(aVal, bVal, sortDir);
    });
    return sorted;
  }, [rows, sortField, sortDir]);

  function handleSort(field: ScreenerSortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }

  function SortIcon({ field }: { field: ScreenerSortField }) {
    if (sortField !== field) return <ChevronUp className="w-3 h-3 opacity-40" style={{ color: 'var(--text-muted)' }} />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3" style={{ color: 'var(--accent)' }} />
      : <ChevronDown className="w-3 h-3" style={{ color: 'var(--accent)' }} />;
  }

  type ScreenerColumn = { field: ScreenerSortField; label: string; align: string; hideOnMobile?: boolean; hideOnTablet?: boolean };
  const quoteColumns: Record<OptionQuoteTableDisplayField, ScreenerColumn> = {
    last: { field: 'last', label: 'Last', align: 'text-right', hideOnMobile: true },
    bid: { field: 'bid', label: 'Bid', align: 'text-right' },
    ask: { field: 'ask', label: 'Ask', align: 'text-right', hideOnMobile: true },
  };
  const yieldColumns: Record<OptionYieldDisplayField, ScreenerColumn> = {
    nomYieldLast: { field: 'nomYieldLast', label: OPTION_YIELD_DISPLAY_LABELS.nomYieldLast.short, align: 'text-right', hideOnMobile: true, hideOnTablet: true },
    annYieldLast: { field: 'annYieldLast', label: OPTION_YIELD_DISPLAY_LABELS.annYieldLast.short, align: 'text-right', hideOnMobile: true, hideOnTablet: true },
    nomYieldBid: { field: 'nomYieldBid', label: OPTION_YIELD_DISPLAY_LABELS.nomYieldBid.short, align: 'text-right', hideOnMobile: true, hideOnTablet: true },
    annYieldBid: { field: 'annYieldBid', label: OPTION_YIELD_DISPLAY_LABELS.annYieldBid.short, align: 'text-right' },
    nomYieldAsk: { field: 'nomYieldAsk', label: OPTION_YIELD_DISPLAY_LABELS.nomYieldAsk.short, align: 'text-right', hideOnMobile: true, hideOnTablet: true },
    annYieldAsk: { field: 'annYieldAsk', label: OPTION_YIELD_DISPLAY_LABELS.annYieldAsk.short, align: 'text-right', hideOnMobile: true },
  };
  const baseColumns: ScreenerColumn[] = [
    { field: 'ticker', label: 'Symbol', align: 'text-left' },
    { field: 'price', label: 'Price', align: 'text-right', hideOnMobile: true },
    { field: 'expDate', label: 'Exp Date', align: 'text-right' },
    { field: 'strike', label: 'Strike', align: 'text-right' },
    { field: 'moneyness', label: 'Moneyness', align: 'text-right', hideOnMobile: true },
    { field: 'delta', label: 'Delta', align: 'text-right' },
    ...OPTION_QUOTE_TABLE_DISPLAY_ORDER.map(field => quoteColumns[field]),
    { field: 'iv', label: 'Imp Vol', align: 'text-right', hideOnMobile: true },
    ...OPTION_YIELD_DISPLAY_ORDER.map(field => yieldColumns[field]),
    { field: 'ivVsRealizedRange', label: 'IV vs 1Y RV', align: 'text-right', hideOnMobile: true },
  ];

  const volOIColumns: ScreenerColumn[] = [
    { field: 'volume', label: 'Volume', align: 'text-right', hideOnMobile: true },
    { field: 'openInterest', label: 'Open Int', align: 'text-right', hideOnMobile: true },
    { field: 'volOI', label: 'Vol/OI', align: 'text-right', hideOnMobile: true, hideOnTablet: true },
  ];

  const columns = showVolOI ? [...baseColumns, ...volOIColumns] : baseColumns;

  const progressPct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;
  const activeFilterCount = [
    selectedETFs.length > 0,
    expFilter !== 'all',
    deltaFilter !== 'all',
    moneynessFilter !== 'all',
    yieldFilter !== 'all',
    oiFilter !== 'all',
    volFilter !== 'all',
    ivVsRealizedRangeFilter !== 'all',
  ].filter(Boolean).length;
  const localFilterCount = [deltaFilter !== 'all', moneynessFilter !== 'all', yieldFilter !== 'all', oiFilter !== 'all', volFilter !== 'all', ivVsRealizedRangeFilter !== 'all'].filter(Boolean).length;
  const scopeLabel = selectedETFs.length === 0 ? 'All ETFs' : selectedETFs.map(etf => etf.ticker).join(', ');
  const loadedScopeLabel = lastLoadedCriteria ? (lastLoadedCriteria.selectedETFs.length === 0 ? 'All ETFs' : lastLoadedCriteria.selectedETFs.map(etf => etf.ticker).join(', ')) : scopeLabel;
  const loadedExpirationLabel = lastLoadedCriteria ? optionLabel(expDropdownOptions, lastLoadedCriteria.expFilter) : optionLabel(expDropdownOptions, expFilter);

  if (isPhone) {
    const activeCriteria = [
      deltaFilter !== 'all' ? `Δ ${DELTA_OPTIONS.find(option => option.value === deltaFilter)?.label}` : null,
      moneynessFilter !== 'all' ? MONEYNESS_OPTIONS.find(option => option.value === moneynessFilter)?.label : null,
      yieldFilter !== 'all' ? `Ann. SCY ${YIELD_OPTIONS.find(option => option.value === yieldFilter)?.label}` : null,
      oiFilter !== 'all' ? `OI ${OI_OPTIONS.find(option => option.value === oiFilter)?.label}` : null,
    ].filter(Boolean).join(' · ') || 'All deltas · All moneyness · All yields';
    const resetFilters = () => clearFilters();

    return (
      <div className="mobile-route-page min-h-[100dvh]" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="screener-mobile-context border-b px-3.5 pb-3 pt-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0"><div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.07em]" style={{ color: 'var(--text-dim)' }}><span>Screening criteria</span>{loaded && <span className="status-badge" data-status={loadError ? 'failed' : 'fresh'}>{loadError ? 'Needs retry' : `${rawRowsRef.current.length} loaded`}</span>}</div><p className="truncate text-[13px]" style={{ color: 'var(--text)' }}>{activeCriteria}</p></div>
            <button type="button" onClick={() => setMobileFiltersOpen(true)} className="pressable mobile-control-button" aria-haspopup="dialog"><SlidersHorizontal className="h-4 w-4" /> Filters {activeFilterCount}</button>
          </div>
          <button type="button" onClick={() => void handleLoad()} disabled={loading} className="mobile-sheet-action primary mt-3 w-full disabled:opacity-50">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}{loading ? `Scanning ${progress.current}/${progress.total}` : 'Run Screener'}</button>
          {loading && progress.total > 0 && <div className="screener-progress mt-2"><div className="flex items-center justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}><span>Loading bounded dataset</span><span className="font-mono">{progress.current}/{progress.total}</span></div><div className="mt-1 h-1 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--border)' }}><div className="h-full rounded-full" style={{ width: `${progressPct}%`, backgroundColor: 'var(--accent)' }} /></div></div>}
          {slowWarning && <p className="mt-2 flex items-center gap-1 text-[11px]" style={{ color: 'var(--yellow)' }}><AlertTriangle className="h-3.5 w-3.5" /> Narrow filters for a faster scan.</p>}
          {scanFailureCount > 0 && <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: 'var(--yellow)' }}><span className="flex items-center gap-1"><AlertTriangle className="h-3.5 w-3.5" /> Some results could not be loaded.</span>{retryState && !hasStructuralCriteriaChanged && !loading && <button type="button" onClick={() => void handleRetryFailedResults()} className="mobile-sheet-action secondary min-h-9 px-3 py-1"><RefreshCw className="h-3.5 w-3.5" /> Retry failed results</button>}</div>}
          {loadError && !loading && <p role="alert" className="mt-2 flex items-start gap-1 text-[11px]" style={{ color: 'var(--red)' }}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" /> <span>{loadError} Run Screener to retry.</span></p>}
        </div>

        {loaded && <div className="screener-loaded-context flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3.5 py-2 text-[11px]" style={{ borderColor: 'var(--border)' }}><span className="font-semibold" style={{ color: 'var(--text)' }}>{rawRowsRef.current.length} contracts loaded</span><span style={{ color: 'var(--text-muted)' }}>Showing {sortedRows.length} after local filters</span><span className="screener-scope-context" style={{ color: 'var(--text-muted)' }}>Loaded scope: {loadedScopeLabel} · {loadedExpirationLabel}</span>{hasStructuralCriteriaChanged && <span className="status-badge" data-status="updating">Pending scope change</span>}{scanFailureCount > 0 && <span className="status-badge" data-status="failed">{scanFailureCount} batch{scanFailureCount === 1 ? '' : 'es'} incomplete</span>}</div>}

        <div className="screener-results-header flex min-h-[46px] items-center gap-2 border-b px-3.5" style={{ borderColor: 'var(--border)' }}>
          <h2 className="mr-auto text-[15px] font-semibold" style={{ color: 'var(--text)' }}>Results <span className="font-mono font-normal" style={{ color: 'var(--text-muted)' }}>{loaded ? sortedRows.length : '—'}</span></h2>
          <select value={sortField} onChange={event => setSortField(event.target.value as ScreenerSortField)} className="min-h-11 min-w-0 rounded-lg px-2 text-[12px] outline-none" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }} aria-label="Sort screener results"><option value="annYieldBid">Ann. secured-cash yield</option><option value="ticker">Ticker</option><option value="expDate">Expiration</option><option value="strike">Strike</option><option value="delta">Delta</option><option value="last">Last</option><option value="bid">Bid</option><option value="ask">Ask</option><option value="iv">IV</option><option value="openInterest">Open interest</option></select>
          <button type="button" onClick={() => setSortDir(current => current === 'asc' ? 'desc' : 'asc')} className="pressable flex h-11 w-11 items-center justify-center rounded-lg text-sm font-semibold" aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`} style={{ color: 'var(--accent-light)' }}>{sortDir === 'asc' ? '↑' : '↓'}</button>
        </div>

        {hasStructuralCriteriaChanged && <div role="status" className="border-b px-3.5 py-2 text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--yellow)', backgroundColor: 'rgba(250,204,21,0.08)' }}>ETF or expiration changed since the last Load. Run Screener to refresh the dataset.</div>}

        {loadError && !loading ? <div className="px-6 py-14 text-center"><AlertTriangle className="mx-auto mb-3 h-6 w-6" style={{ color: 'var(--red)' }} /><p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Screener load failed</p><p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>{loadError}</p><button type="button" onClick={() => void handleLoad()} className="mobile-sheet-action secondary mt-4"><RefreshCw className="h-4 w-4" /> Retry</button></div> : !loaded && !loading ? <div className="px-6 py-14 text-center"><Search className="mx-auto mb-3 h-6 w-6" style={{ color: 'var(--text-dim)' }} /><p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Ready to screen</p><p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Choose criteria, then run the screener.</p></div> : loaded && sortedRows.length === 0 ? <div className="px-6 py-14 text-center"><p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>No screener matches</p><p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Try widening delta, moneyness, or yield.</p><button type="button" onClick={() => setMobileFiltersOpen(true)} className="mobile-sheet-action secondary mt-4">Adjust filters</button></div> : (
          <div className="mobile-financial-list">{sortedRows.map(row => <MobileOptionRow key={`${row.ticker}-${row.expDate}-${row.strike}`} ticker={row.ticker} strike={row.strike} expirationLabel={row.expLabel} dte={row.dte} bid={row.bid} ask={row.ask} last={row.last} annualYield={row.annYieldBid} delta={row.delta} impliedVolatility={row.iv} openInterest={row.openInterest} moneynessLabel={row.moneynessLabel} moneynessColor={row.moneynessColor} statusText={`Vol ${formatNumber(row.volume)} · OI ${formatNumber(row.openInterest)}`} onSelect={() => setSelectedOption({ option: optionDetailFromScreenerRow(row), ticker: row.ticker, expirationLabel: row.expLabel, dte: row.dte, underlyingPrice: row.currentPrice > 0 ? row.currentPrice : null })} />)}</div>
        )}

        {mobileFiltersOpen && <MobileBottomSheet title="Screener filters" description="Define the contracts you want to find" onClose={() => setMobileFiltersOpen(false)} footer={<div className="grid grid-cols-2 gap-2"><button type="button" onClick={resetFilters} className="mobile-sheet-action secondary">Reset</button><button type="button" onClick={() => setMobileFiltersOpen(false)} className="mobile-sheet-action primary">Done</button></div>}>
          <div className="space-y-4">
            <div><span className="mobile-sheet-label">ETFs</span><div className="flex min-h-11 flex-wrap gap-1.5 rounded-lg border p-1.5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--input-bg)' }}>{selectedETFs.map(etf => <span key={etf.ticker} className="inline-flex items-center gap-1 rounded-md px-2 text-xs" style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-light)' }}>{etf.ticker}<button type="button" onClick={() => removeETF(etf.ticker)} className="flex h-7 w-7 items-center justify-center" aria-label={`Remove ${etf.ticker}`}><X className="h-3 w-3" /></button></span>)}<input value={etfSearch} onChange={event => { setEtfSearch(event.target.value); setShowEtfDropdown(true); }} onFocus={() => setShowEtfDropdown(true)} placeholder={selectedETFs.length ? 'Add ETF' : 'All ETFs'} className="min-w-[100px] flex-1 bg-transparent px-2 text-base outline-none" style={{ color: 'var(--text)' }} /></div>{showEtfDropdown && etfOptions.length > 0 && <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>{etfOptions.slice(0, 20).map(etf => <button type="button" key={etf.ticker} onClick={() => addETF(etf)} className="flex min-h-11 w-full items-center gap-2 border-b px-3 text-left" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}><b className="font-mono">{etf.ticker}</b><span className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>{etf.name}</span></button>)}</div>}</div>
            <ExpirationFilter value={expFilter} onChange={setExpFilter} options={expDropdownOptions} loadingDates={loadingDates} datesLoaded={datesLoaded} />
            {([['Delta (abs)', deltaFilter, setDeltaFilter, DELTA_OPTIONS], ['Moneyness', moneynessFilter, setMoneynessFilter, MONEYNESS_OPTIONS], ['Ann. Secured-Cash Yield Bid', yieldFilter, setYieldFilter, YIELD_OPTIONS], ['Minimum OI', oiFilter, setOiFilter, OI_OPTIONS], ['Minimum Volume', volFilter, setVolFilter, VOL_OPTIONS], ['IV vs 1Y Realized Range', ivVsRealizedRangeFilter, setIvVsRealizedRangeFilter, IV_VS_REALIZED_RANGE_OPTIONS]] as const).map(([label, value, setter, options]) => <label key={label} className="block"><span className="mobile-sheet-label">{label}</span><select value={value} onChange={event => setter(event.target.value)} className="mobile-control-field w-full">{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>)}
          </div>
        </MobileBottomSheet>}

        {showConfirm && <MobileBottomSheet title="Scan all ETFs?" description="This uses 14 shared market-data batch requests." onClose={() => setShowConfirm(false)} footer={<div className="grid grid-cols-2 gap-2"><button type="button" onClick={() => setShowConfirm(false)} className="mobile-sheet-action secondary">Cancel</button><button type="button" onClick={() => executeLoad({ ...currentCriteria, selectedETFs: ETF_LIST })} className="mobile-sheet-action primary">Run scan</button></div>}><p className="text-sm leading-6" style={{ color: 'var(--text-muted)' }}>Select specific ETFs for a faster result, or continue to scan the full universe.</p></MobileBottomSheet>}
        {selectedOption && <ErrorBoundary title="Option sheet unavailable" message="Close it and try again."><Suspense fallback={null}><OptionDetailDrawer option={selectedOption.option} ticker={selectedOption.ticker} expirationLabel={selectedOption.expirationLabel} dte={selectedOption.dte} underlyingPrice={selectedOption.underlyingPrice} onClose={() => setSelectedOption(null)} /></Suspense></ErrorBoundary>}
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="page-frame">
        <PageHeader title="Screener" description="Define a bounded universe, load it once, then refine the contracts locally." meta={<div className="screener-header-meta"><span className="status-badge" data-status={loaded ? (loadError ? 'failed' : 'fresh') : 'stale'}>{loaded ? `${rawRowsRef.current.length} contracts loaded` : 'Ready to load'}</span><span>{activeFilterCount} active criteria</span><span>{localFilterCount} local</span></div>} />
        {/* Filter Bar */}
        <div className="screener-filter-surface surface-card p-3 mb-3 sm:mb-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="screener-filter-heading"><div><div className="screener-eyebrow">Define the scan</div><h2>Universe and criteria</h2><p>Choose what to fetch, then refine the loaded rows without another request.</p></div><div className="screener-scope-badge"><span>Scope</span><strong>{scopeLabel}</strong><small>{optionLabel(expDropdownOptions, expFilter)}</small></div></div>
          <button
            type="button"
            className="pressable flex min-h-11 w-full items-center justify-between gap-3 sm:hidden"
            aria-expanded={mobileFiltersOpen}
            aria-controls="screener-filter-controls"
            onClick={() => setMobileFiltersOpen(current => !current)}
          >
            <span className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-light)' }}><SlidersHorizontal className="h-4 w-4" /></span>
              <span className="text-left">
                <span className="block text-sm font-semibold" style={{ color: 'var(--text)' }}>Scan filters</span>
                <span className="block text-[11px]" style={{ color: 'var(--text-muted)' }}>{activeFilterCount} active · {selectedETFs.length || 'All'} ETFs</span>
              </span>
            </span>
            <ChevronDown className={`h-4 w-4 transition-transform ${mobileFiltersOpen ? 'rotate-180' : ''}`} style={{ color: 'var(--text-muted)' }} />
          </button>

          <div id="screener-filter-controls" className={`screener-filter-controls grid grid-cols-1 min-[430px]:grid-cols-2 sm:flex sm:flex-row sm:flex-wrap xl:flex-nowrap sm:items-end gap-2 ${mobileFiltersOpen ? 'is-open' : ''}`}>
            {/* ETF Selector */}
            <div className="screener-filter-field screener-filter-field--structural w-full sm:min-w-[180px] sm:w-auto min-w-0 min-[430px]:col-span-2 sm:col-span-1">
              <div className="screener-filter-group-tag"><strong>Fetch scope</strong><span>Changes require Load</span></div>
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>ETFs</label>
              <div className="relative">
                <div className="flex flex-wrap gap-1 p-1.5 rounded-lg min-h-[44px] sm:min-h-[32px]" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }}>
                  {selectedETFs.map(e => (
                    <span key={e.ticker} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs rounded" style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>
                      {e.ticker}
                      <button onClick={() => removeETF(e.ticker)} className="hover:opacity-70"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={etfSearch}
                    onChange={e => { setEtfSearch(e.target.value); setShowEtfDropdown(true); }}
                    onFocus={() => setShowEtfDropdown(true)}
                    placeholder={selectedETFs.length === 0 ? 'Select ETFs...' : ''}
                    className="bg-transparent text-base sm:text-xs outline-none flex-1 min-w-[90px]"
                    style={{ color: 'var(--text)' }}
                  />
                </div>
                {showEtfDropdown && etfOptions.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 max-h-40 overflow-y-auto shadow-xl rounded-lg" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                    {etfOptions.slice(0, 20).map(e => (
                      <button
                        key={e.ticker}
                        onClick={() => addETF(e)}
                        className="w-full text-left px-3 py-1.5 text-xs transition-colors"
                        style={{ color: 'var(--text)' }}
                        onMouseEnter={e => (e.currentTarget.style.backgroundColor = 'var(--accent-bg)')}
                        onMouseLeave={e => (e.currentTarget.style.backgroundColor = 'transparent')}
                      >
                        <span className="font-mono font-semibold">{e.ticker}</span>
                        <span className="ml-2" style={{ color: 'var(--text-muted)' }}>{e.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Expiration - single-select dropdown; nearest modes acquire at most two expiries. */}
            <div className="screener-filter-field screener-filter-field--structural w-full sm:w-auto min-w-0">
              <ExpirationFilter
                value={expFilter}
                onChange={setExpFilter}
                options={expDropdownOptions}
                loadingDates={loadingDates}
                datesLoaded={datesLoaded}
              />
              {datesLoaded && (
                <button
                  onClick={selectNearestOnly}
                  className="mt-1 sm:ml-1 text-[10px] px-2 py-1 rounded transition-colors min-h-[32px]"
                  style={{ color: 'var(--accent-light)', backgroundColor: 'var(--accent-bg)' }}
                >
                  Nearest only
                </button>
              )}
            </div>

            {/* Delta (abs) */}
            <div className="screener-filter-field screener-filter-field--local w-full sm:w-auto min-w-0">
              <div className="screener-filter-group-tag"><strong>Refine loaded data</strong><span>Updates instantly</span></div>
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Delta (abs)</label>
              <select value={deltaFilter} onChange={e => setDeltaFilter(e.target.value)}
                className="w-full sm:w-auto rounded-lg px-3 py-2 sm:py-1.5 text-base sm:text-xs outline-none cursor-pointer min-h-[44px] sm:min-h-0"
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {DELTA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Moneyness */}
            <div className="screener-filter-field screener-filter-field--local w-full sm:w-auto min-w-0">
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Moneyness</label>
              <select value={moneynessFilter} onChange={e => setMoneynessFilter(e.target.value)}
                className="w-full sm:w-auto rounded-lg px-3 py-2 sm:py-1.5 text-base sm:text-xs outline-none cursor-pointer min-h-[44px] sm:min-h-0"
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {MONEYNESS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Ann Yield */}
            <div className="screener-filter-field screener-filter-field--local w-full sm:w-auto min-w-0">
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Ann. Secured-Cash Yield Bid</label>
              <select value={yieldFilter} onChange={e => setYieldFilter(e.target.value)}
                className="w-full sm:w-auto rounded-lg px-3 py-2 sm:py-1.5 text-base sm:text-xs outline-none cursor-pointer min-h-[44px] sm:min-h-0"
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {YIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Min OI */}
            <div className="screener-filter-field screener-filter-field--local w-full sm:w-auto min-w-0">
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Min OI</label>
              <select value={oiFilter} onChange={e => setOiFilter(e.target.value)}
                className="w-full sm:w-auto rounded-lg px-3 py-2 sm:py-1.5 text-base sm:text-xs outline-none cursor-pointer min-h-[44px] sm:min-h-0"
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {OI_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Min Volume */}
            <div className="screener-filter-field screener-filter-field--local w-full sm:w-auto min-w-0">
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Min Vol</label>
              <select value={volFilter} onChange={e => setVolFilter(e.target.value)}
                className="w-full sm:w-auto rounded-lg px-3 py-2 sm:py-1.5 text-base sm:text-xs outline-none cursor-pointer min-h-[44px] sm:min-h-0"
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {VOL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Current ATM implied volatility versus trailing realized-volatility range. */}
            <div className="screener-filter-field screener-filter-field--local w-full sm:w-auto min-w-0">
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }} title="Current ATM put IV positioned in the trailing 1-year range of 4-week realized volatility. Not traditional historical IV Rank.">IV vs 1Y Realized Range</label>
              <select value={ivVsRealizedRangeFilter} onChange={e => setIvVsRealizedRangeFilter(e.target.value)}
                className="w-full sm:w-auto rounded-lg px-3 py-2 sm:py-1.5 text-base sm:text-xs outline-none cursor-pointer min-h-[44px] sm:min-h-0"
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {IV_VS_REALIZED_RANGE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Buttons */}
            <div className="flex gap-2 w-full sm:w-auto">
              <button
                onClick={handleLoad}
                disabled={loading}
                className="button-primary flex-1 sm:flex-none justify-center px-4 py-2 sm:py-1.5 text-white text-xs rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 min-h-[44px] sm:min-h-0"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                {loading ? `Scanning... (${progress.current} of ${progress.total})` : 'Load'}
              </button>
              <button
                onClick={clearFilters}
                className="button-secondary px-3 py-2 sm:py-1.5 text-xs rounded-lg min-h-[44px] sm:min-h-0"
                style={{ backgroundColor: 'var(--border)', color: 'var(--text-secondary)' }}
              >
                Clear
              </button>
            </div>

            {/* VIX Chart - manual refresh only, hidden on mobile */}
            <div className="hidden sm:block ml-auto flex-shrink-0">
              <div className="rounded-lg p-2" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-medium uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>VIX</span>
                  <button onClick={loadVix} disabled={vixLoading} className="p-0.5 rounded transition-opacity hover:opacity-70 disabled:opacity-50">
                    <RefreshCw className={`w-3 h-3 ${vixLoading ? 'animate-spin' : ''}`} style={{ color: 'var(--text-muted)' }} />
                  </button>
                </div>
                {vixLoading && !vixData ? (
                  <div className="flex items-center justify-center" style={{ width: 120, height: 36 }}>
                    <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-muted)' }} />
                  </div>
                ) : vixData ? (
                  <>
                    <SparklineChart data={vixData.sparkline} color={vixLineColor} width={120} height={36} />
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs font-mono font-semibold" style={{ color: 'var(--text)' }}>
                        {vixData.price.toFixed(2)}
                      </span>
                      <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded" style={{ color: vixStatus.color, backgroundColor: `${vixStatus.color}15` }}>
                        {vixStatus.text}
                      </span>
                    </div>
                    {lastVixUpdate && (
                      <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
                        {lastVixUpdate.toLocaleTimeString()}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-center text-xs" style={{ width: 120, height: 36, color: 'var(--text-muted)' }}>N/A</div>
                )}
              </div>
            </div>
          </div>

          {/* Progress bar (Opt 6) */}
          {loading && progress.total > 0 && (
            <div className="mt-3">
              <div className="h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${progressPct}%`, backgroundColor: 'var(--accent)' }}
                />
              </div>
              <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                {progressPct}% complete
              </div>
            </div>
          )}

          {slowWarning && (
            <div className="flex items-center gap-2 mt-3 text-xs" style={{ color: 'var(--yellow)' }}>
              <AlertTriangle className="w-3.5 h-3.5" />
              This is taking longer than expected — try narrowing your filters
            </div>
          )}
          {scanFailureCount > 0 && (
            <div className="flex flex-wrap items-center gap-2 mt-3 text-xs" style={{ color: 'var(--yellow)' }}>
              <span className="flex items-center gap-2"><AlertTriangle className="w-3.5 h-3.5" /> Some results could not be loaded.</span>
              {retryState && !hasStructuralCriteriaChanged && !loading && <button type="button" onClick={() => void handleRetryFailedResults()} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-3 py-1.5 font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}><RefreshCw className="h-3.5 w-3.5" /> Retry failed results</button>}
            </div>
          )}
          {loadError && !loading && (
            <div role="alert" className="flex items-center gap-2 mt-3 text-xs" style={{ color: 'var(--red)' }}>
              <AlertTriangle className="w-3.5 h-3.5" />
              <span>{loadError} Click Load to retry.</span>
            </div>
          )}
        </div>

        {/* Confirmation dialog */}
        {showConfirm && (
          <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-3" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="mobile-confirm-sheet max-h-[85dvh] w-full max-w-sm overflow-y-auto rounded-t-2xl p-4 sm:rounded-xl sm:p-6" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text)' }}>Scan All ETFs?</h3>
              <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                Scanning all ETFs uses 14 shared market-data batch requests. Proceed?
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowConfirm(false)}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg"
                  style={{ backgroundColor: 'var(--border)', color: 'var(--text-secondary)' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => executeLoad({ ...currentCriteria, selectedETFs: ETF_LIST })}
                  className="px-4 py-1.5 text-white text-xs font-medium rounded-lg"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Results header */}
        <div className="screener-results-toolbar flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2 px-1">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1"><span className="screener-results-kicker">Loaded contracts</span><span className="font-mono text-sm font-semibold" style={{ color: 'var(--text)' }}>{loaded ? sortedRows.length : '—'}</span>{loaded && <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>visible after local filters</span>}</div>
            {hasStructuralCriteriaChanged && (
              <div className="text-[10px] mt-0.5" style={{ color: 'var(--yellow)' }}>
                Inputs changed - click Load to refresh results.
              </div>
            )}
          </div>
          <label className="screener-volume-toggle flex items-center gap-1.5 text-xs cursor-pointer min-h-[40px]" style={{ color: 'var(--text-muted)' }}>
            <input
              type="checkbox"
              checked={showVolOI}
              onChange={e => setShowVolOI(e.target.checked)}
              className="rounded"
            />
            Show Volume / OI columns
          </label>
        </div>

        <div className="mb-3 grid grid-cols-[1fr_auto] gap-2 md:hidden">
          <label className="min-w-0">
            <span className="sr-only">Sort results</span>
            <select value={sortField} onChange={event => setSortField(event.target.value as ScreenerSortField)} className="min-h-[44px] w-full rounded-lg px-3 text-base outline-none" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}>
              <option value="annYieldBid">Ann. SCY Bid</option>
              <option value="ticker">Ticker</option>
              <option value="expDate">Expiration</option>
              <option value="strike">Strike</option>
              <option value="delta">Delta</option>
              <option value="last">Last</option>
              <option value="bid">Bid</option>
              <option value="ask">Ask</option>
              <option value="iv">IV</option>
              <option value="openInterest">Open interest</option>
            </select>
          </label>
          <button type="button" onClick={() => setSortDir(current => current === 'asc' ? 'desc' : 'asc')} className="pressable tap-target rounded-lg px-3 text-xs font-semibold" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }} aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`}>
            {sortDir === 'asc' ? 'Low → High' : 'High → Low'}
          </button>
        </div>

        <div className="space-y-2 md:hidden">
          {!loaded && !loading && (
            <div className="rounded-xl px-5 py-12 text-center" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <Search className="mx-auto mb-3 h-6 w-6" style={{ color: 'var(--text-dim)' }} />
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Ready to scan</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Choose filters above, then tap Load.</p>
            </div>
          )}
          {loaded && sortedRows.length === 0 && (
            <div className="rounded-xl px-5 py-10 text-center" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>No matching options</p>
              <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Try relaxing Delta, Moneyness, or Annualized Secured-Cash Yield.</p>
              <button type="button" onClick={() => setMobileFiltersOpen(true)} className="tap-target mt-4 rounded-lg px-4 text-xs font-semibold" style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>Adjust filters</button>
            </div>
          )}
          {sortedRows.map(row => (
            <article key={`mobile-${row.ticker}-${row.expDate}-${row.strike}`} className="pressable rounded-xl p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link to={`/options/${row.ticker}`} className="tap-target inline-flex items-center font-mono text-base font-bold" style={{ color: 'var(--accent-light)' }}>{row.ticker}</Link>
                    <span className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: row.moneynessColor, backgroundColor: 'var(--surface-alt)' }}>{row.moneynessLabel}</span>
                  </div>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{row.expLabel} · {row.dte} DTE · Underlying ${formatPrice(row.currentPrice)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedOption({ option: optionDetailFromScreenerRow(row), ticker: row.ticker, expirationLabel: row.expLabel, dte: row.dte, underlyingPrice: row.currentPrice > 0 ? row.currentPrice : null })}
                  className="pressable tap-target rounded-lg px-3 text-right"
                  style={{ backgroundColor: 'var(--accent-bg)', border: '1px solid var(--accent-border)' }}
                  aria-label={`Open option details for ${row.ticker} ${formatPrice(row.strike)} put`}
                >
                  <span className="block text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Strike</span>
                  <span className="font-mono text-sm font-bold" style={{ color: 'var(--accent-light)' }}>${formatPrice(row.strike)}</span>
                </button>
              </div>
              <div className="mt-2 grid grid-cols-4 gap-1.5 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
                {[
                  ['Last', `$${formatPrice(row.last)}`, 'var(--text)'],
                  ['Bid', `$${formatPrice(row.bid)}`, 'var(--green)'],
                  ['Ask', `$${formatPrice(row.ask)}`, 'var(--text)'],
                  ['Ann. SCY Bid', row.annYieldBid != null ? `${row.annYieldBid.toFixed(1)}%` : '—', annYieldColor(row.annYieldBid)],
                ].map(([label, value, color]) => (
                  <div key={label} className="min-w-0 rounded-lg p-2 text-center" style={{ backgroundColor: 'var(--surface-alt)' }}>
                    <div className="truncate text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>{label}</div>
                    <div className="truncate font-mono text-xs font-semibold tabular-nums" style={{ color }}>{value}</div>
                  </div>
                ))}
              </div>
              <p className="mt-2 text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>Δ {row.delta != null ? row.delta.toFixed(2) : '—'} · IV {row.iv != null ? `${row.iv.toFixed(1)}%` : '—'}</p>
              {showVolOI && <p className="mt-2 text-[11px] font-mono" style={{ color: 'var(--text-muted)' }}>Vol {formatNumber(row.volume)} · OI {formatNumber(row.openInterest)} · Vol/OI {row.volOI?.toFixed(2) ?? '—'}</p>}
            </article>
          ))}
        </div>

        {/* Table */}
        <div className="hidden rounded-xl overflow-hidden max-w-full md:block" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="overflow-x-auto max-w-full overscroll-contain">
            <table className="financial-table min-w-[560px] md:min-w-[1120px] xl:min-w-0 w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr style={{ backgroundColor: 'var(--surface-alt)', borderBottom: '1px solid var(--border)' }}>
                  {columns.map(col => (
                    <th
                      key={col.field}
                      onClick={() => handleSort(col.field)}
                      className={`px-2 py-1.5 text-[10px] uppercase tracking-wider font-medium cursor-pointer transition-colors select-none whitespace-nowrap ${col.align} ${
                        col.field === 'ticker' ? 'sticky left-0 z-[3] border-r' : ''
                      } ${col.hideOnMobile ? 'hidden md:table-cell' : ''} ${col.hideOnTablet ? 'hidden lg:table-cell' : ''}`}
                      style={{
                        color: 'var(--text-muted)',
                        backgroundColor: col.field === 'ticker' ? 'var(--surface-alt)' : undefined,
                        borderColor: 'var(--border)',
                      }}
                    >
                      <span className="inline-flex items-center gap-0.5">
                        {col.label}
                        <SortIcon field={col.field} />
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {!loaded && !loading && (
                  <tr>
                    <td colSpan={columns.length} className="py-16 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                      Select your filters and click Load to scan options
                    </td>
                  </tr>
                )}
                {loaded && sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={columns.length} className="py-12 px-4 text-center" style={{ color: 'var(--text-muted)' }}>
                      <div className="text-sm font-medium mb-2" style={{ color: 'var(--text)' }}>No options match the current filters.</div>
                      <div className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                        Loaded {rawRowsRef.current.length.toLocaleString('en-US')} contracts before filters. Try relaxing Delta, Moneyness, or Ann. Yield Bid.
                      </div>
                      <div className="mx-auto grid max-w-2xl grid-cols-1 sm:grid-cols-2 gap-1.5 text-left">
                        {criteriaSummary.map(([label, value]) => (
                          <div key={label} className="rounded-md px-2 py-1.5" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
                            <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>{label}: </span>
                            <span className="text-xs font-mono" style={{ color: 'var(--text-secondary)' }}>{value}</span>
                          </div>
                        ))}
                      </div>
                      {hasStructuralCriteriaChanged && (
                        <div className="mt-3 text-xs" style={{ color: 'var(--yellow)' }}>
                          Inputs changed since the last scan. Click Load to refresh results for the current ETF/expiration selection.
                        </div>
                      )}
                    </td>
                  </tr>
                )}
                {sortedRows.map((row, idx) => {
                  const bgStyle = idx % 2 !== 0 ? { backgroundColor: 'var(--row-alt)' } : {};

                  return (
                    <tr key={`${row.ticker}-${row.expDate}-${row.strike}`} className="transition-colors" style={{ borderBottom: '1px solid var(--border)', ...bgStyle }}>
                      <td className="screener-identity-cell px-2 py-1 text-left whitespace-nowrap sticky left-0 z-[2] border-r" style={{ borderColor: 'var(--border)', backgroundColor: bgStyle.backgroundColor || 'var(--surface)' }}>
                        <div className="flex min-h-[44px] flex-col justify-center">
                          <Link
                            to={`/options/${row.ticker}`}
                            className="inline-flex items-center font-mono font-bold hover:opacity-80 transition-opacity"
                            style={{ color: 'var(--accent-light)' }}
                          >
                            {row.ticker}
                          </Link>
                          <span className="text-[9px]" style={{ color: 'var(--text-dim)' }}>{row.expLabel} · ${formatPrice(row.strike)} put</span>
                        </div>
                      </td>
                      <td className="px-2 py-1 text-right font-mono hidden md:table-cell" style={{ color: 'var(--text)' }}>{formatPrice(row.currentPrice)}</td>
                      <td className="px-2 py-1 text-right font-mono whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{row.expLabel}</td>
                      <td className="px-2 py-1 text-right font-mono font-semibold">
                        <button
                          type="button"
                          onClick={() => setSelectedOption({
                            option: optionDetailFromScreenerRow(row),
                            ticker: row.ticker,
                            expirationLabel: row.expLabel,
                            dte: row.dte,
                            underlyingPrice: row.currentPrice > 0 ? row.currentPrice : null,
                          })}
                          className="underline-offset-2 hover:underline transition-opacity hover:opacity-85"
                          style={{ color: row.moneynessPct > 0 ? 'var(--red)' : row.moneynessPct < 0 ? 'var(--green)' : 'var(--text)' }}
                          title="Open option details"
                          aria-label={`Open option details for ${row.ticker} ${formatPrice(row.strike)} put`}
                        >
                          {formatPrice(row.strike)}
                        </button>
                      </td>
                      <td className="px-2 py-1 text-right font-mono hidden md:table-cell" style={{ color: row.moneynessColor }}>
                        {row.moneynessLabel}
                      </td>
                      <td className="px-2 py-1 text-right font-mono" style={{ color: deltaColor(row.delta) }}>
                        {row.delta != null ? row.delta.toFixed(2) : '—'}
                      </td>
                      {OPTION_QUOTE_TABLE_DISPLAY_ORDER.map(field => <td key={field} className={`px-2 py-1 text-right font-mono ${field === 'bid' ? '' : 'hidden md:table-cell'}`} style={{ color: 'var(--text)' }}>{formatPrice(row[field])}</td>)}
                      <td className="px-2 py-1 text-right font-mono hidden md:table-cell" style={{ color: ivColor(row.iv) }}>
                        {row.iv != null ? row.iv.toFixed(1) + '%' : '—'}
                      </td>
                      {OPTION_YIELD_DISPLAY_ORDER.map(field => {
                        const value = row[field];
                        const column = yieldColumns[field];
                        const nominal = isNominalYieldField(field);
                        return <td key={field} className={`px-2 py-1 text-right font-mono ${nominal ? '' : 'font-medium'} ${column.hideOnMobile ? 'hidden md:table-cell' : ''} ${column.hideOnTablet ? 'hidden lg:table-cell' : ''}`} style={{ color: nominal ? 'var(--text-secondary)' : annYieldColor(value) }}>{value != null ? value.toFixed(2) + '%' : '—'}</td>;
                      })}
                      <td className="px-2 py-1 text-right font-mono hidden md:table-cell" title="Current ATM put IV positioned in the trailing 1-year range of 4-week realized volatility. Not traditional historical IV Rank." style={{ color: row.ivVsRealizedRange != null ? ivVsRealizedRangeColor(row.ivVsRealizedRange) : 'var(--text-dim)' }}>
                        {row.ivVsRealizedRange != null ? row.ivVsRealizedRange.toFixed(0) + '%' : '—'}
                      </td>
                      {showVolOI && (
                        <>
                          <td className="px-2 py-1 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{formatNumber(row.volume)}</td>
                          <td className="px-2 py-1 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{formatNumber(row.openInterest)}</td>
                          <td className="px-2 py-1 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>{row.volOI != null ? row.volOI.toFixed(2) : '—'}</td>
                        </>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="mt-6 pb-4 text-center">
          <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>Data delayed up to 15 minutes. Not financial advice.</p>
        </footer>
      </div>
      {selectedOption && (
        <ErrorBoundary title="Option drawer unavailable" message="The option detail drawer could not render. Close it and try again.">
          <Suspense fallback={null}>
            <OptionDetailDrawer
              option={selectedOption.option}
              ticker={selectedOption.ticker}
              expirationLabel={selectedOption.expirationLabel}
              dte={selectedOption.dte}
              underlyingPrice={selectedOption.underlyingPrice}
              onClose={() => setSelectedOption(null)}
            />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}

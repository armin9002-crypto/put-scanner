import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ETF_LIST } from '../lib/etfs';
import type { ETFInfo, OptionsChainData } from '../lib/types';
import { fetchOptions, fetchSparkline, fetchWithConcurrencyLimit, calculatePutDelta, formatPrice, formatNumber, fetchIVRank } from '../lib/api';
import type { SparklineData } from '../lib/api';
import { getExpirationsCache, setExpirationsCache } from '../lib/cache';
import SparklineChart from '../components/SparklineChart';
import { Search, X, ChevronUp, ChevronDown, Loader2, AlertTriangle, RefreshCw } from 'lucide-react';

// --- Types ---

interface ScreenerRow {
  ticker: string;
  currentPrice: number;
  expDate: number;
  expLabel: string;
  dte: number;
  strike: number;
  moneynessPct: number;
  moneynessLabel: string;
  moneynessColor: string;
  delta: number;
  bid: number | null;
  last: number | null;
  ask: number | null;
  iv: number | null;
  nomYieldBid: number | null;
  nomYieldAsk: number | null;
  nomYieldLast: number | null;
  annYieldBid: number | null;
  annYieldAsk: number | null;
  annYieldLast: number | null;
  volume: number | null;
  openInterest: number | null;
  volOI: number | null;
  ivRank: number | null;
}

type ScreenerSortField = 'ticker' | 'price' | 'expDate' | 'strike' | 'moneyness' | 'delta' | 'bid' | 'last' | 'ask' | 'iv' | 'nomYieldBid' | 'nomYieldAsk' | 'nomYieldLast' | 'annYieldBid' | 'annYieldAsk' | 'annYieldLast' | 'volume' | 'openInterest' | 'volOI' | 'ivRank';
type SortDir = 'asc' | 'desc';

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
  { value: '0-10_otm', label: '0-10% OTM' },
  { value: '10-20_otm', label: '10-20% OTM' },
  { value: '20-30_otm', label: '20-30% OTM' },
  { value: 'any_itm', label: 'Any ITM' },
  { value: '0-10_itm', label: '0-10% ITM' },
  { value: '10+_itm', label: '10%+ ITM' },
];

const YIELD_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '>5', label: '>5%' },
  { value: '>10', label: '>10%' },
  { value: '>15', label: '>15%' },
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

const IVRANK_OPTIONS = [
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

function matchDeltaAbs(delta: number, filter: string): boolean {
  if (filter === 'all') return true;
  const abs = Math.abs(delta);
  switch (filter) {
    case 'below_0.05': return abs < 0.05;
    case 'below_0.10': return abs < 0.10;
    case 'below_0.15': return abs < 0.15;
    case 'below_0.20': return abs < 0.20;
    case 'below_0.25': return abs < 0.25;
    case 'below_0.30': return abs < 0.30;
    case 'below_0.40': return abs < 0.40;
    case '0.05_to_0.15': return abs >= 0.05 && abs <= 0.15;
    case '0.10_to_0.20': return abs >= 0.10 && abs <= 0.20;
    case '0.15_to_0.25': return abs >= 0.15 && abs <= 0.25;
    case '0.20_to_0.30': return abs >= 0.20 && abs <= 0.30;
    case '0.30_to_0.50': return abs >= 0.30 && abs <= 0.50;
    case 'above_0.50': return abs > 0.50;
    default: return true;
  }
}

function matchMoneyness(moneynessPct: number, filter: string): boolean {
  if (filter === 'all') return true;
  const isOTM = moneynessPct > 0;
  const isITM = moneynessPct < 0;
  const absM = Math.abs(moneynessPct);
  switch (filter) {
    case 'otm_only': return isOTM;
    case 'itm_only': return isITM;
    case '5+_otm': return isOTM && absM >= 5;
    case '10+_otm': return isOTM && absM >= 10;
    case '15+_otm': return isOTM && absM >= 15;
    case '20+_otm': return isOTM && absM >= 20;
    case '25+_otm': return isOTM && absM >= 25;
    case '30+_otm': return isOTM && absM >= 30;
    case '0-10_otm': return isOTM && absM >= 0 && absM <= 10;
    case '10-20_otm': return isOTM && absM >= 10 && absM <= 20;
    case '20-30_otm': return isOTM && absM >= 20 && absM <= 30;
    case 'any_itm': return isITM;
    case '0-10_itm': return isITM && absM >= 0 && absM <= 10;
    case '10+_itm': return isITM && absM >= 10;
    default: return true;
  }
}

function matchYield(y: number | null, filter: string): boolean {
  if (filter === 'all') return true;
  if (y == null) return false;
  const threshold = parseFloat(filter.replace('>', ''));
  return y > threshold;
}

function matchOI(oi: number | null, filter: string): boolean {
  if (filter === 'all') return true;
  if (oi == null) return false;
  const threshold = parseFloat(filter.replace('>', ''));
  return oi > threshold;
}

function matchVol(vol: number | null, filter: string): boolean {
  if (filter === 'all') return true;
  if (vol == null) return false;
  const threshold = parseFloat(filter.replace('>', ''));
  return vol > threshold;
}

function matchIvRank(ivRank: number | null, filter: string): boolean {
  if (filter === 'all') return true;
  if (ivRank == null) return false;
  switch (filter) {
    case 'below_20': return ivRank < 20;
    case 'below_40': return ivRank < 40;
    case 'below_60': return ivRank < 60;
    case 'above_50': return ivRank >= 50;
    case 'above_70': return ivRank >= 70;
    case 'above_80': return ivRank >= 80;
    case 'above_90': return ivRank >= 90;
    case '20_to_50': return ivRank >= 20 && ivRank <= 50;
    case '50_to_80': return ivRank >= 50 && ivRank <= 80;
    default: return true;
  }
}

function deltaColor(d: number): string {
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

function ivRankColor(rank: number): string {
  if (rank >= 70) return 'var(--red)';
  if (rank >= 50) return 'var(--orange)';
  if (rank >= 30) return 'var(--yellow)';
  return 'var(--green)';
}

function formatExpDate(ts: number, dte: number): string {
  const d = new Date(ts * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear() % 100).padStart(2, '0');
  return `${mm}/${dd}/${yy} (${dte})`;
}

function formatExpDropdownLabel(ts: number, _dte: number): string {
  const d = new Date(ts * 1000);
  const month = d.toLocaleDateString('en-US', { month: 'short' });
  const day = d.getDate();
  const yr = `'${String(d.getFullYear() % 100).padStart(2, '0')}`;
  return `${month} ${day}, ${yr}`;
}

function computeMoneyness(currentPrice: number, strike: number): { pct: number; label: string; color: string } {
  if (currentPrice <= 0) return { pct: 0, label: '—', color: 'var(--text-muted)' };
  const pct = ((currentPrice - strike) / currentPrice) * 100;
  const absPct = Math.abs(pct);
  if (absPct < 0.5) return { pct, label: 'ATM', color: 'var(--yellow)' };
  if (pct > 0) return { pct, label: `${absPct.toFixed(2)}% OTM`, color: 'var(--green)' };
  return { pct, label: `${absPct.toFixed(2)}% ITM`, color: 'var(--red)' };
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
  const navigate = useNavigate();

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
  const [ivRankFilter, setIvRankFilter] = useState('all');
  const [showVolOI, setShowVolOI] = useState(false);

  // Data state
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [slowWarning, setSlowWarning] = useState(false);

  // Confirmation dialog
  const [showConfirm, setShowConfirm] = useState(false);

  // Sort
  const [sortField, setSortField] = useState<ScreenerSortField>('annYieldBid');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Cache for raw options data (client-side re-filtering)
  const cacheRef = useRef<Map<string, OptionsChainData>>(new Map());
  const rawRowsRef = useRef<ScreenerRow[]>([]);

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

  // Auto-fetch available expiration dates on mount (with memory + localStorage cache)
  const PREFETCH_ETFS = ['TQQQ', 'LABU', 'SSO', 'SOXL', 'UPRO', 'TNA', 'FAS'];

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
      const tasks = PREFETCH_ETFS.map(ticker => async () => {
        try {
          const cacheKey = `${ticker}:initial`;
          if (cacheRef.current.has(cacheKey)) {
            return cacheRef.current.get(cacheKey)!;
          }
          const data = await fetchOptions(ticker);
          cacheRef.current.set(cacheKey, data);
          return data;
        } catch {
          return null;
        }
      });

      const results = await fetchWithConcurrencyLimit(tasks, 5);
      if (cancelled) return;

      const allExps = new Map<number, { date: number; label: string; dte: number }>();
      for (const result of results) {
        if (result.status !== 'fulfilled' || !result.value) continue;
        const data = result.value;
        for (const exp of data.expirations) {
          if (!allExps.has(exp.date)) {
            allExps.set(exp.date, {
              date: exp.date,
              label: formatExpDropdownLabel(exp.date, exp.dte),
              dte: exp.dte,
            });
          }
        }
      }
      const sorted = Array.from(allExps.values()).sort((a, b) => a.date - b.date);
      setAvailableExps(sorted);
      setDatesLoaded(true);
      setLoadingDates(false);
      setExpirationsCache(sorted);
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
    const opts: { value: string; label: string }[] = [{ value: 'all', label: 'All dates' }];
    const hasShortDated = availableExps.some(e => e.dte <= 30);
    if (hasShortDated) {
      opts.push({ value: 'lte_30dte', label: '\u226430 DTE' });
    }
    for (const exp of availableExps) {
      if (exp.dte > 30) {
        const d = new Date(exp.date * 1000);
        const month = d.toLocaleDateString('en-US', { month: 'short' });
        const day = d.getDate();
        const yr = `'${String(d.getFullYear() % 100).padStart(2, '0')}`;
        opts.push({ value: `date_${exp.date}`, label: `${month} ${day}, ${yr} (${exp.dte} DTE)` });
      }
    }
    return opts;
  }, [availableExps]);

  // Nearest only shortcut
  const selectNearestOnly = () => {
    const nearestDates = new Map<number, number>();
    for (const [key, data] of cacheRef.current.entries()) {
      if (!key.endsWith(':initial')) continue;
      if (data.expirations.length > 0) {
        const nearest = data.expirations[0];
        if (!nearestDates.has(nearest.date) || nearest.dte < nearestDates.get(nearest.date)!) {
          nearestDates.set(nearest.date, nearest.dte);
        }
      }
    }
    let best: { date: number; dte: number } | null = null;
    for (const [date, dte] of nearestDates.entries()) {
      if (!best || dte < best.dte) best = { date, dte };
    }
    if (best) {
      setExpFilter(`date_${best.date}`);
    }
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
    setIvRankFilter('all');
  };

  // Determine which expirations to include based on filter
  // Hard limit: max 2 expiry dates (Opt 3)
  const getExpsToFetch = useCallback((allExps: { date: number; dte: number }[]) => {
    if (expFilter === 'all') return allExps.slice(0, 2); // hard limit
    if (expFilter === 'lte_30dte') {
      const shortDated = allExps.filter(e => e.dte <= 30);
      return shortDated.slice(0, 2); // max 2 short-dated
    }
    if (expFilter.startsWith('date_')) {
      const targetDate = parseInt(expFilter.replace('date_', ''));
      return allExps.filter(e => e.date === targetDate);
    }
    return allExps.slice(0, 2);
  }, [expFilter]);

  // Client-side re-filtering — when filters change but data is already loaded
  useEffect(() => {
    if (!loaded || rawRowsRef.current.length === 0) return;
    const filtered = rawRowsRef.current.filter(row => {
      if (!matchDeltaAbs(row.delta, deltaFilter)) return false;
      if (!matchMoneyness(row.moneynessPct, moneynessFilter)) return false;
      if (!matchYield(row.annYieldBid, yieldFilter)) return false;
      if (!matchOI(row.openInterest, oiFilter)) return false;
      if (!matchVol(row.volume, volFilter)) return false;
      if (!matchIvRank(row.ivRank, ivRankFilter)) return false;
      return true;
    });
    setRows(filtered);
  }, [deltaFilter, moneynessFilter, yieldFilter, oiFilter, volFilter, ivRankFilter, loaded]);

  // Load data
  const handleLoad = useCallback(async () => {
    if (selectedETFs.length === 0) {
      setShowConfirm(true);
      return;
    }
    await executeLoad(selectedETFs);
  }, [selectedETFs]);

  const executeLoad = useCallback(async (etfsToScan: ETFInfo[]) => {
    setShowConfirm(false);
    setLoading(true);
    setSlowWarning(false);
    setRows([]);

    // Phase 1: Fetch initial data for each ETF with concurrency limit (Opt 4)
    const initialResults = new Map<string, OptionsChainData>();
    const tasks1 = etfsToScan.map(etf => async () => {
      try {
        const cacheKey = `${etf.ticker}:initial`;
        if (cacheRef.current.has(cacheKey)) {
          initialResults.set(etf.ticker, cacheRef.current.get(cacheKey)!);
          return;
        }
        const data = await fetchOptions(etf.ticker);
        cacheRef.current.set(cacheKey, data);
        initialResults.set(etf.ticker, data);
      } catch { /* skip */ }
      setProgress(prev => ({ ...prev, current: prev.current + 1 }));
    });

    setProgress({ current: 0, total: etfsToScan.length });
    const startTime = Date.now();
    const slowCheck = setInterval(() => {
      if (Date.now() - startTime > 30000) setSlowWarning(true);
    }, 1000);

    await fetchWithConcurrencyLimit(tasks1, 5);

    // Phase 1.5: Fetch IV Rank for each ETF (non-blocking, best-effort)
    const ivRankMap = new Map<string, number | null>();
    const ivRankTasks = etfsToScan.map(etf => async () => {
      try {
        const data = await fetchIVRank(etf.ticker);
        ivRankMap.set(etf.ticker, data.ivRank);
      } catch {
        ivRankMap.set(etf.ticker, null);
      }
    });
    await fetchWithConcurrencyLimit(ivRankTasks, 3);

    // Collect all unique expirations
    const allExps = new Map<number, { date: number; label: string; dte: number }>();
    for (const [, data] of initialResults) {
      for (const exp of data.expirations) {
        if (!allExps.has(exp.date)) {
          allExps.set(exp.date, { date: exp.date, label: formatExpDropdownLabel(exp.date, exp.dte), dte: exp.dte });
        }
      }
    }
    const sortedExps = Array.from(allExps.values()).sort((a, b) => a.date - b.date);
    setAvailableExps(sortedExps);
    setDatesLoaded(true);
    setExpirationsCache(sortedExps);

    // Phase 2: Determine which expirations to fetch based on filter (max 2)
    const expsToFetch = getExpsToFetch(sortedExps);

    const fetchTasks: (() => Promise<void>)[] = [];
    let totalFetches = initialResults.size;

    for (const [ticker, initialData] of initialResults) {
      const initialExpDate = initialData.expirations[0]?.date;
      const additionalExps = expsToFetch.filter(e => e.date !== initialExpDate);

      for (const exp of additionalExps) {
        fetchTasks.push(async () => {
          try {
            const cacheKey = `${ticker}:${exp.date}`;
            if (cacheRef.current.has(cacheKey)) return;
            const data = await fetchOptions(ticker, exp.date);
            cacheRef.current.set(cacheKey, data);
          } catch { /* skip */ }
          setProgress(prev => ({ ...prev, current: prev.current + 1 }));
        });
      }
      totalFetches += additionalExps.length;
    }

    setProgress({ current: initialResults.size, total: totalFetches });
    if (fetchTasks.length > 0) {
      await fetchWithConcurrencyLimit(fetchTasks, 5);
    }

    clearInterval(slowCheck);

    // Phase 3: Build ALL rows (unfiltered) and store for client-side re-filtering
    const allRows: ScreenerRow[] = [];

    for (const [ticker, initialData] of initialResults) {
      const currentPrice = initialData.currentPrice;
      const etfExps = expsToFetch.filter(e =>
        initialData.expirations.some(ie => ie.date === e.date)
      );

      for (const exp of etfExps) {
        const cacheKey = `${ticker}:${exp.date}`;
        const data = cacheRef.current.has(cacheKey)
          ? cacheRef.current.get(cacheKey)!
          : (exp.date === initialData.expirations[0]?.date ? initialData : null);

        if (!data) continue;
        const price = data.currentPrice || currentPrice;
        const dte = Math.max(1, exp.dte);

        for (const p of data.puts) {
          let delta: number;
          if (p.delta != null && p.delta !== 0) {
            delta = p.delta;
          } else {
            const sigma = p.impliedVolatility != null && p.impliedVolatility > 0
              ? p.impliedVolatility / 100 : 0.80;
            delta = calculatePutDelta(price, p.strike, dte / 365, 0.045, sigma);
          }
          if (delta > 0) delta = -delta;
          if (delta > -0.01 && delta <= 0) delta = -0.01;

          const { pct: moneynessPct, label: moneynessLabel, color: moneynessColor } = computeMoneyness(price, p.strike);

          const nomYieldBid = p.bid != null && p.bid !== 0 && p.strike > 0 ? (p.bid / p.strike) * 100 : null;
          const nomYieldAsk = p.ask != null && p.ask !== 0 && p.strike > 0 ? (p.ask / p.strike) * 100 : null;
          const nomYieldLast = p.last != null && p.last !== 0 && p.strike > 0 ? (p.last / p.strike) * 100 : null;
          const annYieldBid = nomYieldBid != null ? nomYieldBid * (365 / dte) : null;
          const annYieldAsk = nomYieldAsk != null ? nomYieldAsk * (365 / dte) : null;
          const annYieldLast = nomYieldLast != null ? nomYieldLast * (365 / dte) : null;

          const volOI = (p.volume != null && p.volume > 0 && p.openInterest != null && p.openInterest > 0)
            ? p.volume / p.openInterest : null;

          allRows.push({
            ticker, currentPrice: price,
            expDate: exp.date, expLabel: formatExpDate(exp.date, dte), dte,
            strike: p.strike, moneynessPct, moneynessLabel, moneynessColor,
            delta, bid: p.bid, last: p.last, ask: p.ask,
            iv: p.impliedVolatility,
            nomYieldBid, nomYieldAsk, nomYieldLast,
            annYieldBid, annYieldAsk, annYieldLast,
            volume: p.volume, openInterest: p.openInterest, volOI,
            ivRank: ivRankMap.get(ticker) ?? null,
          });
        }
      }
    }

    rawRowsRef.current = allRows;

    const filtered = allRows.filter(row => {
      if (!matchDeltaAbs(row.delta, deltaFilter)) return false;
      if (!matchMoneyness(row.moneynessPct, moneynessFilter)) return false;
      if (!matchYield(row.annYieldBid, yieldFilter)) return false;
      if (!matchOI(row.openInterest, oiFilter)) return false;
      if (!matchVol(row.volume, volFilter)) return false;
      if (!matchIvRank(row.ivRank, ivRankFilter)) return false;
      return true;
    });

    setRows(filtered);
    setLoading(false);
    setLoaded(true);
  }, [expFilter, deltaFilter, moneynessFilter, yieldFilter, oiFilter, volFilter, ivRankFilter, getExpsToFetch]);

  // Sorted rows
  const sortedRows = useMemo(() => {
    const sorted = [...rows];
    sorted.sort((a, b) => {
      let aVal: number | string, bVal: number | string;
      switch (sortField) {
        case 'ticker': aVal = a.ticker; bVal = b.ticker; break;
        case 'price': aVal = a.currentPrice; bVal = b.currentPrice; break;
        case 'expDate': aVal = a.dte; bVal = b.dte; break;
        case 'strike': aVal = a.strike; bVal = b.strike; break;
        case 'moneyness': aVal = a.moneynessPct; bVal = b.moneynessPct; break;
        case 'delta': aVal = a.delta; bVal = b.delta; break;
        case 'bid': aVal = a.bid ?? -1; bVal = b.bid ?? -1; break;
        case 'last': aVal = a.last ?? -1; bVal = b.last ?? -1; break;
        case 'ask': aVal = a.ask ?? -1; bVal = b.ask ?? -1; break;
        case 'iv': aVal = a.iv ?? -1; bVal = b.iv ?? -1; break;
        case 'nomYieldBid': aVal = a.nomYieldBid ?? -1; bVal = b.nomYieldBid ?? -1; break;
        case 'nomYieldAsk': aVal = a.nomYieldAsk ?? -1; bVal = b.nomYieldAsk ?? -1; break;
        case 'nomYieldLast': aVal = a.nomYieldLast ?? -1; bVal = b.nomYieldLast ?? -1; break;
        case 'annYieldBid': aVal = a.annYieldBid ?? -1; bVal = b.annYieldBid ?? -1; break;
        case 'annYieldAsk': aVal = a.annYieldAsk ?? -1; bVal = b.annYieldAsk ?? -1; break;
        case 'annYieldLast': aVal = a.annYieldLast ?? -1; bVal = b.annYieldLast ?? -1; break;
        case 'volume': aVal = a.volume ?? -1; bVal = b.volume ?? -1; break;
        case 'openInterest': aVal = a.openInterest ?? -1; bVal = b.openInterest ?? -1; break;
        case 'volOI': aVal = a.volOI ?? -1; bVal = b.volOI ?? -1; break;
        case 'ivRank': aVal = a.ivRank ?? -1; bVal = b.ivRank ?? -1; break;
        default: aVal = a.annYieldBid ?? -1; bVal = b.annYieldBid ?? -1;
      }
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
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

  const baseColumns: { field: ScreenerSortField; label: string; align: string; hideOnMobile?: boolean; hideOnTablet?: boolean }[] = [
    { field: 'ticker', label: 'Symbol', align: 'text-left' },
    { field: 'price', label: 'Price', align: 'text-right', hideOnMobile: true },
    { field: 'expDate', label: 'Exp Date', align: 'text-right' },
    { field: 'strike', label: 'Strike', align: 'text-right' },
    { field: 'moneyness', label: 'Moneyness', align: 'text-right', hideOnMobile: true },
    { field: 'delta', label: 'Delta', align: 'text-right' },
    { field: 'bid', label: 'Bid', align: 'text-right' },
    { field: 'last', label: 'Last', align: 'text-right', hideOnMobile: true },
    { field: 'ask', label: 'Ask', align: 'text-right', hideOnMobile: true },
    { field: 'iv', label: 'Imp Vol', align: 'text-right', hideOnMobile: true },
    { field: 'nomYieldBid', label: 'Nom. Yield Bid', align: 'text-right', hideOnMobile: true, hideOnTablet: true },
    { field: 'nomYieldAsk', label: 'Nom. Yield Ask', align: 'text-right', hideOnMobile: true, hideOnTablet: true },
    { field: 'nomYieldLast', label: 'Nom. Yield Last', align: 'text-right', hideOnMobile: true, hideOnTablet: true },
    { field: 'annYieldBid', label: 'Ann. Yield Bid', align: 'text-right' },
    { field: 'annYieldAsk', label: 'Ann. Yield Ask', align: 'text-right', hideOnMobile: true },
    { field: 'annYieldLast', label: 'Ann. Yield Last', align: 'text-right', hideOnMobile: true, hideOnTablet: true },
    { field: 'ivRank', label: 'IV Rank', align: 'text-right', hideOnMobile: true },
  ];

  const volOIColumns: { field: ScreenerSortField; label: string; align: string; hideOnMobile?: boolean; hideOnTablet?: boolean }[] = [
    { field: 'volume', label: 'Volume', align: 'text-right', hideOnMobile: true },
    { field: 'openInterest', label: 'Open Int', align: 'text-right', hideOnMobile: true },
    { field: 'volOI', label: 'Vol/OI', align: 'text-right', hideOnMobile: true, hideOnTablet: true },
  ];

  const columns = showVolOI ? [...baseColumns, ...volOIColumns] : baseColumns;

  const progressPct = progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0;

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
        {/* Filter Bar */}
        <div className="rounded-xl p-3 sm:p-4 mb-3 sm:mb-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-end gap-3">
            {/* ETF Selector */}
            <div className="w-full sm:min-w-[180px] sm:w-auto">
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>ETFs</label>
              <div className="relative">
                <div className="flex flex-wrap gap-1 p-1.5 rounded-lg min-h-[32px]" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)' }}>
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
                    className="bg-transparent text-xs outline-none flex-1 min-w-[60px]"
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

            {/* Expiration - single-select dropdown (max 2 expiries enforced by getExpsToFetch) */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>
                Expiration
                {loadingDates && <Loader2 className="w-3 h-3 inline ml-1 animate-spin" />}
              </label>
              <select
                value={expFilter}
                onChange={e => setExpFilter(e.target.value)}
                className="rounded-lg px-2 py-1.5 text-xs outline-none cursor-pointer"
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
              >
                {loadingDates && !datesLoaded && <option value="lte_30dte">Loading dates...</option>}
                {expDropdownOptions.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              {datesLoaded && (
                <button
                  onClick={selectNearestOnly}
                  className="ml-1 text-[10px] px-2 py-0.5 rounded transition-colors"
                  style={{ color: 'var(--accent-light)', backgroundColor: 'var(--accent-bg)' }}
                >
                  Nearest only
                </button>
              )}
            </div>

            {/* Delta (abs) */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Delta (abs)</label>
              <select value={deltaFilter} onChange={e => setDeltaFilter(e.target.value)}
                className="rounded-lg px-2 py-1.5 text-xs outline-none cursor-pointer"
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {DELTA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Moneyness */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Moneyness</label>
              <select value={moneynessFilter} onChange={e => setMoneynessFilter(e.target.value)}
                className="rounded-lg px-2 py-1.5 text-xs outline-none cursor-pointer"
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {MONEYNESS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Ann Yield */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Ann. Yield</label>
              <select value={yieldFilter} onChange={e => setYieldFilter(e.target.value)}
                className="rounded-lg px-2 py-1.5 text-xs outline-none cursor-pointer"
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {YIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Min OI */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Min OI</label>
              <select value={oiFilter} onChange={e => setOiFilter(e.target.value)}
                className="rounded-lg px-2 py-1.5 text-xs outline-none cursor-pointer"
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {OI_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Min Volume */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Min Vol</label>
              <select value={volFilter} onChange={e => setVolFilter(e.target.value)}
                className="rounded-lg px-2 py-1.5 text-xs outline-none cursor-pointer"
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {VOL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* IV Rank */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>IV Rank</label>
              <select value={ivRankFilter} onChange={e => setIvRankFilter(e.target.value)}
                className="rounded-lg px-2 py-1.5 text-xs outline-none cursor-pointer"
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                {IVRANK_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleLoad}
                disabled={loading}
                className="px-4 py-1.5 text-white text-xs font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                {loading ? `Scanning... (${progress.current} of ${progress.total})` : 'Load'}
              </button>
              <button
                onClick={clearFilters}
                className="px-3 py-1.5 text-xs font-medium rounded-lg transition-all"
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
                  <div className="flex items-center justify-center" style={{ width: 160, height: 60 }}>
                    <Loader2 className="w-4 h-4 animate-spin" style={{ color: 'var(--text-muted)' }} />
                  </div>
                ) : vixData ? (
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
                    {lastVixUpdate && (
                      <div className="text-[9px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
                        {lastVixUpdate.toLocaleTimeString()}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex items-center justify-center text-xs" style={{ width: 160, height: 60, color: 'var(--text-muted)' }}>N/A</div>
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
        </div>

        {/* Confirmation dialog */}
        {showConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
            <div className="rounded-xl p-6 max-w-sm mx-4" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text)' }}>Scan All ETFs?</h3>
              <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
                Scanning all ETFs will make approximately 40-80 API calls. Proceed?
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
                  onClick={() => executeLoad(ETF_LIST)}
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
        <div className="flex items-center justify-between mb-2 px-1">
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {loaded ? `Showing ${sortedRows.length} results` : ''}
          </span>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-muted)' }}>
            <input
              type="checkbox"
              checked={showVolOI}
              onChange={e => setShowVolOI(e.target.checked)}
              className="rounded"
            />
            Show Volume / OI columns
          </label>
        </div>

        {/* Table */}
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
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
                    <td colSpan={columns.length} className="py-16 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                      No options match your current filters
                    </td>
                  </tr>
                )}
                {sortedRows.map((row, idx) => {
                  const bgStyle = idx % 2 !== 0 ? { backgroundColor: 'var(--row-alt)' } : {};

                  return (
                    <tr key={`${row.ticker}-${row.expDate}-${row.strike}`} className="transition-colors" style={{ borderBottom: '1px solid var(--border)', ...bgStyle }}>
                      <td className="px-2 py-1 text-left whitespace-nowrap sticky left-0 z-[2] border-r" style={{ borderColor: 'var(--border)', backgroundColor: bgStyle.backgroundColor || 'var(--surface)' }}>
                        <button
                          onClick={() => navigate(`/options/${row.ticker}`)}
                          className="font-mono font-bold hover:opacity-80 transition-opacity min-h-[44px]"
                          style={{ color: 'var(--accent-light)' }}
                        >
                          {row.ticker}
                        </button>
                      </td>
                      <td className="px-2 py-1 text-right font-mono hidden md:table-cell" style={{ color: 'var(--text)' }}>{formatPrice(row.currentPrice)}</td>
                      <td className="px-2 py-1 text-right font-mono whitespace-nowrap" style={{ color: 'var(--text-secondary)' }}>{row.expLabel}</td>
                      <td className="px-2 py-1 text-right font-mono font-semibold" style={{ color: row.moneynessPct > 0 ? 'var(--green)' : row.moneynessPct < 0 ? 'var(--red)' : 'var(--text)' }}>
                        {formatPrice(row.strike)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono hidden md:table-cell" style={{ color: row.moneynessColor }}>
                        {row.moneynessLabel}
                      </td>
                      <td className="px-2 py-1 text-right font-mono" style={{ color: deltaColor(row.delta) }}>
                        {row.delta.toFixed(2)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono" style={{ color: 'var(--text)' }}>{formatPrice(row.bid)}</td>
                      <td className="px-2 py-1 text-right font-mono hidden md:table-cell" style={{ color: 'var(--text)' }}>{formatPrice(row.last)}</td>
                      <td className="px-2 py-1 text-right font-mono hidden md:table-cell" style={{ color: 'var(--text)' }}>{formatPrice(row.ask)}</td>
                      <td className="px-2 py-1 text-right font-mono hidden md:table-cell" style={{ color: ivColor(row.iv) }}>
                        {row.iv != null ? row.iv.toFixed(1) + '%' : '—'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>
                        {row.nomYieldBid != null ? row.nomYieldBid.toFixed(2) + '%' : '—'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>
                        {row.nomYieldAsk != null ? row.nomYieldAsk.toFixed(2) + '%' : '—'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono hidden lg:table-cell" style={{ color: 'var(--text-secondary)' }}>
                        {row.nomYieldLast != null ? row.nomYieldLast.toFixed(2) + '%' : '—'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono font-medium" style={{ color: annYieldColor(row.annYieldBid) }}>
                        {row.annYieldBid != null ? row.annYieldBid.toFixed(2) + '%' : '—'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono hidden md:table-cell" style={{ color: annYieldColor(row.annYieldAsk) }}>
                        {row.annYieldAsk != null ? row.annYieldAsk.toFixed(2) + '%' : '—'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono hidden lg:table-cell" style={{ color: annYieldColor(row.annYieldLast) }}>
                        {row.annYieldLast != null ? row.annYieldLast.toFixed(2) + '%' : '—'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono hidden md:table-cell" style={{ color: row.ivRank != null ? ivRankColor(row.ivRank) : 'var(--text-dim)' }}>
                        {row.ivRank != null ? row.ivRank.toFixed(0) + '%' : '—'}
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
    </div>
  );
}
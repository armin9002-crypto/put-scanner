import { useState, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ETF_LIST } from '../lib/etfs';
import type { ETFInfo, OptionsChainData, ExpirationDate } from '../lib/types';
import { fetchOptions, calculatePutDelta, formatPrice, formatNumber } from '../lib/api';
import { Search, X, ChevronUp, ChevronDown, Loader2, AlertTriangle } from 'lucide-react';

// --- Types ---

interface ScreenerRow {
  ticker: string;
  currentPrice: number;
  expDate: number;
  expLabel: string;
  dte: number;
  strike: number;
  moneynessPct: number;
  bid: number | null;
  last: number | null;
  ask: number | null;
  volume: number | null;
  openInterest: number | null;
  volOI: number | null;
  iv: number | null;
  annYieldBid: number | null;
  annYieldAsk: number | null;
  annYieldLast: number | null;
  delta: number;
}

type ScreenerSortField = 'ticker' | 'price' | 'expDate' | 'strike' | 'moneyness' | 'bid' | 'last' | 'ask' | 'volume' | 'openInterest' | 'volOI' | 'iv' | 'annYieldBid' | 'annYieldAsk' | 'annYieldLast' | 'delta';
type SortDir = 'asc' | 'desc';

// --- Filter options ---

const EXPIRY_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'this_week', label: 'This Week' },
  { value: 'next_week', label: 'Next Week' },
  { value: 'this_month', label: 'This Month' },
  { value: 'next_month', label: 'Next Month' },
  { value: '0-7', label: '0-7 DTE' },
  { value: '8-14', label: '8-14 DTE' },
  { value: '15-30', label: '15-30 DTE' },
  { value: '31-60', label: '31-60 DTE' },
  { value: '61-90', label: '61-90 DTE' },
  { value: '90+', label: '90+ DTE' },
];

const DELTA_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'below_-0.05', label: 'Below -0.05' },
  { value: 'below_-0.10', label: 'Below -0.10' },
  { value: 'below_-0.20', label: 'Below -0.20' },
  { value: 'below_-0.30', label: 'Below -0.30' },
  { value: 'below_-0.40', label: 'Below -0.40' },
  { value: '-0.10_to_-0.20', label: '-0.10 to -0.20' },
  { value: '-0.20_to_-0.30', label: '-0.20 to -0.30' },
  { value: '-0.30_to_-0.40', label: '-0.30 to -0.40' },
];

const OTM_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: '5+', label: '5%+ OTM' },
  { value: '10+', label: '10%+ OTM' },
  { value: '15+', label: '15%+ OTM' },
  { value: '20+', label: '20%+ OTM' },
  { value: '25+', label: '25%+ OTM' },
  { value: '30+', label: '30%+ OTM' },
  { value: '0-10', label: '0-10% OTM' },
  { value: '10-20', label: '10-20% OTM' },
  { value: '20-30', label: '20-30% OTM' },
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

// --- Helpers ---

function filterExpirations(exps: ExpirationDate[], filter: string): ExpirationDate[] {
  if (filter === 'all') return exps;
  const now = new Date();
  const endOfWeek = new Date(now);
  endOfWeek.setDate(now.getDate() + (5 - now.getDay() + 7) % 7);
  const endOfNextWeek = new Date(endOfWeek);
  endOfNextWeek.setDate(endOfWeek.getDate() + 7);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const endOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 2, 0);

  return exps.filter(e => {
    switch (filter) {
      case 'this_week': return e.dte <= 7 && new Date(e.date * 1000) <= endOfWeek;
      case 'next_week': { const d = new Date(e.date * 1000); return d > endOfWeek && d <= endOfNextWeek; }
      case 'this_month': return new Date(e.date * 1000) <= endOfMonth;
      case 'next_month': { const d = new Date(e.date * 1000); return d > endOfMonth && d <= endOfNextMonth; }
      case '0-7': return e.dte >= 0 && e.dte <= 7;
      case '8-14': return e.dte >= 8 && e.dte <= 14;
      case '15-30': return e.dte >= 15 && e.dte <= 30;
      case '31-60': return e.dte >= 31 && e.dte <= 60;
      case '61-90': return e.dte >= 61 && e.dte <= 90;
      case '90+': return e.dte > 90;
      default: return true;
    }
  });
}

function matchDelta(delta: number, filter: string): boolean {
  if (filter === 'all') return true;
  switch (filter) {
    case 'below_-0.05': return delta < -0.05;
    case 'below_-0.10': return delta < -0.10;
    case 'below_-0.20': return delta < -0.20;
    case 'below_-0.30': return delta < -0.30;
    case 'below_-0.40': return delta < -0.40;
    case '-0.10_to_-0.20': return delta >= -0.20 && delta <= -0.10;
    case '-0.20_to_-0.30': return delta >= -0.30 && delta <= -0.20;
    case '-0.30_to_-0.40': return delta >= -0.40 && delta <= -0.30;
    default: return true;
  }
}

function matchOTM(otmPct: number, filter: string): boolean {
  if (filter === 'all') return true;
  if (otmPct <= 0) return false;
  switch (filter) {
    case '5+': return otmPct >= 5;
    case '10+': return otmPct >= 10;
    case '15+': return otmPct >= 15;
    case '20+': return otmPct >= 20;
    case '25+': return otmPct >= 25;
    case '30+': return otmPct >= 30;
    case '0-10': return otmPct >= 0 && otmPct <= 10;
    case '10-20': return otmPct >= 10 && otmPct <= 20;
    case '20-30': return otmPct >= 20 && otmPct <= 30;
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

async function concurrentFetch(tasks: (() => Promise<void>)[], concurrency: number): Promise<void> {
  let i = 0;
  const run = async (): Promise<void> => {
    while (i < tasks.length) {
      const idx = i++;
      await tasks[idx]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => run()));
}

function deltaColor(d: number): string {
  const abs = Math.abs(d);
  if (abs >= 0.7) return '#dc2626';
  if (abs >= 0.5) return '#ef4444';
  if (abs >= 0.3) return '#f97316';
  if (abs >= 0.15) return '#eab308';
  return '#64748b';
}

function annYieldColor(y: number | null): string {
  if (y == null) return '#475569';
  if (y > 50) return '#22c55e';
  if (y >= 25) return '#f97316';
  if (y >= 10) return '#eab308';
  return '#64748b';
}

function ivColor(iv: number | null): string {
  if (iv == null) return '#475569';
  if (iv < 50) return '#22c55e';
  if (iv < 100) return '#eab308';
  if (iv < 150) return '#f97316';
  return '#ef4444';
}

function formatExpDate(ts: number, dte: number): string {
  const d = new Date(ts * 1000);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const yy = String(d.getFullYear() % 100).padStart(2, '0');
  return `${mm}/${dd}/${yy} (${dte})`;
}

// --- Component ---

export default function ScreenerPage() {
  const navigate = useNavigate();

  // Filters
  const [selectedETFs, setSelectedETFs] = useState<ETFInfo[]>([]);
  const [etfSearch, setEtfSearch] = useState('');
  const [showEtfDropdown, setShowEtfDropdown] = useState(false);
  const [expiryFilter, setExpiryFilter] = useState('all');
  const [deltaFilter, setDeltaFilter] = useState('all');
  const [otmFilter, setOtmFilter] = useState('all');
  const [yieldFilter, setYieldFilter] = useState('all');
  const [oiFilter, setOiFilter] = useState('all');
  const [volFilter, setVolFilter] = useState('all');

  // Data state
  const [rows, setRows] = useState<ScreenerRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [slowWarning, setSlowWarning] = useState(false);

  // Sort
  const [sortField, setSortField] = useState<ScreenerSortField>('annYieldBid');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // Cache
  const cacheRef = useRef<Map<string, OptionsChainData>>(new Map());
  const lastFetchKeyRef = useRef<string>('');

  const etfSearchRef = useRef<HTMLDivElement>(null);

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

  // Clear filters
  const clearFilters = () => {
    setSelectedETFs([]);
    setEtfSearch('');
    setExpiryFilter('all');
    setDeltaFilter('all');
    setOtmFilter('all');
    setYieldFilter('all');
    setOiFilter('all');
    setVolFilter('all');
  };

  // Load data
  const handleLoad = useCallback(async () => {
    const etfsToScan = selectedETFs.length > 0 ? selectedETFs : ETF_LIST;
    const fetchKey = `${etfsToScan.map(e => e.ticker).sort().join(',')}:${expiryFilter}`;

    setLoading(true);
    setSlowWarning(false);
    setRows([]);

    let shouldRefetch = fetchKey !== lastFetchKeyRef.current;
    if (shouldRefetch) {
      cacheRef.current.clear();
    }
    lastFetchKeyRef.current = fetchKey;

    // Phase 1: Fetch initial data for each ETF (nearest expiry + expiration list)
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

    await concurrentFetch(tasks1, 5);

    // Phase 2: Determine which expirations to fetch based on filter
    const fetchTasks: (() => Promise<void>)[] = [];
    let totalFetches = initialResults.size;

    for (const [ticker, initialData] of initialResults) {
      const filteredExps = filterExpirations(initialData.expirations, expiryFilter);
      // The initial fetch already includes the nearest expiry data
      // We need to fetch additional expirations
      const initialExpDate = initialData.expirations[0]?.date;
      const additionalExps = filteredExps.filter(e => e.date !== initialExpDate);

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
      await concurrentFetch(fetchTasks, 5);
    }

    clearInterval(slowCheck);

    // Phase 3: Build rows from cached data
    const allRows: ScreenerRow[] = [];

    for (const [ticker, initialData] of initialResults) {
      const filteredExps = filterExpirations(initialData.expirations, expiryFilter);
      const currentPrice = initialData.currentPrice;

      for (const exp of filteredExps) {
        const cacheKey = `${ticker}:${exp.date}`;
        const data = cacheRef.current.has(cacheKey)
          ? cacheRef.current.get(cacheKey)!
          : (exp.date === initialData.expirations[0]?.date ? initialData : null);

        if (!data) continue;
        const price = data.currentPrice || currentPrice;
        const dte = Math.max(1, exp.dte);

        for (const p of data.puts) {
          // Compute delta
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

          // Moneyness
          const moneynessPct = price > 0 ? ((price - p.strike) / price) * 100 : 0;

          // Yields
          const annYieldBid = p.bid != null && p.bid !== 0 && p.strike > 0
            ? (p.bid / p.strike) * 100 * (365 / dte) : null;
          const annYieldAsk = p.ask != null && p.ask !== 0 && p.strike > 0
            ? (p.ask / p.strike) * 100 * (365 / dte) : null;
          const annYieldLast = p.last != null && p.last !== 0 && p.strike > 0
            ? (p.last / p.strike) * 100 * (365 / dte) : null;

          // Vol/OI
          const volOI = (p.volume != null && p.volume > 0 && p.openInterest != null && p.openInterest > 0)
            ? p.volume / p.openInterest : null;

          const row: ScreenerRow = {
            ticker, currentPrice: price,
            expDate: exp.date, expLabel: formatExpDate(exp.date, dte), dte,
            strike: p.strike, moneynessPct,
            bid: p.bid, last: p.last, ask: p.ask,
            volume: p.volume, openInterest: p.openInterest,
            volOI, iv: p.impliedVolatility,
            annYieldBid, annYieldAsk, annYieldLast, delta,
          };

          // Apply filters
          if (!matchDelta(delta, deltaFilter)) continue;
          if (!matchOTM(moneynessPct, otmFilter)) continue;
          if (!matchYield(annYieldBid, yieldFilter)) continue;
          if (!matchOI(p.openInterest, oiFilter)) continue;
          if (!matchVol(p.volume, volFilter)) continue;

          allRows.push(row);
        }
      }
    }

    setRows(allRows);
    setLoading(false);
    setLoaded(true);
  }, [selectedETFs, expiryFilter, deltaFilter, otmFilter, yieldFilter, oiFilter, volFilter]);

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
        case 'bid': aVal = a.bid ?? -1; bVal = b.bid ?? -1; break;
        case 'last': aVal = a.last ?? -1; bVal = b.last ?? -1; break;
        case 'ask': aVal = a.ask ?? -1; bVal = b.ask ?? -1; break;
        case 'volume': aVal = a.volume ?? -1; bVal = b.volume ?? -1; break;
        case 'openInterest': aVal = a.openInterest ?? -1; bVal = b.openInterest ?? -1; break;
        case 'volOI': aVal = a.volOI ?? -1; bVal = b.volOI ?? -1; break;
        case 'iv': aVal = a.iv ?? -1; bVal = b.iv ?? -1; break;
        case 'annYieldBid': aVal = a.annYieldBid ?? -1; bVal = b.annYieldBid ?? -1; break;
        case 'annYieldAsk': aVal = a.annYieldAsk ?? -1; bVal = b.annYieldAsk ?? -1; break;
        case 'annYieldLast': aVal = a.annYieldLast ?? -1; bVal = b.annYieldLast ?? -1; break;
        case 'delta': aVal = a.delta; bVal = b.delta; break;
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
    if (sortField !== field) return <ChevronUp className="w-3 h-3 text-[#475569] opacity-40" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-[#6366f1]" />
      : <ChevronDown className="w-3 h-3 text-[#6366f1]" />;
  }

  const columns: { field: ScreenerSortField; label: string; align: string }[] = [
    { field: 'ticker', label: 'Symbol', align: 'text-left' },
    { field: 'price', label: 'Price', align: 'text-right' },
    { field: 'expDate', label: 'Exp Date', align: 'text-right' },
    { field: 'strike', label: 'Strike', align: 'text-right' },
    { field: 'moneyness', label: 'Moneyness', align: 'text-right' },
    { field: 'bid', label: 'Bid', align: 'text-right' },
    { field: 'last', label: 'Last', align: 'text-right' },
    { field: 'ask', label: 'Ask', align: 'text-right' },
    { field: 'volume', label: 'Volume', align: 'text-right' },
    { field: 'openInterest', label: 'Open Int', align: 'text-right' },
    { field: 'volOI', label: 'Vol/OI', align: 'text-right' },
    { field: 'iv', label: 'Imp Vol', align: 'text-right' },
    { field: 'annYieldBid', label: 'Ann. Yield Bid', align: 'text-right' },
    { field: 'annYieldAsk', label: 'Ann. Yield Ask', align: 'text-right' },
    { field: 'annYieldLast', label: 'Ann. Yield Last', align: 'text-right' },
    { field: 'delta', label: 'Delta', align: 'text-right' },
  ];

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-4">
        {/* Filter Bar */}
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-4 mb-4">
          <div className="flex flex-wrap items-end gap-3">
            {/* ETF Selector */}
            <div className="min-w-[180px]" ref={etfSearchRef}>
              <label className="block text-[10px] uppercase tracking-wider text-[#64748b] mb-1">ETFs</label>
              <div className="relative">
                <div className="flex flex-wrap gap-1 p-1.5 bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg min-h-[32px]">
                  {selectedETFs.map(e => (
                    <span key={e.ticker} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-[#6366f1]/15 text-[#818cf8] text-xs rounded border border-[#6366f1]/20">
                      {e.ticker}
                      <button onClick={() => removeETF(e.ticker)} className="hover:text-white"><X className="w-3 h-3" /></button>
                    </span>
                  ))}
                  <input
                    type="text"
                    value={etfSearch}
                    onChange={e => { setEtfSearch(e.target.value); setShowEtfDropdown(true); }}
                    onFocus={() => setShowEtfDropdown(true)}
                    placeholder={selectedETFs.length === 0 ? 'All ETFs...' : ''}
                    className="bg-transparent text-xs text-[#e2e8f0] placeholder-[#475569] outline-none flex-1 min-w-[60px]"
                  />
                </div>
                {showEtfDropdown && etfOptions.length > 0 && (
                  <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[#12121a] border border-[#1e1e2e] rounded-lg max-h-40 overflow-y-auto shadow-xl">
                    {etfOptions.slice(0, 20).map(e => (
                      <button
                        key={e.ticker}
                        onClick={() => addETF(e)}
                        className="w-full text-left px-3 py-1.5 text-xs text-[#e2e8f0] hover:bg-[#6366f1]/10 transition-colors"
                      >
                        <span className="font-mono font-semibold">{e.ticker}</span>
                        <span className="text-[#64748b] ml-2">{e.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Expiry */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[#64748b] mb-1">Expiration</label>
              <select value={expiryFilter} onChange={e => setExpiryFilter(e.target.value)}
                className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-2 py-1.5 text-xs text-[#e2e8f0] outline-none cursor-pointer">
                {EXPIRY_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Delta */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[#64748b] mb-1">Delta</label>
              <select value={deltaFilter} onChange={e => setDeltaFilter(e.target.value)}
                className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-2 py-1.5 text-xs text-[#e2e8f0] outline-none cursor-pointer">
                {DELTA_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* % OTM */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[#64748b] mb-1">% OTM</label>
              <select value={otmFilter} onChange={e => setOtmFilter(e.target.value)}
                className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-2 py-1.5 text-xs text-[#e2e8f0] outline-none cursor-pointer">
                {OTM_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Ann Yield */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[#64748b] mb-1">Ann. Yield</label>
              <select value={yieldFilter} onChange={e => setYieldFilter(e.target.value)}
                className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-2 py-1.5 text-xs text-[#e2e8f0] outline-none cursor-pointer">
                {YIELD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Min OI */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[#64748b] mb-1">Min OI</label>
              <select value={oiFilter} onChange={e => setOiFilter(e.target.value)}
                className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-2 py-1.5 text-xs text-[#e2e8f0] outline-none cursor-pointer">
                {OI_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Min Volume */}
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-[#64748b] mb-1">Min Vol</label>
              <select value={volFilter} onChange={e => setVolFilter(e.target.value)}
                className="bg-[#0a0a0f] border border-[#1e1e2e] rounded-lg px-2 py-1.5 text-xs text-[#e2e8f0] outline-none cursor-pointer">
                {VOL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>

            {/* Buttons */}
            <div className="flex gap-2">
              <button
                onClick={handleLoad}
                disabled={loading}
                className="px-4 py-1.5 bg-[#6366f1] text-white text-xs font-medium rounded-lg hover:bg-[#5558e6] disabled:opacity-50 transition-all flex items-center gap-1.5"
              >
                {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
                {loading ? `Loading ${progress.current}/${progress.total}...` : 'Load'}
              </button>
              <button
                onClick={clearFilters}
                className="px-3 py-1.5 bg-[#1e1e2e] text-[#94a3b8] text-xs font-medium rounded-lg hover:bg-[#2a2a3e] transition-all"
              >
                Clear
              </button>
            </div>
          </div>

          {slowWarning && (
            <div className="flex items-center gap-2 mt-3 text-xs text-amber-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              This is taking longer than expected — try narrowing your filters
            </div>
          )}
        </div>

        {/* Results header */}
        {loaded && (
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs text-[#64748b]">Showing {sortedRows.length} results</span>
          </div>
        )}

        {/* Table */}
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0e0e16] border-b border-[#1e1e2e]">
                  {columns.map(col => (
                    <th
                      key={col.field}
                      onClick={() => handleSort(col.field)}
                      className={`px-2 py-1.5 text-[10px] uppercase tracking-wider font-medium text-[#64748b] cursor-pointer hover:text-[#e2e8f0] transition-colors select-none whitespace-nowrap ${col.align} ${
                        col.field === 'ticker' ? 'sticky left-0 z-[3] bg-[#0e0e16] border-r border-[#1e1e2e]' : ''
                      }`}
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
                    <td colSpan={columns.length} className="py-16 text-center text-[#64748b] text-sm">
                      Select your filters and click Load to scan options
                    </td>
                  </tr>
                )}
                {loaded && sortedRows.length === 0 && (
                  <tr>
                    <td colSpan={columns.length} className="py-16 text-center text-[#64748b] text-sm">
                      No options match your current filters
                    </td>
                  </tr>
                )}
                {sortedRows.map((row, idx) => {
                  const isITM = row.moneynessPct < 0;
                  const isOTM = row.moneynessPct > 0;
                  const bgClass = idx % 2 === 0 ? '' : 'bg-white/[0.01]';

                  return (
                    <tr key={`${row.ticker}-${row.expDate}-${row.strike}`} className={`border-b border-[#1e1e2e]/30 hover:bg-white/[0.02] transition-colors ${bgClass}`}>
                      <td className={`px-2 py-1 text-left whitespace-nowrap sticky left-0 z-[2] border-r border-[#1e1e2e] ${bgClass}`}>
                        <button
                          onClick={() => navigate(`/options/${row.ticker}`)}
                          className="font-mono font-bold text-[#818cf8] hover:text-[#a5b4fc] transition-colors"
                        >
                          {row.ticker}
                        </button>
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-[#e2e8f0]">{formatPrice(row.currentPrice)}</td>
                      <td className="px-2 py-1 text-right font-mono text-[#94a3b8] whitespace-nowrap">{row.expLabel}</td>
                      <td className="px-2 py-1 text-right font-mono" style={{ color: isITM ? '#ef4444' : isOTM ? '#22c55e' : '#e2e8f0', fontWeight: 600 }}>
                        {formatPrice(row.strike)}
                      </td>
                      <td className="px-2 py-1 text-right font-mono" style={{ color: isOTM ? '#22c55e' : isITM ? '#ef4444' : '#64748b' }}>
                        {row.moneynessPct.toFixed(2)}%
                      </td>
                      <td className="px-2 py-1 text-right font-mono text-[#e2e8f0]">{formatPrice(row.bid)}</td>
                      <td className="px-2 py-1 text-right font-mono text-[#e2e8f0]">{formatPrice(row.last)}</td>
                      <td className="px-2 py-1 text-right font-mono text-[#e2e8f0]">{formatPrice(row.ask)}</td>
                      <td className="px-2 py-1 text-right font-mono text-[#94a3b8]">{formatNumber(row.volume)}</td>
                      <td className="px-2 py-1 text-right font-mono text-[#94a3b8]">{formatNumber(row.openInterest)}</td>
                      <td className="px-2 py-1 text-right font-mono text-[#94a3b8]">{row.volOI != null ? row.volOI.toFixed(2) : '—'}</td>
                      <td className="px-2 py-1 text-right font-mono" style={{ color: ivColor(row.iv) }}>
                        {row.iv != null ? row.iv.toFixed(1) + '%' : '—'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono font-medium" style={{ color: annYieldColor(row.annYieldBid) }}>
                        {row.annYieldBid != null ? row.annYieldBid.toFixed(2) + '%' : '—'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono" style={{ color: annYieldColor(row.annYieldAsk) }}>
                        {row.annYieldAsk != null ? row.annYieldAsk.toFixed(2) + '%' : '—'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono" style={{ color: annYieldColor(row.annYieldLast) }}>
                        {row.annYieldLast != null ? row.annYieldLast.toFixed(2) + '%' : '—'}
                      </td>
                      <td className="px-2 py-1 text-right font-mono" style={{ color: deltaColor(row.delta) }}>
                        {row.delta.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <footer className="mt-6 pb-4 text-center">
          <p className="text-[10px] text-[#475569]">Data delayed up to 15 minutes. Not financial advice.</p>
        </footer>
      </div>
    </div>
  );
}

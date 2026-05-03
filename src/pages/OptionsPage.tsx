import { useState, useEffect, useCallback, useMemo } from 'react';
import type { ETFInfo, OptionsChainData, SortField, SortDirection } from '../lib/types';
import { fetchOptions, fetchPrice, calculatePutDelta, formatPrice, formatYield, yieldColor, formatNumber } from '../lib/api';
import {
  ArrowLeft, RefreshCw, TrendingUp, TrendingDown, AlertCircle,
  ChevronUp, ChevronDown
} from 'lucide-react';

interface OptionsPageProps {
  etf: ETFInfo;
  onBack: () => void;
}

interface EnrichedPut {
  strike: number;
  last: number | null;
  bid: number | null;
  ask: number | null;
  delta: number;
  impliedVolatility: number | null;
  volume: number | null;
  openInterest: number | null;
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

function SkeletonRow() {
  return (
    <tr className="border-b border-[#1e1e2e]/50">
      {Array.from({ length: 15 }).map((_, i) => (
        <td key={i} className="px-3 py-2.5">
          <div className="h-4 w-16 rounded bg-[#1e1e2e] animate-pulse" />
        </td>
      ))}
    </tr>
  );
}

export default function OptionsPage({ etf, onBack }: OptionsPageProps) {
  const [optionsData, setOptionsData] = useState<OptionsChainData | null>(null);
  const [priceData, setPriceData] = useState<{ price: number; change: number; changePercent: number } | null>(null);
  const [selectedExp, setSelectedExp] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortField, setSortField] = useState<SortField>('strike');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  const loadData = useCallback(async (expDate?: number) => {
    setLoading(true);
    setError(null);
    try {
      const [opts, price] = await Promise.all([
        fetchOptions(etf.ticker, expDate),
        fetchPrice(etf.ticker),
      ]);
      setOptionsData(opts);
      setPriceData(price);
      if (!expDate && opts.expirations.length > 0) {
        setSelectedExp(opts.expirations[0].date);
      }
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message || 'Failed to load options data');
    } finally {
      setLoading(false);
    }
  }, [etf.ticker]);

  const loadExpiration = useCallback(async (expDate: number) => {
    setSelectedExp(expDate);
    setLoading(true);
    setError(null);
    try {
      const opts = await fetchOptions(etf.ticker, expDate);
      setOptionsData(opts);
      const price = await fetchPrice(etf.ticker);
      setPriceData(price);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message || 'Failed to load expiration data');
    } finally {
      setLoading(false);
    }
  }, [etf.ticker]);

  useEffect(() => { loadData(); }, [loadData]);

  const currentPrice = priceData?.price ?? optionsData?.currentPrice ?? 0;
  const changePositive = priceData ? priceData.changePercent >= 0 : true;

  const enrichedPuts = useMemo((): EnrichedPut[] => {
    if (!optionsData?.puts) return [];
    const exp = optionsData.expirations.find(e => e.date === selectedExp);
    const dte = exp?.dte ?? 1;

    return optionsData.puts.map(p => {
      // Delta: use Yahoo value if available and non-zero, otherwise Black-Scholes fallback
      let delta: number;
      if (p.delta != null && p.delta !== 0) {
        delta = p.delta;
      } else {
        const sigma = p.impliedVolatility != null && p.impliedVolatility > 0
          ? p.impliedVolatility / 100
          : 0.80;
        delta = calculatePutDelta(currentPrice, p.strike, dte / 365, 0.045, sigma);
      }
      // Ensure delta is always negative for puts, minimum -0.01
      if (delta > 0) delta = -delta;
      if (delta > -0.01 && delta <= 0) delta = -0.01;

      // Yield calculations: only when bid/ask/last is non-null and non-zero
      const nomYieldBid = p.bid != null && p.bid !== 0 && p.strike > 0
        ? (p.bid / p.strike) * 100 : null;
      const annYieldBid = nomYieldBid != null ? nomYieldBid * (365 / dte) : null;
      const nomYieldAsk = p.ask != null && p.ask !== 0 && p.strike > 0
        ? (p.ask / p.strike) * 100 : null;
      const annYieldAsk = nomYieldAsk != null ? nomYieldAsk * (365 / dte) : null;
      const nomYieldLast = p.last != null && p.last !== 0 && p.strike > 0
        ? (p.last / p.strike) * 100 : null;
      const annYieldLast = nomYieldLast != null ? nomYieldLast * (365 / dte) : null;

      // % OTM / % ITM
      let otmItmPct: number | null = null;
      let otmItmLabel = '';
      let otmItmColor = '';
      if (currentPrice > 0) {
        const ratio = Math.abs(p.strike - currentPrice) / currentPrice;
        if (ratio < 0.005) {
          otmItmLabel = 'ATM';
          otmItmColor = '#eab308';
        } else if (p.strike < currentPrice) {
          otmItmPct = ((currentPrice - p.strike) / currentPrice) * 100;
          otmItmLabel = otmItmPct.toFixed(1) + '% OTM';
          otmItmColor = '#22c55e';
        } else {
          otmItmPct = ((p.strike - currentPrice) / currentPrice) * 100;
          otmItmLabel = otmItmPct.toFixed(1) + '% ITM';
          otmItmColor = '#ef4444';
        }
      }

      return {
        strike: p.strike,
        last: p.last,
        bid: p.bid,
        ask: p.ask,
        delta,
        impliedVolatility: p.impliedVolatility,
        volume: p.volume,
        openInterest: p.openInterest,
        nomYieldBid, annYieldBid,
        nomYieldAsk, annYieldAsk,
        nomYieldLast, annYieldLast,
        otmItmPct, otmItmLabel, otmItmColor,
      };
    });
  }, [optionsData, selectedExp, currentPrice]);

  const sortedPuts = useMemo(() => {
    const sorted = [...enrichedPuts];
    sorted.sort((a, b) => {
      let aVal: number, bVal: number;
      switch (sortField) {
        case 'strike': aVal = a.strike; bVal = b.strike; break;
        case 'last': aVal = a.last ?? -1; bVal = b.last ?? -1; break;
        case 'bid': aVal = a.bid ?? -1; bVal = b.bid ?? -1; break;
        case 'ask': aVal = a.ask ?? -1; bVal = b.ask ?? -1; break;
        case 'delta': aVal = a.delta; bVal = b.delta; break;
        case 'otmItm': aVal = a.otmItmPct ?? -1; bVal = b.otmItmPct ?? -1; break;
        case 'iv': aVal = a.impliedVolatility ?? -1; bVal = b.impliedVolatility ?? -1; break;
        case 'volume': aVal = a.volume ?? -1; bVal = b.volume ?? -1; break;
        case 'openInterest': aVal = a.openInterest ?? -1; bVal = b.openInterest ?? -1; break;
        case 'nomYieldBid': aVal = a.nomYieldBid ?? -1; bVal = b.nomYieldBid ?? -1; break;
        case 'annYieldBid': aVal = a.annYieldBid ?? -1; bVal = b.annYieldBid ?? -1; break;
        case 'nomYieldAsk': aVal = a.nomYieldAsk ?? -1; bVal = b.nomYieldAsk ?? -1; break;
        case 'annYieldAsk': aVal = a.annYieldAsk ?? -1; bVal = b.annYieldAsk ?? -1; break;
        case 'nomYieldLast': aVal = a.nomYieldLast ?? -1; bVal = b.nomYieldLast ?? -1; break;
        case 'annYieldLast': aVal = a.annYieldLast ?? -1; bVal = b.annYieldLast ?? -1; break;
        default: aVal = a.strike; bVal = b.strike;
      }
      return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
    });
    return sorted;
  }, [enrichedPuts, sortField, sortDir]);

  // Find divider index: between last strike < currentPrice and first strike >= currentPrice
  const dividerIndex = useMemo(() => {
    if (currentPrice <= 0) return -1;
    // Work on the default sort (ascending by strike)
    const byStrike = [...enrichedPuts].sort((a, b) => a.strike - b.strike);
    let idx = -1;
    for (let i = 0; i < byStrike.length; i++) {
      if (byStrike[i].strike >= currentPrice) {
        idx = i;
        break;
      }
    }
    // idx is the first ITM row; divider goes before it
    // If all OTM or all ITM, no divider
    if (idx <= 0 || idx >= byStrike.length) return -1;
    return idx;
  }, [enrichedPuts, currentPrice]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return <ChevronUp className="w-3 h-3 text-[#475569] opacity-40" />;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-[#6366f1]" />
      : <ChevronDown className="w-3 h-3 text-[#6366f1]" />;
  }

  function getMoneyness(strike: number): 'itm' | 'otm' | 'atm' {
    if (currentPrice <= 0) return 'otm';
    const ratio = Math.abs(strike - currentPrice) / currentPrice;
    if (ratio < 0.005) return 'atm';
    return strike > currentPrice ? 'itm' : 'otm';
  }

  function rowBg(strike: number): string {
    const m = getMoneyness(strike);
    if (m === 'itm') return 'bg-red-500/[0.04]';
    if (m === 'atm') return 'bg-amber-500/[0.06]';
    return 'bg-emerald-500/[0.03]';
  }

  function deltaColor(delta: number): string {
    const abs = Math.abs(delta);
    if (abs >= 0.7) return '#ef4444';
    if (abs >= 0.4) return '#f97316';
    if (abs >= 0.2) return '#eab308';
    return '#64748b';
  }

  function ivColor(iv: number | null): string {
    if (iv == null) return '#475569';
    if (iv < 50) return '#22c55e';
    if (iv < 100) return '#eab308';
    if (iv < 150) return '#f97316';
    return '#ef4444';
  }

  const columns: { field: SortField; label: string; align: string }[] = [
    { field: 'strike', label: 'Strike', align: 'text-left' },
    { field: 'last', label: 'Last', align: 'text-right' },
    { field: 'bid', label: 'Bid', align: 'text-right' },
    { field: 'ask', label: 'Ask', align: 'text-right' },
    { field: 'delta', label: 'Delta', align: 'text-right' },
    { field: 'otmItm', label: '% OTM / % ITM', align: 'text-right' },
    { field: 'iv', label: 'IV', align: 'text-right' },
    { field: 'volume', label: 'Volume', align: 'text-right' },
    { field: 'openInterest', label: 'Open Interest', align: 'text-right' },
    { field: 'nomYieldBid', label: 'Nom. Yield (Bid)', align: 'text-right' },
    { field: 'annYieldBid', label: 'Ann. Yield (Bid)', align: 'text-right' },
    { field: 'nomYieldAsk', label: 'Nom. Yield (Ask)', align: 'text-right' },
    { field: 'annYieldAsk', label: 'Ann. Yield (Ask)', align: 'text-right' },
    { field: 'nomYieldLast', label: 'Nom. Yield (Last)', align: 'text-right' },
    { field: 'annYieldLast', label: 'Ann. Yield (Last)', align: 'text-right' },
  ];

  const colCount = columns.length;

  return (
    <div className="min-h-screen bg-[#0a0a0f]">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={onBack}
            className="p-2 rounded-lg text-[#64748b] hover:text-[#e2e8f0] hover:bg-[#12121a] transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold font-mono text-[#e2e8f0]">{etf.ticker}</h1>
              <span className="text-sm text-[#64748b]">{etf.name}</span>
            </div>
          </div>
        </div>

        {/* Price bar */}
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl p-5 mb-6">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <span className="text-3xl font-bold font-mono text-[#e2e8f0]">
                ${currentPrice > 0 ? currentPrice.toFixed(2) : '—'}
              </span>
              {priceData && (
                <div className={`flex items-center gap-1.5 text-sm font-mono mt-1 ${changePositive ? 'text-emerald-400' : 'text-red-400'}`}>
                  {changePositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  <span>{changePositive ? '+$' : '-$'}{Math.abs(priceData.change).toFixed(2)}</span>
                  <span>({changePositive ? '+' : '-'}{Math.abs(priceData.changePercent).toFixed(2)}%)</span>
                </div>
              )}
            </div>
            <div className="ml-auto flex items-center gap-3 text-xs text-[#64748b]">
              {lastUpdated && (
                <span>Last updated: {lastUpdated.toLocaleTimeString()}</span>
              )}
              <button
                onClick={() => selectedExp ? loadExpiration(selectedExp) : loadData()}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#1e1e2e] text-[#e2e8f0] hover:bg-[#2a2a3e] disabled:opacity-50 transition-all"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>

        {/* Expiration selector */}
        {optionsData && optionsData.expirations.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-6">
            {optionsData.expirations.map(exp => (
              <button
                key={exp.date}
                onClick={() => loadExpiration(exp.date)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  selectedExp === exp.date
                    ? 'bg-[#6366f1] text-white shadow-[0_0_12px_rgba(99,102,241,0.3)]'
                    : 'bg-[#12121a] border border-[#1e1e2e] text-[#64748b] hover:text-[#e2e8f0] hover:border-[#6366f1]/30'
                }`}
              >
                {exp.label} ({exp.dte} DTE)
              </button>
            ))}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-6 mb-6 flex items-center gap-3">
            <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0" />
            <p className="text-sm text-red-300">{error}</p>
          </div>
        )}

        {/* Options table */}
        <div className="bg-[#12121a] border border-[#1e1e2e] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="bg-[#0e0e16] border-b border-[#1e1e2e]">
                  {columns.map(col => (
                    <th
                      key={col.field}
                      onClick={() => handleSort(col.field)}
                      className={`px-3 py-3 font-medium text-[#64748b] cursor-pointer hover:text-[#e2e8f0] transition-colors select-none whitespace-nowrap ${col.align}`}
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
                  Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                ) : (
                  (() => {
                    // Build rows with divider inserted at the correct position
                    // Sort by strike ascending to find divider position
                    const byStrike = [...enrichedPuts].sort((a, b) => a.strike - b.strike);
                    const rows: JSX.Element[] = [];
                    let dividerInserted = false;

                    byStrike.forEach((put, idx) => {
                      // Insert divider before first strike >= currentPrice
                      if (!dividerInserted && put.strike >= currentPrice && idx > 0) {
                        rows.push(
                          <tr key="divider">
                            <td colSpan={colCount} className="px-0 py-0">
                              <div className="relative py-2 px-4 bg-[#6366f1]/10 border-y border-[#6366f1]/20">
                                <span className="text-xs font-medium text-[#6366f1]">
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

                      rows.push(
                        <tr
                          key={put.strike}
                          className={`border-b border-[#1e1e2e]/30 hover:bg-white/[0.02] transition-colors ${rowBg(put.strike)} ${rowIdx % 2 === 0 ? '' : 'bg-white/[0.01]'}`}
                        >
                          <td className="px-3 py-2.5 text-left whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-semibold text-[#e2e8f0]">{formatPrice(put.strike)}</span>
                              {moneyness === 'itm' && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-red-500/15 text-red-400 border border-red-500/20">ITM</span>
                              )}
                              {moneyness === 'otm' && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">OTM</span>
                              )}
                              {moneyness === 'atm' && (
                                <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">ATM</span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-[#e2e8f0]">{formatPrice(put.last)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-[#e2e8f0]">{formatPrice(put.bid)}</td>
                          <td className="px-3 py-2.5 text-right font-mono text-[#e2e8f0]">{formatPrice(put.ask)}</td>
                          <td className="px-3 py-2.5 text-right font-mono" style={{ color: deltaColor(put.delta) }}>
                            {put.delta.toFixed(2)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-xs" style={{ color: put.otmItmColor }}>
                            {put.otmItmLabel || '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono" style={{ color: ivColor(put.impliedVolatility) }}>
                            {put.impliedVolatility != null ? put.impliedVolatility.toFixed(1) + '%' : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-[#94a3b8]">
                            {formatNumber(put.volume)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-[#94a3b8]">
                            {formatNumber(put.openInterest)}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-[#94a3b8]">
                            {put.nomYieldBid != null ? formatYield(put.nomYieldBid) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-medium" style={{ color: put.annYieldBid != null ? yieldColor(put.annYieldBid) : '#475569' }}>
                            {put.annYieldBid != null ? formatYield(put.annYieldBid) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-[#94a3b8]">
                            {put.nomYieldAsk != null ? formatYield(put.nomYieldAsk) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-medium" style={{ color: put.annYieldAsk != null ? yieldColor(put.annYieldAsk) : '#475569' }}>
                            {put.annYieldAsk != null ? formatYield(put.annYieldAsk) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-[#94a3b8]">
                            {put.nomYieldLast != null ? formatYield(put.nomYieldLast) : '—'}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono font-medium" style={{ color: put.annYieldLast != null ? yieldColor(put.annYieldLast) : '#475569' }}>
                            {put.annYieldLast != null ? formatYield(put.annYieldLast) : '—'}
                          </td>
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
            <div className="py-12 text-center text-[#64748b] text-sm">No put options data available for this expiration.</div>
          )}
        </div>

        <footer className="mt-8 pb-6 text-center">
          <p className="text-xs text-[#475569]">Data delayed up to 15 minutes. Not financial advice.</p>
        </footer>
      </div>
    </div>
  );
}

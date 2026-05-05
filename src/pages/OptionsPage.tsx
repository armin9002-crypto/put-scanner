import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import type { OptionsChainData, SortField, SortDirection } from '../lib/types';
import { ETF_LIST } from '../lib/etfs';
import { fetchOptions, fetchPrice, calculatePutDelta, formatPrice, formatYield, yieldColor, formatNumber } from '../lib/api';
import {
  ArrowLeft, RefreshCw, TrendingUp, TrendingDown, AlertCircle,
  ChevronUp, ChevronDown
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
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      {Array.from({ length: 15 }).map((_, i) => (
        <td key={i} className="px-3 py-1.5">
          <div className="h-3.5 w-16 rounded animate-pulse" style={{ backgroundColor: 'var(--border)' }} />
        </td>
      ))}
    </tr>
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

export default function OptionsPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const navigate = useNavigate();
  const etf = ETF_LIST.find(e => e.ticker === ticker);

  const [optionsData, setOptionsData] = useState<OptionsChainData | null>(null);
  const [priceData, setPriceData] = useState<{ price: number; change: number; changePercent: number } | null>(null);
  const [selectedExp, setSelectedExp] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [sortField, setSortField] = useState<SortField>('strike');
  const [sortDir, setSortDir] = useState<SortDirection>('asc');

  const loadData = useCallback(async (expDate?: number) => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    try {
      const [opts, price] = await Promise.all([
        fetchOptions(ticker, expDate),
        fetchPrice(ticker),
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
  }, [ticker]);

  const loadExpiration = useCallback(async (expDate: number) => {
    if (!ticker) return;
    setSelectedExp(expDate);
    setLoading(true);
    setError(null);
    try {
      const opts = await fetchOptions(ticker, expDate);
      setOptionsData(opts);
      const price = await fetchPrice(ticker);
      setPriceData(price);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message || 'Failed to load expiration data');
    } finally {
      setLoading(false);
    }
  }, [ticker]);

  useEffect(() => { loadData(); }, [loadData]);

  const currentPrice = priceData?.price ?? optionsData?.currentPrice ?? 0;
  const changePositive = priceData ? priceData.changePercent >= 0 : true;

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
        impliedVolatility: p.impliedVolatility, volume: p.volume, openInterest: p.openInterest,
        nomYieldBid, annYieldBid, nomYieldAsk, annYieldAsk, nomYieldLast, annYieldLast,
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
        <div className="flex items-center gap-4 mb-6">
          <button
            onClick={() => navigate('/')}
            className="p-2 rounded-lg transition-all"
            style={{ color: 'var(--text-muted)' }}
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold font-mono" style={{ color: 'var(--text)' }}>{etf.ticker}</h1>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{etf.name}</span>
            </div>
          </div>
        </div>

        {/* Price bar */}
        <div className="rounded-xl p-5 mb-6" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <span className="text-3xl font-bold font-mono" style={{ color: 'var(--text)' }}>
                ${currentPrice > 0 ? currentPrice.toFixed(2) : '—'}
              </span>
              {priceData && (
                <div className={`flex items-center gap-1.5 text-sm font-mono mt-1`} style={{ color: changePositive ? 'var(--green)' : 'var(--red)' }}>
                  {changePositive ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  <span>{changePositive ? '+$' : '-$'}{Math.abs(priceData.change).toFixed(2)}</span>
                  <span>({changePositive ? '+' : '-'}{Math.abs(priceData.changePercent).toFixed(2)}%)</span>
                </div>
              )}
            </div>
            <div className="ml-auto flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              {lastUpdated && (
                <span>Last updated: {lastUpdated.toLocaleTimeString()}</span>
              )}
              <button
                onClick={() => selectedExp ? loadExpiration(selectedExp) : loadData()}
                disabled={loading}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg disabled:opacity-50 transition-all"
                style={{ backgroundColor: 'var(--border)', color: 'var(--text)' }}
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
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
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
        <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10">
                <tr style={{ backgroundColor: 'var(--surface-alt)', borderBottom: '1px solid var(--border)' }}>
                  {columns.map(col => (
                    <th
                      key={col.field}
                      onClick={() => handleSort(col.field)}
                      className={`px-3 py-1.5 text-xs uppercase tracking-wider font-medium cursor-pointer transition-colors select-none whitespace-nowrap ${col.align} ${
                        col.field === 'strike' ? 'sticky left-0 z-[3] border-r' : ''
                      }`}
                      style={{
                        color: 'var(--text-muted)',
                        backgroundColor: col.field === 'strike' ? 'var(--surface-alt)' : undefined,
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
                  Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                ) : (
                  (() => {
                    const byStrike = [...enrichedPuts].sort((a, b) => a.strike - b.strike);
                    const rows: JSX.Element[] = [];
                    let dividerInserted = false;

                    byStrike.forEach((put, idx) => {
                      if (!dividerInserted && put.strike >= currentPrice && idx > 0) {
                        rows.push(
                          <tr key="divider">
                            <td colSpan={colCount} className="px-0 py-0">
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

                      rows.push(
                        <tr
                          key={put.strike}
                          className="transition-colors"
                          style={{ borderBottom: '1px solid var(--border)', backgroundColor: altBg }}
                        >
                          <td className="px-3 py-1.5 text-left whitespace-nowrap sticky left-0 z-[2] border-r" style={{ borderColor: 'var(--border)', backgroundColor: bg }}>
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono font-semibold" style={{ color: 'var(--text)' }}>{formatPrice(put.strike)}</span>
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
                          <td className="px-3 py-1.5 text-right font-mono" style={{ color: 'var(--text)' }}>{formatPrice(put.last)}</td>
                          <td className="px-3 py-1.5 text-right font-mono" style={{ color: 'var(--text)' }}>{formatPrice(put.bid)}</td>
                          <td className="px-3 py-1.5 text-right font-mono" style={{ color: 'var(--text)' }}>{formatPrice(put.ask)}</td>
                          <td className="px-3 py-1.5 text-right font-mono" style={{ color: deltaColor(put.delta) }}>
                            {put.delta.toFixed(2)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono text-xs" style={{ color: put.otmItmColor }}>
                            {put.otmItmLabel || '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono" style={{ color: ivColor(put.impliedVolatility) }}>
                            {put.impliedVolatility != null ? put.impliedVolatility.toFixed(1) + '%' : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                            {formatNumber(put.volume)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                            {formatNumber(put.openInterest)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                            {put.nomYieldBid != null ? formatYield(put.nomYieldBid) : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-medium" style={{ color: put.annYieldBid != null ? yieldColor(put.annYieldBid) : 'var(--text-dim)' }}>
                            {put.annYieldBid != null ? formatYield(put.annYieldBid) : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                            {put.nomYieldAsk != null ? formatYield(put.nomYieldAsk) : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-medium" style={{ color: put.annYieldAsk != null ? yieldColor(put.annYieldAsk) : 'var(--text-dim)' }}>
                            {put.annYieldAsk != null ? formatYield(put.annYieldAsk) : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono" style={{ color: 'var(--text-secondary)' }}>
                            {put.nomYieldLast != null ? formatYield(put.nomYieldLast) : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-medium" style={{ color: put.annYieldLast != null ? yieldColor(put.annYieldLast) : 'var(--text-dim)' }}>
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

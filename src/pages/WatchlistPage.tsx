import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { getWatchlist, removeFromWatchlist, updateWatchlistNote, clearExpiredItems, type WatchlistItem } from '../lib/watchlist';
import { fetchOptions, fetchBatchPrices, calculatePutDelta, formatPrice } from '../lib/api';
import type { OptionsChainData } from '../lib/types';
import { Star, RefreshCw, Loader2, ChevronUp, ChevronDown, Trash2 } from 'lucide-react';

interface LiveRow extends WatchlistItem {
  dte: number;
  expired: boolean;
  currentPrice: number;
  moneynessPct: number;
  moneynessLabel: string;
  moneynessColor: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  delta: number;
  iv: number | null;
  nomYieldBid: number | null;
  annYieldBid: number | null;
  nomYieldAsk: number | null;
  annYieldAsk: number | null;
}

type SortField = 'ticker' | 'strike' | 'expiry' | 'dte' | 'price' | 'moneyness' | 'bid' | 'ask' | 'last' | 'delta' | 'iv' | 'nomYieldBid' | 'annYieldBid' | 'annYieldAsk' | 'added';
type SortDir = 'asc' | 'desc';

function computeMoneyness(currentPrice: number, strike: number): { pct: number; label: string; color: string } {
  if (currentPrice <= 0) return { pct: 0, label: '--', color: 'var(--text-muted)' };
  const pct = ((currentPrice - strike) / currentPrice) * 100;
  const absPct = Math.abs(pct);
  if (absPct < 0.5) return { pct, label: 'ATM', color: 'var(--yellow)' };
  if (pct > 0) return { pct, label: `${absPct.toFixed(1)}% OTM`, color: 'var(--red)' };
  return { pct, label: `${absPct.toFixed(1)}% ITM`, color: 'var(--green)' };
}

function calcDte(expiry: string): number {
  const [year, month, day] = expiry.split('-').map(Number);
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiryUTC = Date.UTC(year, month - 1, day);
  const dte = Math.round((expiryUTC - todayUTC) / (1000 * 60 * 60 * 24));
  return Math.max(0, dte);
}

function annYieldColor(y: number | null): string {
  if (y == null) return 'var(--text-dim)';
  if (y > 50) return 'var(--green)';
  if (y >= 25) return 'var(--orange)';
  if (y >= 10) return 'var(--yellow)';
  return 'var(--text-muted)';
}

function deltaColor(d: number): string {
  const abs = Math.abs(d);
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

function formatDate(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function WatchlistPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [liveRows, setLiveRows] = useState<LiveRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [sortField, setSortField] = useState<SortField>('dte');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const initialLoadDone = useRef(false);

  // Load watchlist from localStorage on mount
  useEffect(() => {
    setItems(getWatchlist());
  }, []);

  // Auto-refresh on first load if items exist
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;
    if (items.length > 0) {
      handleRefresh();
    }
  }, [items.length]);

  const handleRefresh = useCallback(async () => {
    if (items.length === 0) return;
    setLoading(true);

    try {
      // Get unique tickers
      const uniqueTickers = [...new Set(items.map(i => i.ticker))];

      // Fetch batch prices and options data concurrently
      const [batchPrices, ...optionsResults] = await Promise.all([
        fetchBatchPrices(uniqueTickers),
        ...uniqueTickers.map(ticker =>
          fetchOptions(ticker).catch(() => null)
        ),
      ]);

      const optionsMap = new Map<string, OptionsChainData | null>();
      uniqueTickers.forEach((ticker, i) => {
        optionsMap.set(ticker, optionsResults[i] as OptionsChainData | null);
      });

      // Build live rows
      const rows: LiveRow[] = items.map(item => {
        const dte = calcDte(item.expiry);
        const expired = dte <= 0;
        const optData = optionsMap.get(item.ticker);
        const priceData = batchPrices[item.ticker];
        const currentPrice = priceData?.price ?? optData?.currentPrice ?? 0;

        const { pct: moneynessPct, label: moneynessLabel, color: moneynessColor } = computeMoneyness(currentPrice, item.strike);

        // Find matching put in options data
        let bid: number | null = null;
        let ask: number | null = null;
        let last: number | null = null;
        let delta: number = -0.5;
        let iv: number | null = null;

        if (optData) {
          const put = optData.puts.find(p => Math.abs(p.strike - item.strike) < 0.01);
          if (put) {
            bid = put.bid;
            ask = put.ask;
            last = put.last;
            iv = put.impliedVolatility;

            if (put.delta != null && put.delta !== 0) {
              delta = put.delta;
            } else {
              const sigma = iv != null && iv > 0 ? iv / 100 : 0.80;
              delta = calculatePutDelta(currentPrice, item.strike, Math.max(1, dte) / 365, 0.045, sigma);
            }
          }
        }

        if (delta > 0) delta = -delta;
        if (delta > -0.01 && delta <= 0) delta = -0.01;

        const nomYieldBid = bid != null && bid !== 0 && item.strike > 0 ? (bid / item.strike) * 100 : null;
        const annYieldBid = nomYieldBid != null ? nomYieldBid * (365 / Math.max(1, dte)) : null;
        const nomYieldAsk = ask != null && ask !== 0 && item.strike > 0 ? (ask / item.strike) * 100 : null;
        const annYieldAsk = nomYieldAsk != null ? nomYieldAsk * (365 / Math.max(1, dte)) : null;

        return {
          ...item,
          dte: Math.max(0, dte),
          expired,
          currentPrice,
          moneynessPct,
          moneynessLabel,
          moneynessColor,
          bid,
          ask,
          last,
          delta,
          iv,
          nomYieldBid,
          annYieldBid,
          nomYieldAsk,
          annYieldAsk,
        };
      });

      setLiveRows(rows);
      setLastRefreshed(new Date());
    } catch { /* ignore */ }
    setLoading(false);
  }, [items]);

  const handleRemove = useCallback((id: string) => {
    if (confirmRemove === id) {
      const updated = removeFromWatchlist(id);
      setItems(updated);
      setLiveRows(prev => prev.filter(r => r.id !== id));
      setConfirmRemove(null);
    } else {
      setConfirmRemove(id);
      setTimeout(() => setConfirmRemove(prev => prev === id ? null : prev), 3000);
    }
  }, [confirmRemove]);

  const handleClearExpired = useCallback(() => {
    const updated = clearExpiredItems();
    setItems(updated);
    setLiveRows(prev => prev.filter(r => !r.expired));
  }, []);

  const handleNoteSave = useCallback((id: string) => {
    const updated = updateWatchlistNote(id, noteText);
    setItems(updated);
    setLiveRows(prev => prev.map(r => r.id === id ? { ...r, note: noteText } : r));
    setEditingNote(null);
    setNoteText('');
  }, [noteText]);

  // Sorted rows
  const sortedRows = useMemo(() => {
    const sorted = [...liveRows];
    sorted.sort((a, b) => {
      let aVal: number | string, bVal: number | string;
      switch (sortField) {
        case 'ticker': aVal = a.ticker; bVal = b.ticker; break;
        case 'strike': aVal = a.strike; bVal = b.strike; break;
        case 'expiry': aVal = a.expiry; bVal = b.expiry; break;
        case 'dte': aVal = a.dte; bVal = b.dte; break;
        case 'price': aVal = a.currentPrice; bVal = b.currentPrice; break;
        case 'moneyness': aVal = a.moneynessPct; bVal = b.moneynessPct; break;
        case 'bid': aVal = a.bid ?? -1; bVal = b.bid ?? -1; break;
        case 'ask': aVal = a.ask ?? -1; bVal = b.ask ?? -1; break;
        case 'last': aVal = a.last ?? -1; bVal = b.last ?? -1; break;
        case 'delta': aVal = a.delta; bVal = b.delta; break;
        case 'iv': aVal = a.iv ?? -1; bVal = b.iv ?? -1; break;
        case 'nomYieldBid': aVal = a.nomYieldBid ?? -1; bVal = b.nomYieldBid ?? -1; break;
        case 'annYieldBid': aVal = a.annYieldBid ?? -1; bVal = b.annYieldBid ?? -1; break;
        case 'annYieldAsk': aVal = a.annYieldAsk ?? -1; bVal = b.annYieldAsk ?? -1; break;
        case 'added': aVal = a.addedAt; bVal = b.addedAt; break;
        default: aVal = a.dte; bVal = b.dte;
      }
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return sorted;
  }, [liveRows, sortField, sortDir]);

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

  const columns: { field: SortField; label: string; align: string; hideOnMobile?: boolean; hideOnTablet?: boolean }[] = [
    { field: 'ticker', label: 'Ticker', align: 'text-left' },
    { field: 'strike', label: 'Strike', align: 'text-right' },
    { field: 'expiry', label: 'Expiry', align: 'text-right' },
    { field: 'price', label: 'Price', align: 'text-right', hideOnMobile: true },
    { field: 'moneyness', label: '% OTM/ITM', align: 'text-right', hideOnMobile: true },
    { field: 'bid', label: 'Bid', align: 'text-right' },
    { field: 'ask', label: 'Ask', align: 'text-right', hideOnMobile: true },
    { field: 'last', label: 'Last', align: 'text-right', hideOnMobile: true },
    { field: 'delta', label: 'Delta', align: 'text-right', hideOnMobile: true },
    { field: 'iv', label: 'IV', align: 'text-right', hideOnMobile: true },
    { field: 'nomYieldBid', label: 'Nom Yld Bid', align: 'text-right', hideOnMobile: true, hideOnTablet: true },
    { field: 'annYieldBid', label: 'Ann Yld Bid', align: 'text-right' },
    { field: 'annYieldAsk', label: 'Ann Yld Ask', align: 'text-right', hideOnMobile: true },
    { field: 'added', label: 'Added', align: 'text-right', hideOnMobile: true, hideOnTablet: true },
  ];

  const hasExpired = liveRows.some(r => r.expired);

  return (
    <div className="min-h-screen" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>Watchlist</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Saved puts -- click refresh to update prices.</p>
          </div>
          <div className="flex items-center gap-2">
            {hasExpired && (
              <button
                onClick={handleClearExpired}
                className="flex items-center gap-1.5 px-3 py-2 sm:py-1.5 text-xs font-medium rounded-lg transition-all min-h-[44px] sm:min-h-0"
                style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.2)' }}
              >
                <Trash2 className="w-3 h-3" />
                Clear Expired
              </button>
            )}
            <button
              onClick={handleRefresh}
              disabled={loading || items.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 sm:py-1.5 text-white text-xs font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all min-h-[44px] sm:min-h-0"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
              Refresh All
            </button>
          </div>
        </div>

        {lastRefreshed && (
          <div className="text-[10px] mb-3" style={{ color: 'var(--text-dim)' }}>
            Last refreshed: {lastRefreshed.toLocaleTimeString()}
          </div>
        )}

        {items.length === 0 ? (
          <div className="text-center py-20">
            <Star className="w-8 h-8 mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>No saved puts yet.</p>
            <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Browse the Scanner or Screener and click the star on any strike to save it here.</p>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10">
                  <tr style={{ backgroundColor: 'var(--surface-alt)', borderBottom: '1px solid var(--border)' }}>
                    <th className="px-2 py-1.5 text-[10px] uppercase tracking-wider font-medium w-8" style={{ color: 'var(--text-muted)' }}></th>
                    {columns.map(col => (
                      <th
                        key={col.field}
                        onClick={() => handleSort(col.field)}
                        className={`px-2 py-1.5 text-[10px] uppercase tracking-wider font-medium cursor-pointer transition-colors select-none whitespace-nowrap ${col.align} ${col.hideOnMobile ? 'hidden md:table-cell' : ''} ${col.hideOnTablet ? 'hidden lg:table-cell' : ''}`}
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <span className="inline-flex items-center gap-0.5">
                          {col.label}
                          <SortIcon field={col.field} />
                        </span>
                      </th>
                    ))}
                    <th className="px-2 py-1.5 text-[10px] uppercase tracking-wider font-medium text-left" style={{ color: 'var(--text-muted)' }}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && liveRows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 2} className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
                        <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                        Loading watchlist data...
                      </td>
                    </tr>
                  ) : sortedRows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 2} className="py-12 text-center" style={{ color: 'var(--text-muted)' }}>
                        No items in watchlist.
                      </td>
                    </tr>
                  ) : (
                    sortedRows.map((row, idx) => {
                      const bgStyle = idx % 2 !== 0 ? { backgroundColor: 'var(--row-alt)' } : {};
                      const expiredStyle = row.expired ? { opacity: 0.5, textDecoration: 'line-through' } : {};

                      return (
                        <tr key={row.id} className="transition-colors" style={{ borderBottom: '1px solid var(--border)', ...bgStyle }}>
                          <td className="px-2 py-1 text-center" style={expiredStyle}>
                            <button
                              onClick={() => handleRemove(row.id)}
                              className="transition-opacity hover:opacity-70 min-h-[44px] flex items-center justify-center"
                              title={confirmRemove === row.id ? 'Click again to remove' : 'Remove from watchlist'}
                            >
                              <Star className="w-3.5 h-3.5 fill-current" style={{ color: confirmRemove === row.id ? 'var(--red)' : 'var(--accent-light)' }} />
                            </button>
                          </td>
                          <td className="px-2 py-1 text-left whitespace-nowrap" style={expiredStyle}>
                            <button
                              onClick={() => navigate(`/options/${row.ticker}`)}
                              className="font-mono font-bold hover:opacity-80 transition-opacity min-h-[44px]"
                              style={{ color: 'var(--accent-light)' }}
                            >
                              {row.ticker}
                            </button>
                          </td>
                          <td className="px-2 py-1 text-right font-mono" style={expiredStyle}>{formatPrice(row.strike)}</td>
                          <td className="px-2 py-1 text-right font-mono whitespace-nowrap" style={expiredStyle}>
                            {row.expired ? (
                              <span className="text-[9px] font-bold px-1 py-0.5 rounded" style={{ color: 'var(--red)', backgroundColor: 'rgba(239,68,68,0.1)' }}>Expired</span>
                            ) : (
                              <>{row.expiryFormatted} ({row.dte} DTE)</>
                            )}
                          </td>
                          <td className="px-2 py-1 text-right font-mono hidden md:table-cell" style={expiredStyle}>{formatPrice(row.currentPrice)}</td>
                          <td className="px-2 py-1 text-right font-mono hidden md:table-cell" style={{ ...expiredStyle, color: row.moneynessColor }}>{row.moneynessLabel}</td>
                          <td className="px-2 py-1 text-right font-mono" style={expiredStyle}>{formatPrice(row.bid)}</td>
                          <td className="px-2 py-1 text-right font-mono hidden md:table-cell" style={expiredStyle}>{formatPrice(row.ask)}</td>
                          <td className="px-2 py-1 text-right font-mono hidden md:table-cell" style={expiredStyle}>{formatPrice(row.last)}</td>
                          <td className="px-2 py-1 text-right font-mono hidden md:table-cell" style={{ ...expiredStyle, color: deltaColor(row.delta) }}>{row.delta.toFixed(2)}</td>
                          <td className="px-2 py-1 text-right font-mono hidden md:table-cell" style={{ ...expiredStyle, color: ivColor(row.iv) }}>{row.iv != null ? row.iv.toFixed(1) + '%' : '--'}</td>
                          <td className="px-2 py-1 text-right font-mono hidden lg:table-cell" style={expiredStyle}>{row.nomYieldBid != null ? row.nomYieldBid.toFixed(2) + '%' : '--'}</td>
                          <td className="px-2 py-1 text-right font-mono font-medium" style={{ ...expiredStyle, color: annYieldColor(row.annYieldBid) }}>{row.annYieldBid != null ? row.annYieldBid.toFixed(2) + '%' : '--'}</td>
                          <td className="px-2 py-1 text-right font-mono hidden md:table-cell" style={{ ...expiredStyle, color: annYieldColor(row.annYieldAsk) }}>{row.annYieldAsk != null ? row.annYieldAsk.toFixed(2) + '%' : '--'}</td>
                          <td className="px-2 py-1 text-right text-[10px] hidden md:table-cell" style={{ ...expiredStyle, color: 'var(--text-dim)' }}>{formatDate(row.addedAt)}</td>
                          <td className="px-2 py-1 text-left" style={expiredStyle}>
                            {editingNote === row.id ? (
                              <input
                                type="text"
                                value={noteText}
                                onChange={e => setNoteText(e.target.value.slice(0, 60))}
                                onBlur={() => handleNoteSave(row.id)}
                                onKeyDown={e => { if (e.key === 'Enter') handleNoteSave(row.id); if (e.key === 'Escape') { setEditingNote(null); setNoteText(''); } }}
                                autoFocus
                                className="w-full bg-transparent text-xs outline-none border-b"
                                style={{ color: 'var(--text)', borderColor: 'var(--accent)' }}
                                maxLength={60}
                              />
                            ) : (
                              <span
                                onClick={() => { setEditingNote(row.id); setNoteText(row.note); }}
                                className="cursor-pointer text-xs hover:opacity-80 transition-opacity"
                                style={{ color: row.note ? 'var(--text-secondary)' : 'var(--text-dim)' }}
                              >
                                {row.note || 'Add note...'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <footer className="mt-8 pb-6 text-center">
          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Data delayed up to 15 minutes. Not financial advice.</p>
        </footer>
      </div>
    </div>
  );
}

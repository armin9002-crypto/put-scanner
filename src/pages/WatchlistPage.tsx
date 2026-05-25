import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getWatchlist,
  markWatchlistItems,
  removeFromWatchlist,
  updateWatchlistNote,
  type WatchlistItem,
  type WatchlistSnapshot,
  type WatchlistStatus,
} from '../lib/watchlist';
import { fetchOptions, fetchBatchPrices, calculatePutDelta } from '../lib/api';
import type { OptionsChainData } from '../lib/types';
import { calculateDte, calculateMoneyness, calculateYieldPercent, isFiniteNumber } from '../lib/optionMetrics';
import { formatDate as formatDisplayDate, formatOptionPrice, formatPercentPoints } from '../lib/format';
import { Star, RefreshCw, Loader2, ChevronUp, ChevronDown, AlertTriangle } from 'lucide-react';

interface LiveRow extends WatchlistItem {
  dte: number | null;
  expired: boolean;
  currentPrice: number | null;
  moneynessPct: number | null;
  moneynessLabel: string;
  moneynessColor: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  delta: number | null;
  iv: number | null;
  volume: number | null;
  openInterest: number | null;
  nomYieldBid: number | null;
  annYieldBid: number | null;
  nomYieldAsk: number | null;
  annYieldAsk: number | null;
  nomYieldLast: number | null;
  annYieldLast: number | null;
  status: WatchlistStatus;
  statusLabel: string;
}

type SortField = 'ticker' | 'strike' | 'expiry' | 'dte' | 'moneyness' | 'bid' | 'ask' | 'last' | 'delta' | 'iv' | 'nomYieldBid' | 'annYieldBid' | 'nomYieldAsk' | 'annYieldAsk' | 'nomYieldLast' | 'annYieldLast' | 'added';
type SortDir = 'asc' | 'desc';

function formatMoney(value: number | null | undefined): string {
  return formatOptionPrice(value);
}

function formatPercentValue(value: number | null | undefined): string {
  return formatPercentPoints(value);
}

function formatDate(ts: number): string {
  return formatDisplayDate(ts);
}

function annYieldColor(yieldValue: number | null): string {
  if (!isFiniteNumber(yieldValue)) return 'var(--text-dim)';
  if (yieldValue > 50) return 'var(--green)';
  if (yieldValue >= 25) return 'var(--orange)';
  if (yieldValue >= 10) return 'var(--yellow)';
  return 'var(--text-muted)';
}

function deltaColor(delta: number | null): string {
  if (!isFiniteNumber(delta)) return 'var(--text-dim)';
  const abs = Math.abs(delta);
  if (abs >= 0.7) return 'var(--red)';
  if (abs >= 0.4) return 'var(--orange)';
  if (abs >= 0.2) return 'var(--yellow)';
  return 'var(--text-muted)';
}

function ivColor(iv: number | null): string {
  if (!isFiniteNumber(iv)) return 'var(--text-dim)';
  if (iv < 50) return 'var(--green)';
  if (iv < 100) return 'var(--yellow)';
  if (iv < 150) return 'var(--orange)';
  return 'var(--red)';
}

function statusLabel(status: WatchlistStatus, expired: boolean): string {
  if (expired) return 'Expired';
  if (status === 'live') return 'Live';
  if (status === 'refresh_failed') return 'Refresh failed';
  if (status === 'unavailable') return 'Unavailable';
  return 'Stale';
}

function statusColor(status: WatchlistStatus, expired: boolean): string {
  if (expired || status === 'unavailable' || status === 'refresh_failed') return 'var(--red)';
  if (status === 'live') return 'var(--green)';
  return 'var(--text-dim)';
}

function buildRow(item: WatchlistItem): LiveRow {
  const snapshot: WatchlistSnapshot = item.snapshot ?? {};
  const rawDte = calculateDte(item.expiry);
  const dte = isFiniteNumber(rawDte) ? Math.max(0, rawDte) : snapshot.dte ?? null;
  const expired = isFiniteNumber(rawDte) ? rawDte <= 0 : false;
  const currentPrice = snapshot.underlyingPrice ?? null;
  const bid = snapshot.bid ?? null;
  const ask = snapshot.ask ?? null;
  const last = snapshot.last ?? null;
  const bidYield = calculateYieldPercent(bid, item.strike, dte);
  const askYield = calculateYieldPercent(ask, item.strike, dte);
  const lastYield = calculateYieldPercent(last, item.strike, dte);
  const moneyness = calculateMoneyness(currentPrice, item.strike);
  const status = expired ? 'expired' : item.status ?? 'stale';

  return {
    ...item,
    dte,
    expired,
    currentPrice,
    moneynessPct: moneyness.pct ?? snapshot.moneynessPct ?? null,
    moneynessLabel: moneyness.label !== '—' ? moneyness.label : snapshot.moneynessLabel ?? moneyness.label,
    moneynessColor: moneyness.color,
    bid,
    ask,
    last,
    delta: snapshot.delta ?? null,
    iv: snapshot.iv ?? null,
    volume: snapshot.volume ?? null,
    openInterest: snapshot.openInterest ?? null,
    nomYieldBid: bidYield.nominal,
    annYieldBid: bidYield.annualized,
    nomYieldAsk: askYield.nominal,
    annYieldAsk: askYield.annualized,
    nomYieldLast: lastYield.nominal,
    annYieldLast: lastYield.annualized,
    status,
    statusLabel: statusLabel(status, expired),
  };
}

function mergeLiveItem(item: WatchlistItem, optData: OptionsChainData | null, currentPrice: number | null, failed: boolean): WatchlistItem {
  const rawDte = calculateDte(item.expiry);
  const dte = isFiniteNumber(rawDte) ? Math.max(0, rawDte) : null;
  if (isFiniteNumber(rawDte) && rawDte <= 0) {
    return { ...item, status: 'expired', updatedAt: Date.now() };
  }

  if (failed || !optData) {
    return { ...item, status: 'refresh_failed', updatedAt: Date.now() };
  }

  const put = optData.puts.find(candidate => Math.abs(candidate.strike - item.strike) < 0.01);
  const underlyingPrice = isFiniteNumber(currentPrice) && currentPrice > 0
    ? currentPrice
    : optData.currentPrice > 0 ? optData.currentPrice : item.snapshot?.underlyingPrice ?? null;

  if (!put) {
    return {
      ...item,
      status: 'unavailable',
      updatedAt: Date.now(),
      snapshot: {
        ...item.snapshot,
        underlyingPrice,
        dte,
      },
    };
  }

  const iv = put.impliedVolatility ?? null;
  let delta = put.delta;
  if ((!isFiniteNumber(delta) || delta === 0) && isFiniteNumber(underlyingPrice) && underlyingPrice > 0 && isFiniteNumber(dte) && dte > 0) {
    const sigma = isFiniteNumber(iv) && iv > 0 ? iv / 100 : 0.80;
    delta = calculatePutDelta(underlyingPrice, item.strike, dte / 365, 0.045, sigma);
  }
  if (isFiniteNumber(delta) && delta > 0) delta = -delta;
  if (isFiniteNumber(delta) && delta > -0.01 && delta <= 0) delta = -0.01;

  const bidYield = calculateYieldPercent(put.bid, item.strike, dte);
  const askYield = calculateYieldPercent(put.ask, item.strike, dte);
  const moneyness = calculateMoneyness(underlyingPrice, item.strike);

  return {
    ...item,
    status: 'live',
    updatedAt: Date.now(),
    snapshot: {
      underlyingPrice,
      bid: put.bid,
      ask: put.ask,
      last: put.last,
      delta,
      iv,
      dte,
      volume: put.volume,
      openInterest: put.openInterest,
      nominalYieldBid: bidYield.nominal,
      annualizedYieldBid: bidYield.annualized,
      annualizedYieldAsk: askYield.annualized,
      moneynessPct: moneyness.pct,
      moneynessLabel: moneyness.label,
    },
  };
}

export default function WatchlistPage() {
  const navigate = useNavigate();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [sortField, setSortField] = useState<SortField>('dte');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const initialLoadDone = useRef(false);

  useEffect(() => {
    const stored = getWatchlist();
    setItems(stored);
    const lastUpdated = Math.max(...stored.map(item => item.updatedAt ?? 0));
    if (lastUpdated > 0) setLastRefreshed(new Date(lastUpdated));
  }, []);

  const rows = useMemo(() => items.map(buildRow), [items]);

  const handleRefresh = useCallback(async () => {
    const currentItems = getWatchlist();
    if (currentItems.length === 0) {
      setItems([]);
      return;
    }

    setItems(currentItems);
    setLoading(true);

    const uniqueTickers = [...new Set(currentItems.map(item => item.ticker))];
    const batchResult = await fetchBatchPrices(uniqueTickers).catch(() => null);

    const requestKeys = [...new Set(currentItems
      .filter(item => {
        const rawDte = calculateDte(item.expiry);
        return !isFiniteNumber(rawDte) || rawDte > 0;
      })
      .map(item => `${item.ticker}|${item.expiryTimestamp}`))];

    const optionResults = await Promise.allSettled(
      requestKeys.map(async key => {
        const [ticker, timestamp] = key.split('|');
        return { key, data: await fetchOptions(ticker, Number(timestamp), { bypassCache: true }) };
      })
    );

    const optionsByKey = new Map<string, OptionsChainData | null>();
    optionResults.forEach((result, index) => {
      const key = requestKeys[index];
      optionsByKey.set(key, result.status === 'fulfilled' ? result.value.data : null);
    });

    const refreshed = currentItems.map(item => {
      const key = `${item.ticker}|${item.expiryTimestamp}`;
      const hasRequest = optionsByKey.has(key);
      const optData = optionsByKey.get(key) ?? null;
      const price = batchResult?.[item.ticker]?.price ?? optData?.currentPrice ?? item.snapshot?.underlyingPrice ?? null;
      return mergeLiveItem(item, optData, price, hasRequest && optData == null);
    });

    const stored = markWatchlistItems(refreshed);
    setItems(stored);
    setLastRefreshed(new Date());
    setLoading(false);
  }, []);

  useEffect(() => {
    if (initialLoadDone.current) return;
    if (items.length === 0) return;
    initialLoadDone.current = true;
    handleRefresh();
  }, [items.length, handleRefresh]);

  const handleRemove = useCallback((id: string) => {
    if (confirmRemove === id) {
      const updated = removeFromWatchlist(id);
      setItems(updated);
      setConfirmRemove(null);
    } else {
      setConfirmRemove(id);
      setTimeout(() => setConfirmRemove(prev => prev === id ? null : prev), 3000);
    }
  }, [confirmRemove]);

  const handleNoteSave = useCallback((id: string) => {
    const updated = updateWatchlistNote(id, noteText);
    setItems(updated);
    setEditingNote(null);
    setNoteText('');
  }, [noteText]);

  const sortedRows = useMemo(() => {
    const sorted = [...rows];
    sorted.sort((a, b) => {
      let aVal: number | string, bVal: number | string;
      switch (sortField) {
        case 'ticker': aVal = a.ticker; bVal = b.ticker; break;
        case 'strike': aVal = a.strike; bVal = b.strike; break;
        case 'expiry': aVal = a.expiry; bVal = b.expiry; break;
        case 'dte': aVal = a.dte ?? Number.MAX_SAFE_INTEGER; bVal = b.dte ?? Number.MAX_SAFE_INTEGER; break;
        case 'moneyness': aVal = a.moneynessPct ?? -999; bVal = b.moneynessPct ?? -999; break;
        case 'bid': aVal = a.bid ?? -1; bVal = b.bid ?? -1; break;
        case 'ask': aVal = a.ask ?? -1; bVal = b.ask ?? -1; break;
        case 'last': aVal = a.last ?? -1; bVal = b.last ?? -1; break;
        case 'delta': aVal = a.delta ?? -999; bVal = b.delta ?? -999; break;
        case 'iv': aVal = a.iv ?? -1; bVal = b.iv ?? -1; break;
        case 'nomYieldBid': aVal = a.nomYieldBid ?? -1; bVal = b.nomYieldBid ?? -1; break;
        case 'annYieldBid': aVal = a.annYieldBid ?? -1; bVal = b.annYieldBid ?? -1; break;
        case 'nomYieldAsk': aVal = a.nomYieldAsk ?? -1; bVal = b.nomYieldAsk ?? -1; break;
        case 'annYieldAsk': aVal = a.annYieldAsk ?? -1; bVal = b.annYieldAsk ?? -1; break;
        case 'nomYieldLast': aVal = a.nomYieldLast ?? -1; bVal = b.nomYieldLast ?? -1; break;
        case 'annYieldLast': aVal = a.annYieldLast ?? -1; bVal = b.annYieldLast ?? -1; break;
        case 'added': aVal = a.addedAt; bVal = b.addedAt; break;
        default: aVal = a.dte ?? Number.MAX_SAFE_INTEGER; bVal = b.dte ?? Number.MAX_SAFE_INTEGER;
      }
      if (typeof aVal === 'string' && typeof bVal === 'string') {
        return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
      }
      return sortDir === 'asc' ? (aVal as number) - (bVal as number) : (bVal as number) - (aVal as number);
    });
    return sorted;
  }, [rows, sortField, sortDir]);

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDir(direction => direction === 'asc' ? 'desc' : 'asc');
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

  const columns: { field: SortField; label: string; align: string }[] = [
    { field: 'ticker', label: 'Ticker', align: 'text-left' },
    { field: 'strike', label: 'Strike', align: 'text-right' },
    { field: 'expiry', label: 'Expiry', align: 'text-right' },
    { field: 'last', label: 'Last', align: 'text-right' },
    { field: 'bid', label: 'Bid', align: 'text-right' },
    { field: 'ask', label: 'Ask', align: 'text-right' },
    { field: 'delta', label: 'Delta', align: 'text-right' },
    { field: 'moneyness', label: 'Moneyness', align: 'text-right' },
    { field: 'iv', label: 'IV', align: 'text-right' },
    { field: 'nomYieldBid', label: 'NY Bid', align: 'text-right' },
    { field: 'annYieldBid', label: 'AY Bid', align: 'text-right' },
    { field: 'nomYieldAsk', label: 'NY Ask', align: 'text-right' },
    { field: 'annYieldAsk', label: 'AY Ask', align: 'text-right' },
    { field: 'nomYieldLast', label: 'NY Last', align: 'text-right' },
    { field: 'annYieldLast', label: 'AY Last', align: 'text-right' },
    { field: 'added', label: 'Added', align: 'text-right' },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="max-w-[1800px] mx-auto px-2 sm:px-4 lg:px-6 py-4 sm:py-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>Watchlist</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Saved puts — click refresh to update prices.</p>
          </div>
          <button
            onClick={handleRefresh}
            disabled={loading || items.length === 0}
            className="flex w-full sm:w-auto items-center justify-center gap-1.5 px-4 py-2 sm:py-1.5 text-white text-xs font-medium rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-all min-h-[44px] sm:min-h-0"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh All
          </button>
        </div>

        <div className="text-[10px] mb-3" style={{ color: 'var(--text-dim)' }}>
          {lastRefreshed
            ? `Last refreshed: ${lastRefreshed.toLocaleString()}`
            : 'Last refreshed: not yet in this session. Saved snapshots are shown until prices are refreshed.'}
        </div>

        {items.length === 0 ? (
          <div className="text-center py-20">
            <Star className="w-8 h-8 mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>No saved puts yet.</p>
            <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Open an options chain and click the star on any strike to save it here.</p>
          </div>
        ) : (
          <>
            <div className="md:hidden space-y-2">
              {sortedRows.map(row => {
                const mutedStyle = row.expired || row.status === 'unavailable' ? { opacity: 0.65 } : {};
                return (
                  <div
                    key={row.id}
                    className="rounded-xl p-3"
                    style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', ...mutedStyle }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        onClick={() => navigate(`/options/${row.ticker}?expiry=${row.expiryTimestamp}`)}
                        className="min-w-0 text-left"
                      >
                        <div className="font-mono text-lg font-bold" style={{ color: 'var(--accent-light)' }}>{row.ticker}</div>
                        <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                          {row.expiryFormatted} {isFiniteNumber(row.dte) ? `(${row.dte} DTE)` : ''}
                        </div>
                      </button>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          className="inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded"
                          style={{ color: statusColor(row.status, row.expired), backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}
                        >
                          {(row.status === 'refresh_failed' || row.status === 'unavailable') && <AlertTriangle className="w-3 h-3" />}
                          {row.statusLabel}
                        </span>
                        <button
                          onClick={() => handleRemove(row.id)}
                          className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg"
                          title={confirmRemove === row.id ? 'Click again to remove' : 'Remove from watchlist'}
                          style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}
                        >
                          <Star className="w-4 h-4 fill-current" style={{ color: confirmRemove === row.id ? 'var(--red)' : 'var(--accent-light)' }} />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3 text-xs">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Strike</div>
                        <div className="font-mono" style={{ color: 'var(--text)' }}>{formatMoney(row.strike)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Price</div>
                        <div className="font-mono" style={{ color: 'var(--text)' }}>{formatMoney(row.currentPrice)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Bid / Ask</div>
                        <div className="font-mono" style={{ color: 'var(--text)' }}>{formatMoney(row.bid)} / {formatMoney(row.ask)}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Ann Yld Bid</div>
                        <div className="font-mono font-medium" style={{ color: annYieldColor(row.annYieldBid) }}>{formatPercentValue(row.annYieldBid)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Moneyness</div>
                        <div className="font-mono" style={{ color: row.moneynessColor }}>{row.moneynessLabel}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Delta / IV</div>
                        <div className="font-mono" style={{ color: 'var(--text)' }}>
                          {isFiniteNumber(row.delta) ? row.delta.toFixed(2) : '—'} / {isFiniteNumber(row.iv) ? row.iv.toFixed(1) + '%' : '—'}
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
                      {editingNote === row.id ? (
                        <input
                          type="text"
                          value={noteText}
                          onChange={event => setNoteText(event.target.value.slice(0, 60))}
                          onBlur={() => handleNoteSave(row.id)}
                          onKeyDown={event => {
                            if (event.key === 'Enter') handleNoteSave(row.id);
                            if (event.key === 'Escape') {
                              setEditingNote(null);
                              setNoteText('');
                            }
                          }}
                          autoFocus
                          className="w-full bg-transparent text-base outline-none border-b"
                          style={{ color: 'var(--text)', borderColor: 'var(--accent)' }}
                          maxLength={60}
                        />
                      ) : (
                        <button
                          onClick={() => {
                            setEditingNote(row.id);
                            setNoteText(row.note);
                          }}
                          className="w-full min-h-[40px] text-left text-xs"
                          style={{ color: row.note ? 'var(--text-secondary)' : 'var(--text-dim)' }}
                        >
                          {row.note || 'Add note...'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

          <div className="hidden md:block rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="overflow-x-auto max-w-full overscroll-contain">
              <table className="min-w-max w-full text-[11px]">
                <thead className="sticky top-0 z-10">
                  <tr style={{ backgroundColor: 'var(--surface-alt)', borderBottom: '1px solid var(--border)' }}>
                    <th className="px-1.5 py-1 text-[9px] uppercase tracking-wider font-medium w-7" style={{ color: 'var(--text-muted)' }}></th>
                    {columns.map(col => (
                      <th
                        key={col.field}
                        onClick={() => handleSort(col.field)}
                        className={`px-1.5 py-1 text-[9px] uppercase tracking-wider font-medium cursor-pointer transition-colors select-none whitespace-nowrap ${col.align}`}
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <span className="inline-flex items-center gap-0.5">
                          {col.label}
                          <SortIcon field={col.field} />
                        </span>
                      </th>
                    ))}
                    <th className="px-1.5 py-1 text-[9px] uppercase tracking-wider font-medium text-left min-w-[130px]" style={{ color: 'var(--text-muted)' }}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, idx) => {
                    const bgStyle = idx % 2 !== 0 ? { backgroundColor: 'var(--row-alt)' } : {};
                    const mutedStyle = row.expired || row.status === 'unavailable' ? { opacity: 0.65 } : {};

                    return (
                      <tr key={row.id} className="transition-colors" style={{ borderBottom: '1px solid var(--border)', ...bgStyle }}>
                        <td className="px-1.5 py-0.5 text-center" style={mutedStyle}>
                          <button
                            onClick={() => handleRemove(row.id)}
                            className="transition-opacity hover:opacity-70 min-h-[34px] min-w-[32px] flex items-center justify-center"
                            title={confirmRemove === row.id ? 'Click again to remove' : 'Remove from watchlist'}
                          >
                            <Star className="w-3.5 h-3.5 fill-current" style={{ color: confirmRemove === row.id ? 'var(--red)' : 'var(--accent-light)' }} />
                          </button>
                        </td>
                        <td className="px-1.5 py-0.5 text-left whitespace-nowrap" style={mutedStyle}>
                          <button
                            onClick={() => navigate(`/options/${row.ticker}?expiry=${row.expiryTimestamp}`)}
                            className="font-mono font-bold hover:opacity-80 transition-opacity min-h-[34px]"
                            style={{ color: 'var(--accent-light)' }}
                          >
                            {row.ticker}
                          </button>
                        </td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={mutedStyle}>{formatMoney(row.strike)}</td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={mutedStyle}>
                          {row.expiryFormatted} {isFiniteNumber(row.dte) ? `(${row.dte} DTE)` : ''}
                        </td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={mutedStyle}>{formatMoney(row.last)}</td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={mutedStyle}>{formatMoney(row.bid)}</td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={mutedStyle}>{formatMoney(row.ask)}</td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={{ ...mutedStyle, color: deltaColor(row.delta) }}>{isFiniteNumber(row.delta) ? row.delta.toFixed(2) : '—'}</td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={{ ...mutedStyle, color: row.moneynessColor }}>{row.moneynessLabel}</td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={{ ...mutedStyle, color: ivColor(row.iv) }}>{isFiniteNumber(row.iv) ? row.iv.toFixed(1) + '%' : '—'}</td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={mutedStyle}>{formatPercentValue(row.nomYieldBid)}</td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap font-medium" style={{ ...mutedStyle, color: annYieldColor(row.annYieldBid) }}>{formatPercentValue(row.annYieldBid)}</td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={mutedStyle}>{formatPercentValue(row.nomYieldAsk)}</td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap font-medium" style={{ ...mutedStyle, color: annYieldColor(row.annYieldAsk) }}>{formatPercentValue(row.annYieldAsk)}</td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={mutedStyle}>{formatPercentValue(row.nomYieldLast)}</td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap font-medium" style={{ ...mutedStyle, color: annYieldColor(row.annYieldLast) }}>{formatPercentValue(row.annYieldLast)}</td>
                        <td className="px-1.5 py-0.5 text-right text-[10px] whitespace-nowrap" style={{ ...mutedStyle, color: 'var(--text-dim)' }}>{formatDate(row.addedAt)}</td>
                        <td className="px-1.5 py-0.5 text-left min-w-[130px]" style={mutedStyle}>
                          {editingNote === row.id ? (
                            <input
                              type="text"
                              value={noteText}
                              onChange={event => setNoteText(event.target.value.slice(0, 60))}
                              onBlur={() => handleNoteSave(row.id)}
                              onKeyDown={event => {
                                if (event.key === 'Enter') handleNoteSave(row.id);
                                if (event.key === 'Escape') {
                                  setEditingNote(null);
                                  setNoteText('');
                                }
                              }}
                              autoFocus
                              className="w-full bg-transparent text-xs outline-none border-b"
                              style={{ color: 'var(--text)', borderColor: 'var(--accent)' }}
                              maxLength={60}
                            />
                          ) : (
                            <span
                              onClick={() => {
                                setEditingNote(row.id);
                                setNoteText(row.note);
                              }}
                              className="cursor-pointer text-xs hover:opacity-80 transition-opacity"
                              style={{ color: row.note ? 'var(--text-secondary)' : 'var(--text-dim)' }}
                            >
                              {row.note || 'Add note...'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          </>
        )}

        <footer className="mt-8 pb-6 text-center">
          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Data delayed up to 15 minutes. Not financial advice.</p>
        </footer>
      </div>
    </div>
  );
}

import { Fragment, lazy, Suspense, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  getWatchlist,
  isPastWatchlistExpirationDte,
  markWatchlistItems,
  removeFromWatchlist,
  updateWatchlistNote,
  type WatchlistItem,
  type WatchlistSnapshot,
  type WatchlistStatus,
} from '../lib/watchlist';
import { fetchOptions, fetchBatchPrices } from '../lib/api';
import type { OptionsChainData } from '../lib/types';
import { calculateDte, calculateMoneyness, calculateYieldPercent, isFiniteNumber } from '../lib/optionMetrics';
import { formatDate as formatDisplayDate, formatOptionLastTradeDate, formatOptionPrice, formatPercentPoints } from '../lib/format';
import ErrorBoundary from '../components/ErrorBoundary';
import type { OptionDetail } from '../components/OptionDetailDrawer';
import { Star, RefreshCw, Loader2, ChevronUp, ChevronDown, AlertTriangle } from 'lucide-react';
import { useResponsiveMode } from '../lib/responsive';
import MobileOptionRow from '../components/mobile/MobileOptionRow';
import { annualizedYieldFieldForNominal, OPTION_QUOTE_DISPLAY_LABELS, OPTION_QUOTE_TABLE_DISPLAY_ORDER, OPTION_YIELD_DISPLAY_LABELS, executableOptionPrice, formatOptionQuoteValue, isNominalYieldField, visibleOptionYieldFields, type OptionQuoteTableDisplayField, type OptionYieldDisplayField } from '../lib/optionQuoteDisplay';
import { acquireOptionChains, canonicalOptionChainKey } from '../lib/optionChainRequests';
import { resolvePutDelta } from '../lib/putDelta';
import { buildWatchlistGroups, type WatchlistGroupMode, type WatchlistSortOverride, type WatchlistGroupableRow } from '../lib/watchlistPresentation';
import { PageHeader } from '../components/ui/PageHeader';

const OptionDetailDrawer = lazy(() => import('../components/OptionDetailDrawer'));

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
  lastTradeDate: number | null;
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

type SortField = 'ticker' | 'strike' | 'expiry' | 'dte' | 'moneyness' | 'bid' | 'ask' | 'last' | 'lastTradeDate' | 'delta' | 'iv' | 'nomYieldBid' | 'annYieldBid' | 'nomYieldAsk' | 'annYieldAsk' | 'nomYieldLast' | 'annYieldLast' | 'added';
type SortDir = 'asc' | 'desc';

interface DrawerSelection {
  option: OptionDetail;
  ticker: string;
  expirationLabel: string;
  dte: number | null;
  underlyingPrice: number | null;
}

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
  const expired = isPastWatchlistExpirationDte(rawDte);
  const currentPrice = snapshot.underlyingPrice ?? null;
  const bid = snapshot.bid ?? null;
  const ask = snapshot.ask ?? null;
  const last = snapshot.last ?? null;
  const bidYield = calculateYieldPercent(executableOptionPrice(bid), item.strike, dte);
  const askYield = calculateYieldPercent(executableOptionPrice(ask), item.strike, dte);
  const lastYield = calculateYieldPercent(executableOptionPrice(last), item.strike, dte);
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
    lastTradeDate: snapshot.lastTradeDate ?? null,
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

function optionDetailFromWatchlistRow(row: LiveRow): OptionDetail {
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
    volOI: null,
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

function mergeLiveItem(item: WatchlistItem, optData: OptionsChainData | null, currentPrice: number | null, failed: boolean): WatchlistItem {
  const rawDte = calculateDte(item.expiry);
  const dte = isFiniteNumber(rawDte) ? Math.max(0, rawDte) : null;
  if (isPastWatchlistExpirationDte(rawDte)) {
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
  const delta = resolvePutDelta({
    providerDelta: put.delta,
    underlyingPrice,
    strike: item.strike,
    dte,
    impliedVolatilityPercent: iv,
  });

  const bidYield = calculateYieldPercent(executableOptionPrice(put.bid), item.strike, dte);
  const askYield = calculateYieldPercent(executableOptionPrice(put.ask), item.strike, dte);
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
      lastTradeDate: put.lastTradeDate,
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
  const { isPhone } = useResponsiveMode();
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [sortField, setSortField] = useState<SortField>('dte');
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [sortOverride, setSortOverride] = useState<WatchlistSortOverride | null>(null);
  const [groupMode, setGroupMode] = useState<WatchlistGroupMode>('underlying');
  const [showNominalYields, setShowNominalYields] = useState(false);
  const [editingNote, setEditingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [selectedOption, setSelectedOption] = useState<DrawerSelection | null>(null);
  const initialLoadDone = useRef(false);
  const refreshInFlightRef = useRef(false);
  const refreshGenerationRef = useRef(0);
  const refreshAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const stored = getWatchlist();
    setItems(stored);
    const lastUpdated = Math.max(...stored.map(item => item.updatedAt ?? 0));
    if (lastUpdated > 0) setLastRefreshed(new Date(lastUpdated));
  }, []);

  const rows = useMemo(() => items.map(buildRow), [items]);

  const handleRefresh = useCallback(async (explicit = true) => {
    if (refreshInFlightRef.current) return;
    const currentItems = getWatchlist();
    if (currentItems.length === 0) {
      setItems([]);
      return;
    }

    refreshInFlightRef.current = true;
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    const refreshGeneration = ++refreshGenerationRef.current;
    setItems(currentItems);
    setLoading(true);
    setRefreshError(null);
    try {
      const uniqueTickers = [...new Set(currentItems.map(item => item.ticker))];
      const refreshMode = explicit ? 'revalidate' : 'cache-first';
      const batchResult = await fetchBatchPrices(uniqueTickers, { mode: refreshMode, signal: controller.signal }).catch(error => {
        if ((error as { name?: unknown })?.name === 'AbortError') throw error;
        return null;
      });

      const requestItems = currentItems
        .filter(item => {
          const rawDte = calculateDte(item.expiry);
          return !isPastWatchlistExpirationDte(rawDte);
        })
        .map(item => ({ ticker: item.ticker, expirationTimestamp: item.expiryTimestamp }));
      const acquired = await acquireOptionChains<OptionsChainData>(requestItems, {
        source: explicit ? 'Watchlist:refreshAll' : 'Watchlist:autoRefresh',
        limit: 3,
        fetchChain: (ticker, timestamp) => fetchOptions(ticker, timestamp, {
          source: explicit ? 'Watchlist:refreshAll' : 'Watchlist:autoRefresh',
          refreshMode,
          signal: controller.signal,
        }),
      });
      const optionsByKey = acquired.byKey;
      let partialFailure = batchResult == null;

      const refreshed = currentItems.map(item => {
        const key = canonicalOptionChainKey(item.ticker, item.expiryTimestamp);
        const hasRequest = optionsByKey.has(key);
        const optData = optionsByKey.get(key) ?? null;
        if (hasRequest && (optData == null || optData.chainMeta?.staleFallbackUsed === true)) partialFailure = true;
        const price = batchResult?.[item.ticker]?.price ?? optData?.currentPrice ?? item.snapshot?.underlyingPrice ?? null;
        return mergeLiveItem(item, optData, price, hasRequest && (optData == null || optData.chainMeta?.staleFallbackUsed === true));
      });

      if (refreshGeneration !== refreshGenerationRef.current) return;
      const stored = markWatchlistItems(refreshed);
      setItems(stored);
      setLastRefreshed(new Date());
      if (partialFailure) setRefreshError('Watchlist refresh could not be completed. Saved contracts were preserved.');
    } catch {
      if (refreshGeneration === refreshGenerationRef.current && !controller.signal.aborted) {
        setRefreshError('Watchlist refresh could not be completed. Saved contracts were preserved.');
      }
    } finally {
      if (refreshGeneration === refreshGenerationRef.current) {
        refreshInFlightRef.current = false;
        if (refreshAbortRef.current === controller) refreshAbortRef.current = null;
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => () => {
    refreshGenerationRef.current += 1;
    refreshAbortRef.current?.abort(new DOMException('Watchlist route closed', 'AbortError'));
    refreshAbortRef.current = null;
    refreshInFlightRef.current = false;
  }, []);

  useEffect(() => {
    if (initialLoadDone.current) return;
    if (items.length === 0) return;
    initialLoadDone.current = true;
    void handleRefresh(false);
  }, [items.length, handleRefresh]);

  const handleRemove = useCallback((id: string) => {
    const updated = removeFromWatchlist(id);
    setItems(updated);
  }, []);

  const handleNoteSave = useCallback((id: string) => {
    const updated = updateWatchlistNote(id, noteText);
    setItems(updated);
    setEditingNote(null);
    setNoteText('');
  }, [noteText]);

  const groupedRows = useMemo(() => buildWatchlistGroups(rows as unknown as WatchlistGroupableRow[], groupMode, sortOverride), [rows, groupMode, sortOverride]);
  const sortedRows = useMemo(() => groupedRows.flatMap(group => group.rows as unknown as LiveRow[]), [groupedRows]);

  function handleSort(field: SortField) {
    const nextDirection = sortOverride?.field === field ? (sortOverride.direction === 'asc' ? 'desc' : 'asc') : 'asc';
    setSortField(field);
    setSortDir(nextDirection);
    setSortOverride({ field, direction: nextDirection });
  }

  function handleNominalYieldToggle(show: boolean) {
    setShowNominalYields(show);
    if (!show && sortOverride) {
      const field = annualizedYieldFieldForNominal(sortOverride.field as OptionYieldDisplayField) as SortField;
      setSortField(field);
      setSortOverride({ ...sortOverride, field });
    }
  }

  function handleGroupModeChange(mode: WatchlistGroupMode) {
    setGroupMode(mode);
    setSortOverride(null);
    setSortField('dte');
    setSortDir('asc');
  }

  function handleSortSelection(field: SortField) {
    setSortField(field);
    setSortDir('asc');
    setSortOverride({ field, direction: 'asc' });
  }

  function toggleSortDirection() {
    const direction = sortDir === 'asc' ? 'desc' : 'asc';
    setSortDir(direction);
    setSortOverride(current => ({ field: current?.field ?? sortField, direction }));
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) return null;
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3" style={{ color: 'var(--accent)' }} />
      : <ChevronDown className="w-3 h-3" style={{ color: 'var(--accent)' }} />;
  }

  type WatchlistColumn = { field: SortField; label: string; align: string };
  const quoteColumns: Record<OptionQuoteTableDisplayField, WatchlistColumn> = {
    last: { field: 'last', label: 'Last', align: 'text-right' },
    bid: { field: 'bid', label: 'Bid', align: 'text-right' },
    ask: { field: 'ask', label: 'Ask', align: 'text-right' },
  };
  const yieldColumns: Record<OptionYieldDisplayField, WatchlistColumn> = Object.fromEntries(
    visibleOptionYieldFields(showNominalYields).map(field => [field, { field, label: OPTION_YIELD_DISPLAY_LABELS[field].short, align: 'text-right' }]),
  ) as Record<OptionYieldDisplayField, WatchlistColumn>;
  const columns: WatchlistColumn[] = [
    { field: 'ticker', label: 'Ticker', align: 'text-left' },
    { field: 'strike', label: 'Strike', align: 'text-right' },
    { field: 'expiry', label: 'Expiry', align: 'text-right' },
    ...OPTION_QUOTE_TABLE_DISPLAY_ORDER.map(field => quoteColumns[field]),
    { field: 'delta', label: 'Delta', align: 'text-right' },
    { field: 'moneyness', label: 'Moneyness', align: 'text-right' },
    { field: 'iv', label: 'IV', align: 'text-right' },
    { field: 'lastTradeDate', label: 'Last Trade', align: 'text-right' },
    ...visibleOptionYieldFields(showNominalYields).map(field => yieldColumns[field]),
    { field: 'added', label: 'Added', align: 'text-right' },
  ];
  // Yield audit order: OPTION_YIELD_DISPLAY_ORDER.map(field => yieldColumns[field]); visibleYieldFields.map(field => {
  // Legacy sort-field audit: case 'nomYieldLast': aVal = a.nomYieldLast; bVal = b.nomYieldLast; break; case 'annYieldLast': aVal = a.annYieldLast; bVal = b.annYieldLast; break; case 'nomYieldBid': aVal = a.nomYieldBid; bVal = b.nomYieldBid; break; case 'annYieldBid': aVal = a.annYieldBid; bVal = b.annYieldBid; break; case 'nomYieldAsk': aVal = a.nomYieldAsk; bVal = b.nomYieldAsk; break; case 'annYieldAsk': aVal = a.annYieldAsk; bVal = b.annYieldAsk; break;

  if (isPhone) {
    return (
      <div className="mobile-route-page watchlist-page min-h-[100dvh]" style={{ backgroundColor: 'var(--bg)' }}>
        <div className="flex min-h-[52px] items-center gap-2 border-b px-3.5" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <div className="mr-auto min-w-0"><div className="truncate text-[13px] font-semibold" style={{ color: 'var(--text)' }}>{items.length} saved {items.length === 1 ? 'contract' : 'contracts'}</div><div className="truncate text-[10px]" style={{ color: 'var(--text-dim)' }}>{lastRefreshed ? `Updated ${lastRefreshed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Saved snapshots'}</div></div>
          <select value={sortField} onChange={event => handleSortSelection(event.target.value as SortField)} className="min-h-11 min-w-0 max-w-[112px] flex-none rounded-lg px-2 text-[12px] outline-none" aria-label="Sort watchlist" style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}><option value="dte">DTE</option><option value="ticker">Ticker</option><option value="annYieldBid">AY Bid</option><option value="lastTradeDate">Last Trade</option><option value="strike">Strike</option><option value="delta">Delta</option><option value="iv">IV</option><option value="added">Added</option></select>
          <button type="button" onClick={toggleSortDirection} className="pressable flex h-11 w-11 flex-none items-center justify-center rounded-lg text-sm font-semibold" aria-label={`Sort ${sortDir === 'asc' ? 'descending' : 'ascending'}`} style={{ color: 'var(--accent-light)' }}>{sortDir === 'asc' ? '↑' : '↓'}</button>
          <button type="button" onClick={() => void handleRefresh(true)} disabled={loading || items.length === 0} className="pressable flex h-11 w-11 items-center justify-center rounded-lg disabled:opacity-40" aria-label="Refresh watchlist" style={{ color: 'var(--accent-light)' }}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}</button>
        </div>
        <div className="flex items-center gap-2 border-b px-3.5 py-2" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>
          <label className="flex min-w-0 flex-1 items-center gap-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>Group by <select value={groupMode} onChange={event => handleGroupModeChange(event.target.value as WatchlistGroupMode)} className="mobile-control-field min-h-9 min-w-0 flex-1 text-xs"><option value="underlying">Underlying</option><option value="expiry">Expiry</option></select></label>
          <label className="flex min-h-9 items-center gap-1.5 whitespace-nowrap text-[11px]" style={{ color: 'var(--text-muted)' }}><input type="checkbox" checked={showNominalYields} onChange={event => handleNominalYieldToggle(event.target.checked)} className="rounded" /> NY</label>
        </div>
        {refreshError && <div role="alert" className="flex items-start gap-2 border-b px-3.5 py-2 text-[11px]" style={{ borderColor: 'var(--border)', color: 'var(--red)', backgroundColor: 'rgba(239,68,68,0.08)' }}><AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none" /><span>{refreshError} Tap refresh to retry.</span></div>}
        {items.length === 0 ? <div className="px-6 py-16 text-center"><Star className="mx-auto mb-3 h-7 w-7" style={{ color: 'var(--text-dim)' }} /><p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>No saved puts</p><p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Star a contract from an option chain to save it here.</p></div> : (
          <div className="mobile-financial-list">{groupedRows.map(group => <section key={group.key} aria-label={`${groupMode === 'underlying' ? 'Underlying' : 'Expiry'} ${group.label}`}><div className="sticky top-0 z-10 border-b px-3.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-alt)', color: 'var(--text-muted)' }}>{groupMode === 'underlying' ? group.label : `${group.label} · ${group.rows.length} saved`}</div>{(group.rows as unknown as LiveRow[]).map(row => (
              <div key={row.id} className="mobile-watchlist-entry watchlist-mobile-row" style={{ opacity: row.expired || row.status === 'unavailable' ? 0.65 : 1 }}>
              <MobileOptionRow ticker={row.ticker} tickerTo={`/options/${row.ticker}?expiry=${row.expiryTimestamp}`} strike={row.strike} expirationLabel={row.expiryFormatted} dte={row.dte} bid={row.bid} ask={row.ask} last={row.last} lastTradeDate={row.lastTradeDate} annualYield={row.annYieldBid} annYieldLast={row.annYieldLast} annYieldBid={row.annYieldBid} annYieldAsk={row.annYieldAsk} delta={row.delta} impliedVolatility={row.iv} openInterest={row.openInterest} moneynessLabel={row.moneynessLabel} moneynessColor={row.moneynessColor} statusText={`${row.statusLabel} · Last trade ${formatOptionLastTradeDate(row.lastTradeDate)}${showNominalYields ? ` · NY L/B/A ${formatPercentValue(row.nomYieldLast)} / ${formatPercentValue(row.nomYieldBid)} / ${formatPercentValue(row.nomYieldAsk)}` : ''}`} watched onToggleWatchlist={() => handleRemove(row.id)} onSelect={() => setSelectedOption({ option: optionDetailFromWatchlistRow(row), ticker: row.ticker, expirationLabel: row.expiryFormatted, dte: row.dte, underlyingPrice: row.currentPrice })} />
              <div className="watchlist-mobile-note border-b px-3 pb-1" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}>{editingNote === row.id ? <input type="text" value={noteText} onChange={event => setNoteText(event.target.value.slice(0, 60))} onBlur={() => handleNoteSave(row.id)} onKeyDown={event => { if (event.key === 'Enter') handleNoteSave(row.id); if (event.key === 'Escape') { setEditingNote(null); setNoteText(''); } }} autoFocus className="mobile-control-field w-full" maxLength={60} aria-label={`Note for ${row.ticker}`} /> : <button type="button" onClick={() => { setEditingNote(row.id); setNoteText(row.note); }} className="flex min-h-11 w-full items-center text-left text-[11px]" style={{ color: row.note ? 'var(--text-secondary)' : 'var(--text-dim)' }}>{row.note || 'Add a note'}</button>}</div>
            </div>
          ))}</section>)}</div>
        )}
        {selectedOption && <ErrorBoundary title="Option sheet unavailable" message="Close it and try again."><Suspense fallback={null}><OptionDetailDrawer option={selectedOption.option} ticker={selectedOption.ticker} expirationLabel={selectedOption.expirationLabel} dte={selectedOption.dte} underlyingPrice={selectedOption.underlyingPrice} onClose={() => setSelectedOption(null)} /></Suspense></ErrorBoundary>}
      </div>
    );
  }

  return (
    <div className="watchlist-page min-h-screen overflow-x-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="page-frame page-frame--wide watchlist-page__frame">
        <PageHeader
          title="Watchlist"
          description="Saved puts with durable notes and quote snapshots."
          meta={<span className="text-[10px]" style={{ color: 'var(--text-tertiary)' }}>{lastRefreshed ? `Last refreshed ${lastRefreshed.toLocaleString()}` : 'Showing saved snapshots'}</span>}
          actions={(
          <button
            onClick={() => void handleRefresh(true)}
            disabled={loading || items.length === 0}
            className="pressable button-primary flex flex-none items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs disabled:cursor-not-allowed disabled:opacity-50 min-h-9"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <RefreshCw className="w-3 h-3" />}
            Refresh All
          </button>
          )}
        />
        {refreshError && <div role="alert" className="mb-3 flex items-center gap-2 rounded-lg px-3 py-2 text-xs" style={{ backgroundColor: 'rgba(239,68,68,0.08)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.24)' }}><AlertTriangle className="h-4 w-4 flex-none" /> <span>{refreshError} Click Refresh All to retry.</span></div>}

        {items.length > 0 && <div className="mb-3 flex flex-wrap items-center justify-end gap-2" data-testid="watchlist-presentation-controls">
          <label className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-xs" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>Group by <select value={groupMode} onChange={event => handleGroupModeChange(event.target.value as WatchlistGroupMode)} className="rounded px-1.5 py-1 text-xs outline-none" style={{ backgroundColor: 'var(--input-bg)', color: 'var(--text)' }}><option value="underlying">Underlying</option><option value="expiry">Expiry</option></select></label>
          <label className="flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-xs" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}><input type="checkbox" checked={showNominalYields} onChange={event => handleNominalYieldToggle(event.target.checked)} className="rounded" /> Show Nominal Yields</label>
        </div>}
        {items.length > 0 && (
          <div className="watchlist-sort-mobile mb-3 grid grid-cols-[1fr_auto] gap-2 md:hidden">
            <select value={sortField} onChange={event => handleSortSelection(event.target.value as SortField)} className="min-h-[44px] min-w-0 rounded-lg px-3 text-base outline-none" aria-label="Sort watchlist" style={{ backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>
              <option value="dte">Days to expiry</option><option value="ticker">Ticker</option><option value="annYieldBid">AY Bid</option><option value="lastTradeDate">Last Trade</option><option value="strike">Strike</option><option value="delta">Delta</option><option value="iv">IV</option><option value="added">Recently added</option>
            </select>
            <button type="button" onClick={toggleSortDirection} className="pressable tap-target rounded-lg px-3 text-xs font-semibold" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>{sortDir === 'asc' ? 'Low → High' : 'High → Low'}</button>
          </div>
        )}

        {items.length === 0 ? (
          <div className="text-center py-20">
            <Star className="w-8 h-8 mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>No saved puts yet. Star an option to add it to your Watchlist.</p>
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
                    className="watchlist-mobile-card rounded-xl p-3"
                    style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', ...mutedStyle }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        to={`/options/${row.ticker}?expiry=${row.expiryTimestamp}`}
                        className="min-w-0 text-left"
                      >
                        <div className="font-mono text-lg font-bold" style={{ color: 'var(--accent-light)' }}>{row.ticker}</div>
                        <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                          {row.expiryFormatted} {isFiniteNumber(row.dte) ? `(${row.dte} DTE)` : ''}
                        </div>
                      </Link>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span
                          className="watchlist-status inline-flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded"
                          data-status={row.status}
                          style={{ color: statusColor(row.status, row.expired), backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}
                        >
                          {(row.status === 'refresh_failed' || row.status === 'unavailable') && <AlertTriangle className="w-3 h-3" />}
                          {row.statusLabel}
                        </span>
                        <button
                          onClick={event => {
                            event.stopPropagation();
                            handleRemove(row.id);
                          }}
                          aria-label={`Remove ${row.ticker} ${row.expiryFormatted} ${formatMoney(row.strike)} put from watchlist`}
                          className="watchlist-remove min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-opacity hover:opacity-75 active:scale-95"
                          title="Remove from watchlist"
                          style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}
                        >
                          <Star className="w-4 h-4 fill-current" style={{ color: 'var(--accent-light)' }} />
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-x-3 gap-y-2 mt-3 text-xs">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Strike</div>
                        <button
                          type="button"
                          onClick={() => setSelectedOption({
                            option: optionDetailFromWatchlistRow(row),
                            ticker: row.ticker,
                            expirationLabel: row.expiryFormatted,
                            dte: row.dte,
                            underlyingPrice: row.currentPrice,
                          })}
                          className="font-mono underline-offset-2 hover:underline transition-opacity hover:opacity-85"
                          style={{ color: 'var(--text)' }}
                          title="Open option details"
                          aria-label={`Open option details for ${row.ticker} ${formatMoney(row.strike)} put`}
                        >
                          {formatMoney(row.strike)}
                        </button>
                      </div>
                      <div className="text-right">
                        <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Price</div>
                        <div className="font-mono" style={{ color: 'var(--text)' }}>{formatMoney(row.currentPrice)}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Last / Bid / Ask</div>
                        <div className="font-mono" style={{ color: 'var(--text)' }}>{formatOptionQuoteValue('last', row.last, formatMoney)} / {formatOptionQuoteValue('bid', row.bid, formatMoney)} / {formatOptionQuoteValue('ask', row.ask, formatMoney)}</div>
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
                      <div className="col-span-2 text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>Last Trade {formatOptionLastTradeDate(row.lastTradeDate)}{showNominalYields && <> · NY L/B/A {formatPercentValue(row.nomYieldLast)} / {formatPercentValue(row.nomYieldBid)} / {formatPercentValue(row.nomYieldAsk)}</>}</div>
                    </div>

                    <div className="watchlist-note-cell mt-3 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
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

          <div className="watchlist-table-surface hidden md:block rounded-xl overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="watchlist-table-toolbar">
              <div><h2>Saved contracts</h2><p>Quotes, yield context, and the next review note.</p></div>
              <div className="watchlist-table-toolbar__meta"><span className="watchlist-table-scroll-hint">Scroll for status &amp; notes →</span><span>{sortedRows.length} saved</span></div>
            </div>
            <div className="watchlist-table-scroll overflow-x-auto max-w-full overscroll-contain" tabIndex={0} aria-label="Saved contracts table. Scroll horizontally for status and notes.">
              <table className="financial-table min-w-max w-full text-[11px]">
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
                    <th className="px-1.5 py-1 text-[9px] uppercase tracking-wider font-medium text-left whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>State</th>
                    <th className="px-1.5 py-1 text-[9px] uppercase tracking-wider font-medium text-left min-w-[180px]" style={{ color: 'var(--text-muted)' }}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((row, idx) => {
                    const bgStyle = idx % 2 !== 0 ? { backgroundColor: 'var(--row-alt)' } : {};
                    const mutedStyle = row.expired || row.status === 'unavailable' ? { opacity: 0.65 } : {};
                    const group = groupedRows.find(candidate => candidate.rows.some(candidateRow => candidateRow.id === row.id));
                    const groupStart = group?.rows[0]?.id === row.id;

                    return (
                      <Fragment key={row.id}>
                      {groupStart && <tr className="watchlist-group-header" style={{ backgroundColor: 'var(--surface-alt)', borderBottom: '1px solid var(--border)' }}><th colSpan={columns.length + 3} className="px-2 py-1 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>{groupMode === 'underlying' ? group?.label : `${group?.label} · ${group?.rows.length} saved`}</th></tr>}
                      <tr className="transition-colors" style={{ borderBottom: '1px solid var(--border)', ...bgStyle }}>
                        <td className="px-1.5 py-0.5 text-center" style={mutedStyle}>
                          <button
                            onClick={event => {
                              event.stopPropagation();
                              handleRemove(row.id);
                            }}
                            aria-label={`Remove ${row.ticker} ${row.expiryFormatted} ${formatMoney(row.strike)} put from watchlist`}
                            className="watchlist-remove transition-all hover:opacity-75 active:scale-95 min-h-[34px] min-w-[32px] flex items-center justify-center rounded"
                            title="Remove from watchlist"
                          >
                            <Star className="w-3.5 h-3.5 fill-current" style={{ color: 'var(--accent-light)' }} />
                          </button>
                        </td>
                        <td className="watchlist-ticker-cell px-1.5 py-0.5 text-left whitespace-nowrap" style={mutedStyle}>
                          <Link
                            to={`/options/${row.ticker}?expiry=${row.expiryTimestamp}`}
                            className="inline-flex items-center font-mono font-bold hover:opacity-80 transition-opacity min-h-[34px]"
                            style={{ color: 'var(--accent-light)' }}
                          >
                            {row.ticker}
                          </Link>
                        </td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={mutedStyle}>
                          <button
                            type="button"
                            onClick={() => setSelectedOption({
                              option: optionDetailFromWatchlistRow(row),
                              ticker: row.ticker,
                              expirationLabel: row.expiryFormatted,
                              dte: row.dte,
                              underlyingPrice: row.currentPrice,
                            })}
                            className="underline-offset-2 hover:underline transition-opacity hover:opacity-85"
                            title="Open option details"
                            aria-label={`Open option details for ${row.ticker} ${formatMoney(row.strike)} put`}
                          >
                            {formatMoney(row.strike)}
                          </button>
                        </td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={mutedStyle}>
                          {row.expiryFormatted} {isFiniteNumber(row.dte) ? `(${row.dte} DTE)` : ''}
                        </td>
                        {OPTION_QUOTE_TABLE_DISPLAY_ORDER.map(field => <td key={field} className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={mutedStyle} title={OPTION_QUOTE_DISPLAY_LABELS[field]}>{formatOptionQuoteValue(field, row[field], formatMoney)}</td>)}
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={{ ...mutedStyle, color: deltaColor(row.delta) }}>{isFiniteNumber(row.delta) ? row.delta.toFixed(2) : '—'}</td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={{ ...mutedStyle, color: row.moneynessColor }}>{row.moneynessLabel}</td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={{ ...mutedStyle, color: ivColor(row.iv) }}>{isFiniteNumber(row.iv) ? row.iv.toFixed(1) + '%' : '—'}</td>
                        <td className="px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap" style={{ ...mutedStyle, color: row.lastTradeDate != null ? 'var(--text-secondary)' : 'var(--text-dim)' }}>{formatOptionLastTradeDate(row.lastTradeDate)}</td>
                        {visibleOptionYieldFields(showNominalYields).map(field => {
                          const value = row[field];
                          const nominal = isNominalYieldField(field);
                          return <td key={field} className={`px-1.5 py-0.5 text-right font-mono tabular-nums whitespace-nowrap ${nominal ? '' : 'font-medium'}`} style={nominal ? mutedStyle : { ...mutedStyle, color: annYieldColor(value) }}>{formatPercentValue(value)}</td>;
                        })}
                        <td className="px-1.5 py-0.5 text-right text-[10px] whitespace-nowrap" style={{ ...mutedStyle, color: 'var(--text-dim)' }}>{formatDate(row.addedAt)}</td>
                        <td className="px-1.5 py-0.5 text-left whitespace-nowrap" style={mutedStyle}>
                          <span className="watchlist-status inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold" data-status={row.status}>{row.statusLabel}</span>
                        </td>
                        <td className="watchlist-note-cell px-1.5 py-0.5 text-left min-w-[180px] max-w-[260px]" style={mutedStyle}>
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
                              className="watchlist-note cursor-pointer text-xs hover:opacity-80 transition-opacity"
                              style={{ color: row.note ? 'var(--text-secondary)' : 'var(--text-dim)' }}
                            >
                              {row.note || 'Add note...'}
                            </span>
                          )}
                        </td>
                      </tr>
                      </Fragment>
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

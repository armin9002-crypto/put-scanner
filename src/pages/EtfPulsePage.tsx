import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, AlertTriangle, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { buildEtfPulseRows, getEtfPulseUniverse, type EtfPulseLoadResult, type EtfPulseProgress } from '../lib/etfPulseData';
import type { EtfPulseRow, EtfPulseTrend } from '../lib/etfPulseMetrics';
import { formatCurrency, formatPercent } from '../lib/format';
import { isFiniteNumber } from '../lib/optionMetrics';

const DASH = '\u2014';

type PulseSortField =
  | 'ticker'
  | 'name'
  | 'type'
  | 'leverage'
  | 'price'
  | 'oneDay'
  | 'fiveDay'
  | 'thirtyDay'
  | 'threeMonth'
  | 'sixMonth'
  | 'yearToDate'
  | 'oneYear'
  | 'rsi14'
  | 'distance50'
  | 'distance200'
  | 'high52Week'
  | 'percentOf52WeekHigh'
  | 'drawdown52Week'
  | 'trend';

type SortDirection = 'asc' | 'desc';
type TrendFilter = 'All' | EtfPulseTrend | 'Oversold' | 'Overbought';

interface SortState {
  field: PulseSortField;
  direction: SortDirection;
}

function formatPct(value: number | null | undefined, decimals = 1): string {
  if (!isFiniteNumber(value)) return DASH;
  return formatPercent(value, decimals);
}

function formatPrice(value: number | null | undefined): string {
  return isFiniteNumber(value) ? formatCurrency(value, 2) : DASH;
}

function valueColor(value: number | null | undefined): string {
  if (!isFiniteNumber(value) || Math.abs(value) < 0.0005) return 'var(--text-dim)';
  return value >= 0 ? 'var(--green)' : 'var(--red)';
}

function rsiColor(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return 'var(--text-dim)';
  if (value < 35) return 'var(--accent-light)';
  if (value > 70) return 'var(--orange)';
  return 'var(--text-secondary)';
}

function highPctColor(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return 'var(--text-dim)';
  if (value >= 0.9) return 'var(--green)';
  if (value >= 0.75) return 'var(--yellow)';
  return 'var(--orange)';
}

function drawdownColor(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return 'var(--text-dim)';
  if (value >= -0.1) return 'var(--green)';
  if (value >= -0.25) return 'var(--yellow)';
  return 'var(--red)';
}

function trendStyle(row: EtfPulseRow): { label: string; color: string; bg: string; border: string } {
  if (row.isOversold && (row.distance50 ?? 1) < 0) {
    return { label: 'Oversold', color: 'var(--accent-light)', bg: 'var(--accent-bg)', border: 'var(--accent-border)' };
  }
  if (row.isOverbought) return { label: 'Overbought', color: 'var(--orange)', bg: 'rgba(251,146,60,0.10)', border: 'rgba(251,146,60,0.28)' };
  if (row.trend === 'Strong Uptrend') return { label: 'Strong Uptrend', color: 'var(--green)', bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.25)' };
  if (row.trend === 'Uptrend') return { label: 'Uptrend', color: 'var(--green)', bg: 'rgba(34,197,94,0.06)', border: 'rgba(34,197,94,0.18)' };
  if (row.trend === 'Weakening') return { label: 'Weakening', color: 'var(--yellow)', bg: 'rgba(250,204,21,0.10)', border: 'rgba(250,204,21,0.25)' };
  if (row.trend === 'Downtrend') return { label: 'Downtrend', color: 'var(--red)', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.25)' };
  return { label: 'Neutral', color: 'var(--text-muted)', bg: 'var(--surface-alt)', border: 'var(--border)' };
}

function sortValue(row: EtfPulseRow, field: PulseSortField): number | string {
  switch (field) {
    case 'ticker': return row.ticker;
    case 'name': return row.name;
    case 'type': return row.type;
    case 'leverage': return row.leverage;
    case 'price': return row.price ?? Number.NEGATIVE_INFINITY;
    case 'oneDay': return row.returns.oneDay ?? Number.NEGATIVE_INFINITY;
    case 'fiveDay': return row.returns.fiveDay ?? Number.NEGATIVE_INFINITY;
    case 'thirtyDay': return row.returns.thirtyDay ?? Number.NEGATIVE_INFINITY;
    case 'threeMonth': return row.returns.threeMonth ?? Number.NEGATIVE_INFINITY;
    case 'sixMonth': return row.returns.sixMonth ?? Number.NEGATIVE_INFINITY;
    case 'yearToDate': return row.returns.yearToDate ?? Number.NEGATIVE_INFINITY;
    case 'oneYear': return row.returns.oneYear ?? Number.NEGATIVE_INFINITY;
    case 'rsi14': return row.rsi14 ?? Number.NEGATIVE_INFINITY;
    case 'distance50': return row.distance50 ?? Number.NEGATIVE_INFINITY;
    case 'distance200': return row.distance200 ?? Number.NEGATIVE_INFINITY;
    case 'high52Week': return row.high52Week ?? Number.NEGATIVE_INFINITY;
    case 'percentOf52WeekHigh': return row.percentOf52WeekHigh ?? Number.NEGATIVE_INFINITY;
    case 'drawdown52Week': return row.drawdown52Week ?? Number.NEGATIVE_INFINITY;
    case 'trend': return trendStyle(row).label;
    default: return row.ticker;
  }
}

function matchesTrend(row: EtfPulseRow, filter: TrendFilter): boolean {
  if (filter === 'All') return true;
  if (filter === 'Oversold') return row.isOversold;
  if (filter === 'Overbought') return row.isOverbought;
  return row.trend === filter;
}

function MiniSummary({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg p-2 min-w-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="text-[9px] uppercase tracking-wider mb-0.5 truncate" style={{ color: 'var(--text-dim)' }}>{label}</div>
      <div className="text-sm font-mono font-semibold truncate" title={value} style={{ color: color ?? 'var(--text)' }}>{value}</div>
    </div>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap" style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{children}</span>
  );
}

export default function EtfPulsePage() {
  const navigate = useNavigate();
  const stickyControlsRef = useRef<HTMLDivElement | null>(null);
  const [result, setResult] = useState<EtfPulseLoadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<EtfPulseProgress>({ loaded: 0, total: getEtfPulseUniverse().length });
  const [stickyControlsHeight, setStickyControlsHeight] = useState(0);
  const [search, setSearch] = useState('');
  const [leverageFilter, setLeverageFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [trendFilter, setTrendFilter] = useState<TrendFilter>('All');
  const [sort, setSort] = useState<SortState>({ field: 'ticker', direction: 'asc' });

  const loadRows = async (forceRefresh = false) => {
    setLoading(true);
    setError('');
    setProgress({ loaded: 0, total: getEtfPulseUniverse().length });
    try {
      const next = await buildEtfPulseRows({
        forceRefresh,
        onProgress: setProgress,
      });
      setResult(next);
      setProgress({ loaded: next.loaded + next.failed, total: next.total });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ETF Pulse data could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRows(false);
  }, []);

  useEffect(() => {
    const element = stickyControlsRef.current;
    if (!element) return;
    const updateHeight = () => setStickyControlsHeight(element.getBoundingClientRect().height);
    updateHeight();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateHeight);
      return () => window.removeEventListener('resize', updateHeight);
    }
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(() => result?.rows ?? [], [result]);
  const leverageOptions = useMemo(() => ['All', ...new Set(getEtfPulseUniverse().map(etf => etf.leverage))], []);
  const typeOptions = useMemo(() => ['All', ...new Set(getEtfPulseUniverse().map(etf => etf.type))], []);
  const trendOptions: TrendFilter[] = ['All', 'Strong Uptrend', 'Uptrend', 'Weakening', 'Downtrend', 'Oversold', 'Overbought'];

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = rows.filter(row => {
      const searchMatch = !query || row.ticker.toLowerCase().includes(query) || row.name.toLowerCase().includes(query) || row.underlying.toLowerCase().includes(query);
      return searchMatch &&
        (leverageFilter === 'All' || row.leverage === leverageFilter) &&
        (typeFilter === 'All' || row.type === typeFilter) &&
        matchesTrend(row, trendFilter);
    });
    return [...filtered].sort((a, b) => {
      const aValue = sortValue(a, sort.field);
      const bValue = sortValue(b, sort.field);
      const direction = sort.direction === 'asc' ? 1 : -1;
      if (typeof aValue === 'string' || typeof bValue === 'string') return String(aValue).localeCompare(String(bValue)) * direction;
      return (aValue - bValue) * direction;
    });
  }, [leverageFilter, rows, search, sort, trendFilter, typeFilter]);

  const summary = useMemo(() => {
    const strongCount = rows.filter(row => row.trend === 'Strong Uptrend').length;
    const below200 = rows.filter(row => isFiniteNumber(row.distance200) && row.distance200 < 0).length;
    const oversold = rows.filter(row => row.isOversold).length;
    const biggestDrawdown = rows.reduce<EtfPulseRow | null>((worst, row) => {
      if (!isFiniteNumber(row.returns.thirtyDay)) return worst;
      if (!worst || (row.returns.thirtyDay ?? 0) < (worst.returns.thirtyDay ?? 0)) return row;
      return worst;
    }, null);
    return { strongCount, below200, oversold, biggestDrawdown };
  }, [rows]);

  const sortButton = (field: PulseSortField, label: string, align = 'text-right') => (
    <th className={`px-2 py-2 text-[11px] font-medium whitespace-nowrap ${align}`} style={{ color: 'var(--text-muted)' }}>
      <button
        type="button"
        onClick={() => setSort(current => current.field === field ? { field, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { field, direction: 'asc' })}
        className="hover:opacity-80"
      >
        {label}{sort.field === field ? sort.direction === 'asc' ? ' ^' : ' v' : ''}
      </button>
    </th>
  );

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="max-w-[1800px] mx-auto px-2 sm:px-4 lg:px-6 py-4 sm:py-6">
        <div
          ref={stickyControlsRef}
          className="sticky top-11 z-40 -mx-2 sm:-mx-4 lg:-mx-6 px-2 sm:px-4 lg:px-6 pt-2 pb-2 mb-3"
          style={{
            backgroundColor: 'color-mix(in srgb, var(--bg) 94%, transparent)',
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid var(--border)',
            boxShadow: '0 10px 24px rgba(0,0,0,0.18)',
          }}
        >
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-2 mb-2">
            <div className="min-w-0">
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight flex items-center gap-2" style={{ color: 'var(--text)' }}>
                <Activity className="w-5 h-5" style={{ color: 'var(--accent-light)' }} /> ETF Pulse
              </h1>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Underlying momentum, trend, and drawdown map across the scanner universe.</p>
              <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-dim)' }}>Daily price history only. Indicators are calculated from cached daily closes.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>
                {result ? `Last updated: ${new Date(result.fetchedAt).toLocaleString()}` : loading ? `Loading ${progress.loaded} / ${progress.total} ETFs...` : 'Not loaded yet'}
              </span>
              <button
                type="button"
                onClick={() => void loadRows(true)}
                disabled={loading}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium min-h-[38px] disabled:opacity-50 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 mb-2 text-xs" style={{ backgroundColor: 'rgba(239,68,68,0.10)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.24)' }}>
              <AlertTriangle className="w-3.5 h-3.5" /> {error}
            </div>
          )}
          {result && result.failed > 0 && (
            <div className="flex items-center gap-2 rounded-lg px-3 py-2 mb-2 text-xs" style={{ backgroundColor: 'rgba(250,204,21,0.10)', color: 'var(--yellow)', border: '1px solid rgba(250,204,21,0.22)' }}>
              <AlertTriangle className="w-3.5 h-3.5" /> Loaded {result.loaded} of {result.total} ETFs. {result.failed} failed.
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 mb-2">
            <MiniSummary label="Strong Uptrend" value={String(summary.strongCount)} color="var(--green)" />
            <MiniSummary label="Below 200D" value={String(summary.below200)} color={summary.below200 > 0 ? 'var(--orange)' : undefined} />
            <MiniSummary label="Oversold" value={String(summary.oversold)} color="var(--accent-light)" />
            <MiniSummary
              label="Biggest 30D Drawdown"
              value={summary.biggestDrawdown ? `${summary.biggestDrawdown.ticker} ${formatPct(summary.biggestDrawdown.returns.thirtyDay)}` : DASH}
              color="var(--red)"
            />
          </div>

          <div className="rounded-lg p-2" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[minmax(180px,1fr)_160px_180px_190px] gap-2">
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Search ticker, name, or theme"
                className="rounded-lg px-3 py-2 text-sm outline-none min-h-[38px]"
                style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
              />
              <Select label="Lev" value={leverageFilter} options={leverageOptions} onChange={setLeverageFilter} />
              <Select label="Type" value={typeFilter} options={typeOptions} onChange={setTypeFilter} />
              <Select label="Trend" value={trendFilter} options={trendOptions} onChange={value => setTrendFilter(value as TrendFilter)} />
            </div>
          </div>
        </div>

        <div className="rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="overflow-x-auto max-w-full overscroll-contain">
            <table className="min-w-[1480px] w-full text-[11px]">
              <thead className="sticky z-30" style={{ top: `calc(2.75rem + ${stickyControlsHeight}px)` }}>
                <tr style={{ backgroundColor: 'var(--surface-alt)', borderBottom: '1px solid var(--border)' }}>
                  {sortButton('ticker', 'Ticker', 'text-left sticky left-0 z-20')}
                  {sortButton('name', 'Name', 'text-left')}
                  {sortButton('type', 'Type', 'text-left')}
                  {sortButton('leverage', 'Lev')}
                  {sortButton('price', 'Price')}
                  {sortButton('oneDay', '1D')}
                  {sortButton('fiveDay', '5D')}
                  {sortButton('thirtyDay', '30D')}
                  {sortButton('threeMonth', '3M')}
                  {sortButton('sixMonth', '6M')}
                  {sortButton('yearToDate', 'YTD')}
                  {sortButton('oneYear', '1Y')}
                  {sortButton('rsi14', 'RSI')}
                  {sortButton('distance50', 'vs 50D')}
                  {sortButton('distance200', 'vs 200D')}
                  {sortButton('high52Week', '52W High')}
                  {sortButton('percentOf52WeekHigh', '% 52W High')}
                  {sortButton('drawdown52Week', '52W DD')}
                  {sortButton('trend', 'Trend', 'text-left')}
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  <tr><td colSpan={19} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading {progress.loaded} / {progress.total} ETFs...</td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr><td colSpan={19} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No ETFs match these filters.</td></tr>
                ) : filteredRows.map((row, index) => {
                  const trend = trendStyle(row);
                  return (
                    <tr key={row.ticker} style={{ borderBottom: '1px solid var(--border)', backgroundColor: index % 2 ? 'var(--row-alt)' : 'transparent' }}>
                      <td className="px-2 py-1 text-left font-mono font-bold whitespace-nowrap sticky left-0 z-10" style={{ backgroundColor: index % 2 ? 'var(--row-alt)' : 'var(--surface)' }}>
                        <button onClick={() => navigate(`/options/${row.ticker}`)} className="underline-offset-2 hover:underline" style={{ color: 'var(--accent-light)' }}>{row.ticker}</button>
                      </td>
                      <td className="px-2 py-1 text-left max-w-[220px]">
                        <div className="truncate" title={`${row.name} - ${row.underlying}`} style={{ color: 'var(--text)' }}>{row.name}</div>
                        <div className="truncate text-[10px]" style={{ color: 'var(--text-dim)' }}>{row.underlying}</div>
                      </td>
                      <td className="px-2 py-1 text-left"><Badge>{row.type}</Badge></td>
                      <td className="px-2 py-1 text-right"><Badge>{row.leverage}</Badge></td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap">{formatPrice(row.price)}</td>
                      <ReturnCell value={row.returns.oneDay} />
                      <ReturnCell value={row.returns.fiveDay} />
                      <ReturnCell value={row.returns.thirtyDay} />
                      <ReturnCell value={row.returns.threeMonth} />
                      <ReturnCell value={row.returns.sixMonth} />
                      <ReturnCell value={row.returns.yearToDate} />
                      <ReturnCell value={row.returns.oneYear} />
                      <td className="px-2 py-1 text-right font-mono tabular-nums" style={{ color: rsiColor(row.rsi14) }}>{isFiniteNumber(row.rsi14) ? row.rsi14.toFixed(1) : DASH}</td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums" style={{ color: valueColor(row.distance50) }}>{formatPct(row.distance50)}</td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums" style={{ color: valueColor(row.distance200) }}>{formatPct(row.distance200)}</td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap">{formatPrice(row.high52Week)}</td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums" style={{ color: highPctColor(row.percentOf52WeekHigh) }}>{formatPct(row.percentOf52WeekHigh)}</td>
                      <td className="px-2 py-1 text-right font-mono tabular-nums" style={{ color: drawdownColor(row.drawdown52Week) }}>{formatPct(row.drawdown52Week)}</td>
                      <td className="px-2 py-1 text-left whitespace-nowrap">
                        <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold" title={`RSI ${isFiniteNumber(row.rsi14) ? row.rsi14.toFixed(1) : DASH}`} style={{ color: trend.color, backgroundColor: trend.bg, border: `1px solid ${trend.border}` }}>{trend.label}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-3 text-[10px]" style={{ color: 'var(--text-dim)' }}>
          Filters and sorting are client-side. Refresh loads one cached 2Y daily series per ETF with limited concurrency.
        </div>
      </div>
    </div>
  );
}

function Select({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return (
    <label className="flex items-center gap-2 min-w-0">
      <span className="text-[10px] uppercase tracking-wider flex-shrink-0" style={{ color: 'var(--text-dim)' }}>{label}</span>
      <select
        value={value}
        onChange={event => onChange(event.target.value)}
        className="min-w-0 w-full rounded-lg px-2 py-2 text-sm outline-none min-h-[40px]"
        style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}
      >
        {options.map(option => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function ReturnCell({ value }: { value: number | null }) {
  return (
    <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap" style={{ color: valueColor(value) }}>
      {formatPct(value)}
    </td>
  );
}

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, AlertTriangle, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { buildEtfPulseRows, getEtfPulseUniverse, type EtfPulseLoadResult, type EtfPulseProgress } from '../lib/etfPulseData';
import type { EtfPulseRow, EtfPulseTrend } from '../lib/etfPulseMetrics';
import { fetchProxyValuations, getUniqueValuationProxies, type ProxyValuationMap } from '../lib/etfValuationData';
import { getValuationProxyForTicker } from '../lib/etfValuationProxies';
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
  | 'recentDrawdown30'
  | 'rsi14'
  | 'realizedVolatility20'
  | 'distance20'
  | 'distance50'
  | 'distance200'
  | 'high52Week'
  | 'percentOf52WeekHigh'
  | 'position52Week'
  | 'drawdown52Week'
  | 'proxy'
  | 'proxyForwardPe'
  | 'trend';

type SortDirection = 'asc' | 'desc';
type TrendFilter = 'All' | EtfPulseTrend | 'Oversold' | 'Overbought';

interface SortState {
  field: PulseSortField;
  direction: SortDirection;
}

interface PulseColumn {
  key: string;
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
  sortField?: PulseSortField;
  title?: string;
  sticky?: boolean;
  render: (row: EtfPulseRow, index: number) => ReactNode;
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

function recentDrawdownColor(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return 'var(--text-dim)';
  if (value >= -0.05) return 'var(--text-dim)';
  if (value >= -0.15) return 'var(--yellow)';
  return 'var(--red)';
}

function rangePositionColor(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return 'var(--text-dim)';
  if (value > 0.8) return 'var(--green)';
  if (value >= 0.4) return 'var(--text-secondary)';
  return 'var(--orange)';
}

function volatilityColor(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return 'var(--text-dim)';
  if (value >= 0.9) return 'var(--red)';
  if (value >= 0.55) return 'var(--orange)';
  if (value >= 0.35) return 'var(--yellow)';
  return 'var(--text-secondary)';
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

function formatPe(value: number | null | undefined): string {
  return isFiniteNumber(value) ? `${value.toFixed(1)}x` : DASH;
}

function sortValue(row: EtfPulseRow, field: PulseSortField, valuations: ProxyValuationMap): number | string | null {
  const proxy = getValuationProxyForTicker(row.ticker);
  const proxyTicker = proxy.meaningful && proxy.proxyTicker ? proxy.proxyTicker.toUpperCase() : null;
  switch (field) {
    case 'ticker': return row.ticker;
    case 'name': return row.name;
    case 'type': return row.type;
    case 'leverage': return row.leverage;
    case 'price': return row.price;
    case 'oneDay': return row.returns.oneDay;
    case 'fiveDay': return row.returns.fiveDay;
    case 'thirtyDay': return row.returns.thirtyDay;
    case 'threeMonth': return row.returns.threeMonth;
    case 'sixMonth': return row.returns.sixMonth;
    case 'yearToDate': return row.returns.yearToDate;
    case 'oneYear': return row.returns.oneYear;
    case 'recentDrawdown30': return row.recentDrawdown30;
    case 'rsi14': return row.rsi14;
    case 'realizedVolatility20': return row.realizedVolatility20;
    case 'distance20': return row.distance20;
    case 'distance50': return row.distance50;
    case 'distance200': return row.distance200;
    case 'high52Week': return row.high52Week;
    case 'percentOf52WeekHigh': return row.percentOf52WeekHigh;
    case 'position52Week': return row.position52Week;
    case 'drawdown52Week': return row.drawdown52Week;
    case 'proxy': return proxyTicker ?? 'N/A';
    case 'proxyForwardPe': return proxyTicker ? valuations[proxyTicker]?.forwardPe ?? null : null;
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

function Badge({ children }: { children: string }) {
  return (
    <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap" style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>{children}</span>
  );
}

export default function EtfPulsePage() {
  const navigate = useNavigate();
  const [result, setResult] = useState<EtfPulseLoadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [valuationError, setValuationError] = useState('');
  const [valuations, setValuations] = useState<ProxyValuationMap>({});
  const [progress, setProgress] = useState<EtfPulseProgress>({ loaded: 0, total: getEtfPulseUniverse().length });
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
      const proxyTickers = getUniqueValuationProxies(next.rows);
      if (proxyTickers.length > 0) {
        try {
          setValuationError('');
          setValuations(await fetchProxyValuations(proxyTickers, { forceRefresh }));
        } catch (valuationErr) {
          setValuationError(valuationErr instanceof Error ? valuationErr.message : 'Proxy valuation data could not be loaded.');
          setValuations({});
        }
      } else {
        setValuations({});
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ETF Pulse data could not be loaded.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRows(false);
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
      const aValue = sortValue(a, sort.field, valuations);
      const bValue = sortValue(b, sort.field, valuations);
      const direction = sort.direction === 'asc' ? 1 : -1;
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      if (typeof aValue === 'string' || typeof bValue === 'string') return String(aValue).localeCompare(String(bValue)) * direction;
      return (aValue - bValue) * direction;
    });
  }, [leverageFilter, rows, search, sort, trendFilter, typeFilter, valuations]);

  const columns = useMemo<PulseColumn[]>(() => [
    {
      key: 'ticker',
      label: 'Ticker',
      width: 72,
      align: 'left',
      sortField: 'ticker',
      sticky: true,
      render: row => (
        <button onClick={() => navigate(`/options/${row.ticker}`)} className="underline-offset-2 hover:underline" style={{ color: 'var(--accent-light)' }}>
          {row.ticker}
        </button>
      ),
    },
    {
      key: 'name',
      label: 'Name',
      width: 230,
      align: 'left',
      sortField: 'name',
      render: row => (
        <div className="min-w-0">
          <div className="truncate" title={`${row.name} - ${row.underlying}`} style={{ color: 'var(--text)' }}>{row.name}</div>
          <div className="truncate text-[10px]" style={{ color: 'var(--text-dim)' }}>{row.underlying}</div>
        </div>
      ),
    },
    { key: 'type', label: 'Type', width: 96, align: 'left', sortField: 'type', render: row => <Badge>{row.type}</Badge> },
    { key: 'leverage', label: 'Lev', width: 52, align: 'center', sortField: 'leverage', render: row => <Badge>{row.leverage}</Badge> },
    { key: 'price', label: 'Price', width: 88, align: 'right', sortField: 'price', render: row => formatPrice(row.price) },
    { key: 'oneDay', label: '1D', width: 70, align: 'right', sortField: 'oneDay', render: row => <ReturnValue value={row.returns.oneDay} /> },
    { key: 'fiveDay', label: '5D', width: 70, align: 'right', sortField: 'fiveDay', render: row => <ReturnValue value={row.returns.fiveDay} /> },
    { key: 'thirtyDay', label: '30D', width: 74, align: 'right', sortField: 'thirtyDay', render: row => <ReturnValue value={row.returns.thirtyDay} /> },
    { key: 'threeMonth', label: '3M', width: 72, align: 'right', sortField: 'threeMonth', render: row => <ReturnValue value={row.returns.threeMonth} /> },
    { key: 'sixMonth', label: '6M', width: 72, align: 'right', sortField: 'sixMonth', render: row => <ReturnValue value={row.returns.sixMonth} /> },
    { key: 'yearToDate', label: 'YTD', width: 74, align: 'right', sortField: 'yearToDate', render: row => <ReturnValue value={row.returns.yearToDate} /> },
    { key: 'oneYear', label: '1Y', width: 72, align: 'right', sortField: 'oneYear', render: row => <ReturnValue value={row.returns.oneYear} /> },
    {
      key: 'recentDrawdown30',
      label: 'Recent DD',
      width: 92,
      align: 'right',
      sortField: 'recentDrawdown30',
      title: '30-day drawdown from recent peak',
      render: row => <span style={{ color: recentDrawdownColor(row.recentDrawdown30) }}>{formatPct(row.recentDrawdown30)}</span>,
    },
    {
      key: 'rsi14',
      label: 'RSI',
      width: 60,
      align: 'right',
      sortField: 'rsi14',
      render: row => <span style={{ color: rsiColor(row.rsi14) }}>{isFiniteNumber(row.rsi14) ? row.rsi14.toFixed(1) : DASH}</span>,
    },
    {
      key: 'realizedVolatility20',
      label: '20D RV',
      width: 78,
      align: 'right',
      sortField: 'realizedVolatility20',
      title: '20-day annualized realized volatility',
      render: row => <span style={{ color: volatilityColor(row.realizedVolatility20) }}>{formatPct(row.realizedVolatility20)}</span>,
    },
    {
      key: 'distance20',
      label: 'vs 20D',
      width: 78,
      align: 'right',
      sortField: 'distance20',
      title: 'Distance versus 20-day moving average',
      render: row => <span style={{ color: valueColor(row.distance20) }}>{formatPct(row.distance20)}</span>,
    },
    {
      key: 'distance50',
      label: 'vs 50D',
      width: 78,
      align: 'right',
      sortField: 'distance50',
      title: 'Distance versus 50-day moving average',
      render: row => <span style={{ color: valueColor(row.distance50) }}>{formatPct(row.distance50)}</span>,
    },
    {
      key: 'distance200',
      label: 'vs 200D',
      width: 82,
      align: 'right',
      sortField: 'distance200',
      title: 'Distance versus 200-day moving average',
      render: row => <span style={{ color: valueColor(row.distance200) }}>{formatPct(row.distance200)}</span>,
    },
    { key: 'high52Week', label: '52W High', width: 90, align: 'right', sortField: 'high52Week', render: row => formatPrice(row.high52Week) },
    {
      key: 'percentOf52WeekHigh',
      label: '% 52W High',
      width: 98,
      align: 'right',
      sortField: 'percentOf52WeekHigh',
      render: row => <span style={{ color: highPctColor(row.percentOf52WeekHigh) }}>{formatPct(row.percentOf52WeekHigh)}</span>,
    },
    {
      key: 'position52Week',
      label: '52W Pos',
      width: 82,
      align: 'right',
      sortField: 'position52Week',
      title: 'Position inside the 52-week range',
      render: row => <span style={{ color: rangePositionColor(row.position52Week) }}>{formatPct(row.position52Week)}</span>,
    },
    {
      key: 'drawdown52Week',
      label: '52W DD',
      width: 82,
      align: 'right',
      sortField: 'drawdown52Week',
      title: 'Drawdown from 52-week high',
      render: row => <span style={{ color: drawdownColor(row.drawdown52Week) }}>{formatPct(row.drawdown52Week)}</span>,
    },
    {
      key: 'trend',
      label: 'Trend',
      width: 126,
      align: 'left',
      sortField: 'trend',
      render: row => {
        const trend = trendStyle(row);
        return (
          <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold" title={`RSI ${isFiniteNumber(row.rsi14) ? row.rsi14.toFixed(1) : DASH}`} style={{ color: trend.color, backgroundColor: trend.bg, border: `1px solid ${trend.border}` }}>
            {trend.label}
          </span>
        );
      },
    },
    {
      key: 'proxy',
      label: 'Proxy',
      width: 74,
      align: 'center',
      sortField: 'proxy',
      title: 'Valuation proxy for underlying exposure. Not true look-through ETF valuation.',
      render: row => {
        const proxy = getValuationProxyForTicker(row.ticker);
        const proxyTicker = proxy.meaningful && proxy.proxyTicker ? proxy.proxyTicker.toUpperCase() : null;
        return <span title={`${proxy.reason} Valuation proxy for underlying exposure; not true look-through ETF valuation.`}>{proxyTicker ?? 'N/A'}</span>;
      },
    },
    {
      key: 'proxyForwardPe',
      label: 'Proxy Fwd P/E',
      width: 106,
      align: 'right',
      sortField: 'proxyForwardPe',
      title: 'Uses mapped underlying proxy where available, e.g. TQQQ -> QQQ or SSO -> SPY. This is valuation context, not a true look-through ETF P/E.',
      render: row => {
        const proxy = getValuationProxyForTicker(row.ticker);
        const proxyTicker = proxy.meaningful && proxy.proxyTicker ? proxy.proxyTicker.toUpperCase() : null;
        const proxyValuation = proxyTicker ? valuations[proxyTicker] : null;
        return <span title={`${proxy.reason} Valuation proxy for underlying exposure; not true look-through ETF valuation.`}>{proxyTicker ? formatPe(proxyValuation?.forwardPe) : 'N/A'}</span>;
      },
    },
  ], [navigate, valuations]);

  const tableMinWidth = useMemo(() => columns.reduce((sum, column) => sum + column.width, 0), [columns]);

  const headerCell = (column: PulseColumn) => {
    const alignClass = column.align === 'left' ? 'text-left' : column.align === 'center' ? 'text-center' : 'text-right';
    const sorted = column.sortField && sort.field === column.sortField;
    const content = `${column.label}${sorted ? sort.direction === 'asc' ? ' ^' : ' v' : ''}`;
    const sortField = column.sortField;
    return (
      <th
        key={column.key}
        className={`px-2 py-2 text-[11px] font-medium whitespace-nowrap ${alignClass} ${column.sticky ? 'sticky left-0 z-40' : ''}`}
        style={{
          color: 'var(--text-muted)',
          backgroundColor: 'var(--surface-alt)',
          width: column.width,
          minWidth: column.width,
          maxWidth: column.width,
        }}
      >
        {sortField ? (
          <button
            type="button"
            title={column.title ?? column.label}
            onClick={() => setSort(current => current.field === sortField ? { field: sortField, direction: current.direction === 'asc' ? 'desc' : 'asc' } : { field: sortField, direction: 'asc' })}
            className="hover:opacity-80"
          >
            {content}
          </button>
        ) : content}
      </th>
    );
  };

  const bodyCell = (column: PulseColumn, row: EtfPulseRow, rowIndex: number) => {
    const alignClass = column.align === 'left' ? 'text-left' : column.align === 'center' ? 'text-center' : 'text-right';
    const stickyBg = rowIndex % 2 ? 'var(--row-alt)' : 'var(--surface)';
    return (
      <td
        key={column.key}
        className={`px-2 py-1 whitespace-nowrap tabular-nums overflow-hidden ${alignClass} ${column.key === 'ticker' ? 'font-mono font-bold' : ''} ${column.sticky ? 'sticky left-0 z-20' : ''}`}
        style={{
          width: column.width,
          minWidth: column.width,
          maxWidth: column.width,
          backgroundColor: column.sticky ? stickyBg : undefined,
        }}
      >
        {column.render(row, rowIndex)}
      </td>
    );
  };

  return (
    <div className="h-[calc(100vh-2.75rem)] overflow-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="max-w-[1800px] mx-auto h-full min-h-0 px-2 sm:px-4 lg:px-6 py-2 sm:py-3 flex flex-col">
        <div className="flex-shrink-0 -mx-2 sm:-mx-4 lg:-mx-6 px-2 sm:px-4 lg:px-6 pb-2 mb-2" style={{ backgroundColor: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
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

        <div className="rounded-lg overflow-hidden flex-1 min-h-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div className="h-full max-w-full overflow-auto overscroll-contain">
            <table className="w-full table-fixed text-[11px]" style={{ minWidth: tableMinWidth }}>
              <colgroup>
                {columns.map(column => <col key={column.key} style={{ width: column.width }} />)}
              </colgroup>
              <thead className="sticky top-0 z-30">
                <tr style={{ backgroundColor: 'var(--surface-alt)', borderBottom: '1px solid var(--border)' }}>
                  {columns.map(headerCell)}
                </tr>
              </thead>
              <tbody>
                {loading && rows.length === 0 ? (
                  <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>Loading {progress.loaded} / {progress.total} ETFs...</td></tr>
                ) : filteredRows.length === 0 ? (
                  <tr><td colSpan={columns.length} className="px-3 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No ETFs match these filters.</td></tr>
                ) : filteredRows.map((row, index) => (
                  <tr key={row.ticker} style={{ borderBottom: '1px solid var(--border)', backgroundColor: index % 2 ? 'var(--row-alt)' : 'transparent' }}>
                    {columns.map(column => bodyCell(column, row, index))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="mt-2 flex-shrink-0 text-[10px]" style={{ color: 'var(--text-dim)' }}>
          Filters and sorting are client-side. Refresh loads one cached 2Y daily series per ETF with limited concurrency.
          {valuationError ? <span style={{ color: 'var(--yellow)' }}> Some proxy valuation data unavailable.</span> : null}
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

function ReturnValue({ value }: { value: number | null }) {
  return (
    <span style={{ color: valueColor(value) }}>
      {formatPct(value)}
    </span>
  );
}

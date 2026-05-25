import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, RefreshCw, X } from 'lucide-react';
import { getChartHistory } from '../lib/chartHistory';
import type { ChartHistoryResponse, ChartPoint, ChartTimeframe } from '../lib/chartHistory';

const TIMEFRAMES: ChartTimeframe[] = ['1D', '5D', '30D', '3M', '6M', '1Y', '3Y', '5Y', 'All'];
const CHART_WIDTH = 900;
const CHART_HEIGHT = 360;
const PAD_X = 28;
const PAD_Y = 22;

interface InteractivePriceChartModalProps {
  isOpen: boolean;
  ticker: string;
  displayTicker?: string;
  onClose: () => void;
}

interface ScaledPoint extends ChartPoint {
  x: number;
  y: number;
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatCurrency(value: number | null | undefined, decimals = 2): string {
  if (!isFiniteNumber(value)) return '--';
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`;
}

function formatSignedCurrency(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return '--';
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${formatCurrency(Math.abs(value))}`;
}

function formatPercent(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatDateTime(point: ChartPoint | null | undefined, timeframe: ChartTimeframe): string {
  if (!point) return '--';
  const date = new Date(point.timestamp * 1000);
  const options: Intl.DateTimeFormatOptions = timeframe === '1D' || timeframe === '5D'
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' };
  return date.toLocaleString(undefined, options);
}

function changeFrom(start: number | null | undefined, end: number | null | undefined) {
  if (!isFiniteNumber(start) || !isFiniteNumber(end) || start === 0) {
    return { change: null, percent: null };
  }
  const change = end - start;
  return { change, percent: (change / start) * 100 };
}

function chartColor(changePercent: number | null): string {
  if (!isFiniteNumber(changePercent)) return 'var(--accent-light)';
  return changePercent >= 0 ? 'var(--green)' : 'var(--red)';
}

function buildPath(points: ScaledPoint[]): string {
  if (points.length === 0) return '';
  return `M${points.map(point => `${point.x},${point.y}`).join(' L')}`;
}

export default function InteractivePriceChartModal({
  isOpen,
  ticker,
  displayTicker,
  onClose,
}: InteractivePriceChartModalProps) {
  const [timeframe, setTimeframe] = useState<ChartTimeframe>('1D');
  const [data, setData] = useState<ChartHistoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const requestedTicker = ticker.trim().toUpperCase();
  const activeData = data && data.timeframe === timeframe && data.ticker.toUpperCase() === requestedTicker ? data : null;
  const titleTicker = displayTicker || activeData?.displayTicker || requestedTicker;

  const loadChart = useCallback(async (forceRefresh = false) => {
    if (!requestedTicker) return;
    setLoading(true);
    setError(null);
    try {
      const history = await getChartHistory(requestedTicker, timeframe, { forceRefresh });
      setData(history);
      setHoveredIndex(null);
      setSelectedIndex(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load chart data');
    } finally {
      setLoading(false);
    }
  }, [requestedTicker, timeframe]);

  useEffect(() => {
    if (!isOpen) return;
    loadChart();
  }, [isOpen, loadChart]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKey);
    };
  }, [isOpen, onClose]);

  const points = useMemo(() => activeData?.points ?? [], [activeData]);
  const latestPoint = points[points.length - 1] ?? null;
  const latestPrice = isFiniteNumber(activeData?.latestPrice) ? activeData?.latestPrice ?? null : latestPoint?.price ?? null;
  const baseline = timeframe === '1D'
    ? (isFiniteNumber(activeData?.previousClose) ? activeData?.previousClose ?? null : points[0]?.price ?? null)
    : points[0]?.price ?? null;
  const periodChange = changeFrom(baseline, latestPrice);
  const lineColor = chartColor(periodChange.percent);
  const activeIndex = hoveredIndex ?? points.length - 1;
  const activePoint = activeIndex != null ? points[activeIndex] : latestPoint;
  const activeChange = changeFrom(timeframe === '1D' ? baseline : points[0]?.price, activePoint?.price);
  const selectedPoint = selectedIndex != null ? points[selectedIndex] : null;
  const rangeEndPoint = selectedPoint && hoveredIndex != null ? points[hoveredIndex] : null;
  const rangeChange = selectedPoint && rangeEndPoint ? changeFrom(selectedPoint.price, rangeEndPoint.price) : null;

  const chart = useMemo(() => {
    if (points.length < 2) {
      return { scaledPoints: [] as ScaledPoint[], linePath: '', referenceY: null as number | null };
    }

    const reference = isFiniteNumber(activeData?.previousClose) ? activeData?.previousClose ?? null : points[0]?.price ?? null;
    const prices = points.map(point => point.price);
    if (isFiniteNumber(reference)) prices.push(reference);
    const min = Math.min(...prices);
    const max = Math.max(...prices);
    const range = max - min || 1;
    const plotWidth = CHART_WIDTH - PAD_X * 2;
    const plotHeight = CHART_HEIGHT - PAD_Y * 2;
    const scaledPoints = points.map((point, index) => ({
      ...point,
      x: PAD_X + (index / (points.length - 1)) * plotWidth,
      y: PAD_Y + plotHeight - ((point.price - min) / range) * plotHeight,
    }));
    const referenceY = isFiniteNumber(reference)
      ? PAD_Y + plotHeight - ((reference - min) / range) * plotHeight
      : null;

    return { scaledPoints, linePath: buildPath(scaledPoints), referenceY };
  }, [activeData?.previousClose, points]);

  const updateHoveredPoint = useCallback((event: React.PointerEvent<SVGSVGElement>) => {
    if (points.length === 0 || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    const index = Math.round(ratio * (points.length - 1));
    setHoveredIndex(index);
  }, [points.length]);

  const handleChartClick = useCallback(() => {
    if (hoveredIndex == null) return;
    setSelectedIndex(current => current === hoveredIndex ? null : hoveredIndex);
  }, [hoveredIndex]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        style={{ backgroundColor: 'rgba(0,0,0,0.62)' }}
        onClick={onClose}
        aria-label="Close chart"
      />

      <div
        className="relative z-[91] flex max-h-[96vh] sm:max-h-[90vh] w-full sm:max-w-5xl flex-col overflow-hidden rounded-t-2xl sm:rounded-2xl shadow-2xl"
        style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-start justify-between gap-3 border-b p-4 sm:p-5" style={{ borderColor: 'var(--border)' }}>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg sm:text-xl font-semibold font-mono" style={{ color: 'var(--text)' }}>
                {titleTicker}
              </h2>
              <span className="rounded-md px-2 py-1 text-[10px] font-medium uppercase tracking-wider" style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>
                {timeframe}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-2xl sm:text-3xl font-bold font-mono tabular-nums" style={{ color: 'var(--text)' }}>
                {formatCurrency(latestPrice)}
              </span>
              <span className="text-sm font-mono tabular-nums" style={{ color: lineColor }}>
                {formatSignedCurrency(periodChange.change)} / {formatPercent(periodChange.percent)}
              </span>
              {activeData?.fetchedAt && (
                <span className="text-xs" style={{ color: 'var(--text-dim)' }}>
                  Updated {new Date(activeData.fetchedAt).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => loadChart(true)}
              disabled={loading}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-opacity disabled:opacity-50"
              style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-lg transition-opacity hover:opacity-80"
              style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text)' }}
              aria-label="Close chart"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-4 sm:p-5">
          <div className="mb-4 flex gap-2 overflow-x-auto pb-1 sm:flex-wrap">
            {TIMEFRAMES.map(option => (
              <button
                type="button"
                key={option}
                onClick={() => setTimeframe(option)}
                className="min-h-[40px] flex-shrink-0 rounded-lg px-3 py-2 text-xs font-semibold transition-all"
                style={{
                  backgroundColor: timeframe === option ? 'var(--accent)' : 'var(--surface-alt)',
                  color: timeframe === option ? 'white' : 'var(--text-muted)',
                  border: timeframe === option ? '1px solid var(--accent)' : '1px solid var(--border)',
                }}
              >
                {option}
              </button>
            ))}
          </div>

          {error ? (
            <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Unable to load chart data</p>
              <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>{error}</p>
              <button
                type="button"
                onClick={() => loadChart(true)}
                className="mt-5 inline-flex min-h-[40px] items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </button>
            </div>
          ) : loading && !activeData ? (
            <div className="flex h-[360px] items-center justify-center rounded-xl" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading chart...
              </div>
            </div>
          ) : points.length < 2 ? (
            <div className="rounded-xl p-8 text-center" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>No chart data available</p>
              <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>Try a different timeframe or refresh the chart.</p>
            </div>
          ) : (
            <>
              <div className="rounded-xl p-3 sm:p-4" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
                <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                  <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
                    <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Hover Point</div>
                    <div className="mt-1 font-mono text-sm tabular-nums" style={{ color: 'var(--text)' }}>{formatCurrency(activePoint?.price)}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{formatDateTime(activePoint, timeframe)}</div>
                  </div>
                  <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
                    <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Point Return</div>
                    <div className="mt-1 font-mono text-sm tabular-nums" style={{ color: chartColor(activeChange.percent) }}>
                      {formatSignedCurrency(activeChange.change)} / {formatPercent(activeChange.percent)}
                    </div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>From baseline</div>
                  </div>
                  <div className="rounded-lg p-3" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
                    <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Selected Range</div>
                    {selectedPoint && rangeEndPoint && rangeChange ? (
                      <>
                        <div className="mt-1 font-mono text-sm tabular-nums" style={{ color: chartColor(rangeChange.percent) }}>
                          {formatSignedCurrency(rangeChange.change)} / {formatPercent(rangeChange.percent)}
                        </div>
                        <div className="truncate text-xs" style={{ color: 'var(--text-muted)' }}>
                          {formatDateTime(selectedPoint, timeframe)} to {formatDateTime(rangeEndPoint, timeframe)}
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="mt-1 font-mono text-sm" style={{ color: 'var(--text-dim)' }}>Click a point</div>
                        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Then hover another point</div>
                      </>
                    )}
                  </div>
                </div>

                <svg
                  ref={svgRef}
                  viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                  className="h-[300px] w-full touch-none select-none sm:h-[360px]"
                  onPointerMove={updateHoveredPoint}
                  onPointerLeave={() => setHoveredIndex(null)}
                  onClick={handleChartClick}
                  role="img"
                  aria-label={`${titleTicker} ${timeframe} price chart`}
                >
                  <rect x="0" y="0" width={CHART_WIDTH} height={CHART_HEIGHT} rx="12" fill="transparent" />
                  {chart.referenceY != null && (
                    <>
                      <line
                        x1={PAD_X}
                        y1={chart.referenceY}
                        x2={CHART_WIDTH - PAD_X}
                        y2={chart.referenceY}
                        stroke="currentColor"
                        strokeOpacity="0.22"
                        strokeDasharray="5,5"
                        className="text-slate-400"
                      />
                      <text
                        x={CHART_WIDTH - PAD_X}
                        y={Math.max(12, chart.referenceY - 6)}
                        textAnchor="end"
                        className="fill-current text-[10px]"
                        style={{ color: 'var(--text-dim)' }}
                      >
                        Prev close
                      </text>
                    </>
                  )}
                  <path d={chart.linePath} fill="none" stroke={lineColor} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
                  {selectedIndex != null && chart.scaledPoints[selectedIndex] && (
                    <>
                      <line
                        x1={chart.scaledPoints[selectedIndex].x}
                        y1={PAD_Y}
                        x2={chart.scaledPoints[selectedIndex].x}
                        y2={CHART_HEIGHT - PAD_Y}
                        stroke="var(--accent-light)"
                        strokeOpacity="0.45"
                        strokeDasharray="4,4"
                      />
                      <circle cx={chart.scaledPoints[selectedIndex].x} cy={chart.scaledPoints[selectedIndex].y} r="5" fill="var(--accent-light)" />
                    </>
                  )}
                  {hoveredIndex != null && chart.scaledPoints[hoveredIndex] && (
                    <>
                      <line
                        x1={chart.scaledPoints[hoveredIndex].x}
                        y1={PAD_Y}
                        x2={chart.scaledPoints[hoveredIndex].x}
                        y2={CHART_HEIGHT - PAD_Y}
                        stroke="currentColor"
                        strokeOpacity="0.35"
                        className="text-slate-300"
                      />
                      <circle cx={chart.scaledPoints[hoveredIndex].x} cy={chart.scaledPoints[hoveredIndex].y} r="4.5" fill={lineColor} stroke="var(--surface)" strokeWidth="2" />
                    </>
                  )}
                </svg>

                {selectedPoint && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                    <span>
                      Range start: <span className="font-mono" style={{ color: 'var(--text)' }}>{formatCurrency(selectedPoint.price)}</span> at {formatDateTime(selectedPoint, timeframe)}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedIndex(null)}
                      className="rounded-lg px-3 py-2 font-medium"
                      style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
                    >
                      Clear selection
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

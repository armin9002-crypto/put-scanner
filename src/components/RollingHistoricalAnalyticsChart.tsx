import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { formatCurrency, formatPercent, formatPercentPoints, formatSignedPercent } from '../lib/format';
import { getNiceYAxisScale, type YAxisScale } from '../lib/chartScale';
import {
  buildRollingHistoricalAnalyticsSeries,
  ROLLING_HISTORICAL_METRIC_CONFIGS,
  ROLLING_WINDOW_MONTHS,
  type RollingHistoricalAnalyticsPoint,
  type RollingHistoricalFormatterCategory,
  type RollingHistoricalMetric,
  type RollingWindowMonths,
} from '../lib/rollingHistoricalAnalytics';
import type { PortfolioTrade } from '../lib/portfolioStorage';

const CHART_WIDTH = 960;
const CHART_HEIGHT = 292;
const PLOT = { left: 64, right: 18, top: 16, bottom: 36 } as const;

function isFiniteValue(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatCompactCurrency(value: number): string {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(absolute >= 10_000_000 ? 0 : 1)}M`;
  if (absolute >= 1_000) return `${sign}$${(absolute / 1_000).toFixed(absolute >= 100_000 ? 0 : 1)}k`;
  return `${sign}$${Math.round(absolute)}`;
}

function formatSignedDelta(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
}

function formatMetricValue(
  value: number | null,
  category: RollingHistoricalFormatterCategory,
  metric: RollingHistoricalMetric,
  axis = false,
): string {
  if (!isFiniteValue(value)) return '—';
  switch (category) {
    case 'ratio_percent':
      return metric === 'realizedIrr' ? formatSignedPercent(value * 100, 1) : formatPercent(value, 1);
    case 'percentage_points':
      return formatPercentPoints(value, 1);
    case 'signed_delta':
      return formatSignedDelta(value);
    case 'days':
      return axis ? `${Math.round(value)}` : `${Math.round(value)} DTE`;
    case 'currency':
      return axis ? formatCompactCurrency(value) : formatCurrency(value, 0);
  }
}

function formatLongDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

function formatAxisDate(value: string, longHistory: boolean): string {
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-US', longHistory
    ? { month: 'short', year: '2-digit', timeZone: 'UTC' }
    : { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function pathForPoints(points: Array<{ x: number; y: number }>): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
}

function buildLineSegments(
  series: ReturnType<typeof buildRollingHistoricalAnalyticsSeries>,
  scale: YAxisScale,
  chartWidth: number,
  chartHeight: number,
) {
  const plotWidth = Math.max(1, chartWidth - PLOT.left - PLOT.right);
  const plotHeight = Math.max(1, chartHeight - PLOT.top - PLOT.bottom);
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  series.points.forEach((point, index) => {
    if (!isFiniteValue(point.value)) {
      if (current.length > 0) segments.push(current);
      current = [];
      return;
    }
    const x = PLOT.left + (series.points.length <= 1 ? plotWidth / 2 : index / (series.points.length - 1) * plotWidth);
    const range = scale.max - scale.min || 1;
    const y = PLOT.top + (1 - (point.value - scale.min) / range) * plotHeight;
    current.push({ x, y });
  });
  if (current.length > 0) segments.push(current);
  return segments;
}

function latestAvailableIndex(points: readonly RollingHistoricalAnalyticsPoint[]): number | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (isFiniteValue(points[index].value)) return index;
  }
  return points.length > 0 ? points.length - 1 : null;
}

function buildMetricYAxisScale(values: number[], metric: RollingHistoricalMetric): YAxisScale | null {
  const finiteValues = values.filter(isFiniteValue);
  if (finiteValues.length === 0) return null;
  const minimum = Math.min(...finiteValues);
  const maximum = Math.max(...finiteValues);
  const includeZero = metric === 'premiumRunRate'
    || metric === 'grossRiskDeployed'
    || metric === 'entryDelta'
    || (metric === 'realizedIrr' && minimum < 0 && maximum > 0);
  return getNiceYAxisScale(includeZero ? [...finiteValues, 0] : finiteValues, 5);
}

function buildLabelIndexes(points: readonly RollingHistoricalAnalyticsPoint[], chartWidth: number): number[] {
  if (points.length <= 1) return points.length ? [0] : [];
  const spanMonths = (new Date(`${points[points.length - 1].date}T00:00:00Z`).getTime()
    - new Date(`${points[0].date}T00:00:00Z`).getTime()) / (86_400_000 * 30.4375);
  const targetCount = chartWidth < 500 ? 4 : chartWidth < 760 ? 5 : 7;
  const indexes = new Set<number>([0, points.length - 1]);
  if (spanMonths > 18) {
    points.forEach((point, index) => {
      const month = Number(point.date.slice(5, 7));
      if (month === 1 || month === 7) indexes.add(index);
    });
    if (indexes.size > targetCount) {
      const sorted = [...indexes].sort((a, b) => a - b);
      const step = Math.ceil((sorted.length - 1) / Math.max(1, targetCount - 1));
      return [...new Set(sorted.filter((_, index) => index === 0 || index === sorted.length - 1 || index % step === 0))];
    }
    return [...indexes].sort((a, b) => a - b);
  }
  for (let index = 1; index < targetCount - 1; index += 1) indexes.add(Math.round(index * (points.length - 1) / (targetCount - 1)));
  return [...indexes].sort((a, b) => a - b);
}

function tooltipMetadata(point: RollingHistoricalAnalyticsPoint): string[] {
  const rows: string[] = [];
  if (point.coverage) {
    rows.push(`${point.coverage.representedTrades} of ${point.coverage.totalEligibleTrades} trades represented`);
    rows.push(`${formatCurrency(point.coverage.representedGrossRisk, 0)} of ${formatCurrency(point.coverage.totalEligibleGrossRisk, 0)} Gross Risk represented`);
    if (isFiniteValue(point.coverage.representedRiskPercent)) rows.push(`${(point.coverage.representedRiskPercent * 100).toFixed(0)}% Gross Risk coverage`);
  } else {
    rows.push(`${point.tradesIncluded} resolved trades`);
    rows.push(`${formatCurrency(point.grossRiskRepresented, 0)} Gross Risk represented`);
  }
  if (point.flow) rows.push(`Trailing ${formatCurrency(point.flow.trailingValue ?? 0, 0)} · ×${point.flow.annualizationFactor.toFixed(1)} annualized`);
  return rows;
}

function pointMetadata(point: RollingHistoricalAnalyticsPoint | null): string {
  if (!point) return 'No observations yet';
  if (point.coverage) {
    const coverage = isFiniteValue(point.coverage.representedRiskPercent) ? ` · ${(point.coverage.representedRiskPercent * 100).toFixed(0)}% risk coverage` : '';
    return `${point.coverage.representedTrades}/${point.coverage.totalEligibleTrades} trades · ${formatCurrency(point.coverage.representedGrossRisk, 0)} Gross Risk represented${coverage}`;
  }
  if (point.flow) return `${point.flow.tradesOriginated} trades · ${formatCurrency(point.grossRiskRepresented, 0)} Gross Risk · trailing ${formatCurrency(point.flow.trailingValue ?? 0, 0)} · ×${point.flow.annualizationFactor.toFixed(1)} annualized`;
  return `${point.tradesIncluded} resolved trades · ${formatCurrency(point.grossRiskRepresented, 0)} Gross Risk represented`;
}

export default function RollingHistoricalAnalyticsChart({ trades }: { trades: readonly PortfolioTrade[] }) {
  const [metric, setMetric] = useState<RollingHistoricalMetric>('entryAy');
  const [windowMonths, setWindowMonths] = useState<RollingWindowMonths>(6);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const [plotSize, setPlotSize] = useState({ width: CHART_WIDTH, height: CHART_HEIGHT });
  const plotRef = useRef<HTMLDivElement>(null);
  const series = useMemo(() => buildRollingHistoricalAnalyticsSeries(trades, metric, windowMonths), [metric, trades, windowMonths]);
  const config = series.config;
  const scale = useMemo(() => buildMetricYAxisScale(series.points.map(point => point.value ?? Number.NaN), metric), [metric, series.points]);
  const latestIndex = latestAvailableIndex(series.points);
  const resolvedSelectedIndex = isInteracting && selectedIndex != null && selectedIndex < series.points.length ? selectedIndex : latestIndex;
  const selectedPoint = resolvedSelectedIndex == null ? null : series.points[resolvedSelectedIndex];
  const plotWidth = Math.max(1, plotSize.width - PLOT.left - PLOT.right);
  const plotHeight = Math.max(1, plotSize.height - PLOT.top - PLOT.bottom);
  const lineSegments = scale ? buildLineSegments(series, scale, plotSize.width, plotSize.height) : [];
  const labelIndexes = buildLabelIndexes(series.points, plotSize.width);

  useEffect(() => {
    const element = plotRef.current;
    if (!element) return undefined;
    const update = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width > 0) setPlotSize({ width: Math.max(320, rect.width), height: Math.max(120, element.clientHeight || CHART_HEIGHT) });
    };
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const selectPointAtClientX = (clientX: number, target: SVGSVGElement) => {
    if (series.points.length === 0) return;
    const rect = target.getBoundingClientRect();
    const localX = ((clientX - rect.left) / Math.max(rect.width, 1)) * plotSize.width;
    const ratio = Math.min(1, Math.max(0, (localX - PLOT.left) / plotWidth));
    setSelectedIndex(Math.round(ratio * Math.max(0, series.points.length - 1)));
    setIsInteracting(true);
  };
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => selectPointAtClientX(event.clientX, event.currentTarget);
  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    selectPointAtClientX(event.clientX, event.currentTarget);
  };

  const selectedX = resolvedSelectedIndex == null || series.points.length === 0
    ? null
    : PLOT.left + (series.points.length <= 1 ? plotWidth / 2 : resolvedSelectedIndex / (series.points.length - 1) * plotWidth);
  const selectedY = selectedPoint && scale && isFiniteValue(selectedPoint.value)
    ? PLOT.top + (1 - (selectedPoint.value - scale.min) / (scale.max - scale.min || 1)) * plotHeight
    : null;
  const selectedXPercent = selectedX == null ? null : selectedX / plotSize.width * 100;
  const tooltipTransform = selectedXPercent != null && selectedXPercent < 22 ? 'translateX(0)' : selectedXPercent != null && selectedXPercent > 78 ? 'translateX(-100%)' : 'translateX(-50%)';
  const hasData = scale != null;
  const domainStart = series.domain.startDate ?? series.domain.endDate;
  const longHistory = (new Date(`${series.domain.endDate}T00:00:00Z`).getTime() - new Date(`${domainStart}T00:00:00Z`).getTime()) / (86_400_000 * 30.4375) > 18;
  const context = isInteracting && selectedPoint ? `${formatLongDate(selectedPoint.date)} · ${windowMonths}M window` : config.subtitle(windowMonths);
  const summary = selectedPoint
    ? `${config.label}, ${windowMonths}-month rolling window. ${selectedPoint.value == null ? 'No full-window observation.' : `${formatMetricValue(selectedPoint.value, config.formatterCategory, metric)} on ${formatLongDate(selectedPoint.date)}.`}`
    : `${config.label}, ${windowMonths}-month rolling window. No observations yet.`;

  return (
    <section
      className="rolling-historical-analytics"
      data-testid="rolling-historical-analytics"
      data-rolling-domain-start={series.domain.startDate ?? ''}
      data-rolling-domain-end={series.domain.endDate}
      data-rolling-observation-count={series.points.length}
      data-rolling-plot-width={Math.round(plotSize.width)}
      data-rolling-current-value={selectedPoint?.value == null ? '—' : formatMetricValue(selectedPoint.value, config.formatterCategory, metric)}
      data-rolling-hover-value={isInteracting && selectedPoint?.value != null ? formatMetricValue(selectedPoint.value, config.formatterCategory, metric) : ''}
      aria-labelledby="rolling-historical-analytics-title"
    >
      <div className="rolling-historical-analytics__header">
        <div className="rolling-historical-analytics__heading">
          <div className="rolling-historical-analytics__eyebrow">Rolling analytics</div>
          <div className="rolling-historical-analytics__title-row">
            <h3 id="rolling-historical-analytics-title">{config.title(windowMonths)}</h3>
            <strong className="rolling-historical-analytics__current-value" aria-live="polite">{selectedPoint?.value == null ? '—' : formatMetricValue(selectedPoint.value, config.formatterCategory, metric)}</strong>
          </div>
          <p className="rolling-historical-analytics__context">{context}</p>
          <p className="rolling-historical-analytics__metadata">{pointMetadata(selectedPoint)}</p>
        </div>
        <div className="rolling-historical-analytics__controls">
          <label className="rolling-historical-analytics__metric-control">
            <span>Analytics</span>
            <select value={metric} onChange={event => { setMetric(event.target.value as RollingHistoricalMetric); setSelectedIndex(null); setIsInteracting(false); }} aria-label="Analytics">
              {ROLLING_HISTORICAL_METRIC_CONFIGS.map(option => <option key={option.key} value={option.key}>{option.label}</option>)}
            </select>
          </label>
          <div className="rolling-historical-analytics__period" role="group" aria-label="Rolling period">
            {ROLLING_WINDOW_MONTHS.map(period => <button key={period} type="button" aria-pressed={windowMonths === period} className={windowMonths === period ? 'is-active' : ''} onClick={() => { setWindowMonths(period); setSelectedIndex(null); setIsInteracting(false); }}>{period}M</button>)}
          </div>
        </div>
      </div>
      <div className="rolling-historical-analytics__plot-wrap">
        <div ref={plotRef} className="rolling-historical-analytics__plot" data-testid="rolling-historical-analytics-plot">
          {hasData && selectedPoint && isInteracting && selectedX != null && (
            <div className="rolling-historical-analytics__tooltip" style={{ left: `${selectedXPercent}%`, transform: tooltipTransform }} role="status">
              <strong>{formatLongDate(selectedPoint.date)}</strong>
              <span>{config.label}: {formatMetricValue(selectedPoint.value, config.formatterCategory, metric)}</span>
              <span>{windowMonths}M rolling window · starts {formatAxisDate(selectedPoint.windowStartDate, false)}</span>
              {selectedPoint.value == null ? <span>No full-window observation</span> : tooltipMetadata(selectedPoint).map(row => <span key={row}>{row}</span>)}
            </div>
          )}
          <svg
            className="rolling-historical-analytics__svg"
            viewBox={`0 0 ${plotSize.width} ${plotSize.height}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${config.title(windowMonths)} time series from ${series.domain.startDate ?? 'the first trade'} through ${series.domain.endDate}`}
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerDown}
            onPointerLeave={() => { setIsInteracting(false); setSelectedIndex(null); }}
          >
            {scale && scale.ticks.map(tick => {
              const y = PLOT.top + (1 - (tick - scale.min) / (scale.max - scale.min || 1)) * plotHeight;
              return <g key={tick}><line className="rolling-historical-analytics__grid" x1={PLOT.left} x2={plotSize.width - PLOT.right} y1={y} y2={y} /><text className="rolling-historical-analytics__y-label" x={PLOT.left - 9} y={y + 4} textAnchor="end">{formatMetricValue(tick, config.formatterCategory, metric, true)}</text></g>;
            })}
            {scale && scale.min <= 0 && scale.max >= 0 && <line className="rolling-historical-analytics__zero" x1={PLOT.left} x2={plotSize.width - PLOT.right} y1={PLOT.top + (1 - (0 - scale.min) / (scale.max - scale.min || 1)) * plotHeight} y2={PLOT.top + (1 - (0 - scale.min) / (scale.max - scale.min || 1)) * plotHeight} />}
            <line className="rolling-historical-analytics__axis" x1={PLOT.left} x2={plotSize.width - PLOT.right} y1={PLOT.top + plotHeight} y2={PLOT.top + plotHeight} />
            {lineSegments.map((segment, index) => <path key={index} className="rolling-historical-analytics__line" d={pathForPoints(segment)} />)}
            {selectedX != null && isInteracting && <line className="rolling-historical-analytics__crosshair" x1={selectedX} x2={selectedX} y1={PLOT.top} y2={PLOT.top + plotHeight} />}
            {selectedX != null && selectedY != null && <circle className="rolling-historical-analytics__marker" cx={selectedX} cy={selectedY} r="4" />}
            {labelIndexes.map(index => {
              const point = series.points[index];
              if (!point) return null;
              const x = PLOT.left + (series.points.length <= 1 ? plotWidth / 2 : index / (series.points.length - 1) * plotWidth);
              return <text key={`${point.date}-${index}`} className="rolling-historical-analytics__x-label" x={x} y={plotSize.height - 10} textAnchor={index === 0 ? 'start' : index === series.points.length - 1 ? 'end' : 'middle'}>{formatAxisDate(point.date, longHistory)}</text>;
            })}
          </svg>
          {!hasData && <div className="rolling-historical-analytics__empty">No full-window observations in this history yet.</div>}
        </div>
      </div>
      <p className="sr-only">{summary} The chart keeps the full strategy history on the horizontal axis; null observations remain gaps. Tap or drag the plot to inspect date, value, window, and coverage metadata.</p>
    </section>
  );
}

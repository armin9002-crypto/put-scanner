import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { formatCurrency, formatPercent, formatPercentPoints, formatSignedPercent } from '../lib/format';
import { getNiceYAxisScale, type YAxisScale } from '../lib/chartScale';
import {
  buildPortfolioHistoricalStateSeries,
  PORTFOLIO_HISTORICAL_STATE_METRIC_CONFIGS,
  type PortfolioHistoricalStateMetric,
  type PortfolioHistoricalStatePoint,
} from '../lib/portfolioHistoricalStateAnalytics';
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

type HistoricalMetric = RollingHistoricalMetric | PortfolioHistoricalStateMetric;
type HistoricalPoint = RollingHistoricalAnalyticsPoint | PortfolioHistoricalStatePoint;
type HistoricalFormatterCategory = RollingHistoricalFormatterCategory;

interface HistoricalSeriesView {
  metric: HistoricalMetric;
  family: 'ROLLING' | 'PORTFOLIO_STATE';
  config: { label: string; formatterCategory: HistoricalFormatterCategory; title: string; subtitle: string };
  domain: { startDate: string | null; endDate: string };
  points: HistoricalPoint[];
}

interface PlotPoint { point: HistoricalPoint; index: number; x: number; y: number }
interface LineSegment { kind: 'solid' | 'partial' | 'gap'; points: PlotPoint[] }

function isFiniteValue(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRollingPoint(point: HistoricalPoint): point is RollingHistoricalAnalyticsPoint {
  return 'requestedWindowStart' in point;
}

function isStateMetric(metric: HistoricalMetric): metric is PortfolioHistoricalStateMetric {
  return PORTFOLIO_HISTORICAL_STATE_METRIC_CONFIGS.some(config => config.key === metric);
}

function formatCompactCurrency(value: number): string {
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(absolute >= 10_000_000 ? 0 : 1)}M`;
  if (absolute >= 1_000) return `${sign}$${(absolute / 1_000).toFixed(absolute >= 100_000 ? 0 : 1)}k`;
  return `${sign}$${Math.round(absolute)}`;
}

function formatMetricValue(value: number | null, category: HistoricalFormatterCategory, metric: HistoricalMetric, axis = false): string {
  if (!isFiniteValue(value)) return '—';
  if (category === 'ratio_percent') return metric === 'realizedIrr' ? formatSignedPercent(value * 100, 1) : formatPercent(value, 1);
  if (category === 'percentage_points') return formatPercentPoints(value, 1);
  if (category === 'signed_delta') return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`;
  if (category === 'days') return axis ? `${Math.round(value)}` : `${Math.round(value)} DTE`;
  return axis ? formatCompactCurrency(value) : formatCurrency(value, 0);
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

function pointX(point: HistoricalPoint, points: readonly HistoricalPoint[], plotWidth: number): number {
  if (points.length <= 1) return PLOT.left + plotWidth / 2;
  const start = Date.parse(`${points[0].date}T00:00:00Z`);
  const end = Date.parse(`${points[points.length - 1].date}T00:00:00Z`);
  const current = Date.parse(`${point.date}T00:00:00Z`);
  const ratio = end === start ? 0.5 : (current - start) / (end - start);
  return PLOT.left + Math.max(0, Math.min(1, ratio)) * plotWidth;
}

function buildLineSegments(points: readonly HistoricalPoint[], scale: YAxisScale, chartWidth: number, chartHeight: number): LineSegment[] {
  const plotWidth = Math.max(1, chartWidth - PLOT.left - PLOT.right);
  const plotHeight = Math.max(1, chartHeight - PLOT.top - PLOT.bottom);
  const range = scale.max - scale.min || 1;
  const finite = points.flatMap((point, index): PlotPoint[] => isFiniteValue(point.value) ? [{
    point,
    index,
    x: pointX(point, points, plotWidth),
    y: PLOT.top + (1 - (point.value - scale.min) / range) * plotHeight,
  }] : []);
  const segments: LineSegment[] = [];
  for (let index = 1; index < finite.length; index += 1) {
    const previous = finite[index - 1];
    const current = finite[index];
    const kind: LineSegment['kind'] = current.index !== previous.index + 1
      ? 'gap'
      : (isRollingPoint(previous.point) && !previous.point.fullWindow)
        || (isRollingPoint(current.point) && !current.point.fullWindow)
        ? 'partial'
        : 'solid';
    const latest = segments[segments.length - 1];
    if (latest?.kind === kind && latest.points[latest.points.length - 1].index === previous.index) latest.points.push(current);
    else segments.push({ kind, points: [previous, current] });
  }
  return segments;
}

function pathForPoints(points: readonly PlotPoint[]): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
}

function latestAvailableIndex(points: readonly HistoricalPoint[]): number | null {
  for (let index = points.length - 1; index >= 0; index -= 1) if (isFiniteValue(points[index].value)) return index;
  return points.length > 0 ? points.length - 1 : null;
}

function buildMetricYAxisScale(values: number[], metric: HistoricalMetric): YAxisScale | null {
  const finiteValues = values.filter(isFiniteValue);
  if (finiteValues.length === 0) return null;
  const includeZero = metric === 'premiumRunRate' || metric === 'grossRiskExposure' || metric === 'entryDelta' || metric === 'realizedIrr';
  return getNiceYAxisScale(includeZero ? [...finiteValues, 0] : finiteValues, 5);
}

function buildLabelIndexes(points: readonly HistoricalPoint[], chartWidth: number): number[] {
  if (points.length <= 1) return points.length ? [0] : [];
  const targetCount = chartWidth < 500 ? 3 : chartWidth < 760 ? 4 : 6;
  const plotWidth = Math.max(1, chartWidth - PLOT.left - PLOT.right);
  const indexes = new Set<number>([0, points.length - 1]);
  for (let anchor = 1; anchor < targetCount - 1; anchor += 1) {
    const targetX = PLOT.left + plotWidth * anchor / (targetCount - 1);
    const nearest = points.reduce((best, point, index) => {
      const distance = Math.abs(pointX(point, points, plotWidth) - targetX);
      return distance < best.distance ? { index, distance } : best;
    }, { index: 0, distance: Number.POSITIVE_INFINITY });
    indexes.add(nearest.index);
  }
  const ordered = [...indexes].sort((left, right) => left - right);
  const minimumSpacing = chartWidth < 500 ? 74 : 88;
  const finalIndex = points.length - 1;
  const kept: number[] = [];
  for (const index of ordered) {
    const x = pointX(points[index], points, plotWidth);
    const leftClear = kept.length === 0 || x - pointX(points[kept[kept.length - 1]], points, plotWidth) >= minimumSpacing;
    const rightClear = index === finalIndex || pointX(points[finalIndex], points, plotWidth) - x >= minimumSpacing;
    if (index === 0 || index === finalIndex || (leftClear && rightClear)) kept.push(index);
  }
  return kept;
}

function buildValueLabelIndexes(points: readonly HistoricalPoint[], chartWidth: number): number[] {
  if (chartWidth < 600) return [];
  const finiteIndexes = points.flatMap((point, index) => isFiniteValue(point.value) ? [index] : []);
  if (finiteIndexes.length === 0) return [];
  const plotWidth = Math.max(1, chartWidth - PLOT.left - PLOT.right);
  const latest = finiteIndexes[finiteIndexes.length - 1];
  const indexes = new Set<number>([latest]);
  const temporalAnchors = chartWidth < 860 ? 4 : 5;
  for (let anchor = 1; anchor <= temporalAnchors; anchor += 1) {
    const targetX = PLOT.left + plotWidth * anchor / (temporalAnchors + 1);
    const nearest = finiteIndexes.reduce((best, index) => {
      const distance = Math.abs(pointX(points[index], points, plotWidth) - targetX);
      return distance < best.distance ? { index, distance } : best;
    }, { index: latest, distance: Number.POSITIVE_INFINITY });
    const x = pointX(points[nearest.index], points, plotWidth);
    const clear = [...indexes].every(index => Math.abs(pointX(points[index], points, plotWidth) - x) >= 96);
    if (clear && x >= PLOT.left + 42 && x <= chartWidth - PLOT.right - 42) indexes.add(nearest.index);
  }
  return [...indexes].sort((left, right) => left - right);
}

function formatAvailableMonths(point: RollingHistoricalAnalyticsPoint): string {
  const months = Math.min(point.requestedWindowMonths, point.availableDays * 12 / 365.2425);
  return `${months.toFixed(1)} of ${point.requestedWindowMonths} months available`;
}

function rollingMetadata(point: RollingHistoricalAnalyticsPoint): string[] {
  const rows: string[] = [];
  if (point.fullWindow) rows.push(`Full trailing ${point.requestedWindowMonths}M`);
  else rows.push(`Partial window · ${formatAvailableMonths(point)}`);
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

function pointMetadata(point: HistoricalPoint | null): string {
  if (!point) return 'No observations yet';
  if (!isRollingPoint(point)) {
    const excluded = point.coverage.excludedUnsafeTerminalTrades > 0 ? ` · ${point.coverage.excludedUnsafeTerminalTrades} unsafe lifecycle record(s) excluded` : '';
    return `${point.openTrades} positions open at EOD · ${formatCurrency(point.grossRiskRepresented, 0)} Gross Risk${excluded}`;
  }
  const prefix = point.fullWindow ? `Full trailing ${point.requestedWindowMonths}M window` : `Partial window · ${formatAvailableMonths(point)}`;
  if (point.coverage) {
    const coverage = isFiniteValue(point.coverage.representedRiskPercent) ? ` · ${(point.coverage.representedRiskPercent * 100).toFixed(0)}% risk coverage` : '';
    return `${prefix} · ${point.coverage.representedTrades}/${point.coverage.totalEligibleTrades} trades · ${formatCurrency(point.coverage.representedGrossRisk, 0)} Gross Risk${coverage}`;
  }
  if (point.flow) return `${prefix} · ${point.flow.tradesOriginated} trades · trailing ${formatCurrency(point.flow.trailingValue ?? 0, 0)} · ×${point.flow.annualizationFactor.toFixed(1)}`;
  return `${prefix} · ${point.tradesIncluded} resolved trades · ${formatCurrency(point.grossRiskRepresented, 0)} Gross Risk`;
}

function historicalSeries(trades: readonly PortfolioTrade[], metric: HistoricalMetric, windowMonths: RollingWindowMonths): HistoricalSeriesView {
  if (isStateMetric(metric)) {
    const series = buildPortfolioHistoricalStateSeries(trades, metric);
    return {
      metric,
      family: 'PORTFOLIO_STATE',
      config: { label: series.config.label, formatterCategory: series.config.formatterCategory, title: series.config.title, subtitle: series.config.subtitle },
      domain: series.domain,
      points: series.points,
    };
  }
  const series = buildRollingHistoricalAnalyticsSeries(trades, metric, windowMonths);
  return {
    metric,
    family: 'ROLLING',
    config: { label: series.config.label, formatterCategory: series.config.formatterCategory, title: series.config.title(windowMonths), subtitle: series.config.subtitle(windowMonths) },
    domain: series.domain,
    points: series.points,
  };
}

export default function RollingHistoricalAnalyticsChart({ trades }: { trades: readonly PortfolioTrade[] }) {
  const [metric, setMetric] = useState<HistoricalMetric>('entryAy');
  const [windowMonths, setWindowMonths] = useState<RollingWindowMonths>(6);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const [plotSize, setPlotSize] = useState({ width: CHART_WIDTH, height: CHART_HEIGHT });
  const plotRef = useRef<HTMLDivElement>(null);
  const series = useMemo(() => historicalSeries(trades, metric, windowMonths), [metric, trades, windowMonths]);
  const scale = useMemo(() => buildMetricYAxisScale(series.points.map(point => point.value ?? Number.NaN), metric), [metric, series.points]);
  const latestIndex = latestAvailableIndex(series.points);
  const resolvedSelectedIndex = isInteracting && selectedIndex != null && selectedIndex < series.points.length ? selectedIndex : latestIndex;
  const selectedPoint = resolvedSelectedIndex == null ? null : series.points[resolvedSelectedIndex];
  const plotWidth = Math.max(1, plotSize.width - PLOT.left - PLOT.right);
  const plotHeight = Math.max(1, plotSize.height - PLOT.top - PLOT.bottom);
  const lineSegments = scale ? buildLineSegments(series.points, scale, plotSize.width, plotSize.height) : [];
  const labelIndexes = buildLabelIndexes(series.points, plotSize.width);
  const valueLabelIndexes = buildValueLabelIndexes(series.points, plotSize.width);

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
    const selectable = series.points.flatMap((point, index) => isFiniteValue(point.value) ? [{ point, index }] : []);
    if (selectable.length === 0) return;
    const rect = target.getBoundingClientRect();
    const localX = ((clientX - rect.left) / Math.max(rect.width, 1)) * plotSize.width;
    const nearest = selectable.reduce((best, item) => {
      const { point, index } = item;
      const distance = Math.abs(pointX(point, series.points, plotWidth) - localX);
      return distance < best.distance ? { index, distance } : best;
    }, { index: selectable[0].index, distance: Number.POSITIVE_INFINITY });
    setSelectedIndex(nearest.index);
    setIsInteracting(true);
  };
  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => selectPointAtClientX(event.clientX, event.currentTarget);
  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    selectPointAtClientX(event.clientX, event.currentTarget);
  };

  const selectedX = selectedPoint ? pointX(selectedPoint, series.points, plotWidth) : null;
  const selectedY = selectedPoint && scale && isFiniteValue(selectedPoint.value)
    ? PLOT.top + (1 - (selectedPoint.value - scale.min) / (scale.max - scale.min || 1)) * plotHeight
    : null;
  const selectedXPercent = selectedX == null ? null : selectedX / plotSize.width * 100;
  const tooltipTransform = selectedXPercent != null && selectedXPercent < 22 ? 'translateX(0)' : selectedXPercent != null && selectedXPercent > 78 ? 'translateX(-100%)' : 'translateX(-50%)';
  const domainStart = series.domain.startDate ?? series.domain.endDate;
  const longHistory = (Date.parse(`${series.domain.endDate}T00:00:00Z`) - Date.parse(`${domainStart}T00:00:00Z`)) / (86_400_000 * 30.4375) > 18;
  const context = isInteracting && selectedPoint
    ? `${formatLongDate(selectedPoint.date)} · ${series.family === 'ROLLING' ? `${windowMonths}M window` : 'point in time'}`
    : series.config.subtitle;
  const allMetricConfigs = [
    ...ROLLING_HISTORICAL_METRIC_CONFIGS.map(config => ({ key: config.key, label: config.label, family: 'Rolling' })),
    ...PORTFOLIO_HISTORICAL_STATE_METRIC_CONFIGS.map(config => ({ key: config.key, label: config.label, family: 'Portfolio State' })),
  ];

  return (
    <section className="rolling-historical-analytics" data-testid="rolling-historical-analytics" data-analytics-family={series.family}
      data-rolling-domain-start={series.domain.startDate ?? ''} data-rolling-domain-end={series.domain.endDate}
      data-rolling-observation-count={series.points.length} data-rolling-plot-width={Math.round(plotSize.width)}
      data-rolling-current-value={selectedPoint?.value == null ? '—' : formatMetricValue(selectedPoint.value, series.config.formatterCategory, metric)}
      data-rolling-hover-value={isInteracting && selectedPoint?.value != null ? formatMetricValue(selectedPoint.value, series.config.formatterCategory, metric) : ''}
      aria-labelledby="historical-analytics-title">
      <div className="rolling-historical-analytics__header">
        <div className="rolling-historical-analytics__heading">
          <div className="rolling-historical-analytics__eyebrow">Historical analytics · {series.family === 'ROLLING' ? 'Rolling' : 'Portfolio state'}</div>
          <div className="rolling-historical-analytics__title-row">
            <h3 id="historical-analytics-title">{series.config.title}</h3>
            <strong className="rolling-historical-analytics__current-value" aria-live="polite">{selectedPoint?.value == null ? '—' : formatMetricValue(selectedPoint.value, series.config.formatterCategory, metric)}</strong>
          </div>
          <p className="rolling-historical-analytics__context">{context}</p>
          <p className="rolling-historical-analytics__metadata">{pointMetadata(selectedPoint)}</p>
        </div>
        <div className="rolling-historical-analytics__controls">
          <label className="rolling-historical-analytics__metric-control">
            <span>Analytics</span>
            <select value={metric} onChange={event => { setMetric(event.target.value as HistoricalMetric); setSelectedIndex(null); setIsInteracting(false); }} aria-label="Analytics">
              {['Rolling', 'Portfolio State'].map(family => <optgroup key={family} label={family}>{allMetricConfigs.filter(option => option.family === family).map(option => <option key={option.key} value={option.key}>{option.label}</option>)}</optgroup>)}
            </select>
          </label>
          {series.family === 'ROLLING' ? <div className="rolling-historical-analytics__period" role="group" aria-label="Rolling period">
            {ROLLING_WINDOW_MONTHS.map(period => <button key={period} type="button" aria-pressed={windowMonths === period} className={windowMonths === period ? 'is-active' : ''} onClick={() => { setWindowMonths(period); setSelectedIndex(null); setIsInteracting(false); }}>{period}M</button>)}
          </div> : <span className="rolling-historical-analytics__point-in-time">Point in time</span>}
        </div>
      </div>
      <div className="rolling-historical-analytics__plot-wrap">
        <div ref={plotRef} className="rolling-historical-analytics__plot" data-testid="rolling-historical-analytics-plot">
          {selectedPoint && isInteracting && selectedX != null && <div className="rolling-historical-analytics__tooltip" style={{ left: `${selectedXPercent}%`, transform: tooltipTransform }} role="status">
            <strong>{formatLongDate(selectedPoint.date)}</strong>
            <span>{series.config.label}: {formatMetricValue(selectedPoint.value, series.config.formatterCategory, metric)}</span>
            {isRollingPoint(selectedPoint) ? <>
              <span>{selectedPoint.fullWindow ? `Full trailing ${selectedPoint.requestedWindowMonths}M window` : `Partial window · ${formatAvailableMonths(selectedPoint)}`}</span>
              <span>Effective start {formatAxisDate(selectedPoint.effectiveWindowStart, false)} · requested {formatAxisDate(selectedPoint.requestedWindowStart, false)}</span>
              {rollingMetadata(selectedPoint).slice(1).map(row => <span key={row}>{row}</span>)}
            </> : <><span>Point in time · end-of-day state</span><span>{selectedPoint.openTrades} open positions · {formatCurrency(selectedPoint.grossRiskRepresented, 0)} Gross Risk</span></>}
          </div>}
          <svg className="rolling-historical-analytics__svg" viewBox={`0 0 ${plotSize.width} ${plotSize.height}`} preserveAspectRatio="none" role="img"
            aria-label={`${series.config.title} time series from ${series.domain.startDate ?? 'the first trade'} through ${series.domain.endDate}`}
            onPointerMove={handlePointerMove} onPointerDown={handlePointerDown} onPointerLeave={() => { setIsInteracting(false); setSelectedIndex(null); }}>
            {scale && scale.ticks.map(tick => {
              const y = PLOT.top + (1 - (tick - scale.min) / (scale.max - scale.min || 1)) * plotHeight;
              return <g key={tick}><line className="rolling-historical-analytics__grid" x1={PLOT.left} x2={plotSize.width - PLOT.right} y1={y} y2={y} /><text className="rolling-historical-analytics__y-label" x={PLOT.left - 9} y={y + 4} textAnchor="end">{formatMetricValue(tick, series.config.formatterCategory, metric, true)}</text></g>;
            })}
            {scale && scale.min <= 0 && scale.max >= 0 && <line className="rolling-historical-analytics__zero" x1={PLOT.left} x2={plotSize.width - PLOT.right} y1={PLOT.top + (1 - (0 - scale.min) / (scale.max - scale.min || 1)) * plotHeight} y2={PLOT.top + (1 - (0 - scale.min) / (scale.max - scale.min || 1)) * plotHeight} />}
            <line className="rolling-historical-analytics__axis" x1={PLOT.left} x2={plotSize.width - PLOT.right} y1={PLOT.top + plotHeight} y2={PLOT.top + plotHeight} />
            {lineSegments.map((segment, index) => <path key={`${segment.kind}-${index}`} className={`rolling-historical-analytics__line rolling-historical-analytics__line--${segment.kind}`} d={pathForPoints(segment.points)} />)}
            {scale && valueLabelIndexes.map(index => {
              const point = series.points[index];
              if (!point || !isFiniteValue(point.value)) return null;
              const x = pointX(point, series.points, plotWidth);
              const y = PLOT.top + (1 - (point.value - scale.min) / (scale.max - scale.min || 1)) * plotHeight;
              const latest = index === latestIndex;
              return <text key={`value-${point.date}`} className={`rolling-historical-analytics__value-label ${latest ? 'is-latest' : ''}`} x={latest ? x - 4 : x} y={y < PLOT.top + 18 ? y + 15 : y - 8} textAnchor={latest ? 'end' : 'middle'}>{formatMetricValue(point.value, series.config.formatterCategory, metric, true)}</text>;
            })}
            {selectedX != null && isInteracting && <line className="rolling-historical-analytics__crosshair" x1={selectedX} x2={selectedX} y1={PLOT.top} y2={PLOT.top + plotHeight} />}
            {selectedX != null && selectedY != null && <circle className="rolling-historical-analytics__marker" cx={selectedX} cy={selectedY} r="4" />}
            {labelIndexes.map(index => {
              const point = series.points[index];
              if (!point) return null;
              const x = pointX(point, series.points, plotWidth);
              return <text key={`${point.date}-${index}`} className="rolling-historical-analytics__x-label" x={x} y={plotSize.height - 10} textAnchor={index === 0 ? 'start' : index === series.points.length - 1 ? 'end' : 'middle'}>{formatAxisDate(point.date, longHistory)}</text>;
            })}
          </svg>
          {!scale && <div className="rolling-historical-analytics__empty">No observations available for this metric yet.</div>}
        </div>
      </div>
      <p className="sr-only">The chart uses the full strategy-history horizontal domain. Valid partial rolling windows are dotted, complete windows are solid, and missing observations remain gaps with dotted bridges. Tap or drag to inspect exact source observations.</p>
    </section>
  );
}

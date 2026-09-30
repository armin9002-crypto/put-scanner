import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { HISTORICAL_VISIBLE_RANGES, HISTORICAL_VISIBLE_RANGE_LABELS, selectHistoricalVisiblePoints, type HistoricalVisibleRange } from '../lib/historicalVisibleRange';
import { buildHistoricalCalendarTicks, segmentHistoricalPoints, selectHistoricalValueLabels } from '../lib/historicalChartGeometry';
import { formatCurrency, formatPercent, formatPercentPoints, formatSignedPercent } from '../lib/format';
import { getNiceYAxisScale } from '../lib/chartScale';
import { useBlockingOverlayBehavior } from '../lib/blockingOverlay';
import { useOverlayDismiss } from '../lib/overlayMotion';
import { buildPortfolioHistoricalStateSeries, PORTFOLIO_HISTORICAL_STATE_METRIC_CONFIGS, type PortfolioHistoricalStateMetric, type PortfolioHistoricalStatePoint } from '../lib/portfolioHistoricalStateAnalytics';
import { buildRollingHistoricalAnalyticsSeries, ROLLING_HISTORICAL_METRIC_CONFIGS, ROLLING_WINDOW_MONTHS, type RollingHistoricalAnalyticsPoint, type RollingHistoricalFormatterCategory, type RollingHistoricalMetric, type RollingWindowMonths } from '../lib/rollingHistoricalAnalytics';
import type { PortfolioTrade } from '../lib/portfolioStorage';

export type HistoricalMetric = RollingHistoricalMetric | PortfolioHistoricalStateMetric;
type HistoricalPoint = RollingHistoricalAnalyticsPoint | PortfolioHistoricalStatePoint;
interface HistoricalSeriesView {
  metric: HistoricalMetric;
  family: 'ROLLING' | 'PORTFOLIO_STATE';
  config: { label: string; formatterCategory: RollingHistoricalFormatterCategory; title: string; subtitle: string };
  domain: { startDate: string | null; endDate: string };
  points: HistoricalPoint[];
}
interface DisplayedSeries { window: RollingWindowMonths; series: HistoricalSeriesView; primary: boolean }

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
  if (absolute >= 1_000_000) return `${sign}$${(absolute / 1_000_000).toFixed(1)}M`;
  if (absolute >= 1_000) return `${sign}$${(absolute / 1_000).toFixed(1)}k`;
  return `${sign}$${Math.round(absolute)}`;
}
function formatMetricValue(value: number | null, category: RollingHistoricalFormatterCategory, metric: HistoricalMetric, axis = false): string {
  if (!isFiniteValue(value)) return '—';
  if (category === 'ratio_percent') return metric === 'realizedIrr' ? formatSignedPercent(value * 100, 1) : formatPercent(value, 1);
  if (category === 'percentage_points') return formatPercentPoints(value, 1);
  if (category === 'signed_delta') return `${value >= 0 ? '+' : ''}${value.toFixed(3)}`;
  if (category === 'days') return axis ? `${Math.round(value)}` : `${Math.round(value)} DTE`;
  return axis ? formatCompactCurrency(value) : formatCurrency(value, 0);
}
function formatDate(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function latestAvailablePoint(points: readonly HistoricalPoint[]): HistoricalPoint | null {
  return points[latestAvailableIndex(points)] ?? points[points.length - 1] ?? null;
}
function latestAvailableIndex(points: readonly HistoricalPoint[]): number {
  for (let index = points.length - 1; index >= 0; index -= 1) if (isFiniteValue(points[index].value)) return index;
  return -1;
}
function coverageLabel(point: HistoricalPoint): string {
  if (!isRollingPoint(point)) return `${point.coverage.eligibleTrades}/${point.coverage.sourceTrades} lifecycle records eligible · ${point.coverage.excludedUnsafeTerminalTrades} excluded`;
  const coverage = point.coverage?.representedRiskPercent;
  if (coverage == null) return point.coverage ? 'Coverage unavailable' : '—';
  // Keep incomplete coverage distinguishable even when rounding would produce 100%.
  return `${Number((coverage * 100).toFixed(2))}%${coverage < 1 ? ' incomplete' : ''} coverage`;
}
function incompleteCoverage(point: HistoricalPoint | null): boolean {
  return !!point && (isRollingPoint(point) ? point.coverage != null && point.coverage.representedRiskPercent !== 1 : point.coverage.excludedUnsafeTerminalTrades > 0);
}
function pointMetadata(point: HistoricalPoint | null): string {
  if (!point) return 'No observations yet';
  if (!isRollingPoint(point)) return `${point.openTrades} open positions · ${formatCompactCurrency(point.grossRiskRepresented)} Gross Risk · EOD${point.coverage.excludedUnsafeTerminalTrades ? ` · ${point.coverage.excludedUnsafeTerminalTrades} excluded` : ''}`;
  return `${point.tradesIncluded} trades · ${formatCompactCurrency(point.grossRiskRepresented)} Gross Risk${point.coverage ? ` · ${coverageLabel(point)}` : ''} · ${point.fullWindow ? `Full ${point.requestedWindowMonths}M window` : 'Partial lookback'}`;
}
function historicalSeries(trades: readonly PortfolioTrade[], metric: HistoricalMetric, windowMonths: RollingWindowMonths): HistoricalSeriesView {
  if (isStateMetric(metric)) return { ...buildPortfolioHistoricalStateSeries(trades, metric), family: 'PORTFOLIO_STATE' };
  const series = buildRollingHistoricalAnalyticsSeries(trades, metric, windowMonths);
  return { ...series, family: 'ROLLING', config: { ...series.config, title: series.config.title(windowMonths), subtitle: series.config.subtitle(windowMonths) } };
}

function ObservationDataDialog({ displayed, onClose }: { displayed: DisplayedSeries[]; onClose: () => void }) {
  const titleId = useId();
  const overlayRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const requestClose = useOverlayDismiss(onClose, panelRef, overlayRef);
  useBlockingOverlayBehavior({ panelRef, overlayRef, initialFocusRef: panelRef, onEscape: requestClose });
  const primary = displayed.find(item => item.primary)!;
  const rolling = primary.series.family === 'ROLLING';
  return createPortal(<div ref={overlayRef} className="historical-data-layer fixed inset-0 z-[95] flex items-center justify-center p-4">
    <button type="button" className="motion-backdrop absolute inset-0 bg-black/60" aria-label="Close observation data" onClick={requestClose} />
    <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="historical-data-panel motion-modal overlay-panel relative z-10 flex flex-col overflow-hidden outline-none">
      <header><div><h2 id={titleId}>Observation data · {primary.series.config.label}</h2><p>{primary.series.points.length} visible dates · {rolling ? 'Trailing windows' : 'End-of-day state'} · unavailable values shown as —</p></div><button type="button" className="icon-button" aria-label="Close observation data" onClick={requestClose}><X size={20} /></button></header>
      <div className="historical-data-scroll" tabIndex={0} role="region" aria-label="Visible observations table">
        <table className="financial-table"><caption className="sr-only">Exact observations backing the visible chart, with source coverage. No constituent trades.</caption>
          <thead><tr><th scope="col">Date</th>{displayed.length > 1 && <th scope="col">Window</th>}<th scope="col">{primary.series.config.label}</th><th scope="col">{rolling ? 'Trades represented' : 'Open positions'}</th><th scope="col">Gross Risk represented</th><th scope="col">Coverage / exclusions</th><th scope="col">{rolling ? 'Window basis' : 'State basis'}</th></tr></thead>
          <tbody>{primary.series.points.flatMap((point, index) => displayed.map(item => {
            const observation = item.series.points[index];
            if (!observation || observation.date !== point.date) return null;
            return <tr key={`${point.date}-${item.window}`} data-observation-date={point.date}><th scope="row">{point.date}</th>{displayed.length > 1 && <td>{item.window}M{item.primary ? ' (primary)' : ''}</td>}<td>{formatMetricValue(observation.value, item.series.config.formatterCategory, item.series.metric)}</td><td>{isRollingPoint(observation) ? observation.tradesIncluded : observation.openTrades}</td><td>{formatCurrency(observation.grossRiskRepresented, 2)}</td><td>{coverageLabel(observation)}</td><td>{isRollingPoint(observation) ? `${observation.fullWindow ? 'Full' : 'Partial'} ${item.window}M · ${observation.effectiveWindowStart}–${observation.date}` : 'End of day'}</td></tr>;
          }))}</tbody>
        </table>
        {primary.series.points.length === 0 && <p>No visible observations.</p>}
      </div>
    </div>
  </div>, document.body);
}

export default function RollingHistoricalAnalyticsChart({ trades, metric: controlledMetric, onMetricChange, windowMonths: controlledWindowMonths, onWindowMonthsChange }: {
  trades: readonly PortfolioTrade[]; metric?: HistoricalMetric; onMetricChange?: (metric: HistoricalMetric) => void; windowMonths?: RollingWindowMonths; onWindowMonthsChange?: (windowMonths: RollingWindowMonths) => void;
}) {
  const titleId = useId();
  const instructionsId = useId();
  const [uncontrolledMetric, setUncontrolledMetric] = useState<HistoricalMetric>('entryAy');
  const [uncontrolledWindowMonths, setUncontrolledWindowMonths] = useState<RollingWindowMonths>(6);
  const metric = controlledMetric ?? uncontrolledMetric;
  const windowMonths = controlledWindowMonths ?? uncontrolledWindowMonths;
  const [visibleRange, setVisibleRange] = useState<HistoricalVisibleRange>('Since Inception');
  const [compare, setCompare] = useState(false);
  const [viewData, setViewData] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [pinnedIndex, setPinnedIndex] = useState<number | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const plotRef = useRef<HTMLDivElement>(null);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const [plotSize, setPlotSize] = useState({ width: 960, height: 292, textScale: 1 });
  const computedSeries = useMemo(() => historicalSeries(trades, metric, windowMonths), [trades, metric, windowMonths]);
  const comparison = useMemo(() => compare && !isStateMetric(metric) ? ROLLING_WINDOW_MONTHS.filter(window => window !== windowMonths).map(window => ({ window, series: historicalSeries(trades, metric, window), primary: false })) : [], [compare, metric, trades, windowMonths]);
  const displayed = useMemo(() => [...comparison, { window: windowMonths, series: computedSeries, primary: true }].map(item => ({ ...item, series: { ...item.series, points: selectHistoricalVisiblePoints(item.series.points, item.series.domain.endDate, visibleRange) } })), [comparison, computedSeries, visibleRange, windowMonths]);
  const series = displayed[displayed.length - 1].series;
  const currentPoint = latestAvailablePoint(computedSeries.points);
  const latestIndex = latestAvailableIndex(series.points);
  const inspecting = selectedIndex != null || pinnedIndex != null;
  const resolvedIndex = selectedIndex ?? pinnedIndex ?? latestIndex;
  const selectedPoint = series.points[resolvedIndex] ?? null;
  const formatValue = (value: number | null, axis = false) => formatMetricValue(value, series.config.formatterCategory, metric, axis);

  useEffect(() => { setSelectedIndex(null); setPinnedIndex(null); setShowHelp(false); }, [metric, windowMonths, visibleRange, trades]);
  useEffect(() => {
    const element = plotRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const textScale = Number.parseFloat(getComputedStyle(element).getPropertyValue('--ui-text-scale')) || 1;
      if (rect.width > 0) setPlotSize({ width: rect.width, height: element.clientHeight || 292, textScale });
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(element);
    const textObserver = new MutationObserver(update);
    textObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-text-size'] });
    return () => { resize.disconnect(); textObserver.disconnect(); };
  }, []);

  // Geometry and extra windows stay memoized while pointer selection changes.
  const geometry = useMemo(() => {
    const left = 64 * plotSize.textScale;
    const right = 12;
    const top = 30;
    const bottom = 28;
    const width = Math.max(1, plotSize.width - left - right);
    const height = Math.max(1, plotSize.height - top - bottom);
    const start = series.points[0]?.date ?? series.domain.endDate;
    const end = series.points[series.points.length - 1]?.date ?? series.domain.endDate;
    const startTime = Date.parse(start);
    const span = Date.parse(end) - startTime;
    const x = (date: string) => left + (span === 0 ? 0.5 : (Date.parse(date) - startTime) / span) * width;
    const values = displayed.flatMap(item => item.series.points.flatMap(point => isFiniteValue(point.value) ? [point.value] : []));
    const includeZero = ['premiumRunRate', 'grossRiskExposure', 'entryDelta', 'realizedIrr', 'blendedCapture'].includes(metric);
    const scale = values.length ? getNiceYAxisScale(includeZero ? [...values, 0] : values, plotSize.height < 180 ? 3 : 5) : null;
    const y = (value: number) => top + (1 - (value - (scale?.min ?? 0)) / ((scale?.max ?? 1) - (scale?.min ?? 0) || 1)) * height;
    const step = series.family === 'PORTFOLIO_STATE';
    const lines = displayed.map(item => ({ ...item, segments: segmentHistoricalPoints(item.series.points).map(segment => {
      const points = segment.indexes.map(index => item.series.points[index]);
      const path = points.map((point, index) => `${index === 0 ? 'M' : step ? 'H' : 'L'} ${x(point.date).toFixed(2)}${index > 0 && step ? ' V' : ''} ${y(point.value!).toFixed(2)}`).join(' ');
      return { ...segment, points, path };
    }) }));
    const fontSize = (plotSize.width < 600 ? 11 : 12) * plotSize.textScale;
    const labels: { index: number; text: string; x: number; y: number; width: number; height: number; current: boolean }[] = [];
    if (scale) selectHistoricalValueLabels(series.points).forEach(label => {
      const point = series.points[label.index];
      const text = `${label.roles[0]} ${formatMetricValue(point.value, series.config.formatterCategory, metric, true)}`;
      const labelWidth = text.length * fontSize * 0.62 + 8;
      if (labelWidth > width) return;
      const labelX = Math.min(plotSize.width - right - labelWidth, Math.max(left, x(point.date) - labelWidth / 2));
      const pointY = y(point.value!);
      const labelY = pointY < top + fontSize + 8 ? pointY + fontSize + 8 : pointY - 9;
      const box = { index: label.index, text, x: labelX, y: labelY, width: labelWidth, height: fontSize + 5, current: label.roles.includes('Current') };
      if (!labels.some(other => box.x < other.x + other.width + 8 && box.x + box.width + 8 > other.x && Math.abs(box.y - other.y) < box.height + 5)) labels.push(box);
    });
    const maxRisk = Math.max(1, ...series.points.map(point => point.grossRiskRepresented));
    const stride = Math.max(1, Math.ceil(series.points.length / Math.max(1, Math.floor(width / 5))));
    const bars = series.family === 'ROLLING' && plotSize.width >= 500 ? series.points.filter((_, index) => index % stride === 0).map(point => ({ x: x(point.date), height: point.grossRiskRepresented / maxRisk * 14 })) : [];
    return { left, right, top, bottom, width, height, x, y, scale, lines, labels, bars, ticks: buildHistoricalCalendarTicks(start, end, width, 78 * plotSize.textScale), hasPartial: displayed.some(item => item.series.points.some(point => isRollingPoint(point) && !point.fullWindow && isFiniteValue(point.value))), hasGaps: displayed.some(item => item.series.points.some(point => !isFiniteValue(point.value))) };
  }, [displayed, metric, plotSize, series]);

  const nearestIndex = (clientX: number, target: SVGSVGElement) => {
    const rect = target.getBoundingClientRect();
    const localX = (clientX - rect.left) / Math.max(1, rect.width) * plotSize.width;
    return series.points.reduce((best, point, index) => Math.abs(geometry.x(point.date) - localX) < best.distance ? { index, distance: Math.abs(geometry.x(point.date) - localX) } : best, { index: -1, distance: Infinity }).index;
  };
  const announcePoint = (index: number, pinned: boolean) => {
    const point = series.points[index];
    setAnnouncement(point ? `${pinned ? 'Pinned' : 'Inspecting'} ${formatDate(point.date)}: ${formatValue(point.value)}. ${pointMetadata(point)}` : 'Selection cleared');
  };
  const clearSelection = () => { setPinnedIndex(null); setSelectedIndex(null); setAnnouncement('Selection cleared. Current value shown.'); };
  const handlePointerDown = (event: PointerEvent<SVGSVGElement>) => { pointerStart.current = { x: event.clientX, y: event.clientY }; };
  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    const start = pointerStart.current;
    pointerStart.current = null;
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) return;
    const index = nearestIndex(event.clientX, event.currentTarget);
    if (index < 0) return;
    if (pinnedIndex === index) clearSelection();
    else { setPinnedIndex(index); setSelectedIndex(null); announcePoint(index, true); }
  };
  const handleKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    if (event.key === 'Escape') { event.preventDefault(); clearSelection(); return; }
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (!series.points.length) return;
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? series.points.length - 1 : Math.max(0, Math.min(series.points.length - 1, (resolvedIndex < 0 ? 0 : resolvedIndex) + (event.key === 'ArrowLeft' ? -1 : 1)));
      setSelectedIndex(next); announcePoint(next, false);
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (resolvedIndex >= 0) { setPinnedIndex(resolvedIndex); setSelectedIndex(null); announcePoint(resolvedIndex, true); }
    }
  };
  const changeMetric = (next: HistoricalMetric) => { onMetricChange?.(next); if (!onMetricChange) setUncontrolledMetric(next); };
  const selectedX = selectedPoint ? geometry.x(selectedPoint.date) : null;
  const showComparison = compare && series.family === 'ROLLING';

  return <section className="rolling-historical-analytics" data-testid="rolling-historical-analytics" data-analytics-family={series.family}
    data-rolling-domain-start={series.points[0]?.date ?? ''} data-rolling-domain-end={series.domain.endDate}
    data-rolling-observation-count={series.points.length} data-rolling-plot-width={Math.round(plotSize.width)}
    data-rolling-current-value={formatValue(currentPoint?.value ?? null)} data-rolling-hover-value={inspecting && selectedPoint ? formatValue(selectedPoint.value) : ''}
    data-pinned-date={pinnedIndex == null ? '' : series.points[pinnedIndex]?.date ?? ''} data-comparison={showComparison} aria-labelledby={titleId}>
    <div className="rolling-historical-analytics__header">
      <div className="rolling-historical-analytics__heading">
        <div className="rolling-historical-analytics__eyebrow">Historical analytics</div>
        <div className="rolling-historical-analytics__title-row"><h3 id={titleId}>{series.config.label}</h3><strong className="rolling-historical-analytics__current-value">{formatValue(currentPoint?.value ?? null)}</strong></div>
        <p className="rolling-historical-analytics__context">{series.family === 'ROLLING' ? `${windowMonths}M rolling` : 'End-of-day state'} · {currentPoint ? `through ${formatDate(currentPoint.date)}` : 'No observations'}</p>
      </div>
      <div className="rolling-historical-analytics__controls" tabIndex={0} role="group" aria-label="Historical analytics controls; scroll for more">
        <label className="rolling-historical-analytics__metric-control"><span>Series</span><select aria-label="Series" value={series.family} onChange={event => { setCompare(false); changeMetric(event.target.value === 'ROLLING' ? 'entryAy' : 'grossRiskExposure'); }}><option value="ROLLING">Rolling</option><option value="PORTFOLIO_STATE">Portfolio State</option></select></label>
        <label className="rolling-historical-analytics__metric-control"><span>Metric</span><select value={metric} onChange={event => changeMetric(event.target.value as HistoricalMetric)} aria-label="Metric">
          {series.family === 'ROLLING' ? <>{['Entry / Strategy', 'Outcomes'].map(group => <optgroup key={group} label={group}>{ROLLING_HISTORICAL_METRIC_CONFIGS.filter(config => (['realizedIrr', 'blendedCapture'].includes(config.key) ? 'Outcomes' : 'Entry / Strategy') === group).map(config => <option key={config.key} value={config.key}>{config.label}</option>)}</optgroup>)}</> : PORTFOLIO_HISTORICAL_STATE_METRIC_CONFIGS.map(config => <option key={config.key} value={config.key}>{config.label}</option>)}
        </select></label>
        {series.family === 'ROLLING' && <div className="rolling-historical-analytics__metric-control"><span>Window</span><div className="rolling-historical-analytics__period" role="group" aria-label="Rolling window">{ROLLING_WINDOW_MONTHS.map(period => <button type="button" key={period} aria-pressed={windowMonths === period} className={windowMonths === period ? 'is-active' : ''} onClick={() => { onWindowMonthsChange?.(period); if (!onWindowMonthsChange) setUncontrolledWindowMonths(period); }}>{period}M</button>)}</div></div>}
        <label className="rolling-historical-analytics__metric-control"><span>Range</span><select aria-label="Range" value={visibleRange} onChange={event => setVisibleRange(event.target.value as HistoricalVisibleRange)}>{HISTORICAL_VISIBLE_RANGES.map(range => <option key={range} value={range}>{HISTORICAL_VISIBLE_RANGE_LABELS[range]}</option>)}</select></label>
        {series.family === 'ROLLING' && <button type="button" className="historical-control-action" aria-pressed={compare} onClick={() => setCompare(value => !value)}>Compare</button>}
        <button type="button" className="historical-control-action" onClick={() => setViewData(true)}>View data</button>
        <button type="button" className="historical-control-action" aria-expanded={showHelp} aria-label="Chart methodology" onClick={() => setShowHelp(value => !value)}>?</button>
      </div>
    </div>
    <p className={`rolling-historical-analytics__metadata ${incompleteCoverage(currentPoint) ? 'is-incomplete' : ''}`} title={pointMetadata(currentPoint)}>{pointMetadata(currentPoint)}</p>
    <div className="rolling-historical-analytics__plot-wrap"><div ref={plotRef} className="rolling-historical-analytics__plot" data-testid="rolling-historical-analytics-plot">
      <div className="historical-chart-legend" aria-label="Chart context">
        {showComparison && ROLLING_WINDOW_MONTHS.map(window => <span key={window} className={`historical-window historical-window--${window} ${window === windowMonths ? 'is-primary' : ''}`}>{window}M{window === windowMonths ? ' primary' : ''}</span>)}
        {geometry.hasPartial && <span className="historical-partial-key">Partial lookback</span>}{geometry.hasGaps && <span>Gaps: unavailable</span>}
        {geometry.bars.length > 0 && <span className="historical-risk-key">Gross Risk context</span>}
      </div>
      {showHelp && <div className="historical-chart-help" role="region" aria-label="Chart methodology"><button type="button" onClick={() => setShowHelp(false)} aria-label="Close methodology">×</button><p>{series.config.subtitle}</p><p>Range changes display only. Current is the latest available value. Dashed segments are valid partial lookbacks; missing observations break the line. The faint lower bars show represented Gross Risk, not statistical confidence.</p><p>Tap/click to pin. Left/Right explores dates, Enter pins, Escape clears. View data contains the observations and coverage.</p></div>}
      {selectedPoint && inspecting && !showHelp && <div className={`rolling-historical-analytics__tooltip ${pinnedIndex != null ? 'is-pinned' : ''}`} style={{ left: selectedX != null && selectedX > plotSize.width / 2 ? '0.35rem' : undefined, right: selectedX != null && selectedX <= plotSize.width / 2 ? '0.35rem' : undefined }}>
        <strong>{pinnedIndex === resolvedIndex ? 'Pinned · ' : ''}{formatDate(selectedPoint.date)}</strong>
        {showComparison ? displayed.slice().sort((a, b) => a.window - b.window).map(item => <span key={item.window}>{item.window}M{item.primary ? ' primary' : ''}: <b>{formatMetricValue(item.series.points[resolvedIndex]?.value ?? null, series.config.formatterCategory, metric)}</b>{isRollingPoint(item.series.points[resolvedIndex]) && !item.series.points[resolvedIndex].fullWindow ? ' · Partial' : ''}</span>) : <span>{series.config.label}: <b>{formatValue(selectedPoint.value)}</b></span>}
        <span className={incompleteCoverage(selectedPoint) ? 'is-incomplete' : ''}>{pointMetadata(selectedPoint)}</span>
        <span>{formatCurrency(selectedPoint.grossRiskRepresented, 2)} Gross Risk represented</span>
        {isRollingPoint(selectedPoint) ? <><span>{selectedPoint.effectiveWindowStart}–{selectedPoint.date} · requested {selectedPoint.requestedWindowStart}</span>{selectedPoint.coverage && <span>{selectedPoint.coverage.representedTrades}/{selectedPoint.coverage.totalEligibleTrades} trades · {formatCurrency(selectedPoint.coverage.representedGrossRisk, 2)}/{formatCurrency(selectedPoint.coverage.totalEligibleGrossRisk, 2)} risk</span>}{selectedPoint.flow && <span>Trailing Premium {selectedPoint.flow.trailingValue == null ? '—' : formatCurrency(selectedPoint.flow.trailingValue, 2)} · annualization {selectedPoint.flow.annualizationFactor == null ? 'unavailable' : `×${selectedPoint.flow.annualizationFactor.toFixed(2)}`}</span>}</> : <span>{coverageLabel(selectedPoint)}</span>}
      </div>}
      {pinnedIndex != null && <button type="button" className="historical-clear-pin" onClick={clearSelection} aria-label="Clear pinned observation">Clear pin</button>}
      <svg className="rolling-historical-analytics__svg" viewBox={`0 0 ${plotSize.width} ${plotSize.height}`} preserveAspectRatio="none" role="group" tabIndex={0} aria-roledescription="interactive time series chart"
        aria-label={`${series.config.title} time series from ${series.points[0]?.date ?? 'the first trade'} through ${series.domain.endDate}`} aria-describedby={instructionsId}
        onPointerMove={event => { if (event.pointerType === 'mouse') { const next = nearestIndex(event.clientX, event.currentTarget); setSelectedIndex(next < 0 ? null : next); } }} onPointerDown={handlePointerDown} onPointerUp={handlePointerUp} onPointerCancel={() => { pointerStart.current = null; }} onPointerLeave={() => setSelectedIndex(null)} onBlur={() => setSelectedIndex(null)} onKeyDown={handleKeyDown}>
        {geometry.scale?.ticks.map(tick => <g key={tick}><line className="rolling-historical-analytics__grid" x1={geometry.left} x2={plotSize.width - geometry.right} y1={geometry.y(tick)} y2={geometry.y(tick)} /><text className="rolling-historical-analytics__y-label" x={geometry.left - 9} y={geometry.y(tick) + 4} textAnchor="end">{formatValue(tick, true)}</text></g>)}
        {geometry.scale && geometry.scale.min <= 0 && geometry.scale.max >= 0 && <line className="rolling-historical-analytics__zero" x1={geometry.left} x2={plotSize.width - geometry.right} y1={geometry.y(0)} y2={geometry.y(0)} />}
        <line className="rolling-historical-analytics__axis" x1={geometry.left} x2={plotSize.width - geometry.right} y1={geometry.top + geometry.height} y2={geometry.top + geometry.height} />
        {geometry.bars.map((bar, index) => <rect key={index} className="historical-context-bar" x={bar.x - 1} y={geometry.top + geometry.height - bar.height} width={2} height={bar.height} />)}
        {geometry.scale && geometry.lines.map(item => <g key={item.window} data-window={series.family === 'ROLLING' ? item.window : 'state'} data-primary={item.primary} className={`historical-series ${item.primary ? 'is-primary' : `is-secondary historical-series--${item.window}`}`}>
          {item.segments.map((segment, index) => <g key={index}>
            {item.primary && ['premiumRunRate', 'grossRiskExposure'].includes(metric) && segment.points.length > 1 && <path className="historical-series-area" d={`${segment.path} L ${geometry.x(segment.points[segment.points.length - 1].date)} ${geometry.y(0)} L ${geometry.x(segment.points[0].date)} ${geometry.y(0)} Z`} />}
            <path className={`rolling-historical-analytics__line rolling-historical-analytics__line--${segment.kind}`} d={segment.path} />
            {segment.points.length === 1 && <circle className="historical-island" cx={geometry.x(segment.points[0].date)} cy={geometry.y(segment.points[0].value!)} r={2.5} />}
          </g>)}
        </g>)}
        {geometry.labels.map(label => <text key={label.index} className={`rolling-historical-analytics__value-label ${label.current ? 'is-latest' : ''}`} x={label.x} y={label.y}>{label.text}</text>)}
        {selectedX != null && inspecting && <line className="rolling-historical-analytics__crosshair" x1={selectedX} x2={selectedX} y1={geometry.top} y2={geometry.top + geometry.height} />}
        {selectedX != null && selectedPoint && isFiniteValue(selectedPoint.value) && <circle className="rolling-historical-analytics__marker" cx={selectedX} cy={geometry.y(selectedPoint.value)} r={4} />}
        {geometry.ticks.map(tick => <text key={tick.date} className="rolling-historical-analytics__x-label" x={geometry.x(tick.date)} y={plotSize.height - 7} textAnchor={geometry.x(tick.date) < geometry.left + 30 ? 'start' : geometry.x(tick.date) > plotSize.width - 45 ? 'end' : 'middle'}>{tick.label}</text>)}
      </svg>
      {!geometry.scale && <div className="rolling-historical-analytics__empty">No observations available for this metric yet.</div>}
    </div></div>
    <p className="sr-only" id={instructionsId}>Left and Right explore observations. Enter or Space pins. Escape clears. Tap or click to pin an observation. Partial lookbacks are dashed; unavailable observations are gaps without connecting lines.</p>
    <span className="sr-only" role="status" aria-live="polite">{announcement}</span>
    {viewData && <ObservationDataDialog displayed={displayed} onClose={() => setViewData(false)} />}
  </section>;
}

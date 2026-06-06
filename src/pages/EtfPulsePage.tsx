import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Activity, AlertTriangle, RefreshCw, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { buildEtfPulseRows, getEtfPulseUniverse, type EtfPulseLoadResult, type EtfPulseProgress } from '../lib/etfPulseData';
import type { EtfPulseRow, EtfPulseTrend } from '../lib/etfPulseMetrics';
import { formatCurrency, formatPercent } from '../lib/format';
import { isFiniteNumber } from '../lib/optionMetrics';
import { postureFromRegime } from '../lib/tradeCockpit/posture';
import { analyzeRegime } from '../lib/tradeCockpit/regime';
import type { RegimeAnalysis, TradePosture } from '../lib/tradeCockpit/types';

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
  | 'trend';

type SortDirection = 'asc' | 'desc';
type TrendFilter = 'All' | EtfPulseTrend | 'Oversold' | 'Overbought';
type VisualPeriod = '1D' | '5D' | '30D' | '3M' | '6M' | 'YTD' | '1Y';

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

const VISUAL_PERIODS: VisualPeriod[] = ['1D', '5D', '30D', '3M', '6M', 'YTD', '1Y'];

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

function getReturnForPeriod(row: EtfPulseRow, period: VisualPeriod): number | null {
  switch (period) {
    case '1D': return row.returns.oneDay;
    case '5D': return row.returns.fiveDay;
    case '30D': return row.returns.thirtyDay;
    case '3M': return row.returns.threeMonth;
    case '6M': return row.returns.sixMonth;
    case 'YTD': return row.returns.yearToDate;
    case '1Y': return row.returns.oneYear;
    default: return null;
  }
}

function heatmapTileStyle(value: number | null): { backgroundColor: string; borderColor: string; color: string } {
  if (!isFiniteNumber(value)) return { backgroundColor: 'var(--surface-alt)', borderColor: 'var(--border)', color: 'var(--text-dim)' };
  if (value >= 0.2) return { backgroundColor: 'rgba(34,197,94,0.28)', borderColor: 'rgba(34,197,94,0.42)', color: 'var(--green)' };
  if (value >= 0.05) return { backgroundColor: 'rgba(34,197,94,0.18)', borderColor: 'rgba(34,197,94,0.30)', color: 'var(--green)' };
  if (value >= 0) return { backgroundColor: 'rgba(34,197,94,0.08)', borderColor: 'rgba(34,197,94,0.18)', color: 'var(--text-secondary)' };
  if (value > -0.05) return { backgroundColor: 'rgba(249,115,22,0.08)', borderColor: 'rgba(249,115,22,0.18)', color: 'var(--text-secondary)' };
  if (value > -0.2) return { backgroundColor: 'rgba(249,115,22,0.18)', borderColor: 'rgba(249,115,22,0.32)', color: 'var(--orange)' };
  return { backgroundColor: 'rgba(239,68,68,0.24)', borderColor: 'rgba(239,68,68,0.42)', color: 'var(--red)' };
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

function sortValue(row: EtfPulseRow, field: PulseSortField): number | string | null {
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

function marketBadgeStyle(label: string, tone: 'regime' | 'confidence' | 'posture' = 'regime'): { color: string; bg: string; border: string } {
  if (tone === 'confidence') return { color: 'var(--text-muted)', bg: 'var(--surface-alt)', border: 'var(--border)' };
  if (tone === 'posture') {
    if (label === 'Balanced') return { color: 'var(--accent-light)', bg: 'var(--accent-bg)', border: 'var(--accent-border)' };
    if (label === 'Selective / Patient') return { color: 'var(--yellow)', bg: 'rgba(250,204,21,0.10)', border: 'rgba(250,204,21,0.25)' };
    if (label === 'Defensive') return { color: 'var(--orange)', bg: 'rgba(251,146,60,0.10)', border: 'rgba(251,146,60,0.25)' };
    if (label === 'Very Defensive') return { color: 'var(--red)', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.25)' };
    if (label === 'Opportunistic') return { color: 'var(--green)', bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.25)' };
  }
  if (label.includes('Risk-On')) return { color: 'var(--green)', bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.22)' };
  if (label.includes('Healthy')) return { color: 'var(--accent-light)', bg: 'var(--accent-bg)', border: 'var(--accent-border)' };
  if (label.includes('Choppy') || label.includes('Pullback')) return { color: 'var(--yellow)', bg: 'rgba(250,204,21,0.10)', border: 'rgba(250,204,21,0.22)' };
  if (label.includes('Risk') || label.includes('Panic')) return { color: 'var(--red)', bg: 'rgba(239,68,68,0.10)', border: 'rgba(239,68,68,0.24)' };
  return { color: 'var(--text-muted)', bg: 'var(--surface-alt)', border: 'var(--border)' };
}

function MarketBadge({ label, tone = 'regime' }: { label: string; tone?: 'regime' | 'confidence' | 'posture' }) {
  const style = marketBadgeStyle(label, tone);
  return <span className="inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap" style={{ color: style.color, backgroundColor: style.bg, border: `1px solid ${style.border}` }}>{label}</span>;
}

function pctText(value: number | null | undefined, decimals = 0): string {
  return isFiniteNumber(value) ? formatPercent(value, decimals) : DASH;
}

function buildMarketReadRibbonCopy(regime: RegimeAnalysis, posture: TradePosture): { read: string; bias: string } {
  const stats = regime.stats;
  const elevatedRv = (stats.medianRealizedVolatility20 ?? 0) >= 0.55;
  const weakBreadth = (stats.breadthAbove200 ?? 1) < 0.5;
  const extended = (stats.qqqPosition52Week ?? 0) >= 0.9 || stats.overboughtCount >= 5;
  const oversold = stats.oversoldCount >= 5;

  const read = regime.label === 'Complacent Risk-On'
    ? extended
      ? 'Trend strong, but extension and lower margin of safety argue against chasing thin premium.'
      : 'Breadth is supportive, but avoid chasing strong ETFs unless bid yield justifies the risk.'
    : regime.label === 'Choppy / Elevated Vol'
      ? elevatedRv
        ? 'Mixed tape and elevated RV argue for wider strikes, smaller size, and cleaner liquidity.'
        : 'Mixed tape makes ETF selection more important than broad-market direction.'
      : regime.label === 'Risk-Off'
        ? weakBreadth
          ? 'Weak breadth means high yields may reflect real downside risk, not free premium.'
          : 'Trend damage keeps assignment quality more important than headline yield.'
        : regime.label === 'Oversold Panic'
          ? oversold
            ? 'Oversold conditions can lift premium, but assignment and gap risk are elevated.'
            : 'Panic-like volatility can make bids look attractive; size and cushion matter first.'
          : regime.label === 'Healthy Pullback'
            ? 'Trend remains intact while short-term weakness may improve entry premium.'
            : regime.label === 'Healthy Risk-On'
              ? 'Breadth and trend are supportive; still require liquidity, cushion, and fair bid yield.'
              : 'Signals are mixed; let individual ETF setup quality drive decisions.';

  const bias = posture.label === 'Selective / Patient'
    ? 'Bias: patience · wider cushions · healthy pullbacks'
    : posture.label === 'Balanced'
      ? 'Bias: clean trends · moderate delta · liquid strikes'
      : posture.label === 'Opportunistic'
        ? 'Bias: RSI resets · above 200D · controlled pullbacks'
        : posture.label === 'Very Defensive'
          ? 'Bias: very low delta · small size · strongest underlyings'
          : 'Bias: smaller size · wider strikes · avoid weak 200D trends';

  return { read, bias };
}

function MarketReadStrip({
  regime,
  posture,
  unavailable,
  onOpen,
}: {
  regime: RegimeAnalysis | null;
  posture: TradePosture | null;
  unavailable: boolean;
  onOpen: () => void;
}) {
  if (unavailable || !regime || !posture) {
    return (
      <div className="rounded-lg px-3 py-2 min-w-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2">
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Market Read</div>
          <div className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>Unavailable - load ETF Pulse data.</div>
        </div>
      </div>
    );
  }

  const copy = buildMarketReadRibbonCopy(regime, posture);

  return (
    <div className="rounded-lg px-3 py-2 min-w-0" style={{ backgroundColor: 'rgba(15,23,42,0.18)', border: '1px solid var(--border)' }}>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(230px,auto)_minmax(0,1fr)_minmax(230px,auto)_auto] gap-2 lg:items-center">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>Market Read</div>
          <div className="flex flex-wrap items-center gap-1">
            <MarketBadge label={regime.label} />
            <MarketBadge label={`${regime.confidence} confidence`} tone="confidence" />
            <MarketBadge label={posture.label} tone="posture" />
          </div>
        </div>
        <p className="text-xs leading-5 min-w-0 lg:truncate" style={{ color: 'var(--text-secondary)' }}>{copy.read}</p>
        <p className="text-[11px] leading-5 min-w-0 lg:text-right lg:truncate" style={{ color: 'var(--text-muted)' }}>{copy.bias}</p>
        <button
          type="button"
          onClick={onOpen}
          className="justify-self-start lg:justify-self-end rounded px-2 py-1 text-[11px] font-semibold min-h-[30px] transition hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-blue-400/40"
          style={{ backgroundColor: 'var(--surface)', color: 'var(--accent-light)', border: '1px solid var(--border)' }}
        >
          Details
        </button>
      </div>
    </div>
  );
}

function MarketReadModal({ regime, posture, onClose }: { regime: RegimeAnalysis; posture: TradePosture; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[90]">
      <button type="button" aria-label="Close market read" onClick={onClose} className="absolute inset-0 bg-black/55" />
      <section className="absolute inset-x-3 top-6 sm:inset-x-1/2 sm:w-[680px] sm:-translate-x-1/2 rounded-lg max-h-[85dvh] overflow-y-auto p-3 sm:p-4 shadow-2xl" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-wider mb-1" style={{ color: 'var(--text-dim)' }}>Market Read</div>
            <div className="flex flex-wrap items-center gap-1.5">
              <MarketBadge label={regime.label} />
              <MarketBadge label={`${regime.confidence} confidence`} tone="confidence" />
              <MarketBadge label={posture.label} tone="posture" />
            </div>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 min-h-[40px] min-w-[40px] inline-flex items-center justify-center" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="grid gap-3 text-sm">
          <section>
            <h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--text)' }}>Plain-English market read</h3>
            <p className="leading-6" style={{ color: 'var(--text-secondary)' }}>{regime.marketRead}</p>
          </section>
          <section>
            <h3 className="text-xs font-semibold mb-1" style={{ color: 'var(--text)' }}>What this means for selling puts</h3>
            <p className="leading-6" style={{ color: 'var(--text-secondary)' }}>{regime.putSellingImplication}</p>
          </section>
          <section className="rounded-lg p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--text)' }}>Key drivers</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <div>SPY: {regime.stats.spyTrend}</div>
              <div>QQQ: {regime.stats.qqqTrend}</div>
              <div>Above 200D: {pctText(regime.stats.breadthAbove200)}</div>
              <div>Oversold: {regime.stats.oversoldCount}</div>
              <div>Median 30D: {pctText(regime.stats.medianThirtyDayReturn, 1)}</div>
              <div>Median 20D RV: {pctText(regime.stats.medianRealizedVolatility20, 1)}</div>
              {(regime.stats.vixTrend || regime.stats.vxnTrend) && <div className="sm:col-span-2">Vol proxies: VIX {regime.stats.vixTrend ?? DASH} · VXN {regime.stats.vxnTrend ?? DASH}</div>}
            </div>
          </section>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <MarketReadList title="Favor" items={regime.favor} />
            <MarketReadList title="Avoid" items={regime.avoid} />
          </div>
        </div>
      </section>
    </div>
  );
}

function MarketReadList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="rounded-lg p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <h3 className="text-xs font-semibold mb-2" style={{ color: 'var(--text)' }}>{title}</h3>
      <ul className="space-y-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
        {items.map(item => <li key={item} className="leading-5">{item}</li>)}
      </ul>
    </section>
  );
}

function VisualPeriodSelector({ value, onChange }: { value: VisualPeriod; onChange: (period: VisualPeriod) => void }) {
  return (
    <div className="inline-flex rounded-lg overflow-hidden" style={{ border: '1px solid var(--border)' }}>
      {VISUAL_PERIODS.map(period => (
        <button
          key={period}
          type="button"
          onClick={() => onChange(period)}
          className="px-2.5 py-1.5 text-[11px] font-medium transition-colors"
          style={{
            backgroundColor: value === period ? 'var(--accent-bg)' : 'var(--surface)',
            color: value === period ? 'var(--accent-light)' : 'var(--text-muted)',
            borderRight: period === VISUAL_PERIODS[VISUAL_PERIODS.length - 1] ? 'none' : '1px solid var(--border)',
          }}
        >
          {period}
        </button>
      ))}
    </div>
  );
}

function VisualCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <section className="rounded-lg p-3 min-w-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="mb-3">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{title}</h3>
        <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{subtitle}</p>
      </div>
      {children}
    </section>
  );
}

function UniverseHeatmap({ rows, period, onOpenTicker }: { rows: EtfPulseRow[]; period: VisualPeriod; onOpenTicker: (ticker: string) => void }) {
  const items = useMemo(() => [...rows].sort((a, b) => {
    const aValue = getReturnForPeriod(a, period);
    const bValue = getReturnForPeriod(b, period);
    if (aValue == null && bValue == null) return a.ticker.localeCompare(b.ticker);
    if (aValue == null) return 1;
    if (bValue == null) return -1;
    return bValue - aValue;
  }), [period, rows]);

  if (items.length === 0) {
    return <div className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No ETFs match the current filters.</div>;
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6 2xl:grid-cols-8 gap-2">
      {items.map(row => {
        const value = getReturnForPeriod(row, period);
        const trend = trendStyle(row);
        const style = heatmapTileStyle(value);
        return (
          <button
            key={row.ticker}
            type="button"
            onClick={() => onOpenTicker(row.ticker)}
            aria-label={`Open ${row.ticker} ETF detail`}
            className="rounded-md p-2 min-h-[64px] overflow-hidden text-left cursor-pointer transition duration-150 hover:-translate-y-0.5 hover:shadow-[0_0_0_1px_rgba(96,165,250,0.28)] focus:outline-none focus:ring-2 focus:ring-blue-400/40 flex flex-col justify-between"
            title={`${row.ticker} - ${row.name}\n${period}: ${formatPct(value)}\nRSI: ${isFiniteNumber(row.rsi14) ? row.rsi14.toFixed(1) : DASH}\nTrend: ${trend.label}\n20D RV: ${formatPct(row.realizedVolatility20)}\nRecent DD: ${formatPct(row.recentDrawdown30)}\nvs 50D: ${formatPct(row.distance50)}\nvs 200D: ${formatPct(row.distance200)}\n52W Pos: ${formatPct(row.position52Week)}\n52W DD: ${formatPct(row.drawdown52Week)}`}
            style={{ backgroundColor: style.backgroundColor, border: `1px solid ${style.borderColor}` }}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="font-mono text-xs font-bold truncate" style={{ color: 'var(--text)' }}>{row.ticker}</div>
              <div className="font-mono text-xs font-semibold whitespace-nowrap" style={{ color: style.color }}>{formatPct(value)}</div>
            </div>
            <div className="mt-2 flex items-end justify-between gap-2 min-w-0">
              <div className="truncate text-[10px]" style={{ color: trend.color }}>{trend.label}</div>
              <div className="font-mono text-[10px] tabular-nums whitespace-nowrap flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{formatPrice(row.price)}</div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function MomentumQuadrant({ rows, period, onOpenTicker }: { rows: EtfPulseRow[]; period: VisualPeriod; onOpenTicker: (ticker: string) => void }) {
  const [hoveredTicker, setHoveredTicker] = useState<string | null>(null);
  const points = useMemo(() => rows
    .map(row => ({ row, x: getReturnForPeriod(row, period), y: row.rsi14 }))
    .filter((point): point is { row: EtfPulseRow; x: number; y: number } => isFiniteNumber(point.x) && isFiniteNumber(point.y)), [period, rows]);

  const width = 720;
  const height = 360;
  const padding = { top: 24, right: 24, bottom: 42, left: 50 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const minX = Math.min(-0.05, ...points.map(point => point.x));
  const maxX = Math.max(0.05, ...points.map(point => point.x));
  const spanX = Math.max(0.02, maxX - minX);
  const xMin = minX - spanX * 0.12;
  const xMax = maxX + spanX * 0.12;
  const scaleX = (value: number) => padding.left + ((value - xMin) / (xMax - xMin)) * plotWidth;
  const scaleY = (value: number) => padding.top + ((100 - value) / 100) * plotHeight;
  const zeroX = Math.max(padding.left, Math.min(padding.left + plotWidth, scaleX(0)));
  const rsi50Y = scaleY(50);
  const rsi35Y = scaleY(35);
  const rsi70Y = scaleY(70);
  const hoveredPoint = points.find(point => point.row.ticker === hoveredTicker) ?? null;
  const tooltipWidth = 218;
  const tooltipHeight = 178;
  const tooltipX = hoveredPoint
    ? Math.max(8, Math.min(width - tooltipWidth - 8, scaleX(hoveredPoint.x) + 14))
    : 0;
  const tooltipY = hoveredPoint
    ? Math.max(8, Math.min(height - tooltipHeight - 8, scaleY(hoveredPoint.y) - tooltipHeight / 2))
    : 0;

  if (points.length === 0) {
    return <div className="py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No ETFs with return and RSI data match the current filters.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[520px]" role="img" aria-label={`Momentum quadrant using ${period} return and RSI`}>
        <rect x={0} y={0} width={width} height={height} rx={8} fill="transparent" />
        <line x1={padding.left} x2={padding.left + plotWidth} y1={rsi70Y} y2={rsi70Y} stroke="rgba(251,146,60,0.35)" strokeDasharray="4 4" />
        <line x1={padding.left} x2={padding.left + plotWidth} y1={rsi35Y} y2={rsi35Y} stroke="rgba(96,165,250,0.35)" strokeDasharray="4 4" />
        <line x1={zeroX} x2={zeroX} y1={padding.top} y2={padding.top + plotHeight} stroke="var(--border)" />
        <line x1={padding.left} x2={padding.left + plotWidth} y1={rsi50Y} y2={rsi50Y} stroke="var(--border)" />
        <rect x={padding.left} y={padding.top} width={plotWidth} height={plotHeight} fill="none" stroke="var(--border)" />
        <text x={padding.left + 8} y={padding.top + 16} fontSize="10" fill="var(--text-dim)">Mixed / Defensive</text>
        <text x={padding.left + plotWidth - 118} y={padding.top + 16} fontSize="10" fill="var(--text-dim)">Strength / Extended</text>
        <text x={padding.left + 8} y={padding.top + plotHeight - 8} fontSize="10" fill="var(--text-dim)">Weak / Oversold</text>
        <text x={padding.left + plotWidth - 104} y={padding.top + plotHeight - 8} fontSize="10" fill="var(--text-dim)">Bounce / Improving</text>
        <text x={padding.left} y={height - 14} fontSize="11" fill="var(--text-muted)">{period} return</text>
        <text x={8} y={padding.top + 10} fontSize="11" fill="var(--text-muted)">RSI</text>
        <text x={padding.left - 28} y={scaleY(70) + 4} fontSize="10" fill="var(--text-dim)">70</text>
        <text x={padding.left - 28} y={scaleY(50) + 4} fontSize="10" fill="var(--text-dim)">50</text>
        <text x={padding.left - 28} y={scaleY(35) + 4} fontSize="10" fill="var(--text-dim)">35</text>
        <text x={scaleX(0) + 4} y={height - 14} fontSize="10" fill="var(--text-dim)">0%</text>
        {points.map(({ row, x, y }) => {
          const trend = trendStyle(row);
          const radius = Math.max(4, Math.min(9, 4 + ((row.realizedVolatility20 ?? 0) * 7)));
          const active = hoveredTicker === row.ticker;
          return (
            <circle
              key={row.ticker}
              cx={scaleX(x)}
              cy={scaleY(y)}
              r={active ? radius + 3 : radius}
              fill={trend.color}
              fillOpacity={active ? 0.96 : 0.82}
              stroke={active ? 'var(--accent-light)' : 'var(--bg)'}
              strokeWidth={active ? 2.5 : 1.5}
              className="cursor-pointer"
              onMouseEnter={() => setHoveredTicker(row.ticker)}
              onFocus={() => setHoveredTicker(row.ticker)}
              onMouseLeave={() => setHoveredTicker(current => current === row.ticker ? null : current)}
              onBlur={() => setHoveredTicker(current => current === row.ticker ? null : current)}
              onClick={() => onOpenTicker(row.ticker)}
              tabIndex={0}
              role="button"
              aria-label={`Open ${row.ticker} ETF detail`}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onOpenTicker(row.ticker);
                }
              }}
            />
          );
        })}
        {hoveredPoint && (
          <foreignObject x={tooltipX} y={tooltipY} width={tooltipWidth} height={tooltipHeight} pointerEvents="none">
            <div
              className="rounded-lg p-2.5 text-[11px] shadow-xl"
              style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}
            >
              <div className="font-mono text-sm font-bold" style={{ color: 'var(--accent-light)' }}>{hoveredPoint.row.ticker}</div>
              <div className="truncate text-[10px] mb-2" style={{ color: 'var(--text-muted)' }}>{hoveredPoint.row.name}</div>
              <TooltipMetric label={`${period} return`} value={formatPct(hoveredPoint.x)} color={valueColor(hoveredPoint.x)} />
              <TooltipMetric label="RSI" value={hoveredPoint.y.toFixed(1)} color={rsiColor(hoveredPoint.y)} />
              <TooltipMetric label="Trend" value={trendStyle(hoveredPoint.row).label} color={trendStyle(hoveredPoint.row).color} />
              <TooltipMetric label="20D RV" value={formatPct(hoveredPoint.row.realizedVolatility20)} color={volatilityColor(hoveredPoint.row.realizedVolatility20)} />
              <TooltipMetric label="Recent DD" value={formatPct(hoveredPoint.row.recentDrawdown30)} color={recentDrawdownColor(hoveredPoint.row.recentDrawdown30)} />
              <TooltipMetric label="vs 50D" value={formatPct(hoveredPoint.row.distance50)} color={valueColor(hoveredPoint.row.distance50)} />
              <TooltipMetric label="vs 200D" value={formatPct(hoveredPoint.row.distance200)} color={valueColor(hoveredPoint.row.distance200)} />
              <TooltipMetric label="52W Pos" value={formatPct(hoveredPoint.row.position52Week)} color={rangePositionColor(hoveredPoint.row.position52Week)} />
              <TooltipMetric label="52W DD" value={formatPct(hoveredPoint.row.drawdown52Week)} color={drawdownColor(hoveredPoint.row.drawdown52Week)} />
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  );
}

function TooltipMetric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="flex items-center justify-between gap-3 leading-5">
      <span style={{ color: 'var(--text-dim)' }}>{label}</span>
      <span className="font-mono tabular-nums font-semibold text-right" style={{ color }}>{value}</span>
    </div>
  );
}

export default function EtfPulsePage() {
  const navigate = useNavigate();
  const [result, setResult] = useState<EtfPulseLoadResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<EtfPulseProgress>({ loaded: 0, total: getEtfPulseUniverse().length });
  const [search, setSearch] = useState('');
  const [leverageFilter, setLeverageFilter] = useState('All');
  const [typeFilter, setTypeFilter] = useState('All');
  const [trendFilter, setTrendFilter] = useState<TrendFilter>('All');
  const [sort, setSort] = useState<SortState>({ field: 'ticker', direction: 'asc' });
  const [selectedVisualPeriod, setSelectedVisualPeriod] = useState<VisualPeriod>('30D');
  const [showMarketRead, setShowMarketRead] = useState(false);

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

  const rows = useMemo(() => result?.rows ?? [], [result]);
  const regime = useMemo(() => rows.length > 0 ? analyzeRegime(rows, result?.fetchedAt ?? null) : null, [result?.fetchedAt, rows]);
  const posture = useMemo(() => regime ? postureFromRegime(regime) : null, [regime]);
  const leverageOptions = useMemo(() => ['All', ...new Set(getEtfPulseUniverse().map(etf => etf.leverage))], []);
  const typeOptions = useMemo(() => ['All', ...new Set(getEtfPulseUniverse().map(etf => etf.type))], []);
  const trendOptions: TrendFilter[] = ['All', 'Strong Uptrend', 'Uptrend', 'Weakening', 'Downtrend', 'Oversold', 'Overbought'];
  const openTicker = (ticker: string) => navigate(`/options/${ticker.trim().toUpperCase()}`);

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
      if (aValue == null && bValue == null) return 0;
      if (aValue == null) return 1;
      if (bValue == null) return -1;
      if (typeof aValue === 'string' || typeof bValue === 'string') return String(aValue).localeCompare(String(bValue)) * direction;
      return (aValue - bValue) * direction;
    });
  }, [leverageFilter, rows, search, sort, trendFilter, typeFilter]);

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
  ], [navigate]);

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
    <div className="etf-pulse-page min-h-[calc(100dvh-2.75rem)]" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="max-w-[1800px] mx-auto px-2 sm:px-4 lg:px-6 py-2 sm:py-3">
        <div className="etf-pulse-controls flex-shrink-0 -mx-2 sm:-mx-4 lg:-mx-6 px-2 sm:px-4 lg:px-6 pb-2 mb-2" style={{ backgroundColor: 'var(--bg)', borderBottom: '1px solid var(--border)' }}>
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
          <div className="mb-2">
            <MarketReadStrip regime={regime} posture={posture} unavailable={rows.length === 0} onOpen={() => setShowMarketRead(true)} />
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

        <div className="etf-pulse-content min-w-0">
          <div className="etf-pulse-table-card rounded-lg overflow-hidden h-[min(56dvh,620px)] min-h-[320px]" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
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

          <section className="mt-4 pb-3">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-2 mb-3">
              <div>
                <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>ETF Pulse Visuals</h2>
                <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Heatmap and momentum quadrant use the currently filtered ETF Pulse rows.</p>
              </div>
              <VisualPeriodSelector value={selectedVisualPeriod} onChange={setSelectedVisualPeriod} />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)] gap-3">
              <VisualCard title="Universe Heatmap" subtitle="Performance by selected period across the ETF universe.">
                <UniverseHeatmap rows={filteredRows} period={selectedVisualPeriod} onOpenTicker={openTicker} />
              </VisualCard>
              <VisualCard title="Momentum Quadrant" subtitle="Selected-period return versus RSI. Point size reflects 20D realized volatility.">
                <MomentumQuadrant rows={filteredRows} period={selectedVisualPeriod} onOpenTicker={openTicker} />
              </VisualCard>
            </div>
          </section>

          <div className="mt-2 pb-1 text-[10px]" style={{ color: 'var(--text-dim)' }}>
            Filters and sorting are client-side. Refresh loads one cached 2Y daily series per ETF with limited concurrency.
          </div>
        </div>
      </div>
      {showMarketRead && regime && posture && <MarketReadModal regime={regime} posture={posture} onClose={() => setShowMarketRead(false)} />}
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

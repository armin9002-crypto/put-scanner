import { Fragment, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, Briefcase, ChevronDown, ChevronRight, Download, Edit2, FileImage, Loader2, MoreHorizontal, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { calculatePutDelta, fetchBatchPricesResult, fetchOptions } from '../lib/api';
import type { OptionsChainData } from '../lib/types';
import { acquireOptionChains, canonicalOptionChainKey } from '../lib/optionChainRequests';
import { formatCurrency, formatDate, formatOptionPrice, formatPercent, formatPercentPoints, normalizeTimestampMs } from '../lib/format';
import { calculateDte, calculateMoneyness, calculateYieldPercent, isFiniteNumber } from '../lib/optionMetrics';
import {
  archiveExpiredOpenTrades,
  getExpirationClosePrice,
  isArchivedTrade,
  resolveExpiredTradeWithClose,
} from '../lib/portfolioExpirationArchive';
import {
  getTradeDistanceToBreakeven,
  getTradeDistanceToStrike,
  getTradeGrossRisk,
  buildFlatScheduleTrades,
  buildExpirationScheduleGroups,
  buildUnderlyingScheduleGroups,
  groupByExpiration,
  groupByTicker,
  type PortfolioExpirationScheduleGroup,
  type PortfolioExposureGroup,
  type PortfolioUnderlyingScheduleGroup,
} from '../lib/portfolioAnalytics';
import {
  addPortfolioTrade,
  deletePortfolioTrade,
  loadPortfolioTrades,
  savePortfolioTrades,
  updatePortfolioTrade,
  type PortfolioTrade,
  type PortfolioTradeInput,
  type PortfolioTradeStatus,
} from '../lib/portfolioStorage';
import {
  calculateBreakeven,
  calculateCurrentAnnualizedYield,
  calculateCurrentMarkValueAbsolute,
  calculateCurrentNominalYield,
  calculateCurrentOptionMark,
  calculateCurrentPositionValue,
  calculateDistanceToStrike,
  calculateEquityAtRisk,
  calculateNetCapitalAtRisk,
  calculateOriginalNominalYield,
  calculateOriginalAnnualizedYield,
  calculateOriginalDte,
  calculatePercentCaptured,
  calculatePortfolioMarkSummary,
  calculatePortfolioSummary,
  calculatePremiumCollected,
  calculateRemainingDte,
  calculateTotalGainLoss,
  type MarkBasis,
} from '../lib/portfolioMetrics';
import type { OptionDetail } from '../components/OptionDetailDrawer';
import ErrorBoundary from '../components/ErrorBoundary';
import DataFreshness from '../components/DataFreshness';
import { persistCollapsedExpirationGroups, persistCollapsedUnderlyingGroups, persistPortfolioGroupMode, readCollapsedExpirationGroups, readCollapsedUnderlyingGroups, readPortfolioGroupMode, setAllExpirationGroupsCollapsed, toggleCollapsedExpirationGroup, type PortfolioGroupMode } from '../lib/portfolioSchedulePreferences';
import { buildHistoryAnalytics, buildMonthlyRealizedPnl, filterHistoryTrades, historyDaysHeld, historyRealizedIrr, type HistoryOutcome } from '../lib/portfolioHistoryAnalytics';
import { resolvePortfolioEntryVix } from '../lib/portfolioEntryVix';
import { applyTransientPortfolioMarketData } from '../lib/portfolioMarketRefresh';
import { useResponsiveMode } from '../lib/responsive';
import MobileBottomSheet from '../components/mobile/MobileBottomSheet';
import MobileSegmentedControl from '../components/mobile/MobileSegmentedControl';
import MobilePositionRow from '../components/mobile/MobilePositionRow';
import MobileExpirationGroup from '../components/mobile/MobileExpirationGroup';
import {
  getPortfolioPositionHealthLevel,
  sortExpirationPortfolioScheduleGroups,
  sortFlatPortfolioSchedule,
  sortUnderlyingPortfolioScheduleGroups,
  type PortfolioScheduleSortDirection,
  type PortfolioScheduleSortField,
} from '../lib/portfolioScheduleSorting';
import { OPTION_QUOTE_TABLE_DISPLAY_ORDER, orderedOptionQuoteEntries } from '../lib/optionQuoteDisplay';
import { persistPortfolioMarkBasis, readPortfolioMarkBasis } from '../lib/portfolioMarkPreference';
import { persistShowNominalYield, readShowNominalYield } from '../lib/optionTablePreferences';

const OptionDetailDrawer = lazy(() => import('../components/OptionDetailDrawer'));
const PortfolioScreenshotImportModal = lazy(() => import('../components/PortfolioScreenshotImportModal'));
const DataBackupModal = lazy(() => import('../components/DataBackupModal'));
const DASH = '\u2014';
const MARK_BASIS_OPTIONS: MarkBasis[] = [...OPTION_QUOTE_TABLE_DISPLAY_ORDER];

interface TradeModalProps {
  trade: PortfolioTrade | null;
  onClose: () => void;
  onSave: (trade: PortfolioTradeInput, id?: string) => void;
  onDelete: (id: string) => void;
}
interface DrawerSelection {
  option: OptionDetail;
  ticker: string;
  expirationLabel: string;
  dte: number | null;
  underlyingPrice: number | null;
}

interface CloseCandidate {
  trade: PortfolioTrade;
  percentCaptured: number | null;
  currentAnnualizedYield: number | null;
  remainingPremium: number | null;
  dte: number | null;
  score: number;
  reasons: string[];
}

type PortfolioScheduleGroup = PortfolioExpirationScheduleGroup | PortfolioUnderlyingScheduleGroup;

const PORTFOLIO_SCHEDULE_SORT_OPTIONS: Array<{ value: PortfolioScheduleSortField; label: string }> = [
  { value: 'ticker', label: 'Ticker' },
  { value: 'expiration', label: 'Expiry' },
  { value: 'dte', label: 'DTE' },
  { value: 'health', label: 'Health' },
  { value: 'strike', label: 'Strike' },
  { value: 'contracts', label: 'Contracts' },
  { value: 'soldPrice', label: 'Sold Price' },
  { value: 'premium', label: 'Premium Collected' },
  { value: 'grossRisk', label: 'Gross Risk' },
  { value: 'currentMark', label: 'Current Mark' },
  { value: 'currentValue', label: 'Current Value' },
  { value: 'pnl', label: 'Total Gain/Loss' },
  { value: 'percentCaptured', label: '% Captured' },
  { value: 'delta', label: 'Delta' },
  { value: 'breakeven', label: 'Breakeven' },
  { value: 'underlying', label: 'Underlying' },
  { value: 'distanceToStrike', label: 'Distance to Strike' },
  { value: 'iv', label: 'IV' },
  { value: 'entryVix', label: 'VIX @ Entry' },
  { value: 'openInterest', label: 'Open Interest' },
  { value: 'originalNy', label: 'Original NY' },
  { value: 'originalAy', label: 'Original AY' },
  { value: 'currentNy', label: 'Current NY' },
  { value: 'currentAy', label: 'Current AY' },
];

function todayIso(): string {
  return new Date().toISOString().split('T')[0];
}

function isoToUnixSeconds(iso: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [year, month, day] = iso.split('-').map(Number);
  return Math.floor(Date.UTC(year, month - 1, day) / 1000);
}

function formatDteValue(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return DASH;
  return value <= 0 ? 'Expired' : `${value} DTE`;
}

function formatDays(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return DASH;
  return value === 1 ? '1 day' : `${value} days`;
}

function scheduleGroupKey(group: PortfolioScheduleGroup): string {
  return 'expiration' in group ? group.expiration : group.ticker;
}

function scheduleGroupLabel(group: PortfolioScheduleGroup): string {
  return 'expiration' in group ? formatFullDate(group.expiration) : group.ticker;
}

function scheduleGroupDte(group: PortfolioScheduleGroup): string {
  if ('expiration' in group) return formatDteValue(group.dte);
  if (!isFiniteNumber(group.minDte) || !isFiniteNumber(group.maxDte)) return DASH;
  return group.minDte === group.maxDte ? formatDteValue(group.minDte) : `${group.minDte}–${group.maxDte} DTE`;
}

function scheduleGroupMetadata(group: PortfolioScheduleGroup): string {
  if ('expiration' in group) return `${group.tradeCount} ${group.tradeCount === 1 ? 'position' : 'positions'} · ${group.contractCount} ${group.contractCount === 1 ? 'contract' : 'contracts'}`;
  return `${group.tradeCount} ${group.tradeCount === 1 ? 'position' : 'positions'} · ${group.contractCount} ${group.contractCount === 1 ? 'contract' : 'contracts'} · ${group.expirationCount} ${group.expirationCount === 1 ? 'expiration' : 'expirations'}`;
}

function VixEntryTooltipContent({ trade }: { trade: PortfolioTrade }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text)' }}>VIX at Trade Entry</div>
      <TooltipRows rows={[
        { label: 'Written', value: formatFullDate(trade.soldDate) },
        { label: 'VIX Close', value: isFiniteNumber(trade.entryVixClose) ? trade.entryVixClose.toFixed(2) : DASH },
        { label: 'Source', value: trade.entryVixSource === 'nearest_prior_close' ? `Nearest prior close · ${formatFullDate(trade.entryVixDate)}` : trade.entryVixSource === 'historical_close' ? `${formatFullDate(trade.entryVixDate)} closing value` : DASH },
      ]} />
    </div>
  );
}

function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatFullDate(value: string | number | null | undefined): string {
  if (typeof value === 'number') {
    const timestamp = normalizeTimestampMs(value);
    return timestamp == null ? DASH : new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const date = parseDateOnly(value) ?? (value ? new Date(value) : null);
  return date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : DASH;
}

function calendarDaysSince(value: string | null | undefined, now = new Date()): number | null {
  const date = parseDateOnly(value);
  if (!date) return null;
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.max(0, Math.floor((end - start) / 86400000));
  return Number.isFinite(days) ? days : null;
}

function formatDaysAgo(value: string | null | undefined): string {
  const days = calendarDaysSince(value);
  if (days == null) return DASH;
  if (days === 0) return 'Today';
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

function formatMarkBasis(value: MarkBasis): string {
  if (value === 'bid') return 'Bid';
  if (value === 'ask') return 'Ask';
  if (value === 'last') return 'Last';
  return 'Mid';
}

function getPortfolioMidMark(trade: PortfolioTrade): number | null {
  const explicitMid = trade.latestMarketData?.optionMid;
  if (isFiniteNumber(explicitMid)) return explicitMid;
  const bid = trade.latestMarketData?.optionBid;
  const ask = trade.latestMarketData?.optionAsk;
  return isFiniteNumber(bid) && isFiniteNumber(ask) && ask >= bid ? (bid + ask) / 2 : null;
}

function getLastTradeStaleness(value: string | number | null | undefined): { label: string | null; color: string } {
  const timestamp = typeof value === 'number' ? normalizeTimestampMs(value) : value ? new Date(value).getTime() : null;
  if (timestamp == null || Number.isNaN(timestamp)) return { label: null, color: 'var(--text-muted)' };
  const tradeDate = new Date(timestamp);
  const now = new Date();
  const tradeMidnight = new Date(tradeDate.getFullYear(), tradeDate.getMonth(), tradeDate.getDate()).getTime();
  const nowMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const ageDays = Math.max(0, Math.floor((nowMidnight - tradeMidnight) / 86400000));
  if (ageDays > 7) return { label: 'Very stale', color: 'var(--red)' };
  if (ageDays > 2) return { label: 'Stale', color: 'var(--yellow)' };
  return { label: null, color: 'var(--text-muted)' };
}

function TooltipRows({ rows }: { rows: Array<{ label: string; value: string; color?: string }> }) {
  return (
    <div className="mt-1 grid gap-1">
      {rows.map(row => (
        <div key={row.label} className="grid grid-cols-[1fr_auto] gap-4 font-mono text-[11px] tabular-nums">
          <span style={{ color: 'var(--text-muted)' }}>{row.label}</span>
          <span className="text-right" style={{ color: row.color ?? 'var(--text)' }}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function HoverTooltip({ children, content, ariaLabel }: { children: ReactNode; content: ReactNode; ariaLabel: string }) {
  const [position, setPosition] = useState<{ left: number; top: number; above: boolean } | null>(null);
  const show = (target: HTMLElement) => {
    const width = 270;
    const height = 190;
    const rect = target.getBoundingClientRect();
    const left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width));
    const belowTop = rect.bottom + 6;
    const above = belowTop + height > window.innerHeight - 12;
    setPosition({ left, top: above ? rect.top - 6 : belowTop, above });
  };

  return (
    <span
      tabIndex={0}
      aria-label={ariaLabel}
      onMouseEnter={event => show(event.currentTarget)}
      onFocus={event => show(event.currentTarget)}
      onMouseLeave={() => setPosition(null)}
      onBlur={() => setPosition(null)}
      className="inline-flex cursor-help items-center border-b border-dotted outline-none focus:ring-2 focus:ring-blue-400/30"
      style={{ borderColor: 'var(--text-dim)' }}
    >
      {children}
      {position && (
        <span
          className="fixed z-[100] w-[270px] rounded-lg px-3 py-2 text-left text-xs shadow-xl"
          style={{
            left: position.left,
            top: position.top,
            transform: position.above ? 'translateY(-100%)' : undefined,
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            color: 'var(--text)',
            boxShadow: 'var(--shadow)',
          }}
        >
          {content}
        </span>
      )}
    </span>
  );
}

function CurrentMarkTooltipContent({ trade, markBasis }: { trade: PortfolioTrade; markBasis: MarkBasis }) {
  const stale = getLastTradeStaleness(trade.latestMarketData?.lastTradeDate);
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text)' }}>Current Mark Details</div>
      <TooltipRows rows={[
        { label: 'Mark Basis', value: formatMarkBasis(markBasis) },
        ...orderedOptionQuoteEntries({
          last: trade.latestMarketData?.optionLast,
          bid: trade.latestMarketData?.optionBid,
          mid: getPortfolioMidMark(trade),
          ask: trade.latestMarketData?.optionAsk,
        }).map(({ label, value }) => ({ label, value: formatOptionPrice(value) })),
        {
          label: 'Last Trade Date',
          value: `${formatFullDate(trade.latestMarketData?.lastTradeDate)}${stale.label ? ` · ${stale.label}` : ''}`,
          color: stale.label ? stale.color : undefined,
        },
      ]} />
    </div>
  );
}

function DteTooltipContent({ trade }: { trade: PortfolioTrade }) {
  const dte = calculateRemainingDte(trade);
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text)' }}>Position Timing</div>
      <TooltipRows rows={[
        { label: 'Expiration', value: formatFullDate(trade.expiration) },
        { label: 'DTE', value: isFiniteNumber(dte) ? formatDays(dte) : DASH },
        { label: 'Written', value: formatFullDate(trade.soldDate) },
        { label: 'Days Since Written', value: formatDaysAgo(trade.soldDate) },
      ]} />
    </div>
  );
}

function formatPctValue(value: number | null | undefined): string {
  return isFiniteNumber(value) ? formatPercent(value) : DASH;
}

function formatDelta(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return DASH;
  return value.toFixed(2);
}

function formatSignedNumber(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return DASH;
  return `${value >= 0 ? '+' : ''}${Math.round(value).toLocaleString('en-US')}`;
}

function pnlColor(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return 'var(--text-dim)';
  return value >= 0 ? 'var(--green)' : 'var(--red)';
}

function percentColor(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return 'var(--text-dim)';
  return value >= 0 ? 'var(--green)' : 'var(--red)';
}

interface PositionHealth {
  label: 'Healthy' | 'Monitor' | 'Elevated' | 'Risky' | 'Threatened' | 'Unknown';
  color: string;
  bg: string;
  border: string;
  title: string;
}

function getPositionHealth(trade: PortfolioTrade): PositionHealth {
  const underlying = trade.latestMarketData?.underlyingPrice ?? trade.entrySnapshot?.underlyingPrice ?? null;
  const breakeven = calculateBreakeven(trade);
  const distanceToStrike = calculateDistanceToStrike(trade);
  const delta = trade.latestMarketData?.delta ?? null;
  const dte = calculateRemainingDte(trade);
  const absDelta = isFiniteNumber(delta) ? Math.abs(delta) : null;
  const triggerContext = [
    isFiniteNumber(distanceToStrike) ? `${formatPctValue(distanceToStrike)} above strike` : null,
    isFiniteNumber(absDelta) ? `${absDelta.toFixed(2)} abs delta` : null,
    isFiniteNumber(dte) ? formatDteValue(dte) : null,
  ].filter(Boolean).join(', ');
  const context = [
    isFiniteNumber(distanceToStrike) ? `${formatPctValue(distanceToStrike)} above strike` : null,
    isFiniteNumber(delta) ? `delta ${formatDelta(delta)}` : null,
    isFiniteNumber(dte) ? formatDteValue(dte) : null,
  ].filter(Boolean).join(', ');
  const level = getPortfolioPositionHealthLevel(trade);

  // Compact health tiers prioritize capital danger first, then distance, delta, and near-expiry pressure.
  if (level === 'Unknown') {
    return {
      label: 'Unknown',
      color: 'var(--text-dim)',
      bg: 'var(--surface-alt)',
      border: 'var(--border)',
      title: `Unknown: missing underlying or breakeven data${context ? ` (${context})` : ''}`,
    };
  }
  if (level === 'Threatened') {
    return {
      label: 'Threatened',
      color: 'var(--red)',
      bg: 'rgba(239,68,68,0.10)',
      border: 'rgba(239,68,68,0.28)',
      title: `Threatened: underlying ${formatCurrency(underlying)} vs breakeven ${formatCurrency(breakeven)}${triggerContext ? ` (${triggerContext})` : ''}`,
    };
  }
  if (level === 'Risky') {
    return {
      label: 'Risky',
      color: 'var(--orange)',
      bg: 'rgba(251,146,60,0.10)',
      border: 'rgba(251,146,60,0.28)',
      title: `Risky: close to strike or high delta${triggerContext ? ` (${triggerContext})` : ''}`,
    };
  }
  if (level === 'Elevated') {
    return {
      label: 'Elevated',
      color: 'var(--orange)',
      bg: 'rgba(251,146,60,0.10)',
      border: 'rgba(251,146,60,0.28)',
      title: `Elevated: closer to strike or delta rising${triggerContext ? ` (${triggerContext})` : ''}`,
    };
  }
  if (level === 'Monitor') {
    return {
      label: 'Monitor',
      color: 'var(--yellow)',
      bg: 'rgba(250,204,21,0.10)',
      border: 'rgba(250,204,21,0.25)',
      title: `Monitor: watch distance, delta, or near-expiry risk${triggerContext ? ` (${triggerContext})` : ''}`,
    };
  }
  return {
    label: 'Healthy',
    color: 'var(--green)',
    bg: 'rgba(34,197,94,0.10)',
    border: 'rgba(34,197,94,0.25)',
    title: `Healthy: comfortably above strike and breakeven${context ? ` (${context})` : ''}`,
  };
}

function expiryLabel(iso: string): string {
  return formatDate(`${iso}T00:00:00`);
}

function weightedAverageValue(items: Array<{ value: number | null | undefined; weight: number | null | undefined }>): number | null {
  const totals = items.reduce((acc, item) => {
    if (!isFiniteNumber(item.value) || !isFiniteNumber(item.weight) || item.weight <= 0) return acc;
    return { weighted: acc.weighted + item.value * item.weight, weight: acc.weight + item.weight };
  }, { weighted: 0, weight: 0 });
  return totals.weight > 0 ? totals.weighted / totals.weight : null;
}

function sumValues(values: Array<number | null | undefined>): number {
  return values.reduce<number>((total, value) => total + (isFiniteNumber(value) ? value : 0), 0);
}

function completeSumValues(values: Array<number | null | undefined>): number | null {
  if (values.length === 0 || values.some(value => !isFiniteNumber(value))) return null;
  return sumValues(values);
}

function SummaryCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg p-2 min-w-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="text-[9px] uppercase tracking-wider mb-0.5 truncate" title={label} style={{ color: 'var(--text-dim)' }}>{label}</div>
      <div className="text-xs xl:text-sm font-mono font-semibold tabular-nums truncate" title={value} style={{ color: color ?? 'var(--text)' }}>{value}</div>
    </div>
  );
}

function MarkBasisToggle({ markBasis, onChange }: { markBasis: MarkBasis; onChange: (basis: MarkBasis) => void }) {
  return (
    <div className="mark-basis-toggle flex items-center gap-1.5 min-w-0 whitespace-nowrap">
      <span className="text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Mark book at</span>
      <div className="inline-flex rounded-lg overflow-hidden w-fit" style={{ border: '1px solid var(--border)' }}>
        {MARK_BASIS_OPTIONS.map((option, index) => (
          <button
            key={option}
            onClick={() => onChange(option)}
            className="px-2.5 py-2 text-xs font-semibold min-w-[48px] sm:min-w-[52px]"
            style={{
              backgroundColor: markBasis === option ? 'var(--accent)' : 'var(--surface-alt)',
              color: markBasis === option ? 'white' : 'var(--text-muted)',
              borderRight: index < MARK_BASIS_OPTIONS.length - 1 ? '1px solid var(--border)' : '0',
            }}
          >
            {option.charAt(0).toUpperCase() + option.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}

function DisplayToggle({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) {
  return (
    <label className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] whitespace-nowrap cursor-pointer" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="h-3.5 w-3.5" />
      {label}
    </label>
  );
}

function formatShortDate(iso: string): string {
  return formatDate(`${iso}T00:00:00`);
}

function formatCompactCurrency(value: number | null | undefined): string {
  return isFiniteNumber(value) ? formatCurrency(value, 0) : DASH;
}

function formatGroupPercentCaptured(group: Pick<PortfolioExposureGroup, 'premiumCollected' | 'totalGainLoss'>): string {
  if (!isFiniteNumber(group.premiumCollected) || group.premiumCollected <= 0 || !isFiniteNumber(group.totalGainLoss)) return DASH;
  return formatPercent(group.totalGainLoss / group.premiumCollected, 1);
}

function formatExposurePercent(value: number, total: number): string {
  return total > 0 ? formatPercent(value / total) : DASH;
}

function CompactExposureBars({
  title,
  groups,
  labelFormatter = value => value,
  emptyLabel,
  onGroupClick,
}: {
  title: string;
  groups: PortfolioExposureGroup[];
  labelFormatter?: (value: string) => string;
  emptyLabel: string;
  onGroupClick?: (group: PortfolioExposureGroup) => void;
}) {
  const max = Math.max(...groups.map(group => group.grossRisk), 0);
  const totalGrossRisk = sumValues(groups.map(group => group.grossRisk));
  return (
    <section className="rounded-lg p-3 min-w-0 h-full flex flex-col" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2 shrink-0">
        <h3 className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{title}</h3>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>{groups.length} buckets</span>
      </div>
      {groups.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>{emptyLabel}</p>
      ) : (
        <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1 min-h-0">
          {groups.map(group => {
            const width = max > 0 ? Math.max(3, (group.grossRisk / max) * 100) : 0;
            const tooltip = [
              `Gross Risk: ${formatCurrency(group.grossRisk, 0)}`,
              `Net Capital: ${formatCurrency(group.netCapitalAtRisk, 0)}`,
              `Premium: ${formatCurrency(group.premiumCollected, 0)}`,
              `Trades: ${group.tradeCount}`,
              `Original AY: ${formatPctValue(group.originalAY)}`,
              `Weighted Avg Delta: ${formatDelta(group.weightedAverageDelta)}`,
              `Current AY: ${formatPctValue(group.currentAY)}`,
              `% Captured: ${formatGroupPercentCaptured(group)}`,
            ].join('\n');
            return (
              <button type="button" key={group.key} title={tooltip} onClick={() => onGroupClick?.(group)} className={`block w-full rounded px-1 py-0.5 text-left ${onGroupClick ? 'cursor-pointer hover:bg-white/5 focus:outline-none focus:ring-1 focus:ring-blue-400/40' : ''}`}>
                <div className="flex items-center justify-between gap-2 text-[12px] leading-none mb-1">
                  <span className="font-medium truncate" style={{ color: 'var(--text)' }}>{labelFormatter(group.label)}</span>
                  <span className="font-mono tabular-nums flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>
                    {formatCompactCurrency(group.grossRisk)} <span style={{ color: 'var(--text-dim)' }}>{formatExposurePercent(group.grossRisk, totalGrossRisk)}</span>
                  </span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--surface-alt)' }}>
                  <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: 'var(--accent)' }} />
                </div>
                <div className="flex justify-between gap-2 mt-1 text-[11px] leading-none" style={{ color: 'var(--text-dim)' }}>
                  <span>{group.tradeCount} trade{group.tradeCount === 1 ? '' : 's'}</span>
                  <span className="truncate tabular-nums">Prem {formatCompactCurrency(group.premiumCollected)} · Captured {formatGroupPercentCaptured(group)} · Δ {formatDelta(group.weightedAverageDelta)} · Cur AY {formatPctValue(group.currentAY)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function NeedsAttentionList({
  items,
  onDetailsClick,
  onNavigate,
}: {
  items: PortfolioTrade[];
  onDetailsClick: (trade: PortfolioTrade) => void;
  onNavigate: (trade: PortfolioTrade) => void;
}) {
  return (
    <section className="rounded-lg p-3 min-w-0 h-full flex flex-col" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2 shrink-0">
        <h3 className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Needs Attention</h3>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>Top {items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>No positions need review.</p>
      ) : (
        <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-1 min-h-0">
          {items.map(trade => {
            const beDistance = getTradeDistanceToBreakeven(trade);
            const strikeDistance = getTradeDistanceToStrike(trade);
            return (
              <div key={trade.id} className="grid grid-cols-[minmax(88px,1fr)_auto] gap-2 rounded px-2 py-1.5" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Link to={`/options/${trade.ticker.trim().toUpperCase()}`} className="font-mono text-[13px] leading-none font-bold truncate underline-offset-2 hover:underline" style={{ color: 'var(--accent-light)' }}>{trade.ticker}</Link>
                    <button onClick={() => onNavigate(trade)} className="font-mono text-[13px] leading-none truncate underline-offset-2 hover:underline" style={{ color: 'var(--text)' }}>{formatCurrency(trade.strike, 0)} Put</button>
                    <button onClick={() => onDetailsClick(trade)} className="rounded px-1 py-0.5 text-[9px]" title="Open option details" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Details</button>
                  </div>
                  <div className="text-[11px] leading-none truncate mt-1" style={{ color: 'var(--text-dim)' }}>{expiryLabel(trade.expiration)} · {formatDteValue(calculateRemainingDte(trade))}</div>
                </div>
                <div className="text-right font-mono text-[11px] leading-none tabular-nums space-y-0.5">
                  <div style={{ color: percentColor(beDistance) }}>BE {formatPctValue(beDistance)}</div>
                  <div style={{ color: percentColor(strikeDistance) }}>Strike {formatPctValue(strikeDistance)}</div>
                  <div style={{ color: 'var(--text-muted)' }}>{formatCompactCurrency(getTradeGrossRisk(trade))}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function CloseCandidatesCard({ candidates, onNavigate }: { candidates: CloseCandidate[]; onNavigate: (trade: PortfolioTrade) => void }) {
  return (
    <section className="rounded-lg p-3 min-w-0 h-full flex flex-col" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-start justify-between gap-2 mb-2 shrink-0">
        <div>
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Close Candidates</h3>
          <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>Potential close/redeploy candidates.</p>
        </div>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>Top {candidates.length}</span>
      </div>
      {candidates.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>No obvious close candidates at the selected mark.</p>
      ) : (
        <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1 min-h-0">
          {candidates.map(candidate => (
            <div key={candidate.trade.id} className="block w-full rounded px-2 py-1.5 text-left" title={candidate.reasons.join(', ')} style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
              <div className="grid grid-cols-[minmax(88px,1fr)_auto_auto] gap-2 items-baseline">
                <Link to={`/options/${candidate.trade.ticker.trim().toUpperCase()}`} className="text-left font-mono text-[13px] leading-none font-bold truncate underline-offset-2 hover:underline" style={{ color: 'var(--accent-light)' }}>{candidate.trade.ticker}</Link>
                <span className="font-mono text-[12px] leading-none tabular-nums" style={{ color: pnlColor(candidate.percentCaptured) }}>{formatPctValue(candidate.percentCaptured)}</span>
                <span className="font-mono text-[12px] leading-none tabular-nums" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(candidate.remainingPremium, 0)}</span>
              </div>
              <button type="button" onClick={() => onNavigate(candidate.trade)} className="grid w-full grid-cols-[minmax(88px,1fr)_auto_auto] gap-2 text-left text-[11px] leading-none mt-1 hover:opacity-80 focus:outline-none" title="Show in Schedule" style={{ color: 'var(--text-dim)' }}>
                <span className="truncate">{expiryLabel(candidate.trade.expiration)} {formatCurrency(candidate.trade.strike, 0)} Put</span>
                <span className="font-mono tabular-nums">{formatPctValue(candidate.currentAnnualizedYield)} AY</span>
                <span className="font-mono tabular-nums">{formatDteValue(candidate.dte)}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ConcentrationBars({
  title,
  groups,
  totalGrossRisk,
  maxItems = 6,
  onGroupClick,
}: {
  title: string;
  groups: PortfolioExposureGroup[];
  totalGrossRisk: number;
  maxItems?: number;
  onGroupClick?: (group: PortfolioExposureGroup) => void;
}) {
  const visible = groups.slice(0, maxItems);
  const max = Math.max(...visible.map(group => group.grossRisk), 0);
  return (
    <section className="rounded-lg p-3 min-w-0 h-full flex flex-col" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2 shrink-0">
        <h3 className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{title}</h3>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>{groups.length} groups</span>
      </div>
      {visible.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>No concentration data.</p>
      ) : (
        <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1 min-h-0">
          {visible.map(group => {
            const width = max > 0 ? Math.max(4, group.grossRisk / max * 100) : 0;
            return (
              <button type="button" key={group.key} title={groupTooltip(group)} onClick={() => onGroupClick?.(group)} className={`block w-full rounded px-1 py-0.5 text-left ${onGroupClick ? 'cursor-pointer hover:bg-white/5 focus:outline-none focus:ring-1 focus:ring-blue-400/40' : ''}`}>
                <div className="flex items-center justify-between gap-2 text-[12px] leading-none mb-1">
                  <span className="font-medium truncate" style={{ color: 'var(--text)' }}>{group.label}</span>
                  <span className="font-mono tabular-nums flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{formatCompactCurrency(group.grossRisk)}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--surface-alt)' }}>
                  <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: 'var(--accent)' }} />
                </div>
                <div className="flex justify-between gap-2 mt-1 text-[11px] leading-none" style={{ color: 'var(--text-dim)' }}>
                  <span>{formatPctValue(percentOfTotal(group.grossRisk, totalGrossRisk))}</span>
                  <span className="truncate tabular-nums">{group.tradeCount} trades · Captured {formatGroupPercentCaptured(group)} · Δ {formatDelta(group.weightedAverageDelta)} · Cur AY {formatPctValue(group.currentAY)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

function buildNeedsAttention(trades: PortfolioTrade[]): PortfolioTrade[] {
  return [...trades].sort((a, b) => attentionScore(b) - attentionScore(a));
}

function attentionScore(trade: PortfolioTrade): number {
  const distanceToBreakeven = getTradeDistanceToBreakeven(trade);
  const distanceToStrike = getTradeDistanceToStrike(trade);
  const dte = calculateRemainingDte(trade);
  const grossRisk = getTradeGrossRisk(trade) ?? 0;
  const delta = trade.latestMarketData?.delta;
  let score = 0;

  if (!isFiniteNumber(distanceToBreakeven)) score += 20;
  else if (distanceToBreakeven < 0) score += 120 + Math.min(60, Math.abs(distanceToBreakeven) * 300);
  else score += Math.max(0, 80 - distanceToBreakeven * 800);

  if (isFiniteNumber(distanceToStrike)) score += distanceToStrike < 0 ? 60 : Math.max(0, 45 - distanceToStrike * 450);
  if (isFiniteNumber(dte)) score += dte <= 0 ? 40 : Math.max(0, 35 - dte);
  if (isFiniteNumber(delta)) score += Math.min(45, Math.abs(delta) * 70);
  score += Math.min(35, grossRisk / 10_000);

  return score;
}

function buildCloseCandidates(trades: PortfolioTrade[], basis: MarkBasis): CloseCandidate[] {
  return trades
    .map(trade => {
      const percentCaptured = calculatePercentCaptured(trade, basis);
      const currentAnnualizedYield = calculateCurrentAnnualizedYield(trade, basis);
      const remainingPremium = calculateCurrentMarkValueAbsolute(trade, basis);
      const currentMark = calculateCurrentOptionMark(trade, basis);
      const dte = calculateRemainingDte(trade);
      const breakevenCushion = getTradeDistanceToBreakeven(trade);
      const reasons: string[] = [];

      if (isFiniteNumber(percentCaptured) && percentCaptured >= 0.75) reasons.push('75%+ captured');
      else if (isFiniteNumber(percentCaptured) && percentCaptured >= 0.50) reasons.push('50%+ captured');
      if (isFiniteNumber(percentCaptured) && percentCaptured >= 0.50 && isFiniteNumber(currentAnnualizedYield) && currentAnnualizedYield < 0.05) reasons.push('low remaining yield');
      if (isFiniteNumber(currentMark) && currentMark <= 0.05) reasons.push('small remaining premium');
      if (isFiniteNumber(dte) && dte <= 14 && isFiniteNumber(breakevenCushion) && breakevenCushion >= 0.20) reasons.push('near expiry with cushion');

      let score = 0;
      if (isFiniteNumber(percentCaptured)) score += percentCaptured * 100;
      if (isFiniteNumber(currentAnnualizedYield)) score += Math.max(0, 20 - currentAnnualizedYield * 200);
      if (isFiniteNumber(currentMark) && currentMark <= 0.05) score += 30;
      if (isFiniteNumber(dte)) score += Math.max(0, 20 - dte);
      if (isFiniteNumber(breakevenCushion)) score += Math.min(20, breakevenCushion * 50);

      return { trade, percentCaptured, currentAnnualizedYield, remainingPremium, dte, score, reasons };
    })
    .filter(candidate => candidate.reasons.length > 0)
    .sort((a, b) => b.score - a.score);
}

function getRedeployBadges(trade: PortfolioTrade, basis: MarkBasis): string[] {
  const percentCaptured = calculatePercentCaptured(trade, basis);
  const currentAnnualizedYield = calculateCurrentAnnualizedYield(trade, basis);
  const dte = calculateRemainingDte(trade);
  const badges: string[] = [];

  if (isFiniteNumber(percentCaptured) && percentCaptured >= 0.75) badges.push('75%+ Captured');
  else if (isFiniteNumber(percentCaptured) && percentCaptured >= 0.50) badges.push('50%+ Captured');
  if (isFiniteNumber(currentAnnualizedYield) && currentAnnualizedYield < 0.05) badges.push('Low Remaining Yield');
  if (isFiniteNumber(dte) && dte <= 14) badges.push('Near Expiry');

  return badges;
}

function percentOfTotal(value: number | null | undefined, total: number | null | undefined): number | null {
  return isFiniteNumber(value) && isFiniteNumber(total) && total > 0 ? value / total : null;
}

function groupTooltip(group: PortfolioExposureGroup): string {
  return [
    `Gross Risk: ${formatCurrency(group.grossRisk, 0)}`,
    `Net Capital: ${formatCurrency(group.netCapitalAtRisk, 0)}`,
    `Premium: ${formatCurrency(group.premiumCollected, 0)}`,
    `Total Gain/Loss: ${formatCurrency(group.totalGainLoss, 0)}`,
    `Delta Exposure: ${formatSignedNumber(group.deltaExposure)}`,
    `Underlying Eq.: ${formatCurrency(group.underlyingEquivalentExposure, 0)}`,
    `Weighted Avg Delta: ${formatDelta(group.weightedAverageDelta)}`,
    `Current AY: ${formatPctValue(group.currentAY)}`,
    `% Captured: ${formatGroupPercentCaptured(group)}`,
    `Trades: ${group.tradeCount}`,
  ].join('\n');
}

function getArchiveOutcomeLabel(trade: PortfolioTrade): string {
  if (trade.status === 'closed') return 'Closed Manually';
  if (trade.status === 'expired_price_pending' || trade.resolutionType === 'expired_price_pending') return 'Expiration Price Pending';
  if (trade.resolutionType === 'expired_itm') return 'Expired ITM / Assignment Likely';
  if (trade.resolutionType === 'expired_worthless' || trade.status === 'expired') return 'Expired Worthless';
  if (trade.status === 'assigned') return 'Assigned';
  return DASH;
}

function getArchiveOutcomeColor(trade: PortfolioTrade): string {
  if (trade.status === 'expired_price_pending' || trade.resolutionType === 'expired_price_pending') return 'var(--yellow)';
  if (trade.resolutionType === 'expired_itm') return 'var(--red)';
  if (trade.resolutionType === 'expired_worthless' || trade.status === 'expired') return 'var(--green)';
  return 'var(--text-muted)';
}

function getTradeDaysHeld(trade: PortfolioTrade): number | null {
  if (isFiniteNumber(trade.daysHeld)) return trade.daysHeld;
  const start = parseDateOnly(trade.soldDate);
  const end = parseDateOnly(trade.closeDate ?? trade.expiration);
  if (!start || !end) return null;
  const startMs = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endMs = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.max(0, Math.round((endMs - startMs) / 86400000));
}

function getArchivedFinalValue(trade: PortfolioTrade): number | null {
  if (isFiniteNumber(trade.finalOptionValue)) return trade.finalOptionValue;
  if (trade.status === 'closed' && isFiniteNumber(trade.closePrice)) return trade.closePrice * trade.contracts * 100;
  return null;
}

function getArchivedPremium(trade: PortfolioTrade): number | null {
  return isFiniteNumber(trade.premiumCollected) ? trade.premiumCollected : calculatePremiumCollected(trade);
}

function getArchivedRealizedPnl(trade: PortfolioTrade): number | null {
  if (isFiniteNumber(trade.realizedPnl)) return trade.realizedPnl;
  if (trade.status !== 'closed' || !isFiniteNumber(trade.closePrice)) return null;
  return (trade.soldPrice - trade.closePrice) * trade.contracts * 100;
}

function getArchivedPercentCaptured(trade: PortfolioTrade): number | null {
  if (isFiniteNumber(trade.percentCaptured)) return trade.percentCaptured;
  const premium = getArchivedPremium(trade);
  const pnl = getArchivedRealizedPnl(trade);
  return isFiniteNumber(premium) && premium > 0 && isFiniteNumber(pnl) ? pnl / premium : null;
}

function buildArchiveSummary(archivedTrades: PortfolioTrade[]) {
  const analytics = buildHistoryAnalytics(archivedTrades);
  return {
    ...analytics,
    archivedTrades: archivedTrades.length,
    avgPercentCaptured: analytics.blendedCapture,
    expiredWorthless: archivedTrades.filter(trade => trade.resolutionType === 'expired_worthless').length,
    expiredItm: archivedTrades.filter(trade => trade.resolutionType === 'expired_itm').length,
  };
}

function parseNumber(value: string): number | null {
  if (value.trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function TradeModal({ trade, onClose, onSave, onDelete }: TradeModalProps) {
  const [ticker, setTicker] = useState(trade?.ticker ?? '');
  const [expiration, setExpiration] = useState(trade?.expiration ?? '');
  const [strike, setStrike] = useState(trade ? String(trade.strike) : '');
  const [contracts, setContracts] = useState(trade ? String(trade.contracts) : '1');
  const [soldPrice, setSoldPrice] = useState(trade ? String(trade.soldPrice) : '');
  const [soldDate, setSoldDate] = useState(trade?.soldDate ?? todayIso());
  const [status, setStatus] = useState<PortfolioTradeStatus>(trade?.status ?? 'open');
  const [notes, setNotes] = useState(trade?.notes ?? '');
  const [closePrice, setClosePrice] = useState(trade?.closePrice != null ? String(trade.closePrice) : '');
  const [closeDate, setCloseDate] = useState(trade?.closeDate ?? todayIso());
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  const parsed = {
    strike: parseNumber(strike),
    contracts: parseNumber(contracts),
    soldPrice: parseNumber(soldPrice),
    closePrice: parseNumber(closePrice),
  };

  const validation = {
    ticker: ticker.trim().length > 0,
    expiration: /^\d{4}-\d{2}-\d{2}$/.test(expiration),
    strike: parsed.strike != null && parsed.strike > 0,
    contracts: parsed.contracts != null && Number.isInteger(parsed.contracts) && parsed.contracts > 0,
    soldPrice: parsed.soldPrice != null && parsed.soldPrice >= 0,
    soldDate: /^\d{4}-\d{2}-\d{2}$/.test(soldDate),
    closePrice: status !== 'closed' || (parsed.closePrice != null && parsed.closePrice >= 0),
    closeDate: status !== 'closed' || /^\d{4}-\d{2}-\d{2}$/.test(closeDate),
  };
  const isValid = Object.values(validation).every(Boolean);

  const previewTrade: PortfolioTrade | null = isValid
    ? {
      id: trade?.id ?? 'preview',
      ticker: ticker.trim().toUpperCase(),
      optionType: 'put',
      strike: parsed.strike as number,
      expiration,
      contracts: parsed.contracts as number,
      soldPrice: parsed.soldPrice as number,
      soldDate,
      status,
      notes,
      closePrice: status === 'closed' ? parsed.closePrice ?? undefined : trade?.closePrice,
      closeDate: status === 'closed' ? closeDate : trade?.closeDate,
      entryVixClose: trade?.soldDate === soldDate ? trade.entryVixClose : undefined,
      entryVixDate: trade?.soldDate === soldDate ? trade.entryVixDate : undefined,
      entryVixSource: trade?.soldDate === soldDate ? trade.entryVixSource : undefined,
      createdAt: trade?.createdAt ?? new Date().toISOString(),
      updatedAt: trade?.updatedAt ?? new Date().toISOString(),
      entrySnapshot: trade?.entrySnapshot,
      latestMarketData: trade?.latestMarketData,
    }
    : null;

  const submit = () => {
    setSubmitted(true);
    if (!isValid) return;
    onSave({
      ticker: ticker.trim().toUpperCase(),
      optionType: 'put',
      strike: parsed.strike as number,
      expiration,
      contracts: parsed.contracts as number,
      soldPrice: parsed.soldPrice as number,
      soldDate,
      status,
      notes,
      closePrice: status === 'closed' ? parsed.closePrice ?? undefined : undefined,
      closeDate: status === 'closed' ? closeDate : undefined,
      entryVixClose: trade?.soldDate === soldDate ? trade.entryVixClose : undefined,
      entryVixDate: trade?.soldDate === soldDate ? trade.entryVixDate : undefined,
      entryVixSource: trade?.soldDate === soldDate ? trade.entryVixSource : undefined,
      entrySnapshot: trade?.entrySnapshot,
      latestMarketData: trade?.latestMarketData,
    }, trade?.id);
  };

  const errorText = (ok: boolean, label: string) => submitted && !ok ? <p className="mt-1 text-[11px]" style={{ color: 'var(--red)' }}>{label}</p> : null;
  const inputClass = 'w-full rounded-lg px-3 py-2 text-base sm:text-sm outline-none min-h-[44px]';

  return (
    <div className="fixed inset-0 z-[80]">
      <button type="button" aria-label="Close add trade modal" onClick={onClose} className="absolute inset-0 bg-black/55" />
      <div className="portfolio-trade-sheet absolute inset-x-0 bottom-0 max-h-[96dvh] rounded-t-2xl overflow-y-auto p-3 sm:inset-x-1/2 sm:top-8 sm:bottom-8 sm:max-h-none sm:w-[720px] sm:-translate-x-1/2 sm:rounded-lg sm:p-5 shadow-2xl" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
        <div className="mx-auto mb-2 h-1 w-10 rounded-full sm:hidden" aria-hidden="true" style={{ backgroundColor: 'var(--border-strong)' }} />
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text)' }}>{trade ? 'Edit Sold Put' : 'Add Sold Put'}</h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Manual cash-secured put tracking. Data stays in this browser.</p>
          </div>
          <button onClick={onClose} className="px-3 py-2 rounded-lg text-xs min-h-[40px]" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Cancel</button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label>
            <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Ticker</span>
            <input value={ticker} onChange={event => setTicker(event.target.value.toUpperCase())} className={`${inputClass} font-mono`} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            {errorText(validation.ticker, 'Ticker is required.')}
          </label>
          <label>
            <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Expiration</span>
            <input type="date" value={expiration} onChange={event => setExpiration(event.target.value)} className={inputClass} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            {errorText(validation.expiration, 'Expiration is required.')}
          </label>
          <label>
            <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Strike</span>
            <input value={strike} inputMode="decimal" onChange={event => setStrike(event.target.value)} onBlur={() => parsed.strike != null && parsed.strike > 0 ? setStrike(String(parsed.strike)) : undefined} className={`${inputClass} font-mono`} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            {errorText(validation.strike, 'Strike must be greater than 0.')}
          </label>
          <label>
            <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Contracts</span>
            <input value={contracts} inputMode="numeric" onChange={event => /^\d*$/.test(event.target.value) && setContracts(event.target.value)} onBlur={() => validation.contracts ? setContracts(String(parsed.contracts)) : undefined} className={`${inputClass} font-mono`} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            {errorText(validation.contracts, 'Contracts must be a positive whole number.')}
          </label>
          <label>
            <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Sold Price</span>
            <input value={soldPrice} inputMode="decimal" onChange={event => setSoldPrice(event.target.value)} onBlur={() => parsed.soldPrice != null && parsed.soldPrice >= 0 ? setSoldPrice(String(parsed.soldPrice)) : undefined} className={`${inputClass} font-mono`} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            {errorText(validation.soldPrice, 'Sold price must be 0 or more.')}
          </label>
          <label>
            <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Sold Date</span>
            <input type="date" value={soldDate} onChange={event => setSoldDate(event.target.value)} className={inputClass} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
            {errorText(validation.soldDate, 'Sold date is required.')}
          </label>
          <label>
            <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Status</span>
            <select value={status} onChange={event => setStatus(event.target.value as PortfolioTradeStatus)} className={inputClass} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }}>
              <option value="open">Open</option>
              <option value="closed">Closed</option>
              <option value="expired">Expired</option>
              <option value="expired_price_pending">Expiration Price Pending</option>
              <option value="assigned">Assigned</option>
            </select>
          </label>
          {status === 'closed' && (
            <>
              <label>
                <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Close Price</span>
                <input value={closePrice} inputMode="decimal" onChange={event => setClosePrice(event.target.value)} className={`${inputClass} font-mono`} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
                {errorText(validation.closePrice, 'Close price must be 0 or more.')}
              </label>
              <label>
                <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Close Date</span>
                <input type="date" value={closeDate} onChange={event => setCloseDate(event.target.value)} className={inputClass} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
                {errorText(validation.closeDate, 'Close date is required.')}
              </label>
            </>
          )}
          <label className="sm:col-span-2">
            <span className="block text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Notes</span>
            <textarea value={notes} onChange={event => setNotes(event.target.value)} rows={3} className={`${inputClass} resize-y`} style={{ backgroundColor: 'var(--input-bg)', border: '1px solid var(--border)', color: 'var(--text)' }} />
          </label>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-2 mt-4">
          <SummaryCard label="Premium" value={previewTrade ? formatCurrency(calculatePremiumCollected(previewTrade), 0) : DASH} color="var(--green)" />
          <SummaryCard label="Equity Risk" value={previewTrade ? formatCurrency(calculateEquityAtRisk(previewTrade), 0) : DASH} />
          <SummaryCard label="Net Risk" value={previewTrade ? formatCurrency(calculateNetCapitalAtRisk(previewTrade), 0) : DASH} />
          <SummaryCard label="Breakeven" value={previewTrade ? formatCurrency(calculateBreakeven(previewTrade)) : DASH} />
          <SummaryCard label="Original DTE" value={previewTrade ? formatDteValue(calculateOriginalDte(previewTrade)) : DASH} />
          <SummaryCard label="Orig. Ann. Yield" value={previewTrade ? formatPctValue(calculateOriginalAnnualizedYield(previewTrade)) : DASH} />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mt-5">
          {trade ? (
            <button onClick={() => onDelete(trade.id)} className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs min-h-[44px]" style={{ backgroundColor: 'rgba(239,68,68,0.12)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.28)' }}>
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-xs min-h-[44px]" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>Cancel</button>
            <button onClick={submit} className="px-4 py-2 rounded-lg text-xs font-medium text-white min-h-[44px]" style={{ backgroundColor: 'var(--accent)' }}>{trade ? 'Save Changes' : 'Save Trade'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PortfolioPage() {
  const { isPhone } = useResponsiveMode();
  const [trades, setTrades] = useState<PortfolioTrade[]>([]);
  const [editingTrade, setEditingTrade] = useState<PortfolioTrade | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [showDataBackup, setShowDataBackup] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [durableActivityNotice, setDurableActivityNotice] = useState('');
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [drawerSelection, setDrawerSelection] = useState<DrawerSelection | null>(null);
  const [markBasis, setMarkBasis] = useState<MarkBasis>(readPortfolioMarkBasis);
  const [showNominalYield, setShowNominalYield] = useState(readShowNominalYield);
  const [showNotesErrors, setShowNotesErrors] = useState(false);
  const [showOpenInterestVolume, setShowOpenInterestVolume] = useState(false);
  const [sortField, setSortField] = useState<PortfolioScheduleSortField>('expiration');
  const [sortDir, setSortDir] = useState<PortfolioScheduleSortDirection>('asc');
  const [groupMode, setGroupMode] = useState<PortfolioGroupMode>(readPortfolioGroupMode);
  const [collapsedExpiryGroups, setCollapsedExpiryGroups] = useState<Record<string, boolean>>(readCollapsedExpirationGroups);
  const [collapsedUnderlyingGroups, setCollapsedUnderlyingGroups] = useState<Record<string, boolean>>(readCollapsedUnderlyingGroups);
  const [resolvingArchiveIds, setResolvingArchiveIds] = useState<Set<string>>(() => new Set());
  const [activeScheduleTicker, setActiveScheduleTicker] = useState<string | null>(null);
  const [highlightedExpiration, setHighlightedExpiration] = useState<string | null>(null);
  const [highlightedTradeId, setHighlightedTradeId] = useState<string | null>(null);
  const [mobileAnalytics, setMobileAnalytics] = useState<'maturity' | 'ticker' | 'attention' | 'close'>('maturity');
  const [analyticsExpanded, setAnalyticsExpanded] = useState(false);
  const [mobileActionsOpen, setMobileActionsOpen] = useState(false);
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);
  const scheduleRef = useRef<HTMLDivElement | null>(null);
  const highlightTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    const stored = loadPortfolioTrades();
    setTrades(stored);
    const latest = Math.max(...stored.map(trade => trade.latestMarketData?.refreshedAt ? new Date(trade.latestMarketData.refreshedAt).getTime() : 0));
    if (latest > 0) setLastRefreshed(new Date(latest));
    void (async () => {
      const archived = await archiveExpiredOpenTrades(stored);
      if (!active) return;
      if (archived.changed) {
        savePortfolioTrades(archived.trades);
        setDurableActivityNotice('Expired positions were durably moved into lifecycle history. Review Account Sync before enrollment.');
      }
      setTrades(archived.trades);
    })();
    return () => {
      active = false;
    };
  }, []);

  const summary = useMemo(() => calculatePortfolioSummary(trades), [trades]);
  const openTrades = useMemo(() => trades.filter(trade => trade.status === 'open'), [trades]);
  const archivedTrades = useMemo(() => trades.filter(isArchivedTrade).sort((a, b) => b.expiration.localeCompare(a.expiration)), [trades]);
  const archiveSummary = useMemo(() => buildArchiveSummary(archivedTrades), [archivedTrades]);
  const markSummary = useMemo(() => calculatePortfolioMarkSummary(openTrades, markBasis), [openTrades, markBasis]);

  const scheduleTotals = useMemo(() => buildScheduleTotals(openTrades, markBasis), [openTrades, markBasis]);

  useEffect(() => {
    persistPortfolioMarkBasis(markBasis);
  }, [markBasis]);

  useEffect(() => {
    persistCollapsedExpirationGroups(collapsedExpiryGroups);
  }, [collapsedExpiryGroups]);

  useEffect(() => {
    persistCollapsedUnderlyingGroups(collapsedUnderlyingGroups);
  }, [collapsedUnderlyingGroups]);

  useEffect(() => {
    persistPortfolioGroupMode(groupMode);
  }, [groupMode]);

  useEffect(() => () => {
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
  }, []);

  const expirationGroups = useMemo(() => {
    const groups = buildExpirationScheduleGroups(openTrades, markBasis);
    return sortExpirationPortfolioScheduleGroups(groups, sortField, sortDir, markBasis);
  }, [openTrades, sortField, sortDir, markBasis]);

  const underlyingGroups = useMemo(() => sortUnderlyingPortfolioScheduleGroups(
    buildUnderlyingScheduleGroups(openTrades, markBasis), sortField, sortDir, markBasis
  ), [openTrades, sortField, sortDir, markBasis]);

  const flatScheduleTrades = useMemo(() => sortFlatPortfolioSchedule(
    buildFlatScheduleTrades(openTrades), sortField, sortDir, markBasis
  ), [openTrades, sortField, sortDir, markBasis]);
  const scheduleGroups = useMemo<PortfolioScheduleGroup[]>(() => (
    groupMode === 'expiration' ? expirationGroups : groupMode === 'underlying' ? underlyingGroups : []
  ), [expirationGroups, groupMode, underlyingGroups]);
  const desktopScheduleSections: Array<PortfolioScheduleGroup | { flat: true; trades: PortfolioTrade[] }> = groupMode === 'none'
    ? [{ flat: true, trades: flatScheduleTrades }]
    : scheduleGroups;
  const activeCollapsedGroups = groupMode === 'expiration' ? collapsedExpiryGroups : groupMode === 'underlying' ? collapsedUnderlyingGroups : {};
  const allScheduleGroupsCollapsed = groupMode !== 'none' && scheduleGroups.length > 0
    && scheduleGroups.every(group => activeCollapsedGroups[scheduleGroupKey(group)] === true);

  const toggleExpiryGroup = useCallback((expiration: string) => {
    setCollapsedExpiryGroups(current => toggleCollapsedExpirationGroup(current, expiration));
  }, []);

  const toggleScheduleGroup = useCallback((key: string) => {
    if (groupMode === 'expiration') setCollapsedExpiryGroups(current => toggleCollapsedExpirationGroup(current, key));
    else if (groupMode === 'underlying') setCollapsedUnderlyingGroups(current => toggleCollapsedExpirationGroup(current, key));
  }, [groupMode]);

  const toggleAllScheduleGroups = useCallback(() => {
    if (groupMode === 'none') return;
    const next = setAllExpirationGroupsCollapsed(scheduleGroups.map(scheduleGroupKey), !allScheduleGroupsCollapsed);
    if (groupMode === 'expiration') setCollapsedExpiryGroups(next);
    else setCollapsedUnderlyingGroups(next);
  }, [scheduleGroups, allScheduleGroupsCollapsed, groupMode]);

  const scrollToSchedule = useCallback((selector?: string) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const target = selector
        ? [...document.querySelectorAll<HTMLElement>(selector)].find(element => element.offsetParent !== null) ?? scheduleRef.current
        : scheduleRef.current;
      target?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }));
  }, []);

  const startTransientHighlight = useCallback((kind: 'expiration' | 'trade', value: string) => {
    if (highlightTimerRef.current) window.clearTimeout(highlightTimerRef.current);
    if (kind === 'expiration') setHighlightedExpiration(value);
    else setHighlightedTradeId(value);
    highlightTimerRef.current = window.setTimeout(() => {
      setHighlightedExpiration(null);
      setHighlightedTradeId(null);
    }, 2000);
  }, []);

  const drillToExpiration = useCallback((group: PortfolioExposureGroup) => {
    setGroupMode('expiration');
    setActiveScheduleTicker(null);
    setHighlightedTradeId(null);
    setCollapsedExpiryGroups(current => ({ ...current, [group.key]: false }));
    startTransientHighlight('expiration', group.key);
    scrollToSchedule(`[data-expiration="${group.key}"]`);
  }, [scrollToSchedule, startTransientHighlight]);

  const drillToTicker = useCallback((group: PortfolioExposureGroup) => {
    const ticker = group.key.trim().toUpperCase();
    setGroupMode('underlying');
    setActiveScheduleTicker(ticker);
    setHighlightedExpiration(null);
    setHighlightedTradeId(null);
    setCollapsedUnderlyingGroups(current => ({ ...current, [ticker]: false }));
    scrollToSchedule(`[data-group-key="${ticker}"]`);
  }, [scrollToSchedule]);

  const drillToTrade = useCallback((trade: PortfolioTrade) => {
    setActiveScheduleTicker(null);
    setHighlightedExpiration(null);
    if (groupMode === 'expiration') setCollapsedExpiryGroups(current => ({ ...current, [trade.expiration]: false }));
    else if (groupMode === 'underlying') setCollapsedUnderlyingGroups(current => ({ ...current, [trade.ticker.trim().toUpperCase()]: false }));
    startTransientHighlight('trade', trade.id);
    scrollToSchedule(`[data-trade-id="${trade.id}"]`);
  }, [groupMode, scrollToSchedule, startTransientHighlight]);

  const persistTrades = useCallback((next: PortfolioTrade[]) => {
    savePortfolioTrades(next);
    setTrades(next);
  }, []);

  const handleShowNominalYieldChange = useCallback((value: boolean) => {
    setShowNominalYield(value);
    persistShowNominalYield(value);
  }, []);

  const handleSaveTrade = useCallback(async (input: PortfolioTradeInput, id?: string) => {
    const next = id ? updatePortfolioTrade(id, input as Partial<PortfolioTrade>) : addPortfolioTrade(input);
    const archived = await archiveExpiredOpenTrades(next);
    if (archived.changed) savePortfolioTrades(archived.trades);
    setTrades(archived.trades);
    setShowAddModal(false);
    setEditingTrade(null);
  }, []);

  const handleBackupImported = useCallback(() => {
    setTrades(loadPortfolioTrades());
    setMarkBasis(readPortfolioMarkBasis());
    setGroupMode(readPortfolioGroupMode());
    setCollapsedExpiryGroups(readCollapsedExpirationGroups());
    setCollapsedUnderlyingGroups(readCollapsedUnderlyingGroups());
  }, []);

  const handleDeleteTrade = useCallback((id: string) => {
    const next = deletePortfolioTrade(id);
    setTrades(next);
    setEditingTrade(null);
  }, []);

  const handleRefreshOpenTrades = useCallback(async () => {
    setRefreshing(true);
    setRefreshWarning(false);
    setDurableActivityNotice('');
    const current = loadPortfolioTrades();
    const archived = await archiveExpiredOpenTrades(current);
    const withEntryVix = await resolvePortfolioEntryVix(archived.trades).catch(() => ({
      trades: archived.trades,
      changed: false,
      networkRequests: 0,
      resolved: 0,
      unresolved: 0,
    }));
    if (archived.changed || withEntryVix.changed) savePortfolioTrades(withEntryVix.trades);
    const durableMessages = [
      archived.changed ? 'Expired positions were durably moved into lifecycle history.' : '',
      withEntryVix.resolved > 0
        ? `Entry VIX history was durably enriched for ${withEntryVix.resolved} ${withEntryVix.resolved === 1 ? 'position' : 'positions'}.`
        : '',
    ].filter(Boolean);
    if (durableMessages.length > 0) {
      setDurableActivityNotice(`${durableMessages.join(' ')} This was more than a quote-only refresh.`);
    }
    const sweepTrades = withEntryVix.trades;
    const open = sweepTrades.filter(trade => trade.status === 'open');
    setTrades(sweepTrades);
    if (open.length === 0) {
      setLastRefreshed(new Date());
      setRefreshing(false);
      return;
    }

    const nowIso = new Date().toISOString();
    const tickers = [...new Set(open.map(trade => trade.ticker))];
    const batchPriceResult = await fetchBatchPricesResult(tickers, { mode: 'revalidate' }).catch(() => null);
    const batchPrices = batchPriceResult?.data ?? null;
    if (batchPriceResult?.staleFallbackUsed) setRefreshWarning(true);
    const requestItems = open.map(trade => {
      const timestamp = isoToUnixSeconds(trade.expiration);
      return timestamp == null ? null : { ticker: trade.ticker, expirationTimestamp: timestamp };
    }).filter((item): item is { ticker: string; expirationTimestamp: number } => item != null);
    const acquired = await acquireOptionChains<OptionsChainData>(requestItems, {
      source: 'Portfolio:refreshOpenTrades',
      limit: 3,
      fetchChain: (ticker, timestamp) => fetchOptions(ticker, timestamp, { source: 'Portfolio:refreshOpenTrades', refreshMode: 'revalidate' }),
    });
    const optionsByKey = acquired.byKey;
    const failedKeys = new Set(acquired.failedKeys);
    acquired.byKey.forEach((data, key) => {
      if (data?.chainMeta?.staleFallbackUsed) failedKeys.add(key);
    });

    const refreshed = sweepTrades.map(trade => {
      if (trade.status !== 'open') return trade;
      const remainingDte = calculateDte(trade.expiration);
      if (isFiniteNumber(remainingDte) && remainingDte < 0) {
        return applyTransientPortfolioMarketData(trade, {
          dte: remainingDte,
          refreshedAt: nowIso,
          availabilityStatus: 'expired',
        });
      }

      const timestamp = isoToUnixSeconds(trade.expiration);
      const key = timestamp == null ? '' : canonicalOptionChainKey(trade.ticker, timestamp);
      const optData = optionsByKey.get(key) ?? null;
      const failed = failedKeys.has(key);
      const underlying = batchPrices?.[trade.ticker]?.price ?? optData?.currentPrice ?? trade.latestMarketData?.underlyingPrice ?? trade.entrySnapshot?.underlyingPrice ?? null;

      if (failed || !optData) {
        setRefreshWarning(true);
        return applyTransientPortfolioMarketData(trade, {
          underlyingPrice: underlying,
          dte: remainingDte,
          refreshedAt: nowIso,
          availabilityStatus: 'refresh_failed',
        });
      }

      const put = optData.puts.find(candidate => Math.abs(candidate.strike - trade.strike) < 0.01);
      if (!put) {
        setRefreshWarning(true);
        return applyTransientPortfolioMarketData(trade, {
          underlyingPrice: underlying,
          dte: remainingDte,
          refreshedAt: nowIso,
          availabilityStatus: 'unavailable',
        });
      }

      let delta = put.delta;
      const iv = put.impliedVolatility ?? null;
      if ((!isFiniteNumber(delta) || delta === 0) && isFiniteNumber(underlying) && underlying > 0 && isFiniteNumber(remainingDte) && remainingDte > 0) {
        const sigma = isFiniteNumber(iv) && iv > 0 ? iv / 100 : 0.8;
        delta = calculatePutDelta(underlying, trade.strike, remainingDte / 365, 0.045, sigma);
      }
      if (isFiniteNumber(delta) && delta > 0) delta = -delta;

      const bid = put.bid ?? null;
      const ask = put.ask ?? null;
      const mid = isFiniteNumber(bid) && isFiniteNumber(ask) && ask >= bid ? (bid + ask) / 2 : null;
      return applyTransientPortfolioMarketData(trade, {
        underlyingPrice: underlying,
        optionBid: bid,
        optionAsk: ask,
        optionMid: mid,
        optionLast: put.last ?? null,
        lastTradeDate: put.lastTradeDate ?? null,
        iv,
        delta,
        volume: put.volume ?? null,
        openInterest: put.openInterest ?? null,
        dte: remainingDte,
        refreshedAt: nowIso,
        availabilityStatus: 'live',
      }, 'replace');
    });

    persistTrades(refreshed);
    setLastRefreshed(new Date());
    setRefreshing(false);
  }, [persistTrades]);

  const handleRetryResolve = useCallback(async (trade: PortfolioTrade) => {
    setResolvingArchiveIds(previous => new Set(previous).add(trade.id));
    try {
      const result = await getExpirationClosePrice(trade.ticker, trade.expiration, { forceRefresh: true }).catch(() => null);
      const next = loadPortfolioTrades().map(current => {
        if (current.id !== trade.id) return current;
        return result
          ? resolveExpiredTradeWithClose(current, result.closePrice, result.closeDate, 'expiration_close', result.warning)
          : {
            ...current,
            status: 'expired_price_pending' as const,
            resolutionType: 'expired_price_pending' as const,
            resolutionWarning: 'Expiration close unavailable',
            updatedAt: new Date().toISOString(),
          };
      });
      persistTrades(next);
    } finally {
      setResolvingArchiveIds(previous => {
        const next = new Set(previous);
        next.delete(trade.id);
        return next;
      });
    }
  }, [persistTrades]);

  const handleManualExpirationClose = useCallback((trade: PortfolioTrade) => {
    if (trade.status === 'closed') return;
    const raw = window.prompt(`Set ${trade.ticker} expiration close for ${formatFullDate(trade.expiration)}`, trade.expirationClosePrice != null ? String(trade.expirationClosePrice) : '');
    if (raw == null) return;
    const close = parseNumber(raw.replace(/[$,]/g, ''));
    if (!isFiniteNumber(close) || close < 0) {
      window.alert('Enter a valid non-negative expiration close.');
      return;
    }
    const next = loadPortfolioTrades().map(current => current.id === trade.id
      ? resolveExpiredTradeWithClose(current, close, trade.expiration, 'manual_expiration_close')
      : current);
    persistTrades(next);
  }, [persistTrades]);

  const openDrawer = useCallback((trade: PortfolioTrade) => {
    const underlying = trade.latestMarketData?.underlyingPrice ?? trade.entrySnapshot?.underlyingPrice ?? null;
    const dte = calculateRemainingDte(trade);
    const moneyness = calculateMoneyness(underlying, trade.strike);
    const bid = trade.latestMarketData?.optionBid ?? trade.entrySnapshot?.bid ?? null;
    const ask = trade.latestMarketData?.optionAsk ?? trade.entrySnapshot?.ask ?? null;
    const last = trade.latestMarketData?.optionLast ?? trade.entrySnapshot?.last ?? null;
    const bidYield = calculateYieldPercent(bid, trade.strike, dte);
    const askYield = calculateYieldPercent(ask, trade.strike, dte);
    const lastYield = calculateYieldPercent(last, trade.strike, dte);
    setDrawerSelection({
      ticker: trade.ticker,
      expirationLabel: expiryLabel(trade.expiration),
      dte,
      underlyingPrice: underlying,
      option: {
        strike: trade.strike,
        last,
        lastTradeDate: typeof trade.latestMarketData?.lastTradeDate === 'number' ? trade.latestMarketData.lastTradeDate : null,
        bid,
        ask,
        delta: trade.latestMarketData?.delta ?? trade.entrySnapshot?.delta ?? null,
        impliedVolatility: trade.latestMarketData?.iv ?? trade.entrySnapshot?.iv ?? null,
        volume: trade.latestMarketData?.volume ?? null,
        openInterest: trade.latestMarketData?.openInterest ?? null,
        volOI: null,
        nomYieldBid: bidYield.nominal,
        annYieldBid: bidYield.annualized,
        nomYieldAsk: askYield.nominal,
        annYieldAsk: askYield.annualized,
        nomYieldLast: lastYield.nominal,
        annYieldLast: lastYield.annualized,
        otmItmPct: moneyness.pct,
        otmItmLabel: moneyness.label,
        otmItmColor: moneyness.color,
      },
    });
  }, []);

  const sortButton = (field: PortfolioScheduleSortField, label: string, align = 'text-right', title?: string) => {
    const active = sortField === field;
    const nextDirection = active && sortDir === 'asc' ? 'descending' : 'ascending';
    return (
    <th scope="col" aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'} className={`px-2 py-2 text-[11px] font-medium whitespace-nowrap ${align}`} style={{ color: 'var(--text-muted)' }}>
      <button type="button" title={title} aria-label={`${label}, ${active ? `sorted ${sortDir === 'asc' ? 'ascending' : 'descending'}` : 'not sorted'}. Activate to sort ${nextDirection}.`} onClick={() => {
        if (sortField === field) setSortDir(dir => dir === 'asc' ? 'desc' : 'asc');
        else {
          setSortField(field);
          setSortDir('asc');
        }
      }} className={`inline-flex items-center gap-1 hover:opacity-80 ${align === 'text-left' ? '' : 'justify-end'}`}>
        <span>{label}</span><span aria-hidden="true" style={{ color: active ? 'var(--accent)' : 'var(--text-dim)' }}>{active ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}</span>
      </button>
    </th>
    );
  };

  const renderMobileScheduleTrade = (trade: PortfolioTrade) => <MobilePositionRow key={trade.id} ticker={trade.ticker} strike={formatCurrency(trade.strike)} contracts={trade.contracts} expiration={formatDteValue(calculateRemainingDte(trade))} pnl={formatCurrency(calculateTotalGainLoss(trade, markBasis), 0)} captured={formatPctValue(calculatePercentCaptured(trade, markBasis))} mark={formatOptionPrice(calculateCurrentOptionMark(trade, markBasis))} delta={formatDelta(trade.latestMarketData?.delta)} distance={formatPctValue(calculateDistanceToStrike(trade))} entryVix={isFiniteNumber(trade.entryVixClose) ? trade.entryVixClose.toFixed(2) : DASH} health={getPositionHealth(trade)} onOpen={() => openDrawer(trade)} onEdit={() => setEditingTrade(trade)} />;

  if (isPhone) {
    return (
      <div className="mobile-route-page min-h-[100dvh]" style={{ backgroundColor: 'var(--bg)' }}>
        {trades.length === 0 ? <div className="px-6 py-16 text-center"><Briefcase className="mx-auto mb-3 h-7 w-7" style={{ color: 'var(--text-dim)' }} /><p className="text-sm font-semibold" style={{ color: 'var(--text)' }}>No open positions</p><p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>Add a trade or import a brokerage screenshot.</p><div className="mx-auto mt-4 grid max-w-xs grid-cols-2 gap-2"><button type="button" onClick={() => setShowAddModal(true)} className="mobile-sheet-action primary"><Plus className="h-4 w-4" /> Add Trade</button><button type="button" onClick={() => setShowImportModal(true)} className="mobile-sheet-action secondary"><FileImage className="h-4 w-4" /> Import</button></div><button type="button" onClick={() => setShowDataBackup(true)} className="pressable mt-3 inline-flex min-h-11 items-center gap-2 rounded-lg px-3 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}><Download className="h-4 w-4" /> Data Backup</button></div> : (
          <>
            <section className="mobile-portfolio-hero px-4 pb-3 pt-3" style={{ backgroundColor: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
              <div className="flex items-start justify-between gap-3">
                <div><div className="text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: 'var(--text-dim)' }}>Total gain / loss</div><div className="mt-0.5 font-mono text-[28px] font-bold tracking-tight tabular-nums" style={{ color: pnlColor(markSummary.totalGainLoss) }}>{formatCurrency(markSummary.totalGainLoss, 0)}</div><div className="font-mono text-[13px] font-semibold" style={{ color: pnlColor(markSummary.percentCaptured) }}>{formatPctValue(markSummary.percentCaptured)} captured</div></div>
                <button type="button" onClick={() => setMobileActionsOpen(true)} className="pressable flex h-11 w-11 items-center justify-center rounded-full" aria-label="Portfolio actions" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-alt)' }}><MoreHorizontal className="h-5 w-5" /></button>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2 border-t pt-3" style={{ borderColor: 'var(--border)' }}>
                {[
                  ['Gross Risk', formatCurrency(summary.totalEquityAtRisk, 0)],
                  ['Net Capital', formatCurrency(summary.totalNetCapitalAtRisk, 0)],
                  ['Current AY', formatPctValue(markSummary.portfolioCurrentAnnualizedYield)],
                  ['Weighted Δ', formatDelta(markSummary.weightedAverageDelta)],
                ].map(([label, value]) => <div key={label} className="min-w-0"><div className="truncate text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>{label}</div><div className="truncate font-mono text-[12px] font-semibold tabular-nums" style={{ color: 'var(--text)' }}>{value}</div></div>)}
              </div>
              <div className="mt-3 flex items-center gap-3"><span className="flex-none text-[12px] font-semibold" style={{ color: 'var(--text-muted)' }}>Mark at</span><div className="min-w-0 flex-1"><MobileSegmentedControl value={markBasis} onChange={setMarkBasis} label="Portfolio mark basis" options={MARK_BASIS_OPTIONS.map(value => ({ value, label: value.charAt(0).toUpperCase() + value.slice(1) }))} /></div></div>
              <DataFreshness updatedAt={lastRefreshed} status={refreshing ? 'updating' : refreshWarning ? 'failed' : lastRefreshed ? 'cached' : 'stale'} label="Portfolio marks" />
              {durableActivityNotice && <p role="status" className="mt-2 text-[11px] leading-4" style={{ color: 'var(--yellow)' }}>{durableActivityNotice}</p>}
            </section>

            <div ref={scheduleRef} className="border-b px-3.5 py-2" style={{ borderColor: 'var(--border)' }}>
              <div className="mb-2 flex items-center justify-between"><h2 className="text-[16px] font-semibold" style={{ color: 'var(--text)' }}>Open Positions</h2><span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{openTrades.length} trades</span></div>
              <div className="flex items-center gap-2"><span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Group</span><div className="min-w-0 flex-1"><MobileSegmentedControl value={groupMode} onChange={setGroupMode} label="Group portfolio positions" options={[{ value: 'expiration', label: 'Expiry' }, { value: 'underlying', label: 'Underlying' }, { value: 'none', label: 'None' }]} /></div></div>
              <div className="mt-2 flex items-center gap-2">
                <label htmlFor="mobile-portfolio-sort" className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Sort</label>
                <select id="mobile-portfolio-sort" value={sortField} onChange={event => setSortField(event.target.value as PortfolioScheduleSortField)} className="mobile-control-field min-w-0 flex-1">
                  {PORTFOLIO_SCHEDULE_SORT_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
                <button type="button" onClick={() => setSortDir(direction => direction === 'asc' ? 'desc' : 'asc')} className="pressable mobile-control-button min-w-11 px-3" aria-label={`Sort ${sortDir === 'asc' ? 'ascending; activate for descending' : 'descending; activate for ascending'}`} title={sortDir === 'asc' ? 'Ascending' : 'Descending'}>{sortDir === 'asc' ? '↑' : '↓'}</button>
              </div>
            </div>
            {openTrades.length === 0 ? <div className="px-4 py-10 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No open positions.</div> : groupMode === 'none' ? <div className="space-y-2 px-2 py-2">{flatScheduleTrades.map(renderMobileScheduleTrade)}</div> : <div className="space-y-2 px-2 py-2">{scheduleGroups.map(group => {
              const key = scheduleGroupKey(group);
              const expanded = activeCollapsedGroups[key] !== true;
              const captured = group.premiumCollected > 0 && group.totalGainLoss != null ? group.totalGainLoss / group.premiumCollected : null;
              return <MobileExpirationGroup key={key} label={scheduleGroupLabel(group)} dte={groupMode === 'underlying' && 'expirationCount' in group ? `${group.expirationCount} ${group.expirationCount === 1 ? 'expiry' : 'expiries'}` : scheduleGroupDte(group)} positions={group.tradeCount} contracts={group.contractCount} risk={formatCurrency(group.grossRisk, 0)} pnl={formatCurrency(group.totalGainLoss, 0)} captured={formatPctValue(captured)} expanded={expanded} onToggle={() => toggleScheduleGroup(key)}>{group.trades.map(renderMobileScheduleTrade)}</MobileExpirationGroup>;
            })}</div>}

            {openTrades.length > 0 && <section className="border-t px-3.5 py-2" style={{ borderColor: 'var(--border)' }}><button type="button" onClick={() => setAnalyticsExpanded(expanded => !expanded)} aria-expanded={analyticsExpanded} aria-controls="portfolio-analytics-content" className="pressable flex min-h-11 w-full items-center justify-between text-left"><h2 className="text-[16px] font-semibold" style={{ color: 'var(--text)' }}>Portfolio Analytics</h2><ChevronDown className={`h-4 w-4 transition-transform ${analyticsExpanded ? 'rotate-180' : ''}`} style={{ color: 'var(--text-muted)' }} aria-hidden="true" /></button><div id="portfolio-analytics-content">{analyticsExpanded && <div className="pb-2"><MobileSegmentedControl value={mobileAnalytics} onChange={setMobileAnalytics} label="Portfolio analytics" options={[{ value: 'maturity', label: 'Maturity' }, { value: 'ticker', label: 'Exposure' }, { value: 'attention', label: 'Attention' }, { value: 'close', label: 'Close' }]} /><div className="mt-2">{mobileAnalytics === 'maturity' && <CompactExposureBars title="Maturity Wall" groups={groupByExpiration(openTrades, markBasis)} labelFormatter={formatShortDate} emptyLabel="No maturities." onGroupClick={drillToExpiration} />}{mobileAnalytics === 'ticker' && <ConcentrationBars title="Exposure by Ticker" groups={groupByTicker(openTrades, markBasis)} totalGrossRisk={sumValues(openTrades.map(calculateEquityAtRisk))} maxItems={8} onGroupClick={drillToTicker} />}{mobileAnalytics === 'attention' && <NeedsAttentionList items={buildNeedsAttention(openTrades).slice(0, 5)} onDetailsClick={openDrawer} onNavigate={drillToTrade} />}{mobileAnalytics === 'close' && <CloseCandidatesCard candidates={buildCloseCandidates(openTrades, markBasis).slice(0, 5)} onNavigate={drillToTrade} />}</div></div>}</div></section>}

            {archivedTrades.length > 0 && <section className="border-t px-3.5 py-3" style={{ borderColor: 'var(--border)' }}><button type="button" onClick={() => setMobileHistoryOpen(current => !current)} className="pressable flex min-h-11 w-full items-center justify-between text-left" aria-expanded={mobileHistoryOpen}><span><b className="block text-[15px]" style={{ color: 'var(--text)' }}>History</b><span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{archivedTrades.length} resolved · {formatCurrency(archiveSummary.realizedPnl, 0)} realized</span></span><ChevronDown className={`h-4 w-4 transition-transform ${mobileHistoryOpen ? 'rotate-180' : ''}`} /></button>{mobileHistoryOpen && <ArchiveHistorySection trades={archivedTrades} summary={archiveSummary} resolvingIds={resolvingArchiveIds} onRetryResolve={handleRetryResolve} onManualExpirationClose={handleManualExpirationClose} onEdit={setEditingTrade} onDelete={handleDeleteTrade} />}</section>}
          </>
        )}

        {mobileActionsOpen && <MobileBottomSheet title="Portfolio actions" onClose={() => setMobileActionsOpen(false)}><div className="space-y-2"><button type="button" onClick={() => { setMobileActionsOpen(false); setShowAddModal(true); }} className="mobile-sheet-action primary w-full"><Plus className="h-4 w-4" /> Add Trade</button><button type="button" onClick={() => { setMobileActionsOpen(false); setShowImportModal(true); }} className="mobile-sheet-action secondary w-full"><FileImage className="h-4 w-4" /> Import Screenshot</button><button type="button" onClick={() => { setMobileActionsOpen(false); setShowDataBackup(true); }} className="mobile-sheet-action secondary w-full"><Download className="h-4 w-4" /> Data Backup</button><button type="button" onClick={() => { setMobileActionsOpen(false); void handleRefreshOpenTrades(); }} disabled={refreshing || openTrades.length === 0} className="mobile-sheet-action secondary w-full disabled:opacity-40"><RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh Open Trades</button></div></MobileBottomSheet>}
        {(showAddModal || editingTrade) && <TradeModal trade={editingTrade} onClose={() => { setShowAddModal(false); setEditingTrade(null); }} onSave={handleSaveTrade} onDelete={handleDeleteTrade} />}
        {drawerSelection && <ErrorBoundary title="Option sheet unavailable" message="Close it and try again."><Suspense fallback={null}><OptionDetailDrawer option={drawerSelection.option} ticker={drawerSelection.ticker} expirationLabel={drawerSelection.expirationLabel} dte={drawerSelection.dte} underlyingPrice={drawerSelection.underlyingPrice} onClose={() => setDrawerSelection(null)} /></Suspense></ErrorBoundary>}
        {showImportModal && <Suspense fallback={null}><PortfolioScreenshotImportModal trades={trades} onClose={() => setShowImportModal(false)} onApply={async nextTrades => { const archived = await archiveExpiredOpenTrades(nextTrades); persistTrades(archived.trades); setShowImportModal(false); }} /></Suspense>}
        {showDataBackup && <Suspense fallback={null}><DataBackupModal onClose={() => setShowDataBackup(false)} onImported={handleBackupImported} /></Suspense>}
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="max-w-[1800px] mx-auto px-2 sm:px-4 lg:px-6 py-4 sm:py-6">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2 mb-3">
          <div className="min-w-0 lg:flex-shrink">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>Portfolio</h1>
            <DataFreshness updatedAt={lastRefreshed} status={refreshing ? 'updating' : refreshWarning ? 'failed' : lastRefreshed ? 'cached' : 'stale'} label="Portfolio market marks" />
          </div>
          <div className="portfolio-actions flex flex-wrap lg:flex-nowrap items-center justify-start lg:justify-end gap-2 lg:shrink-0">
            {trades.length > 0 && <MarkBasisToggle markBasis={markBasis} onChange={setMarkBasis} />}
            <button onClick={() => setShowAddModal(true)} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white min-h-[44px] sm:min-h-0 whitespace-nowrap" style={{ backgroundColor: 'var(--accent)' }}>
              <Plus className="w-3.5 h-3.5" /> Add Trade
            </button>
            <button onClick={() => setShowImportModal(true)} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium min-h-[44px] sm:min-h-0 whitespace-nowrap" style={{ backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>
              <FileImage className="w-3.5 h-3.5" /> Import Screenshot
            </button>
            <button onClick={() => setShowDataBackup(true)} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium min-h-[44px] sm:min-h-0 whitespace-nowrap" style={{ backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>
              <Download className="w-3.5 h-3.5" /> Data Backup
            </button>
            <button onClick={handleRefreshOpenTrades} disabled={refreshing || openTrades.length === 0} className="portfolio-refresh-action inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] sm:min-h-0 whitespace-nowrap" style={{ backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>
              {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Refresh Open Trades
            </button>
          </div>
        </div>
        {durableActivityNotice && (
          <div role="status" className="flex items-center gap-2 rounded-lg px-3 py-2 mb-3 text-xs" style={{ backgroundColor: 'rgba(250,204,21,0.10)', color: 'var(--yellow)', border: '1px solid rgba(250,204,21,0.22)' }}>
            <AlertTriangle className="w-3.5 h-3.5" /> {durableActivityNotice}
          </div>
        )}
        {refreshWarning && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2 mb-3 text-xs" style={{ backgroundColor: 'rgba(250,204,21,0.10)', color: 'var(--yellow)', border: '1px solid rgba(250,204,21,0.22)' }}>
            <AlertTriangle className="w-3.5 h-3.5" /> Some trades could not be refreshed. Saved trade data was preserved.
          </div>
        )}

        {trades.length === 0 ? (
          <div className="text-center py-20">
            <Briefcase className="w-9 h-9 mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
            <p className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>No sold puts added yet.</p>
            <p className="text-xs mb-4" style={{ color: 'var(--text-dim)' }}>Add a trade manually or add one from an option detail drawer.</p>
            <div className="flex flex-col sm:flex-row justify-center gap-2">
              <button onClick={() => setShowAddModal(true)} className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium text-white min-h-[44px]" style={{ backgroundColor: 'var(--accent)' }}>
                <Plus className="w-3.5 h-3.5" /> Add Trade
              </button>
              <button onClick={() => setShowImportModal(true)} className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium min-h-[44px]" style={{ backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                <FileImage className="w-3.5 h-3.5" /> Import Screenshot
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="mb-3 md:hidden">
              <div className="grid grid-cols-2 gap-1.5">
                <div className="col-span-2 rounded-xl p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Total gain / loss</div>
                  <div className="mt-1 font-mono text-2xl font-bold tabular-nums" style={{ color: pnlColor(markSummary.totalGainLoss) }}>{formatCurrency(markSummary.totalGainLoss, 0)}</div>
                  <div className="mt-1 text-xs font-mono" style={{ color: pnlColor(markSummary.percentCaptured) }}>{formatPctValue(markSummary.percentCaptured)} captured</div>
                </div>
                <SummaryCard label="Open Trades" value={String(summary.totalOpenTrades)} />
                <SummaryCard label="Premium Collected" value={formatCurrency(summary.totalPremiumCollected, 0)} color="var(--green)" />
                <SummaryCard label="Gross Risk" value={formatCurrency(summary.totalEquityAtRisk, 0)} />
                <SummaryCard label="Net Capital at Risk" value={formatCurrency(summary.totalNetCapitalAtRisk, 0)} />
              </div>
              <details className="mt-1.5 rounded-lg" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
                <summary className="flex min-h-[44px] cursor-pointer list-none items-center justify-between px-3 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>More portfolio metrics <ChevronDown className="h-4 w-4" /></summary>
                <div className="grid grid-cols-2 gap-1.5 border-t p-2" style={{ borderColor: 'var(--border)' }}>
                  <SummaryCard label="Weighted Avg Entry AY" value={formatPctValue(markSummary.portfolioOriginalAnnualizedYield)} color="var(--accent-light)" />
                  <SummaryCard label="Weighted Avg Current AY" value={formatPctValue(markSummary.portfolioCurrentAnnualizedYield)} color="var(--accent-light)" />
                  <SummaryCard label="Weighted Avg Delta" value={formatDelta(markSummary.weightedAverageDelta)} color={pnlColor(markSummary.weightedAverageDelta)} />
                  <SummaryCard label="Weighted Avg DTE" value={isFiniteNumber(summary.weightedAverageRemainingDte) ? `${Math.round(summary.weightedAverageRemainingDte)} DTE` : DASH} />
                </div>
              </details>
            </div>

            <div className="hidden grid-cols-2 md:grid md:grid-cols-5 xl:grid-cols-10 gap-1.5 mb-3">
              <SummaryCard label="Open Trades" value={String(summary.totalOpenTrades)} />
              <SummaryCard label="Premium Collected" value={formatCurrency(summary.totalPremiumCollected, 0)} color="var(--green)" />
              <SummaryCard label="Gross Risk" value={formatCurrency(summary.totalEquityAtRisk, 0)} />
              <SummaryCard label="Net Capital at Risk" value={formatCurrency(summary.totalNetCapitalAtRisk, 0)} />
              <SummaryCard label="Total Gain/Loss" value={formatCurrency(markSummary.totalGainLoss, 0)} color={pnlColor(markSummary.totalGainLoss)} />
              <SummaryCard label="% Captured" value={formatPctValue(markSummary.percentCaptured)} color={pnlColor(markSummary.percentCaptured)} />
              <SummaryCard label="Weighted Avg Entry AY" value={formatPctValue(markSummary.portfolioOriginalAnnualizedYield)} color="var(--accent-light)" />
              <SummaryCard label="Weighted Avg Current AY" value={formatPctValue(markSummary.portfolioCurrentAnnualizedYield)} color="var(--accent-light)" />
              <SummaryCard label="Weighted Avg Delta" value={formatDelta(markSummary.weightedAverageDelta)} color={pnlColor(markSummary.weightedAverageDelta)} />
              <SummaryCard label="Weighted Avg DTE" value={isFiniteNumber(summary.weightedAverageRemainingDte) ? `${Math.round(summary.weightedAverageRemainingDte)} DTE` : DASH} />
            </div>

            {openTrades.length === 0 && (
              <div className="rounded-lg px-3 py-2 mb-4 text-sm" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>No open trades.</div>
            )}

            <section className="mt-4 mb-4 w-full max-w-full">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Portfolio Analytics</h2>
                <button type="button" onClick={() => setAnalyticsExpanded(expanded => !expanded)} aria-expanded={analyticsExpanded} aria-controls="portfolio-analytics-content" aria-label={`${analyticsExpanded ? 'Collapse' : 'Expand'} Portfolio Analytics`} className="pressable flex min-h-11 min-w-11 items-center justify-center rounded-lg sm:min-h-8 sm:min-w-8" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}><ChevronDown className={`h-4 w-4 transition-transform ${analyticsExpanded ? 'rotate-180' : ''}`} aria-hidden="true" /></button>
              </div>
              <div id="portfolio-analytics-content">{analyticsExpanded && (openTrades.length === 0 ? (
                <section className="rounded-lg p-3 text-sm" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>No open positions for analytics.</section>
              ) : (
                <>
                <div className="mb-2 md:hidden">
                  <div className="mobile-scroll-row flex gap-1 overflow-x-auto rounded-xl p-1" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} role="tablist" aria-label="Portfolio analytics view">
                    {([['maturity', 'Maturity'], ['ticker', 'Exposure'], ['attention', 'Attention'], ['close', 'Close']] as const).map(([value, label]) => (
                      <button key={value} type="button" role="tab" aria-selected={mobileAnalytics === value} onClick={() => setMobileAnalytics(value)} className="pressable min-h-[40px] flex-1 whitespace-nowrap rounded-lg px-3 text-xs font-semibold" style={{ backgroundColor: mobileAnalytics === value ? 'var(--accent)' : 'transparent', color: mobileAnalytics === value ? 'white' : 'var(--text-muted)' }}>{label}</button>
                    ))}
                  </div>
                  <div className="mt-2">
                    {mobileAnalytics === 'maturity' && <CompactExposureBars title="Maturity Wall" groups={groupByExpiration(openTrades, markBasis)} labelFormatter={formatShortDate} emptyLabel="No maturities." onGroupClick={drillToExpiration} />}
                    {mobileAnalytics === 'ticker' && <ConcentrationBars title="Exposure by Ticker" groups={groupByTicker(openTrades, markBasis)} totalGrossRisk={sumValues(openTrades.map(calculateEquityAtRisk))} maxItems={8} onGroupClick={drillToTicker} />}
                    {mobileAnalytics === 'attention' && <NeedsAttentionList items={buildNeedsAttention(openTrades).slice(0, 5)} onDetailsClick={openDrawer} onNavigate={drillToTrade} />}
                    {mobileAnalytics === 'close' && <CloseCandidatesCard candidates={buildCloseCandidates(openTrades, markBasis).slice(0, 5)} onNavigate={drillToTrade} />}
                  </div>
                </div>
                <div className="hidden grid-cols-1 md:grid md:grid-cols-2 xl:grid-cols-12 auto-rows-auto items-stretch gap-2">
                  <div className="md:col-span-1 xl:col-span-8">
                    <CompactExposureBars title="Maturity Wall" groups={groupByExpiration(openTrades, markBasis)} labelFormatter={formatShortDate} emptyLabel="No maturities." onGroupClick={drillToExpiration} />
                  </div>
                  <div className="md:col-span-1 xl:col-span-4">
                    <NeedsAttentionList items={buildNeedsAttention(openTrades).slice(0, 5)} onDetailsClick={openDrawer} onNavigate={drillToTrade} />
                  </div>
                  <div className="md:col-span-1 xl:col-span-8">
                    <ConcentrationBars title="Exposure by Ticker" groups={groupByTicker(openTrades, markBasis)} totalGrossRisk={sumValues(openTrades.map(calculateEquityAtRisk))} maxItems={8} onGroupClick={drillToTicker} />
                  </div>
                  <div className="md:col-span-1 xl:col-span-4">
                    <CloseCandidatesCard candidates={buildCloseCandidates(openTrades, markBasis).slice(0, 5)} onNavigate={drillToTrade} />
                  </div>
                </div>
                </>
              ))}</div>
            </section>

            <div ref={scheduleRef} className="flex scroll-mt-20 flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Schedule of Positions</h2>
                {activeScheduleTicker && <span className="inline-flex items-center gap-1 rounded px-2 py-1 text-[10px]" style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>Showing: {activeScheduleTicker}<button type="button" onClick={() => setActiveScheduleTicker(null)} className="font-bold" aria-label="Clear ticker highlight">× Clear</button></span>}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-1 rounded-lg p-0.5" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }} role="group" aria-label="Group positions by">
                  <span className="px-1.5 text-[9px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Group by</span>
                  {([['expiration', 'Expiry'], ['underlying', 'Underlying'], ['none', 'None']] as const).map(([value, label]) => (
                    <button key={value} type="button" onClick={() => setGroupMode(value)} aria-pressed={groupMode === value} className="min-h-8 rounded-md px-2 py-1 text-[10px] font-semibold" style={{ backgroundColor: groupMode === value ? 'var(--accent-bg)' : 'transparent', color: groupMode === value ? 'var(--accent-light)' : 'var(--text-muted)' }}>{label}</button>
                  ))}
                </div>
                <DisplayToggle checked={showNominalYield} onChange={handleShowNominalYieldChange} label="Show Nominal Yield" />
                <DisplayToggle checked={showOpenInterestVolume} onChange={setShowOpenInterestVolume} label="Show OI / Volume" />
                <DisplayToggle checked={showNotesErrors} onChange={setShowNotesErrors} label="Show Notes / Errors" />
                {scheduleGroups.length > 0 && <button onClick={toggleAllScheduleGroups} className="rounded-lg px-2 py-1.5 text-[11px] whitespace-nowrap" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                  {allScheduleGroupsCollapsed ? 'Expand All' : 'Collapse All'}
                </button>}
              </div>
            </div>
            <div className="md:hidden space-y-2 mb-4">
              {expirationGroups.map(group => {
                const collapsed = collapsedExpiryGroups[group.expiration] === true;
                const captured = group.premiumCollected > 0 && group.totalGainLoss != null ? group.totalGainLoss / group.premiumCollected : null;
                return (
                  <section key={group.expiration} data-expiration={group.expiration} className="scroll-mt-20 overflow-hidden rounded-lg transition-colors duration-500 motion-reduce:transition-none" style={{ border: `1px solid ${highlightedExpiration === group.expiration ? 'var(--accent)' : 'var(--border)'}`, backgroundColor: highlightedExpiration === group.expiration ? 'var(--accent-bg)' : undefined }}>
                    <button
                      onClick={() => toggleExpiryGroup(group.expiration)}
                      aria-expanded={!collapsed}
                      className="flex w-full items-start justify-between gap-2 px-2.5 py-2 text-left"
                      style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text)' }}
                    >
                      <span className="flex min-w-0 items-start gap-1.5">
                        {collapsed ? <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                        <span>
                          <span className="block text-xs font-semibold uppercase tracking-wide">{formatFullDate(group.expiration)}</span>
                          <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>{formatDteValue(group.dte)} · {group.tradeCount} {group.tradeCount === 1 ? 'position' : 'positions'} · {group.contractCount} {group.contractCount === 1 ? 'contract' : 'contracts'}</span>
                        </span>
                      </span>
                      <span className="shrink-0 text-right font-mono text-[10px] tabular-nums">
                        <span className="block">Premium {formatCurrency(group.premiumCollected, 0)} · Risk {formatCurrency(group.grossRisk, 0)}</span>
                        <span className="block" style={{ color: pnlColor(group.totalGainLoss) }}>P&amp;L {formatCurrency(group.totalGainLoss, 0)} · {formatPctValue(captured)}</span>
                      </span>
                    </button>
                    {!collapsed && <div className="space-y-2 p-2" style={{ backgroundColor: 'var(--bg)' }}>
                    {group.trades.map(trade => (
                <div key={trade.id} data-trade-id={trade.id} data-trade-ticker={trade.ticker.trim().toUpperCase()} className="scroll-mt-20 rounded-lg p-3 transition-opacity duration-300 motion-reduce:transition-none" style={{ backgroundColor: highlightedTradeId === trade.id || activeScheduleTicker === trade.ticker.trim().toUpperCase() ? 'var(--accent-bg)' : 'var(--surface)', border: `1px solid ${highlightedTradeId === trade.id ? 'var(--accent)' : 'var(--border)'}`, opacity: activeScheduleTicker && activeScheduleTicker !== trade.ticker.trim().toUpperCase() ? 0.72 : 1 }}>
                  {(() => {
                    const health = getPositionHealth(trade);
                    return (
                      <div className="mb-2">
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none" title={health.title} style={{ color: health.color, backgroundColor: health.bg, border: `1px solid ${health.border}` }}>{health.label}</span>
                      </div>
                    );
                  })()}
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-mono text-lg font-bold" style={{ color: 'var(--accent-light)' }}>{trade.ticker}</div>
                      <button onClick={() => openDrawer(trade)} className="font-mono text-sm underline-offset-2 hover:underline" style={{ color: 'var(--text)' }}>{formatCurrency(trade.strike)} Put</button>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{expiryLabel(trade.expiration)} · {formatDteValue(calculateRemainingDte(trade))}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 mt-3 text-xs">
                    <Metric label="Premium" value={formatCurrency(calculatePremiumCollected(trade), 0)} color="var(--green)" />
                    <Metric label="Gross Risk" value={formatCurrency(calculateEquityAtRisk(trade), 0)} />
                    <Metric label="Current Mark" value={formatOptionPrice(calculateCurrentOptionMark(trade, markBasis))} />
                    <Metric label="Total Gain/Loss" value={formatCurrency(calculateTotalGainLoss(trade, markBasis), 0)} color={pnlColor(calculateTotalGainLoss(trade, markBasis))} />
                    <Metric label="% Captured" value={formatPctValue(calculatePercentCaptured(trade, markBasis))} color={pnlColor(calculatePercentCaptured(trade, markBasis))} />
                    <Metric label="Delta" value={formatDelta(trade.latestMarketData?.delta)} color={pnlColor(trade.latestMarketData?.delta)} />
                    <Metric label="Original AY" value={formatPctValue(calculateOriginalAnnualizedYield(trade))} />
                    <Metric label="Current AY" value={formatPctValue(calculateCurrentAnnualizedYield(trade, markBasis))} />
                  </div>
                  {getRedeployBadges(trade, markBasis).length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {getRedeployBadges(trade, markBasis).map(badge => (
                        <span key={badge} className="rounded px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>{badge}</span>
                      ))}
                    </div>
                  )}
                  {trade.importedSnapshot && (
                    <p className="text-[11px] mt-2" style={{ color: 'var(--yellow)' }}>Entry date missing - using import date. Edit if needed.</p>
                  )}
                  {trade.notes && <p className="text-xs mt-3" style={{ color: 'var(--text-secondary)' }}>{trade.notes}</p>}
                  <div className="flex flex-wrap gap-2 mt-3">
                    <button onClick={() => setEditingTrade(trade)} className="px-3 py-2 rounded-lg text-xs min-h-[40px]" style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text)', border: '1px solid var(--border)' }}>Edit</button>
                  </div>
                </div>
                    ))}
                    </div>}
                  </section>
                );
              })}
            </div>

            <div className="hidden md:block rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="overflow-x-auto max-w-full overscroll-contain">
                <table className="min-w-max w-full text-[12px] leading-none">
                  <thead className="sticky top-0 z-10">
                    <tr style={{ backgroundColor: 'var(--surface-alt)', borderBottom: '1px solid var(--border)' }}>
                      {sortButton('ticker', 'Ticker', 'text-left')}
                      {sortButton('expiration', 'Expiry')}
                      {sortButton('dte', 'DTE')}
                      {sortButton('health', 'Health', 'text-left')}
                      {sortButton('strike', 'Strike')}
                      {sortButton('contracts', 'Contracts')}
                      {sortButton('soldPrice', 'Sold Price')}
                      {sortButton('premium', 'Premium Collected')}
                      {sortButton('grossRisk', 'Gross Risk')}
                      {sortButton('currentMark', 'Current Mark')}
                      {sortButton('currentValue', 'Current Value')}
                      {sortButton('pnl', 'Total Gain/Loss')}
                      {sortButton('percentCaptured', '% Captured')}
                      {sortButton('delta', 'Delta')}
                      {sortButton('breakeven', 'Breakeven')}
                      {sortButton('underlying', 'Underlying')}
                      {sortButton('distanceToStrike', 'Distance to Strike')}
                      {sortButton('iv', 'IV')}
                      {sortButton('entryVix', 'VIX @ Entry')}
                      {showOpenInterestVolume && sortButton('openInterest', 'OI / Volume', 'text-right', 'Sorts by Open Interest')}
                      {showNominalYield && sortButton('originalNy', 'Original NY')}
                      {sortButton('originalAy', 'Original AY')}
                      {showNominalYield && sortButton('currentNy', 'Current NY')}
                      {sortButton('currentAy', 'Current AY')}
                      {showNotesErrors && <th className="px-2 py-2 text-[11px] font-medium text-left min-w-[160px]" style={{ color: 'var(--text-muted)' }}>Notes / Errors</th>}
                      <th className="px-2 py-2 text-[11px] font-medium text-left" style={{ color: 'var(--text-muted)' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {desktopScheduleSections.map(section => {
                      const group = 'flat' in section ? null : section;
                      const groupKey = group ? scheduleGroupKey(group) : 'flat';
                      const collapsed = group ? activeCollapsedGroups[groupKey] === true : false;
                      const captured = group && group.premiumCollected > 0 && group.totalGainLoss != null ? group.totalGainLoss / group.premiumCollected : null;
                      const isHighlighted = group != null && 'expiration' in group && highlightedExpiration === group.expiration;
                      return <Fragment key={groupKey}>
                        {group && <tr data-group-key={groupKey} data-expiration={'expiration' in group ? group.expiration : undefined} className="scroll-mt-20 transition-colors duration-500 motion-reduce:transition-none" style={{ backgroundColor: isHighlighted ? 'var(--accent-bg)' : 'var(--surface-alt)', borderTop: `1px solid ${isHighlighted ? 'var(--accent)' : 'var(--accent-border)'}`, borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>
                          <td className="px-2 py-1.5 text-left font-semibold whitespace-nowrap">
                            <button onClick={() => toggleScheduleGroup(groupKey)} aria-expanded={!collapsed} className="inline-flex items-center gap-1 hover:opacity-80">
                              {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                              <span className="uppercase tracking-wide">{scheduleGroupLabel(group)}</span>
                            </button>
                          </td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums">{DASH}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums whitespace-nowrap">{scheduleGroupDte(group)}</td>
                          <td className="px-2 py-1.5 text-left whitespace-nowrap">{scheduleGroupMetadata(group)}</td>
                          <td className="px-2 py-1.5 text-right">{DASH}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold">{group.contractCount}</td>
                          <td className="px-2 py-1.5 text-right">{DASH}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold" style={{ color: 'var(--green)' }}>{formatCurrency(group.premiumCollected, 0)}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold">{formatCurrency(group.grossRisk, 0)}</td>
                          <td className="px-2 py-1.5 text-right">{DASH}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold">{formatCurrency(group.currentValue, 0)}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold" style={{ color: pnlColor(group.totalGainLoss) }}>{formatCurrency(group.totalGainLoss, 0)}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold" style={{ color: pnlColor(captured) }}>{formatPctValue(captured)}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold" style={{ color: pnlColor(group.weightedAverageDelta) }}>{formatDelta(group.weightedAverageDelta)}</td>
                          <td className="px-2 py-1.5 text-right">{DASH}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums">{'underlyingPrice' in group ? formatCurrency(group.underlyingPrice) : DASH}</td>
                          <td className="px-2 py-1.5 text-right">{DASH}</td>
                          <td className="px-2 py-1.5 text-right">{DASH}</td>
                          <td className="px-2 py-1.5 text-right">{DASH}</td>
                          {showOpenInterestVolume && <td className="px-2 py-1.5 text-right">{DASH}</td>}
                          {showNominalYield && <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold">{formatPctValue(group.originalNY)}</td>}
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold">{formatPctValue(group.originalAY)}</td>
                          {showNominalYield && <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold">{formatPctValue(group.currentNY)}</td>}
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold">{formatPctValue(group.currentAY)}</td>
                          {showNotesErrors && <td className="px-2 py-1.5 text-left text-[10px]" style={{ color: 'var(--text-dim)' }}>{groupMode === 'expiration' ? 'Expiration' : 'Underlying'} subtotal</td>}
                          <td className="px-2 py-1.5 text-left">{DASH}</td>
                        </tr>}
                        {(!group || !collapsed) && section.trades.map((trade, index) => {
                      const totalGainLoss = calculateTotalGainLoss(trade, markBasis);
                      const currentValue = calculateCurrentPositionValue(trade, markBasis);
                      const currentMark = calculateCurrentOptionMark(trade, markBasis);
                      const delta = trade.latestMarketData?.delta ?? null;
                      const redeployBadges = getRedeployBadges(trade, markBasis);
                      const health = getPositionHealth(trade);
                      return (
                        <tr key={trade.id} data-trade-id={trade.id} data-trade-ticker={trade.ticker.trim().toUpperCase()} className="scroll-mt-20 transition-opacity duration-300 motion-reduce:transition-none" style={{ borderBottom: '1px solid var(--border)', backgroundColor: highlightedTradeId === trade.id || activeScheduleTicker === trade.ticker.trim().toUpperCase() ? 'var(--accent-bg)' : index % 2 ? 'var(--row-alt)' : 'transparent', boxShadow: highlightedTradeId === trade.id ? 'inset 3px 0 var(--accent)' : undefined, opacity: activeScheduleTicker && activeScheduleTicker !== trade.ticker.trim().toUpperCase() ? 0.72 : 1 }}>
                          <td className="px-2 py-1 text-left font-mono font-bold whitespace-nowrap">
                            <Link to={`/options/${trade.ticker.trim().toUpperCase()}`} className="underline-offset-2 hover:underline" style={{ color: 'var(--accent-light)' }}>{trade.ticker}</Link>
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap">{expiryLabel(trade.expiration)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap">
                            <HoverTooltip content={<DteTooltipContent trade={trade} />} ariaLabel={`${trade.ticker} position timing details`}>
                              {formatDteValue(calculateRemainingDte(trade))}
                            </HoverTooltip>
                          </td>
                          <td className="px-2 py-1 text-left whitespace-nowrap">
                            <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none" title={health.title} style={{ color: health.color, backgroundColor: health.bg, border: `1px solid ${health.border}` }}>{health.label}</span>
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap">
                            <button onClick={() => openDrawer(trade)} className="underline-offset-2 hover:underline">{formatCurrency(trade.strike)}</button>
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{trade.contracts}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatOptionPrice(trade.soldPrice)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatCurrency(calculatePremiumCollected(trade), 0)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatCurrency(calculateEquityAtRisk(trade), 0)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">
                            <HoverTooltip content={<CurrentMarkTooltipContent trade={trade} markBasis={markBasis} />} ariaLabel={`${trade.ticker} current mark details`}>
                              {formatOptionPrice(currentMark)}
                            </HoverTooltip>
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatCurrency(currentValue, 0)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums" style={{ color: pnlColor(totalGainLoss) }}>{formatCurrency(totalGainLoss, 0)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums" style={{ color: pnlColor(calculatePercentCaptured(trade, markBasis)) }}>{formatPctValue(calculatePercentCaptured(trade, markBasis))}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums" style={{ color: pnlColor(delta) }}>{formatDelta(delta)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatCurrency(calculateBreakeven(trade))}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatCurrency(trade.latestMarketData?.underlyingPrice ?? trade.entrySnapshot?.underlyingPrice)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums" style={{ color: percentColor(calculateDistanceToStrike(trade)) }}>{formatPctValue(calculateDistanceToStrike(trade))}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatPercentPoints(trade.latestMarketData?.iv, 1)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap">
                            {isFiniteNumber(trade.entryVixClose) ? <HoverTooltip content={<VixEntryTooltipContent trade={trade} />} ariaLabel={`${trade.ticker} VIX at entry details`}>{trade.entryVixClose.toFixed(2)}</HoverTooltip> : DASH}
                          </td>
                          {showOpenInterestVolume && <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap">{isFiniteNumber(trade.latestMarketData?.openInterest) || isFiniteNumber(trade.latestMarketData?.volume) ? `${trade.latestMarketData?.openInterest ?? DASH} / ${trade.latestMarketData?.volume ?? DASH}` : DASH}</td>}
                          {showNominalYield && <td className="px-2 py-1 text-right font-mono tabular-nums">{formatPctValue(calculateOriginalNominalYield(trade))}</td>}
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatPctValue(calculateOriginalAnnualizedYield(trade))}</td>
                          {showNominalYield && <td className="px-2 py-1 text-right font-mono tabular-nums">{formatPctValue(calculateCurrentNominalYield(trade, markBasis))}</td>}
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatPctValue(calculateCurrentAnnualizedYield(trade, markBasis))}</td>
                          {showNotesErrors && <td className="px-2 py-1 text-left w-[240px] max-w-[240px]" style={{ color: trade.notes ? 'var(--text-secondary)' : 'var(--text-dim)' }}>
                            <div className="flex items-center gap-1 min-w-0 h-5 overflow-hidden whitespace-nowrap">
                              {redeployBadges.length > 0 && (
                                <>
                                  <span className="shrink-0 rounded px-1 py-0.5 text-[9px] leading-none whitespace-nowrap" title={redeployBadges.join(', ')} style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>{redeployBadges[0]}</span>
                                  {redeployBadges.length > 1 && (
                                    <span className="shrink-0 rounded px-1 py-0.5 text-[9px] leading-none whitespace-nowrap" title={redeployBadges.slice(1).join(', ')} style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>+{redeployBadges.length - 1}</span>
                                  )}
                                </>
                              )}
                              <span className="truncate min-w-0" title={`${trade.importedSnapshot ? 'Entry date missing - import date used. ' : ''}${trade.notes || DASH}`}>
                                {trade.importedSnapshot ? 'Entry date missing - import date used. ' : ''}{trade.notes || DASH}
                              </span>
                            </div>
                          </td>}
                          <td className="px-2 py-1 whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              <button onClick={() => setEditingTrade(trade)} className="p-1.5 rounded" title="Edit" style={{ color: 'var(--text-muted)' }}><Edit2 className="w-3.5 h-3.5" /></button>
                              <button onClick={() => handleDeleteTrade(trade.id)} className="p-1.5 rounded" title="Delete" style={{ color: 'var(--red)' }}><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          </td>
                        </tr>
                      );
                        })}
                      </Fragment>;
                    })}
                    <tr style={{ backgroundColor: 'var(--surface-alt)', borderTop: '2px solid var(--accent-border)', color: 'var(--text)' }}>
                      <td className="px-2 py-2 text-left font-bold uppercase tracking-wider whitespace-nowrap">Totals</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{isFiniteNumber(scheduleTotals.dte) ? `${Math.round(scheduleTotals.dte)} DTE` : DASH}</td>
                      <td className="px-2 py-2 text-left font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: 'var(--green)' }}>{formatCurrency(scheduleTotals.premium, 0)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold">{formatCurrency(scheduleTotals.grossRisk, 0)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold">{formatCurrency(scheduleTotals.currentValue, 0)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: pnlColor(scheduleTotals.totalGainLoss) }}>{formatCurrency(scheduleTotals.totalGainLoss, 0)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: pnlColor(scheduleTotals.percentCaptured) }}>{formatPctValue(scheduleTotals.percentCaptured)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: pnlColor(scheduleTotals.weightedAverageDelta) }}>{formatDelta(scheduleTotals.weightedAverageDelta)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      {showOpenInterestVolume && <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>}
                      {showNominalYield && <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold">{formatPctValue(scheduleTotals.originalNominalYield)}</td>}
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold">{formatPctValue(scheduleTotals.originalAnnualizedYield)}</td>
                      {showNominalYield && <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold">{formatPctValue(scheduleTotals.currentNominalYield)}</td>}
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold">{formatPctValue(scheduleTotals.currentAnnualizedYield)}</td>
                      {showNotesErrors && <td className="px-2 py-2 text-left text-[10px]" style={{ color: 'var(--text-dim)' }}>Portfolio-level yields use aggregate dollar-days.</td>}
                      <td className="px-2 py-2 text-left">{DASH}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-3 text-[10px]" style={{ color: 'var(--text-dim)' }}>
              Closed trades: {summary.totalClosedTrades} · Current mark-dependent metrics use the selected {markBasis.toUpperCase()} basis and show {DASH} when that mark is unavailable.
            </div>

            <ArchiveHistorySection
              trades={archivedTrades}
              summary={archiveSummary}
              resolvingIds={resolvingArchiveIds}
              onRetryResolve={handleRetryResolve}
              onManualExpirationClose={handleManualExpirationClose}
              onEdit={setEditingTrade}
              onDelete={handleDeleteTrade}
            />

          </>
        )}

        <footer className="mt-8 pb-6 text-center">
          <p className="text-xs" style={{ color: 'var(--text-dim)' }}>Portfolio data is stored locally in this browser. Not financial advice.</p>
        </footer>
      </div>

      {(showAddModal || editingTrade) && (
        <TradeModal
          trade={editingTrade}
          onClose={() => {
            setShowAddModal(false);
            setEditingTrade(null);
          }}
          onSave={handleSaveTrade}
          onDelete={handleDeleteTrade}
        />
      )}

      {drawerSelection && (
        <ErrorBoundary title="Option drawer unavailable" message="The option detail drawer could not render. Close it and try again.">
          <Suspense fallback={null}>
            <OptionDetailDrawer
              option={drawerSelection.option}
              ticker={drawerSelection.ticker}
              expirationLabel={drawerSelection.expirationLabel}
              dte={drawerSelection.dte}
              underlyingPrice={drawerSelection.underlyingPrice}
              onClose={() => setDrawerSelection(null)}
            />
          </Suspense>
        </ErrorBoundary>
      )}

      {showImportModal && (
        <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.72)' }}><div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}>Loading import tools...</div></div>}>
          <PortfolioScreenshotImportModal
            trades={trades}
            onClose={() => setShowImportModal(false)}
            onApply={async nextTrades => {
              const archived = await archiveExpiredOpenTrades(nextTrades);
              persistTrades(archived.trades);
              setShowImportModal(false);
            }}
          />
        </Suspense>
      )}
      {showDataBackup && (
        <Suspense fallback={<div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ backgroundColor: 'rgba(0,0,0,0.72)' }}><div className="rounded-lg border px-4 py-3 text-sm" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}>Loading backup tools...</div></div>}>
          <DataBackupModal onClose={() => setShowDataBackup(false)} onImported={handleBackupImported} />
        </Suspense>
      )}
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>{label}</div>
      <div className="font-mono tabular-nums" style={{ color: color ?? 'var(--text)' }}>{value}</div>
    </div>
  );
}

const HISTORY_FILTERS: Array<{ value: HistoryOutcome; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'expired_worthless', label: 'Expired Worthless' },
  { value: 'closed', label: 'Closed' }, { value: 'expired_itm', label: 'Expired ITM' }, { value: 'assigned', label: 'Assigned' },
];

function MonthlyRealizedChart({ trades }: { trades: PortfolioTrade[] }) {
  const months = buildMonthlyRealizedPnl(trades);
  if (months.length === 0) return null;
  const max = Math.max(...months.map(month => Math.abs(month.realizedPnl)), 1);
  return (
    <section className="mb-2 rounded-lg p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="mb-2 flex items-center justify-between gap-2"><h3 className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Realized P&amp;L by Month</h3><span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>{months.length} months</span></div>
      <div className="flex h-28 items-end gap-1 overflow-x-auto pb-1">
        {months.map(month => {
          const captured = month.premiumCollected > 0 ? month.realizedPnl / month.premiumCollected : null;
          const label = new Date(`${month.month}-01T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
          return <div key={month.month} className="group/month relative flex h-full min-w-[42px] flex-1 flex-col items-center justify-end" title={`${label}\nTrades: ${month.trades}\nPremium Collected: ${formatCurrency(month.premiumCollected, 0)}\nRealized P&L: ${formatCurrency(month.realizedPnl, 0)}\nCaptured: ${formatPctValue(captured)}`}>
            <div className="w-full max-w-10 rounded-t transition-opacity hover:opacity-80 motion-reduce:transition-none" style={{ height: `${Math.max(5, Math.abs(month.realizedPnl) / max * 78)}px`, backgroundColor: month.realizedPnl >= 0 ? 'var(--green)' : 'var(--red)' }} />
            <span className="mt-1 text-[9px] whitespace-nowrap" style={{ color: 'var(--text-dim)' }}>{label}</span>
          </div>;
        })}
      </div>
    </section>
  );
}

function ArchiveHistorySection({
  trades,
  summary,
  resolvingIds,
  onRetryResolve,
  onManualExpirationClose,
  onEdit,
  onDelete,
}: {
  trades: PortfolioTrade[];
  summary: ReturnType<typeof buildArchiveSummary>;
  resolvingIds: Set<string>;
  onRetryResolve: (trade: PortfolioTrade) => void;
  onManualExpirationClose: (trade: PortfolioTrade) => void;
  onEdit: (trade: PortfolioTrade) => void;
  onDelete: (id: string) => void;
}) {
  const [outcomeFilter, setOutcomeFilter] = useState<HistoryOutcome>('all');
  const visibleTrades = useMemo(() => filterHistoryTrades(trades, outcomeFilter), [outcomeFilter, trades]);
  const visibleSummary = useMemo(() => outcomeFilter === 'all' ? summary : buildArchiveSummary(visibleTrades), [outcomeFilter, summary, visibleTrades]);
  if (trades.length === 0) return null;

  return (
    <section className="mt-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <h2 className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Expired / Closed History</h2>
        <div className="flex max-w-full gap-1 overflow-x-auto pb-0.5">
          {HISTORY_FILTERS.map(filter => <button type="button" key={filter.value} onClick={() => setOutcomeFilter(filter.value)} className="rounded px-2 py-1 text-[10px] whitespace-nowrap" style={{ backgroundColor: outcomeFilter === filter.value ? 'var(--accent-bg)' : 'var(--surface)', color: outcomeFilter === filter.value ? 'var(--accent-light)' : 'var(--text-muted)', border: `1px solid ${outcomeFilter === filter.value ? 'var(--accent-border)' : 'var(--border)'}` }}>{filter.label}</button>)}
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-1.5 mb-2">
        <SummaryCard label="Resolved Trades" value={String(visibleSummary.resolvedTrades)} />
        <SummaryCard label="Realized P&L" value={formatCurrency(visibleSummary.realizedPnl)} color={pnlColor(visibleSummary.realizedPnl)} />
        <SummaryCard label="Premium Collected" value={formatCurrency(visibleSummary.premiumCollected)} color="var(--green)" />
        <SummaryCard label="Blended Capture" value={formatPctValue(visibleSummary.blendedCapture)} color={pnlColor(visibleSummary.blendedCapture)} />
        <SummaryCard label="Avg Days Held" value={formatDays(visibleSummary.averageDaysHeld)} />
        <SummaryCard label="Worthless %" value={formatPctValue(visibleSummary.percentages.expired_worthless)} color="var(--green)" />
        <SummaryCard label="Expired ITM %" value={formatPctValue(visibleSummary.percentages.expired_itm)} color={visibleSummary.counts.expired_itm > 0 ? 'var(--red)' : undefined} />
      </div>
      <div className="mb-2 flex h-2 overflow-hidden rounded-full" style={{ backgroundColor: 'var(--surface-alt)' }} title={`Expired Worthless ${visibleSummary.counts.expired_worthless} · Closed ${visibleSummary.counts.closed} · Expired ITM ${visibleSummary.counts.expired_itm} · Assigned ${visibleSummary.counts.assigned}`}>
        {(['expired_worthless', 'closed', 'expired_itm', 'assigned'] as const).map((outcome, index) => <div key={outcome} style={{ width: `${visibleSummary.percentages[outcome] * 100}%`, backgroundColor: ['var(--green)', 'var(--accent)', 'var(--red)', 'var(--orange)'][index] }} />)}
      </div>
      <MonthlyRealizedChart trades={visibleTrades} />
      <div className="space-y-2 md:hidden">
        {visibleTrades.map(trade => {
          const pending = trade.status === 'expired_price_pending' || trade.resolutionType === 'expired_price_pending';
          const canSetExpirationClose = trade.status === 'expired' || trade.status === 'expired_price_pending';
          const resolving = resolvingIds.has(trade.id);
          const realizedPnl = getArchivedRealizedPnl(trade);
          const percentCaptured = getArchivedPercentCaptured(trade);
          const realizedIrr = historyRealizedIrr(trade);
          return (
            <article key={`history-${trade.id}`} className="rounded-xl p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-mono text-base font-bold" style={{ color: 'var(--accent-light)' }}>{trade.ticker} {formatCurrency(trade.strike)} Put</div>
                  <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{formatFullDate(trade.expiration)} · {formatDays(historyDaysHeld(trade))} held</div>
                </div>
                <span className="rounded px-1.5 py-1 text-[10px] font-semibold" style={{ color: getArchiveOutcomeColor(trade), backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>{getArchiveOutcomeLabel(trade)}</span>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Metric label="Premium" value={formatCurrency(getArchivedPremium(trade))} color="var(--green)" />
                <Metric label="Realized P&L" value={formatCurrency(realizedPnl)} color={pnlColor(realizedPnl)} />
                <Metric label="Captured" value={formatPctValue(percentCaptured)} color={pnlColor(percentCaptured)} />
                <Metric label="Realized IRR" value={formatPctValue(realizedIrr)} color={pnlColor(realizedIrr)} />
                <Metric label="Final value" value={formatCurrency(getArchivedFinalValue(trade))} />
              </div>
              {trade.resolutionWarning && <p className="mt-2 text-[11px]" style={{ color: 'var(--yellow)' }}>{trade.resolutionWarning}</p>}
              <div className="mt-3 flex flex-wrap gap-2 border-t pt-2" style={{ borderColor: 'var(--border)' }}>
                {pending && <button onClick={() => onRetryResolve(trade)} disabled={resolving} className="tap-target rounded-lg px-3 text-xs disabled:opacity-50" style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text)', border: '1px solid var(--border)' }}>{resolving ? 'Resolving...' : 'Retry'}</button>}
                {canSetExpirationClose && <button onClick={() => onManualExpirationClose(trade)} className="tap-target rounded-lg px-3 text-xs" style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text)', border: '1px solid var(--border)' }}>Set close</button>}
                <button onClick={() => onEdit(trade)} className="tap-target ml-auto flex items-center justify-center rounded-lg px-3" aria-label={`Edit ${trade.ticker} trade`} style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-alt)' }}><Edit2 className="h-4 w-4" /></button>
                <button onClick={() => onDelete(trade.id)} className="tap-target flex items-center justify-center rounded-lg px-3" aria-label={`Delete ${trade.ticker} trade`} style={{ color: 'var(--red)', backgroundColor: 'rgba(239,68,68,0.1)' }}><Trash2 className="h-4 w-4" /></button>
              </div>
            </article>
          );
        })}
      </div>
      <div className="hidden rounded-lg overflow-hidden md:block" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="overflow-x-auto max-w-full overscroll-contain">
          <table className="min-w-max w-full text-[12px] leading-none">
            <thead>
              <tr style={{ backgroundColor: 'var(--surface-alt)', borderBottom: '1px solid var(--border)' }}>
                {['Ticker', 'Expiration', 'Strike', 'Contracts', 'Written Date', 'Days Held', 'Sold Price', 'Expiration Close', 'Final Value', 'Premium Collected', 'Realized P&L', 'Realized IRR', '% Captured', 'Outcome', 'Actions'].map((label, index) => (
                  <th key={label} title={label === 'Realized IRR' ? 'Compounded annualized return on original net capital at risk over actual calendar days held.' : undefined} className={`px-2 py-2 text-[11px] font-medium whitespace-nowrap ${index === 0 || label === 'Outcome' || label === 'Actions' ? 'text-left' : 'text-right'}`} style={{ color: 'var(--text-muted)' }}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleTrades.map((trade, index) => {
                const pending = trade.status === 'expired_price_pending' || trade.resolutionType === 'expired_price_pending';
                const canSetExpirationClose = trade.status === 'expired' || trade.status === 'expired_price_pending';
                const resolving = resolvingIds.has(trade.id);
                const realizedPnl = getArchivedRealizedPnl(trade);
                const percentCaptured = getArchivedPercentCaptured(trade);
                const realizedIrr = historyRealizedIrr(trade);
                return (
                  <tr key={trade.id} title={`${trade.ticker} ${formatCurrency(trade.strike)} Put\nWritten: ${formatFullDate(trade.soldDate)}\nResolved: ${formatFullDate(trade.closeDate ?? trade.resolvedDate ?? trade.expiration)}\nDays held: ${formatDays(historyDaysHeld(trade))}\nSold: ${formatOptionPrice(trade.soldPrice)}\nClose: ${formatOptionPrice(trade.closePrice)}\nUnderlying expiration close: ${formatCurrency(trade.expirationClosePrice)}\nFinal value: ${formatCurrency(getArchivedFinalValue(trade))}\nPremium: ${formatCurrency(getArchivedPremium(trade))}\nRealized P&L: ${formatCurrency(realizedPnl)}\nRealized IRR: ${formatPctValue(realizedIrr)}\nCaptured: ${formatPctValue(percentCaptured)}\nOriginal AY: ${formatPctValue(calculateOriginalAnnualizedYield(trade))}\nOutcome: ${getArchiveOutcomeLabel(trade)}`} style={{ borderBottom: '1px solid var(--border)', backgroundColor: index % 2 ? 'var(--row-alt)' : 'transparent' }}>
                    <td className="px-2 py-1 text-left font-mono font-bold whitespace-nowrap" style={{ color: 'var(--accent-light)' }}>{trade.ticker}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap">{formatFullDate(trade.expiration)}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap">{formatCurrency(trade.strike)}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">{trade.contracts}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap">{formatFullDate(trade.soldDate)}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">{formatDays(getTradeDaysHeld(trade))}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">{formatOptionPrice(trade.soldPrice)}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">{formatCurrency(trade.expirationClosePrice)}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">{formatCurrency(getArchivedFinalValue(trade))}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums">{formatCurrency(getArchivedPremium(trade))}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums" style={{ color: pnlColor(realizedPnl) }}>{formatCurrency(realizedPnl)}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums" style={{ color: pnlColor(realizedIrr) }}>{formatPctValue(realizedIrr)}</td>
                    <td className="px-2 py-1 text-right font-mono tabular-nums" style={{ color: pnlColor(percentCaptured) }}>{formatPctValue(percentCaptured)}</td>
                    <td className="px-2 py-1 text-left whitespace-nowrap">
                      <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none" title={trade.resolutionWarning ?? getArchiveOutcomeLabel(trade)} style={{ color: getArchiveOutcomeColor(trade), backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
                        {getArchiveOutcomeLabel(trade)}
                      </span>
                      {trade.resolutionWarning && <div className="mt-1 max-w-[260px] truncate text-[10px]" style={{ color: 'var(--text-dim)' }}>{trade.resolutionWarning}</div>}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      <div className="flex items-center gap-1">
                        {pending && (
                          <button onClick={() => onRetryResolve(trade)} disabled={resolving} className="px-2 py-1.5 rounded text-[11px] disabled:opacity-50" style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                            {resolving ? 'Resolving...' : 'Retry Resolve'}
                          </button>
                        )}
                        {canSetExpirationClose && (
                          <button onClick={() => onManualExpirationClose(trade)} className="px-2 py-1.5 rounded text-[11px]" style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text)', border: '1px solid var(--border)' }}>Set Expiration Close</button>
                        )}
                        <button onClick={() => onEdit(trade)} className="p-1.5 rounded" title="Edit" style={{ color: 'var(--text-muted)' }}><Edit2 className="w-3.5 h-3.5" /></button>
                        <button onClick={() => onDelete(trade.id)} className="p-1.5 rounded" title="Delete" style={{ color: 'var(--red)' }}><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function buildScheduleTotals(openTrades: PortfolioTrade[], basis: MarkBasis) {
  const premium = sumValues(openTrades.map(calculatePremiumCollected));
  const grossRisk = sumValues(openTrades.map(calculateEquityAtRisk));
  const netRisk = sumValues(openTrades.map(calculateNetCapitalAtRisk));
  const currentValue = completeSumValues(openTrades.map(trade => calculateCurrentPositionValue(trade, basis)));
  const totalCurrentPremium = completeSumValues(openTrades.map(trade => calculateCurrentMarkValueAbsolute(trade, basis)));
  const totalGainLoss = currentValue != null ? premium + currentValue : null;
  const originalDollarDays = sumValues(openTrades.map(trade => {
    const tradeNetRisk = calculateNetCapitalAtRisk(trade);
    const dte = calculateOriginalDte(trade);
    return tradeNetRisk != null && isFiniteNumber(dte) && dte > 0 ? tradeNetRisk * dte / 365 : null;
  }));
  const currentDollarDays = sumValues(openTrades.map(trade => {
    const tradeNetRisk = calculateNetCapitalAtRisk(trade);
    const dte = calculateRemainingDte(trade);
    return tradeNetRisk != null && isFiniteNumber(dte) && dte > 0 ? tradeNetRisk * dte / 365 : null;
  }));

  return {
    premium,
    grossRisk,
    netRisk,
    currentValue,
    totalGainLoss,
    percentCaptured: premium > 0 && totalGainLoss != null ? totalGainLoss / premium : null,
    weightedAverageDelta: weightedAverageValue(openTrades.map(trade => ({ value: trade.latestMarketData?.delta, weight: calculateEquityAtRisk(trade) }))),
    originalNominalYield: netRisk > 0 ? premium / netRisk : null,
    originalAnnualizedYield: originalDollarDays > 0 ? premium / originalDollarDays : null,
    currentNominalYield: netRisk > 0 && totalCurrentPremium != null ? totalCurrentPremium / netRisk : null,
    currentAnnualizedYield: currentDollarDays > 0 && totalCurrentPremium != null ? totalCurrentPremium / currentDollarDays : null,
    dte: weightedAverageValue(openTrades.map(trade => ({ value: calculateRemainingDte(trade), weight: calculateNetCapitalAtRisk(trade) }))),
  };
}

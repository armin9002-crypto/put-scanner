import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Briefcase, Edit2, FileImage, Loader2, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { calculatePutDelta, fetchBatchPrices, fetchOptions } from '../lib/api';
import { formatCurrency, formatDate, formatOptionPrice, formatPercent, formatPercentPoints } from '../lib/format';
import { calculateDte, calculateMoneyness, calculateYieldPercent, isFiniteNumber } from '../lib/optionMetrics';
import {
  getTradeDistanceToBreakeven,
  getTradeDistanceToStrike,
  getTradeGrossRisk,
  groupByExpiration,
  groupByTicker,
  type PortfolioExposureGroup,
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
import PortfolioScreenshotImportModal from '../components/PortfolioScreenshotImportModal';

const OptionDetailDrawer = lazy(() => import('../components/OptionDetailDrawer'));
const DASH = '\u2014';
const PORTFOLIO_MARK_BASIS_KEY = 'put_scanner_portfolio_mark_basis';
const MARK_BASIS_OPTIONS: MarkBasis[] = ['bid', 'ask', 'last'];

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

type SortField = 'ticker' | 'expiration' | 'dte' | 'strike' | 'contracts' | 'premium' | 'risk' | 'pnl' | 'delta';
type SortDir = 'asc' | 'desc';

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

function expiryLabel(iso: string): string {
  return formatDate(`${iso}T00:00:00`);
}

function getInitialMarkBasis(): MarkBasis {
  try {
    const saved = localStorage.getItem(PORTFOLIO_MARK_BASIS_KEY);
    return MARK_BASIS_OPTIONS.includes(saved as MarkBasis) ? saved as MarkBasis : 'ask';
  } catch {
    return 'ask';
  }
}

function persistMarkBasis(value: MarkBasis) {
  try {
    localStorage.setItem(PORTFOLIO_MARK_BASIS_KEY, value);
  } catch {
    // Preference persistence is best-effort only.
  }
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
    <div className="flex items-center gap-1.5 min-w-0 whitespace-nowrap">
      <span className="text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>Mark book at</span>
      <div className="inline-flex rounded-lg overflow-hidden w-fit" style={{ border: '1px solid var(--border)' }}>
        {MARK_BASIS_OPTIONS.map(option => (
          <button
            key={option}
            onClick={() => onChange(option)}
            className="px-2.5 py-2 text-xs font-semibold min-w-[48px] sm:min-w-[52px]"
            style={{
              backgroundColor: markBasis === option ? 'var(--accent)' : 'var(--surface-alt)',
              color: markBasis === option ? 'white' : 'var(--text-muted)',
              borderRight: option !== 'last' ? '1px solid var(--border)' : '0',
            }}
          >
            {option.charAt(0).toUpperCase() + option.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}

function formatShortDate(iso: string): string {
  return formatDate(`${iso}T00:00:00`);
}

function formatCompactCurrency(value: number | null | undefined): string {
  if (!isFiniteNumber(value)) return DASH;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${value < 0 ? '-' : ''}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${value < 0 ? '-' : ''}$${Math.round(abs / 1_000).toLocaleString('en-US')}K`;
  return formatCurrency(value, 0);
}

function RiskCockpit({
  trades,
  markBasis,
  onTickerClick,
  onDetailsClick,
}: {
  trades: PortfolioTrade[];
  markBasis: MarkBasis;
  onTickerClick: (ticker: string) => void;
  onDetailsClick: (trade: PortfolioTrade) => void;
}) {
  const maturity = useMemo(() => groupByExpiration(trades, markBasis), [trades, markBasis]);
  const tickerExposure = useMemo(() => groupByTicker(trades, markBasis), [trades, markBasis]);
  const attention = useMemo(() => buildNeedsAttention(trades).slice(0, 5), [trades]);

  if (trades.length === 0) {
    return (
      <section className="rounded-lg p-3 text-sm" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>No open positions for analytics.</section>
    );
  }

  return (
    <>
      <CompactExposureBars title="Maturity Wall" groups={maturity} labelFormatter={formatShortDate} emptyLabel="No maturities." />
      <ConcentrationBars title="Exposure by Ticker" groups={tickerExposure} totalGrossRisk={sumValues(trades.map(calculateEquityAtRisk))} maxItems={8} />
      <NeedsAttentionList items={attention} onTickerClick={onTickerClick} onDetailsClick={onDetailsClick} />
    </>
  );
}

function CompactExposureBars({
  title,
  groups,
  labelFormatter = value => value,
  emptyLabel,
}: {
  title: string;
  groups: PortfolioExposureGroup[];
  labelFormatter?: (value: string) => string;
  emptyLabel: string;
}) {
  const max = Math.max(...groups.map(group => group.grossRisk), 0);
  return (
    <section className="rounded-lg p-3 min-w-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{title}</h3>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>{groups.length} buckets</span>
      </div>
      {groups.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>{emptyLabel}</p>
      ) : (
        <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
          {groups.map(group => {
            const width = max > 0 ? Math.max(3, (group.grossRisk / max) * 100) : 0;
            const tooltip = [
              `Gross Risk: ${formatCurrency(group.grossRisk, 0)}`,
              `Net Capital: ${formatCurrency(group.netCapitalAtRisk, 0)}`,
              `Premium: ${formatCurrency(group.premiumCollected, 0)}`,
              `Trades: ${group.tradeCount}`,
              `Original AY: ${formatPctValue(group.originalAY)}`,
            ].join('\n');
            return (
              <div key={group.key} title={tooltip}>
                <div className="flex items-center justify-between gap-2 text-[11px] mb-1">
                  <span className="font-medium truncate" style={{ color: 'var(--text)' }}>{labelFormatter(group.label)}</span>
                  <span className="font-mono tabular-nums flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{formatCompactCurrency(group.grossRisk)}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--surface-alt)' }}>
                  <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: 'var(--accent)' }} />
                </div>
                <div className="flex justify-between gap-2 mt-1 text-[10px]" style={{ color: 'var(--text-dim)' }}>
                  <span>{group.tradeCount} trade{group.tradeCount === 1 ? '' : 's'}</span>
                  <span className="truncate">Prem {formatCompactCurrency(group.premiumCollected)} · Net {formatCompactCurrency(group.netCapitalAtRisk)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function NeedsAttentionList({
  items,
  onTickerClick,
  onDetailsClick,
}: {
  items: PortfolioTrade[];
  onTickerClick: (ticker: string) => void;
  onDetailsClick: (trade: PortfolioTrade) => void;
}) {
  return (
    <section className="rounded-lg p-3 min-w-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Needs Attention</h3>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>Top {items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>No positions need review.</p>
      ) : (
        <div className="space-y-1.5 max-h-[240px] overflow-y-auto pr-1">
          {items.map(trade => {
            const beDistance = getTradeDistanceToBreakeven(trade);
            const strikeDistance = getTradeDistanceToStrike(trade);
            return (
              <div key={trade.id} className="grid grid-cols-[minmax(88px,1fr)_auto] gap-2 rounded px-2 py-1.5" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <button onClick={() => onTickerClick(trade.ticker)} className="font-mono text-xs font-bold truncate underline-offset-2 hover:underline" style={{ color: 'var(--accent-light)' }}>{trade.ticker}</button>
                    <button onClick={() => onDetailsClick(trade)} className="font-mono text-xs truncate underline-offset-2 hover:underline" style={{ color: 'var(--text)' }}>{formatCurrency(trade.strike, 0)} Put</button>
                  </div>
                  <div className="text-[10px] truncate" style={{ color: 'var(--text-dim)' }}>{expiryLabel(trade.expiration)} · {formatDteValue(calculateRemainingDte(trade))}</div>
                </div>
                <div className="text-right font-mono text-[10px] tabular-nums">
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

function YieldAnalytics({
  trades,
  markBasis,
  markSummary,
  totalPremiumCollected,
  onTickerClick,
}: {
  trades: PortfolioTrade[];
  markBasis: MarkBasis;
  markSummary: ReturnType<typeof calculatePortfolioMarkSummary>;
  totalPremiumCollected: number;
  onTickerClick: (ticker: string) => void;
}) {
  const closeCandidates = useMemo(() => buildCloseCandidates(trades, markBasis).slice(0, 5), [trades, markBasis]);

  if (trades.length === 0) return null;

  return (
    <>
      <YieldComparisonCard markSummary={markSummary} totalPremiumCollected={totalPremiumCollected} />
      <CloseCandidatesCard candidates={closeCandidates} onTickerClick={onTickerClick} />
    </>
  );
}

function YieldComparisonCard({ markSummary, totalPremiumCollected }: { markSummary: ReturnType<typeof calculatePortfolioMarkSummary>; totalPremiumCollected: number }) {
  const rows = [
    { label: 'Original NY', value: formatPctValue(markSummary.portfolioOriginalNominalYield) },
    { label: 'Original AY', value: formatPctValue(markSummary.portfolioOriginalAnnualizedYield) },
    { label: 'Current NY', value: formatPctValue(markSummary.portfolioCurrentNominalYield) },
    { label: 'Current AY', value: formatPctValue(markSummary.portfolioCurrentAnnualizedYield) },
    { label: 'Premium Collected', value: formatCurrency(totalPremiumCollected, 0), muted: true },
    { label: 'Remaining Premium', value: formatCurrency(markSummary.totalCurrentPremium, 0), muted: true },
    { label: '% Captured', value: formatPctValue(markSummary.percentCaptured), color: pnlColor(markSummary.percentCaptured) },
  ];

  return (
    <section className="rounded-lg p-3 min-w-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="mb-2">
        <h3 className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Yield Comparison</h3>
        <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>Portfolio AY uses aggregate dollar-days.</p>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
        {rows.map(row => (
          <div key={row.label} className="flex items-baseline justify-between gap-2 min-w-0">
            <span className="text-[10px] truncate" style={{ color: 'var(--text-dim)' }}>{row.label}</span>
            <span className="font-mono text-xs tabular-nums font-semibold whitespace-nowrap" style={{ color: row.color ?? (row.muted ? 'var(--text-secondary)' : 'var(--text)') }}>{row.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function CloseCandidatesCard({ candidates, onTickerClick }: { candidates: CloseCandidate[]; onTickerClick: (ticker: string) => void }) {
  return (
    <section className="rounded-lg p-3 min-w-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <h3 className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Close Candidates</h3>
          <p className="text-[10px]" style={{ color: 'var(--text-dim)' }}>Potential close/redeploy candidates.</p>
        </div>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>Top {candidates.length}</span>
      </div>
      {candidates.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>No obvious close candidates at the selected mark.</p>
      ) : (
        <div className="space-y-1.5 max-h-[220px] overflow-y-auto pr-1">
          {candidates.map(candidate => (
            <div key={candidate.trade.id} className="rounded px-2 py-1.5" title={candidate.reasons.join(', ')} style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
              <div className="grid grid-cols-[minmax(88px,1fr)_auto_auto] gap-2 items-baseline">
                <button onClick={() => onTickerClick(candidate.trade.ticker)} className="text-left font-mono text-xs font-bold truncate underline-offset-2 hover:underline" style={{ color: 'var(--accent-light)' }}>{candidate.trade.ticker}</button>
                <span className="font-mono text-[11px] tabular-nums" style={{ color: pnlColor(candidate.percentCaptured) }}>{formatPctValue(candidate.percentCaptured)}</span>
                <span className="font-mono text-[11px] tabular-nums" style={{ color: 'var(--text-secondary)' }}>{formatCurrency(candidate.remainingPremium, 0)}</span>
              </div>
              <div className="grid grid-cols-[minmax(88px,1fr)_auto_auto] gap-2 text-[10px] mt-0.5" style={{ color: 'var(--text-dim)' }}>
                <span className="truncate">{expiryLabel(candidate.trade.expiration)} {formatCurrency(candidate.trade.strike, 0)} Put</span>
                <span className="font-mono tabular-nums">{formatPctValue(candidate.currentAnnualizedYield)} AY</span>
                <span className="font-mono tabular-nums">{formatDteValue(candidate.dte)}</span>
              </div>
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
}: {
  title: string;
  groups: PortfolioExposureGroup[];
  totalGrossRisk: number;
  maxItems?: number;
}) {
  const visible = groups.slice(0, maxItems);
  const max = Math.max(...visible.map(group => group.grossRisk), 0);
  return (
    <section className="rounded-lg p-3 min-w-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>{title}</h3>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>{groups.length} groups</span>
      </div>
      {visible.length === 0 ? (
        <p className="text-xs" style={{ color: 'var(--text-dim)' }}>No concentration data.</p>
      ) : (
        <div className="space-y-2 max-h-[250px] overflow-y-auto pr-1">
          {visible.map(group => {
            const width = max > 0 ? Math.max(4, group.grossRisk / max * 100) : 0;
            return (
              <div key={group.key} title={groupTooltip(group)}>
                <div className="flex items-center justify-between gap-2 text-[11px] mb-1">
                  <span className="font-medium truncate" style={{ color: 'var(--text)' }}>{group.label}</span>
                  <span className="font-mono tabular-nums flex-shrink-0" style={{ color: 'var(--text-secondary)' }}>{formatCompactCurrency(group.grossRisk)}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--surface-alt)' }}>
                  <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: 'var(--accent)' }} />
                </div>
                <div className="flex justify-between gap-2 mt-1 text-[10px]" style={{ color: 'var(--text-dim)' }}>
                  <span>{formatPctValue(percentOfTotal(group.grossRisk, totalGrossRisk))}</span>
                  <span className="truncate">{group.tradeCount} trades - Net {formatCompactCurrency(group.netCapitalAtRisk)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function ConcentrationInsights({
  trades,
  byTicker,
  totalGrossRisk,
}: {
  trades: PortfolioTrade[];
  byTicker: PortfolioExposureGroup[];
  totalGrossRisk: number;
}) {
  const largestSingle = trades.reduce<PortfolioTrade | null>((largest, trade) => {
    const risk = calculateEquityAtRisk(trade) ?? 0;
    const largestRisk = largest ? calculateEquityAtRisk(largest) ?? 0 : -1;
    return risk > largestRisk ? trade : largest;
  }, null);
  const largestTicker = byTicker[0] ?? null;
  const rows = [
    largestTicker ? ['Largest ticker', `${largestTicker.label} - ${formatCompactCurrency(largestTicker.grossRisk)} (${formatPctValue(percentOfTotal(largestTicker.grossRisk, totalGrossRisk))})`] : null,
    largestSingle ? ['Largest position', `${largestSingle.ticker} ${formatCurrency(largestSingle.strike, 0)} Put - ${formatCompactCurrency(calculateEquityAtRisk(largestSingle))}`] : null,
    ['Open gross risk', formatCompactCurrency(totalGrossRisk)],
  ].filter(Boolean) as Array<[string, string]>;

  return (
    <section className="rounded-lg p-3 min-w-0" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>Concentration Insights</h3>
        <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>Gross risk lens</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2">
        {rows.map(([label, value]) => (
          <div key={label} className="rounded p-2 min-w-0" style={{ backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
            <div className="text-[10px] uppercase tracking-wider truncate" style={{ color: 'var(--text-dim)' }}>{label}</div>
            <div className="text-xs font-mono font-semibold tabular-nums truncate" title={value} style={{ color: 'var(--text)' }}>{value}</div>
          </div>
        ))}
      </div>
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
    `Trades: ${group.tradeCount}`,
  ].join('\n');
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
      entrySnapshot: trade?.entrySnapshot,
      latestMarketData: trade?.latestMarketData,
    }, trade?.id);
  };

  const errorText = (ok: boolean, label: string) => submitted && !ok ? <p className="mt-1 text-[11px]" style={{ color: 'var(--red)' }}>{label}</p> : null;
  const inputClass = 'w-full rounded-lg px-3 py-2 text-base sm:text-sm outline-none min-h-[44px]';

  return (
    <div className="fixed inset-0 z-[80]">
      <button type="button" aria-label="Close add trade modal" onClick={onClose} className="absolute inset-0 bg-black/55" />
      <div className="absolute inset-x-2 top-3 bottom-3 sm:inset-x-1/2 sm:top-8 sm:bottom-8 sm:w-[720px] sm:-translate-x-1/2 rounded-lg overflow-y-auto p-4 sm:p-5 shadow-2xl" style={{ backgroundColor: 'var(--bg)', border: '1px solid var(--border)' }}>
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
  const navigate = useNavigate();
  const [trades, setTrades] = useState<PortfolioTrade[]>([]);
  const [editingTrade, setEditingTrade] = useState<PortfolioTrade | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showImportModal, setShowImportModal] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshWarning, setRefreshWarning] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [drawerSelection, setDrawerSelection] = useState<DrawerSelection | null>(null);
  const [markBasis, setMarkBasis] = useState<MarkBasis>(getInitialMarkBasis);
  const [sortField, setSortField] = useState<SortField>('expiration');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  useEffect(() => {
    const stored = loadPortfolioTrades();
    setTrades(stored);
    const latest = Math.max(...stored.map(trade => trade.latestMarketData?.refreshedAt ? new Date(trade.latestMarketData.refreshedAt).getTime() : 0));
    if (latest > 0) setLastRefreshed(new Date(latest));
  }, []);

  const summary = useMemo(() => calculatePortfolioSummary(trades), [trades]);
  const openTrades = useMemo(() => trades.filter(trade => trade.status === 'open'), [trades]);
  const markSummary = useMemo(() => calculatePortfolioMarkSummary(openTrades, markBasis), [openTrades, markBasis]);

  const scheduleTotals = useMemo(() => buildScheduleTotals(openTrades, markBasis), [openTrades, markBasis]);

  useEffect(() => {
    persistMarkBasis(markBasis);
  }, [markBasis]);

  const sortedTrades = useMemo(() => {
    const next = [...openTrades];
    next.sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1;
      const value = (trade: PortfolioTrade): number | string => {
        switch (sortField) {
          case 'ticker': return trade.ticker;
          case 'expiration': return trade.expiration;
          case 'dte': return calculateRemainingDte(trade) ?? 999999;
          case 'strike': return trade.strike;
          case 'contracts': return trade.contracts;
          case 'premium': return calculatePremiumCollected(trade) ?? -1;
          case 'risk': return calculateEquityAtRisk(trade) ?? -1;
          case 'pnl': return calculateTotalGainLoss(trade, markBasis) ?? -999999999;
          case 'delta': return trade.latestMarketData?.delta ?? 999999;
          default: return trade.expiration;
        }
      };
      const aVal = value(a);
      const bVal = value(b);
      if (typeof aVal === 'string' && typeof bVal === 'string') return aVal.localeCompare(bVal) * dir;
      return ((aVal as number) - (bVal as number)) * dir;
    });
    return next;
  }, [openTrades, sortField, sortDir, markBasis]);

  const persistTrades = useCallback((next: PortfolioTrade[]) => {
    savePortfolioTrades(next);
    setTrades(next);
  }, []);

  const handleSaveTrade = useCallback((input: PortfolioTradeInput, id?: string) => {
    const next = id ? updatePortfolioTrade(id, input as Partial<PortfolioTrade>) : addPortfolioTrade(input);
    setTrades(next);
    setShowAddModal(false);
    setEditingTrade(null);
  }, []);

  const handleDeleteTrade = useCallback((id: string) => {
    const next = deletePortfolioTrade(id);
    setTrades(next);
    setEditingTrade(null);
  }, []);

  const handleRefreshOpenTrades = useCallback(async () => {
    const current = loadPortfolioTrades();
    const open = current.filter(trade => trade.status === 'open');
    setTrades(current);
    if (open.length === 0) return;

    setRefreshing(true);
    setRefreshWarning(false);
    const nowIso = new Date().toISOString();
    const tickers = [...new Set(open.map(trade => trade.ticker))];
    const batchPrices = await fetchBatchPrices(tickers).catch(() => null);
    const requestKeys = [...new Set(open.map(trade => {
      const timestamp = isoToUnixSeconds(trade.expiration);
      return timestamp == null ? null : `${trade.ticker}|${timestamp}`;
    }).filter(Boolean) as string[])];

    const optionResults = await Promise.allSettled(requestKeys.map(async key => {
      const [ticker, timestamp] = key.split('|');
      return { key, data: await fetchOptions(ticker, Number(timestamp), { bypassCache: true }) };
    }));
    const optionsByKey = new Map(optionResults.map((result, index) => [
      requestKeys[index],
      result.status === 'fulfilled' ? result.value.data : null,
    ]));
    const failedKeys = new Set(optionResults.flatMap((result, index) => result.status === 'rejected' ? [requestKeys[index]] : []));

    const refreshed = current.map(trade => {
      if (trade.status !== 'open') return trade;
      const remainingDte = calculateDte(trade.expiration);
      if (isFiniteNumber(remainingDte) && remainingDte < 0) {
        return {
          ...trade,
          updatedAt: nowIso,
          latestMarketData: {
            ...trade.latestMarketData,
            dte: remainingDte,
            refreshedAt: nowIso,
            availabilityStatus: 'expired' as const,
          },
        };
      }

      const timestamp = isoToUnixSeconds(trade.expiration);
      const key = timestamp == null ? '' : `${trade.ticker}|${timestamp}`;
      const optData = optionsByKey.get(key) ?? null;
      const failed = failedKeys.has(key);
      const underlying = batchPrices?.[trade.ticker]?.price ?? optData?.currentPrice ?? trade.latestMarketData?.underlyingPrice ?? trade.entrySnapshot?.underlyingPrice ?? null;

      if (failed || !optData) {
        setRefreshWarning(true);
        return {
          ...trade,
          updatedAt: nowIso,
          latestMarketData: {
            ...trade.latestMarketData,
            underlyingPrice: underlying,
            dte: remainingDte,
            refreshedAt: nowIso,
            availabilityStatus: 'refresh_failed' as const,
          },
        };
      }

      const put = optData.puts.find(candidate => Math.abs(candidate.strike - trade.strike) < 0.01);
      if (!put) {
        setRefreshWarning(true);
        return {
          ...trade,
          updatedAt: nowIso,
          latestMarketData: {
            ...trade.latestMarketData,
            underlyingPrice: underlying,
            dte: remainingDte,
            refreshedAt: nowIso,
            availabilityStatus: 'unavailable' as const,
          },
        };
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
      return {
        ...trade,
        updatedAt: nowIso,
        latestMarketData: {
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
          availabilityStatus: 'live' as const,
        },
      };
    });

    persistTrades(refreshed);
    setLastRefreshed(new Date());
    setRefreshing(false);
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

  const sortButton = (field: SortField, label: string, align = 'text-right') => (
    <th className={`px-2 py-2 text-[11px] font-medium whitespace-nowrap ${align}`} style={{ color: 'var(--text-muted)' }}>
      <button onClick={() => {
        if (sortField === field) setSortDir(dir => dir === 'asc' ? 'desc' : 'asc');
        else {
          setSortField(field);
          setSortDir('asc');
        }
      }} className="hover:opacity-80">{label}</button>
    </th>
  );

  return (
    <div className="min-h-screen overflow-x-hidden" style={{ backgroundColor: 'var(--bg)' }}>
      <div className="max-w-[1800px] mx-auto px-2 sm:px-4 lg:px-6 py-4 sm:py-6">
        <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight" style={{ color: 'var(--text)' }}>Portfolio</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Sold cash-secured puts, local persistence, and manual market refresh.</p>
            <div className="text-[10px] mt-1" style={{ color: 'var(--text-dim)' }}>
              {lastRefreshed ? `Last refreshed: ${lastRefreshed.toLocaleString()}` : 'Last refreshed: saved snapshots are shown until you refresh open trades.'}
            </div>
          </div>
          <div className="flex flex-wrap lg:flex-nowrap items-center justify-start lg:justify-end gap-2 lg:shrink-0">
            {trades.length > 0 && <MarkBasisToggle markBasis={markBasis} onChange={setMarkBasis} />}
            <button onClick={() => setShowAddModal(true)} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium text-white min-h-[44px] sm:min-h-0 whitespace-nowrap" style={{ backgroundColor: 'var(--accent)' }}>
              <Plus className="w-3.5 h-3.5" /> Add Trade
            </button>
            <button onClick={() => setShowImportModal(true)} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium min-h-[44px] sm:min-h-0 whitespace-nowrap" style={{ backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>
              <FileImage className="w-3.5 h-3.5" /> Import Screenshot
            </button>
            <button onClick={handleRefreshOpenTrades} disabled={refreshing || openTrades.length === 0} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] sm:min-h-0 whitespace-nowrap" style={{ backgroundColor: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)' }}>
              {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Refresh Open Trades
            </button>
          </div>
        </div>
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
            <div className="grid grid-cols-2 md:grid-cols-5 xl:grid-cols-10 gap-1.5 mb-3">
              <SummaryCard label="Open Trades" value={String(summary.totalOpenTrades)} />
              <SummaryCard label="Premium Collected" value={formatCurrency(summary.totalPremiumCollected, 0)} color="var(--green)" />
              <SummaryCard label="Gross Risk" value={formatCurrency(summary.totalEquityAtRisk, 0)} />
              <SummaryCard label="Net Capital at Risk" value={formatCurrency(summary.totalNetCapitalAtRisk, 0)} />
              <SummaryCard label="Total Gain/Loss" value={formatCurrency(markSummary.totalGainLoss, 0)} color={pnlColor(markSummary.totalGainLoss)} />
              <SummaryCard label="% Captured" value={formatPctValue(markSummary.percentCaptured)} color={pnlColor(markSummary.percentCaptured)} />
              <SummaryCard label="Original AY" value={formatPctValue(markSummary.portfolioOriginalAnnualizedYield)} color="var(--accent-light)" />
              <SummaryCard label="Current AY" value={formatPctValue(markSummary.portfolioCurrentAnnualizedYield)} color="var(--accent-light)" />
              <SummaryCard label="Weighted Avg Delta" value={formatDelta(markSummary.weightedAverageDelta)} color={pnlColor(markSummary.weightedAverageDelta)} />
              <SummaryCard label="Weighted Avg DTE" value={isFiniteNumber(summary.weightedAverageRemainingDte) ? `${Math.round(summary.weightedAverageRemainingDte)} DTE` : DASH} />
            </div>

            {openTrades.length === 0 && (
              <div className="rounded-lg px-3 py-2 mb-4 text-sm" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text-muted)' }}>No open trades.</div>
            )}

            <h2 className="text-xs uppercase tracking-wider font-semibold mb-2" style={{ color: 'var(--text-muted)' }}>Schedule of Positions</h2>
            <div className="md:hidden space-y-2 mb-4">
              {sortedTrades.map(trade => (
                <div key={trade.id} className="rounded-lg p-3" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
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
            </div>

            <div className="hidden md:block rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="overflow-x-auto max-w-full overscroll-contain">
                <table className="min-w-max w-full text-[11px]">
                  <thead className="sticky top-0 z-10">
                    <tr style={{ backgroundColor: 'var(--surface-alt)', borderBottom: '1px solid var(--border)' }}>
                      {sortButton('ticker', 'Ticker', 'text-left')}
                      {sortButton('expiration', 'Expiry')}
                      {sortButton('dte', 'DTE')}
                      {sortButton('strike', 'Strike')}
                      {sortButton('contracts', 'Contracts')}
                      <th className="px-2 py-2 text-[11px] font-medium text-right" style={{ color: 'var(--text-muted)' }}>Sold Price</th>
                      <th className="px-2 py-2 text-[11px] font-medium text-right" style={{ color: 'var(--text-muted)' }}>Premium Collected</th>
                      {sortButton('risk', 'Gross Risk')}
                      <th className="px-2 py-2 text-[11px] font-medium text-right" style={{ color: 'var(--text-muted)' }}>Net Capital at Risk</th>
                      <th className="px-2 py-2 text-[11px] font-medium text-right" style={{ color: 'var(--text-muted)' }}>Breakeven</th>
                      <th className="px-2 py-2 text-[11px] font-medium text-right" style={{ color: 'var(--text-muted)' }}>Current Mark</th>
                      <th className="px-2 py-2 text-[11px] font-medium text-right" style={{ color: 'var(--text-muted)' }}>Current Value</th>
                      {sortButton('pnl', 'Total Gain/Loss')}
                      <th className="px-2 py-2 text-[11px] font-medium text-right" style={{ color: 'var(--text-muted)' }}>% Captured</th>
                      {sortButton('delta', 'Delta')}
                      <th className="px-2 py-2 text-[11px] font-medium text-right" style={{ color: 'var(--text-muted)' }}>Underlying</th>
                      <th className="px-2 py-2 text-[11px] font-medium text-right" style={{ color: 'var(--text-muted)' }}>Distance to Strike</th>
                      <th className="px-2 py-2 text-[11px] font-medium text-right" style={{ color: 'var(--text-muted)' }}>IV</th>
                      <th className="px-2 py-2 text-[11px] font-medium text-right" style={{ color: 'var(--text-muted)' }}>OI / Volume</th>
                      <th className="px-2 py-2 text-[11px] font-medium text-right" style={{ color: 'var(--text-muted)' }}>Original NY</th>
                      <th className="px-2 py-2 text-[11px] font-medium text-right" style={{ color: 'var(--text-muted)' }}>Original AY</th>
                      <th className="px-2 py-2 text-[11px] font-medium text-right" style={{ color: 'var(--text-muted)' }}>Current NY</th>
                      <th className="px-2 py-2 text-[11px] font-medium text-right" style={{ color: 'var(--text-muted)' }}>Current AY</th>
                      <th className="px-2 py-2 text-[11px] font-medium text-left min-w-[160px]" style={{ color: 'var(--text-muted)' }}>Notes</th>
                      <th className="px-2 py-2 text-[11px] font-medium text-left" style={{ color: 'var(--text-muted)' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedTrades.map((trade, index) => {
                      const totalGainLoss = calculateTotalGainLoss(trade, markBasis);
                      const currentValue = calculateCurrentPositionValue(trade, markBasis);
                      const currentMark = calculateCurrentOptionMark(trade, markBasis);
                      const delta = trade.latestMarketData?.delta ?? null;
                      const redeployBadges = getRedeployBadges(trade, markBasis);
                      return (
                        <tr key={trade.id} style={{ borderBottom: '1px solid var(--border)', backgroundColor: index % 2 ? 'var(--row-alt)' : 'transparent' }}>
                          <td className="px-2 py-1 text-left font-mono font-bold whitespace-nowrap">
                            <button onClick={() => navigate(`/options/${trade.ticker.trim().toUpperCase()}`)} className="underline-offset-2 hover:underline" style={{ color: 'var(--accent-light)' }}>{trade.ticker}</button>
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap">{expiryLabel(trade.expiration)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap">{formatDteValue(calculateRemainingDte(trade))}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap">
                            <button onClick={() => openDrawer(trade)} className="underline-offset-2 hover:underline">{formatCurrency(trade.strike)}</button>
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{trade.contracts}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatOptionPrice(trade.soldPrice)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatCurrency(calculatePremiumCollected(trade), 0)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatCurrency(calculateEquityAtRisk(trade), 0)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatCurrency(calculateNetCapitalAtRisk(trade), 0)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatCurrency(calculateBreakeven(trade))}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatOptionPrice(currentMark)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatCurrency(currentValue, 0)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums" style={{ color: pnlColor(totalGainLoss) }}>{formatCurrency(totalGainLoss, 0)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums" style={{ color: pnlColor(calculatePercentCaptured(trade, markBasis)) }}>{formatPctValue(calculatePercentCaptured(trade, markBasis))}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums" style={{ color: pnlColor(delta) }}>{formatDelta(delta)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatCurrency(trade.latestMarketData?.underlyingPrice ?? trade.entrySnapshot?.underlyingPrice)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums" style={{ color: percentColor(calculateDistanceToStrike(trade)) }}>{formatPctValue(calculateDistanceToStrike(trade))}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatPercentPoints(trade.latestMarketData?.iv, 1)}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums whitespace-nowrap">{isFiniteNumber(trade.latestMarketData?.openInterest) || isFiniteNumber(trade.latestMarketData?.volume) ? `${trade.latestMarketData?.openInterest ?? DASH} / ${trade.latestMarketData?.volume ?? DASH}` : DASH}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatPctValue(calculateOriginalNominalYield(trade))}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatPctValue(calculateOriginalAnnualizedYield(trade))}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatPctValue(calculateCurrentNominalYield(trade, markBasis))}</td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums">{formatPctValue(calculateCurrentAnnualizedYield(trade, markBasis))}</td>
                          <td className="px-2 py-1 text-left w-[240px] max-w-[240px]" style={{ color: trade.notes ? 'var(--text-secondary)' : 'var(--text-dim)' }}>
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
                          </td>
                          <td className="px-2 py-1 whitespace-nowrap">
                            <div className="flex items-center gap-1">
                              <button onClick={() => setEditingTrade(trade)} className="p-1.5 rounded" title="Edit" style={{ color: 'var(--text-muted)' }}><Edit2 className="w-3.5 h-3.5" /></button>
                              <button onClick={() => handleDeleteTrade(trade.id)} className="p-1.5 rounded" title="Delete" style={{ color: 'var(--red)' }}><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    <tr style={{ backgroundColor: 'var(--surface-alt)', borderTop: '2px solid var(--accent-border)', color: 'var(--text)' }}>
                      <td className="px-2 py-2 text-left font-bold uppercase tracking-wider whitespace-nowrap">Totals</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{isFiniteNumber(scheduleTotals.dte) ? `${Math.round(scheduleTotals.dte)} DTE` : DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: 'var(--green)' }}>{formatCurrency(scheduleTotals.premium, 0)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold">{formatCurrency(scheduleTotals.grossRisk, 0)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold">{formatCurrency(scheduleTotals.netRisk, 0)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold">{formatCurrency(scheduleTotals.currentValue, 0)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: pnlColor(scheduleTotals.totalGainLoss) }}>{formatCurrency(scheduleTotals.totalGainLoss, 0)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: pnlColor(scheduleTotals.percentCaptured) }}>{formatPctValue(scheduleTotals.percentCaptured)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: pnlColor(scheduleTotals.weightedAverageDelta) }}>{formatDelta(scheduleTotals.weightedAverageDelta)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums">{DASH}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold">{formatPctValue(scheduleTotals.originalNominalYield)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold">{formatPctValue(scheduleTotals.originalAnnualizedYield)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold">{formatPctValue(scheduleTotals.currentNominalYield)}</td>
                      <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold">{formatPctValue(scheduleTotals.currentAnnualizedYield)}</td>
                      <td className="px-2 py-2 text-left text-[10px]" style={{ color: 'var(--text-dim)' }}>Portfolio-level yields use aggregate dollar-days.</td>
                      <td className="px-2 py-2 text-left">{DASH}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            <div className="mt-3 text-[10px]" style={{ color: 'var(--text-dim)' }}>
              Closed trades: {summary.totalClosedTrades} · Current mark-dependent metrics use the selected {markBasis.toUpperCase()} basis and show {DASH} when that mark is unavailable.
            </div>

            <section className="mt-4">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>Portfolio Analytics</h2>
                <span className="text-[10px]" style={{ color: 'var(--text-dim)' }}>Compact risk and yield views</span>
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
                <RiskCockpit
                  trades={openTrades}
                  markBasis={markBasis}
                  onTickerClick={ticker => navigate(`/options/${ticker.trim().toUpperCase()}`)}
                  onDetailsClick={openDrawer}
                />
                <YieldAnalytics
                  trades={openTrades}
                  markBasis={markBasis}
                  markSummary={markSummary}
                  totalPremiumCollected={summary.totalPremiumCollected}
                  onTickerClick={ticker => navigate(`/options/${ticker.trim().toUpperCase()}`)}
                />
                <ConcentrationInsights
                  trades={openTrades}
                  byTicker={groupByTicker(openTrades, markBasis)}
                  totalGrossRisk={sumValues(openTrades.map(calculateEquityAtRisk))}
                />
              </div>
            </section>
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
        <PortfolioScreenshotImportModal
          trades={trades}
          onClose={() => setShowImportModal(false)}
          onApply={nextTrades => {
            persistTrades(nextTrades);
            setShowImportModal(false);
          }}
        />
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

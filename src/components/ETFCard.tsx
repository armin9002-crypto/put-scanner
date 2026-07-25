import type { ETFInfo } from '../lib/types';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  isScannerOptionSnapshotStale,
  scannerLiquidityLabelText,
  type ScannerLiquidityLabel,
  type ScannerOptionSnapshot,
} from '../lib/scannerOptionSnapshot';

interface ETFCardProps {
  etf: ETFInfo;
  to: string;
  priceData?: {
    price: number | null;
    change: number | null;
    changePct: number | null;
    high52w: number | null;
    low52w: number | null;
    fiveDay: number | null;
    oneMonth: number | null;
    threeMonth: number | null;
    fiftyTwoWeekHighPct: number | null;
    posIn52wRange: number | null;
  } | null;
  optionSnapshot?: ScannerOptionSnapshot | null;
  priceError?: boolean;
  onRetry?: () => void;
}

function Skeleton({ w = 14 }: { w?: number }) {
  return <div className="h-3.5 rounded animate-pulse" style={{ backgroundColor: 'var(--border)', width: w }} />;
}

function fiftyTwoWeekPosition(price: number, high: number, low: number): number {
  if (high <= low) return 50;
  return ((price - low) / (high - low)) * 100;
}

function rangePositionStyle(price: number, high: number | null, low: number | null): { borderColor: string; bgTint: string } | null {
  if (high == null || low == null || high <= low) return null;
  const pos = fiftyTwoWeekPosition(price, high, low);
  if (pos < 30) return { borderColor: '#22c55e', bgTint: 'rgba(34,197,94,0.04)' };
  if (pos <= 60) return { borderColor: '#f59e0b', bgTint: 'rgba(245,158,11,0.03)' };
  return { borderColor: '#475569', bgTint: 'transparent' };
}

function formatSignedPct(value: number | null): string {
  if (value == null) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function changeColor(value: number | null): string {
  return value == null ? 'var(--text-dim)' : value >= 0 ? 'var(--green)' : 'var(--red)';
}

function snapshotIvText(snapshot: ScannerOptionSnapshot | null | undefined): string {
  const iv = snapshot?.atmPutIv;
  if (iv == null || !Number.isFinite(iv) || iv <= 0) return '—';
  return `${iv.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`;
}

function liquidityColor(label: ScannerLiquidityLabel | undefined): string {
  if (label === 'very_liquid' || label === 'liquid') return 'var(--green)';
  if (label === 'medium') return 'var(--yellow)';
  if (label === 'thin') return 'var(--orange)';
  if (label === 'illiquid') return 'var(--red)';
  return 'var(--text-dim)';
}

function formatSnapshotMoney(value: number | null | undefined): string {
  return value != null && Number.isFinite(value) ? `$${value.toFixed(2)}` : '—';
}

function formatSnapshotDate(timestamp: number | null | undefined): string {
  if (timestamp == null || !Number.isFinite(timestamp)) return '—';
  return new Date(timestamp * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatSnapshotNumber(value: number | null | undefined, fractionDigits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  });
}

function formatSnapshotUpdatedAt(value: string | null | undefined): string {
  if (!value) return '—';
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toLocaleString('en-US') : '—';
}

function SnapshotMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 leading-5">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <span className="font-mono tabular-nums text-right" style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  );
}

function ScannerSnapshotTooltip({ id, snapshot }: { id: string; snapshot: ScannerOptionSnapshot | null | undefined }) {
  const stale = snapshot ? isScannerOptionSnapshotStale(snapshot) : false;
  const liquidityText = scannerLiquidityLabelText(snapshot?.liquidityLabel ?? 'unavailable');
  const expirationText = snapshot
    ? `${formatSnapshotDate(snapshot.expiration)} · ${snapshot.dte} DTE`
    : '—';

  return (
    <div
      id={id}
      role="tooltip"
      className="scanner-snapshot-tooltip pointer-events-none absolute bottom-5 right-0 z-30 w-[min(290px,calc(100vw-2rem))] rounded-lg px-3 py-2 text-[11px] opacity-0 shadow-xl transition-opacity group-hover/snapshot:opacity-100 group-focus-within:opacity-100"
      style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', boxShadow: 'var(--shadow)' }}
    >
      <div className="mb-1 text-xs font-semibold">60-Day Options Snapshot</div>
      <div className="mb-2" style={{ color: 'var(--text-secondary)' }}>{expirationText}</div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>ATM Put</div>
      <SnapshotMetric label="Strike" value={formatSnapshotMoney(snapshot?.atmStrike)} />
      <SnapshotMetric label="IV" value={snapshotIvText(snapshot)} />
      <div className="mb-1 mt-2 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Approximately 30% OTM Put</div>
      <SnapshotMetric label="Strike" value={snapshot?.liquidityStrike != null && snapshot.actualOtmPercent != null && Number.isFinite(snapshot.actualOtmPercent) ? `${formatSnapshotMoney(snapshot.liquidityStrike)} · ${snapshot.actualOtmPercent.toFixed(1)}% OTM` : '—'} />
      <SnapshotMetric label="Bid / Ask" value={`${formatSnapshotMoney(snapshot?.bid)} / ${formatSnapshotMoney(snapshot?.ask)}`} />
      <SnapshotMetric label="Mid / Last" value={`${formatSnapshotMoney(snapshot?.midpoint)} / ${formatSnapshotMoney(snapshot?.last)}`} />
      <SnapshotMetric label="Last Trade" value={formatSnapshotDate(snapshot?.lastTradeDate)} />
      <SnapshotMetric label="Open Interest" value={formatSnapshotNumber(snapshot?.openInterest)} />
      <SnapshotMetric label="Volume" value={formatSnapshotNumber(snapshot?.volume)} />
      <SnapshotMetric label="Spread" value={snapshot?.spreadPercent != null && Number.isFinite(snapshot.spreadPercent) ? `${(snapshot.spreadPercent * 100).toFixed(1)}%` : '—'} />
      <div className="mt-2 flex items-center justify-between gap-3 border-t pt-1.5" style={{ borderColor: 'var(--border)' }}>
        <span style={{ color: 'var(--text-muted)' }}>Liquidity</span>
        <span className="font-semibold" style={{ color: liquidityColor(snapshot?.liquidityLabel) }}>{liquidityText}</span>
      </div>
      <div className="mt-1 text-[10px]" style={{ color: 'var(--text-dim)' }}>
        Updated: {formatSnapshotUpdatedAt(snapshot?.updatedAt)}{stale ? ' · Stale' : ''}
      </div>
    </div>
  );
}

function MetricCell({ label, value, formatter = formatSignedPct, color }: { label: string; value: number | null; formatter?: (value: number | null) => string; color?: string }) {
  const resolvedColor = color ?? changeColor(value);
  return (
    <div className="min-w-0 content-center">
      <div className="text-[9px] uppercase tracking-wider leading-none" style={{ color: 'var(--text-dim)' }}>{label}</div>
      <div className="text-xs font-mono font-medium tabular-nums mt-0.5 truncate" title={formatter(value)} style={{ color: resolvedColor }}>{formatter(value)}</div>
    </div>
  );
}

function FiftyTwoWeekHighCell({ value }: { value: number | null }) {
  const nearHigh = value != null && value >= -2;
  return (
    <div className="min-w-0 content-center">
      <div className="text-[9px] uppercase tracking-wider leading-none" style={{ color: 'var(--text-dim)' }}>52W Hi</div>
      <div className="text-xs font-mono font-medium tabular-nums mt-0.5 truncate" style={{ color: value == null ? 'var(--text-dim)' : nearHigh ? 'var(--green)' : 'var(--red)' }}>
        {value == null ? '--' : nearHigh ? 'Near Hi' : formatSignedPct(value)}
      </div>
    </div>
  );
}

function PerformanceMetrics({
  fiveDay,
  oneMonth,
  threeMonth,
  fiftyTwoWeekHighPct,
}: {
  fiveDay: number | null;
  oneMonth: number | null;
  threeMonth: number | null;
  fiftyTwoWeekHighPct: number | null;
}) {
  return (
    <div className="h-full flex-1 grid grid-cols-2 gap-x-2 gap-y-1 content-center">
      <MetricCell label="5D" value={fiveDay} />
      <MetricCell label="1M" value={oneMonth} />
      <MetricCell label="3M" value={threeMonth} />
      <FiftyTwoWeekHighCell value={fiftyTwoWeekHighPct} />
    </div>
  );
}

function PricePlaceholder({ showPriceSkeleton = false }: { showPriceSkeleton?: boolean }) {
  return (
    <>
      {showPriceSkeleton ? (
        <Skeleton w={72} />
      ) : (
        <div className="text-base font-semibold font-mono leading-tight" style={{ color: 'var(--text-dim)' }}>$--</div>
      )}
      <div className="text-xs font-mono leading-tight" style={{ color: 'var(--text-dim)' }}>-- (--)</div>
    </>
  );
}

export default function ETFCard({
  etf,
  to,
  priceData,
  optionSnapshot,
  priceError,
  onRetry,
}: ETFCardProps) {
  const hasValidPrice = priceData && priceData.price != null && priceData.price > 0;
  const changePositive = hasValidPrice ? (priceData!.changePct ?? 0) >= 0 : true;
  const rangeStyle = hasValidPrice ? rangePositionStyle(priceData!.price!, priceData!.high52w, priceData!.low52w) : null;
  const snapshotTooltipId = `scanner-option-snapshot-${etf.ticker}`;
  const liquidityText = scannerLiquidityLabelText(optionSnapshot?.liquidityLabel ?? 'unavailable');

  return (
    <div
      title={`${etf.ticker} - ${etf.name}`}
      className="group rounded-xl p-3 text-left transition-all duration-200 w-full relative min-w-0 focus-within:ring-2 focus-within:ring-indigo-500/60"
      style={{
        backgroundColor: rangeStyle ? rangeStyle.bgTint : 'var(--surface)',
        border: `1px solid ${rangeStyle ? rangeStyle.borderColor : 'var(--border)'}`,
        borderLeftWidth: rangeStyle ? '3px' : '1px',
        boxShadow: 'var(--shadow)',
      }}
    >
      <Link
        to={to}
        aria-label={`Open ${etf.ticker} options`}
        aria-describedby={snapshotTooltipId}
        className="absolute inset-0 z-0 rounded-xl focus:outline-none"
      />

      <span className="pointer-events-none absolute top-2 right-2 z-10 text-xs font-semibold px-1.5 py-0.5 rounded-md leading-none" style={{ color: 'var(--accent-light)', backgroundColor: 'var(--accent-bg)', border: '1px solid var(--accent-border)' }}>
        {etf.leverage}
      </span>

      <div className="pointer-events-none relative z-10 flex flex-row gap-3 pr-8 min-w-0">
        <div className="flex flex-col justify-between flex-shrink-0 w-[52%] sm:w-1/2 min-w-0">
          <div>
            <div className="flex items-baseline gap-1.5 min-w-0">
              <span className="text-lg font-bold font-mono tracking-tight leading-none flex-shrink-0" style={{ color: 'var(--text)' }}>{etf.ticker}</span>
              <span className="text-xs leading-tight truncate" style={{ color: 'var(--text-muted)' }}>{etf.name}</span>
            </div>
            <div className="text-xs leading-tight truncate mt-0.5" style={{ color: 'var(--text-dim)' }}>{etf.underlying}</div>
          </div>

          <div className="mt-1">
            {hasValidPrice ? (
              <>
                <div className="text-base font-semibold font-mono tabular-nums leading-tight" style={{ color: 'var(--text)' }}>
                  ${priceData!.price!.toFixed(2)}
                </div>
                {priceData!.change != null && priceData!.changePct != null && (
                <div className="flex items-center gap-1 text-xs font-mono tabular-nums leading-tight min-w-0" style={{ color: changePositive ? 'var(--green)' : 'var(--red)' }}>
                  {changePositive ? <TrendingUp className="w-3 h-3 flex-shrink-0" /> : <TrendingDown className="w-3 h-3 flex-shrink-0" />}
                    <span className="truncate">{changePositive ? '+$' : '-$'}{Math.abs(priceData!.change).toFixed(2)}</span>
                    <span className="truncate">({changePositive ? '+' : '-'}{Math.abs(priceData!.changePct).toFixed(2)}%)</span>
                  </div>
                )}
              </>
            ) : priceError ? (
              <>
                <PricePlaceholder />
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="pointer-events-auto relative z-20 block text-[10px] mt-0.5 underline"
                    style={{ color: 'var(--accent-light)' }}
                  >
                    Retry
                  </button>
                )}
              </>
            ) : (
              <PricePlaceholder showPriceSkeleton />
            )}
          </div>
        </div>

        {hasValidPrice ? (
          <PerformanceMetrics
            fiveDay={priceData!.fiveDay ?? null}
            oneMonth={priceData!.oneMonth ?? null}
            threeMonth={priceData!.threeMonth ?? null}
            fiftyTwoWeekHighPct={priceData!.fiftyTwoWeekHighPct ?? null}
          />
        ) : (
          <PerformanceMetrics fiveDay={null} oneMonth={null} threeMonth={null} fiftyTwoWeekHighPct={null} />
        )}
      </div>

      <Link
        to={to}
        aria-label={`${etf.ticker} IV60 ${snapshotIvText(optionSnapshot)}, liquidity ${liquidityText}`}
        aria-describedby={snapshotTooltipId}
        className="group/snapshot absolute bottom-2 right-2 z-20 flex w-[44%] items-center justify-between gap-1 whitespace-nowrap text-[10px] font-medium leading-none focus:outline-none"
      >
        <span style={{ color: 'var(--text-dim)' }}>IV60 <span style={{ color: 'var(--text-secondary)' }}>{snapshotIvText(optionSnapshot)}</span></span>
        <span style={{ color: 'var(--text-dim)' }}>·</span>
        <span className="truncate" style={{ color: liquidityColor(optionSnapshot?.liquidityLabel) }}>{liquidityText}</span>
        <ScannerSnapshotTooltip id={snapshotTooltipId} snapshot={optionSnapshot} />
      </Link>
    </div>
  );
}

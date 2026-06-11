import type { ETFInfo } from '../lib/types';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface ETFCardProps {
  etf: ETFInfo;
  onClick: () => void;
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

function ivEnvStyle(price: number, high: number | null, low: number | null): { borderColor: string; bgTint: string; badge: string; badgeColor: string } | null {
  if (high == null || low == null || high <= low) return null;
  const pos = fiftyTwoWeekPosition(price, high, low);
  if (pos < 30) return { borderColor: '#22c55e', bgTint: 'rgba(34,197,94,0.04)', badge: 'Rich IV', badgeColor: '#22c55e' };
  if (pos <= 60) return { borderColor: '#f59e0b', bgTint: 'rgba(245,158,11,0.03)', badge: 'Mod IV', badgeColor: '#f59e0b' };
  return { borderColor: '#475569', bgTint: 'transparent', badge: 'Low IV', badgeColor: '#475569' };
}

function formatSignedPct(value: number | null): string {
  if (value == null) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function changeColor(value: number | null): string {
  return value == null ? 'var(--text-dim)' : value >= 0 ? 'var(--green)' : 'var(--red)';
}

function formatCurrency(value: number | null | undefined): string {
  return value == null ? '--' : `$${value.toFixed(2)}`;
}

function formatSignedCurrency(value: number | null | undefined): string {
  if (value == null) return '--';
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function ScannerCardTooltip({ etf, priceData, ivStatus }: { etf: ETFInfo; priceData: ETFCardProps['priceData']; ivStatus: string | null }) {
  const dayChange = priceData?.change != null && priceData.changePct != null
    ? `${formatSignedCurrency(priceData.change)} (${formatSignedPct(priceData.changePct)})`
    : '--';

  return (
    <div
      className="pointer-events-none absolute left-3 right-3 top-3 z-30 hidden rounded-lg px-3 py-2 text-xs opacity-0 shadow-xl transition-opacity group-hover:block group-hover:opacity-100 group-focus-visible:block group-focus-visible:opacity-100 sm:block sm:translate-y-[-105%]"
      style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)', boxShadow: 'var(--shadow)' }}
    >
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-bold">{etf.ticker}</span>
        <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ backgroundColor: 'var(--accent-bg)', color: 'var(--accent-light)', border: '1px solid var(--accent-border)' }}>{etf.leverage}</span>
      </div>
      <div className="mb-1 leading-4" style={{ color: 'var(--text-secondary)' }}>{etf.name}</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[11px] tabular-nums">
        <span style={{ color: 'var(--text-muted)' }}>Theme</span><span className="text-right truncate" style={{ color: 'var(--text)' }}>{etf.underlying}</span>
        <span style={{ color: 'var(--text-muted)' }}>Price</span><span className="text-right" style={{ color: 'var(--text)' }}>{formatCurrency(priceData?.price)}</span>
        <span style={{ color: 'var(--text-muted)' }}>Day</span><span className="text-right" style={{ color: changeColor(priceData?.changePct ?? null) }}>{dayChange}</span>
        <span style={{ color: 'var(--text-muted)' }}>5D / 1M / 3M</span>
        <span className="text-right" style={{ color: 'var(--text)' }}>{formatSignedPct(priceData?.fiveDay ?? null)} / {formatSignedPct(priceData?.oneMonth ?? null)} / {formatSignedPct(priceData?.threeMonth ?? null)}</span>
        <span style={{ color: 'var(--text-muted)' }}>IV status</span><span className="text-right" style={{ color: 'var(--text)' }}>{ivStatus ?? '--'}</span>
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
  onClick,
  priceData,
  priceError,
  onRetry,
}: ETFCardProps) {
  const hasValidPrice = priceData && priceData.price != null && priceData.price > 0;
  const changePositive = hasValidPrice ? (priceData!.changePct ?? 0) >= 0 : true;
  const ivEnv = hasValidPrice ? ivEnvStyle(priceData!.price!, priceData!.high52w, priceData!.low52w) : null;

  return (
    <button
      onClick={onClick}
      title={`${etf.ticker} - ${etf.name}`}
      className="group rounded-xl p-3 text-left transition-all duration-200 w-full relative min-w-0"
      style={{
        backgroundColor: ivEnv ? ivEnv.bgTint : 'var(--surface)',
        border: `1px solid ${ivEnv ? ivEnv.borderColor : 'var(--border)'}`,
        borderLeftWidth: ivEnv ? '3px' : '1px',
        boxShadow: 'var(--shadow)',
      }}
    >
      <span className="absolute top-2 right-2 text-xs font-semibold px-1.5 py-0.5 rounded-md leading-none" style={{ color: 'var(--accent-light)', backgroundColor: 'var(--accent-bg)', border: '1px solid var(--accent-border)' }}>
        {etf.leverage}
      </span>

      <div className="flex flex-row gap-3 pr-8 min-w-0">
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
                    onClick={(e) => { e.stopPropagation(); onRetry(); }}
                    className="block text-[10px] mt-0.5 underline"
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

      {ivEnv && (
        <span className="hidden sm:block absolute right-2 bottom-2 text-[10px] font-semibold leading-none" style={{ color: ivEnv.badgeColor }}>
          {ivEnv.badge}
        </span>
      )}
      <ScannerCardTooltip etf={etf} priceData={priceData ?? null} ivStatus={ivEnv?.badge ?? null} />
    </button>
  );
}

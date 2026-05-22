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
    fiftyTwoWeekChangePct: number | null;
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

function formatSignedDollar(value: number | null): string {
  if (value == null) return '--';
  return `${value >= 0 ? '+$' : '-$'}${Math.abs(value).toFixed(2)}`;
}

function formatSignedPct(value: number | null): string {
  if (value == null) return '--';
  return `${value >= 0 ? '+' : ''}${value.toFixed(1)}%`;
}

function formatWholePct(value: number | null): string {
  if (value == null) return '--';
  return `${value.toFixed(0)}%`;
}

function changeColor(value: number | null): string {
  return value == null ? 'var(--text-dim)' : value >= 0 ? 'var(--green)' : 'var(--red)';
}

function posColor(value: number | null): string {
  if (value == null) return 'var(--text-dim)';
  if (value > 60) return 'var(--green)';
  if (value >= 40) return 'var(--yellow)';
  return 'var(--red)';
}

function MetricCell({ label, value, formatter = formatSignedPct, color }: { label: string; value: number | null; formatter?: (value: number | null) => string; color?: string }) {
  const resolvedColor = color ?? changeColor(value);
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider leading-none" style={{ color: 'var(--text-dim)' }}>{label}</div>
      <div className="text-xs font-mono tabular-nums mt-0.5" style={{ color: resolvedColor }}>{formatter(value)}</div>
    </div>
  );
}

function RangeMetricCell({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider leading-none" style={{ color: 'var(--text-dim)' }}>{label}</div>
      <div className="text-xs font-mono tabular-nums mt-0.5" style={{ color: posColor(value) }}>{formatWholePct(value)}</div>
    </div>
  );
}

function PricePlaceholder() {
  return (
    <div className="mt-2">
      <div className="text-lg font-bold font-mono" style={{ color: 'var(--text-dim)' }}>$--</div>
      <div className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-dim)' }}>-- (--)</div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2">
        <MetricCell label="Day $" value={null} formatter={formatSignedDollar} />
        <MetricCell label="Day %" value={null} />
        <MetricCell label="52W Hi" value={null} />
        <RangeMetricCell label="52W Pos" value={null} />
      </div>
    </div>
  );
}

export default function ETFCard({ etf, onClick, priceData, priceError, onRetry }: ETFCardProps) {
  const hasValidPrice = priceData && priceData.price != null && priceData.price > 0;
  const changePositive = hasValidPrice ? (priceData!.changePct ?? 0) >= 0 : true;
  const ivEnv = hasValidPrice ? ivEnvStyle(priceData!.price!, priceData!.high52w, priceData!.low52w) : null;
  const hi52Pct = priceData?.price != null && priceData.high52w != null && priceData.high52w > 0
    ? ((priceData.price - priceData.high52w) / priceData.high52w) * 100
    : null;
  const pos52w = priceData?.posIn52wRange ?? null;

  return (
    <button
      onClick={onClick}
      className="group rounded-xl p-3 text-left transition-all duration-200 w-full relative"
      style={{
        backgroundColor: ivEnv ? ivEnv.bgTint : 'var(--surface)',
        border: `1px solid ${ivEnv ? ivEnv.borderColor : 'var(--border)'}`,
        borderLeftWidth: ivEnv ? '4px' : '1px',
        boxShadow: 'var(--shadow)',
      }}
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-lg font-bold font-mono tracking-tight" style={{ color: 'var(--text)' }}>{etf.ticker}</span>
        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md" style={{ color: 'var(--accent-light)', backgroundColor: 'var(--accent-bg)', border: '1px solid var(--accent-border)' }}>
          {etf.leverage}
        </span>
      </div>

      <p className="text-xs mb-0.5 leading-snug line-clamp-1" style={{ color: 'var(--text-muted)' }}>{etf.name}</p>
      <p className="text-xs mb-2" style={{ color: 'var(--text-dim)' }}>{etf.underlying}</p>

      <div>
        {hasValidPrice ? (
          <div>
            <span className="text-lg font-bold font-mono tabular-nums" style={{ color: 'var(--text)' }}>
              ${priceData!.price!.toFixed(2)}
            </span>
            {priceData!.change != null && priceData!.changePct != null && (
              <div className="flex items-center gap-1 text-xs font-mono tabular-nums mt-0.5" style={{ color: changePositive ? 'var(--green)' : 'var(--red)' }}>
                {changePositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                <span>{changePositive ? '+$' : '-$'}{Math.abs(priceData!.change).toFixed(2)}</span>
                <span>({changePositive ? '+' : '-'}{Math.abs(priceData!.changePct).toFixed(2)}%)</span>
              </div>
            )}
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2">
              <MetricCell label="Day $" value={priceData!.change} formatter={formatSignedDollar} />
              <MetricCell label="Day %" value={priceData!.changePct} />
              <MetricCell label="52W Hi" value={hi52Pct} />
              <RangeMetricCell label="52W Pos" value={pos52w} />
            </div>
          </div>
        ) : priceError ? (
          <div>
            <PricePlaceholder />
            {onRetry && (
              <button
                onClick={(e) => { e.stopPropagation(); onRetry(); }}
                className="block text-[10px] mt-1 underline"
                style={{ color: 'var(--accent-light)' }}
              >
                Retry
              </button>
            )}
          </div>
        ) : (
          <div>
            <Skeleton w={72} />
            <div className="mt-1"><Skeleton w={96} /></div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 mt-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i}>
                  <Skeleton w={24} />
                  <div className="mt-1"><Skeleton w={36} /></div>
                </div>
              ))}
            </div>
          </div>
        )}
        {ivEnv && (
          <span className="hidden sm:block absolute right-3 bottom-3 text-[9px] font-semibold" style={{ color: ivEnv.badgeColor }}>
            {ivEnv.badge}
          </span>
        )}
      </div>
    </button>
  );
}

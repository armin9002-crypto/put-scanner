import type { ETFInfo } from '../lib/types';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface ETFCardProps {
  etf: ETFInfo;
  onClick: () => void;
  priceData?: { price: number; change: number; changePct: number; high52w: number | null; low52w: number | null } | null;
}

function Skeleton({ w = 14 }: { w?: number }) {
  return <div className="h-3.5 rounded animate-pulse" style={{ backgroundColor: 'var(--border)', width: w }} />;
}

function fiftyTwoWeekPosition(price: number, high: number, low: number): number {
  if (high <= low) return 50;
  return ((price - low) / (high - low)) * 100;
}

function fiftyTwoWeekPosColor(price: number, high: number, low: number): string {
  const pos = fiftyTwoWeekPosition(price, high, low);
  if (pos >= 80) return 'var(--green)';
  if (pos >= 50) return 'var(--yellow)';
  if (pos >= 20) return 'var(--orange)';
  return 'var(--red)';
}

function ivEnvStyle(price: number, high: number | null, low: number | null): { borderColor: string; bgTint: string; badge: string; badgeColor: string } | null {
  if (high == null || low == null || high <= low) return null;
  const pos = fiftyTwoWeekPosition(price, high, low);
  if (pos < 30) return { borderColor: '#22c55e', bgTint: 'rgba(34,197,94,0.04)', badge: 'Rich IV', badgeColor: '#22c55e' };
  if (pos <= 60) return { borderColor: '#f59e0b', bgTint: 'rgba(245,158,11,0.03)', badge: 'Mod IV', badgeColor: '#f59e0b' };
  return { borderColor: '#475569', bgTint: 'transparent', badge: 'Low IV', badgeColor: '#475569' };
}

export default function ETFCard({ etf, onClick, priceData }: ETFCardProps) {
  const changePositive = priceData ? priceData.changePct >= 0 : true;
  const ivEnv = priceData ? ivEnvStyle(priceData.price, priceData.high52w, priceData.low52w) : null;

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

      <div className="flex items-end justify-between">
        {priceData ? (
          <div className="flex-1">
            <span className="text-base font-semibold font-mono" style={{ color: 'var(--text)' }}>
              ${priceData.price.toFixed(2)}
            </span>
            <div className="flex items-center gap-1 text-xs font-mono mt-0.5" style={{ color: changePositive ? 'var(--green)' : 'var(--red)' }}>
              {changePositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              <span>{changePositive ? '+$' : '-$'}{Math.abs(priceData.change).toFixed(2)}</span>
              <span>({changePositive ? '+' : '-'}{Math.abs(priceData.changePct).toFixed(2)}%)</span>
            </div>
            {priceData.high52w != null && priceData.low52w != null && priceData.high52w > priceData.low52w && (
              <div className="mt-1.5">
                <div className="flex items-center justify-between text-[9px] mb-0.5">
                  <span style={{ color: 'var(--text-dim)' }}>52W Position</span>
                  <span className="font-mono font-semibold" style={{ color: fiftyTwoWeekPosColor(priceData.price, priceData.high52w, priceData.low52w) }}>
                    {fiftyTwoWeekPosition(priceData.price, priceData.high52w, priceData.low52w).toFixed(0)}%
                  </span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(2, Math.min(100, fiftyTwoWeekPosition(priceData.price, priceData.high52w, priceData.low52w)))}%`,
                      backgroundColor: fiftyTwoWeekPosColor(priceData.price, priceData.high52w, priceData.low52w),
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div>
            <Skeleton w={60} />
            <Skeleton w={80} />
          </div>
        )}
        {ivEnv && (
          <span className="hidden sm:block text-[9px] font-semibold ml-2 self-end mb-0.5" style={{ color: ivEnv.badgeColor }}>
            {ivEnv.badge}
          </span>
        )}
      </div>
    </button>
  );
}

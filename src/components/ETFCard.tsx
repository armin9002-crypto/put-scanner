import type { ETFInfo } from '../lib/types';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface ETFCardProps {
  etf: ETFInfo;
  onClick: () => void;
  priceData?: { price: number; change: number; changePct: number; fiftyTwoWeekHigh: number | null; fiftyTwoWeekLow: number | null } | null;
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

export default function ETFCard({ etf, onClick, priceData }: ETFCardProps) {
  const changePositive = priceData ? priceData.changePct >= 0 : true;

  return (
    <button
      onClick={onClick}
      className="group rounded-xl p-3 text-left transition-all duration-200 w-full"
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
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
          <div>
            <span className="text-base font-semibold font-mono" style={{ color: 'var(--text)' }}>
              ${priceData.price.toFixed(2)}
            </span>
            <div className="flex items-center gap-1 text-xs font-mono mt-0.5" style={{ color: changePositive ? 'var(--green)' : 'var(--red)' }}>
              {changePositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              <span>{changePositive ? '+$' : '-$'}{Math.abs(priceData.change).toFixed(2)}</span>
              <span>({changePositive ? '+' : '-'}{Math.abs(priceData.changePct).toFixed(2)}%)</span>
            </div>
            {priceData.fiftyTwoWeekHigh != null && priceData.fiftyTwoWeekLow != null && priceData.fiftyTwoWeekHigh > priceData.fiftyTwoWeekLow && (
              <div className="mt-1.5">
                <div className="flex items-center justify-between text-[9px] mb-0.5">
                  <span style={{ color: 'var(--text-dim)' }}>52W Position</span>
                  <span className="font-mono font-semibold" style={{ color: fiftyTwoWeekPosColor(priceData.price, priceData.fiftyTwoWeekHigh, priceData.fiftyTwoWeekLow) }}>
                    {fiftyTwoWeekPosition(priceData.price, priceData.fiftyTwoWeekHigh, priceData.fiftyTwoWeekLow).toFixed(0)}%
                  </span>
                </div>
                <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--border)' }}>
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.max(2, Math.min(100, fiftyTwoWeekPosition(priceData.price, priceData.fiftyTwoWeekHigh, priceData.fiftyTwoWeekLow)))}%`,
                      backgroundColor: fiftyTwoWeekPosColor(priceData.price, priceData.fiftyTwoWeekHigh, priceData.fiftyTwoWeekLow),
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
      </div>
    </button>
  );
}

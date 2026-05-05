import type { ETFInfo } from '../lib/types';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface ETFCardProps {
  etf: ETFInfo;
  onClick: () => void;
  priceData?: { price: number; change: number; changePct: number } | null;
}

function Skeleton({ w = 14 }: { w?: number }) {
  return <div className="h-3.5 rounded animate-pulse" style={{ backgroundColor: 'var(--border)', width: w }} />;
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

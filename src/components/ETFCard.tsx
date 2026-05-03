import { useState, useEffect, useCallback } from 'react';
import type { ETFInfo, PriceData } from '../lib/types';
import { fetchPrice } from '../lib/api';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface ETFCardProps {
  etf: ETFInfo;
  onClick: () => void;
}

function Skeleton() {
  return <div className="h-3.5 w-14 rounded bg-[#1e1e2e] animate-pulse" />;
}

export default function ETFCard({ etf, onClick }: ETFCardProps) {
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchPrice(etf.ticker);
      setPriceData(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [etf.ticker]);

  useEffect(() => { load(); }, [load]);

  const leverageColor = 'text-[#818cf8] bg-[#6366f1]/10 border-[#6366f1]/20';
  const changePositive = priceData && priceData.changePercent >= 0;

  return (
    <button
      onClick={onClick}
      className="group bg-[#12121a] border border-[#1e1e2e] rounded-xl p-3 text-left hover:border-[#6366f1]/40 hover:shadow-[0_0_20px_rgba(99,102,241,0.08)] transition-all duration-200 w-full"
    >
      <div className="flex items-start justify-between mb-2">
        <span className="text-lg font-bold font-mono text-[#e2e8f0] tracking-tight">{etf.ticker}</span>
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md border ${leverageColor}`}>
          {etf.leverage}
        </span>
      </div>

      <p className="text-xs text-[#64748b] mb-0.5 leading-snug line-clamp-1">{etf.name}</p>
      <p className="text-xs text-[#475569] mb-2">{etf.underlying}</p>

      <div className="flex items-end justify-between">
        {loading ? (
          <Skeleton />
        ) : error ? (
          <span className="text-[10px] text-red-400/60">Price unavailable</span>
        ) : priceData ? (
          <div>
            <span className="text-base font-semibold font-mono text-[#e2e8f0]">
              ${priceData.price.toFixed(2)}
            </span>
            <div className={`flex items-center gap-1 text-xs font-mono mt-0.5 ${changePositive ? 'text-emerald-400' : 'text-red-400'}`}>
              {changePositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              <span>{changePositive ? '+$' : '-$'}{Math.abs(priceData.change).toFixed(2)}</span>
              <span>({changePositive ? '+' : '-'}{Math.abs(priceData.changePercent).toFixed(2)}%)</span>
            </div>
          </div>
        ) : null}
      </div>
    </button>
  );
}

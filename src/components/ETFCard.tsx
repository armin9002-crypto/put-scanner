import { useState, useEffect, useCallback } from 'react';
import type { ETFInfo } from '../lib/types';
import { fetchExtendedPrice } from '../lib/api';
import type { ExtendedPriceData } from '../lib/api';
import { TrendingUp, TrendingDown } from 'lucide-react';

interface ETFCardProps {
  etf: ETFInfo;
  onClick: () => void;
}

function Skeleton({ w = 14 }: { w?: number }) {
  return <div className="h-3.5 rounded animate-pulse" style={{ backgroundColor: 'var(--border)', width: w }} />;
}

function PerfCell({ label, value }: { label: string; value: number | null }) {
  if (value == null) {
    return (
      <div className="text-center">
        <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>{label}</div>
        <div className="text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>—</div>
      </div>
    );
  }
  const isPositive = value >= 0;
  const display = isPositive ? `+${value.toFixed(1)}%` : `${value.toFixed(1)}%`;
  return (
    <div className="text-center">
      <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>{label}</div>
      <div className="text-[10px] font-mono" style={{ color: isPositive ? 'var(--green)' : 'var(--red)' }}>{display}</div>
    </div>
  );
}

function FiftyTwoWeekCell({ value }: { value: number | null }) {
  if (value == null) {
    return (
      <div className="text-center">
        <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>52W Hi</div>
        <div className="text-[10px] font-mono" style={{ color: 'var(--text-dim)' }}>—</div>
      </div>
    );
  }
  // value is negative (how far below high). If within 1%, show "Near High"
  if (value >= -1) {
    return (
      <div className="text-center">
        <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>52W Hi</div>
        <div className="text-[10px] font-mono" style={{ color: 'var(--green)' }}>Near High</div>
      </div>
    );
  }
  return (
    <div className="text-center">
      <div className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>52W Hi</div>
      <div className="text-[10px] font-mono" style={{ color: 'var(--red)' }}>{value.toFixed(1)}%</div>
    </div>
  );
}

export default function ETFCard({ etf, onClick }: ETFCardProps) {
  const [priceData, setPriceData] = useState<ExtendedPriceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchExtendedPrice(etf.ticker);
      setPriceData(data);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [etf.ticker]);

  useEffect(() => { load(); }, [load]);

  const changePositive = priceData && priceData.changePercent >= 0;

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

      <div className="flex items-end justify-between mb-2">
        {loading ? (
          <Skeleton w={60} />
        ) : error ? (
          <span className="text-[10px]" style={{ color: 'var(--red)', opacity: 0.6 }}>Price unavailable</span>
        ) : priceData ? (
          <div>
            <span className="text-base font-semibold font-mono" style={{ color: 'var(--text)' }}>
              ${priceData.price.toFixed(2)}
            </span>
            <div className={`flex items-center gap-1 text-xs font-mono mt-0.5`} style={{ color: changePositive ? 'var(--green)' : 'var(--red)' }}>
              {changePositive ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
              <span>{changePositive ? '+$' : '-$'}{Math.abs(priceData.change).toFixed(2)}</span>
              <span>({changePositive ? '+' : '-'}{Math.abs(priceData.changePercent).toFixed(2)}%)</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* Performance grid */}
      {loading ? (
        <div className="grid grid-cols-4 gap-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="text-center">
              <Skeleton w={24} />
              <Skeleton w={30} />
            </div>
          ))}
        </div>
      ) : priceData ? (
        <div className="grid grid-cols-4 gap-1">
          <PerfCell label="5D" value={priceData.fiveDay} />
          <PerfCell label="1M" value={priceData.oneMonth} />
          <PerfCell label="3M" value={priceData.threeMonth} />
          <FiftyTwoWeekCell value={priceData.fiftyTwoWeekHighPct} />
        </div>
      ) : (
        <div className="grid grid-cols-4 gap-1">
          <PerfCell label="5D" value={null} />
          <PerfCell label="1M" value={null} />
          <PerfCell label="3M" value={null} />
          <FiftyTwoWeekCell value={null} />
        </div>
      )}
    </button>
  );
}

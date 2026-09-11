import { Loader2 } from 'lucide-react';
import type { EvidenceFreshness } from '../../lib/evidence.ts';
import { compactScannerMarketFreshness } from '../../lib/scannerMarketContext.ts';

export interface MobileMarketItem {
  ticker: string;
  price: number | null;
  changePercent: number | null;
  isVolatility?: boolean;
  loading?: boolean;
  evidenceFreshness: EvidenceFreshness;
  observedAt: number | null;
  source: string;
  onOpen: () => void;
}

function marketValue(item: MobileMarketItem): string {
  if (item.price == null || !Number.isFinite(item.price)) return '—';
  return `${item.isVolatility ? '' : '$'}${item.price.toFixed(2)}`;
}

export default function MobileMarketStrip({ items }: { items: MobileMarketItem[] }) {
  return (
    <section className="mobile-market-strip" aria-label="Market overview">
      {items.map(item => {
        const change = item.changePercent;
        const color = change == null ? 'var(--text-dim)' : change >= 0 ? 'var(--green)' : 'var(--red)';
        const freshness = compactScannerMarketFreshness({ freshness: item.evidenceFreshness, observedAt: item.observedAt });
        return (
          <button key={item.ticker} type="button" onClick={item.onOpen} disabled={item.loading && item.price == null} className="pressable mobile-market-strip__item" aria-label={`${item.ticker} ${freshness} · source ${item.source}`}>
            <span className="min-w-0">
              <span className="block text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>{item.ticker}</span>
              <span className="block truncate text-[8px] leading-3" data-evidence-freshness={item.evidenceFreshness} style={{ color: item.evidenceFreshness === 'retained-stale' || item.evidenceFreshness === 'unavailable' ? 'var(--yellow)' : 'var(--text-dim)' }}>{freshness}</span>
            </span>
            {item.loading && item.price == null ? <Loader2 className="h-3.5 w-3.5 animate-spin" style={{ color: 'var(--text-dim)' }} /> : (
              <span className="min-w-0 text-right">
                <span className="block truncate font-mono text-[12px] font-semibold tabular-nums" style={{ color: 'var(--text)' }}>{marketValue(item)}</span>
                <span className="block font-mono text-[10px] tabular-nums" style={{ color }}>{change == null ? '—' : `${change >= 0 ? '+' : ''}${change.toFixed(1)}%`}</span>
              </span>
            )}
          </button>
        );
      })}
    </section>
  );
}

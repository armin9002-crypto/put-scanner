import { Link } from 'react-router-dom';
import type { ETFInfo } from '../../lib/types';

export interface MobileEtfPriceData {
  price: number | null;
  changePct: number | null;
}

function signedPercent(value: number | null | undefined, decimals = 1): string {
  return value == null || !Number.isFinite(value) ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`;
}

function valueColor(value: number | null | undefined): string {
  return value == null ? 'var(--text-dim)' : value >= 0 ? 'var(--green)' : 'var(--red)';
}

export default function MobileEtfRow({
  etf,
  to,
  navigationState,
  priceData,
}: {
  etf: ETFInfo;
  to: string;
  navigationState?: unknown;
  priceData?: MobileEtfPriceData | null;
}) {
  return (
    <div className="pressable mobile-etf-row">
      <Link
        to={to}
        state={navigationState}
        className="block"
        aria-label={`Open ${etf.ticker} options. Price ${priceData?.price?.toFixed(2) ?? 'unavailable'}, daily move ${signedPercent(priceData?.changePct, 2)}`}
      >
        <div className="mobile-etf-row__main">
          <div className="mobile-etf-row__identity">
            <div className="mobile-etf-row__identity-line flex items-center gap-2">
              <span className="font-mono text-[17px] font-bold tracking-tight" style={{ color: 'var(--text)' }}>{etf.ticker}</span>
              <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ color: 'var(--accent-light)', backgroundColor: 'var(--accent-bg)' }}>{etf.leverage}</span>
            </div>
            <div className="mobile-etf-row__name text-[12px] leading-tight" style={{ color: 'var(--text-muted)' }} title={etf.name}>{etf.name}</div>
          </div>
          <div className="mobile-etf-row__quote flex-none text-right">
            <div className="font-mono text-[16px] font-semibold tabular-nums" style={{ color: 'var(--text)' }}>{priceData?.price != null ? `$${priceData.price.toFixed(2)}` : '—'}</div>
            <div className="font-mono text-[12px] font-semibold tabular-nums" style={{ color: valueColor(priceData?.changePct) }}>{signedPercent(priceData?.changePct, 2)}</div>
          </div>
        </div>
      </Link>
    </div>
  );
}

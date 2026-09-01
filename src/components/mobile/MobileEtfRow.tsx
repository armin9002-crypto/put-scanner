import { Link } from 'react-router-dom';
import type { ETFInfo } from '../../lib/types';
import { formatFundAssets } from '../../lib/fundAssets';
import { scannerLiquidityCompactText, type ScannerOptionSnapshot, type ScannerSnapshotDiagnostic } from '../../lib/scannerOptionSnapshot';

export interface MobileEtfPriceData {
  price: number | null;
  changePct: number | null;
  fiveDay: number | null;
  oneMonth: number | null;
  threeMonth: number | null;
  fiftyTwoWeekHighPct: number | null;
}

function signedPercent(value: number | null | undefined, decimals = 1): string {
  return value == null || !Number.isFinite(value) ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(decimals)}%`;
}

function valueColor(value: number | null | undefined): string {
  return value == null ? 'var(--text-dim)' : value >= 0 ? 'var(--green)' : 'var(--red)';
}

function ivText(snapshot: ScannerOptionSnapshot | null | undefined): string {
  return snapshot?.atmPutIv != null && Number.isFinite(snapshot.atmPutIv) ? `${snapshot.atmPutIv.toFixed(1)}%` : '—';
}

export default function MobileEtfRow({
  etf,
  to,
  navigationState,
  priceData,
  optionSnapshot,
  optionDiagnostic,
  netAssets,
}: {
  etf: ETFInfo;
  to: string;
  navigationState?: unknown;
  priceData?: MobileEtfPriceData | null;
  optionSnapshot?: ScannerOptionSnapshot | null;
  optionDiagnostic?: ScannerSnapshotDiagnostic | null;
  netAssets?: number | null;
}) {
  const liquidity = scannerLiquidityCompactText(optionSnapshot?.liquidityLabel ?? 'unavailable');
  return (
    <Link
      to={to}
      state={navigationState}
      className="pressable mobile-etf-row"
      aria-label={`Open ${etf.ticker} options. Price ${priceData?.price?.toFixed(2) ?? 'unavailable'}, IV60 ${ivText(optionSnapshot)}, liquidity ${liquidity}`}
      title={optionDiagnostic?.reason}
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
      <div className="mobile-etf-row__performance mt-1 grid grid-cols-4 gap-x-2 gap-y-0">
        {([['5D', priceData?.fiveDay], ['1M', priceData?.oneMonth], ['3M', priceData?.threeMonth], ['52W', priceData?.fiftyTwoWeekHighPct]] as const).map(([label, value]) => (
          <span key={label} className="min-w-0 text-[11px]"><span style={{ color: 'var(--text-dim)' }}>{label} </span><span className="font-mono tabular-nums" style={{ color: valueColor(value) }}>{signedPercent(value)}</span></span>
        ))}
      </div>
      <div className="mobile-etf-row__footer mt-1 truncate border-t pt-1 text-[11px] font-medium" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
        <span style={{ color: 'var(--text-secondary)' }}>IV60 {ivText(optionSnapshot)}</span><span aria-hidden="true"> · </span><span>{liquidity}</span><span aria-hidden="true"> · </span><span>Assets {formatFundAssets(netAssets)}</span>
      </div>
    </Link>
  );
}

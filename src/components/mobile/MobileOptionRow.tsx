import { Star } from 'lucide-react';
import { Link } from 'react-router-dom';

export interface MobileOptionRowProps {
  ticker?: string;
  tickerTo?: string;
  strike: number;
  expirationLabel?: string;
  dte?: number | null;
  bid: number | null;
  mid?: number | null;
  ask: number | null;
  last: number | null;
  annualYield: number | null;
  nominalYield?: number | null;
  showNominalYield?: boolean;
  delta: number | null;
  impliedVolatility: number | null;
  openInterest: number | null;
  moneynessLabel?: string;
  moneynessColor?: string;
  statusText?: string;
  staleText?: string | null;
  watched?: boolean;
  onToggleWatchlist?: () => void;
  onSelect: () => void;
}

function money(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(2);
}

function integer(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : Math.round(value).toLocaleString('en-US');
}

function percent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(1)}%`;
}

export default function MobileOptionRow(props: MobileOptionRowProps) {
  const mid = props.mid ?? (props.bid != null && props.ask != null && props.bid > 0 && props.ask > 0 ? (props.bid + props.ask) / 2 : null);
  const title = `${props.ticker ? `${props.ticker} ` : ''}$${money(props.strike)} Put`;
  return (
    <article className="pressable mobile-option-row">
      <button type="button" className="absolute inset-0 z-0 rounded-xl" onClick={props.onSelect} aria-label={`Open details for ${title}`} />
      <div className="pointer-events-none relative z-10">
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            {props.tickerTo ? <Link to={props.tickerTo} className="pointer-events-auto relative z-20 inline-flex min-h-6 items-center font-mono text-[15px] font-bold" style={{ color: 'var(--accent-light)' }}>{title}</Link> : <div className="font-mono text-[15px] font-bold" style={{ color: 'var(--text)' }}>{title}</div>}
            {(props.expirationLabel || props.dte != null) && <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{props.expirationLabel}{props.expirationLabel && props.dte != null ? ' · ' : ''}{props.dte != null ? `${props.dte} DTE` : ''}</div>}
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            {props.moneynessLabel && <span className="truncate text-right font-mono text-[11px] font-semibold" style={{ color: props.moneynessColor ?? 'var(--text-muted)' }}>{props.moneynessLabel}</span>}
            {props.onToggleWatchlist && (
              <button
                type="button"
                onClick={event => { event.stopPropagation(); props.onToggleWatchlist?.(); }}
                className="pointer-events-auto relative z-20 -mr-2 flex h-11 w-11 flex-none items-center justify-center rounded-lg"
                aria-label={props.watched ? 'Remove from watchlist' : 'Add to watchlist'}
                style={{ color: props.watched ? 'var(--accent-light)' : 'var(--text-dim)' }}
              >
                <Star className={`h-4 w-4 ${props.watched ? 'fill-current' : ''}`} />
              </button>
            )}
          </div>
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-1 border-y py-1.5" style={{ borderColor: 'var(--border)' }}>
          {([['Bid', props.bid], ['Mid', mid], ['Ask', props.ask], ['Last', props.last]] as const).map(([label, value]) => (
            <div key={label} className="min-w-0 text-center"><div className="text-[10px]" style={{ color: 'var(--text-dim)' }}>{label}</div><div className="truncate font-mono text-[12px] font-semibold tabular-nums" style={{ color: label === 'Bid' ? 'var(--green)' : 'var(--text)' }}>{money(value)}</div></div>
          ))}
        </div>
        <div className={`mt-1.5 grid gap-1 text-[10px] ${props.showNominalYield ? 'grid-cols-5' : 'grid-cols-4'}`}>
          <span className="truncate"><span style={{ color: 'var(--text-dim)' }}>AY </span><b className="font-mono" style={{ color: 'var(--accent-light)' }}>{percent(props.annualYield)}</b></span>
          {props.showNominalYield && <span className="truncate"><span style={{ color: 'var(--text-dim)' }}>NY </span><b className="font-mono" style={{ color: 'var(--text-secondary)' }}>{percent(props.nominalYield)}</b></span>}
          <span className="truncate"><span style={{ color: 'var(--text-dim)' }}>Δ </span><b className="font-mono" style={{ color: 'var(--text-secondary)' }}>{props.delta == null ? '—' : props.delta.toFixed(2)}</b></span>
          <span className="truncate"><span style={{ color: 'var(--text-dim)' }}>IV </span><b className="font-mono" style={{ color: 'var(--text-secondary)' }}>{percent(props.impliedVolatility)}</b></span>
          <span className="truncate text-right"><span style={{ color: 'var(--text-dim)' }}>OI </span><b className="font-mono" style={{ color: 'var(--text-secondary)' }}>{integer(props.openInterest)}</b></span>
        </div>
        {(props.statusText || props.staleText) && <div className="mt-1 flex justify-between gap-2 text-[10px]" style={{ color: props.staleText ? 'var(--yellow)' : 'var(--text-dim)' }}><span>{props.statusText}</span><span>{props.staleText}</span></div>}
      </div>
    </article>
  );
}

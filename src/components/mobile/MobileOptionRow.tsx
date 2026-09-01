import { Star } from 'lucide-react';
import { formatOptionLastTradeDate } from '../../lib/format';
import { Link } from 'react-router-dom';

export interface MobileOptionRowProps {
  // Legacy callers (Screener/Watchlist) still provide the richer card props.
  ticker?: string;
  tickerTo?: string;
  strike: number;
  expirationLabel?: string;
  dte?: number | null;
  last: number | null;
  lastTradeDate?: number | null;
  bid: number | null;
  ask: number | null;
  mid?: number | null;
  annualYield?: number | null;
  annYieldLast?: number | null;
  annYieldBid?: number | null;
  annYieldAsk?: number | null;
  nominalYield?: number | null;
  showNominalYield?: boolean;
  delta?: number | null;
  impliedVolatility?: number | null;
  openInterest?: number | null;
  statusText?: string;
  moneynessLabel?: string;
  moneynessColor?: string;
  staleText?: string | null;
  watched?: boolean;
  onToggleWatchlist?: () => void;
  onSelect: () => void;
}

function money(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '\u2014' : value.toFixed(2);
}

function percent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '\u2014' : `${value.toFixed(1)}%`;
}

/** Compact portrait row. The drawer remains the home for secondary option data. */
export default function MobileOptionRow(props: MobileOptionRowProps) {
  const title = `$${money(props.strike)} Put`;
  const annYieldBid = props.annYieldBid ?? props.annualYield;
  return (
    <article
      role="row"
      className="pressable mobile-option-chain-row"
      data-stale={props.staleText ? 'true' : undefined}
      onClick={props.onSelect}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          props.onSelect();
        }
      }}
      tabIndex={0}
      aria-label={`Open details for ${title}`}
    >
      <div role="cell" className="mobile-option-chain-cell mobile-option-chain-cell--strike">
        {props.ticker && (props.tickerTo ? <Link to={props.tickerTo} onClick={event => event.stopPropagation()} className="mobile-option-chain-cell__context" style={{ color: 'var(--accent-light)' }}>{props.ticker}</Link> : <small className="mobile-option-chain-cell__context">{props.ticker}</small>)}
        <span className="font-mono font-semibold tabular-nums">{money(props.strike)}</span>
        {props.expirationLabel && <small className="mobile-option-chain-cell__context">{props.expirationLabel}</small>}
        {props.onToggleWatchlist && (
          <button
            type="button"
            onClick={event => { event.stopPropagation(); props.onToggleWatchlist?.(); }}
            className="pointer-events-auto flex h-8 w-8 flex-none items-center justify-center rounded-md"
            aria-label={props.watched ? 'Remove from watchlist' : 'Add to watchlist'}
            title={props.watched ? 'Remove from watchlist' : 'Add to watchlist'}
            style={{ color: props.watched ? 'var(--accent-light)' : 'var(--text-dim)' }}
          >
            <Star className={`h-3.5 w-3.5 ${props.watched ? 'fill-current' : ''}`} />
          </button>
        )}
      </div>
      <div role="cell" className="mobile-option-chain-cell" data-field="last" style={{ color: props.staleText ? 'var(--yellow)' : props.lastTradeDate ? 'var(--text)' : 'var(--text-dim)' }} title={`${formatOptionLastTradeDate(props.lastTradeDate ?? null)}${props.staleText ? ` · ${props.staleText}` : ''}`}>
        <span className="font-mono tabular-nums">{formatOptionLastTradeDate(props.lastTradeDate ?? null)}</span>
      </div>
      <div role="cell" className="mobile-option-chain-cell" data-field="moneyness" style={{ color: props.moneynessColor ?? 'var(--text-muted)' }}>
        <span className="font-mono tabular-nums">{props.moneynessLabel || '\u2014'}</span>
        {props.statusText && <small className="mobile-option-chain-cell__context">{props.statusText}</small>}
      </div>
      <div role="cell" className="mobile-option-chain-cell" data-field="ay-last" style={{ color: 'var(--accent-light)' }}>
        <span className="font-mono tabular-nums">{percent(props.annYieldLast)}</span>
      </div>
      <div role="cell" className="mobile-option-chain-cell" data-field="ay-bid" style={{ color: annYieldBid != null ? 'var(--green)' : 'var(--text-dim)' }}>
        <span className="font-mono tabular-nums">{percent(annYieldBid)}</span>
      </div>
      <div role="cell" className="mobile-option-chain-cell" data-field="ay-ask" style={{ color: props.annYieldAsk != null ? 'var(--green)' : 'var(--text-dim)' }}>
        <span className="font-mono tabular-nums">{percent(props.annYieldAsk)}</span>
      </div>
    </article>
  );
}

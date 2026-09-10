import { Star } from 'lucide-react';
import type { MouseEvent } from 'react';
import { formatOptionLastTradeDate } from '../../lib/format';
import { shortPutMoneynessPresentation, type ShortPutMoneynessState } from '../../lib/moneynessPresentation';
import { Link } from 'react-router-dom';
import type { OptionIntegrityStatus } from '../../lib/types';
import { formatOptionQuoteValue } from '../../lib/optionQuoteDisplay';
import { getOptionLastTradeFreshness } from '../../lib/optionLastTradeFreshness';
import type { PutDeltaSource } from '../../lib/putDelta';

export interface MobileOptionRowProps {
  // Legacy callers (Screener/Watchlist) still provide the richer card props.
  ticker?: string;
  tickerTo?: string;
  tickerNavigationState?: unknown;
  onTickerNavigate?: (event: MouseEvent<HTMLAnchorElement>) => void;
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
  statusTextColor?: string;
  moneynessLabel?: string;
  moneynessColor?: string;
  moneynessState?: ShortPutMoneynessState;
  staleText?: string | null;
  deltaSource?: PutDeltaSource | null;
  deltaModelVersion?: string | null;
  integrityStatus?: OptionIntegrityStatus;
  watched?: boolean;
  onToggleWatchlist?: () => void;
  onSelect: () => void;
  /** Options-page variant that exposes the compact quote/evidence parity set. */
  denseQuoteView?: boolean;
}

function money(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '\u2014' : value.toFixed(2);
}

function percent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '\u2014' : `${value.toFixed(1)}%`;
}

function quotePrice(value: number): string {
  return value.toFixed(2);
}

function freshnessText(value: number | null | undefined): string {
  const freshness = getOptionLastTradeFreshness(value);
  if (freshness.ageSessions == null) return 'Unavailable';
  const age = freshness.ageSessions === 0 ? '0 sessions' : `${freshness.ageSessions} session${freshness.ageSessions === 1 ? '' : 's'} ago`;
  return `${freshness.label ?? 'Recent'} · ${age}`;
}

function deltaSourceText(source: PutDeltaSource | null | undefined): string {
  if (source === 'provider') return 'Provider';
  if (source === 'calculated') return 'Calculated';
  return 'Unavailable';
}

/** Compact portrait row. The drawer remains the home for secondary option data. */
export default function MobileOptionRow(props: MobileOptionRowProps) {
  const title = `$${money(props.strike)} Put`;
  const annYieldBid = props.annYieldBid ?? props.annualYield;
  const moneyness = props.moneynessState ? shortPutMoneynessPresentation(props.moneynessState) : null;
  const identityLabel = [props.ticker, title, props.expirationLabel, props.dte != null ? `${props.dte} DTE` : null].filter(Boolean).join(' ');
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
      aria-label={`Open details for ${identityLabel}`}
      data-variant={props.denseQuoteView ? 'options' : undefined}
    >
      <div role="cell" className="mobile-option-chain-cell mobile-option-chain-cell--strike">
        <div className="mobile-option-chain-cell__identity">
          {props.ticker && (props.tickerTo ? <Link to={props.tickerTo} state={props.tickerNavigationState} onClick={event => { event.stopPropagation(); props.onTickerNavigate?.(event); }} className="mobile-option-chain-cell__context mobile-option-chain-cell__ticker" style={{ color: 'var(--accent-light)' }}>{props.ticker}</Link> : <small className="mobile-option-chain-cell__context mobile-option-chain-cell__ticker">{props.ticker}</small>)}
          <span className="mobile-option-chain-cell__strike-value font-mono font-semibold tabular-nums">{money(props.strike)}</span>
          {props.expirationLabel && <small className="mobile-option-chain-cell__context mobile-option-chain-cell__expiry">{props.expirationLabel}{props.dte != null ? ` · ${props.dte} DTE` : ''}</small>}
        </div>
        {props.onToggleWatchlist && (
          <button
            type="button"
            onClick={event => { event.stopPropagation(); props.onToggleWatchlist?.(); }}
            className="pointer-events-auto flex h-11 w-11 flex-none items-center justify-center rounded-md"
            aria-label={props.watched ? 'Remove from watchlist' : 'Add to watchlist'}
            title={props.watched ? 'Remove from watchlist' : 'Add to watchlist'}
            style={{ color: props.watched ? 'var(--accent-light)' : 'var(--text-dim)' }}
          >
            <Star className={`h-3.5 w-3.5 ${props.watched ? 'fill-current' : ''}`} />
          </button>
        )}
      </div>
      {props.denseQuoteView && (
        <>
        <div className="mobile-option-chain-row__option-details" aria-label="Option quote and metric details">
          <div className="mobile-option-chain-row__quote-grid">
            <div role="cell" className="mobile-option-chain-cell" data-field="last-quote" title="Last quote">
              <small className="mobile-option-chain-cell__context">Last</small>
              <span className="font-mono tabular-nums">{formatOptionQuoteValue('last', props.last, quotePrice)}</span>
            </div>
            <div role="cell" className="mobile-option-chain-cell" data-field="bid" title="Bid">
              <small className="mobile-option-chain-cell__context">Bid</small>
              <span className="font-mono tabular-nums">{formatOptionQuoteValue('bid', props.bid, quotePrice)}</span>
            </div>
            <div role="cell" className="mobile-option-chain-cell" data-field="ask" title="Ask">
              <small className="mobile-option-chain-cell__context">Ask</small>
              <span className="font-mono tabular-nums">{formatOptionQuoteValue('ask', props.ask, quotePrice)}</span>
            </div>
            <div role="cell" className="mobile-option-chain-cell mobile-option-chain-cell--trade" data-field="last-trade" style={{ color: getOptionLastTradeFreshness(props.lastTradeDate).color }} title={`${formatOptionLastTradeDate(props.lastTradeDate ?? null)} · ${freshnessText(props.lastTradeDate)}`}>
              <small className="mobile-option-chain-cell__context">Last Trade</small>
              <span className="font-mono tabular-nums">{formatOptionLastTradeDate(props.lastTradeDate ?? null)}</span>
              <small className="mobile-option-chain-cell__status">{freshnessText(props.lastTradeDate)}</small>
            </div>
          </div>
          <div className="mobile-option-chain-row__metric-grid">
            <div role="cell" className="mobile-option-chain-cell" data-field="delta" title={props.deltaSource === 'calculated' && props.deltaModelVersion ? `Calculated Delta · ${props.deltaModelVersion}` : undefined}>
              <small className="mobile-option-chain-cell__context">Delta</small>
              <span className="font-mono tabular-nums">{props.delta == null || !Number.isFinite(props.delta) ? '\u2014' : props.delta.toFixed(2)}</span>
              <small className="mobile-option-chain-cell__status">{deltaSourceText(props.deltaSource)}</small>
            </div>
            <div role="cell" className="mobile-option-chain-cell" data-field="iv">
              <small className="mobile-option-chain-cell__context">IV</small>
              <span className="font-mono tabular-nums">{percent(props.impliedVolatility)}</span>
            </div>
            <div role="cell" className="mobile-option-chain-cell" data-field="moneyness" title={moneyness?.accessibleLabel} style={{ color: moneyness?.color ?? props.moneynessColor ?? 'var(--text-muted)' }}>
              <small className="mobile-option-chain-cell__context">Moneyness</small>
              <span className="font-mono tabular-nums">{props.moneynessLabel || moneyness?.label || '\u2014'}</span>
            </div>
            <div role="cell" className="mobile-option-chain-cell" data-field="ay-last" style={{ color: 'var(--accent-light)' }}>
              <small className="mobile-option-chain-cell__context">AY Last</small>
              <span className="font-mono tabular-nums">{percent(props.annYieldLast)}</span>
            </div>
            <div role="cell" className="mobile-option-chain-cell" data-field="ay-bid" style={{ color: annYieldBid != null ? 'var(--green)' : 'var(--text-dim)' }}>
              <small className="mobile-option-chain-cell__context">AY Bid</small>
              <span className="font-mono tabular-nums">{percent(annYieldBid)}</span>
            </div>
            <div role="cell" className="mobile-option-chain-cell" data-field="ay-ask" style={{ color: props.annYieldAsk != null ? 'var(--green)' : 'var(--text-dim)' }}>
              <small className="mobile-option-chain-cell__context">AY Ask</small>
              <span className="font-mono tabular-nums">{percent(props.annYieldAsk)}</span>
            </div>
          </div>
          {props.integrityStatus && props.integrityStatus !== 'clean' && <small className="mobile-option-chain-cell__status mobile-option-chain-row__status">{props.integrityStatus === 'invalid' ? 'Invalid quote · trusted economics unavailable' : 'Degraded quote · use with caution'}</small>}
        </div>
        {props.denseQuoteView && props.statusText && <small className="mobile-option-chain-cell__status mobile-option-chain-row__status" style={{ color: props.statusTextColor }}>{props.statusText}</small>}
        </>
      )}
      <div role="cell" className="mobile-option-chain-cell" data-field="last" style={{ color: props.staleText ? 'var(--yellow)' : props.lastTradeDate ? 'var(--text)' : 'var(--text-dim)' }} title={`${formatOptionLastTradeDate(props.lastTradeDate ?? null)}${props.staleText ? ` · ${props.staleText}` : ''}`}>
        <span className="font-mono tabular-nums">{formatOptionLastTradeDate(props.lastTradeDate ?? null)}</span>
      </div>
      <div role="cell" className="mobile-option-chain-cell" data-field="moneyness" title={moneyness?.accessibleLabel} style={{ color: moneyness?.color ?? props.moneynessColor ?? 'var(--text-muted)' }}>
        <span className="font-mono tabular-nums">{props.moneynessLabel || moneyness?.label || '\u2014'}</span>
        {props.integrityStatus === 'invalid' && <small className="mobile-option-chain-cell__context" style={{ color: 'var(--yellow)' }}>Quote inconsistent</small>}
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

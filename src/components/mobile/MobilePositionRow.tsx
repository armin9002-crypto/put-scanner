import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';

export default function MobilePositionRow({
  ticker,
  strike,
  contracts,
  expiration,
  entryDate = '\u2014',
  pnl,
  captured,
  mark,
  entryDelta,
  showEntryDelta = true,
  currentDelta,
  entryIv = '\u2014',
  currentIv = '\u2014',
  showEntryIv = showEntryDelta,
  freshness,
  distance,
  entryVix,
  health,
  onOpen,
  onEdit,
}: {
  ticker: string;
  strike: string;
  contracts: number;
  expiration: string;
  entryDate?: string;
  pnl: string;
  captured: string;
  mark: string;
  entryDelta: string;
  showEntryDelta?: boolean;
  currentDelta: string;
  entryIv?: string;
  currentIv?: string;
  showEntryIv?: boolean;
  freshness: string;
  distance: string;
  entryVix: string;
  health: { label: string; color: string; bg: string; border: string; title: string };
  onOpen: () => void;
  onEdit: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const freshnessStatus = freshness ? <span className="portfolio-paired-metric__status" data-freshness={freshness.toLowerCase()}> · {freshness}</span> : null;
  const pnlColor = pnl.startsWith('-') ? 'var(--red)' : 'var(--green)';
  const capturedColor = captured.startsWith('-') ? 'var(--red)' : 'var(--green)';

  return (
    <article className="mobile-position-row" data-expanded={expanded ? 'true' : 'false'}>
      <div className="mobile-position-row__summary">
        <button
          type="button"
          className="mobile-position-row__summary-button"
          onClick={() => setExpanded(value => !value)}
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Collapse' : 'Expand'} ${ticker} ${strike} position`}
        >
          <span className="mobile-position-row__identity">
            <strong className="font-mono">{ticker}</strong>
            <span>{expiration}</span>
            <span className="font-mono">{strike}</span>
          </span>
          <span className="mobile-position-row__primary">
            <span><small>Gain/Loss</small><b className="font-mono tabular-nums" style={{ color: pnlColor }}>{pnl}</b></span>
            <span><small>% Captured</small><b className="font-mono tabular-nums" style={{ color: capturedColor }}>{captured}</b></span>
          </span>
          <span className="mobile-position-row__chevron" aria-hidden="true">{expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</span>
        </button>
        <span className="mobile-position-row__health rounded px-1.5 py-0.5 text-[10px] font-semibold" title={health.title} style={{ color: health.color, backgroundColor: health.bg, border: `1px solid ${health.border}` }}>{health.label}</span>
      </div>
      {expanded && (
        <div className="mobile-position-row__details">
          <div className="mobile-position-row__meta">{contracts} {contracts === 1 ? 'contract' : 'contracts'} · Entry {entryDate} · VIX {entryVix}</div>
          <div className="mobile-position-row__metrics">
            <span>Mark <b className="font-mono">{mark}</b></span>
            <span>{showEntryDelta && <>Entry Δ <b className="font-mono">{entryDelta}</b><br /></>}Current Δ <b className="font-mono">{currentDelta}</b>{freshnessStatus}</span>
            <span>{showEntryIv && <>Entry IV <b className="font-mono">{entryIv}</b><br /></>}Current IV <b className="font-mono">{currentIv}</b>{freshnessStatus}</span>
            <span><b className="font-mono">{distance}</b> OTM</span>
          </div>
          <div className="mobile-position-row__actions">
            <button type="button" onClick={onOpen} className="pointer-events-auto min-h-10 rounded-md px-2.5 text-[11px] font-semibold" style={{ color: 'var(--accent-light)', border: '1px solid var(--accent-border)', backgroundColor: 'var(--accent-bg)' }}>Open details</button>
            <button type="button" onClick={onEdit} className="pointer-events-auto min-h-10 rounded-md px-2.5 text-[11px] font-semibold" style={{ color: 'var(--text-muted)', border: '1px solid var(--border)', backgroundColor: 'var(--surface-alt)' }}>Edit</button>
          </div>
        </div>
      )}
    </article>
  );
}

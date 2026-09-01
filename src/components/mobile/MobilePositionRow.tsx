export default function MobilePositionRow({
  ticker,
  strike,
  contracts,
  expiration,
  entryDate = '—',
  pnl,
  captured,
  mark,
  entryDelta,
  showEntryDelta = true,
  currentDelta,
  entryIv = '—',
  currentIv = '—',
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
  return (
    <article className="mobile-position-row">
      <button type="button" className="absolute inset-0 z-0 rounded-xl" onClick={onOpen} aria-label={`Open ${ticker} ${strike} put details`} />
      <div className="pointer-events-none relative z-10">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[15px] font-bold" style={{ color: 'var(--text)' }}>{ticker} {strike} Put</div>
            <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>{contracts} {contracts === 1 ? 'contract' : 'contracts'} · {expiration} · Entry {entryDate} · VIX {entryVix}</div>
          </div>
          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold" title={health.title} style={{ color: health.color, backgroundColor: health.bg, border: `1px solid ${health.border}` }}>{health.label}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 border-y py-2" style={{ borderColor: 'var(--border)' }}>
          <div><div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>P&amp;L</div><div className="font-mono text-[17px] font-semibold tabular-nums" style={{ color: pnl.startsWith('-') ? 'var(--red)' : 'var(--green)' }}>{pnl}</div></div>
          <div className="text-right"><div className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-dim)' }}>Captured</div><div className="font-mono text-[15px] font-semibold tabular-nums" style={{ color: captured.startsWith('-') ? 'var(--red)' : 'var(--green)' }}>{captured}</div></div>
        </div>
        <div className="mt-2 grid grid-cols-[1fr_1.15fr_1.15fr_1fr_auto] items-center gap-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <span>Mark <b className="font-mono" style={{ color: 'var(--text)' }}>{mark}</b></span>
          <span>{showEntryDelta && <>Entry &Delta; <b className="font-mono" style={{ color: 'var(--text)' }}>{entryDelta}</b><br /></>}Current &Delta; <b className="font-mono" style={{ color: 'var(--text)' }}>{currentDelta}</b></span>
          <span>{showEntryIv && <>Entry IV <b className="font-mono" style={{ color: 'var(--text)' }}>{entryIv}</b><br /></>}Current IV <b className="font-mono" style={{ color: 'var(--text)' }}>{currentIv}</b></span>
          <span className="truncate"><b className="font-mono" style={{ color: 'var(--text)' }}>{distance}</b> OTM<br />{freshness}</span>
          <button type="button" onClick={event => { event.stopPropagation(); onEdit(); }} className="pointer-events-auto relative z-20 flex min-h-11 items-center px-2 font-semibold" style={{ color: 'var(--accent-light)' }}>Edit</button>
        </div>
      </div>
    </article>
  );
}

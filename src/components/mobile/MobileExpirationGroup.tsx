import { ChevronDown, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';

export default function MobileExpirationGroup({
  label,
  dte,
  positions,
  contracts,
  risk,
  pnl,
  captured,
  expanded,
  onToggle,
  children,
}: {
  label: string;
  dte: string;
  positions: number;
  contracts: number;
  risk: string;
  pnl: string;
  captured: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <section className="mobile-expiration-group">
      <button type="button" onClick={onToggle} aria-expanded={expanded} className="pressable flex min-h-[64px] w-full items-start gap-2 px-3 py-2.5 text-left">
        {expanded ? <ChevronDown className="mt-0.5 h-4 w-4 flex-none" /> : <ChevronRight className="mt-0.5 h-4 w-4 flex-none" />}
        <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-3"><b className="truncate text-[13px] uppercase tracking-wide" style={{ color: 'var(--text)' }}>{label}</b><span className="font-mono text-[11px]" style={{ color: 'var(--text-muted)' }}>{dte}</span></span><span className="mt-0.5 block text-[11px]" style={{ color: 'var(--text-muted)' }}>{positions} {positions === 1 ? 'position' : 'positions'} · {contracts} {contracts === 1 ? 'contract' : 'contracts'}</span><span className="mt-0.5 block truncate font-mono text-[10px]" style={{ color: 'var(--text-dim)' }}>Risk {risk} · <span style={{ color: pnl.startsWith('-') ? 'var(--red)' : 'var(--green)' }}>P&amp;L {pnl}</span> · {captured} captured</span></span>
      </button>
      {expanded && <div className="border-t" style={{ borderColor: 'var(--border)' }}>{children}</div>}
    </section>
  );
}

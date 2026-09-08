import { AlertTriangle, Loader2 } from 'lucide-react';
import type { EvidenceFreshness } from '../lib/evidence.ts';

export type DataFreshnessStatus = 'fresh' | 'cached' | 'stale' | 'updating' | 'failed';
export type RefreshLifecycle = 'idle' | 'updating' | 'complete' | 'failed';

const STATUS_LABELS: Record<DataFreshnessStatus, string> = {
  fresh: 'Fresh', cached: 'Cached', stale: 'Stale', updating: 'Updating', failed: 'Refresh failed',
};

export default function DataFreshness({
  updatedAt,
  status,
  source = 'Yahoo Finance',
  label = 'Market data',
  className = '',
  evidenceFreshness,
  lifecycle,
  timestampLabel = 'Observed',
}: {
  updatedAt: Date | number | string | null | undefined;
  status: DataFreshnessStatus;
  source?: string;
  label?: string;
  className?: string;
  evidenceFreshness?: EvidenceFreshness;
  lifecycle?: RefreshLifecycle;
  timestampLabel?: string;
}) {
  const timestamp = updatedAt instanceof Date ? updatedAt.getTime() : typeof updatedAt === 'number' ? updatedAt : updatedAt ? Date.parse(updatedAt) : NaN;
  const validTimestamp = Number.isFinite(timestamp);
  const time = validTimestamp ? new Date(timestamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
  const evidenceText = evidenceFreshness === 'retained-stale'
    ? time ? `showing retained data observed ${time}` : 'showing retained data'
    : evidenceFreshness === 'cached-current'
      ? time ? `Cached Â· observed ${time}` : 'Cached'
      : evidenceFreshness === 'current'
        ? time ? `Current Â· observed ${time}` : 'Current'
        : time ? `${timestampLabel} ${time}` : STATUS_LABELS[status];
  const operation = lifecycle ?? (status === 'updating' ? 'updating' : status === 'failed' ? 'failed' : 'complete');
  const text = operation === 'updating'
    ? time ? `Updating Â· ${evidenceText}` : 'Updatingâ€¦'
    : operation === 'failed'
      ? time ? `Refresh failed Â· ${evidenceText}` : 'Refresh failed'
      : evidenceText;
  const muted = status === 'stale' || status === 'cached' || evidenceFreshness === 'cached-current' || evidenceFreshness === 'retained-stale';

  return (
    <span className={`status-badge group/freshness relative ${className}`} data-status={status} data-evidence-freshness={evidenceFreshness} style={{ color: muted ? 'var(--text-dim)' : status === 'failed' ? 'var(--red)' : 'var(--text-muted)' }}>
      {operation === 'updating' && <Loader2 className="h-3 w-3 animate-spin" />}
      {(status === 'stale' || status === 'failed' || evidenceFreshness === 'retained-stale') && <AlertTriangle className="h-3 w-3" style={{ color: status === 'failed' ? 'var(--red)' : 'var(--text-dim)' }} />}
      <button type="button" className="cursor-help leading-4" aria-describedby={`freshness-${label.replace(/\W+/g, '-').toLowerCase()}`}>{text}</button>
      <span id={`freshness-${label.replace(/\W+/g, '-').toLowerCase()}`} role="tooltip" className="overlay-panel pointer-events-none absolute right-0 top-full z-50 mt-1 w-56 rounded-lg px-3 py-2 text-left text-[11px] leading-5 opacity-0 transition-opacity group-hover/freshness:opacity-100 group-focus-within/freshness:opacity-100 motion-reduce:transition-none" style={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}>
        <strong className="block">{label}</strong>
        <span className="block" style={{ color: 'var(--text-muted)' }}>Source: {source}</span>
        <span className="block" style={{ color: 'var(--text-muted)' }}>{timestampLabel}: {time ?? 'Unavailable'}</span>
        <span className="block" style={{ color: 'var(--text-muted)' }}>Status: {STATUS_LABELS[status]}</span>
      </span>
    </span>
  );
}

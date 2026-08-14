export type OptionLastTradeFreshness = 'unavailable' | 'recent' | 'stale' | 'very_stale';

export interface OptionLastTradeFreshnessPresentation {
  freshness: OptionLastTradeFreshness;
  ageDays: number | null;
  label: string | null;
  color: string;
}

function timestampMs(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  const timestamp = value < 100_000_000_000 ? value * 1000 : value;
  return Number.isNaN(new Date(timestamp).getTime()) ? null : timestamp;
}

export function getOptionLastTradeFreshness(value: number | null | undefined, now = Date.now()): OptionLastTradeFreshnessPresentation {
  const timestamp = timestampMs(value);
  if (timestamp == null) return { freshness: 'unavailable', ageDays: null, label: null, color: 'var(--text-muted)' };
  const tradeDate = new Date(timestamp);
  const nowDate = new Date(now);
  const tradeMidnight = new Date(tradeDate.getFullYear(), tradeDate.getMonth(), tradeDate.getDate()).getTime();
  const nowMidnight = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate()).getTime();
  const ageDays = Math.max(0, Math.floor((nowMidnight - tradeMidnight) / 86_400_000));
  if (ageDays > 7) return { freshness: 'very_stale', ageDays, label: 'Very stale', color: 'var(--red)' };
  if (ageDays > 2) return { freshness: 'stale', ageDays, label: 'Stale', color: 'var(--yellow)' };
  return { freshness: 'recent', ageDays, label: null, color: 'var(--green)' };
}

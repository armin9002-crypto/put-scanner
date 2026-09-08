import { exactOptionTradeSessionAge, type MarketDateInput } from './usMarketCalendar.ts';

export type OptionLastTradeFreshness = 'unavailable' | 'recent' | 'stale' | 'very_stale';

export interface OptionLastTradeFreshnessPresentation {
  freshness: OptionLastTradeFreshness;
  ageSessions: number | null;
  label: string | null;
  color: string;
}

export function getOptionLastTradeFreshness(
  value: MarketDateInput | null | undefined,
  now: MarketDateInput = new Date(),
): OptionLastTradeFreshnessPresentation {
  const ageSessions = exactOptionTradeSessionAge(value, now);
  if (ageSessions == null) return { freshness: 'unavailable', ageSessions: null, label: null, color: 'var(--text-muted)' };
  if (ageSessions > 7) return { freshness: 'very_stale', ageSessions, label: 'Very stale', color: 'var(--red)' };
  if (ageSessions > 2) return { freshness: 'stale', ageSessions, label: 'Stale', color: 'var(--yellow)' };
  return { freshness: 'recent', ageSessions, label: null, color: 'var(--green)' };
}

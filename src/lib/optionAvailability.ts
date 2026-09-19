import { calculateDte } from './optionMetrics.ts';
import { elapsedUsEquityTradingSessions, isUsEquityRegularSession, usMarketDateIso } from './usMarketCalendar.ts';

const DAY_MS = 86_400_000;

/** A trusted list is positive metadata or authoritative []; null means unknown. */
export function trustedListedExpirations(
  availability: Record<string, number[]>,
  ticker: string,
  errors: Array<{ ticker?: string; message: string }> = [],
): number[] | null {
  const key = ticker.trim().toUpperCase();
  if (errors.some(error => error.ticker == null || error.ticker.trim().toUpperCase() === key)) return null;
  const dates = availability[key];
  if (!Array.isArray(dates) || dates.some(date => !Number.isSafeInteger(date) || date <= 0)) return null;
  return dates;
}

/** Structural optionability can survive a small number of regular sessions. */
export const OPTION_AVAILABILITY_MAX_SESSION_AGE = 3;
/** Storage/HTTP fallback lifetime; evidence trust is bounded separately by sessions. */
export const OPTION_AVAILABILITY_CACHE_HARD_TTL_MS = 14 * DAY_MS;

export function optionAvailabilitySessionAge(observedAt: number, nowMs = Date.now()): number | null {
  if (!Number.isFinite(observedAt) || observedAt > nowMs) return null;
  const observedDate = usMarketDateIso(observedAt);
  const currentDate = usMarketDateIso(nowMs);
  if (!observedDate || !currentDate) return null;
  return elapsedUsEquityTradingSessions(observedDate, currentDate);
}

export function isTrustedOptionAvailabilityObservation(
  observedAt: number,
  nowMs = Date.now(),
  maximumSessionAge = OPTION_AVAILABILITY_MAX_SESSION_AGE,
): boolean {
  const age = optionAvailabilitySessionAge(observedAt, nowMs);
  return age != null && age <= maximumSessionAge;
}

/** Revalidate once a new regular session is actually open; closed-market time is quiet. */
export function optionAvailabilityNeedsRevalidation(observedAt: number | null | undefined, nowMs = Date.now()): boolean {
  if (!Number.isFinite(observedAt) || (observedAt as number) > nowMs) return true;
  if (!isUsEquityRegularSession(nowMs)) return false;
  const observedDate = usMarketDateIso(observedAt as number);
  const currentDate = usMarketDateIso(nowMs);
  if (!observedDate || !currentDate) return true;
  return observedDate !== currentDate || !isUsEquityRegularSession(observedAt as number);
}

export function trustedFutureListedExpirations(
  availability: Record<string, number[]>,
  ticker: string,
  errors: Array<{ ticker?: string; message: string }> = [],
  now: Date | number | string = new Date(),
): number[] | null {
  const dates = trustedListedExpirations(availability, ticker, errors);
  return dates?.filter(date => (calculateDte(date, now) ?? -1) > 0) ?? null;
}

export function hasTrustedFutureListedPutExpiration(
  availability: Record<string, number[]>,
  ticker: string,
  errors: Array<{ ticker?: string; message: string }> = [],
  now: Date | number | string = new Date(),
): boolean {
  return (trustedFutureListedExpirations(availability, ticker, errors, now)?.length ?? 0) > 0;
}

export function normalizeAvailabilityTickers(availability: Record<string, number[]>): Record<string, number[]> {
  return Object.fromEntries(Object.entries(availability).map(([ticker, dates]) => [ticker.trim().toUpperCase(), dates]));
}

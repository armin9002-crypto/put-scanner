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
export const OPTION_AVAILABILITY_HARD_TTL_MS = 8 * 60 * 60 * 1_000;

export function normalizeAvailabilityTickers(availability: Record<string, number[]>): Record<string, number[]> {
  return Object.fromEntries(Object.entries(availability).map(([ticker, dates]) => [ticker.trim().toUpperCase(), dates]));
}

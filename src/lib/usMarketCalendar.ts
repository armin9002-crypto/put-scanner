const DAY_MS = 86_400_000;
const holidayCache = new Map<number, Set<string>>();

function isoDate(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function dateFromIso(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  if (!Number.isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  return dateKey(date) === value ? date : null;
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function observedFixedHoliday(year: number, month: number, day: number): string {
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  const weekday = date.getUTCDay();
  if (weekday === 6) date.setUTCDate(date.getUTCDate() - 1);
  else if (weekday === 0) date.setUTCDate(date.getUTCDate() + 1);
  return dateKey(date);
}

function nthWeekday(year: number, month: number, weekday: number, occurrence: number): string {
  const first = new Date(Date.UTC(year, month - 1, 1, 12));
  const offset = (weekday - first.getUTCDay() + 7) % 7;
  return isoDate(year, month, 1 + offset + (occurrence - 1) * 7);
}

function lastWeekday(year: number, month: number, weekday: number): string {
  const last = new Date(Date.UTC(year, month, 0, 12));
  const offset = (last.getUTCDay() - weekday + 7) % 7;
  last.setUTCDate(last.getUTCDate() - offset);
  return dateKey(last);
}

function easterSunday(year: number): Date {
  // Gregorian computus, valid for the modern calendar years used by market data.
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day, 12));
}

function goodFriday(year: number): string {
  const easter = easterSunday(year);
  easter.setUTCDate(easter.getUTCDate() - 2);
  return dateKey(easter);
}

/** Observed U.S. equity-market closure dates. Early closes are intentionally not included. */
export function usEquityMarketHolidayDates(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;
  const holidays = new Set<string>([
    observedFixedHoliday(year, 1, 1),
    nthWeekday(year, 1, 1, 3), // Martin Luther King Jr. Day
    nthWeekday(year, 2, 1, 3), // Presidents Day
    goodFriday(year),
    lastWeekday(year, 5, 1), // Memorial Day
    observedFixedHoliday(year, 7, 4),
    nthWeekday(year, 9, 1, 1), // Labor Day
    nthWeekday(year, 11, 4, 4), // Thanksgiving
    observedFixedHoliday(year, 12, 25),
  ]);
  // Juneteenth became a regular NYSE/Nasdaq closure in 2022.
  if (year >= 2022) holidays.add(observedFixedHoliday(year, 6, 19));
  holidayCache.set(year, holidays);
  return holidays;
}

export function isUsEquityMarketHoliday(value: string | Date): boolean {
  const date = typeof value === 'string' ? dateFromIso(value) : value;
  if (!date) return false;
  const year = date.getUTCFullYear();
  // Include adjacent years because observed New Year's dates can cross the year boundary.
  return [year - 1, year, year + 1].some(candidate => usEquityMarketHolidayDates(candidate).has(dateKey(date)));
}

export function isUsEquityTradingSession(value: string | Date): boolean {
  const date = typeof value === 'string' ? dateFromIso(value) : value;
  if (!date) return false;
  const weekday = date.getUTCDay();
  return weekday !== 0 && weekday !== 6 && !isUsEquityMarketHoliday(date);
}

export function elapsedUsEquityTradingSessions(from: string | Date, to: string | Date): number {
  const start = typeof from === 'string' ? dateFromIso(from) : new Date(from.getTime());
  const end = typeof to === 'string' ? dateFromIso(to) : new Date(to.getTime());
  if (!start || !end || start.getTime() >= end.getTime()) return 0;
  let cursor = start.getTime() + DAY_MS;
  const endTime = end.getTime();
  let sessions = 0;
  while (cursor <= endTime) {
    if (isUsEquityTradingSession(new Date(cursor))) sessions += 1;
    cursor += DAY_MS;
  }
  return sessions;
}

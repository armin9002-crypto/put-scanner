const DAY_MS = 86_400_000;

function timestampMs(value) {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.abs(value) < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === 'string' && value.trim()) {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  return null;
}

function validCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  if (!Number.isFinite(timestamp)) return null;
  const normalized = new Date(timestamp).toISOString().slice(0, 10);
  return normalized === value ? value : null;
}

/** Convert listed expiration inputs to their intended UTC calendar date. */
export function calendarDateIso(value) {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return validCalendarDate(value);
  const exactDate = validCalendarDate(value);
  if (exactDate) return exactDate;
  const timestamp = timestampMs(value);
  return timestamp == null ? null : new Date(timestamp).toISOString().slice(0, 10);
}

/** Return the current calendar date in the canonical U.S. market timezone. */
export function usMarketDateIso(value = new Date()) {
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return validCalendarDate(value);
  }
  const timestamp = timestampMs(value);
  if (timestamp == null) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const field = type => parts.find(part => part.type === type)?.value ?? '';
  const date = `${field('year')}-${field('month')}-${field('day')}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

/** Return end minus start in calendar days, preserving negative values. */
export function calendarDaysBetween(start, end) {
  const startDate = validCalendarDate(start);
  const endDate = validCalendarDate(end);
  if (!startDate || !endDate) return null;
  const startTimestamp = Date.parse(`${startDate}T12:00:00Z`);
  const endTimestamp = Date.parse(`${endDate}T12:00:00Z`);
  return Math.round((endTimestamp - startTimestamp) / DAY_MS);
}

import { subtractRollingCalendarMonths } from './rollingHistoricalAnalytics.ts';

export const HISTORICAL_VISIBLE_RANGES = ['L3M', 'L6M', 'YTD', 'L1Y', 'L2Y', 'L3Y', 'Since Inception'] as const;
export type HistoricalVisibleRange = typeof HISTORICAL_VISIBLE_RANGES[number];

export const HISTORICAL_VISIBLE_RANGE_LABELS = {
  L3M: '3M',
  L6M: '6M',
  YTD: 'YTD',
  L1Y: '1Y',
  L2Y: '2Y',
  L3Y: '3Y',
  'Since Inception': 'All',
} as const;

/** Display-only slice: retain original timestamps, values, gaps and coverage metadata. */
export function selectHistoricalVisiblePoints<T extends { date: string }>(points: T[], endDate: string, range: HistoricalVisibleRange): T[] {
  if (range === 'Since Inception') return points;
  if (range === 'YTD') {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(endDate) ? `${endDate.slice(0, 4)}-01-01` : null;
    return start ? points.filter(point => point.date >= start && point.date <= endDate) : points;
  }
  const months = range === 'L3M' ? 3 : range === 'L6M' ? 6 : 12;
  let start = subtractRollingCalendarMonths(endDate, months);
  const extraYears = range === 'L2Y' ? 1 : range === 'L3Y' ? 2 : 0;
  for (let year = 0; year < extraYears && start; year += 1) start = subtractRollingCalendarMonths(start, 12);
  return start ? points.filter(point => point.date >= start && point.date <= endDate) : points;
}

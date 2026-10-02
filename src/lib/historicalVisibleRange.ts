import { subtractRollingCalendarMonths } from './rollingHistoricalAnalytics.ts';

export const HISTORICAL_VISIBLE_RANGES = ['L3M', 'L6M', 'L1Y', 'L2Y', 'Since Inception'] as const;
export type HistoricalVisibleRange = typeof HISTORICAL_VISIBLE_RANGES[number];

/** Display-only slice: retain original timestamps, values, gaps and coverage metadata. */
export function selectHistoricalVisiblePoints<T extends { date: string }>(points: T[], endDate: string, range: HistoricalVisibleRange): T[] {
  if (range === 'Since Inception') return points;
  const months = range === 'L3M' ? 3 : range === 'L6M' ? 6 : 12;
  let start = subtractRollingCalendarMonths(endDate, months);
  if (range === 'L2Y' && start) start = subtractRollingCalendarMonths(start, 12);
  return start ? points.filter(point => point.date >= start && point.date <= endDate) : points;
}

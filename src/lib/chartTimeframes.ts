import type { ChartTimeframe } from './chartHistory';
import { calendarDaysBetween, usMarketDateIso } from './usMarketCalendar.ts';

const FIXED_TIMEFRAMES: Array<{ timeframe: Exclude<ChartTimeframe, 'YTD'>; days: number }> = [
  { timeframe: '1D', days: 1 },
  { timeframe: '5D', days: 5 },
  { timeframe: '30D', days: 30 },
  { timeframe: '3M', days: 90 },
  { timeframe: '6M', days: 180 },
  { timeframe: '1Y', days: 365 },
  { timeframe: '3Y', days: 365 * 3 },
  { timeframe: '5Y', days: 365 * 5 },
  { timeframe: 'All', days: Infinity },
];

function getYtdCalendarDays(now: Date): number {
  const marketDate = usMarketDateIso(now);
  const elapsed = calendarDaysBetween(`${marketDate.slice(0, 4)}-01-01`, marketDate);
  return Math.max(1, (elapsed ?? 0) + 1);
}

export function getOrderedChartTimeframes(now = new Date()): ChartTimeframe[] {
  const ytdDays = getYtdCalendarDays(now);
  const ordered: ChartTimeframe[] = [];
  let insertedYtd = false;

  for (const item of FIXED_TIMEFRAMES) {
    if (!insertedYtd && item.days > ytdDays) {
      ordered.push('YTD');
      insertedYtd = true;
    }
    ordered.push(item.timeframe);
  }

  if (!insertedYtd) ordered.splice(ordered.length - 1, 0, 'YTD');

  return ordered;
}

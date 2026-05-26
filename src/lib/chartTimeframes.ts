import type { ChartTimeframe } from './chartHistory';

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
  const startOfYear = new Date(now.getFullYear(), 0, 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const elapsedMs = today.getTime() - startOfYear.getTime();
  return Math.max(1, Math.floor(elapsedMs / (24 * 60 * 60 * 1000)) + 1);
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

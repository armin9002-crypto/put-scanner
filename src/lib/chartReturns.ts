import type { ChartHistoryResponse, ChartTimeframe } from './chartHistory.ts';

const ONE_DAY_SECONDS = 24 * 60 * 60;
const ONE_YEAR_DAYS = 365.25;

export interface TimestampedPricePoint {
  timestamp: number;
  price: number;
}

export function normalizeSelectedRange<T extends TimestampedPricePoint>(pointA: T, pointB: T): { startPoint: T; endPoint: T } {
  return pointA.timestamp <= pointB.timestamp
    ? { startPoint: pointA, endPoint: pointB }
    : { startPoint: pointB, endPoint: pointA };
}

export function calculateRangeReturn<T extends TimestampedPricePoint>(pointA: T, pointB: T): { change: number | null; percent: number | null } {
  const { startPoint, endPoint } = normalizeSelectedRange(pointA, pointB);
  return calculateSimpleReturn(startPoint.price, endPoint.price);
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export interface ChartPeriodBaselineReference {
  value: number | null;
  label: 'Prev close' | 'Period start' | 'Year start' | 'Series start';
}

export function calculateSimpleReturn(startPrice: number | null | undefined, endPrice: number | null | undefined): { change: number | null; percent: number | null } {
  if (!isFiniteNumber(startPrice) || !isFiniteNumber(endPrice) || startPrice === 0) {
    return { change: null, percent: null };
  }
  const change = endPrice - startPrice;
  return { change, percent: (change / startPrice) * 100 };
}

export function getChartPeriodBaselineReference(data: ChartHistoryResponse | null | undefined, timeframe: ChartTimeframe): ChartPeriodBaselineReference {
  if (!data) return { value: null, label: timeframe === '1D' ? 'Prev close' : timeframe === 'YTD' ? 'Year start' : timeframe === 'All' ? 'Series start' : 'Period start' };
  if (timeframe === '1D') return {
    value: isFiniteNumber(data.previousClose) ? data.previousClose : data.points[0]?.price ?? null,
    label: 'Prev close',
  };
  if (timeframe === 'YTD') {
    const baseline = data.ytdBaseline?.price;
    return { value: isFiniteNumber(baseline) && baseline > 0 ? baseline : null, label: 'Year start' };
  }
  return { value: data.points[0]?.price ?? null, label: timeframe === 'All' ? 'Series start' : 'Period start' };
}

export function getChartPeriodBaseline(data: ChartHistoryResponse | null | undefined, timeframe: ChartTimeframe): number | null {
  return getChartPeriodBaselineReference(data, timeframe).value;
}

export function calculateChartPeriodReturn(data: ChartHistoryResponse | null | undefined, timeframe: ChartTimeframe): { change: number | null; percent: number | null } {
  if (!data) return { change: null, percent: null };
  const end = isFiniteNumber(data.latestPrice) ? data.latestPrice : data.points[data.points.length - 1]?.price ?? null;
  return calculateSimpleReturn(getChartPeriodBaseline(data, timeframe), end);
}

export function shouldShowAnnualizedReturn(startTimestamp: number | null | undefined, endTimestamp: number | null | undefined): boolean {
  if (!isFiniteNumber(startTimestamp) || !isFiniteNumber(endTimestamp)) return false;
  const daysHeld = (endTimestamp - startTimestamp) / ONE_DAY_SECONDS;
  return daysHeld > ONE_YEAR_DAYS;
}

export function calculateAnnualizedReturn(
  startPrice: number | null | undefined,
  endPrice: number | null | undefined,
  startTimestamp: number | null | undefined,
  endTimestamp: number | null | undefined
): number | null {
  if (!isFiniteNumber(startPrice) || !isFiniteNumber(endPrice) || startPrice <= 0 || endPrice <= 0) return null;
  if (!shouldShowAnnualizedReturn(startTimestamp, endTimestamp)) return null;

  const daysHeld = ((endTimestamp as number) - (startTimestamp as number)) / ONE_DAY_SECONDS;
  const years = daysHeld / ONE_YEAR_DAYS;
  const annualized = Math.pow(endPrice / startPrice, 1 / years) - 1;

  return Number.isFinite(annualized) ? annualized * 100 : null;
}

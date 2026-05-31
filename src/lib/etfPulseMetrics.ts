import type { ChartPoint } from './chartHistory';
import type { ETFInfo } from './types';

export type EtfPulseTrend = 'Strong Uptrend' | 'Uptrend' | 'Weakening' | 'Downtrend' | 'Neutral';

export interface EtfPulseRow {
  ticker: string;
  name: string;
  type: ETFInfo['type'];
  leverage: string;
  underlying: string;
  price: number | null;
  returns: {
    oneDay: number | null;
    fiveDay: number | null;
    thirtyDay: number | null;
    threeMonth: number | null;
    sixMonth: number | null;
    yearToDate: number | null;
    oneYear: number | null;
  };
  rsi14: number | null;
  sma50: number | null;
  sma200: number | null;
  distance50: number | null;
  distance200: number | null;
  high52Week: number | null;
  percentOf52WeekHigh: number | null;
  drawdown52Week: number | null;
  trend: EtfPulseTrend;
  isOversold: boolean;
  isOverbought: boolean;
  error?: string;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cleanPoints(points: ChartPoint[]): ChartPoint[] {
  return points.filter(point => finite(point.price) != null).sort((a, b) => a.timestamp - b.timestamp);
}

function safeRatio(numerator: number | null, denominator: number | null): number | null {
  if (numerator == null || denominator == null || denominator <= 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

export function calculateReturn(points: ChartPoint[], lookbackTradingDays: number): number | null {
  const clean = cleanPoints(points);
  const latest = clean[clean.length - 1]?.price;
  const prior = clean[clean.length - 1 - lookbackTradingDays]?.price;
  const ratio = safeRatio(finite(latest), finite(prior));
  return ratio == null ? null : ratio - 1;
}

export function calculateYtdReturn(points: ChartPoint[], year = new Date().getFullYear()): number | null {
  const clean = cleanPoints(points);
  const latest = finite(clean[clean.length - 1]?.price);
  const firstOfYear = clean.find(point => {
    const pointYear = point.date ? Number(point.date.slice(0, 4)) : new Date(point.timestamp * 1000).getFullYear();
    return pointYear === year;
  });
  const ratio = safeRatio(latest, finite(firstOfYear?.price));
  return ratio == null ? null : ratio - 1;
}

export function calculateSma(points: ChartPoint[], period: number): number | null {
  const clean = cleanPoints(points);
  if (clean.length < period) return null;
  const slice = clean.slice(-period);
  const total = slice.reduce((sum, point) => sum + point.price, 0);
  const value = total / period;
  return Number.isFinite(value) ? value : null;
}

export function calculateRsi14(points: ChartPoint[]): number | null {
  const clean = cleanPoints(points);
  if (clean.length < 15) return null;
  const slice = clean.slice(-15);
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < slice.length; index += 1) {
    const change = slice[index].price - slice[index - 1].price;
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  const averageGain = gains / 14;
  const averageLoss = losses / 14;
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const rs = averageGain / averageLoss;
  const rsi = 100 - (100 / (1 + rs));
  return Number.isFinite(rsi) ? rsi : null;
}

export function calculate52WeekHigh(points: ChartPoint[]): number | null {
  const clean = cleanPoints(points).slice(-252);
  if (clean.length === 0) return null;
  const high = Math.max(...clean.map(point => point.price));
  return Number.isFinite(high) ? high : null;
}

export function calculatePercentOf52WeekHigh(latest: number | null, high: number | null): number | null {
  return safeRatio(latest, high);
}

export function calculate52WeekDrawdown(latest: number | null, high: number | null): number | null {
  const percent = calculatePercentOf52WeekHigh(latest, high);
  return percent == null ? null : percent - 1;
}

export function calculateTrendBadge(metrics: {
  latest: number | null;
  distance50: number | null;
  distance200: number | null;
  thirtyDayReturn: number | null;
}): EtfPulseTrend {
  if (metrics.latest == null || metrics.distance50 == null || metrics.distance200 == null) return 'Neutral';
  if (metrics.distance50 > 0 && metrics.distance200 > 0 && (metrics.thirtyDayReturn ?? 0) > 0) return 'Strong Uptrend';
  if (metrics.distance200 > 0 && metrics.distance50 >= -0.02) return 'Uptrend';
  if (metrics.distance50 < 0 && metrics.distance200 > 0) return 'Weakening';
  if (metrics.distance50 < 0 && metrics.distance200 < 0) return 'Downtrend';
  return 'Neutral';
}

export function buildEtfPulseRow(etf: ETFInfo, points: ChartPoint[], latestPrice?: number | null): EtfPulseRow {
  const clean = cleanPoints(points);
  const latestClose = finite(clean[clean.length - 1]?.price);
  const latest = finite(latestPrice) ?? latestClose;
  const sma50 = calculateSma(clean, 50);
  const sma200 = calculateSma(clean, 200);
  const high52Week = calculate52WeekHigh(clean);
  const distance50 = latest != null && sma50 != null ? latest / sma50 - 1 : null;
  const distance200 = latest != null && sma200 != null ? latest / sma200 - 1 : null;
  const thirtyDay = calculateReturn(clean, 30);
  const rsi14 = calculateRsi14(clean);

  return {
    ticker: etf.ticker,
    name: etf.name,
    type: etf.type,
    leverage: etf.leverage,
    underlying: etf.underlying,
    price: latest,
    returns: {
      oneDay: calculateReturn(clean, 1),
      fiveDay: calculateReturn(clean, 5),
      thirtyDay,
      threeMonth: calculateReturn(clean, 63),
      sixMonth: calculateReturn(clean, 126),
      yearToDate: calculateYtdReturn(clean),
      oneYear: calculateReturn(clean, 252),
    },
    rsi14,
    sma50,
    sma200,
    distance50,
    distance200,
    high52Week,
    percentOf52WeekHigh: calculatePercentOf52WeekHigh(latest, high52Week),
    drawdown52Week: calculate52WeekDrawdown(latest, high52Week),
    trend: calculateTrendBadge({ latest, distance50, distance200, thirtyDayReturn: thirtyDay }),
    isOversold: rsi14 != null && rsi14 < 35,
    isOverbought: rsi14 != null && rsi14 > 70,
  };
}

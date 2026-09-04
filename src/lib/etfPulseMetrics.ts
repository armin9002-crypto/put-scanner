import type { ChartPoint } from './chartHistory';
import type { ETFInfo } from './types';
import {
  UNDERLYING_TECHNICAL_CONFIG,
  assessUnderlyingTechnicalMetrics,
  type UnderlyingMaStack,
  type UnderlyingTechnicalAssessment,
  type UnderlyingTechnicalMetrics,
  type UnderlyingTechnicalState,
} from './underlyingTechnical.ts';

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
  rsi14Change5: number | null;
  realizedVolatility20: number | null;
  realizedVolatility60: number | null;
  realizedVolatilityAcceleration: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  distance20: number | null;
  distance50: number | null;
  distance200: number | null;
  sma20Slope5: number | null;
  sma50Slope10: number | null;
  sma200Slope20: number | null;
  persistenceAbove50: number | null;
  persistenceAbove200: number | null;
  recoveryFromLow20: number | null;
  high52Week: number | null;
  low52Week: number | null;
  percentOf52WeekHigh: number | null;
  position52Week: number | null;
  drawdown52Week: number | null;
  recentDrawdown30: number | null;
  technicalAssessment: UnderlyingTechnicalAssessment;
  trend: EtfPulseTrend;
  isOversold: boolean;
  isOverbought: boolean;
  error?: string;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function cleanPoints(points: ChartPoint[], asOfTimestamp?: number): ChartPoint[] {
  return points
    .filter(point => finite(point.price) != null && (!Number.isFinite(asOfTimestamp) || point.timestamp <= (asOfTimestamp as number)))
    .sort((a, b) => a.timestamp - b.timestamp);
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

export function calculateYtdReturn(points: ChartPoint[], year?: number): number | null {
  const clean = cleanPoints(points);
  const latest = finite(clean[clean.length - 1]?.price);
  const latestPoint = clean[clean.length - 1];
  const targetYear = year ?? (latestPoint?.date ? Number(latestPoint.date.slice(0, 4)) : new Date((latestPoint?.timestamp ?? 0) * 1000).getFullYear());
  const firstOfYear = clean.find(point => {
    const pointYear = point.date ? Number(point.date.slice(0, 4)) : new Date(point.timestamp * 1000).getFullYear();
    return pointYear === targetYear;
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

export function calculateSmaSlope(points: ChartPoint[], period: number, observationLookback: number): number | null {
  const clean = cleanPoints(points);
  if (observationLookback <= 0 || clean.length < period + observationLookback) return null;
  const current = calculateSma(clean, period);
  const prior = calculateSma(clean.slice(0, -observationLookback), period);
  const ratio = safeRatio(current, prior);
  return ratio == null ? null : ratio - 1;
}

export function calculatePersistenceAboveSma(points: ChartPoint[], period: number, observations: number): number | null {
  const clean = cleanPoints(points);
  if (observations <= 0 || clean.length < period + observations - 1) return null;
  let above = 0;
  for (let index = clean.length - observations; index < clean.length; index += 1) {
    const start = index - period + 1;
    const movingAverage = clean.slice(start, index + 1).reduce((sum, point) => sum + point.price, 0) / period;
    if (clean[index].price >= movingAverage) above += 1;
  }
  return above / observations;
}

export function calculateRealizedVolatility(points: ChartPoint[], period: number = UNDERLYING_TECHNICAL_CONFIG.lookbacks.realizedVolatility20): number | null {
  const clean = cleanPoints(points);
  if (clean.length < period + 1) return null;
  const slice = clean.slice(-(period + 1));
  const returns: number[] = [];
  for (let index = 1; index < slice.length; index += 1) {
    const ratio = safeRatio(slice[index].price, slice[index - 1].price);
    if (ratio == null) return null;
    returns.push(ratio - 1);
  }
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / returns.length;
  const realizedVolatility = Math.sqrt(variance) * Math.sqrt(UNDERLYING_TECHNICAL_CONFIG.lookbacks.annualTradingObservations);
  return Number.isFinite(realizedVolatility) ? realizedVolatility : null;
}

export function calculateRsi14(points: ChartPoint[]): number | null {
  const clean = cleanPoints(points);
  const period = UNDERLYING_TECHNICAL_CONFIG.lookbacks.rsi;
  if (clean.length < period + 1) return null;
  const slice = clean.slice(-(period + 1));
  let gains = 0;
  let losses = 0;
  for (let index = 1; index < slice.length; index += 1) {
    const change = slice[index].price - slice[index - 1].price;
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }
  const averageGain = gains / period;
  const averageLoss = losses / period;
  if (averageLoss === 0) return averageGain === 0 ? 50 : 100;
  const rs = averageGain / averageLoss;
  const rsi = 100 - (100 / (1 + rs));
  return Number.isFinite(rsi) ? rsi : null;
}

export function calculateRsiChange(points: ChartPoint[], observationLookback: number): number | null {
  const clean = cleanPoints(points);
  if (observationLookback <= 0 || clean.length < UNDERLYING_TECHNICAL_CONFIG.lookbacks.rsi + 1 + observationLookback) return null;
  const current = calculateRsi14(clean);
  const prior = calculateRsi14(clean.slice(0, -observationLookback));
  return current == null || prior == null ? null : current - prior;
}

export function calculate52WeekHigh(points: ChartPoint[]): number | null {
  const clean = cleanPoints(points).slice(-UNDERLYING_TECHNICAL_CONFIG.lookbacks.year);
  if (clean.length === 0) return null;
  const high = Math.max(...clean.map(point => point.price));
  return Number.isFinite(high) ? high : null;
}

export function calculate52WeekLow(points: ChartPoint[]): number | null {
  const clean = cleanPoints(points).slice(-UNDERLYING_TECHNICAL_CONFIG.lookbacks.year);
  if (clean.length === 0) return null;
  const low = Math.min(...clean.map(point => point.price));
  return Number.isFinite(low) ? low : null;
}

export function calculatePercentOf52WeekHigh(latest: number | null, high: number | null): number | null {
  return safeRatio(latest, high);
}

export function calculate52WeekPosition(latest: number | null, low: number | null, high: number | null): number | null {
  if (latest == null || low == null || high == null || high <= low) return null;
  const position = (latest - low) / (high - low);
  return Number.isFinite(position) ? Math.max(0, Math.min(1, position)) : null;
}

export function calculate52WeekDrawdown(latest: number | null, high: number | null): number | null {
  const percent = calculatePercentOf52WeekHigh(latest, high);
  return percent == null ? null : Math.min(0, percent - 1);
}

export function calculateRecentDrawdown(points: ChartPoint[], latest: number | null, period: number = UNDERLYING_TECHNICAL_CONFIG.lookbacks.recentDrawdown): number | null {
  const clean = cleanPoints(points);
  if (latest == null || clean.length < period) return null;
  const recent = clean.slice(-period);
  const recentHigh = Math.max(...recent.map(point => point.price));
  const ratio = safeRatio(latest, Number.isFinite(recentHigh) ? recentHigh : null);
  return ratio == null ? null : Math.min(0, ratio - 1);
}

export function calculateRecoveryFromLow(points: ChartPoint[], latest: number | null, period: number): number | null {
  const clean = cleanPoints(points);
  if (latest == null || clean.length < period) return null;
  const recentLow = Math.min(...clean.slice(-period).map(point => point.price));
  const ratio = safeRatio(latest, Number.isFinite(recentLow) ? recentLow : null);
  return ratio == null ? null : Math.max(0, ratio - 1);
}

function movingAverageStack(sma20: number | null, sma50: number | null, sma200: number | null): UnderlyingMaStack {
  if (sma20 == null || sma50 == null || sma200 == null) return 'UNAVAILABLE';
  if (sma20 > sma50 && sma50 > sma200) return 'BULLISH';
  if (sma20 < sma50 && sma50 < sma200) return 'BEARISH';
  return 'MIXED';
}

export function technicalStateToTrend(state: UnderlyingTechnicalState): EtfPulseTrend {
  if (state === 'STRONG_TREND' || state === 'EXTENDED') return 'Strong Uptrend';
  if (state === 'CONSTRUCTIVE_PULLBACK' || state === 'RECOVERY_RECLAIM') return 'Uptrend';
  if (state === 'OVERSOLD_INTACT' || state === 'TRANSITION_DETERIORATING') return 'Weakening';
  if (state === 'BROKEN_TREND') return 'Downtrend';
  return 'Neutral';
}

type AssessmentDerivedRowField =
  | 'rsi14Change5'
  | 'realizedVolatility60'
  | 'realizedVolatilityAcceleration'
  | 'sma20Slope5'
  | 'sma50Slope10'
  | 'sma200Slope20'
  | 'persistenceAbove50'
  | 'persistenceAbove200'
  | 'recoveryFromLow20'
  | 'technicalAssessment'
  | 'trend'
  | 'isOversold'
  | 'isOverbought';

export type EtfPulseAssessmentSourceRow = Omit<EtfPulseRow, AssessmentDerivedRowField>
  & Partial<Pick<EtfPulseRow, AssessmentDerivedRowField>>;

export function withEtfPulseTechnicalAssessment(row: EtfPulseAssessmentSourceRow): EtfPulseRow {
  const normalized = {
    rsi14Change5: finite(row.rsi14Change5),
    realizedVolatility60: finite(row.realizedVolatility60),
    realizedVolatilityAcceleration: finite(row.realizedVolatilityAcceleration),
    sma20Slope5: finite(row.sma20Slope5),
    sma50Slope10: finite(row.sma50Slope10),
    sma200Slope20: finite(row.sma200Slope20),
    persistenceAbove50: finite(row.persistenceAbove50),
    persistenceAbove200: finite(row.persistenceAbove200),
    recoveryFromLow20: finite(row.recoveryFromLow20),
  };
  const metrics: UnderlyingTechnicalMetrics = {
    latest: finite(row.price),
    returns: {
      oneDay: finite(row.returns.oneDay),
      fiveDay: finite(row.returns.fiveDay),
      thirtyDay: finite(row.returns.thirtyDay),
      threeMonth: finite(row.returns.threeMonth),
      sixMonth: finite(row.returns.sixMonth),
      oneYear: finite(row.returns.oneYear),
    },
    rsi14: finite(row.rsi14),
    rsi14Change5: normalized.rsi14Change5,
    realizedVolatility20: finite(row.realizedVolatility20),
    realizedVolatility60: normalized.realizedVolatility60,
    realizedVolatilityAcceleration: normalized.realizedVolatilityAcceleration,
    sma20: finite(row.sma20),
    sma50: finite(row.sma50),
    sma200: finite(row.sma200),
    distance20: finite(row.distance20),
    distance50: finite(row.distance50),
    distance200: finite(row.distance200),
    sma20Slope5: normalized.sma20Slope5,
    sma50Slope10: normalized.sma50Slope10,
    sma200Slope20: normalized.sma200Slope20,
    persistenceAbove50: normalized.persistenceAbove50,
    persistenceAbove200: normalized.persistenceAbove200,
    maStack: movingAverageStack(finite(row.sma20), finite(row.sma50), finite(row.sma200)),
    recentDrawdown30: finite(row.recentDrawdown30),
    recoveryFromLow20: normalized.recoveryFromLow20,
    percentOf52WeekHigh: finite(row.percentOf52WeekHigh),
    position52Week: finite(row.position52Week),
    drawdown52Week: finite(row.drawdown52Week),
  };
  const technicalAssessment = assessUnderlyingTechnicalMetrics(metrics);
  return {
    ...row,
    ...normalized,
    technicalAssessment,
    trend: technicalStateToTrend(technicalAssessment.state),
    isOversold: metrics.rsi14 != null && metrics.rsi14 < UNDERLYING_TECHNICAL_CONFIG.momentum.oversoldRsi,
    isOverbought: metrics.rsi14 != null && metrics.rsi14 > UNDERLYING_TECHNICAL_CONFIG.extension.overboughtRsi,
  };
}

export function buildEtfPulseRow(etf: ETFInfo, points: ChartPoint[], latestPrice?: number | null, asOfTimestamp?: number): EtfPulseRow {
  const clean = cleanPoints(points, asOfTimestamp);
  const latestClose = finite(clean[clean.length - 1]?.price);
  const latest = Number.isFinite(asOfTimestamp) ? latestClose : finite(latestPrice) ?? latestClose;
  const sma20 = calculateSma(clean, UNDERLYING_TECHNICAL_CONFIG.lookbacks.sma20);
  const sma50 = calculateSma(clean, UNDERLYING_TECHNICAL_CONFIG.lookbacks.sma50);
  const sma200 = calculateSma(clean, UNDERLYING_TECHNICAL_CONFIG.lookbacks.sma200);
  const high52Week = calculate52WeekHigh(clean);
  const low52Week = calculate52WeekLow(clean);
  const distance20 = latest != null && sma20 != null ? latest / sma20 - 1 : null;
  const distance50 = latest != null && sma50 != null ? latest / sma50 - 1 : null;
  const distance200 = latest != null && sma200 != null ? latest / sma200 - 1 : null;
  const thirtyDay = calculateReturn(clean, UNDERLYING_TECHNICAL_CONFIG.lookbacks.thirtyDayReturn);
  const rsi14 = calculateRsi14(clean);
  const realizedVolatility20 = calculateRealizedVolatility(clean, UNDERLYING_TECHNICAL_CONFIG.lookbacks.realizedVolatility20);
  const realizedVolatility60 = calculateRealizedVolatility(clean, UNDERLYING_TECHNICAL_CONFIG.lookbacks.realizedVolatility60);
  const volatilityRatio = safeRatio(realizedVolatility20, realizedVolatility60);

  return withEtfPulseTechnicalAssessment({
    ticker: etf.ticker,
    name: etf.name,
    type: etf.type,
    leverage: etf.leverage,
    underlying: etf.underlying,
    price: latest,
    returns: {
      oneDay: calculateReturn(clean, UNDERLYING_TECHNICAL_CONFIG.lookbacks.oneDayReturn),
      fiveDay: calculateReturn(clean, UNDERLYING_TECHNICAL_CONFIG.lookbacks.fiveDayReturn),
      thirtyDay,
      threeMonth: calculateReturn(clean, UNDERLYING_TECHNICAL_CONFIG.lookbacks.threeMonthReturn),
      sixMonth: calculateReturn(clean, UNDERLYING_TECHNICAL_CONFIG.lookbacks.sixMonthReturn),
      yearToDate: calculateYtdReturn(clean),
      oneYear: calculateReturn(clean, UNDERLYING_TECHNICAL_CONFIG.lookbacks.oneYearReturn),
    },
    rsi14,
    rsi14Change5: calculateRsiChange(clean, UNDERLYING_TECHNICAL_CONFIG.lookbacks.rsiChange),
    realizedVolatility20,
    realizedVolatility60,
    realizedVolatilityAcceleration: volatilityRatio,
    sma20,
    sma50,
    sma200,
    distance20,
    distance50,
    distance200,
    sma20Slope5: calculateSmaSlope(clean, UNDERLYING_TECHNICAL_CONFIG.lookbacks.sma20, UNDERLYING_TECHNICAL_CONFIG.lookbacks.sma20Slope),
    sma50Slope10: calculateSmaSlope(clean, UNDERLYING_TECHNICAL_CONFIG.lookbacks.sma50, UNDERLYING_TECHNICAL_CONFIG.lookbacks.sma50Slope),
    sma200Slope20: calculateSmaSlope(clean, UNDERLYING_TECHNICAL_CONFIG.lookbacks.sma200, UNDERLYING_TECHNICAL_CONFIG.lookbacks.sma200Slope),
    persistenceAbove50: calculatePersistenceAboveSma(clean, UNDERLYING_TECHNICAL_CONFIG.lookbacks.sma50, UNDERLYING_TECHNICAL_CONFIG.lookbacks.persistence),
    persistenceAbove200: calculatePersistenceAboveSma(clean, UNDERLYING_TECHNICAL_CONFIG.lookbacks.sma200, UNDERLYING_TECHNICAL_CONFIG.lookbacks.persistence),
    high52Week,
    low52Week,
    percentOf52WeekHigh: calculatePercentOf52WeekHigh(latest, high52Week),
    position52Week: calculate52WeekPosition(latest, low52Week, high52Week),
    drawdown52Week: calculate52WeekDrawdown(latest, high52Week),
    recentDrawdown30: calculateRecentDrawdown(clean, latest, UNDERLYING_TECHNICAL_CONFIG.lookbacks.recentDrawdown),
    recoveryFromLow20: calculateRecoveryFromLow(clean, latest, UNDERLYING_TECHNICAL_CONFIG.lookbacks.recoveryLow),
  });
}

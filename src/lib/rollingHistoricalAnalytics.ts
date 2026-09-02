import { isFiniteNumber } from './optionMetrics.ts';
import { isValidEntryDelta, isValidEntryIv, usMarketDateIso } from './portfolioEntryDelta.ts';
import { historyRealizedIrr } from './portfolioHistoryAnalytics.ts';
import {
  calculateEquityAtRisk,
  calculateOriginalAnnualizedYield,
  calculateOriginalDte,
  calculatePremiumCollected,
} from './portfolioMetrics.ts';
import { canonicalHistoricalRealizedDate } from './portfolioRealizedEconomics.ts';
import type { PortfolioTrade } from './portfolioStorage.ts';

export const ROLLING_WINDOW_MONTHS = [3, 6, 12] as const;

export type RollingWindowMonths = typeof ROLLING_WINDOW_MONTHS[number];
export type RollingHistoricalMetric =
  | 'realizedIrr'
  | 'entryAy'
  | 'premiumRunRate'
  | 'grossRiskDeployed'
  | 'entryDelta'
  | 'entryIv'
  | 'originalDte';
export type RollingHistoricalAggregation = 'gross_risk_weighted_average' | 'annualized_flow';
export type RollingHistoricalFormatterCategory =
  | 'ratio_percent'
  | 'currency'
  | 'signed_delta'
  | 'percentage_points'
  | 'days';
export type RollingHistoricalTooltipMetadata = 'tradesIncluded' | 'grossRiskRepresented' | 'coverage' | 'flow';

export interface RollingHistoricalMetricConfig {
  key: RollingHistoricalMetric;
  label: string;
  eventDateBasis: 'entry' | 'realized';
  aggregation: RollingHistoricalAggregation;
  formatterCategory: RollingHistoricalFormatterCategory;
  tooltipMetadata: readonly RollingHistoricalTooltipMetadata[];
  title: (windowMonths: RollingWindowMonths) => string;
  subtitle: (windowMonths: RollingWindowMonths) => string;
}

/** The deliberately small, explicit product metric surface. */
export const ROLLING_HISTORICAL_METRIC_CONFIGS: readonly RollingHistoricalMetricConfig[] = Object.freeze([
  {
    key: 'realizedIrr',
    label: 'Realized IRR',
    eventDateBasis: 'realized',
    aggregation: 'gross_risk_weighted_average',
    formatterCategory: 'ratio_percent',
    tooltipMetadata: ['tradesIncluded', 'grossRiskRepresented'],
    title: windowMonths => `${windowMonths}M Rolling Realized IRR`,
    subtitle: windowMonths => `Gross-Risk-weighted IRR for trades realized during the trailing ${windowMonths} calendar months.`,
  },
  {
    key: 'entryAy',
    label: 'Entry AY',
    eventDateBasis: 'entry',
    aggregation: 'gross_risk_weighted_average',
    formatterCategory: 'ratio_percent',
    tooltipMetadata: ['tradesIncluded', 'grossRiskRepresented', 'coverage'],
    title: windowMonths => `${windowMonths}M Rolling Entry AY`,
    subtitle: windowMonths => `Gross-Risk-weighted entry annualized yield originated during the trailing ${windowMonths} calendar months.`,
  },
  {
    key: 'premiumRunRate',
    label: 'Annualized Premium Run Rate',
    eventDateBasis: 'entry',
    aggregation: 'annualized_flow',
    formatterCategory: 'currency',
    tooltipMetadata: ['tradesIncluded', 'grossRiskRepresented', 'flow'],
    title: windowMonths => `${windowMonths}M Annualized Premium Run Rate`,
    subtitle: windowMonths => `Entry Premium originated during the trailing ${windowMonths} calendar months, annualized by window length.`,
  },
  {
    key: 'grossRiskDeployed',
    label: 'Annualized Gross Risk Deployed',
    eventDateBasis: 'entry',
    aggregation: 'annualized_flow',
    formatterCategory: 'currency',
    tooltipMetadata: ['tradesIncluded', 'grossRiskRepresented', 'flow'],
    title: windowMonths => `${windowMonths}M Annualized Gross Risk Deployed`,
    subtitle: windowMonths => `Initial Gross Risk originated during the trailing ${windowMonths} calendar months, annualized by window length.`,
  },
  {
    key: 'entryDelta',
    label: 'Entry Delta',
    eventDateBasis: 'entry',
    aggregation: 'gross_risk_weighted_average',
    formatterCategory: 'signed_delta',
    tooltipMetadata: ['tradesIncluded', 'grossRiskRepresented', 'coverage'],
    title: windowMonths => `${windowMonths}M Rolling Entry Delta`,
    subtitle: windowMonths => `Gross-Risk-weighted signed put Delta originated during the trailing ${windowMonths} calendar months.`,
  },
  {
    key: 'entryIv',
    label: 'Entry IV',
    eventDateBasis: 'entry',
    aggregation: 'gross_risk_weighted_average',
    formatterCategory: 'percentage_points',
    tooltipMetadata: ['tradesIncluded', 'grossRiskRepresented', 'coverage'],
    title: windowMonths => `${windowMonths}M Rolling Entry IV`,
    subtitle: windowMonths => `Gross-Risk-weighted entry implied volatility in percentage points over the trailing ${windowMonths} calendar months.`,
  },
  {
    key: 'originalDte',
    label: 'Original DTE',
    eventDateBasis: 'entry',
    aggregation: 'gross_risk_weighted_average',
    formatterCategory: 'days',
    tooltipMetadata: ['tradesIncluded', 'grossRiskRepresented', 'coverage'],
    title: windowMonths => `${windowMonths}M Rolling Original DTE`,
    subtitle: windowMonths => `Gross-Risk-weighted original DTE originated during the trailing ${windowMonths} calendar months.`,
  },
]);

export interface RollingHistoricalCoverage {
  totalEligibleTrades: number;
  representedTrades: number;
  totalEligibleGrossRisk: number;
  representedGrossRisk: number;
  representedRiskPercent: number | null;
}

export interface RollingHistoricalFlowMetadata {
  tradesOriginated: number;
  trailingValue: number | null;
  annualizationFactor: number;
  annualizedValue: number | null;
}

export interface RollingHistoricalAnalyticsPoint {
  date: string;
  windowStartDate: string;
  value: number | null;
  windowMonths: RollingWindowMonths;
  metric: RollingHistoricalMetric;
  fullWindow: boolean;
  tradesIncluded: number;
  grossRiskRepresented: number;
  coverage?: RollingHistoricalCoverage;
  flow?: RollingHistoricalFlowMetadata;
}

export interface RollingHistoricalAnalyticsSeries {
  metric: RollingHistoricalMetric;
  windowMonths: RollingWindowMonths;
  config: RollingHistoricalMetricConfig;
  domain: {
    startDate: string | null;
    endDate: string;
  };
  observationDates: string[];
  points: RollingHistoricalAnalyticsPoint[];
}

interface EntryRecord {
  trade: PortfolioTrade;
  date: string;
  grossRisk: number;
}

interface RealizedRecord extends EntryRecord {
  realizedIrr: number;
}

const DAY_MS = 86_400_000;

function parseIsoDate(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value
    ? timestamp
    : null;
}

function dateIso(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/** Subtracts true calendar months and clamps to the destination month's final day. */
export function subtractRollingCalendarMonths(date: string, months: RollingWindowMonths): string | null {
  const timestamp = parseIsoDate(date);
  if (timestamp == null || !ROLLING_WINDOW_MONTHS.includes(months)) return null;
  const source = new Date(timestamp);
  const targetMonthIndex = source.getUTCFullYear() * 12 + source.getUTCMonth() - months;
  const targetYear = Math.floor(targetMonthIndex / 12);
  const targetMonth = targetMonthIndex - targetYear * 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return dateIso(Date.UTC(targetYear, targetMonth, Math.min(source.getUTCDate(), lastDay)));
}

/** Friday observations plus a terminal current date when the current date is not Friday. */
export function buildRollingObservationDates(startDate: string, endDate: string): string[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (start == null || end == null || start > end) return [];
  const startWeekday = new Date(start).getUTCDay();
  const daysUntilFriday = (5 - startWeekday + 7) % 7;
  const firstFriday = start + daysUntilFriday * DAY_MS;
  const dates: string[] = [];
  for (let timestamp = firstFriday; timestamp <= end; timestamp += 7 * DAY_MS) {
    dates.push(dateIso(timestamp));
  }
  const terminal = dateIso(end);
  if (dates[dates.length - 1] !== terminal) dates.push(terminal);
  return dates;
}

function metricConfig(metric: RollingHistoricalMetric): RollingHistoricalMetricConfig {
  const config = ROLLING_HISTORICAL_METRIC_CONFIGS.find(candidate => candidate.key === metric);
  if (!config) throw new RangeError(`Unknown rolling historical metric: ${metric as string}`);
  return config;
}

function entryMetricValue(metric: RollingHistoricalMetric, trade: PortfolioTrade): number | null {
  switch (metric) {
    case 'entryAy': {
      const value = calculateOriginalAnnualizedYield(trade);
      return isFiniteNumber(value) ? value : null;
    }
    case 'entryDelta':
      return isValidEntryDelta(trade.entryDelta) ? trade.entryDelta : null;
    case 'entryIv':
      return isValidEntryIv(trade.entryIv) ? trade.entryIv : null;
    case 'originalDte': {
      const value = calculateOriginalDte(trade);
      return isFiniteNumber(value) && value >= 0 ? value : null;
    }
    default:
      return null;
  }
}

function recordsInWindow<T extends EntryRecord>(records: readonly T[], startDate: string, endDate: string): T[] {
  return records.filter(record => record.date >= startDate && record.date <= endDate);
}

function incompletePoint(
  date: string,
  windowStartDate: string,
  windowMonths: RollingWindowMonths,
  metric: RollingHistoricalMetric,
): RollingHistoricalAnalyticsPoint {
  return {
    date,
    windowStartDate,
    value: null,
    windowMonths,
    metric,
    fullWindow: false,
    tradesIncluded: 0,
    grossRiskRepresented: 0,
  };
}

function weightedEntryPoint(
  records: EntryRecord[],
  date: string,
  windowStartDate: string,
  windowMonths: RollingWindowMonths,
  metric: RollingHistoricalMetric,
): RollingHistoricalAnalyticsPoint {
  let weightedValue = 0;
  let representedGrossRisk = 0;
  let representedTrades = 0;
  let totalEligibleGrossRisk = 0;
  records.forEach(record => {
    totalEligibleGrossRisk += record.grossRisk;
    const value = entryMetricValue(metric, record.trade);
    if (!isFiniteNumber(value)) return;
    weightedValue += value * record.grossRisk;
    representedGrossRisk += record.grossRisk;
    representedTrades += 1;
  });
  const value = representedGrossRisk > 0 ? weightedValue / representedGrossRisk : null;
  return {
    date,
    windowStartDate,
    value,
    windowMonths,
    metric,
    fullWindow: true,
    tradesIncluded: representedTrades,
    grossRiskRepresented: representedGrossRisk,
    coverage: {
      totalEligibleTrades: records.length,
      representedTrades,
      totalEligibleGrossRisk,
      representedGrossRisk,
      representedRiskPercent: totalEligibleGrossRisk > 0 ? representedGrossRisk / totalEligibleGrossRisk : null,
    },
  };
}

function realizedPoint(
  records: RealizedRecord[],
  date: string,
  windowStartDate: string,
  windowMonths: RollingWindowMonths,
): RollingHistoricalAnalyticsPoint {
  const grossRiskRepresented = records.reduce((sum, record) => sum + record.grossRisk, 0);
  const weightedValue = records.reduce((sum, record) => sum + record.realizedIrr * record.grossRisk, 0);
  return {
    date,
    windowStartDate,
    value: grossRiskRepresented > 0 ? weightedValue / grossRiskRepresented : null,
    windowMonths,
    metric: 'realizedIrr',
    fullWindow: true,
    tradesIncluded: records.length,
    grossRiskRepresented,
  };
}

function flowPoint(
  records: EntryRecord[],
  date: string,
  windowStartDate: string,
  windowMonths: RollingWindowMonths,
  metric: 'premiumRunRate' | 'grossRiskDeployed',
): RollingHistoricalAnalyticsPoint {
  const annualizationFactor = 12 / windowMonths;
  let trailingValue = 0;
  let valid = true;
  records.forEach(record => {
    const value = metric === 'premiumRunRate' ? calculatePremiumCollected(record.trade) : record.grossRisk;
    if (!isFiniteNumber(value) || value < 0) {
      valid = false;
      return;
    }
    trailingValue += value;
  });
  const rawValue = valid ? trailingValue : null;
  const annualizedValue = rawValue == null ? null : rawValue * annualizationFactor;
  const grossRiskRepresented = records.reduce((sum, record) => sum + record.grossRisk, 0);
  return {
    date,
    windowStartDate,
    value: annualizedValue,
    windowMonths,
    metric,
    fullWindow: true,
    tradesIncluded: records.length,
    grossRiskRepresented,
    flow: {
      tradesOriginated: records.length,
      trailingValue: rawValue,
      annualizationFactor,
      annualizedValue,
    },
  };
}

/**
 * Builds one rolling series entirely from durable portfolio trade facts.
 * Every window shares the strategy-wide entry-date domain and observation grid.
 */
export function buildRollingHistoricalAnalyticsSeries(
  trades: readonly PortfolioTrade[],
  metric: RollingHistoricalMetric,
  windowMonths: RollingWindowMonths,
  now = new Date(),
): RollingHistoricalAnalyticsSeries {
  const config = metricConfig(metric);
  if (!ROLLING_WINDOW_MONTHS.includes(windowMonths)) throw new RangeError(`Unsupported rolling window: ${windowMonths}`);
  const endDate = usMarketDateIso(now);
  const strategyEntryDates = trades
    .map(trade => trade.soldDate)
    .filter(date => parseIsoDate(date) != null && date <= endDate)
    .sort((a, b) => a.localeCompare(b));
  const entryRecords = trades.flatMap((trade): EntryRecord[] => {
    const timestamp = parseIsoDate(trade.soldDate);
    const grossRisk = calculateEquityAtRisk(trade);
    return timestamp != null && trade.soldDate <= endDate && isFiniteNumber(grossRisk) && grossRisk > 0
      ? [{ trade, date: trade.soldDate, grossRisk }]
      : [];
  }).sort((a, b) => a.date.localeCompare(b.date) || a.trade.id.localeCompare(b.trade.id));
  const startDate = strategyEntryDates[0] ?? null;
  const observationDates = startDate ? buildRollingObservationDates(startDate, endDate) : [];

  const realizedRecords = metric === 'realizedIrr'
    ? trades.flatMap((trade): RealizedRecord[] => {
      const date = canonicalHistoricalRealizedDate(trade);
      const realizedIrr = historyRealizedIrr(trade);
      const grossRisk = calculateEquityAtRisk(trade);
      return date != null && date <= endDate && isFiniteNumber(realizedIrr) && isFiniteNumber(grossRisk) && grossRisk > 0
        ? [{ trade, date, grossRisk, realizedIrr }]
        : [];
    }).sort((a, b) => a.date.localeCompare(b.date) || a.trade.id.localeCompare(b.trade.id))
    : [];

  const points = observationDates.map(date => {
    const windowStartDate = subtractRollingCalendarMonths(date, windowMonths);
    if (windowStartDate == null || startDate == null || startDate > windowStartDate) {
      return incompletePoint(date, windowStartDate ?? date, windowMonths, metric);
    }
    if (metric === 'realizedIrr') {
      return realizedPoint(recordsInWindow(realizedRecords, windowStartDate, date), date, windowStartDate, windowMonths);
    }
    const entries = recordsInWindow(entryRecords, windowStartDate, date);
    if (metric === 'premiumRunRate' || metric === 'grossRiskDeployed') {
      return flowPoint(entries, date, windowStartDate, windowMonths, metric);
    }
    return weightedEntryPoint(entries, date, windowStartDate, windowMonths, metric);
  });

  return {
    metric,
    windowMonths,
    config,
    domain: { startDate, endDate },
    observationDates,
    points,
  };
}

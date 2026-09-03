import { isFiniteNumber } from './optionMetrics.ts';
import { usMarketDateIso } from './portfolioEntryDelta.ts';
import { calculateEquityAtRisk } from './portfolioMetrics.ts';
import type { PortfolioTrade } from './portfolioStorage.ts';

export type PortfolioHistoricalStateMetric = 'grossRiskExposure' | 'averageRemainingDte';
export type PortfolioHistoricalStateFormatterCategory = 'currency' | 'days';

export interface PortfolioHistoricalStateMetricConfig {
  key: PortfolioHistoricalStateMetric;
  family: 'PORTFOLIO_STATE';
  label: string;
  formatterCategory: PortfolioHistoricalStateFormatterCategory;
  title: string;
  subtitle: string;
}

export const PORTFOLIO_HISTORICAL_STATE_METRIC_CONFIGS: readonly PortfolioHistoricalStateMetricConfig[] = Object.freeze([
  {
    key: 'grossRiskExposure',
    family: 'PORTFOLIO_STATE',
    label: 'Gross Risk Exposure',
    formatterCategory: 'currency',
    title: 'Gross Risk Exposure',
    subtitle: 'Canonical Gross Risk for positions open at each calendar-date end of day.',
  },
  {
    key: 'averageRemainingDte',
    family: 'PORTFOLIO_STATE',
    label: 'Avg Remaining DTE',
    formatterCategory: 'days',
    title: 'Average Remaining DTE',
    subtitle: 'Gross-Risk-weighted remaining calendar days for positions open at each calendar-date end of day.',
  },
]);

export interface PortfolioHistoricalStateCoverage {
  sourceTrades: number;
  eligibleTrades: number;
  excludedUnsafeTerminalTrades: number;
  excludedTradeIds: string[];
}

export interface PortfolioHistoricalStatePoint {
  date: string;
  metric: PortfolioHistoricalStateMetric;
  value: number | null;
  openTrades: number;
  grossRiskRepresented: number;
  coverage: PortfolioHistoricalStateCoverage;
}

export interface PortfolioHistoricalStateSeries {
  metric: PortfolioHistoricalStateMetric;
  config: PortfolioHistoricalStateMetricConfig;
  domain: { startDate: string | null; endDate: string };
  observationDates: string[];
  points: PortfolioHistoricalStatePoint[];
  coverage: PortfolioHistoricalStateCoverage;
}

interface StateRecord {
  trade: PortfolioTrade;
  soldDate: string;
  expiration: string;
  terminalDate: string;
  grossRisk: number;
}

const DAY_MS = 86_400_000;

function parseIsoDate(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value ? timestamp : null;
}

function dateIso(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function terminalDateForState(trade: PortfolioTrade): string | null {
  const terminal = trade.status === 'closed'
    ? trade.closeDate
    : trade.status === 'assigned'
      ? trade.resolvedDate ?? trade.closeDate
      : trade.expiration;
  return parseIsoDate(terminal) == null ? null : terminal!;
}

/** Daily calendar dates are intentional: this series represents end-of-day portfolio state, not market observations. */
export function buildPortfolioStateObservationDates(startDate: string, endDate: string): string[] {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  if (start == null || end == null || start > end) return [];
  const dates: string[] = [];
  for (let timestamp = start; timestamp <= end; timestamp += DAY_MS) dates.push(dateIso(timestamp));
  return dates;
}

function metricConfig(metric: PortfolioHistoricalStateMetric): PortfolioHistoricalStateMetricConfig {
  const config = PORTFOLIO_HISTORICAL_STATE_METRIC_CONFIGS.find(candidate => candidate.key === metric);
  if (!config) throw new RangeError(`Unknown portfolio historical state metric: ${metric as string}`);
  return config;
}

/**
 * Reconstructs portfolio state only from durable lifecycle facts. A position is
 * open at EOD t iff soldDate <= t < canonical terminal date. This deliberately
 * makes same-day entry/exit absent from EOD state and bounds still-open records
 * by their contract expiration.
 */
export function buildPortfolioHistoricalStateSeries(
  trades: readonly PortfolioTrade[],
  metric: PortfolioHistoricalStateMetric,
  now = new Date(),
): PortfolioHistoricalStateSeries {
  const config = metricConfig(metric);
  const endDate = usMarketDateIso(now);
  const validStrategyDates = trades
    .map(trade => trade.soldDate)
    .filter(date => parseIsoDate(date) != null && date <= endDate)
    .sort((left, right) => left.localeCompare(right));
  const startDate = validStrategyDates[0] ?? null;
  const excludedTradeIds: string[] = [];
  const records = trades.flatMap((trade): StateRecord[] => {
    const soldTimestamp = parseIsoDate(trade.soldDate);
    const expirationTimestamp = parseIsoDate(trade.expiration);
    const terminalDate = terminalDateForState(trade);
    const terminalTimestamp = parseIsoDate(terminalDate);
    const grossRisk = calculateEquityAtRisk(trade);
    const safe = soldTimestamp != null
      && expirationTimestamp != null
      && terminalTimestamp != null
      && terminalTimestamp >= soldTimestamp
      && trade.soldDate <= endDate
      && isFiniteNumber(grossRisk)
      && grossRisk > 0;
    if (!safe) {
      if (soldTimestamp != null && trade.soldDate <= endDate) excludedTradeIds.push(trade.id);
      return [];
    }
    return [{ trade, soldDate: trade.soldDate, expiration: trade.expiration, terminalDate: terminalDate!, grossRisk }];
  }).sort((left, right) => left.soldDate.localeCompare(right.soldDate) || left.trade.id.localeCompare(right.trade.id));
  excludedTradeIds.sort();
  const coverage: PortfolioHistoricalStateCoverage = {
    sourceTrades: trades.length,
    eligibleTrades: records.length,
    excludedUnsafeTerminalTrades: excludedTradeIds.length,
    excludedTradeIds,
  };
  const observationDates = startDate ? buildPortfolioStateObservationDates(startDate, endDate) : [];
  const points = observationDates.map((date): PortfolioHistoricalStatePoint => {
    const dateTimestamp = parseIsoDate(date)!;
    const open = records.filter(record => record.soldDate <= date && date < record.terminalDate);
    const grossRiskRepresented = open.reduce((sum, record) => sum + record.grossRisk, 0);
    let value: number | null;
    if (metric === 'grossRiskExposure') {
      value = grossRiskRepresented;
    } else if (grossRiskRepresented === 0) {
      value = null;
    } else {
      value = open.reduce((sum, record) => {
        const expirationTimestamp = parseIsoDate(record.expiration)!;
        const remainingDays = Math.max(0, Math.round((expirationTimestamp - dateTimestamp) / DAY_MS));
        return sum + remainingDays * record.grossRisk;
      }, 0) / grossRiskRepresented;
    }
    return { date, metric, value, openTrades: open.length, grossRiskRepresented, coverage };
  });
  return { metric, config, domain: { startDate, endDate }, observationDates, points, coverage };
}

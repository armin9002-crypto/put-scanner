import { normalizeMarketTimestamp } from './marketTimestamp.ts';
import { makePortfolioContractKey } from './portfolioContractIdentity.ts';
import {
  historyDaysHeld,
  historyFinalValue,
  historyPercentCaptured,
  historyRealizedIrr,
  historyRealizedPnl,
} from './portfolioHistoryAnalytics.ts';
import {
  calculateBreakeven,
  calculateCurrentAnnualizedYield,
  calculateCurrentNominalYield,
  calculateCurrentOptionMark,
  calculateCurrentPositionValue,
  calculateDistanceToBreakeven,
  calculateDistanceToStrike,
  calculateEquityAtRisk,
  calculateNetCapitalAtRisk,
  calculateOriginalAnnualizedYield,
  calculateOriginalDte,
  calculateOriginalNominalYield,
  calculatePercentCaptured,
  calculatePremiumCollected,
  calculateRemainingDte,
  calculateTotalGainLoss,
  type MarkBasis,
} from './portfolioMetrics.ts';
import { usMarketDateIso } from './portfolioEntryDelta.ts';
import type { PortfolioMarketData, PortfolioTrade } from './portfolioStorage.ts';

export const PORTFOLIO_HISTORICAL_CSV_COLUMNS = [
  'Ticker',
  'Expiration',
  'Strike',
  'Contracts',
  'Sold Price (Net)',
  'Sold Date',
  'Delta at Entry',
  'IV at Entry',
  'Status',
  'Outcome',
  'Close Date',
  'Close price',
  'Underlying Price at Expiration / Contract Close',
  'Trade/Lot ID',
  'Option Type',
  'Contract Key',
  'Lifecycle State',
  'Resolution Type',
  'Resolution Source',
  'Resolution Warning',
  'Notes',
  'Original DTE',
  'Entry Delta Source',
  'Entry Delta Captured At',
  'Entry IV Source',
  'Entry IV Captured At',
  'Entry VIX',
  'Entry VIX Date',
  'Entry VIX Source',
  'Notional',
  'Premium Collected',
  'Entry Nominal Yield',
  'Entry Annualized Yield',
  'Breakeven at Entry',
  'Net Capital at Risk',
  'Final Option Value',
  'Realized P&L',
  'Percent Captured',
  'Days Held',
  'Realized IRR',
  'Current Underlying Price',
  'Current DTE',
  'Current Option Bid',
  'Current Option Mid',
  'Current Option Ask',
  'Current Option Last',
  'Last Trade Date',
  'Current Delta',
  'Current IV',
  'Volume',
  'Open Interest',
  'Current Mark Basis',
  'Current Option Mark',
  'Current Position Value',
  'Current Gain / Loss',
  'Current Percent Captured',
  'Current Nominal Yield',
  'Current Annualized Yield',
  'Distance to Strike',
  'Distance to Breakeven',
  'Availability Status',
  'Market Data Refreshed At',
  'Provider Market At',
  'Provider Quote At',
  'Cache Timestamp',
  'Timestamp Source',
] as const;

export type PortfolioHistoricalCsvCell = string | number | null | undefined;

export interface PortfolioHistoricalCsvExportSummary {
  openLots: number;
  resolvedLots: number;
  totalLots: number;
  currentMarketCoveredLots: number;
}

export interface PortfolioHistoricalCsvExport {
  filename: string;
  csv: string;
  rows: PortfolioHistoricalCsvCell[][];
  summary: PortfolioHistoricalCsvExportSummary;
}

interface SourceCompatibleLifecycle {
  status: string;
  outcome: string;
  closeDate: string | null;
  closePrice: number | null;
  underlyingResolutionPrice: number | null;
}

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function percentagePoints(value: number | null): number | null {
  return value == null || !Number.isFinite(value) ? null : value * 100;
}

function timestampIso(value: unknown): string | null {
  const timestamp = normalizeMarketTimestamp(value);
  return timestamp == null ? null : new Date(timestamp).toISOString();
}

function sourceCompatibleLifecycle(trade: PortfolioTrade): SourceCompatibleLifecycle {
  if (trade.status === 'open') {
    return { status: 'Open', outcome: '', closeDate: null, closePrice: null, underlyingResolutionPrice: null };
  }
  if (trade.status === 'closed') {
    return {
      status: 'Closed / Bought Back',
      outcome: 'Closed Manually',
      closeDate: trade.closeDate ?? null,
      closePrice: finite(trade.closePrice),
      underlyingResolutionPrice: finite(trade.closeUnderlyingPrice),
    };
  }
  if (trade.status === 'expired_price_pending') {
    return { status: 'Held to Expiration', outcome: 'Expiration Price Pending', closeDate: null, closePrice: null, underlyingResolutionPrice: null };
  }
  if (trade.status === 'assigned') {
    return {
      status: 'Resolved',
      outcome: 'Assigned',
      closeDate: trade.resolvedDate ?? trade.closeDate ?? null,
      closePrice: null,
      underlyingResolutionPrice: null,
    };
  }
  return {
    status: 'Held to Expiration',
    outcome: trade.resolutionType === 'expired_worthless'
      ? 'Expired Worthless'
      : trade.resolutionType === 'expired_itm' ? 'Expired ITM' : 'Expired',
    closeDate: null,
    closePrice: null,
    underlyingResolutionPrice: finite(trade.expirationClosePrice),
  };
}

function hasLoadedCurrentMarketData(trade: PortfolioTrade): boolean {
  if (trade.status !== 'open' || !trade.latestMarketData) return false;
  const market = trade.latestMarketData;
  return [
    market.underlyingPrice,
    market.optionBid,
    market.optionMid,
    market.optionAsk,
    market.optionLast,
    market.delta,
    market.iv,
    market.volume,
    market.openInterest,
  ].some(value => finite(value) != null);
}

function currentMarketCells(trade: PortfolioTrade, markBasis: MarkBasis): PortfolioHistoricalCsvCell[] {
  if (trade.status !== 'open') return Array.from({ length: 26 }, () => null);
  const market: PortfolioMarketData | undefined = trade.latestMarketData;
  const hasCurrentUnderlying = finite(market?.underlyingPrice) != null;
  return [
    finite(market?.underlyingPrice),
    calculateRemainingDte(trade),
    finite(market?.optionBid),
    calculateCurrentOptionMark(trade, 'mid'),
    finite(market?.optionAsk),
    finite(market?.optionLast),
    timestampIso(market?.lastTradeDate),
    finite(market?.delta),
    finite(market?.iv),
    finite(market?.volume),
    finite(market?.openInterest),
    markBasis,
    calculateCurrentOptionMark(trade, markBasis),
    calculateCurrentPositionValue(trade, markBasis),
    calculateTotalGainLoss(trade, markBasis),
    percentagePoints(calculatePercentCaptured(trade, markBasis)),
    percentagePoints(calculateCurrentNominalYield(trade, markBasis)),
    percentagePoints(calculateCurrentAnnualizedYield(trade, markBasis)),
    hasCurrentUnderlying ? percentagePoints(calculateDistanceToStrike(trade)) : null,
    hasCurrentUnderlying ? percentagePoints(calculateDistanceToBreakeven(trade)) : null,
    market?.availabilityStatus ?? null,
    timestampIso(market?.refreshedAt),
    timestampIso(market?.providerMarketAt),
    timestampIso(market?.providerQuoteAt),
    timestampIso(market?.cachedAt),
    market?.timestampSource ?? null,
  ];
}

function resolutionEconomicsCells(trade: PortfolioTrade): PortfolioHistoricalCsvCell[] {
  if (trade.status === 'open') return [null, null, null, null, null];
  return [
    historyFinalValue(trade),
    historyRealizedPnl(trade),
    percentagePoints(historyPercentCaptured(trade)),
    historyDaysHeld(trade),
    percentagePoints(historyRealizedIrr(trade)),
  ];
}

function buildRow(trade: PortfolioTrade, markBasis: MarkBasis): PortfolioHistoricalCsvCell[] {
  const lifecycle = sourceCompatibleLifecycle(trade);
  return [
    trade.ticker,
    trade.expiration,
    trade.strike,
    trade.contracts,
    trade.soldPrice,
    trade.soldDate,
    finite(trade.entryDelta),
    finite(trade.entryIv),
    lifecycle.status,
    lifecycle.outcome,
    lifecycle.closeDate,
    lifecycle.closePrice,
    lifecycle.underlyingResolutionPrice,
    trade.id,
    trade.optionType,
    makePortfolioContractKey(trade),
    trade.status,
    trade.resolutionType ?? null,
    trade.resolutionSource ?? null,
    trade.resolutionWarning ?? null,
    trade.notes ?? '',
    calculateOriginalDte(trade),
    trade.entryDeltaSource ?? null,
    timestampIso(trade.entryDeltaCapturedAt),
    trade.entryIvSource ?? null,
    timestampIso(trade.entryIvCapturedAt),
    finite(trade.entryVixClose),
    trade.entryVixDate ?? null,
    trade.entryVixSource ?? null,
    calculateEquityAtRisk(trade),
    calculatePremiumCollected(trade),
    percentagePoints(calculateOriginalNominalYield(trade)),
    percentagePoints(calculateOriginalAnnualizedYield(trade)),
    calculateBreakeven(trade),
    calculateNetCapitalAtRisk(trade),
    ...resolutionEconomicsCells(trade),
    ...currentMarketCells(trade, markBasis),
  ];
}

function sanitizeSpreadsheetText(value: string): string {
  return /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
}

function encodeCsvCell(value: PortfolioHistoricalCsvCell): string {
  if (value == null || (typeof value === 'number' && !Number.isFinite(value))) return '';
  const text = typeof value === 'number' ? String(value) : sanitizeSpreadsheetText(value);
  return /[",\r\n]|^\s|\s$/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function encodePortfolioHistoricalCsv(rows: readonly (readonly PortfolioHistoricalCsvCell[])[]): string {
  return `\uFEFF${rows.map(row => row.map(encodeCsvCell).join(',')).join('\r\n')}\r\n`;
}

export function buildPortfolioHistoricalCsvFilename(now = new Date()): string {
  return `put-scanner-portfolio-${usMarketDateIso(now)}.csv`;
}

export function buildPortfolioHistoricalCsvExport(
  trades: readonly PortfolioTrade[],
  markBasis: MarkBasis,
  now = new Date(),
): PortfolioHistoricalCsvExport {
  const rows = trades.map(trade => buildRow(trade, markBasis));
  const openLots = trades.filter(trade => trade.status === 'open').length;
  return {
    filename: buildPortfolioHistoricalCsvFilename(now),
    csv: encodePortfolioHistoricalCsv([PORTFOLIO_HISTORICAL_CSV_COLUMNS, ...rows]),
    rows,
    summary: {
      openLots,
      resolvedLots: trades.length - openLots,
      totalLots: trades.length,
      currentMarketCoveredLots: trades.filter(hasLoadedCurrentMarketData).length,
    },
  };
}

export function downloadPortfolioHistoricalCsvExport(output: PortfolioHistoricalCsvExport): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') {
    throw new Error('CSV downloads are unavailable in this browser.');
  }
  const blob = new Blob([output.csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = output.filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

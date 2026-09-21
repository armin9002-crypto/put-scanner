import { usMarketDateIso } from './usMarketCalendar.ts';
import { isWatchlistContractInOpenPortfolio } from './watchlistPortfolioMembership.ts';
import type { WatchlistLiveRow } from './watchlistRows.ts';

export const WATCHLIST_EXCEL_COLUMNS = [
  'Ticker',
  'Expiration',
  'DTE',
  'Strike',
  'In Open Portfolio',
  'Underlying Price',
  'Last',
  'Bid',
  'Ask',
  'Delta',
  'Delta Source',
  'Moneyness',
  'Moneyness %',
  'IV',
  'Last Trade Date',
  'Nominal Yield Last',
  'Annualized Yield Last',
  'Nominal Yield Bid',
  'Annualized Yield Bid',
  'Nominal Yield Ask',
  'Annualized Yield Ask',
  'Volume',
  'Open Interest',
  'Volume / Open Interest',
  'State',
  'Note',
  'Added Date',
  'Quote Observed At',
  'Evidence Freshness',
  'Evidence Source',
  'Provider Market Time',
  'Integrity Status',
  'Watchlist Item ID',
] as const;

export type WatchlistExcelColumn = typeof WATCHLIST_EXCEL_COLUMNS[number];
export type WatchlistExcelCell = Date | number | string | null;

export interface WatchlistExcelExport {
  filename: string;
  columns: typeof WATCHLIST_EXCEL_COLUMNS;
  rows: readonly (readonly WatchlistExcelCell[])[];
}

interface XlsxCell {
  t?: string;
  v?: unknown;
  z?: string;
}

interface XlsxWorksheet {
  '!autofilter'?: { ref: string };
  '!cols'?: Array<{ wch: number }>;
  [address: string]: unknown;
}

type XlsxWorkbook = Record<string, unknown>;

export interface XlsxExportRuntime {
  utils: {
    aoa_to_sheet(data: unknown[][]): XlsxWorksheet;
    book_new(): XlsxWorkbook;
    book_append_sheet(workbook: XlsxWorkbook, worksheet: XlsxWorksheet, name: string): void;
  };
  write(workbook: XlsxWorkbook, options: { bookType: 'xlsx'; type: 'array' }): ArrayBuffer | Uint8Array;
}

const DATE_ONLY_FORMAT = 'yyyy-mm-dd';
const DATE_TIME_FORMAT = 'yyyy-mm-dd hh:mm';
const PERCENT_FORMAT = '0.0%';

const COLUMN_WIDTHS = [
  12, 13, 7, 10, 17, 16, 10, 10, 10, 10, 14, 15, 13, 10, 17, 18, 22,
  17, 24, 17, 24, 11, 14, 22, 16, 32, 17, 20, 18, 18, 20, 16, 26,
];

const NUMBER_FORMATS: Partial<Record<WatchlistExcelColumn, string>> = {
  DTE: '0',
  Strike: '$0.00',
  'Underlying Price': '$0.00',
  Last: '$0.00',
  Bid: '$0.00',
  Ask: '$0.00',
  Delta: '0.000',
  'Moneyness %': PERCENT_FORMAT,
  IV: PERCENT_FORMAT,
  'Nominal Yield Last': PERCENT_FORMAT,
  'Annualized Yield Last': PERCENT_FORMAT,
  'Nominal Yield Bid': PERCENT_FORMAT,
  'Annualized Yield Bid': PERCENT_FORMAT,
  'Nominal Yield Ask': PERCENT_FORMAT,
  'Annualized Yield Ask': PERCENT_FORMAT,
  Volume: '#,##0',
  'Open Interest': '#,##0',
  'Volume / Open Interest': '0.00',
};

const DATE_ONLY_COLUMNS = new Set<WatchlistExcelColumn>(['Expiration']);
const DATE_TIME_COLUMNS = new Set<WatchlistExcelColumn>(['Last Trade Date', 'Added Date', 'Quote Observed At', 'Provider Market Time']);

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function percentageFraction(value: number | null | undefined): number | null {
  const points = finiteOrNull(value);
  return points == null ? null : points / 100;
}

/** Prefix dangerous text only in the exported cell; the saved Watchlist value is untouched. */
export function sanitizeWatchlistSpreadsheetText(value: string): string {
  return /^\s*[=+\-@]/.test(value) ? `'${value}` : value;
}

function safeText(value: string | null | undefined): string | null {
  return value == null ? null : sanitizeWatchlistSpreadsheetText(value);
}

function dateOnlyCell(value: string): Date | string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return safeText(value);
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : safeText(value);
}

function timestampCell(value: number | null | undefined): Date | null {
  const numeric = finiteOrNull(value);
  if (numeric == null || numeric <= 0) return null;
  const milliseconds = numeric < 100_000_000_000 ? numeric * 1_000 : numeric;
  const date = new Date(milliseconds);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function buildWatchlistExcelFilename(now = new Date()): string {
  return `put-scanner-watchlist-${usMarketDateIso(now)}.xlsx`;
}

export function buildWatchlistExcelExport(
  rows: readonly WatchlistLiveRow[],
  openPortfolioContractKeys: ReadonlySet<string>,
  now = new Date(),
): WatchlistExcelExport {
  return {
    filename: buildWatchlistExcelFilename(now),
    columns: WATCHLIST_EXCEL_COLUMNS,
    rows: rows.map(row => [
      safeText(row.ticker),
      dateOnlyCell(row.expiry),
      finiteOrNull(row.dte),
      finiteOrNull(row.strike),
      isWatchlistContractInOpenPortfolio(row, openPortfolioContractKeys) ? 'Yes' : 'No',
      finiteOrNull(row.currentPrice),
      finiteOrNull(row.last),
      finiteOrNull(row.bid),
      finiteOrNull(row.ask),
      finiteOrNull(row.delta),
      safeText(row.deltaSource),
      safeText(row.moneynessLabel),
      percentageFraction(row.moneynessPct),
      percentageFraction(row.iv),
      timestampCell(row.lastTradeDate),
      percentageFraction(row.nomYieldLast),
      percentageFraction(row.annYieldLast),
      percentageFraction(row.nomYieldBid),
      percentageFraction(row.annYieldBid),
      percentageFraction(row.nomYieldAsk),
      percentageFraction(row.annYieldAsk),
      finiteOrNull(row.volume),
      finiteOrNull(row.openInterest),
      finiteOrNull(row.volOI),
      safeText(row.statusLabel),
      sanitizeWatchlistSpreadsheetText(row.note),
      timestampCell(row.addedAt),
      timestampCell(row.observedAt),
      safeText(row.evidenceFreshness),
      safeText(row.snapshot?.evidenceSource),
      timestampCell(row.snapshot?.providerMarketTime),
      safeText(row.snapshot?.integrityStatus),
      safeText(row.id),
    ]),
  };
}

function excelColumnName(index: number): string {
  let value = index + 1;
  let result = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function cellAt(worksheet: XlsxWorksheet, columnIndex: number, rowIndex: number): XlsxCell | null {
  const cell = worksheet[`${excelColumnName(columnIndex)}${rowIndex}`];
  return cell && typeof cell === 'object' ? cell as XlsxCell : null;
}

export function buildWatchlistWorkbook(
  exportData: WatchlistExcelExport,
  runtime: XlsxExportRuntime,
): XlsxWorkbook {
  const values = [
    [...exportData.columns],
    ...exportData.rows.map(row => [...row]),
  ];
  const worksheet = runtime.utils.aoa_to_sheet(values);
  const lastRow = values.length;
  const lastColumn = excelColumnName(exportData.columns.length - 1);
  worksheet['!autofilter'] = { ref: `A1:${lastColumn}${lastRow}` };
  worksheet['!cols'] = COLUMN_WIDTHS.map(wch => ({ wch }));

  exportData.columns.forEach((column, columnIndex) => {
    const numberFormat = NUMBER_FORMATS[column];
    const dateFormat = DATE_ONLY_COLUMNS.has(column)
      ? DATE_ONLY_FORMAT
      : DATE_TIME_COLUMNS.has(column) ? DATE_TIME_FORMAT : numberFormat;
    if (!dateFormat) return;
    for (let rowIndex = 2; rowIndex <= lastRow; rowIndex += 1) {
      const cell = cellAt(worksheet, columnIndex, rowIndex);
      if (cell) cell.z = dateFormat;
    }
  });

  const workbook = runtime.utils.book_new();
  runtime.utils.book_append_sheet(workbook, worksheet, 'Watchlist');
  return workbook;
}

export async function downloadWatchlistExcelExport(exportData: WatchlistExcelExport): Promise<void> {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') {
    throw new Error('Excel downloads are unavailable in this browser.');
  }
  const runtime = await import('xlsx') as unknown as XlsxExportRuntime;
  const workbook = buildWatchlistWorkbook(exportData, runtime);
  const bytes = runtime.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = exportData.filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

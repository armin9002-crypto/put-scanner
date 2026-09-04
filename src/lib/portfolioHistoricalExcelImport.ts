import { makePortfolioContractKey } from './portfolioContractIdentity.ts';
import { resolveExpiredTradeWithClose } from './portfolioExpirationArchive.ts';
import { resolvePortfolioEntryVix, type PortfolioEntryVixResult } from './portfolioEntryVix.ts';
import { reconcilePortfolioTradeEconomics } from './portfolioRealizedEconomics.ts';
import {
  makePortfolioTradeId,
  normalizePortfolioTrade,
  type PortfolioTrade,
} from './portfolioStorage.ts';

export const HISTORICAL_EXCEL_HEADERS = [
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
] as const;

export const HISTORICAL_EXCEL_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxWorksheets: 20,
  maxRowsPerWorksheet: 5_000,
  maxColumnsPerWorksheet: 256,
  maxParsedCells: 100_000,
} as const;

export const IMPORTED_EXPIRATION_PRICE_WARNING = 'Historical underlying expiration price imported from source workbook; not provider-verified.';

export type HistoricalExcelLifecycle = 'expired_worthless' | 'closed_manually';
export type HistoricalExcelPriceSemantic = 'expiration_underlying' | 'manual_close_underlying';
export type HistoricalExcelRowState = 'ready' | 'needs_review' | 'blocked' | 'possible_duplicate' | 'possible_existing_duplicate';
export type HistoricalExcelDestination = 'new_contract_position' | 'adds_to_existing_contract' | 'adds_to_imported_contract';

export interface HistoricalExcelIssue {
  code: string;
  severity: 'review' | 'blocked';
  message: string;
}

export interface HistoricalExcelSourceLot {
  ticker: string | null;
  expiration: string | null;
  strike: number | null;
  contracts: number | null;
  soldPrice: number | null;
  soldDate: string | null;
  entryDelta: number | null;
  entryIv: number | null;
  status: string;
  outcome: string;
  closeDate: string | null;
  optionClosePrice: number | null;
  underlyingHistoricalPrice: number | null;
  priceSemantic: HistoricalExcelPriceSemantic | null;
}

export interface StagedHistoricalExcelLot {
  stagingId: string;
  sourceRowNumber: number;
  source: HistoricalExcelSourceLot;
  lifecycle: HistoricalExcelLifecycle | null;
  issues: HistoricalExcelIssue[];
  state: HistoricalExcelRowState;
  selected: false;
  destination: HistoricalExcelDestination;
  contractKey: string | null;
  workbookFingerprint: string | null;
  fingerprint: string | null;
  matchingExistingLotId?: string;
  proposedTrade: PortfolioTrade | null;
}

export interface HistoricalExcelParseResult {
  fileName: string;
  worksheetName: string;
  headerRowNumber: number;
  headerColumnNumber: number;
  dateSystem: '1900' | '1904';
  formulaCellCount: number;
  rows: StagedHistoricalExcelLot[];
  entryVixNetworkRequests: number;
  entryVixWarning?: string;
}

export interface HistoricalExcelImportSummary {
  rowsParsed: number;
  ready: number;
  needsReview: number;
  blocked: number;
  possibleDuplicate: number;
  possibleExistingDuplicate: number;
  expiredWorthless: number;
  closedManually: number;
  historicalUnderlyingPricesSupplied: number;
  expirationUnderlyingPricesSupplied: number;
  manualCloseUnderlyingPricesSupplied: number;
  entryVixEnriched: number;
}

interface XlsxCell {
  t?: string;
  v?: unknown;
  w?: string;
  z?: string;
  f?: string;
}

interface XlsxWorksheet {
  '!ref'?: string;
  [address: string]: unknown;
}

interface XlsxWorkbook {
  SheetNames: string[];
  Sheets: Record<string, XlsxWorksheet>;
  Workbook?: { WBProps?: { date1904?: boolean } };
  vbaraw?: unknown;
}

interface XlsxRuntime {
  read(data: ArrayBuffer, options: Record<string, unknown>): XlsxWorkbook;
  utils: {
    decode_range(reference: string): { s: { r: number; c: number }; e: { r: number; c: number } };
    encode_cell(cell: { r: number; c: number }): string;
  };
  SSF: {
    is_date(format: string): boolean;
    parse_date_code(value: number, options?: { date1904?: boolean }): { y: number; m: number; d: number } | null;
  };
}

interface ParseOptions {
  existingTrades?: readonly PortfolioTrade[];
  nowIso?: string;
  idFactory?: () => string;
  stagingSessionId?: string;
  xlsxRuntime?: XlsxRuntime;
}

function readCell(sheet: XlsxWorksheet, runtime: XlsxRuntime, row: number, column: number): XlsxCell | undefined {
  const value = sheet[runtime.utils.encode_cell({ r: row, c: column })];
  return value && typeof value === 'object' ? value as XlsxCell : undefined;
}

function cellText(cell: XlsxCell | undefined): string {
  return typeof cell?.v === 'string' ? cell.v.trim() : '';
}

function cellNumber(cell: XlsxCell | undefined): number | null {
  return typeof cell?.v === 'number' && Number.isFinite(cell.v) ? cell.v : null;
}

function hasCellValue(cell: XlsxCell | undefined): boolean {
  return cell?.f !== undefined || (cell?.v !== undefined && cell.v !== null && cell.v !== '');
}

function validIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const stamp = Date.UTC(year, month - 1, day);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === value;
}

function datePartsToIso(year: number, month: number, day: number): string | null {
  const iso = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return validIsoDate(iso) ? iso : null;
}

export function parseExcelDateOnly(
  cell: XlsxCell | undefined,
  date1904: boolean,
  runtime: Pick<XlsxRuntime, 'SSF'>,
): string | null {
  if (!cell || cell.f !== undefined) return null;
  if (cell.v instanceof Date && Number.isFinite(cell.v.getTime())) {
    return datePartsToIso(cell.v.getUTCFullYear(), cell.v.getUTCMonth() + 1, cell.v.getUTCDate());
  }
  if (typeof cell.v === 'string') {
    const value = cell.v.trim();
    return validIsoDate(value) ? value : null;
  }
  if (typeof cell.v !== 'number' || !Number.isFinite(cell.v) || !cell.z || !runtime.SSF.is_date(cell.z)) return null;
  const parsed = runtime.SSF.parse_date_code(cell.v, { date1904 });
  return parsed ? datePartsToIso(parsed.y, parsed.m, parsed.d) : null;
}

function numberKey(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '';
  return String(Math.round((value + Number.EPSILON) * 100_000_000) / 100_000_000);
}

export function makeHistoricalPortfolioLotFingerprint(trade: Pick<PortfolioTrade,
  'ticker' | 'optionType' | 'expiration' | 'strike' | 'contracts' | 'soldDate' | 'soldPrice' | 'status'
  | 'resolutionType' | 'closeDate' | 'closePrice'
>): string {
  return [
    trade.ticker.trim().toUpperCase(),
    trade.optionType,
    trade.expiration,
    numberKey(trade.strike),
    String(trade.contracts),
    trade.soldDate,
    numberKey(trade.soldPrice),
    trade.status,
    trade.resolutionType ?? '',
    trade.closeDate ?? '',
    numberKey(trade.closePrice),
  ].join('|');
}

function makeHistoricalWorkbookRowFingerprint(
  source: HistoricalExcelSourceLot,
  lifecycle: HistoricalExcelLifecycle,
): string {
  return [
    source.ticker ?? '',
    source.expiration ?? '',
    numberKey(source.strike),
    source.contracts == null ? '' : String(source.contracts),
    numberKey(source.soldPrice),
    source.soldDate ?? '',
    numberKey(source.entryDelta),
    numberKey(source.entryIv),
    source.status,
    source.outcome,
    source.closeDate ?? '',
    numberKey(source.optionClosePrice),
    numberKey(source.underlyingHistoricalPrice),
    lifecycle,
  ].join('|');
}

export function findExactHistoricalPortfolioLotMatches(
  incoming: readonly PortfolioTrade[],
  existing: readonly PortfolioTrade[],
): Map<string, string> {
  const available = new Map<string, string[]>();
  existing.forEach(trade => {
    const fingerprint = makeHistoricalPortfolioLotFingerprint(trade);
    const ids = available.get(fingerprint) ?? [];
    ids.push(trade.id);
    available.set(fingerprint, ids);
  });
  const matches = new Map<string, string>();
  incoming.forEach(trade => {
    const ids = available.get(makeHistoricalPortfolioLotFingerprint(trade));
    const matched = ids?.shift();
    if (matched) matches.set(trade.id, matched);
  });
  return matches;
}

function formulaIssue(label: string): HistoricalExcelIssue {
  return { code: 'required_formula', severity: 'blocked', message: `${label} contains a formula. Required import facts must be hard-coded source values.` };
}

function requiredValueIssue(code: string, label: string): HistoricalExcelIssue {
  return { code, severity: 'blocked', message: `${label} is missing or invalid.` };
}

function issueState(issues: readonly HistoricalExcelIssue[]): HistoricalExcelRowState {
  return issues.some(issue => issue.severity === 'blocked')
    ? 'blocked'
    : issues.some(issue => issue.severity === 'review') ? 'needs_review' : 'ready';
}

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `excel_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function parseRow(
  sheet: XlsxWorksheet,
  runtime: XlsxRuntime,
  rowIndex: number,
  headerColumn: number,
  date1904: boolean,
  nowIso: string,
  idFactory: () => string,
  stagingSessionId: string,
): StagedHistoricalExcelLot {
  const cells = HISTORICAL_EXCEL_HEADERS.map((_, index) => readCell(sheet, runtime, rowIndex, headerColumn + index));
  const issues: HistoricalExcelIssue[] = [];
  const rawStatus = cellText(cells[8]);
  const rawOutcome = cellText(cells[9]);
  const lifecycle: HistoricalExcelLifecycle | null = rawStatus === 'Held to Expiration' && rawOutcome === 'Expired Worthless'
    ? 'expired_worthless'
    : rawStatus === 'Closed / Bought Back' && rawOutcome === 'Closed Manually'
      ? 'closed_manually'
      : null;
  const requiredIndexes = lifecycle === 'expired_worthless'
    ? [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12]
    : lifecycle === 'closed_manually'
      ? HISTORICAL_EXCEL_HEADERS.map((_, index) => index)
      : [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12];
  requiredIndexes.forEach(index => {
    if (cells[index]?.f !== undefined) issues.push(formulaIssue(HISTORICAL_EXCEL_HEADERS[index]));
  });

  const tickerText = cellText(cells[0]).toUpperCase();
  const ticker = /^[A-Z0-9.^-]{1,20}$/.test(tickerText) ? tickerText : null;
  if (!ticker) issues.push(requiredValueIssue('invalid_ticker', 'Ticker'));
  const expiration = parseExcelDateOnly(cells[1], date1904, runtime);
  if (!expiration) issues.push(requiredValueIssue('invalid_expiration', 'Expiration'));
  const strikeValue = cellNumber(cells[2]);
  const strike = strikeValue != null && strikeValue > 0 ? strikeValue : null;
  if (strike == null) issues.push(requiredValueIssue('invalid_strike', 'Strike'));
  const contractsValue = cellNumber(cells[3]);
  const contracts = contractsValue != null && contractsValue > 0 && Number.isInteger(contractsValue) ? contractsValue : null;
  if (contracts == null) issues.push(requiredValueIssue('invalid_contracts', 'Contracts'));
  const soldPriceValue = cellNumber(cells[4]);
  const soldPrice = soldPriceValue != null && soldPriceValue > 0 ? soldPriceValue : null;
  if (soldPrice == null) issues.push(requiredValueIssue('invalid_sold_price', 'Sold Price (Net)'));
  const soldDate = parseExcelDateOnly(cells[5], date1904, runtime);
  if (!soldDate) issues.push(requiredValueIssue('invalid_sold_date', 'Sold Date'));
  const deltaValue = cellNumber(cells[6]);
  const entryDelta = deltaValue != null && deltaValue >= -1 && deltaValue <= 0 ? deltaValue : null;
  if (entryDelta == null) issues.push(requiredValueIssue('invalid_entry_delta', 'Delta at Entry'));
  const ivRaw = cellNumber(cells[7]);
  const ivFormat = cells[7]?.z ?? '';
  const entryIv = ivRaw != null && ivRaw > 0 && ivFormat.includes('%') ? ivRaw * 100 : null;
  if (entryIv == null) {
    issues.push({
      code: 'ambiguous_entry_iv',
      severity: 'review',
      message: 'IV at Entry must be a positive numeric Excel percentage cell so its scale is unambiguous.',
    });
  }
  if (!lifecycle) issues.push({
    code: 'unsupported_lifecycle',
    severity: 'blocked',
    message: 'Status and Outcome must be Held to Expiration / Expired Worthless or Closed / Bought Back / Closed Manually.',
  });
  const closeDate = parseExcelDateOnly(cells[10], date1904, runtime);
  if (lifecycle === 'closed_manually' && !closeDate) issues.push(requiredValueIssue('invalid_close_date', 'Close Date'));
  const optionCloseValue = cellNumber(cells[11]);
  const optionClosePrice = optionCloseValue != null && optionCloseValue >= 0 ? optionCloseValue : null;
  if (lifecycle === 'closed_manually' && optionClosePrice == null) issues.push(requiredValueIssue('invalid_option_close_price', 'Close price'));
  const underlyingValue = cellNumber(cells[12]);
  const underlyingHistoricalPrice = underlyingValue != null && underlyingValue > 0 ? underlyingValue : null;
  if (underlyingHistoricalPrice == null) issues.push({
    code: 'invalid_underlying_price',
    severity: 'review',
    message: 'Underlying Price at Expiration / Contract Close must be a positive numeric source value; provider data is not substituted silently.',
  });
  if (soldDate && expiration && soldDate > expiration) issues.push({
    code: 'invalid_date_order', severity: 'blocked', message: 'Sold Date must be on or before Expiration.',
  });
  if (lifecycle === 'closed_manually' && soldDate && closeDate && expiration && (soldDate > closeDate || closeDate > expiration)) {
    issues.push({ code: 'invalid_close_date_order', severity: 'blocked', message: 'Closed lots require Sold Date <= Close Date <= Expiration.' });
  }
  if (lifecycle === 'expired_worthless' && strike != null && underlyingHistoricalPrice != null && underlyingHistoricalPrice < strike) {
    issues.push({
      code: 'worthless_price_contradiction',
      severity: 'blocked',
      message: 'Expired Worthless contradicts the supplied underlying expiration price because that price is below the put strike.',
    });
  }

  const source: HistoricalExcelSourceLot = {
    ticker,
    expiration,
    strike,
    contracts,
    soldPrice,
    soldDate,
    entryDelta,
    entryIv,
    status: rawStatus,
    outcome: rawOutcome,
    closeDate,
    optionClosePrice,
    underlyingHistoricalPrice,
    priceSemantic: lifecycle === 'expired_worthless' ? 'expiration_underlying' : lifecycle === 'closed_manually' ? 'manual_close_underlying' : null,
  };
  let proposedTrade: PortfolioTrade | null = null;
  if (issueState(issues) === 'ready' && ticker && expiration && strike != null && contracts != null && soldPrice != null && soldDate && entryDelta != null && entryIv != null && lifecycle && underlyingHistoricalPrice != null) {
    const normalized = normalizePortfolioTrade({
      id: idFactory(),
      ticker,
      optionType: 'put',
      expiration,
      strike,
      contracts,
      soldPrice,
      soldDate,
      status: lifecycle === 'closed_manually' ? 'closed' : 'open',
      ...(lifecycle === 'closed_manually' ? {
        closeDate: closeDate!,
        closePrice: optionClosePrice!,
        closeUnderlyingPrice: underlyingHistoricalPrice,
        closeUnderlyingPriceSource: 'imported' as const,
      } : {}),
      entryDelta,
      entryDeltaSource: 'imported',
      entryDeltaCapturedAt: nowIso,
      entryIv,
      entryIvSource: 'imported',
      entryIvCapturedAt: nowIso,
      createdAt: nowIso,
      updatedAt: nowIso,
    }, { generateMissingFields: false });
    if (normalized) {
      proposedTrade = lifecycle === 'expired_worthless'
        ? resolveExpiredTradeWithClose(
            normalized,
            underlyingHistoricalPrice,
            expiration,
            'manual_expiration_close',
            IMPORTED_EXPIRATION_PRICE_WARNING,
            nowIso,
          )
        : reconcilePortfolioTradeEconomics(null, normalized);
    }
    if (!proposedTrade) issues.push({ code: 'canonical_validation_failed', severity: 'blocked', message: 'The resulting Portfolio lot failed canonical validation.' });
  }
  const contractKey = proposedTrade ? makePortfolioContractKey(proposedTrade) : null;
  const workbookFingerprint = proposedTrade && lifecycle ? makeHistoricalWorkbookRowFingerprint(source, lifecycle) : null;
  const fingerprint = proposedTrade ? makeHistoricalPortfolioLotFingerprint(proposedTrade) : null;
  return {
    stagingId: `${stagingSessionId}:${rowIndex + 1}`,
    sourceRowNumber: rowIndex + 1,
    source,
    lifecycle,
    issues,
    state: issueState(issues),
    selected: false,
    destination: 'new_contract_position',
    contractKey,
    workbookFingerprint,
    fingerprint,
    proposedTrade,
  };
}

export function matchHistoricalExcelDuplicates(
  rows: readonly StagedHistoricalExcelLot[],
  existingTrades: readonly PortfolioTrade[],
): StagedHistoricalExcelLot[] {
  const workbookCounts = new Map<string, number>();
  rows.forEach(row => {
    if (row.workbookFingerprint) {
      workbookCounts.set(row.workbookFingerprint, (workbookCounts.get(row.workbookFingerprint) ?? 0) + 1);
    }
  });
  const existingMatches = findExactHistoricalPortfolioLotMatches(
    rows.flatMap(row => row.proposedTrade ? [row.proposedTrade] : []),
    existingTrades,
  );
  const existingContracts = new Set(existingTrades.map(makePortfolioContractKey));
  const stagedContracts = new Set<string>();
  return rows.map(row => {
    let destination: HistoricalExcelDestination = 'new_contract_position';
    if (row.contractKey && existingContracts.has(row.contractKey)) destination = 'adds_to_existing_contract';
    else if (row.contractKey && stagedContracts.has(row.contractKey)) destination = 'adds_to_imported_contract';
    if (row.contractKey) stagedContracts.add(row.contractKey);
    if (!row.proposedTrade || row.state === 'blocked' || row.state === 'needs_review') return { ...row, destination };
    const matchingExistingLotId = existingMatches.get(row.proposedTrade.id);
    if (matchingExistingLotId) {
      return { ...row, destination, state: 'possible_existing_duplicate', matchingExistingLotId };
    }
    if (row.workbookFingerprint && (workbookCounts.get(row.workbookFingerprint) ?? 0) > 1) {
      return { ...row, destination, state: 'possible_duplicate', matchingExistingLotId: undefined };
    }
    return { ...row, destination, state: 'ready', matchingExistingLotId: undefined };
  });
}

function findHeaderMatches(workbook: XlsxWorkbook, runtime: XlsxRuntime): Array<{ sheetName: string; row: number; column: number }> {
  const matches: Array<{ sheetName: string; row: number; column: number }> = [];
  let closest: { count: number; missing: string[] } | null = null;
  let parsedCells = 0;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const reference = sheet?.['!ref'];
    if (!sheet || !reference) continue;
    const range = runtime.utils.decode_range(reference);
    const rowCount = range.e.r - range.s.r + 1;
    const columnCount = range.e.c - range.s.c + 1;
    if (rowCount > HISTORICAL_EXCEL_LIMITS.maxRowsPerWorksheet || columnCount > HISTORICAL_EXCEL_LIMITS.maxColumnsPerWorksheet) {
      throw new Error('The workbook exceeds the safe worksheet row or column limit. No data was changed.');
    }
    parsedCells += Object.keys(sheet).filter(key => !key.startsWith('!')).length;
    if (parsedCells > HISTORICAL_EXCEL_LIMITS.maxParsedCells) throw new Error('The workbook exceeds the safe parsed-cell limit. No data was changed.');
    for (let row = range.s.r; row <= range.e.r; row += 1) {
      for (let column = range.s.c; column <= range.e.c - HISTORICAL_EXCEL_HEADERS.length + 1; column += 1) {
        const values = HISTORICAL_EXCEL_HEADERS.map((_, index) => cellText(readCell(sheet, runtime, row, column + index)));
        const count = values.reduce((total, value, index) => total + (value === HISTORICAL_EXCEL_HEADERS[index] ? 1 : 0), 0);
        if (count === HISTORICAL_EXCEL_HEADERS.length) matches.push({ sheetName, row, column });
        if (!closest || count > closest.count) {
          closest = { count, missing: HISTORICAL_EXCEL_HEADERS.filter((header, index) => values[index] !== header) };
        }
      }
    }
  }
  if (matches.length === 0 && closest && closest.count >= HISTORICAL_EXCEL_HEADERS.length - 1) {
    throw new Error(`The V5 schema is missing or changed at: ${closest.missing.join(', ')}. No data was changed.`);
  }
  return matches;
}

export async function parseHistoricalExcelWorkbook(
  data: ArrayBuffer,
  fileName: string,
  options: ParseOptions = {},
): Promise<HistoricalExcelParseResult> {
  const normalizedName = fileName.trim().toLowerCase();
  if (!normalizedName.endsWith('.xlsx') || normalizedName.endsWith('.xlsm.xlsx')) {
    throw new Error('Historical Excel Import accepts .xlsx files only. Macro-enabled workbooks are not accepted.');
  }
  if (data.byteLength <= 0 || data.byteLength > HISTORICAL_EXCEL_LIMITS.maxFileBytes) {
    throw new Error('The workbook is empty or exceeds the 10 MB safety limit. No data was changed.');
  }
  const runtime = options.xlsxRuntime ?? await import('xlsx') as unknown as XlsxRuntime;
  let workbook: XlsxWorkbook;
  try {
    workbook = runtime.read(data, {
      type: 'array',
      cellFormula: true,
      cellNF: true,
      cellText: false,
      cellDates: false,
      dense: false,
      sheetStubs: true,
      bookVBA: true,
      WTF: false,
    });
  } catch {
    throw new Error('The selected workbook could not be parsed safely. No data was changed.');
  }
  if (workbook.vbaraw) throw new Error('Embedded VBA content is not accepted. No data was changed.');
  if (!Array.isArray(workbook.SheetNames) || workbook.SheetNames.length === 0 || workbook.SheetNames.length > HISTORICAL_EXCEL_LIMITS.maxWorksheets) {
    throw new Error('The workbook has no worksheets or exceeds the 20-sheet safety limit. No data was changed.');
  }
  const matches = findHeaderMatches(workbook, runtime);
  if (matches.length === 0) throw new Error('No exact V5 historical-trade schema was found. No data was changed.');
  if (matches.length > 1) throw new Error('More than one V5 historical-trade schema was found. Import is ambiguous and no data was changed.');
  const match = matches[0];
  const sheet = workbook.Sheets[match.sheetName];
  const range = runtime.utils.decode_range(sheet['!ref']!);
  const date1904 = workbook.Workbook?.WBProps?.date1904 === true;
  const nowIso = options.nowIso ?? new Date().toISOString();
  const idFactory = options.idFactory ?? makePortfolioTradeId;
  const stagingSessionId = options.stagingSessionId ?? createSessionId();
  const rows: StagedHistoricalExcelLot[] = [];
  for (let row = match.row + 1; row <= range.e.r; row += 1) {
    const cells = HISTORICAL_EXCEL_HEADERS.map((_, index) => readCell(sheet, runtime, row, match.column + index));
    if (!cells.some(hasCellValue)) continue;
    rows.push(parseRow(sheet, runtime, row, match.column, date1904, nowIso, idFactory, stagingSessionId));
  }
  if (rows.length === 0) throw new Error('The V5 schema was found, but it contains no source trade rows. No data was changed.');
  const formulaCellCount = Object.values(workbook.Sheets).reduce((total, currentSheet) => (
    total + Object.entries(currentSheet).filter(([address, value]) => !address.startsWith('!') && value && typeof value === 'object' && (value as XlsxCell).f !== undefined).length
  ), 0);
  return {
    fileName,
    worksheetName: match.sheetName,
    headerRowNumber: match.row + 1,
    headerColumnNumber: match.column + 1,
    dateSystem: date1904 ? '1904' : '1900',
    formulaCellCount,
    rows: matchHistoricalExcelDuplicates(rows, options.existingTrades ?? []),
    entryVixNetworkRequests: 0,
  };
}

export async function enrichHistoricalExcelEntryVix(
  result: HistoricalExcelParseResult,
  resolver: (trades: PortfolioTrade[]) => Promise<PortfolioEntryVixResult> = resolvePortfolioEntryVix,
): Promise<HistoricalExcelParseResult> {
  const trades = result.rows.flatMap(row => row.proposedTrade ? [row.proposedTrade] : []);
  if (trades.length === 0) return result;
  try {
    const resolved = await resolver(trades);
    const byId = new Map(resolved.trades.map(trade => [trade.id, trade]));
    return {
      ...result,
      rows: result.rows.map(row => row.proposedTrade ? { ...row, proposedTrade: byId.get(row.proposedTrade.id) ?? row.proposedTrade } : row),
      entryVixNetworkRequests: resolved.networkRequests,
      entryVixWarning: resolved.unresolved > 0 ? `${resolved.unresolved} source Sold Date${resolved.unresolved === 1 ? '' : 's'} did not have an available Entry VIX close.` : undefined,
    };
  } catch {
    return { ...result, entryVixWarning: 'Entry VIX enrichment was unavailable. It is non-blocking and no value was fabricated.' };
  }
}

export function summarizeHistoricalExcelImport(result: HistoricalExcelParseResult): HistoricalExcelImportSummary {
  const count = (state: HistoricalExcelRowState) => result.rows.filter(row => row.state === state).length;
  return {
    rowsParsed: result.rows.length,
    ready: count('ready'),
    needsReview: count('needs_review'),
    blocked: count('blocked'),
    possibleDuplicate: count('possible_duplicate'),
    possibleExistingDuplicate: count('possible_existing_duplicate'),
    expiredWorthless: result.rows.filter(row => row.lifecycle === 'expired_worthless').length,
    closedManually: result.rows.filter(row => row.lifecycle === 'closed_manually').length,
    historicalUnderlyingPricesSupplied: result.rows.filter(row => row.source.underlyingHistoricalPrice != null).length,
    expirationUnderlyingPricesSupplied: result.rows.filter(row => row.source.priceSemantic === 'expiration_underlying' && row.source.underlyingHistoricalPrice != null).length,
    manualCloseUnderlyingPricesSupplied: result.rows.filter(row => row.source.priceSemantic === 'manual_close_underlying' && row.source.underlyingHistoricalPrice != null).length,
    entryVixEnriched: result.rows.filter(row => row.proposedTrade?.entryVixClose != null).length,
  };
}

export function historicalExcelStateLabel(state: HistoricalExcelRowState): string {
  if (state === 'needs_review') return 'Needs Review';
  if (state === 'possible_duplicate') return 'Possible Duplicate';
  if (state === 'possible_existing_duplicate') return 'Possible Existing Duplicate';
  return state === 'blocked' ? 'Blocked' : 'Ready';
}

export function historicalExcelDestinationLabel(destination: HistoricalExcelDestination): string {
  if (destination === 'adds_to_existing_contract') return 'Adds to Existing Contract';
  if (destination === 'adds_to_imported_contract') return 'Adds to Imported Contract';
  return 'New Contract Position';
}

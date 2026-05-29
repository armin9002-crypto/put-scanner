import type { PortfolioTrade, PortfolioTradeInput, PortfolioTradeStatus } from './portfolioStorage';

export type OptionSide = 'short' | 'long' | 'unknown';

export interface ParsedBrokerageOptionRow {
  rawText: string;
  ticker: string;
  optionType: 'put';
  strike: number;
  expiration: string;
  quantity: number | null;
  side: OptionSide;
  contracts: number | null;
  lastPrice?: number;
  lastPriceChange?: number;
  todayGainLossDollar?: number;
  todayGainLossPercent?: number;
  totalGainLossDollar?: number;
  totalGainLossPercent?: number;
  currentValue?: number;
  percentOfAccount?: number;
  averageCostBasis?: number;
  costBasisTotal?: number;
  confidence?: number;
  warnings: string[];
}

export interface OcrWordBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface PortfolioImportOcrWord {
  text: string;
  confidence: number;
  bbox: OcrWordBox;
}

export interface PortfolioImportDiagnostics {
  ocrWordCount: number;
  ocrLineCount?: number;
  ocrWordSource?: string;
  ocrPassUsed?: string;
  tesseractVersion?: string;
  tsvPresent?: boolean;
  hocrPresent?: boolean;
  blocksPresent?: boolean;
  structuredOcrUnavailable?: boolean;
  originalImage?: { width: number; height: number };
  preprocessedImage?: { width: number; height: number };
  detectedHeaderColumns: string[];
  detectedOptionRowCount: number;
  parsedRowCount: number;
  importableRowCount: number;
  warnings: string[];
  rowDiagnostics?: Array<{
    rawSymbolText: string;
    rawExpiryText: string;
    rawCells: Record<string, string>;
    parsedValues?: Record<string, string>;
    validation?: Record<string, string>;
    validationScore: number;
    warnings: string[];
  }>;
}

export interface PortfolioImportParseResult {
  rows: ParsedBrokerageOptionRow[];
  diagnostics: PortfolioImportDiagnostics;
}

export interface ImportEditableRow extends ParsedBrokerageOptionRow {
  selected: boolean;
  dateAcquired?: string;
  dateAcquiredEdited?: boolean;
  importAction?: 'add' | 'update' | 'keep' | 'skip';
}

export interface ParsedImportAction {
  key: string;
  row: ImportEditableRow;
  existingTrade?: PortfolioTrade;
  warnings: string[];
  differences?: ImportDifference[];
}

export interface ImportDifference {
  field: string;
  existing: string;
  imported: string;
}

export interface ExistingTradeAction {
  key: string;
  trade: PortfolioTrade;
  suggestedStatus?: PortfolioTradeStatus;
  action: 'keep' | 'closed' | 'expired' | 'assigned';
}

export interface PortfolioImportPlan {
  adds: ParsedImportAction[];
  updates: ParsedImportAction[];
  keeps: ParsedImportAction[];
  skipped: ParsedImportAction[];
  missingFromImport: ExistingTradeAction[];
  warnings: string[];
}

interface NumericToken {
  raw: string;
  value: number;
  isPercent: boolean;
  lineIndex: number;
  tokenIndex: number;
}

interface QuantityParseResult {
  rawQuantity: number | null;
  contracts: number | null;
  side: OptionSide;
  tokenIndex?: number;
}

interface RowBlock {
  symbolLine: string;
  expiration: string | null;
  lines: string[];
}

interface OcrLine {
  words: PortfolioImportOcrWord[];
  text: string;
  confidence: number;
  bbox: OcrWordBox;
}

interface TableRowBlock {
  symbolLine: OcrLine;
  expirationLine: OcrLine | null;
  words: PortfolioImportOcrWord[];
  nextSymbolY: number | null;
}

interface ColumnToken {
  raw: string;
  value: number;
  isPercent: boolean;
  x: number;
  confidence: number;
}

interface FidelityCells {
  lastPrice?: number;
  lastPriceChange?: number;
  todayGainLossDollar?: number;
  todayGainLossPercent?: number;
  totalGainLossDollar?: number;
  totalGainLossPercent?: number;
  currentValue?: number;
  percentOfAccount?: number;
  quantity?: number;
  averageCostBasis?: number;
  costBasisTotal?: number;
  score: number;
}

const MONTHS: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUn: '06',
  JUL: '07',
  JUI: '07',
  JUl: '07',
  AUG: '08',
  SEP: '09',
  SEPT: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

const ENTRY_DATE_WARNING = 'Entry date not shown in screenshot. Import date used as sold date. Edit trade if needed.';

const KNOWN_IMPORT_TICKERS = [
  'LABU', 'SSO', 'SOXL', 'YINN', 'TQQQ', 'QQQ', 'SPY', 'VIX', 'VXN', 'UPRO', 'TNA', 'FAS', 'AGQ', 'NAIL',
  'SQQQ', 'UVXY', 'SOXS', 'TECL', 'FNGU', 'CWEB', 'YANG', 'IWM', 'DIA', 'QLD', 'SSO',
];

const EXPLICIT_TICKER_REPAIRS: Record<string, string> = {
  T0QQ: 'TQQQ',
  TQQ0: 'TQQQ',
  TQOQ: 'TQQQ',
  TOQQ: 'TQQQ',
  TQQO: 'TQQQ',
  TAQQ: 'TQQQ',
};

export function normalizeOcrText(value: string): string {
  return value
    .replace(/\u2212/g, '-')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\bP(?:u[tf]|uf|ul|vt)\b/gi, 'Put')
    .replace(/[|]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function parseMoney(value: string): number | undefined {
  const normalized = value
    .replace(/\u2212/g, '-')
    .replace(/[–—]/g, '-')
    .replace(/\(([^)]+)\)/g, '-$1');
  const match = normalized.match(/-?\$?\s*\d+(?:,\d{3})*(?:\.\d+)?|-?\$?\s*\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const numeric = Number(match[0].replace(/[$,\s]/g, ''));
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function parsePercent(value: string): number | undefined {
  const match = value.replace(/\u2212/g, '-').match(/-?\d+(?:\.\d+)?\s*%?/);
  if (!match) return undefined;
  const numeric = Number(match[0].replace('%', '').trim());
  return Number.isFinite(numeric) ? numeric / 100 : undefined;
}

export function parseSignedNumber(value: string): number | undefined {
  const cleaned = value.replace(/\bM\b/gi, '').replace(/,/g, ' ').replace(/\u2212/g, '-').replace(/[–—]/g, '-');
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function parseOptionQuantity(rawText: string): QuantityParseResult {
  const cleaned = rawText.replace(/\bM\b/gi, ' ').replace(/\u2212/g, '-').replace(/[–—]/g, '-');
  const joinedMinus = cleaned.replace(/-\s+(\d)/g, '-$1');
  const matches = [...joinedMinus.matchAll(/(?:^|[\s$%])(-?\d{1,3})(?=\s|$)/g)];
  const signed = matches.find(match => match[1].startsWith('-')) ?? matches[0];
  if (!signed) return { rawQuantity: null, contracts: null, side: 'unknown' };
  const rawQuantity = Number(signed[1]);
  if (!Number.isInteger(rawQuantity) || rawQuantity === 0) return { rawQuantity: null, contracts: null, side: 'unknown' };
  return {
    rawQuantity,
    contracts: Math.abs(rawQuantity),
    side: rawQuantity < 0 ? 'short' : 'long',
  };
}

export function parseBrokerageQuantityCell(rawText: string, cellWords: PortfolioImportOcrWord[] = []): QuantityParseResult {
  const wordText = cellWords
    .sort((a, b) => a.bbox.x0 - b.bbox.x0)
    .map(word => word.text)
    .join(' ');
  return parseOptionQuantity(`${rawText} ${wordText}`);
}

export function parseDate(value: string): string | null {
  const corrected = value
    .toUpperCase()
    .replace(/\bJUI\b/g, 'JUL')
    .replace(/\bJUNI\b/g, 'JUN')
    .replace(/\bJUl\b/g, 'JUL')
    .replace(/[|]/g, ' ');
  const match = corrected.match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[\s.-]*(\d{1,2})[\s,.-]*(20\s*\d\s*\d|20\d{2})\b/);
  if (!match) return null;
  const [, monthName, day, year] = match;
  const month = MONTHS[monthName];
  if (!month) return null;
  return `${year.replace(/\s+/g, '')}-${month}-${day.padStart(2, '0')}`;
}

export function parseOptionSymbolLine(value: string): { ticker: string; strike: number; optionType: 'put' } | null {
  const normalized = value
    .replace(/[^\w.\s-]/g, ' ')
    .replace(/\bP(?:u[tf]|uf|ul|vt)\b/gi, 'Put')
    .replace(/\s+/g, ' ')
    .trim();
  const match = normalized.match(/\b([A-Z][A-Z0-9]{1,7})\s+(\d+(?:\.\d+)?)\s+(?:P|PUT|PUTS)\b/i);
  if (!match) return null;
  const strike = Number(match[2]);
  if (!Number.isFinite(strike) || strike <= 0) return null;
  return { ticker: repairTicker(match[1].toUpperCase()), strike, optionType: 'put' };
}

export function makePortfolioContractKey({ ticker, optionType, expiration, strike }: { ticker: string; optionType: 'put'; expiration: string; strike: number }): string {
  return `${ticker.trim().toUpperCase()}|${optionType}|${expiration}|${Number(strike.toFixed(4)).toString()}`;
}

export function parseBrokerageScreenshotText(ocrText: string): ParsedBrokerageOptionRow[] {
  return parseBrokerageScreenshotOcr({ text: ocrText, words: [] }).rows;
}

export function runPortfolioScreenshotImportSelfCheck(): { ok: boolean; failures: string[] } {
  const expected = [
    ['LABU', 80, '2026-06-18', -3, 3, 2.69, -1050],
    ['LABU', 65, '2027-01-15', -4, 4, 7.20, -2000],
    ['SSO', 54.5, '2026-06-18', -3, 3, 4.49, -660],
    ['SOXL', 40, '2026-07-17', -15, 15, 0.88, -930],
    ['YINN', 30, '2027-01-15', -2, 2, 8.29, -1420],
    ['TQQQ', 25, '2026-06-18', -4, 4, 1.46, -40],
    ['TQQQ', 27.5, '2027-01-15', -5, 5, 3.50, -760],
    ['TQQQ', 45, '2026-07-17', -3, 3, 0.94, -150],
  ] as const;
  const fixture = `
LABU 80 Put
Jun-18-2026
3.50 +2.73 -819.00 -354.55% -242.02 -29.96% -1050.00 -0.21% -3 2.69 807.98
LABU 65 Put
Jan-15-2027
5.00 +1.30 -520.00 -35.14% +878.21 +30.51% -2000.00 -0.40% -4 7.20 2878.21
SSO 54.5 Put
Jun-18-2026
2.20 +1.66 -498.00 -307.41% +687.98 +51.03% -660.00 -0.13% -3 4.49 1347.98
SOXL 40 Put
Jul-17-2026
0.62 +0.17 -255.00 -37.78% +394.88 +29.80% -930.00 -0.19% -15 0.88 1324.88
YINN 30 Put
Jan-15-2027
7.10 +0.40 -80.00 -5.98% +238.59 +14.38% -1420.00 -0.29% -2 8.29 1658.59
TQQQ 25 Put
Jun-18-2026
0.10 +0.08 -32.00 -400.00% +545.31 +93.16% -40.00 -0.01% -4 1.46 585.31
TAQ 27.5 Put
Jan-15-2027
1.52 +0.03 -15.00 -2.02% +991.63 +56.61% -760.00 -0.15% -5 3.50 1751.63
TQQ0 45 Put
Jul-17-2026
0.50 0.00 0.00 0.00% +132.98 +46.99% -150.00 -0.03% -3 0.94 282.98
`;
  const rows = parseBrokerageScreenshotText(fixture);
  const failures: string[] = [];
  if (rows.length !== expected.length) failures.push(`Expected 8 rows, parsed ${rows.length}.`);
  expected.forEach(([ticker, strike, expiration, quantity, contracts, averageCostBasis, currentValue], index) => {
    const row = rows[index];
    if (!row) return;
    if (row.ticker !== ticker) failures.push(`Row ${index + 1} ticker expected ${ticker}, got ${row.ticker}.`);
    if (row.strike !== strike) failures.push(`Row ${index + 1} strike expected ${strike}, got ${row.strike}.`);
    if (row.expiration !== expiration) failures.push(`Row ${index + 1} expiration expected ${expiration}, got ${row.expiration}.`);
    if (row.quantity !== quantity) failures.push(`Row ${index + 1} quantity expected ${quantity}, got ${row.quantity}.`);
    if (row.contracts !== contracts) failures.push(`Row ${index + 1} contracts expected ${contracts}, got ${row.contracts}.`);
    if (!roughlyEqual(row.averageCostBasis ?? NaN, averageCostBasis, 0.02)) failures.push(`Row ${index + 1} avg cost expected ${averageCostBasis}, got ${row.averageCostBasis}.`);
    if (!roughlyEqual(row.currentValue ?? NaN, currentValue, 1)) failures.push(`Row ${index + 1} current value expected ${currentValue}, got ${row.currentValue}.`);
  });
  return { ok: failures.length === 0, failures };
}

export function parseBrokerageScreenshotOcr(input: { text: string; words?: PortfolioImportOcrWord[] }): PortfolioImportParseResult {
  const words = normalizeOcrWords(input.words ?? []);
  if (words.length > 0) {
    const tableResult = parseBrokerageScreenshotWords(words);
    if (tableResult.diagnostics.importableRowCount >= 8) return tableResult;
  }

  const lines = normalizeOcrText(input.text).split('\n');
  const textRows = dedupeParsedRows(getOptionRowBlocks(lines).map(parseRowBlock).filter(Boolean) as ParsedBrokerageOptionRow[]);
  const wordRows = words.length > 0 ? parseBrokerageScreenshotWords(words).rows : [];
  const rows = chooseBestRows(wordRows, textRows);
  return {
    rows,
    diagnostics: {
      ocrWordCount: words.length,
      ocrLineCount: lines.length,
      ocrWordSource: words.length > 0 ? 'word_geometry_plus_text_fallback' : 'text_fallback',
      detectedHeaderColumns: [],
      detectedOptionRowCount: Math.max(rows.length, wordRows.length),
      parsedRowCount: rows.length,
      importableRowCount: rows.filter(isImportableRow).length,
      warnings: words.length > 0 ? ['Structured OCR was incomplete; used Fidelity text fallback with accounting validation.'] : ['Structured OCR output unavailable; using text fallback.'],
      rowDiagnostics: rows.map(rowDiagnosticsFromParsedRow),
    },
  };
}

export function parsedBrokerageRowToPortfolioTrade(row: ImportEditableRow, importDate: string, nowIso = new Date().toISOString()): PortfolioTradeInput | null {
  if (!isImportableRow(row)) return null;
  const noteWarning = 'Imported from brokerage screenshot. Entry date missing - import date used as sold date.';
  return {
    ticker: row.ticker,
    optionType: 'put',
    strike: row.strike,
    expiration: row.expiration,
    contracts: row.contracts,
    soldPrice: row.averageCostBasis,
    soldDate: importDate,
    status: 'open',
    notes: noteWarning,
    latestMarketData: {
      optionLast: row.lastPrice,
      refreshedAt: nowIso,
      availabilityStatus: 'imported_snapshot',
    },
    importedSnapshot: {
      source: 'brokerage_screenshot',
      importedAt: nowIso,
      lastPrice: row.lastPrice,
      todayGainLossDollar: row.todayGainLossDollar,
      todayGainLossPercent: row.todayGainLossPercent,
      totalGainLossDollar: row.totalGainLossDollar,
      totalGainLossPercent: row.totalGainLossPercent,
      currentValue: row.currentValue,
      percentOfAccount: row.percentOfAccount,
      averageCostBasis: row.averageCostBasis,
      costBasisTotal: row.costBasisTotal,
    },
  };
}

export function buildPortfolioImportPlan(rows: ImportEditableRow[], existingTrades: PortfolioTrade[]): PortfolioImportPlan {
  const existingOpen = existingTrades.filter(trade => trade.status === 'open');
  const existingByKey = new Map(existingOpen.map(trade => [makePortfolioContractKey(trade), trade]));
  const importableRows = rows.filter(isImportableRow);
  const importedKeys = new Set<string>();
  const plan: PortfolioImportPlan = { adds: [], updates: [], keeps: [], skipped: [], missingFromImport: [], warnings: [] };
  const rowOccurrences = new Map<string, number>();
  const matchedExistingKeys = new Set<string>();

  if (rows.length === 0) return plan;

  rows.forEach(row => {
    const importable = isImportableRow(row);
    const baseKey = importable ? makePortfolioContractKey(row) : row.rawText;
    const occurrence = (rowOccurrences.get(baseKey) ?? 0) + 1;
    rowOccurrences.set(baseKey, occurrence);
    const key = occurrence === 1 ? baseKey : `${baseKey}#${occurrence}`;
    if (importable) importedKeys.add(baseKey);
    const existingTrade = importable && occurrence === 1 ? existingByKey.get(baseKey) : undefined;
    const differences = existingTrade && importable ? getImportDifferences(existingTrade, row) : [];
    const action: ParsedImportAction = {
      key,
      row,
      existingTrade,
      warnings: row.warnings,
      differences,
    };
    const requestedAction = row.importAction;
    if (!row.selected || requestedAction === 'skip' || !importable) {
      plan.skipped.push(action);
    } else if (existingTrade && requestedAction === 'keep') {
      plan.keeps.push(action);
    } else if (existingTrade && differences.length === 0 && requestedAction !== 'update') {
      plan.keeps.push(action);
    } else if (existingTrade && !matchedExistingKeys.has(baseKey)) {
      matchedExistingKeys.add(baseKey);
      plan.updates.push(action);
    } else if (!existingTrade) {
      plan.adds.push(action);
    } else {
      plan.keeps.push(action);
    }
  });

  if (importableRows.length === 0 && rows.length > 0) {
    plan.warnings.push('Import could not confidently parse positions. Existing positions were not compared.');
  } else {
    existingOpen.forEach(trade => {
      const key = makePortfolioContractKey(trade);
      if (importedKeys.has(key)) return;
      const expired = new Date(`${trade.expiration}T00:00:00Z`).getTime() < startOfTodayUtc();
      plan.missingFromImport.push({
        key,
        trade,
        suggestedStatus: expired ? 'expired' : undefined,
        action: 'keep',
      });
    });
  }

  if (plan.skipped.some(action => !isImportableRow(action.row))) {
    plan.warnings.push('Some parsed rows are missing required fields and will not be imported unless corrected.');
  }
  return plan;
}

export function applyPortfolioImportPlan(plan: PortfolioImportPlan, existingTrades: PortfolioTrade[], importDate: string, nowIso = new Date().toISOString()): PortfolioTrade[] {
  const byId = new Map(existingTrades.map(trade => [trade.id, trade]));
  const next = [...existingTrades];

  plan.adds.forEach(action => {
    if (!action.row.selected || action.row.importAction === 'skip') return;
    const rowImportDate = action.row.dateAcquired || importDate;
    const input = parsedBrokerageRowToPortfolioTrade(action.row, rowImportDate, nowIso);
    if (!input) return;
    next.push({
      ...input,
      id: makeGeneratedImportId(action.key, nowIso),
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  });

  plan.updates.forEach(action => {
    if (!action.row.selected || action.row.importAction === 'skip' || action.row.importAction === 'keep' || !action.existingTrade) return;
    const existing = byId.get(action.existingTrade.id);
    if (!existing) return;
    const rowImportDate = action.row.dateAcquiredEdited && action.row.dateAcquired ? action.row.dateAcquired : existing.soldDate;
    const input = parsedBrokerageRowToPortfolioTrade(action.row, rowImportDate, nowIso);
    if (!input) return;
    const updated: PortfolioTrade = {
      ...existing,
      contracts: input.contracts,
      soldPrice: input.soldPrice,
      soldDate: rowImportDate,
      notes: existing.notes ?? '',
      updatedAt: nowIso,
      latestMarketData: {
        ...existing.latestMarketData,
        ...input.latestMarketData,
      },
      importedSnapshot: input.importedSnapshot,
    };
    const index = next.findIndex(trade => trade.id === existing.id);
    if (index >= 0) next[index] = updated;
  });

  plan.missingFromImport.forEach(action => {
    if (action.action === 'keep') return;
    const index = next.findIndex(trade => trade.id === action.trade.id);
    if (index < 0) return;
    next[index] = {
      ...next[index],
      status: action.action,
      closePrice: action.action === 'expired' ? 0 : next[index].closePrice,
      closeDate: action.action === 'expired' ? importDate : next[index].closeDate,
      updatedAt: nowIso,
    };
  });

  return next;
}

export function getImportDifferences(existingTrade: PortfolioTrade, row: ImportEditableRow): ImportDifference[] {
  const differences: ImportDifference[] = [];
  addTextDifference(differences, 'Ticker', existingTrade.ticker, row.ticker);
  addTextDifference(differences, 'Expiry', existingTrade.expiration, row.expiration);
  addNumberDifference(differences, 'Strike', existingTrade.strike, row.strike, 0.0001, formatPlainNumber);
  addNumberDifference(differences, 'Quantity', -Math.abs(existingTrade.contracts), row.quantity, 0.01, formatPlainNumber);
  addNumberDifference(differences, 'Contracts', existingTrade.contracts, row.contracts, 0.01, formatPlainNumber);
  addNumberDifference(differences, 'Sold price', existingTrade.soldPrice, row.averageCostBasis, 0.005, formatOptionDiff);
  addNumberDifference(differences, 'Last', existingTrade.importedSnapshot?.lastPrice ?? existingTrade.latestMarketData?.optionLast, row.lastPrice, 0.005, formatOptionDiff);
  addNumberDifference(differences, 'Current value', existingTrade.importedSnapshot?.currentValue, row.currentValue, 1, formatMoneyDiff);
  addNumberDifference(differences, 'Cost basis', existingTrade.importedSnapshot?.costBasisTotal, row.costBasisTotal, 1, formatMoneyDiff);
  addNumberDifference(differences, 'Total G/L', existingTrade.importedSnapshot?.totalGainLossDollar, row.totalGainLossDollar, 1, formatMoneyDiff);
  return differences;
}

function addTextDifference(differences: ImportDifference[], field: string, existing: string | undefined, imported: string | undefined): void {
  const existingValue = (existing ?? '').trim().toUpperCase();
  const importedValue = (imported ?? '').trim().toUpperCase();
  if (!existingValue && !importedValue) return;
  if (existingValue === importedValue) return;
  differences.push({ field, existing: existingValue || '—', imported: importedValue || '—' });
}

function addNumberDifference(
  differences: ImportDifference[],
  field: string,
  existing: number | null | undefined,
  imported: number | null | undefined,
  tolerance: number,
  formatter: (value: number | null | undefined) => string
): void {
  const existingValid = Number.isFinite(existing);
  const importedValid = Number.isFinite(imported);
  if (!existingValid && !importedValid) return;
  if (existingValid && importedValid && Math.abs(Number(existing) - Number(imported)) <= tolerance) return;
  differences.push({ field, existing: formatter(existing), imported: formatter(imported) });
}

function formatPlainNumber(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '—';
  return Number(value).toLocaleString(undefined, { maximumFractionDigits: 4 });
}

function formatOptionDiff(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '—';
  return Number(value).toFixed(2);
}

function formatMoneyDiff(value: number | null | undefined): string {
  if (!Number.isFinite(value)) return '—';
  const abs = Math.abs(Number(value)).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  return `${Number(value) < 0 ? '-' : ''}$${abs}`;
}

export function isImportableRow(row: ImportEditableRow | ParsedBrokerageOptionRow): row is ImportEditableRow & { quantity: number; contracts: number; averageCostBasis: number } {
  return !!row.ticker &&
    row.optionType === 'put' &&
    Number.isFinite(row.strike) &&
    row.strike > 0 &&
    /^\d{4}-\d{2}-\d{2}$/.test(row.expiration) &&
    Number.isFinite(row.quantity) &&
    Number.isFinite(row.contracts) &&
    (row.contracts ?? 0) > 0 &&
    Number.isFinite(row.averageCostBasis) &&
    (row.averageCostBasis ?? -1) >= 0;
}

export function validateParsedBrokerageRow(row: ParsedBrokerageOptionRow): ParsedBrokerageOptionRow {
  const warnings: string[] = row.warnings.filter(warning => warning === ENTRY_DATE_WARNING);
  let confidence = row.confidence ?? 0.7;

  if (!row.expiration) {
    warnings.push('Expiration could not be read.');
    confidence -= 0.2;
  }
  if (!Number.isFinite(row.quantity) || !Number.isFinite(row.contracts) || (row.contracts ?? 0) <= 0) {
    warnings.push('Quantity could not be read.');
    confidence -= 0.2;
  }
  if (!Number.isFinite(row.averageCostBasis)) {
    warnings.push('Average cost basis could not be read; sold price is required.');
    confidence -= 0.2;
  }

  const contracts = row.contracts ?? null;
  if (contracts != null && row.averageCostBasis != null && row.costBasisTotal != null) {
    const expected = row.averageCostBasis * 100 * contracts;
    if (!roughlyEqual(Math.abs(row.costBasisTotal), expected, Math.max(5, expected * 0.03))) {
      warnings.push('Cost basis total does not match average cost x contracts x 100.');
      confidence -= 0.12;
    }
  }
  if (contracts != null && row.lastPrice != null && row.currentValue != null && row.side === 'short') {
    const expected = -row.lastPrice * 100 * contracts;
    if (!roughlyEqual(row.currentValue, expected, Math.max(5, Math.abs(expected) * 0.03))) {
      warnings.push('Current value does not match last price x contracts x 100.');
      confidence -= 0.12;
    }
  }
  if (row.costBasisTotal != null && row.currentValue != null && row.totalGainLossDollar != null) {
    const expected = row.costBasisTotal + row.currentValue;
    if (!roughlyEqual(row.totalGainLossDollar, expected, Math.max(5, Math.abs(expected) * 0.05))) {
      warnings.push('Total gain/loss does not match cost basis plus current value.');
      confidence -= 0.08;
    }
  }
  if (contracts != null && row.lastPriceChange != null && row.todayGainLossDollar != null && row.side === 'short') {
    const expected = -row.lastPriceChange * 100 * contracts;
    if (!roughlyEqual(row.todayGainLossDollar, expected, Math.max(5, Math.abs(expected) * 0.06))) {
      warnings.push('Today gain/loss does not match last price change x contracts x 100.');
      confidence -= 0.06;
    }
  }

  return {
    ...row,
    confidence: Math.max(0.1, Math.min(1, confidence)),
    warnings: dedupeStrings([...warnings, ENTRY_DATE_WARNING]),
  };
}

function parseBrokerageScreenshotWords(words: PortfolioImportOcrWord[]): PortfolioImportParseResult {
  const lines = groupWordsIntoLines(words);
  const detectedHeaderColumns = detectHeaderColumns(lines);
  const blocks = getTableRowBlocks(lines);
  const rows = dedupeParsedRows(blocks.map(parseTableRowBlock).filter(Boolean) as ParsedBrokerageOptionRow[]);
  const diagnosticsWarnings: string[] = [];
  const importableRowCount = rows.filter(isImportableRow).length;
  if (blocks.length > importableRowCount) {
    diagnosticsWarnings.push('Some option rows were detected but could not be fully parsed. Review before importing.');
  }

  return {
    rows,
    diagnostics: {
      ocrWordCount: words.length,
      ocrLineCount: lines.length,
      ocrWordSource: 'word_geometry',
      detectedHeaderColumns,
      detectedOptionRowCount: blocks.length,
      parsedRowCount: rows.length,
      importableRowCount,
      warnings: diagnosticsWarnings,
      rowDiagnostics: rows.map(rowDiagnosticsFromParsedRow),
    },
  };
}

function normalizeOcrWords(words: PortfolioImportOcrWord[]): PortfolioImportOcrWord[] {
  return words
    .filter(word => word.text.trim() && Number.isFinite(word.bbox.x0) && Number.isFinite(word.bbox.y0) && Number.isFinite(word.bbox.x1) && Number.isFinite(word.bbox.y1))
    .map(word => ({ ...word, text: normalizeOcrWordText(word.text) }))
    .filter(word => word.text);
}

function normalizeOcrWordText(value: string): string {
  return value
    .replace(/\u2212/g, '-')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[’]/g, "'")
    .replace(/\bP(?:u[tf]|uf|ul|vt)\b/gi, 'Put')
    .trim();
}

function groupWordsIntoLines(words: PortfolioImportOcrWord[]): OcrLine[] {
  const sorted = [...words].sort((a, b) => centerY(a.bbox) - centerY(b.bbox) || a.bbox.x0 - b.bbox.x0);
  const heights = sorted.map(word => word.bbox.y1 - word.bbox.y0).filter(height => height > 0).sort((a, b) => a - b);
  const medianHeight = heights[Math.floor(heights.length / 2)] ?? 12;
  const threshold = Math.max(6, medianHeight * 0.65);
  const groups: PortfolioImportOcrWord[][] = [];

  sorted.forEach(word => {
    const y = centerY(word.bbox);
    const group = groups.find(candidate => Math.abs(y - average(candidate.map(item => centerY(item.bbox)))) <= threshold);
    if (group) group.push(word);
    else groups.push([word]);
  });

  return groups
    .map(group => {
      const lineWords = [...group].sort((a, b) => a.bbox.x0 - b.bbox.x0);
      return {
        words: lineWords,
        text: lineWords.map(word => word.text).join(' '),
        confidence: average(lineWords.map(word => word.confidence)),
        bbox: unionBox(lineWords.map(word => word.bbox)),
      };
    })
    .sort((a, b) => a.bbox.y0 - b.bbox.y0);
}

function detectHeaderColumns(lines: OcrLine[]): string[] {
  const headerText = lines.slice(0, 12).map(line => line.text.toLowerCase()).join(' ');
  const candidates = [
    ['Symbol', /\bsymbol\b/],
    ['Last price', /\blast\s+price\b/],
    ['Last price change', /\blast\s+price\s+change\b/],
    ["Today's gain/loss $", /today.?s\s+gain\/loss/],
    ['Total gain/loss $', /total\s+gain\/loss/],
    ['Current value', /current\s+value/],
    ['% of account', /%\s+of\s+account/],
    ['Quantity', /\bquantity\b/],
    ['Average cost basis', /average\s+cost\s+basis/],
    ['Cost basis total', /cost\s+basis\s+total/],
  ] as const;
  return candidates.filter(([, pattern]) => pattern.test(headerText)).map(([label]) => label);
}

function getTableRowBlocks(lines: OcrLine[]): TableRowBlock[] {
  const symbolLines = lines.filter(line => parseOptionSymbolLine(line.text));
  return symbolLines.map((symbolLine, index) => {
    const nextSymbolLine = symbolLines[index + 1] ?? null;
    const nextSymbolY = nextSymbolLine?.bbox.y0 ?? null;
    const y0 = symbolLine.bbox.y0 - lineHeight(symbolLine) * 0.4;
    const y1 = nextSymbolY ?? symbolLine.bbox.y1 + lineHeight(symbolLine) * 3.4;
    const symbolRight = getSymbolColumnRight(symbolLine);
    const candidateLines = lines.filter(line => line.bbox.y0 >= y0 && line.bbox.y0 < y1);
    const expirationLine = candidateLines.find(line => line.bbox.x0 <= symbolRight && parseDate(line.text)) ??
      lines.find(line => line.bbox.y0 > symbolLine.bbox.y0 && line.bbox.y0 < symbolLine.bbox.y1 + lineHeight(symbolLine) * 3 && line.bbox.x0 <= symbolRight && parseDate(line.text)) ??
      null;
    const words = lines
      .filter(line => line.bbox.y0 >= y0 && line.bbox.y0 < y1)
      .flatMap(line => line.words);
    return { symbolLine, expirationLine, words, nextSymbolY };
  });
}

function parseTableRowBlock(block: TableRowBlock): ParsedBrokerageOptionRow | null {
  const symbol = parseOptionSymbolLine(block.symbolLine.text);
  if (!symbol) return null;

  const symbolRight = getSymbolColumnRight(block.symbolLine);
  const expiration = block.expirationLine ? parseDate(block.expirationLine.text) : recoverExpirationFromWords(block.words, symbolRight, block.symbolLine.bbox.y0);
  const numericWords = block.words.filter(word => word.bbox.x0 > symbolRight);
  const tokens = extractColumnTokens(numericWords);
  const cells = mapFidelityTokens(tokens);
  const quantity = cells.quantity ?? null;
  const contracts = quantity != null ? Math.abs(quantity) : null;
  const side: OptionSide = quantity == null ? inferSideFromCells(cells) : quantity < 0 ? 'short' : 'long';
  const costBasisTotal = cells.costBasisTotal != null ? Math.abs(cells.costBasisTotal) : undefined;
  const calculatedAverageCost = contracts != null && costBasisTotal != null && contracts > 0 ? roundMoney(costBasisTotal / contracts / 100) : undefined;
  let averageCostBasis = cells.averageCostBasis ?? calculatedAverageCost;
  const warnings: string[] = [];

  if (!expiration) warnings.push('Expiration could not be read.');
  if (quantity == null) warnings.push('Quantity could not be read.');
  if (averageCostBasis == null) warnings.push('Average cost basis could not be read; sold price is required.');
  if (cells.averageCostBasis != null && calculatedAverageCost != null && !roughlyEqual(cells.averageCostBasis, calculatedAverageCost, Math.max(0.03, calculatedAverageCost * 0.05))) {
    averageCostBasis = calculatedAverageCost;
    warnings.push('Average cost recalculated from cost basis total and quantity.');
  }

  const currentValue = cells.currentValue ?? calculateCurrentValue(cells.lastPrice, contracts, side);
  if (currentValue == null) warnings.push('Current value could not be confidently read.');

  const baseConfidence = average(block.words.map(word => word.confidence)) / 100;
  return validateParsedBrokerageRow({
    rawText: block.words.sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0).map(word => word.text).join(' '),
    ticker: symbol.ticker,
    optionType: 'put',
    strike: symbol.strike,
    expiration: expiration ?? '',
    quantity,
    side,
    contracts,
    lastPrice: cells.lastPrice,
    lastPriceChange: cells.lastPriceChange,
    todayGainLossDollar: cells.todayGainLossDollar,
    todayGainLossPercent: cells.todayGainLossPercent,
    totalGainLossDollar: cells.totalGainLossDollar,
    totalGainLossPercent: cells.totalGainLossPercent,
    currentValue,
    percentOfAccount: cells.percentOfAccount,
    averageCostBasis,
    costBasisTotal,
    confidence: Math.max(0.25, Math.min(1, Math.max(baseConfidence, 0.55) + cells.score / 250)),
    warnings: [...warnings, ENTRY_DATE_WARNING],
  });
}

function recoverExpirationFromWords(words: PortfolioImportOcrWord[], symbolRight: number, symbolY: number): string | null {
  const symbolColumnText = words
    .filter(word => word.bbox.x0 <= symbolRight && word.bbox.y0 >= symbolY)
    .sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0)
    .map(word => word.text)
    .join(' ');
  return parseDate(symbolColumnText);
}

function getSymbolColumnRight(line: OcrLine): number {
  const words = [...line.words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  for (let index = 0; index <= words.length - 3; index += 1) {
    const maybeSymbol = `${words[index].text} ${words[index + 1].text} ${words[index + 2].text}`;
    if (parseOptionSymbolLine(maybeSymbol)) return words[index + 2].bbox.x1 + 70;
  }
  return line.bbox.x0 + 240;
}

function extractColumnTokens(words: PortfolioImportOcrWord[]): ColumnToken[] {
  const sorted = [...words].sort((a, b) => a.bbox.x0 - b.bbox.x0);
  const tokens: ColumnToken[] = [];
  let pendingSign = '';
  let pendingCurrency = false;

  sorted.forEach(word => {
    const text = word.text.replace(/,/g, '');
    if (/^[+$-]$/.test(text)) {
      pendingSign = text === '+' ? '' : text;
      return;
    }
    if (text === '$') {
      pendingCurrency = true;
      return;
    }
    const matches = [...text.matchAll(/[+$-]?\$?\d+(?:\.\d+)?%?/g)];
    matches.forEach(match => {
      let raw = match[0];
      if (pendingSign && !/^[+-]/.test(raw)) raw = `${pendingSign}${raw}`;
      if (pendingCurrency && !raw.includes('$')) raw = `$${raw}`;
      pendingSign = '';
      pendingCurrency = false;
      const value = Number(raw.replace(/[$,%+]/g, ''));
      if (!Number.isFinite(value)) return;
      tokens.push({
        raw,
        value,
        isPercent: raw.includes('%'),
        x: centerX(word.bbox),
        confidence: word.confidence,
      });
    });
  });

  return tokens.sort((a, b) => a.x - b.x);
}

function mapFidelityTokens(tokens: ColumnToken[]): FidelityCells {
  const nonPercent = tokens.filter(token => !token.isPercent);
  const percent = tokens.filter(token => token.isPercent);
  const quantityIndex = findQuantityColumnIndex(nonPercent);
  const quantity = quantityIndex >= 0 ? nonPercent[quantityIndex].value : undefined;
  const afterQuantity = quantityIndex >= 0 ? nonPercent.slice(quantityIndex + 1) : [];
  const beforeQuantity = quantityIndex >= 0 ? nonPercent.slice(0, quantityIndex) : nonPercent;
  const lastPrice = beforeQuantity[0]?.value;
  const lastPriceChange = beforeQuantity[1]?.value;
  const currentValue = findCurrentValueToken(beforeQuantity, lastPrice, quantity)?.value;
  const costBasisTotal = findBestCostBasisTotal(afterQuantity, quantity);
  const directAverageCost = findBestAverageCost(afterQuantity, quantity, costBasisTotal);
  const averageCostBasis = quantity != null && costBasisTotal != null
    ? reconcileAverageCost(directAverageCost, costBasisTotal, Math.abs(quantity))
    : directAverageCost;
  const totalGainLossDollar = findTotalGainLossToken(beforeQuantity, currentValue, costBasisTotal)?.value ?? beforeQuantity[3]?.value;
  const todayGainLossDollar = beforeQuantity[2]?.value;
  const validationScore = scoreFidelityCells({
    lastPrice,
    lastPriceChange,
    todayGainLossDollar,
    todayGainLossPercent: percent[0]?.value / 100,
    totalGainLossDollar,
    totalGainLossPercent: percent[1]?.value / 100,
    currentValue,
    percentOfAccount: percent[2]?.value / 100,
    quantity,
    averageCostBasis,
    costBasisTotal,
    score: 0,
  });

  return {
    lastPrice,
    lastPriceChange,
    todayGainLossDollar,
    todayGainLossPercent: percent[0]?.value / 100,
    totalGainLossDollar,
    totalGainLossPercent: percent[1]?.value / 100,
    currentValue,
    percentOfAccount: percent[2]?.value / 100,
    quantity,
    averageCostBasis,
    costBasisTotal,
    score: validationScore,
  };
}

function findQuantityColumnIndex(nonPercent: ColumnToken[]): number {
  const candidates = nonPercent
    .map((token, index) => ({ token, index }))
    .filter(({ token, index }) => index >= Math.max(0, nonPercent.length - 5) && Number.isInteger(token.value) && token.value !== 0 && Math.abs(token.value) <= 100);
  const scored = candidates.map(candidate => {
    const after = nonPercent.slice(candidate.index + 1);
    const avg = after.find(token => token.value >= 0 && token.value <= 100)?.value;
    const expected = avg != null ? Math.abs(candidate.token.value) * avg * 100 : null;
    const costMatch = expected != null && after.some(token => roughlyEqual(Math.abs(token.value), expected, Math.max(8, expected * 0.08)));
    return {
      ...candidate,
      score: (candidate.token.value < 0 ? 50 : 0) + (costMatch ? 100 : 0) + (Math.abs(candidate.token.value) <= 30 ? 10 : 0),
    };
  }).sort((a, b) => b.score - a.score);
  return scored[0]?.index ?? -1;
}

function findCurrentValueToken(beforeQuantity: ColumnToken[], lastPrice?: number, quantity?: number): ColumnToken | undefined {
  const contracts = quantity == null ? null : Math.abs(quantity);
  const expected = lastPrice != null && contracts != null ? -lastPrice * contracts * 100 : null;
  if (expected != null) {
    const match = beforeQuantity.find(token => roughlyEqual(token.value, expected, Math.max(5, Math.abs(expected) * 0.04)));
    if (match) return match;
  }
  const negative = [...beforeQuantity].reverse().find(token => token.value < 0 && Math.abs(token.value) >= 10);
  if (negative) return negative;
  return [...beforeQuantity].reverse().find(token => Math.abs(token.value) >= 10);
}

function findBestCostBasisTotal(afterQuantity: ColumnToken[], quantity?: number): number | undefined {
  if (quantity == null) return afterQuantity.find(token => Math.abs(token.value) > 100)?.value;
  const contracts = Math.abs(quantity);
  const avgCandidates = afterQuantity.filter(token => token.value >= 0 && token.value <= 100);
  for (const avg of avgCandidates) {
    const expected = avg.value * contracts * 100;
    const match = afterQuantity.find(token => roughlyEqual(Math.abs(token.value), expected, Math.max(8, expected * 0.06)));
    if (match) return roundMoney(Math.abs(match.value));
  }
  const fallback = afterQuantity.find(token => Math.abs(token.value) > 100)?.value;
  return fallback == null ? undefined : roundMoney(Math.abs(fallback));
}

function findBestAverageCost(afterQuantity: ColumnToken[], quantity?: number, costBasisTotal?: number): number | undefined {
  const direct = afterQuantity.find(token => token.value >= 0 && token.value <= 100)?.value;
  if (quantity != null && costBasisTotal != null) return reconcileAverageCost(direct, costBasisTotal, Math.abs(quantity));
  return direct == null ? undefined : roundMoney(direct);
}

function reconcileAverageCost(direct: number | undefined, costBasisTotal: number, contracts: number): number {
  const derived = roundMoney(costBasisTotal / contracts / 100);
  if (direct == null) return derived;
  return roughlyEqual(direct, derived, Math.max(0.03, derived * 0.05)) ? roundMoney(direct) : derived;
}

function findTotalGainLossToken(beforeQuantity: ColumnToken[], currentValue?: number, costBasisTotal?: number): ColumnToken | undefined {
  const expected = currentValue != null && costBasisTotal != null ? costBasisTotal + currentValue : null;
  if (expected != null) {
    const match = beforeQuantity.find(token => roughlyEqual(token.value, expected, Math.max(5, Math.abs(expected) * 0.05)));
    if (match) return match;
  }
  return beforeQuantity.filter(token => token.value !== currentValue).find((_, index, values) => index === values.length - 2);
}

function scoreFidelityCells(cells: FidelityCells): number {
  let score = 0;
  const contracts = cells.quantity == null ? null : Math.abs(cells.quantity);
  if (contracts != null && contracts > 0) score += 20;
  if (cells.quantity != null && cells.quantity < 0) score += 10;
  if (contracts != null && cells.averageCostBasis != null && cells.costBasisTotal != null) {
    const expected = cells.averageCostBasis * contracts * 100;
    if (roughlyEqual(Math.abs(cells.costBasisTotal), expected, Math.max(5, expected * 0.03))) score += 30;
  }
  if (contracts != null && cells.lastPrice != null && cells.currentValue != null) {
    const expected = -cells.lastPrice * contracts * 100;
    if (roughlyEqual(cells.currentValue, expected, Math.max(5, Math.abs(expected) * 0.03))) score += 30;
  }
  if (cells.costBasisTotal != null && cells.currentValue != null && cells.totalGainLossDollar != null) {
    const expected = cells.costBasisTotal + cells.currentValue;
    if (roughlyEqual(cells.totalGainLossDollar, expected, Math.max(5, Math.abs(expected) * 0.05))) score += 20;
  }
  return score;
}

function inferSideFromCells(cells: { currentValue?: number; quantity?: number }): OptionSide {
  if (cells.quantity != null) return cells.quantity < 0 ? 'short' : 'long';
  return cells.currentValue != null && cells.currentValue < 0 ? 'short' : 'unknown';
}

function calculateCurrentValue(lastPrice: number | undefined, contracts: number | null, side: OptionSide): number | undefined {
  if (lastPrice == null || contracts == null) return undefined;
  const value = roundMoney(lastPrice * contracts * 100);
  return side === 'short' ? -value : value;
}

function getOptionRowBlocks(lines: string[]): RowBlock[] {
  const symbolIndexes = lines.map((line, index) => parseOptionSymbolLine(line) ? index : -1).filter(index => index >= 0);
  return symbolIndexes.map((symbolIndex, position) => {
    const nextSymbolIndex = symbolIndexes[position + 1] ?? lines.length;
    const blockLines = lines.slice(symbolIndex, Math.min(nextSymbolIndex, symbolIndex + 18));
    const expirationLine = blockLines.find(line => parseDate(line));
    return {
      symbolLine: lines[symbolIndex],
      expiration: expirationLine ? parseDate(expirationLine) : null,
      lines: blockLines,
    };
  });
}

function parseRowBlock(block: RowBlock): ParsedBrokerageOptionRow | null {
  const symbol = parseOptionSymbolLine(block.symbolLine);
  if (!symbol) return null;

  const warnings: string[] = [];
  if (!block.expiration) warnings.push('Expiration could not be read.');

  const numericLines = block.lines.filter(line => !parseOptionSymbolLine(line) && !parseDate(line));
  const tokens = extractNumericTokens(numericLines);
  const quantityInfo = findQuantity(tokens, numericLines);
  const quantity = quantityInfo.rawQuantity;
  const contracts = quantityInfo.contracts;
  const side = inferSide(quantityInfo.side, tokens);
  if (quantity == null) warnings.push('Quantity could not be read.');

  const lastPrice = findLastPrice(tokens, symbol.strike);
  const costBasisTotal = findCostBasisTotal(tokens, quantityInfo.tokenIndex, contracts);
  const directAverageCost = findAverageCost(tokens, quantityInfo.tokenIndex, contracts);
  const calculatedAverageCost = contracts != null && costBasisTotal != null && contracts > 0
    ? roundMoney(Math.abs(costBasisTotal) / contracts / 100)
    : undefined;
  let averageCostBasis = directAverageCost ?? calculatedAverageCost;
  if (calculatedAverageCost != null && directAverageCost != null && Math.abs(calculatedAverageCost - directAverageCost) > Math.max(0.05, calculatedAverageCost * 0.08)) {
    averageCostBasis = calculatedAverageCost;
    warnings.push('Average cost recalculated from cost basis total and quantity.');
  } else if (directAverageCost == null && calculatedAverageCost != null) {
    averageCostBasis = calculatedAverageCost;
    warnings.push('Average cost calculated from cost basis total and quantity.');
  }
  if (averageCostBasis == null) warnings.push('Average cost basis could not be read; sold price is required.');

  const currentValue = findCurrentValue(tokens, quantityInfo.tokenIndex, contracts, lastPrice, side, costBasisTotal);
  if (currentValue == null) warnings.push('Current value could not be confidently read.');

  const gainLoss = findGainLossFields(tokens, quantityInfo.tokenIndex, currentValue, costBasisTotal);
  const warningCount = warnings.length;

  return {
    rawText: block.lines.join('\n'),
    ticker: symbol.ticker,
    optionType: 'put',
    strike: symbol.strike,
    expiration: block.expiration ?? '',
    quantity,
    side,
    contracts,
    lastPrice,
    lastPriceChange: gainLoss.lastPriceChange,
    todayGainLossDollar: gainLoss.todayGainLossDollar,
    todayGainLossPercent: gainLoss.todayGainLossPercent,
    totalGainLossDollar: gainLoss.totalGainLossDollar,
    totalGainLossPercent: gainLoss.totalGainLossPercent,
    currentValue,
    percentOfAccount: gainLoss.percentOfAccount,
    averageCostBasis,
    costBasisTotal,
    confidence: Math.max(0.25, 1 - warningCount * 0.16),
    warnings: [...warnings, ENTRY_DATE_WARNING],
  };
}

function extractNumericTokens(lines: string[]): NumericToken[] {
  const tokens: NumericToken[] = [];
  lines.forEach((line, lineIndex) => {
    const normalized = line
      .replace(/\bM\b/gi, ' ')
      .replace(/\u2212/g, '-')
      .replace(/[–—]/g, '-')
      .replace(/\(([^)]+)\)/g, '-$1');
    const matches = [...normalized.matchAll(/-?\$?\d+(?:,\d{3})*(?:\.\d+)?%?/g)];
    matches.forEach((match, tokenIndex) => {
      const raw = match[0];
      const value = Number(raw.replace(/[$,%]/g, '').replace(/,/g, ''));
      if (!Number.isFinite(value)) return;
      tokens.push({ raw, value, isPercent: raw.includes('%'), lineIndex, tokenIndex });
    });
  });
  return tokens;
}

function findQuantity(tokens: NumericToken[], lines: string[]): QuantityParseResult {
  const tailStart = Math.max(0, tokens.length - 8);
  const candidates = tokens
    .map((token, index) => ({ token, index }))
    .filter(({ token, index }) => index >= tailStart && !token.isPercent && Number.isInteger(token.value) && token.value !== 0 && Math.abs(token.value) <= 50)
    .map(candidate => ({ ...candidate, score: quantityCandidateScore(tokens, candidate.index) }))
    .sort((a, b) => b.score - a.score);

  const tailInteger = candidates.find(({ token }) => token.value < 0 && Math.abs(token.value) <= 30 && token.value !== -100) ??
    candidates.find(({ token }) => token.value < 0) ??
    candidates[0];

  if (tailInteger) {
    return {
      rawQuantity: tailInteger.token.value,
      contracts: Math.abs(tailInteger.token.value),
      side: tailInteger.token.value < 0 ? 'short' : 'long',
      tokenIndex: tailInteger.index,
    };
  }

  const parsed = parseOptionQuantity(lines.join(' '));
  return parsed;
}

function quantityCandidateScore(tokens: NumericToken[], index: number): number {
  const quantity = Math.abs(tokens[index].value);
  const after = tokens.slice(index + 1).filter(token => !token.isPercent);
  const avg = after.find(token => token.value >= 0 && token.value <= 100)?.value;
  const expected = avg != null ? avg * quantity * 100 : null;
  const hasCostMatch = expected != null && after.some(token => Math.abs(Math.abs(token.value) - expected) <= Math.max(10, expected * 0.1));
  const previous = tokens[index - 1];
  let score = 0;
  if (tokens[index].value < 0) score += 20;
  if (quantity <= 20) score += 10;
  if (hasCostMatch) score += 100;
  if (previous?.isPercent) score += 8;
  if (avg != null) score += 5;
  return score;
}

function inferSide(side: OptionSide, tokens: NumericToken[]): OptionSide {
  if (side !== 'unknown') return side;
  return tokens.some(token => token.value < 0 && Math.abs(token.value) >= 10) ? 'short' : 'unknown';
}

function findLastPrice(tokens: NumericToken[], strike: number): number | undefined {
  return tokens.find(token => !token.isPercent && token.value > 0 && token.value < Math.min(strike, 100))?.value;
}

function findAverageCost(tokens: NumericToken[], quantityTokenIndex: number | undefined, contracts: number | null): number | undefined {
  if (quantityTokenIndex == null) return undefined;
  const afterQuantity = tokens.slice(quantityTokenIndex + 1).filter(token => !token.isPercent && token.value >= 0 && token.value <= 100);
  if (afterQuantity.length > 0) return roundMoney(afterQuantity[0].value);
  if (contracts == null) return undefined;
  const candidates = tokens.filter(token => !token.isPercent && token.value >= 0 && token.value <= 100);
  return candidates[candidates.length - 1]?.value;
}

function findCostBasisTotal(tokens: NumericToken[], quantityTokenIndex: number | undefined, contracts: number | null): number | undefined {
  if (contracts == null) return undefined;
  const afterQuantity = quantityTokenIndex == null ? [] : tokens.slice(quantityTokenIndex + 1).filter(token => !token.isPercent);
  const avg = afterQuantity.find(token => token.value >= 0 && token.value <= 100)?.value;
  if (avg != null) {
    const expected = avg * contracts * 100;
    const matching = afterQuantity.find(token => Math.abs(Math.abs(token.value) - expected) <= Math.max(10, expected * 0.1));
    if (matching) return roundMoney(Math.abs(matching.value));
  }
  const plausibleTotals = tokens.filter(token => !token.isPercent && Math.abs(token.value) >= contracts * 20 && Math.abs(token.value) <= contracts * 10000);
  return plausibleTotals[plausibleTotals.length - 1] ? roundMoney(Math.abs(plausibleTotals[plausibleTotals.length - 1].value)) : undefined;
}

function findCurrentValue(
  tokens: NumericToken[],
  quantityTokenIndex: number | undefined,
  contracts: number | null,
  lastPrice: number | undefined,
  side: OptionSide,
  costBasisTotal: number | undefined
): number | undefined {
  if (contracts == null) return undefined;
  const beforeQuantity = quantityTokenIndex == null ? tokens : tokens.slice(0, quantityTokenIndex);
  const largeDollarValues = beforeQuantity
    .filter(token => !token.isPercent && Math.abs(token.value) >= Math.max(10, contracts * 5) && Math.abs(token.value) <= contracts * 100000)
    .filter(token => costBasisTotal == null || Math.abs(Math.abs(token.value) - costBasisTotal) > Math.max(10, costBasisTotal * 0.08));

  const negativeCurrent = [...largeDollarValues].reverse().find(token => token.value < 0)?.value;
  if (negativeCurrent != null) return roundMoney(negativeCurrent);

  const lastLarge = largeDollarValues[largeDollarValues.length - 1]?.value;
  if (lastLarge != null) return roundMoney(side === 'short' ? -Math.abs(lastLarge) : lastLarge);

  if (lastPrice != null) {
    const value = lastPrice * contracts * 100;
    return roundMoney(side === 'short' ? -value : value);
  }
  return undefined;
}

function findGainLossFields(tokens: NumericToken[], quantityTokenIndex: number | undefined, currentValue: number | undefined, costBasisTotal: number | undefined) {
  const beforeQuantity = quantityTokenIndex == null ? tokens : tokens.slice(0, quantityTokenIndex);
  const percentTokens = beforeQuantity.filter(token => token.isPercent);
  const dollarTokens = beforeQuantity
    .filter(token => !token.isPercent)
    .filter(token => currentValue == null || Math.abs(token.value - currentValue) > 0.01)
    .filter(token => costBasisTotal == null || Math.abs(Math.abs(token.value) - costBasisTotal) > Math.max(10, costBasisTotal * 0.08));

  return {
    lastPriceChange: dollarTokens.length >= 2 ? dollarTokens[1].value : undefined,
    todayGainLossDollar: dollarTokens.length >= 3 ? dollarTokens[2].value : undefined,
    todayGainLossPercent: percentTokens[0]?.value / 100,
    totalGainLossDollar: dollarTokens.length >= 4 ? dollarTokens[dollarTokens.length - 1].value : undefined,
    totalGainLossPercent: percentTokens.length >= 2 ? percentTokens[percentTokens.length - 1].value / 100 : undefined,
    percentOfAccount: percentTokens.length >= 3 ? percentTokens[percentTokens.length - 1].value / 100 : undefined,
  };
}

function dedupeParsedRows(rows: ParsedBrokerageOptionRow[]): ParsedBrokerageOptionRow[] {
  const byKey = new Map<string, ParsedBrokerageOptionRow>();
  rows.forEach(row => {
    const key = [
      row.expiration ? makePortfolioContractKey(row) : row.rawText,
      row.quantity ?? 'noqty',
      row.averageCostBasis ?? 'noavg',
      row.costBasisTotal ?? 'nocost',
      row.currentValue ?? 'novalue',
    ].join('|');
    const existing = byKey.get(key);
    if (!existing || (row.confidence ?? 0) > (existing.confidence ?? 0)) byKey.set(key, row);
  });
  return [...byKey.values()];
}

function chooseBestRows(wordRows: ParsedBrokerageOptionRow[], textRows: ParsedBrokerageOptionRow[]): ParsedBrokerageOptionRow[] {
  if (wordRows.length === 0) return textRows;
  if (textRows.length === 0) return wordRows;
  const wordImportable = wordRows.filter(isImportableRow).length;
  const textImportable = textRows.filter(isImportableRow).length;
  if (textRows.length > wordRows.length && textImportable >= wordImportable) return textRows;
  if (textImportable > wordImportable) return textRows;
  return wordRows;
}

function repairTicker(rawTicker: string): string {
  const cleaned = rawTicker.toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/0/g, 'O');
  if (KNOWN_IMPORT_TICKERS.includes(cleaned)) return cleaned;
  if (EXPLICIT_TICKER_REPAIRS[cleaned]) return EXPLICIT_TICKER_REPAIRS[cleaned];
  const scored = KNOWN_IMPORT_TICKERS
    .map(ticker => ({ ticker, distance: editDistance(cleaned, ticker) }))
    .filter(item => item.distance <= 1 && Math.abs(item.ticker.length - cleaned.length) <= 1)
    .sort((a, b) => a.distance - b.distance || a.ticker.length - b.ticker.length);
  return scored[0]?.ticker ?? cleaned;
}

function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, () => Array<number>(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return dp[a.length][b.length];
}

function rowDiagnosticsFromParsedRow(row: ParsedBrokerageOptionRow): NonNullable<PortfolioImportDiagnostics['rowDiagnostics']>[number] {
  return {
    rawSymbolText: `${row.ticker} ${row.strike} Put`,
    rawExpiryText: row.expiration,
    rawCells: {
      lastPrice: valueText(row.lastPrice),
      lastPriceChange: valueText(row.lastPriceChange),
      todayGainLossDollar: valueText(row.todayGainLossDollar),
      todayGainLossPercent: valueText(row.todayGainLossPercent),
      totalGainLossDollar: valueText(row.totalGainLossDollar),
      totalGainLossPercent: valueText(row.totalGainLossPercent),
      currentValue: valueText(row.currentValue),
      percentOfAccount: valueText(row.percentOfAccount),
      quantity: valueText(row.quantity),
      averageCostBasis: valueText(row.averageCostBasis),
      costBasisTotal: valueText(row.costBasisTotal),
    },
    parsedValues: {
      ticker: row.ticker,
      strike: valueText(row.strike),
      expiration: row.expiration,
      quantity: valueText(row.quantity),
      contracts: valueText(row.contracts),
      averageCostBasis: valueText(row.averageCostBasis),
      currentValue: valueText(row.currentValue),
    },
    validation: buildValidationDiagnostics(row),
    validationScore: row.confidence ?? 0,
    warnings: row.warnings,
  };
}

function buildValidationDiagnostics(row: ParsedBrokerageOptionRow): Record<string, string> {
  const contracts = row.contracts;
  return {
    contracts: contracts != null && row.quantity != null ? `${contracts} vs abs(${row.quantity})` : 'missing',
    costBasis: contracts != null && row.averageCostBasis != null && row.costBasisTotal != null
      ? `${roundMoney(row.averageCostBasis * contracts * 100)} expected / ${row.costBasisTotal} parsed`
      : 'missing',
    currentValue: contracts != null && row.lastPrice != null && row.currentValue != null
      ? `${roundMoney(-row.lastPrice * contracts * 100)} expected / ${row.currentValue} parsed`
      : 'missing',
    totalGainLoss: row.costBasisTotal != null && row.currentValue != null && row.totalGainLossDollar != null
      ? `${roundMoney(row.costBasisTotal + row.currentValue)} expected / ${row.totalGainLossDollar} parsed`
      : 'missing',
    todayGainLoss: contracts != null && row.lastPriceChange != null && row.todayGainLossDollar != null
      ? `${roundMoney(-row.lastPriceChange * contracts * 100)} expected / ${row.todayGainLossDollar} parsed`
      : 'missing',
  };
}

function valueText(value: number | null | undefined): string {
  return Number.isFinite(value) ? String(value) : '';
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function roughlyEqual(actual: number, expected: number, tolerance: number): boolean {
  return Math.abs(actual - expected) <= tolerance;
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function centerX(box: OcrWordBox): number {
  return (box.x0 + box.x1) / 2;
}

function centerY(box: OcrWordBox): number {
  return (box.y0 + box.y1) / 2;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function unionBox(boxes: OcrWordBox[]): OcrWordBox {
  return {
    x0: Math.min(...boxes.map(box => box.x0)),
    y0: Math.min(...boxes.map(box => box.y0)),
    x1: Math.max(...boxes.map(box => box.x1)),
    y1: Math.max(...boxes.map(box => box.y1)),
  };
}

function lineHeight(line: OcrLine): number {
  return Math.max(1, line.bbox.y1 - line.bbox.y0);
}

function makeGeneratedImportId(key: string, nowIso: string): string {
  return `import_${key.replace(/[^A-Z0-9]+/gi, '_')}_${new Date(nowIso).getTime().toString(36)}`;
}

function startOfTodayUtc(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

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
  detectedHeaderColumns: string[];
  detectedOptionRowCount: number;
  parsedRowCount: number;
  importableRowCount: number;
  warnings: string[];
}

export interface PortfolioImportParseResult {
  rows: ParsedBrokerageOptionRow[];
  diagnostics: PortfolioImportDiagnostics;
}

export interface ImportEditableRow extends ParsedBrokerageOptionRow {
  selected: boolean;
}

export interface ParsedImportAction {
  key: string;
  row: ImportEditableRow;
  existingTrade?: PortfolioTrade;
  warnings: string[];
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
  const matches = [...cleaned.matchAll(/(?:^|[\s$%])(-?\d{1,3})(?=\s|$)/g)];
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

export function parseDate(value: string): string | null {
  const match = value.toUpperCase().replace(/\bJUI\b/g, 'JUL').match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[\s.-]*(\d{1,2})[\s,.-]*(20\d{2})\b/);
  if (!match) return null;
  const [, monthName, day, year] = match;
  const month = MONTHS[monthName];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, '0')}`;
}

export function parseOptionSymbolLine(value: string): { ticker: string; strike: number; optionType: 'put' } | null {
  const normalized = value.replace(/[^\w.\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  const match = normalized.match(/\b([A-Z][A-Z0-9]{1,7})\s+(\d+(?:\.\d+)?)\s+(?:P|PUT|PUTS)\b/i);
  if (!match) return null;
  const strike = Number(match[2]);
  if (!Number.isFinite(strike) || strike <= 0) return null;
  return { ticker: match[1].toUpperCase(), strike, optionType: 'put' };
}

export function makePortfolioContractKey({ ticker, optionType, expiration, strike }: { ticker: string; optionType: 'put'; expiration: string; strike: number }): string {
  return `${ticker.trim().toUpperCase()}|${optionType}|${expiration}|${Number(strike.toFixed(4)).toString()}`;
}

export function parseBrokerageScreenshotText(ocrText: string): ParsedBrokerageOptionRow[] {
  return parseBrokerageScreenshotOcr({ text: ocrText, words: [] }).rows;
}

export function parseBrokerageScreenshotOcr(input: { text: string; words?: PortfolioImportOcrWord[] }): PortfolioImportParseResult {
  const words = normalizeOcrWords(input.words ?? []);
  if (words.length > 0) {
    const tableResult = parseBrokerageScreenshotWords(words);
    if (tableResult.rows.length > 0) return tableResult;
  }

  const lines = normalizeOcrText(input.text).split('\n');
  const rows = dedupeParsedRows(getOptionRowBlocks(lines).map(parseRowBlock).filter(Boolean) as ParsedBrokerageOptionRow[]);
  return {
    rows,
    diagnostics: {
      ocrWordCount: words.length,
      detectedHeaderColumns: [],
      detectedOptionRowCount: rows.length,
      parsedRowCount: rows.length,
      importableRowCount: rows.filter(isImportableRow).length,
      warnings: words.length > 0 ? ['Word-level OCR parsing did not detect rows; used text fallback.'] : ['Word-level OCR data was unavailable; used text fallback.'],
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
  const selectedRows = rows.filter(row => row.selected);
  const importedKeys = new Set<string>();
  const plan: PortfolioImportPlan = { adds: [], updates: [], skipped: [], missingFromImport: [], warnings: [] };
  const rowOccurrences = new Map<string, number>();
  const matchedExistingKeys = new Set<string>();

  selectedRows.forEach(row => {
    const baseKey = makePortfolioContractKey(row);
    const occurrence = (rowOccurrences.get(baseKey) ?? 0) + 1;
    rowOccurrences.set(baseKey, occurrence);
    const key = occurrence === 1 ? baseKey : `${baseKey}#${occurrence}`;
    importedKeys.add(baseKey);
    const existingTrade = occurrence === 1 ? existingByKey.get(baseKey) : undefined;
    const action: ParsedImportAction = {
      key,
      row,
      existingTrade,
      warnings: row.warnings,
    };
    if (!isImportableRow(row)) {
      plan.skipped.push(action);
    } else if (action.existingTrade && !matchedExistingKeys.has(baseKey)) {
      matchedExistingKeys.add(baseKey);
      plan.updates.push(action);
    } else {
      plan.adds.push(action);
    }
  });

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

  if (plan.skipped.length > 0) plan.warnings.push('Some parsed rows are missing required fields and will not be imported unless corrected.');
  return plan;
}

export function applyPortfolioImportPlan(plan: PortfolioImportPlan, existingTrades: PortfolioTrade[], importDate: string, nowIso = new Date().toISOString()): PortfolioTrade[] {
  const byId = new Map(existingTrades.map(trade => [trade.id, trade]));
  const next = [...existingTrades];

  plan.adds.forEach(action => {
    if (!action.row.selected) return;
    const input = parsedBrokerageRowToPortfolioTrade(action.row, importDate, nowIso);
    if (!input) return;
    next.push({
      ...input,
      id: makeGeneratedImportId(action.key, nowIso),
      createdAt: nowIso,
      updatedAt: nowIso,
    });
  });

  plan.updates.forEach(action => {
    if (!action.row.selected || !action.existingTrade) return;
    const existing = byId.get(action.existingTrade.id);
    if (!existing) return;
    const input = parsedBrokerageRowToPortfolioTrade(action.row, importDate, nowIso);
    if (!input) return;
    const updated: PortfolioTrade = {
      ...existing,
      contracts: input.contracts,
      soldPrice: input.soldPrice,
      notes: existing.notes || 'Imported screenshot used import date as sold date.',
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
      detectedHeaderColumns,
      detectedOptionRowCount: blocks.length,
      parsedRowCount: rows.length,
      importableRowCount,
      warnings: diagnosticsWarnings,
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
    confidence: Math.max(0.25, Math.min(1, baseConfidence)),
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

function mapFidelityTokens(tokens: ColumnToken[]) {
  const nonPercent = tokens.filter(token => !token.isPercent);
  const percent = tokens.filter(token => token.isPercent);
  const quantityIndex = findQuantityColumnIndex(nonPercent);
  const quantity = quantityIndex >= 0 ? nonPercent[quantityIndex].value : undefined;
  const afterQuantity = quantityIndex >= 0 ? nonPercent.slice(quantityIndex + 1) : [];
  const beforeQuantity = quantityIndex >= 0 ? nonPercent.slice(0, quantityIndex) : nonPercent;

  return {
    lastPrice: beforeQuantity[0]?.value,
    lastPriceChange: beforeQuantity[1]?.value,
    todayGainLossDollar: beforeQuantity[2]?.value,
    todayGainLossPercent: percent[0]?.value / 100,
    totalGainLossDollar: beforeQuantity[3]?.value,
    totalGainLossPercent: percent[1]?.value / 100,
    currentValue: findCurrentValueToken(beforeQuantity)?.value,
    percentOfAccount: percent[2]?.value / 100,
    quantity,
    averageCostBasis: afterQuantity.find(token => token.value >= 0 && token.value <= 100)?.value,
    costBasisTotal: afterQuantity.find(token => Math.abs(token.value) > 100)?.value,
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

function findCurrentValueToken(beforeQuantity: ColumnToken[]): ColumnToken | undefined {
  const negative = [...beforeQuantity].reverse().find(token => token.value < 0 && Math.abs(token.value) >= 10);
  if (negative) return negative;
  return [...beforeQuantity].reverse().find(token => Math.abs(token.value) >= 10);
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

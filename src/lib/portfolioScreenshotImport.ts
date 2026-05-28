import type { PortfolioTrade, PortfolioTradeInput, PortfolioTradeStatus } from './portfolioStorage';

export interface ParsedBrokerageOptionRow {
  rawText: string;
  ticker: string;
  optionType: 'put';
  strike: number;
  expiration: string;
  quantity: number | null;
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

const MONTHS: Record<string, string> = {
  JAN: '01',
  FEB: '02',
  MAR: '03',
  APR: '04',
  MAY: '05',
  JUN: '06',
  JUL: '07',
  AUG: '08',
  SEP: '09',
  SEPT: '09',
  OCT: '10',
  NOV: '11',
  DEC: '12',
};

export function normalizeOcrText(value: string): string {
  return value
    .replace(/\u2212/g, '-')
    .replace(/[–—]/g, '-')
    .replace(/[|]+/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .join('\n');
}

export function parseMoney(value: string): number | undefined {
  const match = value.replace(/[(),]/g, match => match === '(' ? '-' : match === ')' ? '' : '').match(/-?\$?\s*\d+(?:,\d{3})*(?:\.\d+)?|-?\$?\s*\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const numeric = Number(match[0].replace(/[$,\s]/g, ''));
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function parsePercent(value: string): number | undefined {
  const match = value.match(/-?\d+(?:\.\d+)?\s*%?/);
  if (!match) return undefined;
  const numeric = Number(match[0].replace('%', '').trim());
  return Number.isFinite(numeric) ? numeric / 100 : undefined;
}

export function parseSignedNumber(value: string): number | undefined {
  const cleaned = value.replace(/\bM\b/gi, '').replace(/,/g, ' ');
  const match = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!match) return undefined;
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function parseDate(value: string): string | null {
  const match = value.toUpperCase().match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[\s.-]*(\d{1,2})[\s,.-]*(20\d{2})\b/);
  if (!match) return null;
  const [, monthName, day, year] = match;
  const month = MONTHS[monthName];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, '0')}`;
}

export function parseOptionSymbolLine(value: string): { ticker: string; strike: number; optionType: 'put' } | null {
  const normalized = value.replace(/\s+/g, ' ').trim();
  const match = normalized.match(/\b([A-Z][A-Z0-9]{0,7})\s+(\d+(?:\.\d+)?)\s+(P(?:UT)?|PUTS)\b/i);
  if (!match) return null;
  const strike = Number(match[2]);
  if (!Number.isFinite(strike) || strike <= 0) return null;
  return { ticker: match[1].toUpperCase(), strike, optionType: 'put' };
}

export function makePortfolioContractKey({ ticker, optionType, expiration, strike }: { ticker: string; optionType: 'put'; expiration: string; strike: number }): string {
  return `${ticker.trim().toUpperCase()}|${optionType}|${expiration}|${Number(strike.toFixed(4)).toString()}`;
}

export function parseBrokerageScreenshotText(ocrText: string): ParsedBrokerageOptionRow[] {
  const text = normalizeOcrText(ocrText);
  const lines = text.split('\n');
  const rows: ParsedBrokerageOptionRow[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const symbol = parseOptionSymbolLine(lines[index]);
    if (!symbol) continue;

    const lookahead = lines.slice(index + 1, Math.min(lines.length, index + 8));
    const dateLineIndex = lookahead.findIndex(line => parseDate(line));
    const expiration = dateLineIndex >= 0 ? parseDate(lookahead[dateLineIndex]) : null;
    const numericLines = lookahead.slice(dateLineIndex >= 0 ? dateLineIndex + 1 : 0, dateLineIndex >= 0 ? dateLineIndex + 7 : 7);
    const joined = numericLines.join(' ');
    const values = extractNumericTokens(joined);

    const warnings: string[] = [];
    if (!expiration) warnings.push('Expiration could not be read.');

    const quantity = findQuantity(values);
    if (quantity == null) warnings.push('Quantity could not be read.');

    const contracts = quantity != null ? Math.abs(quantity) : null;
    const averageCostBasis = findAverageCostBasis(values, contracts);
    if (averageCostBasis == null) warnings.push('Average cost basis could not be read; sold price is required.');

    const costBasisTotal = findCostBasisTotal(values, contracts, averageCostBasis);
    if (contracts != null && averageCostBasis != null && costBasisTotal != null) {
      const expected = Math.abs(averageCostBasis * 100 * contracts);
      const diff = Math.abs(Math.abs(costBasisTotal) - expected);
      if (diff > Math.max(10, expected * 0.08)) warnings.push('Average cost basis and cost basis total differ more than expected.');
    }

    rows.push({
      rawText: [lines[index], ...lookahead.slice(0, Math.max(dateLineIndex + 2, 2))].join('\n'),
      ticker: symbol.ticker,
      optionType: 'put',
      strike: symbol.strike,
      expiration: expiration ?? '',
      quantity,
      contracts,
      lastPrice: values.find(value => value > 0 && value < symbol.strike),
      totalGainLossDollar: findGainLossDollar(values),
      currentValue: findCurrentValue(values, contracts, averageCostBasis),
      averageCostBasis,
      costBasisTotal,
      confidence: Math.max(0.25, 1 - warnings.length * 0.18),
      warnings: [
        ...warnings,
        'Entry date not shown in screenshot. Import date used as sold date. Edit trade if needed.',
      ],
    });
  }

  return dedupeParsedRows(rows);
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

  selectedRows.forEach(row => {
    const key = makePortfolioContractKey(row);
    importedKeys.add(key);
    const action: ParsedImportAction = {
      key,
      row,
      existingTrade: existingByKey.get(key),
      warnings: row.warnings,
    };
    if (!isImportableRow(row)) {
      plan.skipped.push(action);
    } else if (action.existingTrade) {
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
    const noteSuffix = 'Imported screenshot used import date as sold date.';
    const preservedNotes = existing.notes ?? '';
    const notes = preservedNotes || noteSuffix;
    const updated: PortfolioTrade = {
      ...existing,
      contracts: input.contracts,
      soldPrice: input.soldPrice,
      notes,
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

function extractNumericTokens(value: string): number[] {
  const matches = value
    .replace(/\bM\b/gi, ' ')
    .replace(/\u2212/g, '-')
    .match(/-?\$?\d+(?:,\d{3})*(?:\.\d+)?%?/g);
  if (!matches) return [];
  return matches
    .map(token => Number(token.replace(/[$,%]/g, '').replace(/,/g, '')))
    .filter(Number.isFinite);
}

function findQuantity(values: number[]): number | null {
  const negativeInteger = values.find(value => Number.isInteger(value) && value < 0 && Math.abs(value) <= 500);
  if (negativeInteger != null) return negativeInteger;
  const smallInteger = values.find(value => Number.isInteger(value) && value !== 0 && Math.abs(value) <= 500);
  return smallInteger ?? null;
}

function findAverageCostBasis(values: number[], contracts: number | null): number | undefined {
  if (contracts == null) {
    return values.find(value => value >= 0 && value <= 100);
  }
  const candidates = values.filter(value => value >= 0 && value <= 100);
  return candidates.find(candidate => values.some(value => Math.abs(Math.abs(value) - candidate * contracts * 100) <= Math.max(10, candidate * contracts * 8))) ?? candidates[candidates.length - 1];
}

function findCostBasisTotal(values: number[], contracts: number | null, averageCostBasis?: number): number | undefined {
  if (contracts == null || averageCostBasis == null) return undefined;
  const expected = averageCostBasis * contracts * 100;
  return values.find(value => Math.abs(Math.abs(value) - expected) <= Math.max(10, expected * 0.08));
}

function findCurrentValue(values: number[], contracts: number | null, averageCostBasis?: number): number | undefined {
  if (contracts == null) return undefined;
  const plausible = values.filter(value => Math.abs(value) >= contracts && Math.abs(value) <= Math.max(1000000, contracts * 100000));
  const costBasis = averageCostBasis != null ? averageCostBasis * contracts * 100 : null;
  return plausible.find(value => costBasis == null || Math.abs(Math.abs(value) - costBasis) > Math.max(10, costBasis * 0.08));
}

function findGainLossDollar(values: number[]): number | undefined {
  return values.find(value => Math.abs(value) >= 10 && Math.abs(value) <= 1000000);
}

function dedupeParsedRows(rows: ParsedBrokerageOptionRow[]): ParsedBrokerageOptionRow[] {
  const byKey = new Map<string, ParsedBrokerageOptionRow>();
  rows.forEach(row => {
    if (!row.expiration) return byKey.set(`${row.rawText}-${byKey.size}`, row);
    const key = makePortfolioContractKey(row);
    const existing = byKey.get(key);
    if (!existing || (row.confidence ?? 0) > (existing.confidence ?? 0)) byKey.set(key, row);
  });
  return [...byKey.values()];
}

function makeGeneratedImportId(key: string, nowIso: string): string {
  return `import_${key.replace(/[^A-Z0-9]+/gi, '_')}_${new Date(nowIso).getTime().toString(36)}`;
}

function startOfTodayUtc(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

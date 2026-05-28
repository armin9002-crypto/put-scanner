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
  const match = value.toUpperCase().match(/\b(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|SEPT|OCT|NOV|DEC)[\s.-]*(\d{1,2})[\s,.-]*(20\d{2})\b/);
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
  const lines = normalizeOcrText(ocrText).split('\n');
  return dedupeParsedRows(getOptionRowBlocks(lines).map(parseRowBlock).filter(Boolean) as ParsedBrokerageOptionRow[]);
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

function makeGeneratedImportId(key: string, nowIso: string): string {
  return `import_${key.replace(/[^A-Z0-9]+/gi, '_')}_${new Date(nowIso).getTime().toString(36)}`;
}

function startOfTodayUtc(): number {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

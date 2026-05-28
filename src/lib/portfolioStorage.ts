export type PortfolioTradeStatus = 'open' | 'closed' | 'expired' | 'assigned';
export type PortfolioAvailabilityStatus = 'live' | 'expired' | 'unavailable' | 'refresh_failed' | 'stale' | 'imported_snapshot';

export interface PortfolioTradeSnapshot {
  underlyingPrice?: number | null;
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  iv?: number | null;
  delta?: number | null;
}

export interface PortfolioMarketData {
  underlyingPrice?: number | null;
  optionBid?: number | null;
  optionAsk?: number | null;
  optionMid?: number | null;
  optionLast?: number | null;
  lastTradeDate?: string | number | null;
  iv?: number | null;
  delta?: number | null;
  volume?: number | null;
  openInterest?: number | null;
  dte?: number | null;
  refreshedAt?: string;
  availabilityStatus?: PortfolioAvailabilityStatus;
}

export interface PortfolioImportedSnapshot {
  source: 'brokerage_screenshot';
  importedAt: string;
  lastPrice?: number | null;
  todayGainLossDollar?: number | null;
  todayGainLossPercent?: number | null;
  totalGainLossDollar?: number | null;
  totalGainLossPercent?: number | null;
  currentValue?: number | null;
  percentOfAccount?: number | null;
  averageCostBasis?: number | null;
  costBasisTotal?: number | null;
}

export interface PortfolioTrade {
  id: string;
  ticker: string;
  optionType: 'put';
  strike: number;
  expiration: string;
  contracts: number;
  soldPrice: number;
  soldDate: string;
  status: PortfolioTradeStatus;
  notes?: string;
  closePrice?: number;
  closeDate?: string;
  createdAt: string;
  updatedAt: string;
  entrySnapshot?: PortfolioTradeSnapshot;
  latestMarketData?: PortfolioMarketData;
  importedSnapshot?: PortfolioImportedSnapshot;
}

export type PortfolioTradeInput = Omit<PortfolioTrade, 'id' | 'createdAt' | 'updatedAt'> & {
  id?: string;
  createdAt?: string;
  updatedAt?: string;
};

export const PORTFOLIO_STORAGE_KEY = 'put_scanner_portfolio_trades';

const VALID_STATUSES: PortfolioTradeStatus[] = ['open', 'closed', 'expired', 'assigned'];
const VALID_AVAILABILITY: PortfolioAvailabilityStatus[] = ['live', 'expired', 'unavailable', 'refresh_failed', 'stale', 'imported_snapshot'];

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function finiteNumber(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function positiveNumber(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric != null && numeric > 0 ? numeric : null;
}

function nonNegativeNumber(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric != null && numeric >= 0 ? numeric : null;
}

function positiveInteger(value: unknown): number | null {
  const numeric = finiteNumber(value);
  return numeric != null && Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function normalizeTicker(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeIsoDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const date = new Date(`${trimmed}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : trimmed;
  }
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().split('T')[0];
}

function normalizeOptionalNumber(value: unknown): number | null | undefined {
  if (value == null || value === '') return undefined;
  const numeric = finiteNumber(value);
  return numeric == null ? undefined : numeric;
}

function normalizeSnapshot(value: unknown): PortfolioTradeSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const snapshot: PortfolioTradeSnapshot = {};
  (['underlyingPrice', 'bid', 'ask', 'last', 'iv', 'delta'] as const).forEach(field => {
    const normalized = normalizeOptionalNumber(value[field]);
    if (normalized !== undefined) snapshot[field] = normalized;
  });
  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

function normalizeMarketData(value: unknown): PortfolioMarketData | undefined {
  if (!isRecord(value)) return undefined;
  const marketData: PortfolioMarketData = {};
  ([
    'underlyingPrice',
    'optionBid',
    'optionAsk',
    'optionMid',
    'optionLast',
    'iv',
    'delta',
    'volume',
    'openInterest',
    'dte',
  ] as const).forEach(field => {
    const normalized = normalizeOptionalNumber(value[field]);
    if (normalized !== undefined) marketData[field] = normalized;
  });

  if (typeof value.lastTradeDate === 'string' || typeof value.lastTradeDate === 'number') {
    marketData.lastTradeDate = value.lastTradeDate;
  }
  if (typeof value.refreshedAt === 'string') {
    const parsed = new Date(value.refreshedAt);
    if (!Number.isNaN(parsed.getTime())) marketData.refreshedAt = parsed.toISOString();
  }
  if (typeof value.availabilityStatus === 'string' && VALID_AVAILABILITY.includes(value.availabilityStatus as PortfolioAvailabilityStatus)) {
    marketData.availabilityStatus = value.availabilityStatus as PortfolioAvailabilityStatus;
  }

  return Object.keys(marketData).length > 0 ? marketData : undefined;
}

function normalizeImportedSnapshot(value: unknown): PortfolioImportedSnapshot | undefined {
  if (!isRecord(value) || value.source !== 'brokerage_screenshot') return undefined;
  const importedAt = typeof value.importedAt === 'string' && !Number.isNaN(new Date(value.importedAt).getTime())
    ? new Date(value.importedAt).toISOString()
    : new Date().toISOString();
  const snapshot: PortfolioImportedSnapshot = { source: 'brokerage_screenshot', importedAt };
  ([
    'lastPrice',
    'todayGainLossDollar',
    'todayGainLossPercent',
    'totalGainLossDollar',
    'totalGainLossPercent',
    'currentValue',
    'percentOfAccount',
    'averageCostBasis',
    'costBasisTotal',
  ] as const).forEach(field => {
    const normalized = normalizeOptionalNumber(value[field]);
    if (normalized !== undefined) snapshot[field] = normalized;
  });
  return snapshot;
}

export function makePortfolioTradeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `portfolio_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizePortfolioTrade(raw: unknown): PortfolioTrade | null {
  if (!isRecord(raw)) return null;

  const ticker = normalizeTicker(raw.ticker);
  const strike = positiveNumber(raw.strike);
  const expiration = normalizeIsoDate(raw.expiration ?? raw.expiry);
  const contracts = positiveInteger(raw.contracts);
  const soldPrice = nonNegativeNumber(raw.soldPrice ?? raw.price);
  const soldDate = normalizeIsoDate(raw.soldDate);
  const status = typeof raw.status === 'string' && VALID_STATUSES.includes(raw.status as PortfolioTradeStatus)
    ? raw.status as PortfolioTradeStatus
    : 'open';

  if (!ticker || strike == null || !expiration || contracts == null || soldPrice == null || !soldDate) return null;

  const now = new Date().toISOString();
  const createdAt = typeof raw.createdAt === 'string' && !Number.isNaN(new Date(raw.createdAt).getTime())
    ? new Date(raw.createdAt).toISOString()
    : now;
  const updatedAt = typeof raw.updatedAt === 'string' && !Number.isNaN(new Date(raw.updatedAt).getTime())
    ? new Date(raw.updatedAt).toISOString()
    : createdAt;
  const closePrice = nonNegativeNumber(raw.closePrice);
  const closeDate = normalizeIsoDate(raw.closeDate);

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id : makePortfolioTradeId(),
    ticker,
    optionType: 'put',
    strike,
    expiration,
    contracts,
    soldPrice,
    soldDate,
    status,
    notes: typeof raw.notes === 'string' ? raw.notes : typeof raw.note === 'string' ? raw.note : '',
    closePrice: closePrice ?? undefined,
    closeDate: closeDate ?? undefined,
    createdAt,
    updatedAt,
    entrySnapshot: normalizeSnapshot(raw.entrySnapshot),
    latestMarketData: normalizeMarketData(raw.latestMarketData),
    importedSnapshot: normalizeImportedSnapshot(raw.importedSnapshot),
  };
}

function readRawTrades(storage: Storage): unknown[] {
  try {
    const raw = storage.getItem(PORTFOLIO_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function loadPortfolioTrades(): PortfolioTrade[] {
  const storage = getStorage();
  if (!storage) return [];
  const normalized = readRawTrades(storage).map(normalizePortfolioTrade).filter(Boolean) as PortfolioTrade[];
  try {
    storage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // Best-effort normalization only.
  }
  return normalized;
}

export function savePortfolioTrades(trades: PortfolioTrade[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const normalized = trades.map(normalizePortfolioTrade).filter(Boolean) as PortfolioTrade[];
    storage.setItem(PORTFOLIO_STORAGE_KEY, JSON.stringify(normalized));
  } catch {
    // localStorage may be unavailable or full.
  }
}

export function addPortfolioTrade(trade: PortfolioTradeInput): PortfolioTrade[] {
  const now = new Date().toISOString();
  const normalized = normalizePortfolioTrade({
    ...trade,
    id: trade.id ?? makePortfolioTradeId(),
    createdAt: trade.createdAt ?? now,
    updatedAt: now,
  });
  if (!normalized) return loadPortfolioTrades();
  const trades = [...loadPortfolioTrades(), normalized];
  savePortfolioTrades(trades);
  return trades;
}

export function updatePortfolioTrade(id: string, patch: Partial<PortfolioTrade>): PortfolioTrade[] {
  const trades = loadPortfolioTrades().map(trade => {
    if (trade.id !== id) return trade;
    const normalized = normalizePortfolioTrade({
      ...trade,
      ...patch,
      id: trade.id,
      createdAt: trade.createdAt,
      updatedAt: new Date().toISOString(),
    });
    return normalized ?? trade;
  });
  savePortfolioTrades(trades);
  return trades;
}

export function deletePortfolioTrade(id: string): PortfolioTrade[] {
  const trades = loadPortfolioTrades().filter(trade => trade.id !== id);
  savePortfolioTrades(trades);
  return trades;
}

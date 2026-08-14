export type PortfolioTradeStatus = 'open' | 'closed' | 'expired' | 'assigned' | 'expired_price_pending';
export type PortfolioResolutionType = 'expired_worthless' | 'expired_itm' | 'expired_price_pending';
export type PortfolioResolutionSource = 'expiration_close' | 'manual_expiration_close';
export type PortfolioAvailabilityStatus = 'live' | 'expired' | 'unavailable' | 'refresh_failed' | 'stale' | 'imported_snapshot';
export type PortfolioEntryVixSource = 'historical_close' | 'nearest_prior_close';

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
  resolvedDate?: string;
  resolutionType?: PortfolioResolutionType;
  expirationClosePrice?: number;
  expirationCloseDate?: string;
  finalOptionValue?: number;
  realizedPnl?: number;
  percentCaptured?: number;
  premiumCollected?: number;
  daysHeld?: number;
  entryVixClose?: number;
  entryVixDate?: string;
  entryVixSource?: PortfolioEntryVixSource;
  resolutionSource?: PortfolioResolutionSource;
  resolutionWarning?: string;
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
export const PORTFOLIO_DURABLE_SCHEMA_VERSION = 1 as const;

export type DurablePortfolioTrade = Omit<PortfolioTrade, 'latestMarketData'>;

export interface PortfolioStorageEnvelopeV1 extends DurableStateEnvelope<DurablePortfolioTrade[], 1> {
  localMarketData?: Record<string, PortfolioMarketData>;
}

export interface PortfolioMigrationResult {
  data: DurablePortfolioTrade[];
  localMarketData: Record<string, PortfolioMarketData>;
}

export interface PortfolioMigrationOptions {
  createMissingId?: (entry: Record<string, unknown>, index: number) => string;
  timestampForMissingFields?: string;
}

const VALID_STATUSES: PortfolioTradeStatus[] = ['open', 'closed', 'expired', 'assigned', 'expired_price_pending'];
const VALID_RESOLUTION_TYPES: PortfolioResolutionType[] = ['expired_worthless', 'expired_itm', 'expired_price_pending'];
const VALID_RESOLUTION_SOURCES: PortfolioResolutionSource[] = ['expiration_close', 'manual_expiration_close'];
const VALID_AVAILABILITY: PortfolioAvailabilityStatus[] = ['live', 'expired', 'unavailable', 'refresh_failed', 'stale', 'imported_snapshot'];

function getStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
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

function normalizeImportedSnapshot(value: unknown, fillMissingTimestamp = true): PortfolioImportedSnapshot | undefined {
  if (!isRecord(value) || value.source !== 'brokerage_screenshot') return undefined;
  const importedAt = typeof value.importedAt === 'string' && !Number.isNaN(new Date(value.importedAt).getTime())
    ? new Date(value.importedAt).toISOString()
    : fillMissingTimestamp ? new Date().toISOString() : null;
  if (!importedAt) return undefined;
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

export function normalizePortfolioTrade(
  raw: unknown,
  options: { generateMissingFields?: boolean; timestampForMissingFields?: string } = {},
): PortfolioTrade | null {
  if (!isRecord(raw)) return null;

  const generateMissingFields = options.generateMissingFields !== false;

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
  if (raw.optionType !== undefined && raw.optionType !== 'put') return null;
  if (raw.status !== undefined && (typeof raw.status !== 'string' || !VALID_STATUSES.includes(raw.status as PortfolioTradeStatus))) return null;

  const now = options.timestampForMissingFields ?? new Date().toISOString();
  const id = typeof raw.id === 'string' && raw.id.trim()
    ? raw.id
    : generateMissingFields ? makePortfolioTradeId() : null;
  const createdAt = typeof raw.createdAt === 'string' && !Number.isNaN(new Date(raw.createdAt).getTime())
    ? new Date(raw.createdAt).toISOString()
    : generateMissingFields ? now : null;
  const updatedAt = typeof raw.updatedAt === 'string' && !Number.isNaN(new Date(raw.updatedAt).getTime())
    ? new Date(raw.updatedAt).toISOString()
    : createdAt;
  if (!id || !createdAt || !updatedAt) return null;
  const closePrice = nonNegativeNumber(raw.closePrice);
  const closeDate = normalizeIsoDate(raw.closeDate);
  const resolvedDate = normalizeIsoDate(raw.resolvedDate);
  const expirationClosePrice = nonNegativeNumber(raw.expirationClosePrice);
  const expirationCloseDate = normalizeIsoDate(raw.expirationCloseDate);
  const finalOptionValue = nonNegativeNumber(raw.finalOptionValue);
  const realizedPnl = finiteNumber(raw.realizedPnl);
  const percentCaptured = finiteNumber(raw.percentCaptured);
  const premiumCollected = nonNegativeNumber(raw.premiumCollected);
  const daysHeld = nonNegativeNumber(raw.daysHeld);
  const entryVixClose = nonNegativeNumber(raw.entryVixClose);
  const entryVixDate = normalizeIsoDate(raw.entryVixDate);
  const entryVixSource = raw.entryVixSource === 'historical_close' || raw.entryVixSource === 'nearest_prior_close'
    ? raw.entryVixSource as PortfolioEntryVixSource
    : undefined;
  const resolutionType = typeof raw.resolutionType === 'string' && VALID_RESOLUTION_TYPES.includes(raw.resolutionType as PortfolioResolutionType)
    ? raw.resolutionType as PortfolioResolutionType
    : undefined;
  const resolutionSource = typeof raw.resolutionSource === 'string' && VALID_RESOLUTION_SOURCES.includes(raw.resolutionSource as PortfolioResolutionSource)
    ? raw.resolutionSource as PortfolioResolutionSource
    : undefined;

  return {
    id,
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
    resolvedDate: resolvedDate ?? undefined,
    resolutionType,
    expirationClosePrice: expirationClosePrice ?? undefined,
    expirationCloseDate: expirationCloseDate ?? undefined,
    finalOptionValue: finalOptionValue ?? undefined,
    realizedPnl: realizedPnl ?? undefined,
    percentCaptured: percentCaptured ?? undefined,
    premiumCollected: premiumCollected ?? undefined,
    daysHeld: daysHeld ?? undefined,
    entryVixClose: entryVixClose ?? undefined,
    entryVixDate: entryVixDate ?? undefined,
    entryVixSource,
    resolutionSource,
    resolutionWarning: typeof raw.resolutionWarning === 'string' ? raw.resolutionWarning : undefined,
    createdAt,
    updatedAt,
    entrySnapshot: normalizeSnapshot(raw.entrySnapshot),
    latestMarketData: normalizeMarketData(raw.latestMarketData),
    importedSnapshot: normalizeImportedSnapshot(raw.importedSnapshot, generateMissingFields),
  };
}

export function toDurablePortfolioTrade(trade: PortfolioTrade): DurablePortfolioTrade {
  const durable: Partial<PortfolioTrade> = { ...trade };
  delete durable.latestMarketData;
  return durable as DurablePortfolioTrade;
}

export function toDurablePortfolioState(trades: PortfolioTrade[]): DurablePortfolioTrade[] {
  return trades.map(toDurablePortfolioTrade);
}

export function hydrateRuntimePortfolio(
  durableState: DurablePortfolioTrade[],
  localMarketData: Record<string, PortfolioMarketData> = {},
): PortfolioTrade[] {
  return durableState.map(trade => localMarketData[trade.id]
    ? { ...trade, latestMarketData: localMarketData[trade.id] }
    : { ...trade });
}

function portfolioLocalMarketData(trades: PortfolioTrade[]): Record<string, PortfolioMarketData> {
  return Object.fromEntries(trades
    .filter(trade => trade.latestMarketData !== undefined)
    .map(trade => [trade.id, trade.latestMarketData as PortfolioMarketData]));
}

function invalidPortfolioEnumFields(entry: Record<string, unknown>): boolean {
  return (entry.resolutionType !== undefined
      && (typeof entry.resolutionType !== 'string' || !VALID_RESOLUTION_TYPES.includes(entry.resolutionType as PortfolioResolutionType)))
    || (entry.resolutionSource !== undefined
      && (typeof entry.resolutionSource !== 'string' || !VALID_RESOLUTION_SOURCES.includes(entry.resolutionSource as PortfolioResolutionSource)))
    || (entry.entryVixSource !== undefined
      && entry.entryVixSource !== 'historical_close' && entry.entryVixSource !== 'nearest_prior_close');
}

export type PortfolioStateMigrationOutcome =
  | { status: 'ok'; state: PortfolioMigrationResult }
  | { status: 'error'; error: string }
  | { status: 'unsupported_version'; version: number };

export function migratePortfolioState(
  inputVersion: number,
  value: unknown,
  options: PortfolioMigrationOptions = {},
): PortfolioStateMigrationOutcome {
  if (inputVersion !== 0 && inputVersion !== PORTFOLIO_DURABLE_SCHEMA_VERSION) {
    return { status: 'unsupported_version', version: inputVersion };
  }
  if (!Array.isArray(value)) return { status: 'error', error: 'Portfolio data must be an array.' };

  const data: DurablePortfolioTrade[] = [];
  const localMarketData: Record<string, PortfolioMarketData> = {};
  const ids = new Set<string>();

  for (let index = 0; index < value.length; index += 1) {
    const original = value[index];
    if (!isRecord(original)) return { status: 'error', error: `Portfolio trade ${index} is not an object.` };
    if (inputVersion === PORTFOLIO_DURABLE_SCHEMA_VERSION && 'latestMarketData' in original) {
      return { status: 'error', error: `Portfolio trade ${index} contains transient market data in the durable payload.` };
    }
    if (invalidPortfolioEnumFields(original)) {
      return { status: 'error', error: `Portfolio trade ${index} contains an invalid lifecycle value.` };
    }
    if (original.importedSnapshot !== undefined
      && (!isRecord(original.importedSnapshot)
        || original.importedSnapshot.source !== 'brokerage_screenshot'
        || typeof original.importedSnapshot.importedAt !== 'string'
        || Number.isNaN(Date.parse(original.importedSnapshot.importedAt)))) {
      return { status: 'error', error: `Portfolio trade ${index} contains an invalid imported snapshot.` };
    }

    const prepared: Record<string, unknown> = { ...original };
    if (typeof prepared.id !== 'string' || !prepared.id.trim()) {
      const createdId = options.createMissingId?.(original, index)?.trim();
      if (!createdId) {
        return {
          status: 'error',
          error: `Portfolio trade ${index} has no stable id and requires a controlled migration before it can be read.`,
        };
      }
      prepared.id = createdId;
    }
    if (options.timestampForMissingFields) {
      prepared.createdAt ??= options.timestampForMissingFields;
      prepared.updatedAt ??= prepared.createdAt;
    }

    const normalized = normalizePortfolioTrade(prepared, { generateMissingFields: false });
    if (!normalized) return { status: 'error', error: `Portfolio trade ${index} is structurally invalid.` };
    if (ids.has(normalized.id)) return { status: 'error', error: `Portfolio trade id ${normalized.id} is duplicated.` };
    ids.add(normalized.id);
    data.push(toDurablePortfolioTrade(normalized));
    if (inputVersion === 0 && normalized.latestMarketData) localMarketData[normalized.id] = normalized.latestMarketData;
  }

  return { status: 'ok', state: { data, localMarketData } };
}

function normalizeLocalMarketData(value: unknown): Record<string, PortfolioMarketData> | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const normalized: Record<string, PortfolioMarketData> = {};
  for (const [id, marketData] of Object.entries(value)) {
    if (!isRecord(marketData)) return null;
    const item = normalizeMarketData(marketData);
    if (item) normalized[id] = item;
    else if (Object.keys(marketData).length > 0) return null;
  }
  return normalized;
}

function validatePortfolioEnvelope(value: unknown): PortfolioStorageEnvelopeV1 {
  if (!isRecord(value) || value.schemaVersion !== PORTFOLIO_DURABLE_SCHEMA_VERSION) {
    throw new Error('Portfolio storage envelope is invalid.');
  }
  const updatedAt = normalizeEnvelopeTimestamp(value.updatedAt);
  if (updatedAt === undefined || !Number.isInteger(value.revision) || Number(value.revision) < 0) {
    throw new Error('Portfolio storage metadata is invalid.');
  }
  const migrated = migratePortfolioState(PORTFOLIO_DURABLE_SCHEMA_VERSION, value.data);
  if (migrated.status !== 'ok') {
    throw new Error(migrated.status === 'error' ? migrated.error : 'Portfolio schema is unsupported.');
  }
  const localMarketData = normalizeLocalMarketData(value.localMarketData);
  if (localMarketData == null) throw new Error('Portfolio local market data is invalid.');
  return {
    schemaVersion: PORTFOLIO_DURABLE_SCHEMA_VERSION,
    updatedAt,
    revision: Number(value.revision),
    data: migrated.state.data,
    ...(Object.keys(localMarketData).length > 0 ? { localMarketData } : {}),
  };
}

export function createPortfolioStorageEnvelope(
  data: DurablePortfolioTrade[],
  metadata: { updatedAt: string | null; revision: number },
  localMarketData: Record<string, PortfolioMarketData> = {},
): PortfolioStorageEnvelopeV1 {
  return validatePortfolioEnvelope({
    schemaVersion: PORTFOLIO_DURABLE_SCHEMA_VERSION,
    updatedAt: metadata.updatedAt,
    revision: metadata.revision,
    data,
    ...(Object.keys(localMarketData).length > 0 ? { localMarketData } : {}),
  });
}

export function serializePortfolioStorageEnvelope(envelope: PortfolioStorageEnvelopeV1):
  | { status: 'ok'; serialized: string }
  | { status: 'error'; error: string } {
  return serializeAndValidate(envelope, value => { validatePortfolioEnvelope(value); });
}

export function readPortfolioTrades(storage: StorageLike | null = getStorage()): StorageReadResult<PortfolioTrade[]> {
  if (!storage) return { status: 'corrupt', error: 'Portfolio storage is unavailable.' };
  let rawValue: string | null;
  try {
    rawValue = storage.getItem(PORTFOLIO_STORAGE_KEY);
  } catch (error) {
    return { status: 'corrupt', error: error instanceof Error ? error.message : 'Portfolio storage could not be read.' };
  }
  if (rawValue === null) return { status: 'missing' };

  const parsed = parseStoredJson(rawValue, 'Portfolio storage');
  if (parsed.status === 'corrupt') return parsed;

  if (Array.isArray(parsed.value)) {
    const migrated = migratePortfolioState(0, parsed.value);
    if (migrated.status !== 'ok') {
      return migrated.status === 'unsupported_version'
        ? { status: 'unsupported_version', version: migrated.version, rawValue }
        : { status: 'corrupt', error: `${migrated.error} The original value was preserved.`, rawValue };
    }
    return {
      status: 'ok',
      data: hydrateRuntimePortfolio(migrated.state.data, migrated.state.localMarketData),
      schemaVersion: 0,
      source: 'legacy',
      updatedAt: null,
      revision: 0,
    };
  }

  if (!isRecord(parsed.value) || typeof parsed.value.schemaVersion !== 'number') {
    return { status: 'corrupt', error: 'Portfolio storage has an unexpected root value. The original value was preserved.', rawValue };
  }
  if (parsed.value.schemaVersion !== PORTFOLIO_DURABLE_SCHEMA_VERSION) {
    return { status: 'unsupported_version', version: parsed.value.schemaVersion, rawValue };
  }
  try {
    const envelope = validatePortfolioEnvelope(parsed.value);
    return {
      status: 'ok',
      data: hydrateRuntimePortfolio(envelope.data, envelope.localMarketData),
      schemaVersion: envelope.schemaVersion,
      source: 'canonical',
      updatedAt: envelope.updatedAt,
      revision: envelope.revision,
    };
  } catch (error) {
    return {
      status: 'corrupt',
      error: `${error instanceof Error ? error.message : 'Portfolio storage is invalid.'} The original value was preserved.`,
      rawValue,
    };
  }
}

export function loadPortfolioTrades(): PortfolioTrade[] {
  const result = readPortfolioTrades();
  if (result.status === 'ok') return result.data;
  if (result.status === 'missing') return [];
  throw new DurableStorageReadError(result);
}

export function writePortfolioTrades(
  storage: StorageLike,
  trades: PortfolioTrade[],
  options: { now?: Date } = {},
): StorageWriteResult {
  const migrated = migratePortfolioState(0, trades);
  if (migrated.status !== 'ok') {
    return { status: 'error', error: migrated.status === 'error' ? migrated.error : 'Portfolio schema is unsupported.' };
  }

  const current = readPortfolioTrades(storage);
  if (current.status === 'corrupt') return { status: 'error', error: current.error };
  if (current.status === 'unsupported_version') {
    return { status: 'error', error: `Portfolio schema version ${current.version} is unsupported.` };
  }

  const previousDurable = current.status === 'ok' ? toDurablePortfolioState(current.data) : null;
  const previousLocal = current.status === 'ok' ? portfolioLocalMarketData(current.data) : null;
  const durableChanged = previousDurable === null || !stableJsonEqual(previousDurable, migrated.state.data);
  const localChanged = previousLocal === null || !stableJsonEqual(previousLocal, migrated.state.localMarketData);
  if (!durableChanged && !localChanged) return { status: 'ok', written: false };

  const priorRevision = current.status === 'ok' ? current.revision : 0;
  const envelope = createPortfolioStorageEnvelope(migrated.state.data, {
    updatedAt: durableChanged ? (options.now ?? new Date()).toISOString() : current.status === 'ok' ? current.updatedAt : null,
    revision: durableChanged ? priorRevision + 1 : priorRevision,
  }, migrated.state.localMarketData);
  const serialized = serializePortfolioStorageEnvelope(envelope);
  if (serialized.status === 'error') return serialized;

  try {
    storage.setItem(PORTFOLIO_STORAGE_KEY, serialized.serialized);
    return { status: 'ok', written: true };
  } catch (error) {
    return { status: 'error', error: error instanceof Error ? error.message : 'Portfolio storage could not be written.' };
  }
}

export function savePortfolioTrades(trades: PortfolioTrade[]): StorageWriteResult {
  const storage = getStorage();
  return storage ? writePortfolioTrades(storage, trades) : { status: 'error', error: 'Portfolio storage is unavailable.' };
}

function portfolioTradesForMutation(): PortfolioTrade[] {
  const result = readPortfolioTrades();
  if (result.status === 'ok') return result.data;
  if (result.status === 'missing') return [];
  throw new DurableStorageReadError(result);
}

export function addPortfolioTrade(trade: PortfolioTradeInput): PortfolioTrade[] {
  const current = portfolioTradesForMutation();
  const now = new Date().toISOString();
  const normalized = normalizePortfolioTrade({
    ...trade,
    id: trade.id ?? makePortfolioTradeId(),
    createdAt: trade.createdAt ?? now,
    updatedAt: now,
  });
  if (!normalized) return current;
  const trades = [...current, normalized];
  return savePortfolioTrades(trades).status === 'ok' ? trades : current;
}

export function updatePortfolioTrade(id: string, patch: Partial<PortfolioTrade>): PortfolioTrade[] {
  const current = portfolioTradesForMutation();
  const trades = current.map(trade => {
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
  return savePortfolioTrades(trades).status === 'ok' ? trades : current;
}

export function deletePortfolioTrade(id: string): PortfolioTrade[] {
  const current = portfolioTradesForMutation();
  const trades = current.filter(trade => trade.id !== id);
  return savePortfolioTrades(trades).status === 'ok' ? trades : current;
}
import {
  DurableStorageReadError,
  isRecord,
  normalizeEnvelopeTimestamp,
  parseStoredJson,
  serializeAndValidate,
  stableJsonEqual,
  type DurableStateEnvelope,
  type StorageLike,
  type StorageReadResult,
  type StorageWriteResult,
} from './durableStorage.ts';

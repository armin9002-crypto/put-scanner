export type WatchlistOptionType = 'put';
export type WatchlistStatus = 'saved' | 'live' | 'stale' | 'expired' | 'unavailable' | 'refresh_failed';

export interface WatchlistSnapshot {
  underlyingPrice?: number | null;
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
  lastTradeDate?: number | null;
  delta?: number | null;
  iv?: number | null;
  dte?: number | null;
  volume?: number | null;
  openInterest?: number | null;
  nominalYieldBid?: number | null;
  annualizedYieldBid?: number | null;
  annualizedYieldAsk?: number | null;
  moneynessPct?: number | null;
  moneynessLabel?: string | null;
}

export interface WatchlistItem {
  id: string;
  ticker: string;
  expiry: string; // ISO date string "2026-07-17"
  expiryTimestamp: number; // Unix seconds, UTC midnight
  expiryFormatted: string;
  strike: number;
  optionType: WatchlistOptionType;
  addedAt: number;
  savedAt: number;
  updatedAt?: number;
  note: string;
  status?: WatchlistStatus;
  snapshot?: WatchlistSnapshot;
}

export const WATCHLIST_STORAGE_KEY = 'put_scanner_watchlist';
export const LEGACY_WATCHLIST_STORAGE_KEY = 'watchlist';
export const WATCHLIST_DURABLE_SCHEMA_VERSION = 1 as const;

export function isPastWatchlistExpirationDte(dte: number | null | undefined): boolean {
  return typeof dte === 'number' && Number.isFinite(dte) && dte < 0;
}

export type DurableWatchlistItem = Omit<WatchlistItem, 'snapshot' | 'status' | 'updatedAt'>;

export interface WatchlistLocalState {
  updatedAt?: number;
  status?: WatchlistStatus;
  snapshot?: WatchlistSnapshot;
}

export interface WatchlistStorageEnvelopeV1 extends DurableStateEnvelope<DurableWatchlistItem[], 1> {
  localState?: Record<string, WatchlistLocalState>;
}

export interface WatchlistMigrationResult {
  data: DurableWatchlistItem[];
  localState: Record<string, WatchlistLocalState>;
}

function getStorage(): StorageLike | null {
  return getAccountStateStorage();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeTicker(value: unknown): string {
  return String(value ?? '').trim().toUpperCase();
}

function normalizeStrike(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

function isoFromTimestamp(timestamp: number): string {
  return new Date(timestamp * 1000).toISOString().split('T')[0];
}

function timestampFromIso(iso: string): number | null {
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const [, year, month, day] = match;
  return Math.floor(Date.UTC(Number(year), Number(month) - 1, Number(day)) / 1000);
}

function normalizeExpiration(value: unknown, fallbackTimestamp?: unknown): { iso: string; timestamp: number } | null {
  if (isFiniteNumber(fallbackTimestamp) && fallbackTimestamp > 0) {
    return { iso: isoFromTimestamp(fallbackTimestamp), timestamp: fallbackTimestamp };
  }

  if (isFiniteNumber(value) && value > 0) {
    return { iso: isoFromTimestamp(value), timestamp: value };
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    if (Number.isFinite(numeric) && numeric > 0) {
      return { iso: isoFromTimestamp(numeric), timestamp: numeric };
    }
    const timestamp = timestampFromIso(trimmed);
    if (timestamp != null) return { iso: trimmed, timestamp };
  }

  return null;
}

function formatExpiryLabel(iso: string): string {
  const [year, month, day] = iso.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const monthDay = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return `${monthDay} '${String(year % 100).padStart(2, '0')}`;
}

function strikeKey(strike: number): string {
  return Number(strike.toFixed(4)).toString();
}

export function getOptionContractKey({
  ticker,
  optionType = 'put',
  expiration,
  strike,
}: {
  ticker: string;
  optionType?: WatchlistOptionType;
  expiration: string | number;
  strike: number;
}): string {
  const exp = normalizeExpiration(expiration);
  const expiry = exp?.iso ?? String(expiration);
  return `${normalizeTicker(ticker)}|${optionType}|${expiry}|${strikeKey(strike)}`;
}

export function makeWatchlistId(ticker: string, expiry: string | number, strike: number): string {
  return getOptionContractKey({ ticker, optionType: 'put', expiration: expiry, strike });
}

function normalizeSnapshot(value: unknown): WatchlistSnapshot | undefined {
  if (!isRecord(value)) return undefined;
  const snapshot: WatchlistSnapshot = {};
  const numericFields: (keyof WatchlistSnapshot)[] = [
    'underlyingPrice',
    'bid',
    'ask',
    'last',
    'lastTradeDate',
    'delta',
    'iv',
    'dte',
    'volume',
    'openInterest',
    'nominalYieldBid',
    'annualizedYieldBid',
    'annualizedYieldAsk',
    'moneynessPct',
  ];

  numericFields.forEach(field => {
    const raw = value[field];
    if (raw == null) {
      snapshot[field] = null as never;
    } else if (isFiniteNumber(raw)) {
      snapshot[field] = raw as never;
    }
  });

  if (typeof value.moneynessLabel === 'string') {
    snapshot.moneynessLabel = value.moneynessLabel;
  }

  return Object.keys(snapshot).length > 0 ? snapshot : undefined;
}

export function normalizeWatchlistItem(
  value: unknown,
  options: { fillMissingTimestamps?: boolean; timestampForMissingFields?: number } = {},
): WatchlistItem | null {
  if (!isRecord(value)) return null;

  const ticker = normalizeTicker(value.ticker);
  const strike = normalizeStrike(value.strike);
  const expiration = normalizeExpiration(value.expiry ?? value.expiration ?? value.expirationDate, value.expiryTimestamp);
  if (!ticker || strike == null || !expiration) return null;
  if (value.optionType !== undefined && value.optionType !== 'put') return null;

  const optionType: WatchlistOptionType = 'put';
  const id = getOptionContractKey({ ticker, optionType, expiration: expiration.iso, strike });
  const fillMissingTimestamps = options.fillMissingTimestamps !== false;
  const fallbackTimestamp = options.timestampForMissingFields ?? Date.now();
  const addedAt = isFiniteNumber(value.addedAt) ? value.addedAt : fillMissingTimestamps ? fallbackTimestamp : null;
  const savedAt = isFiniteNumber(value.savedAt) ? value.savedAt : addedAt;
  if (addedAt == null || savedAt == null) return null;
  const note = typeof value.note === 'string' ? value.note : '';
  const validStatuses: WatchlistStatus[] = ['saved', 'live', 'stale', 'expired', 'unavailable', 'refresh_failed'];
  if (value.status !== undefined && (typeof value.status !== 'string' || !validStatuses.includes(value.status as WatchlistStatus))) return null;
  const status = typeof value.status === 'string' ? value.status as WatchlistStatus : 'saved';

  return {
    id,
    ticker,
    expiry: expiration.iso,
    expiryTimestamp: expiration.timestamp,
    expiryFormatted: typeof value.expiryFormatted === 'string' && value.expiryFormatted
      ? value.expiryFormatted
      : formatExpiryLabel(expiration.iso),
    strike,
    optionType,
    addedAt,
    savedAt,
    updatedAt: isFiniteNumber(value.updatedAt) ? value.updatedAt : undefined,
    note,
    status,
    snapshot: normalizeSnapshot(value.snapshot),
  };
}

function completenessScore(item: WatchlistItem): number {
  if (!item.snapshot) return 0;
  return Object.values(item.snapshot).filter(value => value !== null && value !== undefined && value !== '').length;
}

export function dedupeWatchlistItems(items: WatchlistItem[]): WatchlistItem[] {
  const byId = new Map<string, WatchlistItem>();

  items.forEach(item => {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      return;
    }

    const itemScore = completenessScore(item);
    const existingScore = completenessScore(existing);
    const itemFreshness = item.updatedAt ?? item.savedAt ?? item.addedAt;
    const existingFreshness = existing.updatedAt ?? existing.savedAt ?? existing.addedAt;
    const snapshotSource = itemScore > existingScore || (itemScore === existingScore && itemFreshness >= existingFreshness)
      ? item
      : existing;

    byId.set(item.id, {
      ...snapshotSource,
      note: item.note || existing.note || '',
      addedAt: Math.min(item.addedAt, existing.addedAt),
      savedAt: Math.min(item.savedAt, existing.savedAt),
      updatedAt: Math.max(item.updatedAt ?? 0, existing.updatedAt ?? 0) || undefined,
    });
  });

  return [...byId.values()];
}

export function toDurableWatchlistItem(item: WatchlistItem): DurableWatchlistItem {
  const durable: Partial<WatchlistItem> = { ...item };
  delete durable.snapshot;
  delete durable.status;
  delete durable.updatedAt;
  return durable as DurableWatchlistItem;
}

export function toDurableWatchlistState(items: WatchlistItem[]): DurableWatchlistItem[] {
  return items.map(toDurableWatchlistItem);
}

function watchlistLocalState(items: WatchlistItem[]): Record<string, WatchlistLocalState> {
  return Object.fromEntries(items.flatMap(item => {
    const local: WatchlistLocalState = {
      ...(item.updatedAt !== undefined ? { updatedAt: item.updatedAt } : {}),
      ...(item.status !== undefined ? { status: item.status } : {}),
      ...(item.snapshot !== undefined ? { snapshot: item.snapshot } : {}),
    };
    return Object.keys(local).length > 0 ? [[item.id, local]] : [];
  }));
}

export function hydrateRuntimeWatchlist(
  durableState: DurableWatchlistItem[],
  localState: Record<string, WatchlistLocalState> = {},
): WatchlistItem[] {
  return durableState.map(item => ({ ...item, ...(localState[item.id] ?? {}) }));
}

export type WatchlistStateMigrationOutcome =
  | { status: 'ok'; state: WatchlistMigrationResult }
  | { status: 'error'; error: string }
  | { status: 'unsupported_version'; version: number };

export function migrateWatchlistState(
  inputVersion: number,
  value: unknown,
  options: { timestampForMissingFields?: number } = {},
): WatchlistStateMigrationOutcome {
  if (inputVersion !== 0 && inputVersion !== WATCHLIST_DURABLE_SCHEMA_VERSION) {
    return { status: 'unsupported_version', version: inputVersion };
  }
  if (!Array.isArray(value)) return { status: 'error', error: 'Watchlist data must be an array.' };

  const data: DurableWatchlistItem[] = [];
  const localState: Record<string, WatchlistLocalState> = {};
  const ids = new Set<string>();

  for (let index = 0; index < value.length; index += 1) {
    const original = value[index];
    if (!isRecord(original)) return { status: 'error', error: `Watchlist item ${index} is not an object.` };
    if (inputVersion === WATCHLIST_DURABLE_SCHEMA_VERSION
      && ('snapshot' in original || 'status' in original || 'updatedAt' in original)) {
      return { status: 'error', error: `Watchlist item ${index} contains transient quote state in the durable payload.` };
    }
    if (inputVersion === WATCHLIST_DURABLE_SCHEMA_VERSION
      && (typeof original.id !== 'string'
        || typeof original.note !== 'string'
        || !isFiniteNumber(original.addedAt)
        || !isFiniteNumber(original.savedAt))) {
      return { status: 'error', error: `Watchlist item ${index} is missing durable identity metadata.` };
    }

    const normalized = normalizeWatchlistItem(original, {
      fillMissingTimestamps: options.timestampForMissingFields !== undefined,
      timestampForMissingFields: options.timestampForMissingFields,
    });
    if (!normalized) return { status: 'error', error: `Watchlist item ${index} is structurally invalid.` };
    if (typeof original.id === 'string' && original.id.trim() && original.id !== normalized.id) {
      return { status: 'error', error: `Watchlist item ${index} has an id that does not match its contract identity.` };
    }
    if (ids.has(normalized.id)) return { status: 'error', error: `Watchlist item id ${normalized.id} is duplicated.` };
    ids.add(normalized.id);
    data.push(toDurableWatchlistItem(normalized));

    if (inputVersion === 0) {
      const local: WatchlistLocalState = {
        ...(normalized.updatedAt !== undefined ? { updatedAt: normalized.updatedAt } : {}),
        ...(normalized.status !== undefined ? { status: normalized.status } : {}),
        ...(normalized.snapshot !== undefined ? { snapshot: normalized.snapshot } : {}),
      };
      if (Object.keys(local).length > 0) localState[normalized.id] = local;
    }
  }

  return { status: 'ok', state: { data, localState } };
}

function normalizeWatchlistLocalState(value: unknown): Record<string, WatchlistLocalState> | null {
  if (value === undefined) return {};
  if (!isRecord(value)) return null;
  const validStatuses: WatchlistStatus[] = ['saved', 'live', 'stale', 'expired', 'unavailable', 'refresh_failed'];
  const normalized: Record<string, WatchlistLocalState> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!isRecord(raw)) return null;
    if (raw.status !== undefined && (typeof raw.status !== 'string' || !validStatuses.includes(raw.status as WatchlistStatus))) return null;
    if (raw.updatedAt !== undefined && !isFiniteNumber(raw.updatedAt)) return null;
    if (raw.snapshot !== undefined && !isRecord(raw.snapshot)) return null;
    normalized[id] = {
      ...(isFiniteNumber(raw.updatedAt) ? { updatedAt: raw.updatedAt } : {}),
      ...(typeof raw.status === 'string' ? { status: raw.status as WatchlistStatus } : {}),
      ...(raw.snapshot !== undefined ? { snapshot: normalizeSnapshot(raw.snapshot) } : {}),
    };
  }
  return normalized;
}

function validateWatchlistEnvelope(value: unknown): WatchlistStorageEnvelopeV1 {
  if (!isRecord(value) || value.schemaVersion !== WATCHLIST_DURABLE_SCHEMA_VERSION) {
    throw new Error('Watchlist storage envelope is invalid.');
  }
  const updatedAt = normalizeEnvelopeTimestamp(value.updatedAt);
  if (updatedAt === undefined || !Number.isInteger(value.revision) || Number(value.revision) < 0) {
    throw new Error('Watchlist storage metadata is invalid.');
  }
  const migrated = migrateWatchlistState(WATCHLIST_DURABLE_SCHEMA_VERSION, value.data);
  if (migrated.status !== 'ok') {
    throw new Error(migrated.status === 'error' ? migrated.error : 'Watchlist schema is unsupported.');
  }
  const localState = normalizeWatchlistLocalState(value.localState);
  if (localState == null) throw new Error('Watchlist local quote state is invalid.');
  return {
    schemaVersion: WATCHLIST_DURABLE_SCHEMA_VERSION,
    updatedAt,
    revision: Number(value.revision),
    data: migrated.state.data,
    ...(Object.keys(localState).length > 0 ? { localState } : {}),
  };
}

export function createWatchlistStorageEnvelope(
  data: DurableWatchlistItem[],
  metadata: { updatedAt: string | null; revision: number },
  localState: Record<string, WatchlistLocalState> = {},
): WatchlistStorageEnvelopeV1 {
  return validateWatchlistEnvelope({
    schemaVersion: WATCHLIST_DURABLE_SCHEMA_VERSION,
    updatedAt: metadata.updatedAt,
    revision: metadata.revision,
    data,
    ...(Object.keys(localState).length > 0 ? { localState } : {}),
  });
}

export function serializeWatchlistStorageEnvelope(envelope: WatchlistStorageEnvelopeV1):
  | { status: 'ok'; serialized: string }
  | { status: 'error'; error: string } {
  return serializeAndValidate(envelope, value => { validateWatchlistEnvelope(value); });
}

export function readWatchlist(storage: StorageLike | null = getStorage()): StorageReadResult<WatchlistItem[]> {
  if (!storage) return { status: 'corrupt', error: 'Watchlist storage is unavailable.' };
  let rawValue: string | null;
  try {
    const primary = storage.getItem(WATCHLIST_STORAGE_KEY);
    rawValue = primary !== null ? primary : storage.getItem(LEGACY_WATCHLIST_STORAGE_KEY);
  } catch (error) {
    return { status: 'corrupt', error: error instanceof Error ? error.message : 'Watchlist storage could not be read.' };
  }
  if (rawValue === null) return { status: 'missing' };

  const parsed = parseStoredJson(rawValue, 'Watchlist storage');
  if (parsed.status === 'corrupt') return parsed;
  if (Array.isArray(parsed.value)) {
    const migrated = migrateWatchlistState(0, parsed.value);
    if (migrated.status !== 'ok') {
      return migrated.status === 'unsupported_version'
        ? { status: 'unsupported_version', version: migrated.version, rawValue }
        : { status: 'corrupt', error: `${migrated.error} The original value was preserved.`, rawValue };
    }
    return {
      status: 'ok',
      data: hydrateRuntimeWatchlist(migrated.state.data, migrated.state.localState),
      schemaVersion: 0,
      source: 'legacy',
      updatedAt: null,
      revision: 0,
    };
  }

  if (!isRecord(parsed.value) || typeof parsed.value.schemaVersion !== 'number') {
    return { status: 'corrupt', error: 'Watchlist storage has an unexpected root value. The original value was preserved.', rawValue };
  }
  if (parsed.value.schemaVersion !== WATCHLIST_DURABLE_SCHEMA_VERSION) {
    return { status: 'unsupported_version', version: parsed.value.schemaVersion, rawValue };
  }
  try {
    const envelope = validateWatchlistEnvelope(parsed.value);
    return {
      status: 'ok',
      data: hydrateRuntimeWatchlist(envelope.data, envelope.localState),
      schemaVersion: envelope.schemaVersion,
      source: 'canonical',
      updatedAt: envelope.updatedAt,
      revision: envelope.revision,
    };
  } catch (error) {
    return {
      status: 'corrupt',
      error: `${error instanceof Error ? error.message : 'Watchlist storage is invalid.'} The original value was preserved.`,
      rawValue,
    };
  }
}

export function getWatchlist(): WatchlistItem[] {
  const result = readWatchlist();
  if (result.status === 'ok') return result.data;
  if (result.status === 'missing') return [];
  throw new DurableStorageReadError(result);
}

export function writeWatchlist(
  storage: StorageLike,
  items: WatchlistItem[],
  options: { now?: Date } = {},
): StorageWriteResult {
  const migrated = migrateWatchlistState(0, items);
  if (migrated.status !== 'ok') {
    return { status: 'error', error: migrated.status === 'error' ? migrated.error : 'Watchlist schema is unsupported.' };
  }
  const current = readWatchlist(storage);
  if (current.status === 'corrupt') return { status: 'error', error: current.error };
  if (current.status === 'unsupported_version') {
    return { status: 'error', error: `Watchlist schema version ${current.version} is unsupported.` };
  }

  const previousDurable = current.status === 'ok' ? toDurableWatchlistState(current.data) : null;
  const previousLocal = current.status === 'ok' ? watchlistLocalState(current.data) : null;
  const durableChanged = previousDurable === null || !stableJsonEqual(previousDurable, migrated.state.data);
  const localChanged = previousLocal === null || !stableJsonEqual(previousLocal, migrated.state.localState);
  if (!durableChanged && !localChanged) return { status: 'ok', written: false };

  const priorRevision = current.status === 'ok' ? current.revision : 0;
  const envelope = createWatchlistStorageEnvelope(migrated.state.data, {
    updatedAt: durableChanged ? (options.now ?? new Date()).toISOString() : current.status === 'ok' ? current.updatedAt : null,
    revision: durableChanged ? priorRevision + 1 : priorRevision,
  }, migrated.state.localState);
  const serialized = serializeWatchlistStorageEnvelope(envelope);
  if (serialized.status === 'error') return serialized;

  try {
    storage.setItem(WATCHLIST_STORAGE_KEY, serialized.serialized);
    if (durableChanged) emitDurableMutation('watchlist');
    return { status: 'ok', written: true };
  } catch (error) {
    return { status: 'error', error: error instanceof Error ? error.message : 'Watchlist storage could not be written.' };
  }
}

export function saveWatchlist(items: WatchlistItem[]): StorageWriteResult {
  const storage = getStorage();
  const result: StorageWriteResult = storage ? writeWatchlist(storage, items) : { status: 'error', error: 'Watchlist storage is unavailable.' };
  return result;
}

function watchlistItemsForMutation(): WatchlistItem[] {
  const result = readWatchlist();
  if (result.status === 'ok') return result.data;
  if (result.status === 'missing') return [];
  throw new DurableStorageReadError(result);
}

export function addToWatchlist(item: WatchlistItem): WatchlistItem[] {
  const items = watchlistItemsForMutation();
  const normalized = normalizeWatchlistItem(item);
  if (!normalized) return items;
  const existing = items.find(existingItem => existingItem.id === normalized.id);
  const updated = existing
    ? items.map(existingItem => existingItem.id === normalized.id
      ? { ...normalized, note: existingItem.note, addedAt: existingItem.addedAt, savedAt: existingItem.savedAt }
      : existingItem)
    : [...items, normalized];
  return saveWatchlist(updated).status === 'ok' ? updated : items;
}

export function updateWatchlistItem(item: WatchlistItem): WatchlistItem[] {
  const items = watchlistItemsForMutation();
  const normalized = normalizeWatchlistItem(item);
  if (!normalized) return items;
  const updated = items.map(existing => existing.id === normalized.id
    ? { ...normalized, note: existing.note, addedAt: existing.addedAt, savedAt: existing.savedAt }
    : existing);
  return saveWatchlist(updated).status === 'ok' ? updated : items;
}

export function removeFromWatchlist(id: string): WatchlistItem[] {
  const items = watchlistItemsForMutation();
  const updated = items.filter(item => item.id !== id);
  return saveWatchlist(updated).status === 'ok' ? updated : items;
}

export function isInWatchlist(id: string): boolean {
  return getWatchlist().some(item => item.id === id);
}

export function updateWatchlistNote(id: string, note: string): WatchlistItem[] {
  const items = watchlistItemsForMutation();
  const updated = items.map(item => item.id === id ? { ...item, note } : item);
  return saveWatchlist(updated).status === 'ok' ? updated : items;
}

export function mergeWatchlistRefreshItems(existing: WatchlistItem[], updatedItems: WatchlistItem[]): WatchlistItem[] {
  const byId = new Map(existing.map(item => [item.id, item]));
  updatedItems.forEach(item => {
    const normalized = normalizeWatchlistItem(item);
    if (!normalized) return;
    const previous = byId.get(normalized.id);
    // A quote refresh is not an add operation. If the contract was removed
    // while its request was in flight, never resurrect the stale snapshot.
    if (!previous) return;
    byId.set(normalized.id, {
      ...normalized,
      note: previous.note,
      addedAt: previous.addedAt,
      savedAt: previous.savedAt,
    });
  });
  return [...byId.values()];
}

export function markWatchlistItems(updatedItems: WatchlistItem[]): WatchlistItem[] {
  const existing = watchlistItemsForMutation();
  const updated = mergeWatchlistRefreshItems(existing, updatedItems);
  return saveWatchlist(updated).status === 'ok' ? updated : existing;
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
import { emitDurableMutation } from './cloudState/syncEvents.ts';
import { getAccountStateStorage } from './cloudState/accountStateStorage.ts';

export type WatchlistOptionType = 'put';
export type WatchlistStatus = 'saved' | 'live' | 'stale' | 'expired' | 'unavailable' | 'refresh_failed';

export interface WatchlistSnapshot {
  underlyingPrice?: number | null;
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
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

const STORAGE_KEY = 'put_scanner_watchlist';
const LEGACY_STORAGE_KEY = 'watchlist';

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

export function normalizeWatchlistItem(value: unknown): WatchlistItem | null {
  if (!isRecord(value)) return null;

  const ticker = normalizeTicker(value.ticker);
  const strike = normalizeStrike(value.strike);
  const expiration = normalizeExpiration(value.expiry ?? value.expiration ?? value.expirationDate, value.expiryTimestamp);
  if (!ticker || strike == null || !expiration) return null;

  const optionType: WatchlistOptionType = 'put';
  const id = getOptionContractKey({ ticker, optionType, expiration: expiration.iso, strike });
  const addedAt = isFiniteNumber(value.addedAt) ? value.addedAt : Date.now();
  const savedAt = isFiniteNumber(value.savedAt) ? value.savedAt : addedAt;
  const note = typeof value.note === 'string' ? value.note : '';
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

function readRawItems(storage: Storage): unknown[] {
  const raw = storage.getItem(STORAGE_KEY) ?? storage.getItem(LEGACY_STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveWatchlist(items: WatchlistItem[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    const normalized = dedupeWatchlistItems(items.map(normalizeWatchlistItem).filter(Boolean) as WatchlistItem[]);
    storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    storage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // localStorage may be unavailable or full.
  }
}

export function getWatchlist(): WatchlistItem[] {
  const storage = getStorage();
  if (!storage) return [];
  const normalized = dedupeWatchlistItems(readRawItems(storage).map(normalizeWatchlistItem).filter(Boolean) as WatchlistItem[]);
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(normalized));
    storage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    // Best-effort migration only.
  }
  return normalized;
}

export function addToWatchlist(item: WatchlistItem): WatchlistItem[] {
  const normalized = normalizeWatchlistItem(item);
  if (!normalized) return getWatchlist();
  const items = getWatchlist();
  const existing = items.find(existingItem => existingItem.id === normalized.id);
  const updated = existing
    ? items.map(existingItem => existingItem.id === normalized.id
      ? { ...normalized, note: existingItem.note, addedAt: existingItem.addedAt, savedAt: existingItem.savedAt }
      : existingItem)
    : [...items, normalized];
  saveWatchlist(updated);
  return updated;
}

export function updateWatchlistItem(item: WatchlistItem): WatchlistItem[] {
  const normalized = normalizeWatchlistItem(item);
  if (!normalized) return getWatchlist();
  const items = getWatchlist();
  const updated = items.map(existing => existing.id === normalized.id
    ? { ...normalized, note: existing.note, addedAt: existing.addedAt, savedAt: existing.savedAt }
    : existing);
  saveWatchlist(updated);
  return updated;
}

export function removeFromWatchlist(id: string): WatchlistItem[] {
  const items = getWatchlist().filter(item => item.id !== id);
  saveWatchlist(items);
  return items;
}

export function isInWatchlist(id: string): boolean {
  return getWatchlist().some(item => item.id === id);
}

export function updateWatchlistNote(id: string, note: string): WatchlistItem[] {
  const items = getWatchlist().map(item => item.id === id ? { ...item, note } : item);
  saveWatchlist(items);
  return items;
}

export function markWatchlistItems(updatedItems: WatchlistItem[]): WatchlistItem[] {
  const existing = getWatchlist();
  const byId = new Map(existing.map(item => [item.id, item]));
  updatedItems.forEach(item => {
    const normalized = normalizeWatchlistItem(item);
    if (!normalized) return;
    const previous = byId.get(normalized.id);
    byId.set(normalized.id, previous
      ? { ...normalized, note: previous.note, addedAt: previous.addedAt, savedAt: previous.savedAt }
      : normalized);
  });
  const updated = [...byId.values()];
  saveWatchlist(updated);
  return updated;
}

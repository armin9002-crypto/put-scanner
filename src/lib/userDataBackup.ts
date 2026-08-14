import { SHOW_NOMINAL_YIELD_KEY } from './optionTablePreferences.ts';
import { PORTFOLIO_MARK_BASIS_KEY, PORTFOLIO_MARK_BASIS_OPTIONS } from './portfolioMarkPreference.ts';
import {
  PORTFOLIO_EXPIRY_GROUPS_KEY,
  PORTFOLIO_GROUP_MODE_KEY,
  PORTFOLIO_UNDERLYING_GROUPS_KEY,
  type PortfolioGroupMode,
} from './portfolioSchedulePreferences.ts';
import { normalizePortfolioTrade, PORTFOLIO_STORAGE_KEY, type PortfolioTrade } from './portfolioStorage.ts';
import {
  LEGACY_THEME_STORAGE_KEY,
  normalizeSavedTheme,
  THEME_MIGRATION_KEY,
  THEME_MIGRATION_VERSION,
  THEME_STORAGE_KEY,
  type Theme,
} from './themePreference.ts';
import {
  LEGACY_WATCHLIST_STORAGE_KEY,
  normalizeWatchlistItem,
  WATCHLIST_STORAGE_KEY,
  type WatchlistItem,
} from './watchlist.ts';

export const PUT_SCANNER_BACKUP_FORMAT = 'put-scanner-backup';
export const PUT_SCANNER_BACKUP_SCHEMA_VERSION = 1;

export interface BackupStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type DurablePortfolioTrade = Omit<PortfolioTrade, 'latestMarketData'>;
export type DurableWatchlistItem = Omit<WatchlistItem, 'snapshot' | 'status' | 'updatedAt'>;

export interface BackupPreferences {
  theme?: Theme;
  portfolioMarkBasis?: 'last' | 'bid' | 'ask';
  portfolioGroupMode?: PortfolioGroupMode;
  collapsedExpirationGroups?: Record<string, boolean>;
  collapsedUnderlyingGroups?: Record<string, boolean>;
  showNominalYield?: boolean;
}

export interface PutScannerBackup {
  format: typeof PUT_SCANNER_BACKUP_FORMAT;
  schemaVersion: typeof PUT_SCANNER_BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  appVersion: string;
  data: {
    portfolio: DurablePortfolioTrade[];
    watchlist: DurableWatchlistItem[];
    preferences: BackupPreferences;
  };
}

export interface BackupSummary {
  openPositions: number;
  historicalPositions: number;
  watchlistItems: number;
  preferencesIncluded: boolean;
  exportedAt: string;
}

export class UserDataBackupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserDataBackupError';
  }
}

const THEMES: Theme[] = ['dark', 'dark-blue', 'light', 'sepia'];
const GROUP_MODES: PortfolioGroupMode[] = ['expiration', 'underlying', 'none'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readStoredArray(storage: BackupStorage, primaryKey: string, legacyKey?: string): unknown[] {
  const raw = storage.getItem(primaryKey) ?? (legacyKey ? storage.getItem(legacyKey) : null);
  if (raw == null) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new UserDataBackupError(`Stored data in ${primaryKey} is not an array.`);
    return parsed;
  } catch (error) {
    if (error instanceof UserDataBackupError) throw error;
    throw new UserDataBackupError(`Stored data in ${primaryKey} is corrupted. Export was stopped to avoid creating an incomplete backup.`);
  }
}

function durablePortfolioTrade(trade: PortfolioTrade): DurablePortfolioTrade {
  const copy: Partial<PortfolioTrade> = { ...trade };
  delete copy.latestMarketData;
  return copy as DurablePortfolioTrade;
}

function durableWatchlistItem(item: WatchlistItem): DurableWatchlistItem {
  const copy: Partial<WatchlistItem> = { ...item };
  delete copy.snapshot;
  delete copy.status;
  delete copy.updatedAt;
  return copy as DurableWatchlistItem;
}

function validatePortfolio(value: unknown, context: string): DurablePortfolioTrade[] {
  if (!Array.isArray(value)) throw new UserDataBackupError(`${context} must be an array.`);
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim()) {
      throw new UserDataBackupError(`${context}[${index}] is missing a trade id.`);
    }
    if (typeof entry.createdAt !== 'string' || typeof entry.updatedAt !== 'string') {
      throw new UserDataBackupError(`${context}[${index}] is missing trade timestamps.`);
    }
    const normalized = normalizePortfolioTrade(entry);
    if (!normalized) throw new UserDataBackupError(`${context}[${index}] is not a valid put trade.`);
    return durablePortfolioTrade(normalized);
  });
}

function validateWatchlist(value: unknown, context: string): DurableWatchlistItem[] {
  if (!Array.isArray(value)) throw new UserDataBackupError(`${context} must be an array.`);
  return value.map((entry, index) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim()) {
      throw new UserDataBackupError(`${context}[${index}] is missing a watchlist id.`);
    }
    if (typeof entry.note !== 'string' || typeof entry.addedAt !== 'number' || typeof entry.savedAt !== 'number') {
      throw new UserDataBackupError(`${context}[${index}] is missing watchlist metadata.`);
    }
    const normalized = normalizeWatchlistItem(entry);
    if (!normalized) throw new UserDataBackupError(`${context}[${index}] is not a valid saved contract.`);
    return durableWatchlistItem(normalized);
  });
}

function booleanRecord(value: unknown, context: string): Record<string, boolean> {
  if (!isRecord(value) || Object.values(value).some(entry => typeof entry !== 'boolean')) {
    throw new UserDataBackupError(`${context} must contain only boolean values.`);
  }
  return { ...value } as Record<string, boolean>;
}

function validatePreferences(value: unknown): BackupPreferences {
  if (value == null) return {};
  if (!isRecord(value)) throw new UserDataBackupError('data.preferences must be an object when present.');
  const preferences: BackupPreferences = {};

  if (value.theme !== undefined) {
    if (!THEMES.includes(value.theme as Theme)) throw new UserDataBackupError('data.preferences.theme is invalid.');
    preferences.theme = value.theme as Theme;
  }
  if (value.portfolioMarkBasis !== undefined) {
    if (!PORTFOLIO_MARK_BASIS_OPTIONS.includes(value.portfolioMarkBasis as 'last' | 'bid' | 'ask')) {
      throw new UserDataBackupError('data.preferences.portfolioMarkBasis is invalid.');
    }
    preferences.portfolioMarkBasis = value.portfolioMarkBasis as 'last' | 'bid' | 'ask';
  }
  if (value.portfolioGroupMode !== undefined) {
    if (!GROUP_MODES.includes(value.portfolioGroupMode as PortfolioGroupMode)) {
      throw new UserDataBackupError('data.preferences.portfolioGroupMode is invalid.');
    }
    preferences.portfolioGroupMode = value.portfolioGroupMode as PortfolioGroupMode;
  }
  if (value.collapsedExpirationGroups !== undefined) {
    preferences.collapsedExpirationGroups = booleanRecord(value.collapsedExpirationGroups, 'data.preferences.collapsedExpirationGroups');
  }
  if (value.collapsedUnderlyingGroups !== undefined) {
    preferences.collapsedUnderlyingGroups = booleanRecord(value.collapsedUnderlyingGroups, 'data.preferences.collapsedUnderlyingGroups');
  }
  if (value.showNominalYield !== undefined) {
    if (typeof value.showNominalYield !== 'boolean') throw new UserDataBackupError('data.preferences.showNominalYield must be a boolean.');
    preferences.showNominalYield = value.showNominalYield;
  }
  return preferences;
}

function parseBooleanRecordPreference(raw: string | null): Record<string, boolean> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return isRecord(parsed)
      ? Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'))
      : {};
  } catch {
    return {};
  }
}

function readTheme(storage: BackupStorage): Theme {
  const migrated = storage.getItem(THEME_MIGRATION_KEY) === THEME_MIGRATION_VERSION;
  const current = normalizeSavedTheme(storage.getItem(THEME_STORAGE_KEY), true);
  if (current) return current;
  const legacy = normalizeSavedTheme(storage.getItem(LEGACY_THEME_STORAGE_KEY), migrated);
  if (legacy) return legacy;
  return 'dark';
}

function readPreferences(storage: BackupStorage): BackupPreferences {
  const markBasis = storage.getItem(PORTFOLIO_MARK_BASIS_KEY);
  const groupMode = storage.getItem(PORTFOLIO_GROUP_MODE_KEY);
  return {
    theme: readTheme(storage),
    portfolioMarkBasis: PORTFOLIO_MARK_BASIS_OPTIONS.includes(markBasis as 'last' | 'bid' | 'ask')
      ? markBasis as 'last' | 'bid' | 'ask'
      : 'ask',
    portfolioGroupMode: GROUP_MODES.includes(groupMode as PortfolioGroupMode)
      ? groupMode as PortfolioGroupMode
      : 'expiration',
    collapsedExpirationGroups: parseBooleanRecordPreference(storage.getItem(PORTFOLIO_EXPIRY_GROUPS_KEY)),
    collapsedUnderlyingGroups: parseBooleanRecordPreference(storage.getItem(PORTFOLIO_UNDERLYING_GROUPS_KEY)),
    showNominalYield: storage.getItem(SHOW_NOMINAL_YIELD_KEY) === 'true',
  };
}

export function createPutScannerBackup(
  storage: BackupStorage,
  options: { now?: Date; appVersion?: string } = {},
): PutScannerBackup {
  const portfolio = validatePortfolio(readStoredArray(storage, PORTFOLIO_STORAGE_KEY), 'stored portfolio');
  const watchlist = validateWatchlist(
    readStoredArray(storage, WATCHLIST_STORAGE_KEY, LEGACY_WATCHLIST_STORAGE_KEY),
    'stored watchlist',
  );
  const now = options.now ?? new Date();
  return {
    format: PUT_SCANNER_BACKUP_FORMAT,
    schemaVersion: PUT_SCANNER_BACKUP_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    appVersion: options.appVersion?.trim() || '0.0.0',
    data: {
      portfolio,
      watchlist,
      preferences: readPreferences(storage),
    },
  };
}

export function validatePutScannerBackup(value: unknown): PutScannerBackup {
  if (!isRecord(value)) throw new UserDataBackupError('Backup must be a JSON object.');
  if (value.format !== PUT_SCANNER_BACKUP_FORMAT) throw new UserDataBackupError('This file is not a Put Scanner backup.');
  if (typeof value.schemaVersion !== 'number') throw new UserDataBackupError('Backup schemaVersion is missing.');
  if (value.schemaVersion > PUT_SCANNER_BACKUP_SCHEMA_VERSION) {
    throw new UserDataBackupError(`Backup schema version ${value.schemaVersion} is newer than this app supports.`);
  }
  if (value.schemaVersion !== PUT_SCANNER_BACKUP_SCHEMA_VERSION) {
    throw new UserDataBackupError(`Backup schema version ${value.schemaVersion} is not supported.`);
  }
  if (typeof value.exportedAt !== 'string' || Number.isNaN(Date.parse(value.exportedAt))) {
    throw new UserDataBackupError('Backup exportedAt is invalid.');
  }
  if (typeof value.appVersion !== 'string' || !value.appVersion.trim()) {
    throw new UserDataBackupError('Backup appVersion is invalid.');
  }
  if (!isRecord(value.data)) throw new UserDataBackupError('Backup data is missing.');

  return {
    format: PUT_SCANNER_BACKUP_FORMAT,
    schemaVersion: PUT_SCANNER_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date(value.exportedAt).toISOString(),
    appVersion: value.appVersion,
    data: {
      portfolio: validatePortfolio(value.data.portfolio, 'data.portfolio'),
      watchlist: validateWatchlist(value.data.watchlist, 'data.watchlist'),
      preferences: validatePreferences(value.data.preferences),
    },
  };
}

export function parsePutScannerBackup(text: string): PutScannerBackup {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new UserDataBackupError('The selected file is not valid JSON. No data was changed.');
  }
  return validatePutScannerBackup(parsed);
}

function importWrites(backup: PutScannerBackup): Array<[string, string]> {
  const writes: Array<[string, string]> = [
    [PORTFOLIO_STORAGE_KEY, JSON.stringify(backup.data.portfolio)],
    [WATCHLIST_STORAGE_KEY, JSON.stringify(backup.data.watchlist)],
  ];
  const preferences = backup.data.preferences;
  if (preferences.theme !== undefined) {
    writes.push([THEME_STORAGE_KEY, preferences.theme]);
    writes.push([LEGACY_THEME_STORAGE_KEY, preferences.theme]);
    writes.push([THEME_MIGRATION_KEY, THEME_MIGRATION_VERSION]);
  }
  if (preferences.portfolioMarkBasis !== undefined) writes.push([PORTFOLIO_MARK_BASIS_KEY, preferences.portfolioMarkBasis]);
  if (preferences.portfolioGroupMode !== undefined) writes.push([PORTFOLIO_GROUP_MODE_KEY, preferences.portfolioGroupMode]);
  if (preferences.collapsedExpirationGroups !== undefined) writes.push([PORTFOLIO_EXPIRY_GROUPS_KEY, JSON.stringify(preferences.collapsedExpirationGroups)]);
  if (preferences.collapsedUnderlyingGroups !== undefined) writes.push([PORTFOLIO_UNDERLYING_GROUPS_KEY, JSON.stringify(preferences.collapsedUnderlyingGroups)]);
  if (preferences.showNominalYield !== undefined) writes.push([SHOW_NOMINAL_YIELD_KEY, String(preferences.showNominalYield)]);
  return writes;
}

export function applyPutScannerBackup(storage: BackupStorage, value: unknown): PutScannerBackup {
  const backup = validatePutScannerBackup(value);
  const writes = importWrites(backup);
  const previous = new Map<string, string | null>();
  writes.forEach(([key]) => previous.set(key, storage.getItem(key)));

  try {
    writes.forEach(([key, content]) => storage.setItem(key, content));
  } catch (error) {
    let rollbackFailed = false;
    [...previous.entries()].reverse().forEach(([key, content]) => {
      try {
        if (content == null) storage.removeItem(key);
        else storage.setItem(key, content);
      } catch {
        rollbackFailed = true;
      }
    });
    if (rollbackFailed) {
      throw new UserDataBackupError('Import failed and browser storage could not be fully restored. Use the pre-import recovery backup.');
    }
    throw new UserDataBackupError(error instanceof Error
      ? `Import failed before completion (${error.message}). Current data was restored.`
      : 'Import failed before completion. Current data was restored.');
  }
  return backup;
}

export function getPutScannerBackupSummary(backup: PutScannerBackup): BackupSummary {
  const openPositions = backup.data.portfolio.filter(trade => trade.status === 'open').length;
  return {
    openPositions,
    historicalPositions: backup.data.portfolio.length - openPositions,
    watchlistItems: backup.data.watchlist.length,
    preferencesIncluded: Object.keys(backup.data.preferences).length > 0,
    exportedAt: backup.exportedAt,
  };
}

export function serializePutScannerBackup(backup: PutScannerBackup): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

export function buildPutScannerBackupFilename(prefix = 'put-scanner-backup', now = new Date()): string {
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part, index) => String(part).padStart(index === 0 ? 4 : 2, '0')).join('-');
  const time = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  return `${prefix}-${date}-${time}.json`;
}

export function downloadPutScannerBackup(backup: PutScannerBackup, prefix = 'put-scanner-backup'): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof Blob === 'undefined') {
    throw new UserDataBackupError('File downloads are unavailable in this browser.');
  }
  const blob = new Blob([serializePutScannerBackup(backup)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildPutScannerBackupFilename(prefix, new Date(backup.exportedAt));
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

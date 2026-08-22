import { SHOW_NOMINAL_YIELD_KEY } from './optionTablePreferences.ts';
import { PORTFOLIO_MARK_BASIS_KEY } from './portfolioMarkPreference.ts';
import {
  PORTFOLIO_EXPIRY_GROUPS_KEY,
  PORTFOLIO_GROUP_MODE_KEY,
  PORTFOLIO_UNDERLYING_GROUPS_KEY,
} from './portfolioSchedulePreferences.ts';
import {
  createPortfolioStorageEnvelope,
  migratePortfolioState,
  PORTFOLIO_STORAGE_KEY,
  readPortfolioTrades,
  serializePortfolioStorageEnvelope,
  toDurablePortfolioState,
  type DurablePortfolioTrade,
} from './portfolioStorage.ts';
import {
  LEGACY_THEME_STORAGE_KEY,
  THEME_MIGRATION_KEY,
  THEME_MIGRATION_VERSION,
  THEME_STORAGE_KEY,
} from './themePreference.ts';
import {
  createWatchlistStorageEnvelope,
  migrateWatchlistState,
  readWatchlist,
  serializeWatchlistStorageEnvelope,
  toDurableWatchlistState,
  WATCHLIST_STORAGE_KEY,
  type DurableWatchlistItem,
} from './watchlist.ts';
import {
  createPreferencesEnvelope,
  migratePreferencesState,
  readDurablePreferences,
  validatePreferencesEnvelope,
  type DurablePreferences,
  type DurablePreferencesEnvelopeV1,
} from './durablePreferences.ts';
import type { DurableStateEnvelope } from './durableStorage.ts';
import { emitDurableMutation } from './cloudState/syncEvents.ts';

export const PUT_SCANNER_BACKUP_FORMAT = 'put-scanner-backup';
export const PUT_SCANNER_BACKUP_SCHEMA_VERSION = 2 as const;

export interface BackupStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type BackupPreferences = DurablePreferences;
export type BackupNamespace<T> = DurableStateEnvelope<T, 1>;

export interface PutScannerBackup {
  format: typeof PUT_SCANNER_BACKUP_FORMAT;
  schemaVersion: typeof PUT_SCANNER_BACKUP_SCHEMA_VERSION;
  exportedAt: string;
  appVersion: string;
  data: {
    portfolio: BackupNamespace<DurablePortfolioTrade[]>;
    watchlist: BackupNamespace<DurableWatchlistItem[]>;
    preferences: DurablePreferencesEnvelopeV1;
  };
}

interface PutScannerBackupV1 {
  format: typeof PUT_SCANNER_BACKUP_FORMAT;
  schemaVersion: 1;
  exportedAt: string;
  appVersion: string;
  data: {
    portfolio: unknown;
    watchlist: unknown;
    preferences: unknown;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validatePortfolio(value: unknown, context: string): DurablePortfolioTrade[] {
  const migrated = migratePortfolioState(1, value);
  if (migrated.status !== 'ok') {
    throw new UserDataBackupError(migrated.status === 'error' ? `${context}: ${migrated.error}` : `${context} has an unsupported schema.`);
  }
  return migrated.state.data;
}

function validateWatchlist(value: unknown, context: string): DurableWatchlistItem[] {
  const migrated = migrateWatchlistState(1, value);
  if (migrated.status !== 'ok') {
    throw new UserDataBackupError(migrated.status === 'error' ? `${context}: ${migrated.error}` : `${context} has an unsupported schema.`);
  }
  return migrated.state.data;
}

function validatePreferences(value: unknown, context = 'data.preferences'): BackupPreferences {
  const migrated = migratePreferencesState(1, value);
  if (migrated.status !== 'ok') {
    throw new UserDataBackupError(migrated.status === 'error' ? `${context}: ${migrated.error}` : `${context} has an unsupported schema.`);
  }
  return migrated.data;
}

function storedReadError(label: string, result: { status: 'corrupt'; error: string } | { status: 'unsupported_version'; version: number }): never {
  throw new UserDataBackupError(result.status === 'corrupt'
    ? `${label} could not be exported: ${result.error}`
    : `${label} uses unsupported schema version ${result.version}. Export was stopped.`);
}

export function createPutScannerBackup(
  storage: BackupStorage,
  options: { now?: Date; appVersion?: string } = {},
): PutScannerBackup {
  const portfolioRead = readPortfolioTrades(storage);
  if (portfolioRead.status === 'corrupt' || portfolioRead.status === 'unsupported_version') storedReadError('Portfolio', portfolioRead);
  const watchlistRead = readWatchlist(storage);
  if (watchlistRead.status === 'corrupt' || watchlistRead.status === 'unsupported_version') storedReadError('Watchlist', watchlistRead);
  const preferencesRead = readDurablePreferences(storage);
  if (preferencesRead.status === 'corrupt' || preferencesRead.status === 'unsupported_version') storedReadError('Preferences', preferencesRead);

  const now = options.now ?? new Date();
  return {
    format: PUT_SCANNER_BACKUP_FORMAT,
    schemaVersion: PUT_SCANNER_BACKUP_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    appVersion: options.appVersion?.trim() || '0.0.0',
    data: {
      portfolio: {
        schemaVersion: 1,
        updatedAt: portfolioRead.status === 'ok' ? portfolioRead.updatedAt : null,
        revision: portfolioRead.status === 'ok' ? portfolioRead.revision : 0,
        data: portfolioRead.status === 'ok' ? toDurablePortfolioState(portfolioRead.data) : [],
      },
      watchlist: {
        schemaVersion: 1,
        updatedAt: watchlistRead.status === 'ok' ? watchlistRead.updatedAt : null,
        revision: watchlistRead.status === 'ok' ? watchlistRead.revision : 0,
        data: watchlistRead.status === 'ok' ? toDurableWatchlistState(watchlistRead.data) : [],
      },
      preferences: createPreferencesEnvelope(
        preferencesRead.status === 'ok' ? preferencesRead.data : {},
        {
          updatedAt: preferencesRead.status === 'ok' ? preferencesRead.updatedAt : null,
          revision: preferencesRead.status === 'ok' ? preferencesRead.revision : 0,
        },
      ),
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
  if (value.schemaVersion !== 1 && value.schemaVersion !== PUT_SCANNER_BACKUP_SCHEMA_VERSION) {
    throw new UserDataBackupError(`Backup schema version ${value.schemaVersion} is not supported.`);
  }
  if (typeof value.exportedAt !== 'string' || Number.isNaN(Date.parse(value.exportedAt))) {
    throw new UserDataBackupError('Backup exportedAt is invalid.');
  }
  if (typeof value.appVersion !== 'string' || !value.appVersion.trim()) {
    throw new UserDataBackupError('Backup appVersion is invalid.');
  }
  if (!isRecord(value.data)) throw new UserDataBackupError('Backup data is missing.');

  if (value.schemaVersion === 1) {
    const legacy = value as unknown as PutScannerBackupV1;
    return {
      format: PUT_SCANNER_BACKUP_FORMAT,
      schemaVersion: PUT_SCANNER_BACKUP_SCHEMA_VERSION,
      exportedAt: new Date(value.exportedAt).toISOString(),
      appVersion: value.appVersion,
      data: {
        portfolio: {
          schemaVersion: 1,
          updatedAt: null,
          revision: 0,
          data: validatePortfolio(legacy.data.portfolio, 'data.portfolio'),
        },
        watchlist: {
          schemaVersion: 1,
          updatedAt: null,
          revision: 0,
          data: validateWatchlist(legacy.data.watchlist, 'data.watchlist'),
        },
        preferences: createPreferencesEnvelope(validatePreferences(legacy.data.preferences), { updatedAt: null, revision: 0 }),
      },
    };
  }

  if (!isRecord(value.data.portfolio)) throw new UserDataBackupError('data.portfolio envelope is missing.');
  if (!isRecord(value.data.watchlist)) throw new UserDataBackupError('data.watchlist envelope is missing.');
  if (value.data.portfolio.schemaVersion !== 1) throw new UserDataBackupError('data.portfolio schema version is unsupported.');
  if (value.data.watchlist.schemaVersion !== 1) throw new UserDataBackupError('data.watchlist schema version is unsupported.');
  if (typeof value.data.portfolio.revision !== 'number' || typeof value.data.watchlist.revision !== 'number') {
    throw new UserDataBackupError('Backup namespace revision metadata is invalid.');
  }
  let portfolio: ReturnType<typeof createPortfolioStorageEnvelope>;
  let watchlist: ReturnType<typeof createWatchlistStorageEnvelope>;
  let preferences: DurablePreferencesEnvelopeV1;
  try {
    portfolio = createPortfolioStorageEnvelope(
      validatePortfolio(value.data.portfolio.data, 'data.portfolio.data'),
      {
        updatedAt: value.data.portfolio.updatedAt as string | null,
        revision: Number(value.data.portfolio.revision),
      },
    );
    watchlist = createWatchlistStorageEnvelope(
      validateWatchlist(value.data.watchlist.data, 'data.watchlist.data'),
      {
        updatedAt: value.data.watchlist.updatedAt as string | null,
        revision: Number(value.data.watchlist.revision),
      },
    );
    preferences = validatePreferencesEnvelope(value.data.preferences);
  } catch (error) {
    if (error instanceof UserDataBackupError) throw error;
    throw new UserDataBackupError(error instanceof Error ? error.message : 'Backup namespace metadata is invalid.');
  }

  return {
    format: PUT_SCANNER_BACKUP_FORMAT,
    schemaVersion: PUT_SCANNER_BACKUP_SCHEMA_VERSION,
    exportedAt: new Date(value.exportedAt).toISOString(),
    appVersion: value.appVersion,
    data: {
      portfolio: {
        schemaVersion: 1,
        updatedAt: portfolio.updatedAt,
        revision: portfolio.revision,
        data: portfolio.data,
      },
      watchlist: {
        schemaVersion: 1,
        updatedAt: watchlist.updatedAt,
        revision: watchlist.revision,
        data: watchlist.data,
      },
      preferences,
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
  const portfolio = serializePortfolioStorageEnvelope(createPortfolioStorageEnvelope(
    backup.data.portfolio.data,
    { updatedAt: backup.data.portfolio.updatedAt, revision: backup.data.portfolio.revision },
  ));
  const watchlist = serializeWatchlistStorageEnvelope(createWatchlistStorageEnvelope(
    backup.data.watchlist.data,
    { updatedAt: backup.data.watchlist.updatedAt, revision: backup.data.watchlist.revision },
  ));
  if (portfolio.status === 'error') throw new UserDataBackupError(`Portfolio import could not be serialized: ${portfolio.error}`);
  if (watchlist.status === 'error') throw new UserDataBackupError(`Watchlist import could not be serialized: ${watchlist.error}`);
  const writes: Array<[string, string]> = [
    [PORTFOLIO_STORAGE_KEY, portfolio.serialized],
    [WATCHLIST_STORAGE_KEY, watchlist.serialized],
  ];
  const preferences = backup.data.preferences.data;
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
  const changedKeys = new Set(writes.flatMap(([key, content]) => (
    previous.get(key) === content ? [] : [key]
  )));

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
  if (changedKeys.has(PORTFOLIO_STORAGE_KEY)) emitDurableMutation('portfolio');
  if (changedKeys.has(WATCHLIST_STORAGE_KEY)) emitDurableMutation('watchlist');
  if ([
    THEME_STORAGE_KEY,
    LEGACY_THEME_STORAGE_KEY,
    THEME_MIGRATION_KEY,
    PORTFOLIO_MARK_BASIS_KEY,
    PORTFOLIO_GROUP_MODE_KEY,
    PORTFOLIO_EXPIRY_GROUPS_KEY,
    PORTFOLIO_UNDERLYING_GROUPS_KEY,
    SHOW_NOMINAL_YIELD_KEY,
  ].some(key => changedKeys.has(key))) emitDurableMutation('preferences');
  return backup;
}

export function getPutScannerBackupSummary(backup: PutScannerBackup): BackupSummary {
  const openPositions = backup.data.portfolio.data.filter(trade => trade.status === 'open').length;
  return {
    openPositions,
    historicalPositions: backup.data.portfolio.data.length - openPositions,
    watchlistItems: backup.data.watchlist.data.length,
    preferencesIncluded: Object.keys(backup.data.preferences.data).length > 0,
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

import { SHOW_NOMINAL_YIELD_KEY } from '../optionTablePreferences.ts';
import { PORTFOLIO_MARK_BASIS_KEY } from '../portfolioMarkPreference.ts';
import {
  PORTFOLIO_EXPIRY_GROUPS_KEY,
  PORTFOLIO_GROUP_MODE_KEY,
  PORTFOLIO_UNDERLYING_GROUPS_KEY,
} from '../portfolioSchedulePreferences.ts';
import {
  createPortfolioStorageEnvelope,
  migratePortfolioState,
  PORTFOLIO_STORAGE_KEY,
  readPortfolioTrades,
  serializePortfolioStorageEnvelope,
} from '../portfolioStorage.ts';
import {
  LEGACY_THEME_STORAGE_KEY,
  THEME_MIGRATION_KEY,
  THEME_MIGRATION_VERSION,
  THEME_STORAGE_KEY,
} from '../themePreference.ts';
import {
  createWatchlistStorageEnvelope,
  LEGACY_WATCHLIST_STORAGE_KEY,
  migrateWatchlistState,
  readWatchlist,
  serializeWatchlistStorageEnvelope,
  WATCHLIST_STORAGE_KEY,
  type WatchlistLocalState,
} from '../watchlist.ts';
import type { StorageLike } from '../durableStorage.ts';
import { prepareRuntimeStateFromCloud } from './hydration.ts';
import { readCanonicalLocalState } from './localState.ts';
import { initializationMatchesCloud } from './stateComparison.ts';
import { validateCloudStateRows } from './cloudValidation.ts';
import { CLOUD_STATE_NAMESPACES, type CloudStateSet } from './types.ts';

export const DURABLE_LOCAL_RECOVERY_KEYS = [
  PORTFOLIO_STORAGE_KEY,
  WATCHLIST_STORAGE_KEY,
  LEGACY_WATCHLIST_STORAGE_KEY,
  THEME_STORAGE_KEY,
  LEGACY_THEME_STORAGE_KEY,
  THEME_MIGRATION_KEY,
  PORTFOLIO_MARK_BASIS_KEY,
  PORTFOLIO_GROUP_MODE_KEY,
  PORTFOLIO_EXPIRY_GROUPS_KEY,
  PORTFOLIO_UNDERLYING_GROUPS_KEY,
  SHOW_NOMINAL_YIELD_KEY,
] as const;

export type DurableLocalRecoveryKey = typeof DURABLE_LOCAL_RECOVERY_KEYS[number];
export type DurableLocalRecoverySnapshot = Record<DurableLocalRecoveryKey, string | null>;

export interface LocalRestoreTestHooks {
  afterNamespaceWrite?: (namespace: 'portfolio' | 'watchlist' | 'preferences') => void;
  forceVerificationMismatch?: boolean;
}

export type LocalRestoreResult =
  | { ok: true; cloud: CloudStateSet }
  | {
      ok: false;
      code:
        | 'cloud_invalid'
        | 'local_invalid'
        | 'local_not_empty'
        | 'write_failed'
        | 'verification_failed'
        | 'rollback_failed';
      message: string;
    };

export function captureDurableLocalRecoverySnapshot(
  storage: Pick<StorageLike, 'getItem'>,
): DurableLocalRecoverySnapshot {
  return Object.fromEntries(
    DURABLE_LOCAL_RECOVERY_KEYS.map(key => [key, storage.getItem(key)]),
  ) as DurableLocalRecoverySnapshot;
}

export function durableLocalSnapshotMatches(
  storage: Pick<StorageLike, 'getItem'>,
  snapshot: DurableLocalRecoverySnapshot,
): boolean {
  return DURABLE_LOCAL_RECOVERY_KEYS.every(key => storage.getItem(key) === snapshot[key]);
}

export function restoreDurableLocalRecoverySnapshot(
  storage: StorageLike,
  snapshot: DurableLocalRecoverySnapshot,
): boolean {
  try {
    for (const key of [...DURABLE_LOCAL_RECOVERY_KEYS].reverse()) {
      const value = snapshot[key];
      if (value === null) storage.removeItem(key);
      else storage.setItem(key, value);
    }
    return durableLocalSnapshotMatches(storage, snapshot);
  } catch {
    return false;
  }
}

function normalizedCloudState(cloud: CloudStateSet, userId: string): CloudStateSet | null {
  try {
    const rawRows = CLOUD_STATE_NAMESPACES.map(namespace => {
      const row = cloud[namespace];
      return {
        user_id: row.userId,
        namespace: row.namespace,
        schema_version: row.schemaVersion,
        payload: row.payload,
        revision: row.revision,
        created_at: row.createdAt,
        updated_at: row.updatedAt,
      };
    });
    const validated = validateCloudStateRows(rawRows, userId, 'fetch_all');
    return validated.ok && validated.value.status === 'complete' ? validated.value.state : null;
  } catch {
    return null;
  }
}

function preferenceMutations(cloud: CloudStateSet): Array<
  { action: 'set'; key: DurableLocalRecoveryKey; value: string }
  | { action: 'remove'; key: DurableLocalRecoveryKey }
> {
  const preferences = cloud.preferences.payload.data;
  const mutations: Array<
    { action: 'set'; key: DurableLocalRecoveryKey; value: string }
    | { action: 'remove'; key: DurableLocalRecoveryKey }
  > = [];
  const assign = (key: DurableLocalRecoveryKey, value: string | undefined) => {
    mutations.push(value === undefined ? { action: 'remove', key } : { action: 'set', key, value });
  };

  assign(THEME_STORAGE_KEY, preferences.theme);
  assign(LEGACY_THEME_STORAGE_KEY, preferences.theme);
  assign(THEME_MIGRATION_KEY, preferences.theme === undefined ? undefined : THEME_MIGRATION_VERSION);
  assign(PORTFOLIO_MARK_BASIS_KEY, preferences.portfolioMarkBasis);
  assign(PORTFOLIO_GROUP_MODE_KEY, preferences.portfolioGroupMode);
  assign(
    PORTFOLIO_EXPIRY_GROUPS_KEY,
    preferences.collapsedExpirationGroups === undefined
      ? undefined
      : JSON.stringify(preferences.collapsedExpirationGroups),
  );
  assign(
    PORTFOLIO_UNDERLYING_GROUPS_KEY,
    preferences.collapsedUnderlyingGroups === undefined
      ? undefined
      : JSON.stringify(preferences.collapsedUnderlyingGroups),
  );
  assign(
    SHOW_NOMINAL_YIELD_KEY,
    preferences.showNominalYield === undefined ? undefined : String(preferences.showNominalYield),
  );
  return mutations;
}

function failure(
  code: Exclude<LocalRestoreResult, { ok: true }>['code'],
  message: string,
): LocalRestoreResult {
  return { ok: false, code, message };
}

export function restoreCloudStateToLocal(
  storage: StorageLike,
  cloudInput: CloudStateSet,
  authenticatedUserId: string,
  options: { now?: Date; testHooks?: LocalRestoreTestHooks } = {},
): LocalRestoreResult {
  const cloud = normalizedCloudState(cloudInput, authenticatedUserId);
  if (!cloud) return failure('cloud_invalid', 'Cloud state failed complete ownership and durable-schema validation.');

  const local = readCanonicalLocalState(storage);
  if (local.status !== 'ok') return failure('local_invalid', 'Local durable state is corrupt or unsupported.');
  if (local.value.summary.hasMeaningfulData) {
    return failure('local_not_empty', 'This browser already contains Put Scanner data. Restore is blocked.');
  }

  const portfolioRead = readPortfolioTrades(storage);
  const watchlistRead = readWatchlist(storage);
  if ((portfolioRead.status !== 'ok' && portfolioRead.status !== 'missing')
    || (watchlistRead.status !== 'ok' && watchlistRead.status !== 'missing')) {
    return failure('local_invalid', 'Local durable state cannot be prepared safely.');
  }

  const hydrated = prepareRuntimeStateFromCloud(cloud, {
    portfolio: portfolioRead.status === 'ok' ? portfolioRead.data : [],
    watchlist: watchlistRead.status === 'ok' ? watchlistRead.data : [],
  });
  const portfolioMigration = migratePortfolioState(0, hydrated.portfolio);
  const watchlistMigration = migrateWatchlistState(0, hydrated.watchlist);
  if (portfolioMigration.status !== 'ok' || watchlistMigration.status !== 'ok') {
    return failure('cloud_invalid', 'Cloud state could not be hydrated into valid local runtime forms.');
  }

  const now = options.now ?? new Date();
  const portfolioEnvelope = createPortfolioStorageEnvelope(
    portfolioMigration.state.data,
    {
      updatedAt: now.toISOString(),
      revision: (portfolioRead.status === 'ok' ? portfolioRead.revision : 0) + 1,
    },
    portfolioMigration.state.localMarketData,
  );
  const watchlistEnvelope = createWatchlistStorageEnvelope(
    watchlistMigration.state.data,
    {
      updatedAt: now.toISOString(),
      revision: (watchlistRead.status === 'ok' ? watchlistRead.revision : 0) + 1,
    },
    Object.fromEntries((watchlistRead.status === 'ok' ? watchlistRead.data : []).flatMap(item => {
      if (!cloud.watchlist.payload.data.some(cloudItem => cloudItem.id === item.id)) return [];
      const localState: WatchlistLocalState = {
        ...(item.updatedAt !== undefined ? { updatedAt: item.updatedAt } : {}),
        ...(item.status !== undefined ? { status: item.status } : {}),
        ...(item.snapshot !== undefined ? { snapshot: item.snapshot } : {}),
      };
      return Object.keys(localState).length > 0 ? [[item.id, localState]] : [];
    })),
  );
  const serializedPortfolio = serializePortfolioStorageEnvelope(portfolioEnvelope);
  const serializedWatchlist = serializeWatchlistStorageEnvelope(watchlistEnvelope);
  if (serializedPortfolio.status !== 'ok' || serializedWatchlist.status !== 'ok') {
    return failure('cloud_invalid', 'Validated cloud state could not be serialized safely.');
  }
  const preferences = preferenceMutations(cloud);
  let recovery: DurableLocalRecoverySnapshot;
  try {
    recovery = captureDurableLocalRecoverySnapshot(storage);
  } catch {
    return failure('local_invalid', 'A complete pre-restore recovery snapshot could not be captured.');
  }

  try {
    storage.setItem(PORTFOLIO_STORAGE_KEY, serializedPortfolio.serialized);
    options.testHooks?.afterNamespaceWrite?.('portfolio');
    storage.setItem(WATCHLIST_STORAGE_KEY, serializedWatchlist.serialized);
    options.testHooks?.afterNamespaceWrite?.('watchlist');
    for (const mutation of preferences) {
      if (mutation.action === 'set') storage.setItem(mutation.key, mutation.value);
      else storage.removeItem(mutation.key);
    }
    options.testHooks?.afterNamespaceWrite?.('preferences');
  } catch {
    return restoreDurableLocalRecoverySnapshot(storage, recovery)
      ? failure('write_failed', 'Local restore failed; every durable key was rolled back.')
      : failure('rollback_failed', 'Local restore failed and the exact recovery snapshot could not be fully restored.');
  }

  const restored = readCanonicalLocalState(storage);
  const verified = restored.status === 'ok'
    && initializationMatchesCloud(restored.value.documents, cloud)
    && !options.testHooks?.forceVerificationMismatch;
  if (!verified) {
    return restoreDurableLocalRecoverySnapshot(storage, recovery)
      ? failure('verification_failed', 'Local restore verification failed; every durable key was rolled back.')
      : failure('rollback_failed', 'Local restore verification failed and rollback could not be fully verified.');
  }
  return { ok: true, cloud };
}

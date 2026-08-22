import { SHOW_NOMINAL_YIELD_KEY } from '../optionTablePreferences.ts';
import { PORTFOLIO_MARK_BASIS_KEY } from '../portfolioMarkPreference.ts';
import {
  PORTFOLIO_EXPIRY_GROUPS_KEY,
  PORTFOLIO_GROUP_MODE_KEY,
  PORTFOLIO_UNDERLYING_GROUPS_KEY,
} from '../portfolioSchedulePreferences.ts';
import {
  createPortfolioStorageEnvelope,
  hydrateRuntimePortfolio,
  migratePortfolioState,
  PORTFOLIO_STORAGE_KEY,
  readPortfolioTrades,
  serializePortfolioStorageEnvelope,
  type PortfolioMarketData,
} from '../portfolioStorage.ts';
import {
  LEGACY_THEME_STORAGE_KEY,
  THEME_MIGRATION_KEY,
  THEME_MIGRATION_VERSION,
  THEME_STORAGE_KEY,
} from '../themePreference.ts';
import {
  createWatchlistStorageEnvelope,
  hydrateRuntimeWatchlist,
  migrateWatchlistState,
  readWatchlist,
  serializeWatchlistStorageEnvelope,
  WATCHLIST_STORAGE_KEY,
  type WatchlistLocalState,
} from '../watchlist.ts';
import type { StorageLike } from '../durableStorage.ts';
import { validateCloudStateRow } from './cloudValidation.ts';
import {
  captureDurableLocalRecoverySnapshot,
  restoreDurableLocalRecoverySnapshot,
  type DurableLocalRecoveryKey,
} from './localRestore.ts';
import { readCanonicalLocalNamespace, type CanonicalLocalNamespaceState } from './localState.ts';
import { fingerprintNamespaceDocument, type SyncFingerprint } from './syncFingerprint.ts';
import type { CloudNamespace, CloudStateRow } from './types.ts';

export type SafeCloudPullResult<Namespace extends CloudNamespace = CloudNamespace> =
  | { ok: true; local: CanonicalLocalNamespaceState<Namespace>; fingerprint: SyncFingerprint }
  | {
      ok: false;
      code: 'account_mismatch' | 'cloud_invalid' | 'local_invalid' | 'local_changed' | 'write_failed' | 'verification_failed' | 'rollback_failed';
      message: string;
    };

export interface SafeCloudPullOptions {
  now?: Date;
  beforeCommit?: () => void;
  forceVerificationMismatch?: boolean;
}

function normalizedRow<Namespace extends CloudNamespace>(
  row: CloudStateRow<Namespace>,
  userId: string,
): CloudStateRow<Namespace> | null {
  const validated = validateCloudStateRow({
    user_id: row.userId,
    namespace: row.namespace,
    schema_version: row.schemaVersion,
    payload: row.payload,
    revision: row.revision,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
  }, userId, 'fetch_namespace', row.namespace);
  return validated.ok ? validated.value as CloudStateRow<Namespace> : null;
}

function currentPortfolioMarketData(
  trades: Extract<ReturnType<typeof readPortfolioTrades>, { status: 'ok' }>['data'],
): Record<string, PortfolioMarketData> {
  return Object.fromEntries(trades.flatMap(trade => (
    trade.latestMarketData ? [[trade.id, trade.latestMarketData]] : []
  )));
}

function currentWatchlistLocalState(
  items: Extract<ReturnType<typeof readWatchlist>, { status: 'ok' }>['data'],
): Record<string, WatchlistLocalState> {
  return Object.fromEntries(items.flatMap(item => {
    const localState: WatchlistLocalState = {
      ...(item.snapshot ? { snapshot: item.snapshot } : {}),
      ...(item.status ? { status: item.status } : {}),
      ...(item.updatedAt !== undefined ? { updatedAt: item.updatedAt } : {}),
    };
    return Object.keys(localState).length > 0 ? [[item.id, localState]] : [];
  }));
}

function preferenceMutations(row: CloudStateRow<'preferences'>): Array<
  { action: 'set'; key: DurableLocalRecoveryKey; value: string }
  | { action: 'remove'; key: DurableLocalRecoveryKey }
> {
  const preferences = row.payload.data;
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
  assign(PORTFOLIO_EXPIRY_GROUPS_KEY, preferences.collapsedExpirationGroups === undefined
    ? undefined
    : JSON.stringify(preferences.collapsedExpirationGroups));
  assign(PORTFOLIO_UNDERLYING_GROUPS_KEY, preferences.collapsedUnderlyingGroups === undefined
    ? undefined
    : JSON.stringify(preferences.collapsedUnderlyingGroups));
  assign(SHOW_NOMINAL_YIELD_KEY, preferences.showNominalYield === undefined
    ? undefined
    : String(preferences.showNominalYield));
  return mutations;
}

export function safelyPullCloudNamespace<Namespace extends CloudNamespace>(
  storage: StorageLike,
  authenticatedUserId: string,
  cloudInput: CloudStateRow<Namespace>,
  expectedCleanLocalFingerprint: SyncFingerprint,
  options: SafeCloudPullOptions = {},
): SafeCloudPullResult<Namespace> {
  if (cloudInput.userId !== authenticatedUserId.trim()) {
    return { ok: false, code: 'account_mismatch', message: 'Cloud state belongs to another account.' };
  }
  const cloud = normalizedRow(cloudInput, authenticatedUserId.trim());
  if (!cloud) return { ok: false, code: 'cloud_invalid', message: 'Cloud namespace failed durable validation.' };

  const initiallyLocal = readCanonicalLocalNamespace(storage, cloud.namespace);
  if (initiallyLocal.status !== 'ok') {
    return { ok: false, code: 'local_invalid', message: 'Local namespace is corrupt or unsupported.' };
  }
  if (fingerprintNamespaceDocument(initiallyLocal.value.document) !== expectedCleanLocalFingerprint) {
    return { ok: false, code: 'local_changed', message: 'Local state changed before the cloud pull and was not overwritten.' };
  }

  options.beforeCommit?.();
  const currentLocal = readCanonicalLocalNamespace(storage, cloud.namespace);
  if (currentLocal.status !== 'ok'
    || fingerprintNamespaceDocument(currentLocal.value.document) !== expectedCleanLocalFingerprint) {
    return { ok: false, code: 'local_changed', message: 'Local state changed during the cloud pull and was not overwritten.' };
  }

  const now = (options.now ?? new Date()).toISOString();
  let write: () => void;
  if (cloud.namespace === 'portfolio') {
    const current = readPortfolioTrades(storage);
    if (current.status !== 'ok' && current.status !== 'missing') {
      return { ok: false, code: 'local_invalid', message: 'Local Portfolio state cannot be prepared safely.' };
    }
    const currentTrades = current.status === 'ok' ? current.data : [];
    const hydrated = hydrateRuntimePortfolio(
      (cloud as CloudStateRow<'portfolio'>).payload.data,
      currentPortfolioMarketData(currentTrades),
    );
    const migrated = migratePortfolioState(0, hydrated);
    if (migrated.status !== 'ok') {
      return { ok: false, code: 'cloud_invalid', message: 'Cloud Portfolio could not be hydrated safely.' };
    }
    const envelope = createPortfolioStorageEnvelope(migrated.state.data, {
      updatedAt: now,
      revision: (current.status === 'ok' ? current.revision : 0) + 1,
    }, migrated.state.localMarketData);
    const serialized = serializePortfolioStorageEnvelope(envelope);
    if (serialized.status !== 'ok') {
      return { ok: false, code: 'cloud_invalid', message: 'Cloud Portfolio could not be serialized safely.' };
    }
    write = () => storage.setItem(PORTFOLIO_STORAGE_KEY, serialized.serialized);
  } else if (cloud.namespace === 'watchlist') {
    const current = readWatchlist(storage);
    if (current.status !== 'ok' && current.status !== 'missing') {
      return { ok: false, code: 'local_invalid', message: 'Local Watchlist state cannot be prepared safely.' };
    }
    const currentItems = current.status === 'ok' ? current.data : [];
    const hydrated = hydrateRuntimeWatchlist(
      (cloud as CloudStateRow<'watchlist'>).payload.data,
      currentWatchlistLocalState(currentItems),
    );
    const migrated = migrateWatchlistState(0, hydrated);
    if (migrated.status !== 'ok') {
      return { ok: false, code: 'cloud_invalid', message: 'Cloud Watchlist could not be hydrated safely.' };
    }
    const envelope = createWatchlistStorageEnvelope(migrated.state.data, {
      updatedAt: now,
      revision: (current.status === 'ok' ? current.revision : 0) + 1,
    }, migrated.state.localState);
    const serialized = serializeWatchlistStorageEnvelope(envelope);
    if (serialized.status !== 'ok') {
      return { ok: false, code: 'cloud_invalid', message: 'Cloud Watchlist could not be serialized safely.' };
    }
    write = () => storage.setItem(WATCHLIST_STORAGE_KEY, serialized.serialized);
  } else {
    const mutations = preferenceMutations(cloud as CloudStateRow<'preferences'>);
    write = () => {
      for (const mutation of mutations) {
        if (mutation.action === 'set') storage.setItem(mutation.key, mutation.value);
        else storage.removeItem(mutation.key);
      }
    };
  }

  let recovery;
  try {
    recovery = captureDurableLocalRecoverySnapshot(storage);
  } catch {
    return { ok: false, code: 'local_invalid', message: 'A local recovery snapshot could not be captured.' };
  }
  try {
    write();
  } catch {
    return restoreDurableLocalRecoverySnapshot(storage, recovery)
      ? { ok: false, code: 'write_failed', message: 'Cloud pull failed and local storage was rolled back.' }
      : { ok: false, code: 'rollback_failed', message: 'Cloud pull failed and exact rollback could not be verified.' };
  }

  const restored = readCanonicalLocalNamespace(storage, cloud.namespace);
  const intendedFingerprint = fingerprintNamespaceDocument(cloud);
  if (restored.status !== 'ok'
    || fingerprintNamespaceDocument(restored.value.document) !== intendedFingerprint
    || options.forceVerificationMismatch) {
    return restoreDurableLocalRecoverySnapshot(storage, recovery)
      ? { ok: false, code: 'verification_failed', message: 'Cloud pull verification failed and local storage was rolled back.' }
      : { ok: false, code: 'rollback_failed', message: 'Cloud pull verification failed and rollback could not be verified.' };
  }
  return {
    ok: true,
    local: restored.value as CanonicalLocalNamespaceState<Namespace>,
    fingerprint: intendedFingerprint,
  };
}

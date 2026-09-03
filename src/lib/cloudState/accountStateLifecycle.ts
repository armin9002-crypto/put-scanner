import {
  PREFERENCES_DURABLE_SCHEMA_VERSION,
  type DurablePreferences,
} from '../durablePreferences.ts';
import { PORTFOLIO_MARK_BASIS_KEY } from '../portfolioMarkPreference.ts';
import { PORTFOLIO_GROUP_MODE_KEY } from '../portfolioSchedulePreferences.ts';
import {
  createPortfolioStorageEnvelope,
  PORTFOLIO_DURABLE_SCHEMA_VERSION,
  PORTFOLIO_STORAGE_KEY,
  serializePortfolioStorageEnvelope,
} from '../portfolioStorage.ts';
import { SHOW_NOMINAL_YIELD_KEY } from '../optionTablePreferences.ts';
import { RECOMMENDATIONS_MINIMUM_DTE_KEY } from '../recommendationPreferences.ts';
import type { PutScannerBackup } from '../userDataBackup.ts';
import {
  createWatchlistStorageEnvelope,
  serializeWatchlistStorageEnvelope,
  WATCHLIST_DURABLE_SCHEMA_VERSION,
  WATCHLIST_STORAGE_KEY,
} from '../watchlist.ts';
import type { DormantCloudStateClient } from './cloudStateClient.ts';
import {
  DEFAULT_ACCOUNT_STATE_SNAPSHOT,
  type AccountStateActionResult,
  type AccountStateSnapshot,
} from './accountStateContext.ts';
import { AccountStateMemoryStorage } from './accountStateStorage.ts';
import { readAccountMemoryNamespace } from './accountStateDocuments.ts';
import { retireLegacyDurableAccountKeys } from './legacyAccountCleanup.ts';
import { canonicalJsonEqual } from './stateComparison.ts';
import { subscribeToDurableMutations } from './syncEvents.ts';
import {
  CLOUD_STATE_NAMESPACES,
  type CloudInitializationInput,
  type CloudNamespace,
  type CloudNamespaceDocument,
  type CloudStateRow,
  type CloudStateSet,
} from './types.ts';

type SnapshotListener = (snapshot: AccountStateSnapshot) => void;

export interface AccountStateManagerOptions {
  storage: AccountStateMemoryStorage;
  legacyStorage: Pick<Storage, 'removeItem'> | null;
  clientForUser(userId: string): DormantCloudStateClient;
  now?: () => Date;
}

function emptyInitialization(): CloudInitializationInput {
  return {
    portfolio: { schemaVersion: PORTFOLIO_DURABLE_SCHEMA_VERSION, payload: { data: [] } },
    watchlist: { schemaVersion: WATCHLIST_DURABLE_SCHEMA_VERSION, payload: { data: [] } },
    preferences: { schemaVersion: PREFERENCES_DURABLE_SCHEMA_VERSION, payload: { data: {} } },
  };
}

function portfolioEntry(row: CloudStateSet['portfolio']): readonly [string, string] {
  const serialized = serializePortfolioStorageEnvelope(createPortfolioStorageEnvelope(
    row.payload.data,
    { updatedAt: row.updatedAt, revision: row.revision },
  ));
  if (serialized.status !== 'ok') throw new Error(serialized.error);
  return [PORTFOLIO_STORAGE_KEY, serialized.serialized] as const;
}

function watchlistEntry(row: CloudStateSet['watchlist']): readonly [string, string] {
  const serialized = serializeWatchlistStorageEnvelope(createWatchlistStorageEnvelope(
    row.payload.data,
    { updatedAt: row.updatedAt, revision: row.revision },
  ));
  if (serialized.status !== 'ok') throw new Error(serialized.error);
  return [WATCHLIST_STORAGE_KEY, serialized.serialized] as const;
}

function preferenceEntries(preferences: DurablePreferences): Array<readonly [string, string]> {
  const entries: Array<readonly [string, string]> = [];
  if (preferences.portfolioMarkBasis !== undefined) entries.push([PORTFOLIO_MARK_BASIS_KEY, preferences.portfolioMarkBasis]);
  if (preferences.portfolioGroupMode !== undefined) entries.push([PORTFOLIO_GROUP_MODE_KEY, preferences.portfolioGroupMode]);
  if (preferences.showNominalYield !== undefined) entries.push([SHOW_NOMINAL_YIELD_KEY, String(preferences.showNominalYield)]);
  if (preferences.recommendationsOnlyAtLeast60Dte !== undefined) entries.push([RECOMMENDATIONS_MINIMUM_DTE_KEY, String(preferences.recommendationsOnlyAtLeast60Dte)]);
  return entries;
}

function allMemoryEntries(cloud: CloudStateSet): Array<readonly [string, string]> {
  return [
    portfolioEntry(cloud.portfolio),
    watchlistEntry(cloud.watchlist),
    ...preferenceEntries(cloud.preferences.payload.data),
  ];
}

function namespaceDocument(
  storage: AccountStateMemoryStorage,
  namespace: CloudNamespace,
  canonical: CloudStateSet,
): CloudNamespaceDocument {
  const read = readAccountMemoryNamespace(storage, namespace);
  if (read.status !== 'ok') throw new Error(`The ${namespace} change could not be validated.`);
  if (namespace !== 'preferences') return read.document;
  return {
    schemaVersion: PREFERENCES_DURABLE_SCHEMA_VERSION,
    payload: {
      // Retain historical device-presentation fields already in the cloud row,
      // while current UI reads only explicitly supported account preferences.
      data: {
        ...canonical.preferences.payload.data,
        ...read.document.payload.data,
      },
    },
  };
}

function backupDocuments(backup: PutScannerBackup): CloudInitializationInput {
  return {
    portfolio: { schemaVersion: 1, payload: { data: backup.data.portfolio.data } },
    watchlist: { schemaVersion: 1, payload: { data: backup.data.watchlist.data } },
    preferences: { schemaVersion: 1, payload: { data: backup.data.preferences.data } },
  };
}

function actionFailure(code: string, message: string): AccountStateActionResult {
  return { ok: false, code, message };
}

export class CloudAuthoritativeAccountStateManager {
  private readonly storage: AccountStateMemoryStorage;
  private readonly legacyStorage: Pick<Storage, 'removeItem'> | null;
  private readonly clientForUser: (userId: string) => DormantCloudStateClient;
  private readonly now: () => Date;
  private readonly listeners = new Set<SnapshotListener>();
  private readonly queues: Record<CloudNamespace, CloudNamespaceDocument[]> = {
    portfolio: [], watchlist: [], preferences: [],
  };
  private readonly processing = new Set<CloudNamespace>();
  private generation = 0;
  private writeEpoch = 0;
  private snapshot: AccountStateSnapshot = { ...DEFAULT_ACCOUNT_STATE_SNAPSHOT };
  private unsubscribeMutations: (() => void) | null = null;

  constructor(options: AccountStateManagerOptions) {
    this.storage = options.storage;
    this.legacyStorage = options.legacyStorage;
    this.clientForUser = options.clientForUser;
    this.now = options.now ?? (() => new Date());
    this.activate();
  }

  getSnapshot(): AccountStateSnapshot {
    return this.snapshot;
  }

  subscribe(listener: SnapshotListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Re-establishes the global mutation listener after a React Strict Mode cleanup cycle. */
  activate(): void {
    if (!this.unsubscribeMutations) {
      this.unsubscribeMutations = subscribeToDurableMutations(event => this.captureMutation(event.namespace));
    }
  }

  setResolvingAuth(): void {
    this.generation += 1;
    this.writeEpoch += 1;
    this.clearQueues();
    this.storage.lockAndClear();
    this.setSnapshot({
      ...DEFAULT_ACCOUNT_STATE_SNAPSHOT,
      phase: 'resolving_auth',
      renderVersion: this.snapshot.renderVersion + 1,
    });
  }

  async setAccount(userId: string | null, configured: boolean): Promise<void> {
    const generation = ++this.generation;
    this.writeEpoch += 1;
    this.clearQueues();
    this.storage.lockAndClear();
    if (!userId) {
      this.setSnapshot({
        ...DEFAULT_ACCOUNT_STATE_SNAPSHOT,
        phase: 'anonymous',
        message: 'Sign in to save Portfolio and Watchlist data.',
        renderVersion: this.snapshot.renderVersion + 1,
      });
      return;
    }
    if (!configured) {
      this.setSnapshot({
        ...DEFAULT_ACCOUNT_STATE_SNAPSHOT,
        userId,
        phase: 'unavailable',
        message: 'Account storage is not configured.',
        renderVersion: this.snapshot.renderVersion + 1,
      });
      return;
    }
    await this.bootstrap(userId, generation);
  }

  async reload(): Promise<AccountStateActionResult> {
    const userId = this.snapshot.userId;
    if (!userId) return actionFailure('not_authenticated', 'Sign in to load account data.');
    const generation = ++this.generation;
    this.writeEpoch += 1;
    this.clearQueues();
    this.storage.lockAndClear();
    const ok = await this.bootstrap(userId, generation);
    return ok ? { ok: true } : actionFailure('load_failed', this.snapshot.message);
  }

  async restoreBackup(backup: PutScannerBackup): Promise<AccountStateActionResult> {
    const { userId, cloud } = this.snapshot;
    if (!userId || !cloud || (this.snapshot.phase !== 'ready' && this.snapshot.phase !== 'conflict')) {
      return actionFailure('not_ready', 'Sign in and load your account before restoring a backup.');
    }
    if (this.processing.size > 0 || this.snapshot.pendingWrites > 0) {
      return actionFailure('write_in_progress', 'Wait for the current account save to finish.');
    }
    const documents = backupDocuments(backup);
    const writeEpoch = ++this.writeEpoch;
    const client = this.clientForUser(userId);
    let nextCloud = cloud;
    const changed = CLOUD_STATE_NAMESPACES.filter(namespace => (
      !canonicalJsonEqual(nextCloud[namespace].payload, documents[namespace].payload)
    ));
    if (changed.length === 0) return { ok: true };

    this.setSnapshot({ ...this.snapshot, phase: 'saving', pendingWrites: changed.length, message: 'Restoring backup to your account…' });
    for (let index = 0; index < changed.length; index += 1) {
      const namespace = changed[index];
      const row = nextCloud[namespace] as CloudStateRow;
      const document = documents[namespace] as CloudNamespaceDocument;
      const result = await client.updateNamespaceIfRevisionMatches(
        namespace,
        row.revision,
        document.schemaVersion,
        document.payload,
      );
      if (writeEpoch !== this.writeEpoch || this.snapshot.userId !== userId) {
        return actionFailure('account_changed', 'The signed-in account changed before restore completed.');
      }
      if (!result.ok) {
        await this.recoverAfterWriteFailure(namespace, result.error.code === 'conflict');
        return actionFailure(result.error.code, result.error.code === 'conflict'
          ? 'Your account changed on another device. Reload the latest version before retrying the restore.'
          : 'The backup was not fully restored. The latest cloud state has been reloaded.');
      }
      nextCloud = { ...nextCloud, [namespace]: result.value } as CloudStateSet;
      this.snapshot = { ...this.snapshot, cloud: nextCloud, pendingWrites: changed.length - index - 1 };
    }
    this.storage.replace(allMemoryEntries(nextCloud), true);
    this.setSnapshot({
      ...this.snapshot,
      cloud: nextCloud,
      phase: 'ready',
      pendingWrites: 0,
      conflictNamespace: null,
      lastSavedAt: this.now().toISOString(),
      message: 'Backup restored to your account.',
      renderVersion: this.snapshot.renderVersion + 1,
    });
    return { ok: true };
  }

  destroy(): void {
    this.generation += 1;
    this.writeEpoch += 1;
    this.unsubscribeMutations?.();
    this.unsubscribeMutations = null;
    this.listeners.clear();
    this.storage.lockAndClear();
  }

  private async bootstrap(userId: string, generation: number): Promise<boolean> {
    this.setSnapshot({
      ...DEFAULT_ACCOUNT_STATE_SNAPSHOT,
      userId,
      phase: 'loading',
      message: 'Loading your account data…',
      renderVersion: this.snapshot.renderVersion + 1,
    });
    const client = this.clientForUser(userId);
    let fetched = await client.fetchAllUserState();
    if (generation !== this.generation) return false;
    if (fetched.ok && fetched.value.status === 'empty') {
      const initialized = await client.initializeAllNamespaces(emptyInitialization());
      if (generation !== this.generation) return false;
      if (initialized.ok) {
        fetched = { ok: true, value: { status: 'complete', state: initialized.value } };
      } else {
        // A concurrent first login may have initialized the rows first.
        fetched = await client.fetchAllUserState();
      }
    }
    if (generation !== this.generation) return false;
    if (!fetched.ok || fetched.value.status !== 'complete') {
      this.storage.lockAndClear();
      this.setSnapshot({
        ...DEFAULT_ACCOUNT_STATE_SNAPSHOT,
        userId,
        phase: 'error',
        message: "We couldn't load your account data.",
        renderVersion: this.snapshot.renderVersion + 1,
      });
      return false;
    }

    try {
      this.storage.replace(allMemoryEntries(fetched.value.state), true);
    } catch {
      this.storage.lockAndClear();
      this.setSnapshot({
        ...DEFAULT_ACCOUNT_STATE_SNAPSHOT,
        userId,
        phase: 'error',
        message: "We couldn't prepare your account data.",
        renderVersion: this.snapshot.renderVersion + 1,
      });
      return false;
    }

    // Cleanup is intentionally after verified cloud retrieval/hydration only.
    if (this.legacyStorage) retireLegacyDurableAccountKeys(this.legacyStorage);
    this.setSnapshot({
      ...DEFAULT_ACCOUNT_STATE_SNAPSHOT,
      userId,
      phase: 'ready',
      cloud: fetched.value.state,
      message: 'Your account data is loaded from the cloud.',
      renderVersion: this.snapshot.renderVersion + 1,
    });
    return true;
  }

  private captureMutation(namespace: CloudNamespace): void {
    const { cloud, userId } = this.snapshot;
    if (!userId || !cloud || !this.storage.isWritable()
      || (this.snapshot.phase !== 'ready' && this.snapshot.phase !== 'saving')) return;
    try {
      const document = namespaceDocument(this.storage, namespace, cloud);
      if (canonicalJsonEqual(cloud[namespace].payload, document.payload)) return;
      this.queues[namespace].push(document);
      this.setSnapshot({
        ...this.snapshot,
        phase: 'saving',
        pendingWrites: this.snapshot.pendingWrites + 1,
        message: 'Saving to your account…',
      });
      void this.processQueue(namespace, userId);
    } catch {
      this.storage.publishNotice({ kind: 'save_failed', message: "Couldn't save this change." });
      void this.recoverAfterWriteFailure(namespace, false);
    }
  }

  private async processQueue(namespace: CloudNamespace, userId: string): Promise<void> {
    if (this.processing.has(namespace)) return;
    this.processing.add(namespace);
    const writeEpoch = this.writeEpoch;
    const client = this.clientForUser(userId);
    try {
      while (this.queues[namespace].length > 0) {
        if (this.snapshot.userId !== userId || !this.snapshot.cloud) return;
        const document = this.queues[namespace].shift() as CloudNamespaceDocument;
        const row = this.snapshot.cloud[namespace] as CloudStateRow;
        const result = await client.updateNamespaceIfRevisionMatches(
          namespace,
          row.revision,
          document.schemaVersion,
          document.payload,
        );
        if (writeEpoch !== this.writeEpoch || this.snapshot.userId !== userId || !this.snapshot.cloud) return;
        if (!result.ok) {
          this.queues[namespace] = [];
          await this.recoverAfterWriteFailure(namespace, result.error.code === 'conflict');
          return;
        }
        const cloud = { ...this.snapshot.cloud, [namespace]: result.value } as CloudStateSet;
        this.setSnapshot({
          ...this.snapshot,
          cloud,
          pendingWrites: Math.max(0, this.snapshot.pendingWrites - 1),
          lastSavedAt: this.now().toISOString(),
        });
      }
      if (this.snapshot.pendingWrites === 0) {
        this.setSnapshot({
          ...this.snapshot,
          phase: 'ready',
          message: 'Saved to your account.',
        });
      }
    } finally {
      this.processing.delete(namespace);
    }
  }

  private async recoverAfterWriteFailure(namespace: CloudNamespace, conflict: boolean): Promise<void> {
    const { userId, cloud } = this.snapshot;
    if (!userId || !cloud) return;
    this.writeEpoch += 1;
    this.clearQueues();
    const latest = await this.clientForUser(userId).fetchNamespace(namespace);
    let nextCloud = cloud;
    if (latest.ok && latest.value) nextCloud = { ...cloud, [namespace]: latest.value } as CloudStateSet;
    this.storage.replace(allMemoryEntries(nextCloud), true);
    const message = conflict
      ? 'Your account changed on another device. Reloaded the latest cloud version; retry your change.'
      : "Couldn't save this change. The last cloud-saved version was restored.";
    this.storage.publishNotice({ kind: conflict ? 'conflict' : 'save_failed', message });
    this.setSnapshot({
      ...this.snapshot,
      cloud: nextCloud,
      phase: conflict ? 'conflict' : 'error',
      pendingWrites: 0,
      conflictNamespace: conflict ? namespace : null,
      message,
      renderVersion: this.snapshot.renderVersion + 1,
    });
  }

  private clearQueues(): void {
    for (const namespace of CLOUD_STATE_NAMESPACES) this.queues[namespace] = [];
  }

  private setSnapshot(snapshot: AccountStateSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of [...this.listeners]) listener(snapshot);
  }
}

export function createCloudAuthoritativeAccountStateManager(
  options: AccountStateManagerOptions,
): CloudAuthoritativeAccountStateManager {
  return new CloudAuthoritativeAccountStateManager(options);
}

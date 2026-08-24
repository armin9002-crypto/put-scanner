import type { StorageLike } from '../durableStorage.ts';
import type { DormantCloudStateClient } from './cloudStateClient.ts';
import { readCanonicalLocalNamespace, type CanonicalLocalNamespaceState } from './localState.ts';
import {
  captureConflictSnapshot,
  conflictSnapshotView,
  type CapturedConflictSnapshot,
  type ConflictResolutionChoice,
  type SyncConflictView,
} from './conflictRecovery.ts';
import {
  cloneOngoingSyncMetadata,
  readOngoingSyncMetadata,
  writeOngoingSyncMetadata,
  type NamespaceSyncStatus,
  type OngoingSyncMetadataV1,
} from './syncEngineMetadata.ts';
import { subscribeToDurableMutations } from './syncEvents.ts';
import { fingerprintNamespaceDocument, type SyncFingerprint } from './syncFingerprint.ts';
import { safelyPullCloudNamespace, type SafeCloudPullOptions } from './syncPull.ts';
import { SyncNamespaceQueue, type SyncQueueRunResult } from './syncQueue.ts';
import { reconcileNamespace, type SyncReconciliationClassification } from './syncReconciler.ts';
import {
  CLOUD_STATE_NAMESPACES,
  type CloudNamespace,
  type CloudNamespaceDocument,
  type CloudStateErrorCode,
  type CloudStateRow,
} from './types.ts';

type SyncTransport = Pick<
  DormantCloudStateClient,
  'fetchAllUserState' | 'fetchNamespace' | 'updateNamespaceIfRevisionMatches'
>;

export const DEFAULT_SYNC_DEBOUNCE_MS = 1_000;
export const DEFAULT_SYNC_RETRY_DELAYS_MS = [250, 1_000] as const;

export type OverallSyncStatus =
  | 'disabled'
  | 'all_synced'
  | 'changes_pending'
  | 'offline_saved_locally'
  | 'conflict_needs_attention'
  | 'attention';

export interface SyncCoordinatorSnapshot {
  overall: OverallSyncStatus;
  syncMode: OngoingSyncMetadataV1['syncMode'] | 'disabled';
  namespaces: Record<CloudNamespace, NamespaceSyncStatus>;
  conflicts: Partial<Record<CloudNamespace, SyncConflictView>>;
}

export type ConflictRecoveryResult =
  | { ok: true; namespace: CloudNamespace; choice?: ConflictResolutionChoice; metadata?: OngoingSyncMetadataV1 }
  | { ok: false; code: string; message: string };

export interface SyncNowNamespaceResult {
  namespace: CloudNamespace;
  classification: SyncReconciliationClassification;
  outcome: 'clean' | 'pushed' | 'pulled' | 'conflict' | 'pending' | 'attention' | 'disabled';
  cloudRevision: number | null;
}

export interface SyncNowResult {
  overall: OverallSyncStatus;
  namespaces: Record<CloudNamespace, SyncNowNamespaceResult>;
}

export type SyncCoordinatorDiagnosticEvent =
  | { type: 'mutation'; namespace: CloudNamespace }
  | { type: 'cloud_select' }
  | { type: 'cas_attempt'; namespace: CloudNamespace }
  | { type: 'verified_cas'; namespace: CloudNamespace }
  | { type: 'network_retry'; namespace: CloudNamespace }
  | { type: 'conflict'; namespace: CloudNamespace }
  | { type: 'conflict_backup'; namespace: CloudNamespace }
  | { type: 'conflict_resolved'; namespace: CloudNamespace; choice: ConflictResolutionChoice }
  | { type: 'pull'; namespace: CloudNamespace };

export interface DormantSyncCoordinatorOptions {
  userId: string;
  client: SyncTransport;
  storage: StorageLike;
  debounceMs?: number;
  retryDelaysMs?: readonly number[];
  now?: () => Date;
  delay?: (milliseconds: number) => Promise<void>;
  setTimer?: (callback: () => void, milliseconds: number) => ReturnType<typeof setTimeout>;
  clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
  pullOptions?: (namespace: CloudNamespace) => SafeCloudPullOptions;
  /** Optional in-memory diagnostics used by development/test surfaces only. */
  onDiagnosticEvent?: (event: SyncCoordinatorDiagnosticEvent) => void;
  /** Optional runtime status observer. It never initiates cloud work. */
  onSnapshotChange?: (snapshot: SyncCoordinatorSnapshot) => void;
}

function namespaceResult(
  namespace: CloudNamespace,
  classification: SyncReconciliationClassification,
  outcome: SyncNowNamespaceResult['outcome'],
  cloudRevision: number | null,
): SyncNowNamespaceResult {
  return { namespace, classification, outcome, cloudRevision };
}

function allNamespaceResults(
  classification: SyncReconciliationClassification,
  outcome: SyncNowNamespaceResult['outcome'],
): Record<CloudNamespace, SyncNowNamespaceResult> {
  return Object.fromEntries(CLOUD_STATE_NAMESPACES.map(namespace => (
    [namespace, namespaceResult(namespace, classification, outcome, null)]
  ))) as Record<CloudNamespace, SyncNowNamespaceResult>;
}

function summarizeOverall(metadata: OngoingSyncMetadataV1 | null, sessionSafe: boolean): OverallSyncStatus {
  if (!metadata) return 'disabled';
  if (!sessionSafe) return 'attention';
  if (metadata.syncMode === 'attention') return 'attention';
  if (metadata.syncMode !== 'enabled') return 'disabled';
  const statuses = CLOUD_STATE_NAMESPACES.map(namespace => metadata.namespaces[namespace].status);
  if (statuses.includes('conflict')) return 'conflict_needs_attention';
  if (statuses.includes('attention')) return 'attention';
  if (statuses.includes('offline')) return 'offline_saved_locally';
  if (statuses.some(status => status === 'pending' || status === 'syncing')) return 'changes_pending';
  return statuses.every(status => status === 'synced') ? 'all_synced' : 'disabled';
}

export class DormantLocalFirstSyncCoordinator {
  private readonly client: SyncTransport;
  private readonly storage: StorageLike;
  private readonly retryDelaysMs: readonly number[];
  private readonly now: () => Date;
  private readonly delay: (milliseconds: number) => Promise<void>;
  private readonly pullOptions?: DormantSyncCoordinatorOptions['pullOptions'];
  private readonly onDiagnosticEvent?: DormantSyncCoordinatorOptions['onDiagnosticEvent'];
  private readonly onSnapshotChange?: DormantSyncCoordinatorOptions['onSnapshotChange'];
  private readonly queues: Record<CloudNamespace, SyncNamespaceQueue>;
  private metadata: OngoingSyncMetadataV1 | null;
  private readonly startupBlock: 'missing' | 'account_mismatch' | 'corrupt' | null;
  private activeUserId: string | null;
  private generation = 1;
  private unsubscribeMutations: (() => void) | null = null;
  private syncNowInFlight: Promise<SyncNowResult> | null = null;
  private readonly conflictSnapshots: Partial<Record<CloudNamespace, CapturedConflictSnapshot>> = {};
  private readonly conflictBackupAcknowledgements = new Set<string>();
  private disposed = false;

  constructor(options: DormantSyncCoordinatorOptions) {
    this.client = options.client;
    this.storage = options.storage;
    this.retryDelaysMs = options.retryDelaysMs ?? DEFAULT_SYNC_RETRY_DELAYS_MS;
    if (this.retryDelaysMs.some(delay => !Number.isFinite(delay) || delay < 0)) {
      throw new Error('Sync retry delays must be non-negative durations.');
    }
    this.now = options.now ?? (() => new Date());
    this.delay = options.delay ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
    this.pullOptions = options.pullOptions;
    this.onDiagnosticEvent = options.onDiagnosticEvent;
    this.onSnapshotChange = options.onSnapshotChange;
    this.activeUserId = options.userId.trim() || null;
    const metadataRead = this.activeUserId
      ? readOngoingSyncMetadata(this.storage, this.activeUserId)
      : { status: 'missing' as const };
    this.metadata = metadataRead.status === 'ok' ? cloneOngoingSyncMetadata(metadataRead.metadata) : null;
    this.startupBlock = metadataRead.status === 'ok' ? null : metadataRead.status;

    const debounceMs = options.debounceMs ?? DEFAULT_SYNC_DEBOUNCE_MS;
    this.queues = Object.fromEntries(CLOUD_STATE_NAMESPACES.map(namespace => [namespace, new SyncNamespaceQueue({
      debounceMs,
      run: () => this.runQueuedNamespace(namespace),
      setTimer: options.setTimer,
      clearTimer: options.clearTimer,
    })])) as Record<CloudNamespace, SyncNamespaceQueue>;
  }

  /** Explicit and intentionally unused by normal Stage 5A production runtime. */
  attachMutationEvents(): () => void {
    if (this.unsubscribeMutations) return this.unsubscribeMutations;
    this.unsubscribeMutations = subscribeToDurableMutations(event => {
      this.notifyDurableMutation(event.namespace);
    });
    return () => {
      this.unsubscribeMutations?.();
      this.unsubscribeMutations = null;
    };
  }

  notifyDurableMutation(namespace: CloudNamespace): void {
    if (!this.isEnabledForCurrentAccount()) return;
    const status = this.metadata?.namespaces[namespace].status;
    if (status === 'conflict' || status === 'attention') return;
    this.onDiagnosticEvent?.({ type: 'mutation', namespace });
    if (this.metadata) this.metadata.namespaces[namespace].status = 'pending';
    this.queues[namespace].markMutation();
    this.publishSnapshot();
  }

  setAuthenticatedUser(userId: string | null): void {
    const normalized = userId?.trim() || null;
    if (normalized === this.activeUserId) return;
    this.activeUserId = normalized;
    this.generation += 1;
    this.clearConflictSession();
    this.publishSnapshot();
  }

  async flushNamespace(namespace: CloudNamespace): Promise<SyncQueueRunResult> {
    if (!this.isEnabledForCurrentAccount()) return 'blocked';
    return this.queues[namespace].flush();
  }

  async syncNow(): Promise<SyncNowResult> {
    if (this.syncNowInFlight) return this.syncNowInFlight;
    const operation = this.performSyncNow();
    this.syncNowInFlight = operation;
    void operation.finally(() => {
      if (this.syncNowInFlight === operation) this.syncNowInFlight = null;
    });
    return operation;
  }

  private async performSyncNow(): Promise<SyncNowResult> {
    if (!this.isEnabledForCurrentAccount()) {
      const accountMismatch = this.startupBlock === 'account_mismatch'
        || Boolean(this.metadata && this.activeUserId !== this.metadata.userId);
      return {
        overall: accountMismatch || this.startupBlock === 'corrupt' ? 'attention' : 'disabled',
        namespaces: allNamespaceResults(accountMismatch ? 'ACCOUNT_MISMATCH' : 'INVALID', 'disabled'),
      };
    }
    const metadata = this.metadata as OngoingSyncMetadataV1;
    const generation = this.generation;
    const local = Object.fromEntries(CLOUD_STATE_NAMESPACES.map(namespace => {
      const read = readCanonicalLocalNamespace(this.storage, namespace);
      return [namespace, read.status === 'ok'
        ? {
            status: 'ok' as const,
            value: read.value,
            document: read.value.document,
            fingerprint: fingerprintNamespaceDocument(read.value.document),
          }
        : { status: 'invalid' as const }];
    })) as Record<CloudNamespace,
      | {
          status: 'ok';
          value: CanonicalLocalNamespaceState;
          document: CloudNamespaceDocument;
          fingerprint: SyncFingerprint;
        }
      | { status: 'invalid' }>;

    this.onDiagnosticEvent?.({ type: 'cloud_select' });
    const fetched = await this.client.fetchAllUserState();
    if (!this.operationIsCurrent(generation) || !fetched.ok) {
      if (this.operationIsCurrent(generation) && !fetched.ok) {
        for (const namespace of CLOUD_STATE_NAMESPACES) {
          if (metadata.namespaces[namespace].status !== 'conflict') {
            this.setNamespaceStatus(namespace, fetched.error.code === 'network_error' ? 'offline' : 'attention',
              local[namespace].status === 'ok' ? local[namespace].fingerprint : null, generation);
          }
        }
      }
      return {
        overall: this.getSnapshot().overall,
        namespaces: allNamespaceResults(
          this.operationIsCurrent(generation) ? 'INVALID' : 'ACCOUNT_MISMATCH',
          this.operationIsCurrent(generation) ? 'pending' : 'disabled',
        ),
      };
    }

    const cloudState = fetched.value.status === 'complete' ? fetched.value.state : null;
    const results = await Promise.all(CLOUD_STATE_NAMESPACES.map(async namespace => {
      if (!this.operationIsCurrent(generation)) {
        return namespaceResult(namespace, 'ACCOUNT_MISMATCH', 'disabled', null);
      }
      const namespaceMetadata = (this.metadata as OngoingSyncMetadataV1).namespaces[namespace];
      const localState = local[namespace];
      const cloudRow = cloudState?.[namespace] as CloudStateRow<typeof namespace> | undefined;
      const reconciliation = reconcileNamespace({
        accountMatches: true,
        localFingerprint: localState.status === 'ok' ? localState.fingerprint : null,
        lastSyncedFingerprint: namespaceMetadata.lastSyncedFingerprint,
        knownCloudRevision: namespaceMetadata.cloudRevision,
        cloud: cloudRow
          ? { status: 'ok', revision: cloudRow.revision, fingerprint: fingerprintNamespaceDocument(cloudRow) }
          : { status: 'missing' },
      });

      if (namespaceMetadata.status === 'conflict') {
        if (reconciliation.classification === 'BOTH_CHANGED'
          && localState.status === 'ok'
          && cloudRow) {
          const captured = captureConflictSnapshot({
            namespace,
            userId: metadata.userId,
            local: localState.value,
            cloud: cloudRow,
            metadata: namespaceMetadata,
            now: this.now(),
          });
          if (captured) {
            this.storeConflictSnapshot(captured);
            this.setNamespaceStatus(namespace, 'conflict', localState.fingerprint, generation);
            return namespaceResult(namespace, 'BOTH_CHANGED', 'conflict', cloudRow.revision);
          }
        }
        this.removeConflictSnapshot(namespace);
        this.setNamespaceStatus(namespace, 'attention', localState.status === 'ok' ? localState.fingerprint : null, generation);
        return namespaceResult(namespace, reconciliation.classification, 'attention', cloudRow?.revision ?? null);
      }

      if (reconciliation.classification === 'CLEAN') {
        this.removeConflictSnapshot(namespace);
        this.setNamespaceStatus(namespace, 'synced', null, generation);
        return namespaceResult(namespace, 'CLEAN', 'clean', namespaceMetadata.cloudRevision);
      }
      if (reconciliation.classification === 'LOCAL_AHEAD' && localState.status === 'ok') {
        this.removeConflictSnapshot(namespace);
        // All pushes, including explicit Sync Now, pass through the same
        // namespace queue so a manual action cannot overlap an event write.
        const pushed = await this.queues[namespace].flush();
        return namespaceResult(
          namespace,
          'LOCAL_AHEAD',
          pushed === 'complete' ? 'pushed' : pushed === 'retry_later' ? 'pending' : 'attention',
          this.metadata?.namespaces[namespace].cloudRevision ?? null,
        );
      }
      if (reconciliation.classification === 'CLOUD_AHEAD'
        && cloudRow
        && namespaceMetadata.lastSyncedFingerprint) {
        this.removeConflictSnapshot(namespace);
        const pulled = safelyPullCloudNamespace(
          this.storage,
          metadata.userId,
          cloudRow,
          namespaceMetadata.lastSyncedFingerprint,
          this.pullOptions?.(namespace),
        );
        if (!this.operationIsCurrent(generation)) {
          return namespaceResult(namespace, 'ACCOUNT_MISMATCH', 'disabled', null);
        }
        if (!pulled.ok) {
          const status: NamespaceSyncStatus = pulled.code === 'local_changed' ? 'conflict' : 'attention';
          this.setNamespaceStatus(namespace, status, localState.status === 'ok' ? localState.fingerprint : null, generation);
          return namespaceResult(namespace, pulled.code === 'local_changed' ? 'BOTH_CHANGED' : 'INVALID',
            status === 'conflict' ? 'conflict' : 'attention', namespaceMetadata.cloudRevision);
        }
        const next = cloneOngoingSyncMetadata(this.metadata as OngoingSyncMetadataV1);
        next.namespaces[namespace] = {
          cloudRevision: cloudRow.revision,
          lastSyncedFingerprint: pulled.fingerprint,
          lastSyncedAt: this.now().toISOString(),
          status: 'synced',
          pendingFingerprint: null,
        };
        if (!this.commitMetadata(next, generation)) {
          return namespaceResult(namespace, 'INVALID', 'attention', cloudRow.revision);
        }
        this.onDiagnosticEvent?.({ type: 'pull', namespace });
        return namespaceResult(namespace, 'CLOUD_AHEAD', 'pulled', cloudRow.revision);
      }

      const conflict = reconciliation.classification === 'BOTH_CHANGED';
      if (conflict && localState.status === 'ok' && cloudRow) {
        const captured = captureConflictSnapshot({
          namespace,
          userId: metadata.userId,
          local: localState.value,
          cloud: cloudRow,
          metadata: namespaceMetadata,
          now: this.now(),
        });
        if (captured) this.storeConflictSnapshot(captured);
      } else {
        this.removeConflictSnapshot(namespace);
      }
      this.setNamespaceStatus(
        namespace,
        conflict ? 'conflict' : 'attention',
        localState.status === 'ok' ? localState.fingerprint : null,
        generation,
      );
      if (conflict) this.onDiagnosticEvent?.({ type: 'conflict', namespace });
      return namespaceResult(namespace, reconciliation.classification,
        conflict ? 'conflict' : 'attention', namespaceMetadata.cloudRevision);
    }));

    if (this.operationIsCurrent(generation) && this.metadata) {
      const next = cloneOngoingSyncMetadata(this.metadata);
      next.lastReconciledAt = this.now().toISOString();
      this.commitMetadata(next, generation);
    }
    return {
      overall: this.getSnapshot().overall,
      namespaces: Object.fromEntries(results.map(result => [result.namespace, result])) as Record<CloudNamespace, SyncNowNamespaceResult>,
    };
  }

  getSnapshot(): SyncCoordinatorSnapshot {
    const sessionSafe = Boolean(this.metadata && this.activeUserId === this.metadata.userId && !this.disposed);
    return {
      overall: this.startupBlock === 'account_mismatch' || this.startupBlock === 'corrupt'
        ? 'attention'
        : summarizeOverall(this.metadata, sessionSafe),
      syncMode: this.metadata?.syncMode ?? 'disabled',
      namespaces: Object.fromEntries(CLOUD_STATE_NAMESPACES.map(namespace => (
        [namespace, this.metadata?.namespaces[namespace].status ?? 'disabled']
      ))) as Record<CloudNamespace, NamespaceSyncStatus>,
      conflicts: Object.fromEntries(CLOUD_STATE_NAMESPACES.flatMap(namespace => {
        const conflict = this.conflictSnapshots[namespace];
        return conflict && this.metadata?.namespaces[namespace].status === 'conflict'
          ? [[namespace, conflictSnapshotView(conflict, this.conflictBackupAcknowledgements.has(conflict.id))]]
          : [];
      })) as Partial<Record<CloudNamespace, SyncConflictView>>,
    };
  }

  acknowledgeConflictBackup(namespace: CloudNamespace, conflictId: string): ConflictRecoveryResult {
    if (!this.isEnabledForCurrentAccount() || !this.metadata) {
      return { ok: false, code: 'not_enabled', message: 'Account sync is not enabled for this account.' };
    }
    const conflict = this.conflictSnapshots[namespace];
    if (!conflict || conflict.id !== conflictId || this.metadata.namespaces[namespace].status !== 'conflict') {
      return { ok: false, code: 'conflict_changed', message: 'Review the latest account copy before continuing.' };
    }
    this.conflictBackupAcknowledgements.add(conflict.id);
    this.onDiagnosticEvent?.({ type: 'conflict_backup', namespace });
    this.publishSnapshot();
    return { ok: true, namespace };
  }

  async resolveConflict(
    namespace: CloudNamespace,
    choice: ConflictResolutionChoice,
    conflictId: string,
  ): Promise<ConflictRecoveryResult> {
    if (!this.isEnabledForCurrentAccount() || !this.metadata) {
      return { ok: false, code: 'not_enabled', message: 'Account sync is not enabled for this account.' };
    }
    if (choice !== 'keep_this_device' && choice !== 'use_account_copy') {
      return { ok: false, code: 'invalid_choice', message: 'Choose which account copy to keep.' };
    }
    const conflict = this.conflictSnapshots[namespace];
    if (!conflict || conflict.id !== conflictId || this.metadata.namespaces[namespace].status !== 'conflict') {
      return { ok: false, code: 'conflict_changed', message: 'Review the latest account copy before continuing.' };
    }
    if (!this.conflictBackupAcknowledgements.has(conflict.id)) {
      return { ok: false, code: 'backup_required', message: 'Download a recovery backup before choosing a version.' };
    }
    if (conflict.userId !== this.activeUserId || this.queues[namespace].getState().inFlight) {
      return { ok: false, code: 'not_ready', message: 'Account Sync is still finishing another operation.' };
    }
    const generation = this.generation;
    const local = readCanonicalLocalNamespace(this.storage, namespace);
    const localFingerprint = local.status === 'ok'
      ? fingerprintNamespaceDocument(local.value.document)
      : null;
    if (local.status !== 'ok' || localFingerprint !== conflict.localFingerprint) {
      this.removeConflictSnapshot(namespace);
      this.publishSnapshot();
      return {
        ok: false,
        code: 'device_changed_again',
        message: 'This device changed again. Nothing was overwritten. Review both versions before trying again.',
      };
    }

    if (choice === 'keep_this_device') {
      this.onDiagnosticEvent?.({ type: 'cas_attempt', namespace });
      const updated = await this.client.updateNamespaceIfRevisionMatches(
        namespace,
        conflict.cloud.revision,
        local.value.document.schemaVersion,
        local.value.document.payload,
      );
      if (!this.operationIsCurrent(generation)) {
        return { ok: false, code: 'not_enabled', message: 'The signed-in account changed. Nothing was overwritten.' };
      }
      if (!updated.ok) {
        if (updated.error.code === 'conflict') {
          this.removeConflictSnapshot(namespace);
          this.publishSnapshot();
          return {
            ok: false,
            code: 'cloud_changed_again',
            message: 'Account data changed again. Nothing was overwritten. Review the latest account copy before trying again.',
          };
        }
        return { ok: false, code: updated.error.code, message: 'Account data could not be updated. Nothing was overwritten.' };
      }
      const intendedFingerprint = fingerprintNamespaceDocument(local.value.document);
      if (fingerprintNamespaceDocument(updated.value) !== intendedFingerprint) {
        this.removeConflictSnapshot(namespace);
        this.setNamespaceStatus(namespace, 'attention', localFingerprint, generation);
        return { ok: false, code: 'verification_failed', message: 'Account data could not be verified. Review your recovery backup.' };
      }
      const current = readCanonicalLocalNamespace(this.storage, namespace);
      const currentFingerprint = current.status === 'ok'
        ? fingerprintNamespaceDocument(current.value.document)
        : null;
      const next = cloneOngoingSyncMetadata(this.metadata);
      next.namespaces[namespace] = {
        cloudRevision: updated.value.revision,
        lastSyncedFingerprint: intendedFingerprint,
        lastSyncedAt: this.now().toISOString(),
        status: currentFingerprint === intendedFingerprint ? 'synced' : currentFingerprint ? 'pending' : 'attention',
        pendingFingerprint: currentFingerprint === intendedFingerprint ? null : currentFingerprint,
      };
      next.lastReconciledAt = this.now().toISOString();
      if (!this.commitMetadata(next, generation)) {
        return { ok: false, code: 'metadata_write_failed', message: 'The account update succeeded, but local sync status needs attention.' };
      }
      this.queues[namespace].discardPending();
      this.removeConflictSnapshot(namespace);
      if (currentFingerprint && currentFingerprint !== intendedFingerprint) this.queues[namespace].markMutation();
      this.onDiagnosticEvent?.({ type: 'verified_cas', namespace });
      this.onDiagnosticEvent?.({ type: 'conflict_resolved', namespace, choice });
      this.publishSnapshot();
      return { ok: true, namespace, choice, metadata: this.getMetadata() as OngoingSyncMetadataV1 };
    }

    const currentCloud = await this.client.fetchNamespace(namespace);
    if (!this.operationIsCurrent(generation)) {
      return { ok: false, code: 'not_enabled', message: 'The signed-in account changed. Nothing was overwritten.' };
    }
    if (!currentCloud.ok) {
      return { ok: false, code: currentCloud.error.code, message: 'The latest account copy could not be verified. Nothing was changed.' };
    }
    if (!currentCloud.value
      || currentCloud.value.userId !== conflict.userId
      || currentCloud.value.revision !== conflict.cloud.revision
      || fingerprintNamespaceDocument(currentCloud.value) !== conflict.cloudFingerprint) {
      this.removeConflictSnapshot(namespace);
      this.publishSnapshot();
      return {
        ok: false,
        code: 'cloud_changed_again',
        message: 'Account data changed again. Nothing was overwritten. Review the latest account copy before trying again.',
      };
    }
    const pulled = safelyPullCloudNamespace(
      this.storage,
      conflict.userId,
      currentCloud.value,
      conflict.localFingerprint,
      this.pullOptions?.(namespace),
    );
    if (!pulled.ok) {
      this.removeConflictSnapshot(namespace);
      if (pulled.code !== 'local_changed') this.setNamespaceStatus(namespace, 'attention', localFingerprint, generation);
      else this.publishSnapshot();
      return {
        ok: false,
        code: pulled.code === 'local_changed' ? 'device_changed_again' : pulled.code,
        message: pulled.code === 'local_changed'
          ? 'This device changed again. Nothing was overwritten. Review both versions before trying again.'
          : 'The account copy could not be applied safely. Local data was preserved.',
      };
    }
    const next = cloneOngoingSyncMetadata(this.metadata);
    next.namespaces[namespace] = {
      cloudRevision: currentCloud.value.revision,
      lastSyncedFingerprint: pulled.fingerprint,
      lastSyncedAt: this.now().toISOString(),
      status: 'synced',
      pendingFingerprint: null,
    };
    next.lastReconciledAt = this.now().toISOString();
    if (!this.commitMetadata(next, generation)) {
      return { ok: false, code: 'metadata_write_failed', message: 'The account copy was applied, but local sync status needs attention.' };
    }
    this.queues[namespace].discardPending();
    this.removeConflictSnapshot(namespace);
    this.onDiagnosticEvent?.({ type: 'pull', namespace });
    this.onDiagnosticEvent?.({ type: 'conflict_resolved', namespace, choice });
    this.publishSnapshot();
    return { ok: true, namespace, choice, metadata: this.getMetadata() as OngoingSyncMetadataV1 };
  }

  getMetadata(): OngoingSyncMetadataV1 | null {
    return this.metadata ? cloneOngoingSyncMetadata(this.metadata) : null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.unsubscribeMutations?.();
    this.unsubscribeMutations = null;
    for (const namespace of CLOUD_STATE_NAMESPACES) this.queues[namespace].dispose();
    this.clearConflictSession();
    this.publishSnapshot();
  }

  private isEnabledForCurrentAccount(): boolean {
    return !this.disposed
      && this.metadata?.syncMode === 'enabled'
      && this.activeUserId === this.metadata.userId;
  }

  private operationIsCurrent(generation: number): boolean {
    return generation === this.generation && this.isEnabledForCurrentAccount();
  }

  private async runQueuedNamespace(namespace: CloudNamespace): Promise<SyncQueueRunResult> {
    if (!this.isEnabledForCurrentAccount() || !this.metadata) return 'blocked';
    if (this.metadata.namespaces[namespace].status === 'conflict'
      || this.metadata.namespaces[namespace].status === 'attention') return 'blocked';
    const local = readCanonicalLocalNamespace(this.storage, namespace);
    if (local.status !== 'ok') {
      this.setNamespaceStatus(namespace, 'attention', null, this.generation);
      return 'blocked';
    }
    const fingerprint = fingerprintNamespaceDocument(local.value.document);
    if (fingerprint === this.metadata.namespaces[namespace].lastSyncedFingerprint) {
      this.setNamespaceStatus(namespace, 'synced', null, this.generation);
      return 'complete';
    }
    return this.pushNamespace(namespace, local.value.document, fingerprint, this.generation);
  }

  private async pushNamespace<Namespace extends CloudNamespace>(
    namespace: Namespace,
    document: CloudNamespaceDocument<Namespace>,
    intendedFingerprint: SyncFingerprint,
    generation: number,
  ): Promise<SyncQueueRunResult> {
    if (!this.operationIsCurrent(generation) || !this.metadata) return 'blocked';
    const expectedRevision = this.metadata.namespaces[namespace].cloudRevision;
    if (expectedRevision === null) {
      this.setNamespaceStatus(namespace, 'attention', intendedFingerprint, generation);
      return 'blocked';
    }

    const syncing = cloneOngoingSyncMetadata(this.metadata);
    syncing.namespaces[namespace].status = 'syncing';
    syncing.namespaces[namespace].pendingFingerprint = intendedFingerprint;
    if (!this.commitMetadata(syncing, generation)) return 'blocked';

    let lastError: CloudStateErrorCode | null = null;
    const attempts = this.retryDelaysMs.length + 1;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      this.onDiagnosticEvent?.({ type: 'cas_attempt', namespace });
      const updated = await this.client.updateNamespaceIfRevisionMatches(
        namespace,
        expectedRevision,
        document.schemaVersion,
        document.payload,
      );
      if (!this.operationIsCurrent(generation)) return 'blocked';
      if (updated.ok) {
        const returnedFingerprint = fingerprintNamespaceDocument(updated.value);
        if (returnedFingerprint !== intendedFingerprint) {
          this.setNamespaceStatus(namespace, 'attention', intendedFingerprint, generation);
          return 'blocked';
        }

        const current = readCanonicalLocalNamespace(this.storage, namespace);
        const currentFingerprint = current.status === 'ok'
          ? fingerprintNamespaceDocument(current.value.document)
          : null;
        const next = cloneOngoingSyncMetadata(this.metadata as OngoingSyncMetadataV1);
        next.namespaces[namespace] = {
          cloudRevision: updated.value.revision,
          lastSyncedFingerprint: intendedFingerprint,
          lastSyncedAt: this.now().toISOString(),
          status: currentFingerprint === intendedFingerprint ? 'synced' : currentFingerprint ? 'pending' : 'attention',
          pendingFingerprint: currentFingerprint === intendedFingerprint ? null : currentFingerprint,
        };
        if (!this.commitMetadata(next, generation)) return 'blocked';
        this.onDiagnosticEvent?.({ type: 'verified_cas', namespace });
        if (currentFingerprint && currentFingerprint !== intendedFingerprint) {
          this.queues[namespace].markMutation();
        }
        return 'complete';
      }

      lastError = updated.error.code;
      if (lastError !== 'network_error' || attempt === attempts - 1) break;
      this.onDiagnosticEvent?.({ type: 'network_retry', namespace });
      await this.delay(this.retryDelaysMs[attempt]);
      if (!this.operationIsCurrent(generation)) return 'blocked';
    }

    const current = readCanonicalLocalNamespace(this.storage, namespace);
    const pending = current.status === 'ok' ? fingerprintNamespaceDocument(current.value.document) : null;
    if (lastError === 'conflict') {
      this.setNamespaceStatus(namespace, 'conflict', pending, generation);
      this.onDiagnosticEvent?.({ type: 'conflict', namespace });
      return 'blocked';
    }
    if (lastError === 'network_error') {
      this.setNamespaceStatus(namespace, 'offline', pending, generation);
      return 'retry_later';
    }
    this.setNamespaceStatus(namespace, 'attention', pending, generation);
    return 'blocked';
  }

  private setNamespaceStatus(
    namespace: CloudNamespace,
    status: NamespaceSyncStatus,
    pendingFingerprint: SyncFingerprint | null,
    generation: number,
  ): boolean {
    if (!this.operationIsCurrent(generation) || !this.metadata) return false;
    const next = cloneOngoingSyncMetadata(this.metadata);
    next.namespaces[namespace].status = status;
    next.namespaces[namespace].pendingFingerprint = pendingFingerprint;
    return this.commitMetadata(next, generation);
  }

  private storeConflictSnapshot(snapshot: CapturedConflictSnapshot): void {
    const existing = this.conflictSnapshots[snapshot.namespace];
    if (existing && existing.id !== snapshot.id) this.conflictBackupAcknowledgements.delete(existing.id);
    this.conflictSnapshots[snapshot.namespace] = snapshot;
  }

  private removeConflictSnapshot(namespace: CloudNamespace): void {
    const existing = this.conflictSnapshots[namespace];
    if (existing) this.conflictBackupAcknowledgements.delete(existing.id);
    delete this.conflictSnapshots[namespace];
  }

  private clearConflictSession(): void {
    for (const namespace of CLOUD_STATE_NAMESPACES) delete this.conflictSnapshots[namespace];
    this.conflictBackupAcknowledgements.clear();
  }

  private commitMetadata(next: OngoingSyncMetadataV1, generation: number): boolean {
    if (!this.operationIsCurrent(generation) || next.userId !== this.activeUserId) return false;
    const written = writeOngoingSyncMetadata(this.storage, next);
    if (written.status !== 'ok') {
      this.metadata = cloneOngoingSyncMetadata(next);
      this.metadata.syncMode = 'attention';
      this.publishSnapshot();
      return false;
    }
    this.metadata = cloneOngoingSyncMetadata(next);
    this.publishSnapshot();
    return true;
  }

  private publishSnapshot(): void {
    this.onSnapshotChange?.(this.getSnapshot());
  }
}

/** Construction is side-effect free with respect to cloud transport and events. */
export function createDormantLocalFirstSyncCoordinator(
  options: DormantSyncCoordinatorOptions,
): DormantLocalFirstSyncCoordinator {
  return new DormantLocalFirstSyncCoordinator(options);
}

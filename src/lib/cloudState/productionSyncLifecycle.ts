import type { StorageLike } from '../durableStorage.ts';
import type { DormantCloudStateClient } from './cloudStateClient.ts';
import { readCanonicalLocalState } from './localState.ts';
import {
  createDormantLocalFirstSyncCoordinator,
  type DormantLocalFirstSyncCoordinator,
  type DormantSyncCoordinatorOptions,
  type SyncCoordinatorDiagnosticEvent,
  type ConflictRecoveryResult,
  type SyncNowResult,
} from './syncCoordinator.ts';
import { getOrCreateLocalSyncDeviceId, localDeviceLabel } from './deviceIdentity.ts';
import type { ConflictResolutionChoice } from './conflictRecovery.ts';
import {
  createEligibleOngoingSyncMetadata,
  enableEligibleOngoingSync,
  readOngoingSyncMetadata,
  writeOngoingSyncMetadata,
  type OngoingSyncMetadataV1,
} from './syncEngineMetadata.ts';
import { readCloudSyncMetadata } from './syncMetadata.ts';
import type {
  ProductionSyncActionResult,
  ProductionSyncPhase,
  ProductionSyncSnapshot,
} from './productionSyncContext.ts';
import { CLOUD_STATE_NAMESPACES, type CloudNamespace } from './types.ts';

type ProductionSyncClient = Pick<
  DormantCloudStateClient,
  'fetchAllUserState' | 'fetchNamespace' | 'updateNamespaceIfRevisionMatches'
>;

export type ProductionEnrollmentPreparationResult =
  | { ok: true; metadata: OngoingSyncMetadataV1 }
  | { ok: false; code: string; message: string };

export interface ProductionSyncManagerOptions {
  featureEnabled: boolean;
  storage: StorageLike;
  clientForUser(userId: string): ProductionSyncClient;
  now?: () => Date;
  debounceMs?: number;
  retryDelaysMs?: readonly number[];
  delay?: (milliseconds: number) => Promise<void>;
  setTimer?: DormantSyncCoordinatorOptions['setTimer'];
  clearTimer?: DormantSyncCoordinatorOptions['clearTimer'];
  pullOptions?: DormantSyncCoordinatorOptions['pullOptions'];
  onDiagnosticEvent?: (event: SyncCoordinatorDiagnosticEvent) => void;
}

const DISABLED_NAMESPACES = {
  portfolio: 'disabled',
  watchlist: 'disabled',
  preferences: 'disabled',
} as const;

function baseSnapshot(featureEnabled: boolean, deviceId: string | null = null): ProductionSyncSnapshot {
  return {
    featureEnabled,
    userId: null,
    phase: featureEnabled ? 'anonymous' : 'disabled',
    enrollment: 'none',
    overall: 'disabled',
    namespaces: { ...DISABLED_NAMESPACES },
    conflicts: {},
    deviceId,
    deviceLabel: localDeviceLabel(),
    lastSuccessfulSyncAt: null,
    message: featureEnabled ? 'Sign in to use account synchronization.' : 'Account synchronization is disabled.',
    canEnable: false,
    canSyncNow: false,
  };
}

function latestSuccessfulTimestamp(metadata: OngoingSyncMetadataV1 | null): string | null {
  if (!metadata) return null;
  const timestamps = CLOUD_STATE_NAMESPACES.flatMap(namespace => {
    const value = metadata.namespaces[namespace].lastSyncedAt;
    return value ? [value] : [];
  });
  timestamps.sort();
  return timestamps.length > 0 ? timestamps[timestamps.length - 1] : null;
}

function conflictMessage(namespaces: Record<CloudNamespace, string>): string {
  const conflict = CLOUD_STATE_NAMESPACES.find(namespace => namespaces[namespace] === 'conflict');
  return conflict
    ? `Sync conflict — ${conflict} needs attention.`
    : 'Sync conflict needs attention.';
}

function phaseFromOverall(overall: ProductionSyncSnapshot['overall']): ProductionSyncPhase {
  if (overall === 'all_synced') return 'synced';
  if (overall === 'changes_pending') return 'syncing';
  if (overall === 'offline_saved_locally') return 'pending';
  if (overall === 'conflict_needs_attention') return 'conflict';
  if (overall === 'attention') return 'attention';
  return 'attention';
}

function messageForPhase(
  phase: ProductionSyncPhase,
  namespaces: Record<CloudNamespace, string>,
): string {
  if (phase === 'synced') return 'Account sync is up to date.';
  if (phase === 'syncing') return 'Syncing account data…';
  if (phase === 'pending') return 'Saved locally — account sync pending.';
  if (phase === 'conflict') return conflictMessage(namespaces);
  if (phase === 'account_mismatch') return 'This device is associated with another account. Local data was preserved.';
  if (phase === 'unavailable') return 'Cloud state is invalid or unavailable. Local data was preserved.';
  if (phase === 'verifying') return 'Verifying this device and account copy…';
  if (phase === 'not_enrolled') return 'Account sync is not enabled on this device.';
  return 'Account sync needs attention. Local data was preserved.';
}

function reconciliationAllowsListener(result: SyncNowResult): boolean {
  return CLOUD_STATE_NAMESPACES.every(namespace => (
    result.namespaces[namespace].outcome === 'clean'
    || result.namespaces[namespace].outcome === 'pushed'
    || result.namespaces[namespace].outcome === 'pulled'
    || result.namespaces[namespace].outcome === 'conflict'
  ));
}

export async function prepareProductionSyncEnrollment(
  client: Pick<DormantCloudStateClient, 'fetchAllUserState'>,
  storage: StorageLike,
  userId: string,
  now = new Date(),
): Promise<ProductionEnrollmentPreparationResult> {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    return { ok: false, code: 'not_authenticated', message: 'Account synchronization requires an authenticated user.' };
  }

  const existingEngine = readOngoingSyncMetadata(storage, normalizedUserId);
  if (existingEngine.status === 'account_mismatch') {
    return { ok: false, code: 'account_mismatch', message: 'Ongoing sync metadata belongs to another account.' };
  }
  if (existingEngine.status === 'corrupt') {
    return { ok: false, code: 'metadata_invalid', message: existingEngine.message };
  }
  if (existingEngine.status === 'ok' && existingEngine.metadata.syncMode === 'enabled') {
    return { ok: false, code: 'already_enabled', message: 'Account sync is already enabled on this device.' };
  }
  if (existingEngine.status === 'ok' && existingEngine.metadata.syncMode === 'attention') {
    return { ok: false, code: 'metadata_attention', message: 'Existing sync metadata needs attention and was not replaced.' };
  }

  const stage4 = readCloudSyncMetadata(storage, normalizedUserId);
  if (stage4.status === 'missing') {
    return { ok: false, code: 'stage4_missing', message: 'Create or restore a verified Account Data copy before enabling sync.' };
  }
  if (stage4.status === 'account_mismatch') {
    return { ok: false, code: 'account_mismatch', message: 'Verified Account Data metadata belongs to another account.' };
  }
  if (stage4.status === 'corrupt') {
    return { ok: false, code: 'stage4_invalid', message: stage4.message };
  }
  if (stage4.metadata.migrationState !== 'migration_verified') {
    return { ok: false, code: 'stage4_unverified', message: 'A verified Account Data migration or restore is required.' };
  }

  const localBefore = readCanonicalLocalState(storage);
  if (localBefore.status !== 'ok') {
    return { ok: false, code: 'local_invalid', message: 'Local durable state is corrupt or unsupported.' };
  }

  const fetched = await client.fetchAllUserState();
  if (!fetched.ok) return { ok: false, code: fetched.error.code, message: fetched.error.message };
  if (fetched.value.status !== 'complete') {
    return { ok: false, code: 'cloud_incomplete', message: 'The account does not contain the complete three-namespace state.' };
  }

  // Re-read every durable prerequisite after the asynchronous inventory read.
  // A baseline is never created from stale pre-request local or account data.
  const local = readCanonicalLocalState(storage);
  const currentStage4 = readCloudSyncMetadata(storage, normalizedUserId);
  const currentEngine = readOngoingSyncMetadata(storage, normalizedUserId);
  if (local.status !== 'ok') {
    return { ok: false, code: 'local_invalid', message: 'Local durable state changed or became invalid during verification.' };
  }
  if (currentStage4.status !== 'ok' || currentStage4.metadata.migrationState !== 'migration_verified') {
    return { ok: false, code: 'stage4_changed', message: 'Verified Account Data metadata changed during enrollment.' };
  }
  if (currentEngine.status === 'account_mismatch' || currentEngine.status === 'corrupt') {
    return { ok: false, code: 'metadata_changed', message: 'Ongoing sync metadata changed during enrollment.' };
  }
  if (currentEngine.status === 'ok'
    && (currentEngine.metadata.syncMode === 'enabled' || currentEngine.metadata.syncMode === 'attention')) {
    return { ok: false, code: 'metadata_changed', message: 'Ongoing sync metadata changed during enrollment.' };
  }

  const eligible = createEligibleOngoingSyncMetadata(
    normalizedUserId,
    currentStage4.metadata,
    local.value,
    fetched.value.state,
    now,
  );
  if (!eligible.ok) return { ok: false, code: 'not_eligible', message: eligible.reason };
  return { ok: true, metadata: enableEligibleOngoingSync(eligible.metadata) };
}

export class ProductionCloudSyncManager {
  private readonly options: ProductionSyncManagerOptions;
  private snapshot: ProductionSyncSnapshot;
  private readonly subscribers = new Set<(snapshot: ProductionSyncSnapshot) => void>();
  private coordinator: DormantLocalFirstSyncCoordinator | null = null;
  private listenerAttached = false;
  private generation = 0;
  private accountKey = '';
  private accountOperation: Promise<void> | null = null;
  private currentUserId: string | null = null;
  private configured = false;
  private readonly deviceId: string | null;

  constructor(options: ProductionSyncManagerOptions) {
    this.options = options;
    this.deviceId = options.featureEnabled ? getOrCreateLocalSyncDeviceId(options.storage) : null;
    this.snapshot = baseSnapshot(options.featureEnabled, this.deviceId);
  }

  getSnapshot(): ProductionSyncSnapshot {
    return {
      ...this.snapshot,
      namespaces: { ...this.snapshot.namespaces },
      conflicts: { ...this.snapshot.conflicts },
    };
  }

  subscribe(subscriber: (snapshot: ProductionSyncSnapshot) => void): () => void {
    this.subscribers.add(subscriber);
    subscriber(this.getSnapshot());
    return () => this.subscribers.delete(subscriber);
  }

  setAccount(userId: string | null, configured: boolean): Promise<void> {
    const normalizedUserId = userId?.trim() || null;
    const key = `${configured ? 'configured' : 'unconfigured'}:${normalizedUserId ?? 'anonymous'}`;
    if (key === this.accountKey) return this.accountOperation ?? Promise.resolve();

    this.accountKey = key;
    this.generation += 1;
    const generation = this.generation;
    this.teardownCoordinator();
    this.currentUserId = normalizedUserId;
    this.configured = configured;

    const operation = this.startAccount(generation, normalizedUserId, configured);
    this.accountOperation = operation;
    void operation.finally(() => {
      if (this.accountOperation === operation) this.accountOperation = null;
    });
    return operation;
  }

  async enableOnThisDevice(): Promise<ProductionSyncActionResult> {
    if (!this.options.featureEnabled) {
      return { ok: false, code: 'feature_disabled', message: 'Account synchronization is disabled.' };
    }
    const userId = this.currentUserId;
    if (!this.configured || !userId) {
      return { ok: false, code: 'not_authenticated', message: 'Sign in before enabling account synchronization.' };
    }
    if (this.coordinator) {
      return { ok: false, code: 'already_enabled', message: 'Account sync is already enabled on this device.' };
    }

    const generation = this.generation;
    const client = this.options.clientForUser(userId);
    this.publish({
      ...this.snapshot,
      userId,
      phase: 'verifying',
      enrollment: 'blocked',
      message: messageForPhase('verifying', this.snapshot.namespaces),
      canEnable: false,
      canSyncNow: false,
    });
    const prepared = await prepareProductionSyncEnrollment(
      client,
      this.options.storage,
      userId,
      this.options.now?.() ?? new Date(),
    );
    if (!this.isCurrent(generation, userId)) {
      return { ok: false, code: 'account_changed', message: 'The authenticated account changed during enrollment.' };
    }
    if (!prepared.ok) {
      const phase: ProductionSyncPhase = prepared.code === 'account_mismatch'
        ? 'account_mismatch'
        : prepared.code.includes('invalid') || prepared.code.includes('changed')
          ? 'attention'
          : 'not_enrolled';
      this.publish({
        ...this.snapshot,
        phase,
        enrollment: phase === 'account_mismatch' || phase === 'attention' ? 'blocked' : 'none',
        message: prepared.message,
        canEnable: phase === 'not_enrolled',
        canSyncNow: false,
      });
      return prepared;
    }

    const written = writeOngoingSyncMetadata(this.options.storage, prepared.metadata);
    if (written.status !== 'ok') {
      const failed = { ok: false as const, code: 'metadata_write_failed', message: written.message };
      this.publish({
        ...this.snapshot,
        phase: 'attention',
        enrollment: 'blocked',
        message: failed.message,
        canEnable: false,
        canSyncNow: false,
      });
      return failed;
    }

    this.coordinator = this.createCoordinator(userId, client, generation);
    this.attachListener();
    this.publishFromCoordinator();
    return { ok: true, metadata: prepared.metadata };
  }

  async syncNow(): Promise<ProductionSyncActionResult> {
    const coordinator = this.coordinator;
    const userId = this.currentUserId;
    const generation = this.generation;
    if (!this.options.featureEnabled || !coordinator || !userId) {
      return { ok: false, code: 'not_enabled', message: 'Account sync is not enabled on this device.' };
    }
    this.publish({
      ...this.snapshot,
      phase: 'syncing',
      message: 'Syncing account data…',
      canEnable: false,
      canSyncNow: false,
    });
    const reconciliation = await coordinator.syncNow();
    if (!this.isCurrent(generation, userId) || this.coordinator !== coordinator) {
      return { ok: false, code: 'account_changed', message: 'The authenticated account changed during synchronization.' };
    }
    if (reconciliationAllowsListener(reconciliation)) this.attachListener();
    this.publishFromCoordinator();
    const metadata = coordinator.getMetadata();
    return metadata
      ? { ok: true, metadata, reconciliation }
      : { ok: false, code: 'metadata_invalid', message: 'Account sync metadata is unavailable.' };
  }

  acknowledgeConflictBackup(namespace: CloudNamespace, conflictId: string): ConflictRecoveryResult {
    const coordinator = this.coordinator;
    if (!this.options.featureEnabled || !coordinator || !this.currentUserId) {
      return { ok: false, code: 'not_enabled', message: 'Account sync is not enabled on this device.' };
    }
    const result = coordinator.acknowledgeConflictBackup(namespace, conflictId);
    this.publishFromCoordinator();
    return result;
  }

  async resolveConflict(
    namespace: CloudNamespace,
    choice: ConflictResolutionChoice,
    conflictId: string,
  ): Promise<ConflictRecoveryResult> {
    const coordinator = this.coordinator;
    const userId = this.currentUserId;
    const generation = this.generation;
    if (!this.options.featureEnabled || !coordinator || !userId) {
      return { ok: false, code: 'not_enabled', message: 'Account sync is not enabled on this device.' };
    }
    const result = await coordinator.resolveConflict(namespace, choice, conflictId);
    if (!this.isCurrent(generation, userId) || this.coordinator !== coordinator) {
      return { ok: false, code: 'account_changed', message: 'The signed-in account changed. Nothing was overwritten.' };
    }
    this.publishFromCoordinator();
    return result;
  }

  private async startAccount(
    generation: number,
    userId: string | null,
    configured: boolean,
  ): Promise<void> {
    if (!this.options.featureEnabled) {
      this.publish(baseSnapshot(false, this.deviceId));
      return;
    }
    if (!configured) {
      this.publish({
        ...baseSnapshot(true, this.deviceId),
        phase: 'unavailable',
        message: 'Supabase is not configured. The app remains local-first.',
      });
      return;
    }
    if (!userId) {
      this.publish(baseSnapshot(true, this.deviceId));
      return;
    }

    const metadataRead = readOngoingSyncMetadata(this.options.storage, userId);
    if (metadataRead.status === 'missing'
      || (metadataRead.status === 'ok' && metadataRead.metadata.syncMode !== 'enabled'
        && metadataRead.metadata.syncMode !== 'attention')) {
      this.publish({
        ...baseSnapshot(true, this.deviceId),
        userId,
        phase: 'not_enrolled',
        message: messageForPhase('not_enrolled', DISABLED_NAMESPACES),
        canEnable: true,
      });
      return;
    }
    if (metadataRead.status === 'account_mismatch') {
      this.publish({
        ...baseSnapshot(true, this.deviceId),
        userId,
        phase: 'account_mismatch',
        enrollment: 'blocked',
        message: messageForPhase('account_mismatch', DISABLED_NAMESPACES),
      });
      return;
    }
    if (metadataRead.status === 'corrupt' || metadataRead.metadata.syncMode === 'attention') {
      this.publish({
        ...baseSnapshot(true, this.deviceId),
        userId,
        phase: 'attention',
        enrollment: 'blocked',
        message: metadataRead.status === 'corrupt'
          ? metadataRead.message
          : 'Persisted account sync metadata needs attention.',
      });
      return;
    }

    const local = readCanonicalLocalState(this.options.storage);
    if (local.status !== 'ok') {
      this.publish({
        ...baseSnapshot(true, this.deviceId),
        userId,
        phase: 'attention',
        enrollment: 'blocked',
        message: 'Local durable state is corrupt or unsupported. Nothing was synchronized.',
      });
      return;
    }

    const client = this.options.clientForUser(userId);
    const coordinator = this.createCoordinator(userId, client, generation);
    this.coordinator = coordinator;
    this.publish({
      ...baseSnapshot(true, this.deviceId),
      userId,
      phase: 'verifying',
      enrollment: 'enabled',
      message: messageForPhase('verifying', DISABLED_NAMESPACES),
      canSyncNow: false,
    });

    const reconciliation = await coordinator.syncNow();
    if (!this.isCurrent(generation, userId) || this.coordinator !== coordinator) {
      coordinator.setAuthenticatedUser(null);
      coordinator.dispose();
      return;
    }
    if (reconciliationAllowsListener(reconciliation)) this.attachListener();
    this.publishFromCoordinator();
  }

  private createCoordinator(
    userId: string,
    client: ProductionSyncClient,
    generation: number,
  ): DormantLocalFirstSyncCoordinator {
    const coordinator = createDormantLocalFirstSyncCoordinator({
      userId,
      client,
      storage: this.options.storage,
      ...(this.options.debounceMs === undefined ? {} : { debounceMs: this.options.debounceMs }),
      ...(this.options.retryDelaysMs === undefined ? {} : { retryDelaysMs: this.options.retryDelaysMs }),
      ...(this.options.now === undefined ? {} : { now: this.options.now }),
      ...(this.options.delay === undefined ? {} : { delay: this.options.delay }),
      ...(this.options.setTimer === undefined ? {} : { setTimer: this.options.setTimer }),
      ...(this.options.clearTimer === undefined ? {} : { clearTimer: this.options.clearTimer }),
      ...(this.options.pullOptions === undefined ? {} : { pullOptions: this.options.pullOptions }),
      onDiagnosticEvent: event => this.options.onDiagnosticEvent?.(event),
      onSnapshotChange: () => {
        if (this.isCurrent(generation, userId) && this.coordinator === coordinator) {
          this.publishFromCoordinator();
        }
      },
    });
    return coordinator;
  }

  private attachListener(): void {
    if (!this.coordinator || this.listenerAttached) return;
    this.coordinator.attachMutationEvents();
    this.listenerAttached = true;
  }

  private publishFromCoordinator(): void {
    if (!this.coordinator || !this.currentUserId) return;
    const coordinatorSnapshot = this.coordinator.getSnapshot();
    const metadata = this.coordinator.getMetadata();
    const phase = phaseFromOverall(coordinatorSnapshot.overall);
    this.publish({
      featureEnabled: true,
      userId: this.currentUserId,
      phase,
      enrollment: 'enabled',
      overall: coordinatorSnapshot.overall,
      namespaces: coordinatorSnapshot.namespaces,
      conflicts: coordinatorSnapshot.conflicts,
      deviceId: this.deviceId,
      deviceLabel: localDeviceLabel(),
      lastSuccessfulSyncAt: latestSuccessfulTimestamp(metadata),
      message: messageForPhase(phase, coordinatorSnapshot.namespaces),
      canEnable: false,
      canSyncNow: true,
    });
  }

  private teardownCoordinator(): void {
    if (this.coordinator) {
      this.coordinator.setAuthenticatedUser(null);
      this.coordinator.dispose();
    }
    this.coordinator = null;
    this.listenerAttached = false;
  }

  private isCurrent(generation: number, userId: string): boolean {
    return generation === this.generation && this.currentUserId === userId;
  }

  private publish(next: ProductionSyncSnapshot): void {
    this.snapshot = {
      ...next,
      namespaces: { ...next.namespaces },
      conflicts: { ...next.conflicts },
    };
    const snapshot = this.getSnapshot();
    for (const subscriber of this.subscribers) subscriber(snapshot);
  }
}

export function createProductionCloudSyncManager(
  options: ProductionSyncManagerOptions,
): ProductionCloudSyncManager {
  return new ProductionCloudSyncManager(options);
}

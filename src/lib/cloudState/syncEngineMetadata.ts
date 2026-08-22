import { isIsoTimestamp, isRecord, type StorageLike } from '../durableStorage.ts';
import type { CanonicalLocalState } from './localState.ts';
import { fingerprintCloudState, fingerprintInitialization, isSyncFingerprint, type SyncFingerprint } from './syncFingerprint.ts';
import type { CloudSyncMetadataV1 } from './syncMetadata.ts';
import { CLOUD_STATE_NAMESPACES, type CloudNamespace, type CloudStateSet } from './types.ts';

export const SYNC_ENGINE_METADATA_KEY = 'put_scanner_cloud_sync_engine:v1';
export const SYNC_ENGINE_METADATA_VERSION = 1 as const;

export type DeviceSyncMode = 'disabled' | 'eligible' | 'enabled' | 'attention';
export type NamespaceSyncStatus =
  | 'disabled'
  | 'synced'
  | 'pending'
  | 'syncing'
  | 'offline'
  | 'conflict'
  | 'attention';

export interface OngoingNamespaceSyncMetadata {
  cloudRevision: number | null;
  lastSyncedFingerprint: SyncFingerprint | null;
  lastSyncedAt: string | null;
  status: NamespaceSyncStatus;
  pendingFingerprint: SyncFingerprint | null;
}

export interface OngoingSyncMetadataV1 {
  version: typeof SYNC_ENGINE_METADATA_VERSION;
  userId: string;
  syncMode: DeviceSyncMode;
  namespaces: Record<CloudNamespace, OngoingNamespaceSyncMetadata>;
  lastReconciledAt: string | null;
}

export type OngoingSyncMetadataReadResult =
  | { status: 'ok'; metadata: OngoingSyncMetadataV1 }
  | { status: 'missing' }
  | { status: 'account_mismatch'; storedUserId: string }
  | { status: 'corrupt'; message: string };

export type OngoingSyncMetadataWriteResult =
  | { status: 'ok' }
  | { status: 'error'; message: string };

const MODES = new Set<DeviceSyncMode>(['disabled', 'eligible', 'enabled', 'attention']);
const STATUSES = new Set<NamespaceSyncStatus>([
  'disabled',
  'synced',
  'pending',
  'syncing',
  'offline',
  'conflict',
  'attention',
]);

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return actual.length === sortedExpected.length
    && actual.every((key, index) => key === sortedExpected[index]);
}

function nullableTimestamp(value: unknown): value is string | null {
  return value === null || isIsoTimestamp(value);
}

function validateNamespaceMetadata(value: unknown): OngoingNamespaceSyncMetadata | null {
  if (!isRecord(value)
    || !exactKeys(value, [
      'cloudRevision',
      'lastSyncedFingerprint',
      'lastSyncedAt',
      'status',
      'pendingFingerprint',
    ])
    || (value.cloudRevision !== null
      && (!Number.isSafeInteger(value.cloudRevision) || Number(value.cloudRevision) <= 0))
    || (value.lastSyncedFingerprint !== null && !isSyncFingerprint(value.lastSyncedFingerprint))
    || !nullableTimestamp(value.lastSyncedAt)
    || typeof value.status !== 'string'
    || !STATUSES.has(value.status as NamespaceSyncStatus)
    || (value.pendingFingerprint !== null && !isSyncFingerprint(value.pendingFingerprint))) return null;

  if ((value.cloudRevision === null) !== (value.lastSyncedFingerprint === null)
    || (value.cloudRevision === null) !== (value.lastSyncedAt === null)) return null;

  return {
    cloudRevision: value.cloudRevision === null ? null : Number(value.cloudRevision),
    lastSyncedFingerprint: value.lastSyncedFingerprint as SyncFingerprint | null,
    lastSyncedAt: value.lastSyncedAt === null ? null : new Date(value.lastSyncedAt).toISOString(),
    status: value.status as NamespaceSyncStatus,
    pendingFingerprint: value.pendingFingerprint as SyncFingerprint | null,
  };
}

export function validateOngoingSyncMetadata(value: unknown): OngoingSyncMetadataV1 | null {
  if (!isRecord(value)
    || !exactKeys(value, ['version', 'userId', 'syncMode', 'namespaces', 'lastReconciledAt'])
    || value.version !== SYNC_ENGINE_METADATA_VERSION
    || typeof value.userId !== 'string'
    || !value.userId.trim()
    || typeof value.syncMode !== 'string'
    || !MODES.has(value.syncMode as DeviceSyncMode)
    || !isRecord(value.namespaces)
    || !exactKeys(value.namespaces, CLOUD_STATE_NAMESPACES)
    || !nullableTimestamp(value.lastReconciledAt)) return null;

  const rawNamespaces = value.namespaces as Record<string, unknown>;
  const namespaces = Object.fromEntries(CLOUD_STATE_NAMESPACES.map(namespace => (
    [namespace, validateNamespaceMetadata(rawNamespaces[namespace])]
  ))) as Record<CloudNamespace, OngoingNamespaceSyncMetadata | null>;
  if (CLOUD_STATE_NAMESPACES.some(namespace => namespaces[namespace] === null)) return null;

  if ((value.syncMode === 'eligible' || value.syncMode === 'enabled')
    && CLOUD_STATE_NAMESPACES.some(namespace => namespaces[namespace]?.cloudRevision === null)) return null;

  return {
    version: SYNC_ENGINE_METADATA_VERSION,
    userId: value.userId.trim(),
    syncMode: value.syncMode as DeviceSyncMode,
    namespaces: namespaces as Record<CloudNamespace, OngoingNamespaceSyncMetadata>,
    lastReconciledAt: value.lastReconciledAt === null
      ? null
      : new Date(value.lastReconciledAt).toISOString(),
  };
}

export function readOngoingSyncMetadata(
  storage: Pick<StorageLike, 'getItem'>,
  authenticatedUserId: string,
): OngoingSyncMetadataReadResult {
  const userId = authenticatedUserId.trim();
  if (!userId) return { status: 'corrupt', message: 'Ongoing sync metadata requires an authenticated user.' };
  let raw: string | null;
  try {
    raw = storage.getItem(SYNC_ENGINE_METADATA_KEY);
  } catch {
    return { status: 'corrupt', message: 'Ongoing sync metadata could not be read.' };
  }
  if (raw === null) return { status: 'missing' };
  try {
    const metadata = validateOngoingSyncMetadata(JSON.parse(raw) as unknown);
    if (!metadata) return { status: 'corrupt', message: 'Ongoing sync metadata is invalid.' };
    if (metadata.userId !== userId) {
      return { status: 'account_mismatch', storedUserId: metadata.userId };
    }
    return { status: 'ok', metadata };
  } catch {
    return { status: 'corrupt', message: 'Ongoing sync metadata is malformed.' };
  }
}

export function writeOngoingSyncMetadata(
  storage: Pick<StorageLike, 'setItem'>,
  metadata: OngoingSyncMetadataV1,
): OngoingSyncMetadataWriteResult {
  const validated = validateOngoingSyncMetadata(metadata);
  if (!validated) return { status: 'error', message: 'Ongoing sync metadata is invalid and was not written.' };
  try {
    storage.setItem(SYNC_ENGINE_METADATA_KEY, JSON.stringify(validated));
    return { status: 'ok' };
  } catch {
    return { status: 'error', message: 'Ongoing sync metadata could not be written.' };
  }
}

export function createEligibleOngoingSyncMetadata(
  userId: string,
  stage4Metadata: CloudSyncMetadataV1,
  local: CanonicalLocalState,
  cloud: CloudStateSet,
  now = new Date(),
): { ok: true; metadata: OngoingSyncMetadataV1 } | { ok: false; reason: string } {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId || stage4Metadata.userId !== normalizedUserId) {
    return { ok: false, reason: 'The authenticated account does not match verified device metadata.' };
  }
  if (stage4Metadata.migrationState !== 'migration_verified') {
    return { ok: false, reason: 'The device has not completed a verified migration or restore.' };
  }

  const localFingerprints = fingerprintInitialization(local.documents);
  const cloudFingerprints = fingerprintCloudState(cloud);
  const eligible = CLOUD_STATE_NAMESPACES.every(namespace => (
    cloud[namespace].userId === normalizedUserId
    && cloud[namespace].namespace === namespace
    && stage4Metadata.namespaces[namespace].cloudRevision === cloud[namespace].revision
    && stage4Metadata.namespaces[namespace].lastSyncedLocalUpdatedAt === local.localUpdatedAt[namespace]
    && stage4Metadata.namespaces[namespace].lastSyncedAt !== null
    && localFingerprints[namespace] === cloudFingerprints[namespace]
  ));
  if (!eligible) {
    return { ok: false, reason: 'Local state no longer matches the last verified cloud state.' };
  }

  const timestamp = now.toISOString();
  return {
    ok: true,
    metadata: {
      version: SYNC_ENGINE_METADATA_VERSION,
      userId: normalizedUserId,
      syncMode: 'eligible',
      namespaces: Object.fromEntries(CLOUD_STATE_NAMESPACES.map(namespace => [namespace, {
        cloudRevision: cloud[namespace].revision,
        lastSyncedFingerprint: cloudFingerprints[namespace],
        lastSyncedAt: stage4Metadata.namespaces[namespace].lastSyncedAt,
        status: 'disabled',
        pendingFingerprint: null,
      }])) as Record<CloudNamespace, OngoingNamespaceSyncMetadata>,
      lastReconciledAt: timestamp,
    },
  };
}

export function enableEligibleOngoingSync(metadata: OngoingSyncMetadataV1): OngoingSyncMetadataV1 {
  if (metadata.syncMode !== 'eligible') throw new Error('Only verified eligible device metadata can enable sync.');
  return {
    ...metadata,
    syncMode: 'enabled',
    namespaces: Object.fromEntries(CLOUD_STATE_NAMESPACES.map(namespace => [namespace, {
      ...metadata.namespaces[namespace],
      status: 'synced',
      pendingFingerprint: null,
    }])) as Record<CloudNamespace, OngoingNamespaceSyncMetadata>,
  };
}

export function cloneOngoingSyncMetadata(metadata: OngoingSyncMetadataV1): OngoingSyncMetadataV1 {
  return {
    ...metadata,
    namespaces: Object.fromEntries(CLOUD_STATE_NAMESPACES.map(namespace => (
      [namespace, { ...metadata.namespaces[namespace] }]
    ))) as Record<CloudNamespace, OngoingNamespaceSyncMetadata>,
  };
}

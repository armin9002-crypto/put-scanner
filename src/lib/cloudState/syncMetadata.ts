import { isIsoTimestamp, isRecord, type StorageLike } from '../durableStorage.ts';
import { CLOUD_STATE_NAMESPACES, type CloudNamespace, type MigrationState } from './types.ts';

export const CLOUD_SYNC_METADATA_KEY = 'put_scanner_cloud_sync_meta:v1';
export const CLOUD_SYNC_METADATA_VERSION = 1 as const;

export interface NamespaceSyncMetadata {
  cloudRevision: number | null;
  lastSyncedLocalUpdatedAt: string | null;
  lastSyncedAt: string | null;
}

export interface CloudSyncMetadataV1 {
  version: typeof CLOUD_SYNC_METADATA_VERSION;
  userId: string;
  namespaces: Record<CloudNamespace, NamespaceSyncMetadata>;
  migrationState: MigrationState;
  lastCloudCheckAt: string | null;
}

export type SyncMetadataReadResult =
  | { status: 'ok'; metadata: CloudSyncMetadataV1 }
  | { status: 'missing'; metadata: CloudSyncMetadataV1 }
  | { status: 'account_mismatch'; storedUserId: string; metadata: CloudSyncMetadataV1 }
  | { status: 'corrupt'; message: string };

export type SyncMetadataWriteResult =
  | { status: 'ok' }
  | { status: 'error'; message: string };

const MIGRATION_STATES = new Set<MigrationState>([
  'not_checked',
  'cloud_empty_local_empty',
  'cloud_empty_local_has_data',
  'cloud_has_data_local_empty',
  'both_have_data',
  'migration_ready',
  'migration_in_progress',
  'migration_verified',
  'conflict',
  'error',
]);

function emptyNamespaceMetadata(): NamespaceSyncMetadata {
  return { cloudRevision: null, lastSyncedLocalUpdatedAt: null, lastSyncedAt: null };
}

export function createCloudSyncMetadata(userId: string): CloudSyncMetadataV1 {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) throw new Error('Cloud sync metadata requires a user id.');
  return {
    version: CLOUD_SYNC_METADATA_VERSION,
    userId: normalizedUserId,
    namespaces: {
      portfolio: emptyNamespaceMetadata(),
      watchlist: emptyNamespaceMetadata(),
      preferences: emptyNamespaceMetadata(),
    },
    migrationState: 'not_checked',
    lastCloudCheckAt: null,
  };
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function nullableTimestamp(value: unknown): value is string | null {
  return value === null || isIsoTimestamp(value);
}

function validateNamespaceMetadata(value: unknown): NamespaceSyncMetadata | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['cloudRevision', 'lastSyncedLocalUpdatedAt', 'lastSyncedAt'])) return null;
  if (value.cloudRevision !== null
    && (!Number.isSafeInteger(value.cloudRevision) || Number(value.cloudRevision) <= 0)) return null;
  if (!nullableTimestamp(value.lastSyncedLocalUpdatedAt) || !nullableTimestamp(value.lastSyncedAt)) return null;
  return {
    cloudRevision: value.cloudRevision === null ? null : Number(value.cloudRevision),
    lastSyncedLocalUpdatedAt: value.lastSyncedLocalUpdatedAt === null
      ? null
      : new Date(value.lastSyncedLocalUpdatedAt).toISOString(),
    lastSyncedAt: value.lastSyncedAt === null ? null : new Date(value.lastSyncedAt).toISOString(),
  };
}

export function validateCloudSyncMetadata(value: unknown): CloudSyncMetadataV1 | null {
  if (!isRecord(value)
    || !hasExactKeys(value, ['version', 'userId', 'namespaces', 'migrationState', 'lastCloudCheckAt'])
    || value.version !== CLOUD_SYNC_METADATA_VERSION
    || typeof value.userId !== 'string'
    || !value.userId.trim()
    || typeof value.migrationState !== 'string'
    || !MIGRATION_STATES.has(value.migrationState as MigrationState)
    || !nullableTimestamp(value.lastCloudCheckAt)
    || !isRecord(value.namespaces)
    || !hasExactKeys(value.namespaces, CLOUD_STATE_NAMESPACES)) return null;

  const rawNamespaces = value.namespaces;
  const namespaces = Object.fromEntries(CLOUD_STATE_NAMESPACES.map(namespace => (
    [namespace, validateNamespaceMetadata(rawNamespaces[namespace])]
  ))) as Record<CloudNamespace, NamespaceSyncMetadata | null>;
  if (CLOUD_STATE_NAMESPACES.some(namespace => namespaces[namespace] === null)) return null;

  return {
    version: CLOUD_SYNC_METADATA_VERSION,
    userId: value.userId.trim(),
    namespaces: namespaces as Record<CloudNamespace, NamespaceSyncMetadata>,
    migrationState: value.migrationState as MigrationState,
    lastCloudCheckAt: value.lastCloudCheckAt === null ? null : new Date(value.lastCloudCheckAt).toISOString(),
  };
}

export function readCloudSyncMetadata(
  storage: Pick<StorageLike, 'getItem'>,
  authenticatedUserId: string,
): SyncMetadataReadResult {
  const normalizedUserId = authenticatedUserId.trim();
  if (!normalizedUserId) {
    return { status: 'corrupt', message: 'Cloud sync metadata requires an authenticated user id; durable local data was not changed.' };
  }
  let raw: string | null;
  try {
    raw = storage.getItem(CLOUD_SYNC_METADATA_KEY);
  } catch {
    return { status: 'corrupt', message: 'Cloud sync metadata could not be read; durable local data was not changed.' };
  }
  if (raw === null) return { status: 'missing', metadata: createCloudSyncMetadata(normalizedUserId) };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return { status: 'corrupt', message: 'Cloud sync metadata is malformed; durable local data was not changed.' };
  }
  const metadata = validateCloudSyncMetadata(parsed);
  if (!metadata) {
    return { status: 'corrupt', message: 'Cloud sync metadata is invalid; durable local data was not changed.' };
  }
  if (metadata.userId !== normalizedUserId) {
    return {
      status: 'account_mismatch',
      storedUserId: metadata.userId,
      metadata: createCloudSyncMetadata(normalizedUserId),
    };
  }
  return { status: 'ok', metadata };
}

export function writeCloudSyncMetadata(
  storage: Pick<StorageLike, 'setItem'>,
  metadata: CloudSyncMetadataV1,
): SyncMetadataWriteResult {
  const validated = validateCloudSyncMetadata(metadata);
  if (!validated) return { status: 'error', message: 'Cloud sync metadata is invalid and was not written.' };
  try {
    storage.setItem(CLOUD_SYNC_METADATA_KEY, JSON.stringify(validated));
    return { status: 'ok' };
  } catch {
    return { status: 'error', message: 'Cloud sync metadata could not be written.' };
  }
}

import type { StorageLike } from '../durableStorage.ts';
import type { DormantCloudStateClient } from './cloudStateClient.ts';
import type { CanonicalLocalState } from './localState.ts';
import { readCanonicalLocalState } from './localState.ts';
import { restoreCloudStateToLocal, type LocalRestoreTestHooks } from './localRestore.ts';
import { initializationMatchesCloud } from './stateComparison.ts';
import {
  createCloudSyncMetadata,
  readCloudSyncMetadata,
  writeCloudSyncMetadata,
  type CloudSyncMetadataV1,
} from './syncMetadata.ts';
import type { CloudStateSet, CloudStateSnapshot } from './types.ts';

type InitializationClient = Pick<
  DormantCloudStateClient,
  'fetchAllUserState' | 'initializeAllNamespaces'
>;
type RestoreClient = Pick<DormantCloudStateClient, 'fetchAllUserState'>;

export type TestInitializationResult =
  | { ok: true; cloud: CloudStateSet; metadata: CloudSyncMetadataV1; metadataWritten: boolean }
  | {
      ok: false;
      code:
        | 'backup_required'
        | 'local_invalid'
        | 'local_empty'
        | 'metadata_conflict'
        | 'cloud_check_failed'
        | 'cloud_conflict'
        | 'initialization_failed'
        | 'verification_failed';
      message: string;
    };

export type TestRestoreResult =
  | { ok: true; cloud: CloudStateSet; local: CanonicalLocalState; metadata: CloudSyncMetadataV1; metadataWritten: boolean }
  | {
      ok: false;
      code:
        | 'local_invalid'
        | 'local_not_empty'
        | 'metadata_conflict'
        | 'cloud_check_failed'
        | 'cloud_empty'
        | 'restore_failed';
      message: string;
    };

function metadataConflict(storage: StorageLike, userId: string): string | null {
  const metadata = readCloudSyncMetadata(storage, userId);
  if (metadata.status === 'account_mismatch') {
    return 'Sync metadata belongs to another account. Migration and restore are blocked.';
  }
  if (metadata.status === 'corrupt') return metadata.message;
  return null;
}

export function createVerifiedSyncMetadata(
  userId: string,
  cloud: CloudStateSet,
  local: CanonicalLocalState,
  now = new Date(),
): CloudSyncMetadataV1 {
  const timestamp = now.toISOString();
  const metadata = createCloudSyncMetadata(userId);
  metadata.migrationState = 'migration_verified';
  metadata.lastCloudCheckAt = timestamp;
  for (const namespace of ['portfolio', 'watchlist', 'preferences'] as const) {
    metadata.namespaces[namespace] = {
      cloudRevision: cloud[namespace].revision,
      lastSyncedLocalUpdatedAt: local.localUpdatedAt[namespace],
      lastSyncedAt: timestamp,
    };
  }
  return metadata;
}

export async function initializeTestAccountAfterFreshCheck(
  client: InitializationClient,
  storage: StorageLike,
  userId: string,
  backupAcknowledgedThisSession: boolean,
  now = new Date(),
): Promise<TestInitializationResult> {
  if (!backupAcknowledgedThisSession) {
    return { ok: false, code: 'backup_required', message: 'A fresh backup is required in this migration session.' };
  }
  const local = readCanonicalLocalState(storage);
  if (local.status !== 'ok') {
    return { ok: false, code: 'local_invalid', message: 'Local durable state is corrupt or unsupported.' };
  }
  if (!local.value.summary.hasMeaningfulData) {
    return { ok: false, code: 'local_empty', message: 'There is no meaningful local durable state to initialize.' };
  }
  const conflict = metadataConflict(storage, userId);
  if (conflict) return { ok: false, code: 'metadata_conflict', message: conflict };

  const fresh = await client.fetchAllUserState();
  if (!fresh.ok) return { ok: false, code: 'cloud_check_failed', message: fresh.error.message };
  if (fresh.value.status !== 'empty') {
    return {
      ok: false,
      code: 'cloud_conflict',
      message: 'Cloud state changed after the earlier check. Initialization was not attempted.',
    };
  }

  const initialized = await client.initializeAllNamespaces(local.value.documents);
  if (!initialized.ok) {
    return { ok: false, code: 'initialization_failed', message: initialized.error.message };
  }
  if (!initializationMatchesCloud(local.value.documents, initialized.value)) {
    return { ok: false, code: 'verification_failed', message: 'Cloud read-back did not match the exact local canonical state.' };
  }

  const metadata = createVerifiedSyncMetadata(userId, initialized.value, local.value, now);
  const metadataWritten = writeCloudSyncMetadata(storage, metadata).status === 'ok';
  return { ok: true, cloud: initialized.value, metadata, metadataWritten };
}

export async function restoreTestAccountAfterFreshFetch(
  client: RestoreClient,
  storage: StorageLike,
  userId: string,
  options: { now?: Date; testHooks?: LocalRestoreTestHooks } = {},
): Promise<TestRestoreResult> {
  const localBefore = readCanonicalLocalState(storage);
  if (localBefore.status !== 'ok') {
    return { ok: false, code: 'local_invalid', message: 'Local durable state is corrupt or unsupported.' };
  }
  if (localBefore.value.summary.hasMeaningfulData) {
    return { ok: false, code: 'local_not_empty', message: 'This browser already contains Put Scanner data. Restore is blocked.' };
  }
  const conflict = metadataConflict(storage, userId);
  if (conflict) return { ok: false, code: 'metadata_conflict', message: conflict };

  const fetched = await client.fetchAllUserState();
  if (!fetched.ok) return { ok: false, code: 'cloud_check_failed', message: fetched.error.message };
  if (fetched.value.status !== 'complete') {
    return { ok: false, code: 'cloud_empty', message: 'No complete cloud state is available to restore.' };
  }
  const restored = restoreCloudStateToLocal(
    storage,
    fetched.value.state,
    userId,
    { now: options.now, testHooks: options.testHooks },
  );
  if (!restored.ok) return { ok: false, code: 'restore_failed', message: restored.message };

  const local = readCanonicalLocalState(storage);
  if (local.status !== 'ok' || !initializationMatchesCloud(local.value.documents, restored.cloud)) {
    return { ok: false, code: 'restore_failed', message: 'Restored local state did not match validated cloud state.' };
  }
  const metadata = createVerifiedSyncMetadata(userId, restored.cloud, local.value, options.now);
  const metadataWritten = writeCloudSyncMetadata(storage, metadata).status === 'ok';
  return { ok: true, cloud: restored.cloud, local: local.value, metadata, metadataWritten };
}

export function cloudAssessmentFromSnapshot(snapshot: CloudStateSnapshot):
  | { status: 'empty' }
  | { status: 'complete'; hasMeaningfulData: boolean; comparison: 'not_compared' } {
  if (snapshot.status === 'empty') return { status: 'empty' };
  const state = snapshot.state;
  const hasMeaningfulData = state.portfolio.payload.data.length > 0
    || state.watchlist.payload.data.length > 0
    || Object.keys(state.preferences.payload.data).length > 0;
  return { status: 'complete', hasMeaningfulData, comparison: 'not_compared' };
}

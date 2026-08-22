import type { StorageLike } from '../durableStorage.ts';
import type { DormantCloudStateClient } from './cloudStateClient.ts';
import {
  captureDurableLocalRecoverySnapshot,
  durableLocalSnapshotMatches,
  restoreCloudStateToLocal,
  type LocalRestoreTestHooks,
} from './localRestore.ts';
import {
  readCanonicalLocalState,
  summarizeCloudState,
  type CanonicalLocalState,
} from './localState.ts';
import { planCloudMigration, type MigrationPlan } from './migrationPlanner.ts';
import { canonicalJsonEqual, initializationMatchesCloud } from './stateComparison.ts';
import {
  createCloudSyncMetadata,
  readCloudSyncMetadata,
  writeCloudSyncMetadata,
  type CloudSyncMetadataV1,
} from './syncMetadata.ts';
import type {
  CloudStateAssessment,
  CloudStateErrorCode,
  CloudInitializationInput,
  CloudStateSet,
  CloudStateSnapshot,
  LocalDataPresenceSummary,
} from './types.ts';

type InspectionClient = Pick<DormantCloudStateClient, 'fetchAllUserState'>;
type InitializationClient = Pick<
  DormantCloudStateClient,
  'fetchAllUserState' | 'initializeAllNamespaces'
>;

export interface AccountDataInspection {
  local: CanonicalLocalState;
  localAssessment: LocalDataPresenceSummary;
  cloud: CloudStateSnapshot;
  cloudAssessment: CloudStateAssessment;
  cloudSummary: LocalDataPresenceSummary | null;
  syncIdentity: 'none' | 'match';
  plan: MigrationPlan;
}

export type AccountDataInspectionResult =
  | { ok: true; value: AccountDataInspection }
  | {
      ok: false;
      code: 'local_invalid' | 'metadata_conflict' | 'metadata_invalid' | 'cloud_check_failed';
      message: string;
      errorCode?: CloudStateErrorCode;
    };

export type AccountInitializationResult =
  | {
      ok: true;
      cloud: CloudStateSet;
      local: CanonicalLocalState;
      metadata: CloudSyncMetadataV1;
      metadataWritten: boolean;
    }
  | {
      ok: false;
      code:
        | 'backup_required'
        | 'confirmation_required'
        | 'local_invalid'
        | 'local_empty'
        | 'metadata_conflict'
        | 'cloud_check_failed'
        | 'cloud_conflict'
        | 'initialization_failed'
        | 'verification_failed'
        | 'local_changed';
      message: string;
    };

export type AccountRestoreResult =
  | {
      ok: true;
      cloud: CloudStateSet;
      local: CanonicalLocalState;
      metadata: CloudSyncMetadataV1;
      metadataWritten: boolean;
    }
  | {
      ok: false;
      code:
        | 'confirmation_required'
        | 'local_invalid'
        | 'local_not_empty'
        | 'metadata_conflict'
        | 'cloud_check_failed'
        | 'cloud_empty'
        | 'restore_failed';
      message: string;
    };

function metadataConflict(storage: StorageLike, userId: string):
  | { code: 'metadata_conflict' | 'metadata_invalid'; message: string }
  | null {
  const metadata = readCloudSyncMetadata(storage, userId);
  if (metadata.status === 'account_mismatch') {
    return {
      code: 'metadata_conflict',
      message: 'This browser was previously associated with another Put Scanner account. No data has been changed.',
    };
  }
  if (metadata.status === 'corrupt') return { code: 'metadata_invalid', message: metadata.message };
  return null;
}

function verifiedMetadataMatches(
  metadata: CloudSyncMetadataV1,
  local: CanonicalLocalState,
  cloud: CloudStateSet,
): boolean {
  return metadata.migrationState === 'migration_verified'
    && initializationMatchesCloud(local.documents, cloud)
    && (['portfolio', 'watchlist', 'preferences'] as const).every(namespace => (
      metadata.namespaces[namespace].cloudRevision === cloud[namespace].revision
      && metadata.namespaces[namespace].lastSyncedLocalUpdatedAt === local.localUpdatedAt[namespace]
      && metadata.namespaces[namespace].lastSyncedAt !== null
    ));
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

export async function inspectAccountData(
  client: InspectionClient,
  storage: StorageLike,
  userId: string,
): Promise<AccountDataInspectionResult> {
  const local = readCanonicalLocalState(storage);
  if (local.status !== 'ok') {
    return {
      ok: false,
      code: 'local_invalid',
      message: 'Local durable state is corrupt or uses an unsupported schema.',
    };
  }

  const conflict = metadataConflict(storage, userId);
  if (conflict) return { ok: false, ...conflict };
  const metadataRead = readCloudSyncMetadata(storage, userId);
  const syncIdentity = metadataRead.status === 'missing' ? 'none' : 'match';

  const fetched = await client.fetchAllUserState();
  if (!fetched.ok) {
    return {
      ok: false,
      code: 'cloud_check_failed',
      message: fetched.error.message,
      errorCode: fetched.error.code,
    };
  }

  const cloudAssessment: CloudStateAssessment = fetched.value.status === 'empty'
    ? { status: 'empty' }
    : {
        status: 'complete',
        hasMeaningfulData: summarizeCloudState(fetched.value.state).hasMeaningfulData,
        comparison: initializationMatchesCloud(local.value.documents, fetched.value.state)
          ? 'equal'
          : 'different',
      };
  const phase = fetched.value.status === 'complete'
    && metadataRead.status === 'ok'
    && verifiedMetadataMatches(metadataRead.metadata, local.value, fetched.value.state)
      ? 'verified'
      : 'idle';
  const plan = planCloudMigration({
    local: local.value.summary,
    cloud: cloudAssessment,
    syncIdentity,
    backupAcknowledgedThisSession: false,
    phase,
  });

  return {
    ok: true,
    value: {
      local: local.value,
      localAssessment: local.value.summary,
      cloud: fetched.value,
      cloudAssessment,
      cloudSummary: fetched.value.status === 'complete' ? summarizeCloudState(fetched.value.state) : null,
      syncIdentity,
      plan,
    },
  };
}

export function planInspectedAccountData(
  inspection: AccountDataInspection,
  backupAcknowledgedThisSession: boolean,
): MigrationPlan {
  return planCloudMigration({
    local: inspection.localAssessment,
    cloud: inspection.cloudAssessment,
    syncIdentity: inspection.syncIdentity,
    backupAcknowledgedThisSession,
    phase: inspection.plan.state === 'migration_verified' ? 'verified' : 'idle',
  });
}

export async function initializeAccountAfterFreshCheck(
  client: InitializationClient,
  storage: StorageLike,
  userId: string,
  options: {
    backupAcknowledgedThisSession: boolean;
    confirmed: boolean;
    expectedLocalDocuments?: CloudInitializationInput;
    now?: Date;
  },
): Promise<AccountInitializationResult> {
  if (!options.backupAcknowledgedThisSession) {
    return { ok: false, code: 'backup_required', message: 'A fresh backup is required in this migration session.' };
  }
  if (!options.confirmed) {
    return { ok: false, code: 'confirmation_required', message: 'Saving account data requires explicit confirmation.' };
  }

  const local = readCanonicalLocalState(storage);
  if (local.status !== 'ok') {
    return { ok: false, code: 'local_invalid', message: 'Local durable state is corrupt or unsupported.' };
  }
  if (!local.value.summary.hasMeaningfulData) {
    return { ok: false, code: 'local_empty', message: 'There is no meaningful local durable state to initialize.' };
  }
  if (options.expectedLocalDocuments
    && !canonicalJsonEqual(local.value.documents, options.expectedLocalDocuments)) {
    return {
      ok: false,
      code: 'local_changed',
      message: 'Browser data changed after the status check. Nothing was uploaded. Reopen Account Data and review the current counts.',
    };
  }
  const conflict = metadataConflict(storage, userId);
  if (conflict) return { ok: false, code: 'metadata_conflict', message: conflict.message };

  let localBefore;
  try {
    localBefore = captureDurableLocalRecoverySnapshot(storage);
  } catch {
    return { ok: false, code: 'local_invalid', message: 'Local durable state could not be safely inventoried.' };
  }

  const fresh = await client.fetchAllUserState();
  if (!fresh.ok) return { ok: false, code: 'cloud_check_failed', message: fresh.error.message };
  if (fresh.value.status !== 'empty') {
    return {
      ok: false,
      code: 'cloud_conflict',
      message: 'Account data changed before migration could complete. Nothing was overwritten.',
    };
  }

  const initialized = await client.initializeAllNamespaces(local.value.documents);
  if (!initialized.ok) {
    return { ok: false, code: 'initialization_failed', message: initialized.error.message };
  }
  if (!initializationMatchesCloud(local.value.documents, initialized.value)) {
    return { ok: false, code: 'verification_failed', message: 'Cloud read-back did not match the exact local canonical state.' };
  }

  let localUnchanged = false;
  try {
    localUnchanged = durableLocalSnapshotMatches(storage, localBefore);
  } catch {
    localUnchanged = false;
  }
  if (!localUnchanged) {
    return {
      ok: false,
      code: 'local_changed',
      message: 'Browser data changed during verification. Verified sync metadata was not written.',
    };
  }

  const metadata = createVerifiedSyncMetadata(userId, initialized.value, local.value, options.now);
  const metadataWritten = writeCloudSyncMetadata(storage, metadata).status === 'ok';
  return { ok: true, cloud: initialized.value, local: local.value, metadata, metadataWritten };
}

export async function restoreAccountAfterFreshFetch(
  client: InspectionClient,
  storage: StorageLike,
  userId: string,
  options: {
    confirmed: boolean;
    now?: Date;
    testHooks?: LocalRestoreTestHooks;
  },
): Promise<AccountRestoreResult> {
  if (!options.confirmed) {
    return { ok: false, code: 'confirmation_required', message: 'Restoring account data requires explicit confirmation.' };
  }
  const localBefore = readCanonicalLocalState(storage);
  if (localBefore.status !== 'ok') {
    return { ok: false, code: 'local_invalid', message: 'Local durable state is corrupt or unsupported.' };
  }
  if (localBefore.value.summary.hasMeaningfulData) {
    return { ok: false, code: 'local_not_empty', message: 'This browser already contains Put Scanner data. Restore is blocked.' };
  }
  const conflict = metadataConflict(storage, userId);
  if (conflict) return { ok: false, code: 'metadata_conflict', message: conflict.message };

  const fetched = await client.fetchAllUserState();
  if (!fetched.ok) return { ok: false, code: 'cloud_check_failed', message: fetched.error.message };
  if (fetched.value.status !== 'complete') {
    return { ok: false, code: 'cloud_empty', message: 'No complete account data is available to restore.' };
  }

  const restored = restoreCloudStateToLocal(storage, fetched.value.state, userId, {
    now: options.now,
    testHooks: options.testHooks,
  });
  if (!restored.ok) return { ok: false, code: 'restore_failed', message: restored.message };

  const metadata = createVerifiedSyncMetadata(userId, restored.cloud, restored.local, options.now);
  const metadataWritten = writeCloudSyncMetadata(storage, metadata).status === 'ok';
  return {
    ok: true,
    cloud: restored.cloud,
    local: restored.local,
    metadata,
    metadataWritten,
  };
}

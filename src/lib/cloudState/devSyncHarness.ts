import type { StorageLike } from '../durableStorage.ts';
import { initializeAccountAfterFreshCheck } from './accountMigration.ts';
import type { DormantCloudStateClient } from './cloudStateClient.ts';
import {
  assessDisposableSyncTestCloud,
  assessDisposableSyncTestLocal,
  CLOUD_SYNC_TEST_BLOCK_MESSAGE,
  createDisposableLocalSyncTestData,
} from './devSyncFixture.ts';
import { isCloudSyncTestModeEnabled, type CloudSyncTestGateInput } from './devSyncTestMode.ts';
import {
  captureDurableLocalRecoverySnapshot,
  restoreDurableLocalRecoverySnapshot,
} from './localRestore.ts';
import {
  createEligibleOngoingSyncMetadata,
  enableEligibleOngoingSync,
  readOngoingSyncMetadata,
  writeOngoingSyncMetadata,
  type OngoingSyncMetadataV1,
} from './syncEngineMetadata.ts';
import { readCloudSyncMetadata } from './syncMetadata.ts';
import type { CloudStateSet, CloudStateSnapshot } from './types.ts';

export type SyncTestPreparationResult =
  | { ok: true; cloud: CloudStateSet; metadata: OngoingSyncMetadataV1 }
  | { ok: false; code: string; message: string };

export type SyncTestResumeAssessment =
  | { status: 'resumable'; metadata: OngoingSyncMetadataV1 }
  | {
      status: 'blocked';
      code:
        | 'test_gate_blocked'
        | 'local_invalid'
        | 'local_not_test_fixture'
        | 'metadata_missing'
        | 'metadata_account_mismatch'
        | 'metadata_corrupt'
        | 'not_previously_enabled'
        | 'metadata_baseline_incomplete';
      message: string;
    };

type HarnessClient = Pick<
  DormantCloudStateClient,
  'fetchAllUserState' | 'initializeAllNamespaces'
>;

export function assessDisposableSyncTestResume(
  storage: StorageLike,
  userId: string,
  gate: CloudSyncTestGateInput,
): SyncTestResumeAssessment {
  if (!isCloudSyncTestModeEnabled(gate)) {
    return { status: 'blocked', code: 'test_gate_blocked', message: 'The Stage 5 development test gate is not satisfied.' };
  }
  const local = assessDisposableSyncTestLocal(storage);
  if (local.status === 'invalid') return { status: 'blocked', code: 'local_invalid', message: local.message };
  if (local.status !== 'fixture') {
    return { status: 'blocked', code: 'local_not_test_fixture', message: 'Local Stage 5 disposable fixture verification failed.' };
  }
  const persisted = readOngoingSyncMetadata(storage, userId);
  if (persisted.status === 'missing') {
    return { status: 'blocked', code: 'metadata_missing', message: 'This device has no persisted Stage 5 synchronization baseline.' };
  }
  if (persisted.status === 'account_mismatch') {
    return { status: 'blocked', code: 'metadata_account_mismatch', message: 'Persisted synchronization metadata belongs to another account.' };
  }
  if (persisted.status === 'corrupt') {
    return { status: 'blocked', code: 'metadata_corrupt', message: persisted.message };
  }
  if (persisted.metadata.syncMode !== 'enabled') {
    return { status: 'blocked', code: 'not_previously_enabled', message: 'This device was not previously enabled for Stage 5 synchronization.' };
  }
  const completeBaseline = (['portfolio', 'watchlist', 'preferences'] as const).every(namespace => {
    const metadata = persisted.metadata.namespaces[namespace];
    return metadata.cloudRevision !== null
      && metadata.lastSyncedFingerprint !== null
      && metadata.lastSyncedAt !== null;
  });
  if (!completeBaseline) {
    return { status: 'blocked', code: 'metadata_baseline_incomplete', message: 'The persisted Stage 5 synchronization baseline is incomplete.' };
  }
  return { status: 'resumable', metadata: persisted.metadata };
}

export async function resumeDisposableSyncTest(
  client: Pick<DormantCloudStateClient, 'fetchAllUserState'>,
  storage: StorageLike,
  userId: string,
  gate: CloudSyncTestGateInput,
): Promise<SyncTestPreparationResult> {
  const resume = assessDisposableSyncTestResume(storage, userId, gate);
  if (resume.status !== 'resumable') return { ok: false, code: resume.code, message: resume.message };
  const inspected = await inspectDisposableSyncTestAccount(client);
  if (!inspected.ok) return { ok: false, code: 'cloud_check_failed', message: inspected.message };
  if (inspected.assessment.status === 'non_test') {
    return { ok: false, code: 'non_test_cloud', message: CLOUD_SYNC_TEST_BLOCK_MESSAGE };
  }
  if (inspected.assessment.status !== 'fixture') {
    return { ok: false, code: 'cloud_empty', message: 'The previously enabled disposable cloud fixture is missing.' };
  }
  const revalidated = assessDisposableSyncTestResume(storage, userId, gate);
  if (revalidated.status !== 'resumable') {
    return { ok: false, code: revalidated.code, message: revalidated.message };
  }
  // Do not rewrite or recreate the baseline from current cloud. The persisted
  // revisions/fingerprints are precisely what the next explicit Sync Now must
  // reconcile against.
  return { ok: true, cloud: inspected.assessment.cloud, metadata: revalidated.metadata };
}

function eligibilityFromVerifiedState(
  storage: StorageLike,
  userId: string,
  cloud: CloudStateSet,
  now: Date,
): SyncTestPreparationResult {
  const localAssessment = assessDisposableSyncTestLocal(storage);
  if (localAssessment.status !== 'fixture') {
    return { ok: false, code: 'local_not_test_fixture', message: 'Local Stage 5 disposable fixture verification failed.' };
  }
  const stage4 = readCloudSyncMetadata(storage, userId);
  if (stage4.status !== 'ok' || stage4.metadata.migrationState !== 'migration_verified') {
    return { ok: false, code: 'stage4_not_verified', message: 'Stage 4 verified migration or restore metadata is required.' };
  }
  const eligible = createEligibleOngoingSyncMetadata(userId, stage4.metadata, localAssessment.local, cloud, now);
  if (!eligible.ok) return { ok: false, code: 'not_eligible', message: eligible.reason };
  const written = writeOngoingSyncMetadata(storage, eligible.metadata);
  if (written.status !== 'ok') return { ok: false, code: 'metadata_write_failed', message: written.message };
  return { ok: true, cloud, metadata: eligible.metadata };
}

export async function inspectDisposableSyncTestAccount(
  client: Pick<DormantCloudStateClient, 'fetchAllUserState'>,
): Promise<
  | { ok: true; snapshot: CloudStateSnapshot; assessment: ReturnType<typeof assessDisposableSyncTestCloud> }
  | { ok: false; message: string }
> {
  const fetched = await client.fetchAllUserState();
  if (!fetched.ok) return { ok: false, message: fetched.error.message };
  return { ok: true, snapshot: fetched.value, assessment: assessDisposableSyncTestCloud(fetched.value) };
}

export async function prepareDisposableSyncTestAccount(
  client: HarnessClient,
  storage: StorageLike,
  userId: string,
  now = new Date(),
): Promise<SyncTestPreparationResult> {
  const localBefore = assessDisposableSyncTestLocal(storage);
  if (localBefore.status === 'invalid') return { ok: false, code: 'local_invalid', message: localBefore.message };
  if (localBefore.status !== 'empty') {
    return { ok: false, code: 'local_not_empty', message: 'This browser already contains Put Scanner data. Live synchronization setup is blocked.' };
  }

  const inspected = await inspectDisposableSyncTestAccount(client);
  if (!inspected.ok) return { ok: false, code: 'cloud_check_failed', message: inspected.message };
  if (inspected.assessment.status === 'non_test') {
    return { ok: false, code: 'non_test_cloud', message: CLOUD_SYNC_TEST_BLOCK_MESSAGE };
  }
  if (inspected.assessment.status !== 'empty') {
    return { ok: false, code: 'cloud_not_empty', message: 'The disposable account is already initialized. Nothing was overwritten.' };
  }

  const recovery = captureDurableLocalRecoverySnapshot(storage);
  const fixture = createDisposableLocalSyncTestData(storage, now);
  if (!fixture.ok) return fixture;
  const initialized = await initializeAccountAfterFreshCheck(client, storage, userId, {
    backupAcknowledgedThisSession: true,
    confirmed: true,
    expectedLocalDocuments: fixture.local.documents,
    now,
  });
  if (!initialized.ok) {
    restoreDurableLocalRecoverySnapshot(storage, recovery);
    return { ok: false, code: initialized.code, message: initialized.message };
  }
  if (!initialized.metadataWritten) {
    return { ok: false, code: 'stage4_metadata_write_failed', message: 'Cloud initialization was verified, but Stage 4 device metadata could not be written.' };
  }
  if (initialized.cloud.portfolio.revision !== 1
    || initialized.cloud.watchlist.revision !== 1
    || initialized.cloud.preferences.revision !== 1) {
    return { ok: false, code: 'unexpected_initial_revision', message: 'Disposable initialization did not return revision 1 for every namespace.' };
  }
  return eligibilityFromVerifiedState(storage, userId, initialized.cloud, now);
}

export async function establishDisposableSyncTestEligibility(
  client: Pick<DormantCloudStateClient, 'fetchAllUserState'>,
  storage: StorageLike,
  userId: string,
  now = new Date(),
): Promise<SyncTestPreparationResult> {
  const inspected = await inspectDisposableSyncTestAccount(client);
  if (!inspected.ok) return { ok: false, code: 'cloud_check_failed', message: inspected.message };
  if (inspected.assessment.status === 'non_test') {
    return { ok: false, code: 'non_test_cloud', message: CLOUD_SYNC_TEST_BLOCK_MESSAGE };
  }
  if (inspected.assessment.status !== 'fixture') {
    return { ok: false, code: 'cloud_empty', message: 'The disposable cloud fixture has not been prepared.' };
  }
  return eligibilityFromVerifiedState(storage, userId, inspected.assessment.cloud, now);
}

export async function enableDisposableSyncTest(
  client: Pick<DormantCloudStateClient, 'fetchAllUserState'>,
  storage: StorageLike,
  userId: string,
  now = new Date(),
): Promise<SyncTestPreparationResult> {
  const eligible = await establishDisposableSyncTestEligibility(client, storage, userId, now);
  if (!eligible.ok) return eligible;
  const enabled = enableEligibleOngoingSync(eligible.metadata);
  const written = writeOngoingSyncMetadata(storage, enabled);
  if (written.status !== 'ok') return { ok: false, code: 'metadata_write_failed', message: written.message };
  return { ok: true, cloud: eligible.cloud, metadata: enabled };
}

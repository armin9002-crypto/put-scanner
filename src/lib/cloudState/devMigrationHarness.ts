import type { StorageLike } from '../durableStorage.ts';
import type { DormantCloudStateClient } from './cloudStateClient.ts';
import {
  createVerifiedSyncMetadata,
  initializeAccountAfterFreshCheck,
  restoreAccountAfterFreshFetch,
  type AccountInitializationResult,
  type AccountRestoreResult,
} from './accountMigration.ts';
import type { LocalRestoreTestHooks } from './localRestore.ts';
import type { CloudStateSnapshot } from './types.ts';

type InitializationClient = Pick<
  DormantCloudStateClient,
  'fetchAllUserState' | 'initializeAllNamespaces'
>;
type RestoreClient = Pick<DormantCloudStateClient, 'fetchAllUserState'>;

export type TestInitializationResult = AccountInitializationResult;
export type TestRestoreResult = AccountRestoreResult;
export { createVerifiedSyncMetadata };

export function initializeTestAccountAfterFreshCheck(
  client: InitializationClient,
  storage: StorageLike,
  userId: string,
  backupAcknowledgedThisSession: boolean,
  now = new Date(),
): Promise<TestInitializationResult> {
  return initializeAccountAfterFreshCheck(client, storage, userId, {
    backupAcknowledgedThisSession,
    confirmed: true,
    now,
  });
}

export function restoreTestAccountAfterFreshFetch(
  client: RestoreClient,
  storage: StorageLike,
  userId: string,
  options: { now?: Date; testHooks?: LocalRestoreTestHooks } = {},
): Promise<TestRestoreResult> {
  return restoreAccountAfterFreshFetch(client, storage, userId, {
    confirmed: true,
    now: options.now,
    testHooks: options.testHooks,
  });
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

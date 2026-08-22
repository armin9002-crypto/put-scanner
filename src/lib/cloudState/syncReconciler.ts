import type { SyncFingerprint } from './syncFingerprint.ts';

export type SyncReconciliationClassification =
  | 'CLEAN'
  | 'LOCAL_AHEAD'
  | 'CLOUD_AHEAD'
  | 'BOTH_CHANGED'
  | 'CLOUD_MISSING'
  | 'INVALID'
  | 'ACCOUNT_MISMATCH';

export interface SyncReconciliationInput {
  accountMatches: boolean;
  localFingerprint: SyncFingerprint | null;
  lastSyncedFingerprint: SyncFingerprint | null;
  knownCloudRevision: number | null;
  cloud:
    | { status: 'missing' }
    | { status: 'invalid' }
    | { status: 'ok'; revision: number; fingerprint: SyncFingerprint };
}

export interface SyncReconciliationResult {
  classification: SyncReconciliationClassification;
  canPush: boolean;
  canPull: boolean;
  reason: string;
}

function result(
  classification: SyncReconciliationClassification,
  reason: string,
  action: { canPush?: boolean; canPull?: boolean } = {},
): SyncReconciliationResult {
  return {
    classification,
    canPush: action.canPush ?? false,
    canPull: action.canPull ?? false,
    reason,
  };
}

export function reconcileNamespace(input: SyncReconciliationInput): SyncReconciliationResult {
  if (!input.accountMatches) {
    return result('ACCOUNT_MISMATCH', 'Device metadata belongs to another authenticated account.');
  }
  if (input.localFingerprint === null
    || input.lastSyncedFingerprint === null
    || input.knownCloudRevision === null
    || !Number.isSafeInteger(input.knownCloudRevision)
    || input.knownCloudRevision <= 0
    || input.cloud.status === 'invalid') {
    return result('INVALID', 'Local, cloud, or revision state is not safe to reconcile.');
  }
  if (input.cloud.status === 'missing') {
    return result('CLOUD_MISSING', 'A previously synchronized cloud namespace is missing.');
  }
  if (!Number.isSafeInteger(input.cloud.revision)
    || input.cloud.revision <= 0
    || input.cloud.revision < input.knownCloudRevision) {
    return result('INVALID', 'Cloud revision moved backward or is invalid.');
  }

  const localChanged = input.localFingerprint !== input.lastSyncedFingerprint;
  const cloudAdvanced = input.cloud.revision > input.knownCloudRevision;

  if (!cloudAdvanced) {
    if (input.cloud.fingerprint !== input.lastSyncedFingerprint) {
      return result('INVALID', 'Cloud payload changed without advancing its revision.');
    }
    return localChanged
      ? result('LOCAL_AHEAD', 'Only local durable state changed.', { canPush: true })
      : result('CLEAN', 'Local and cloud state still match the verified baseline.');
  }

  if (localChanged) {
    return result('BOTH_CHANGED', 'Local durable state and the cloud revision both advanced.');
  }
  return result('CLOUD_AHEAD', 'Cloud state advanced while local durable state remained clean.', { canPull: true });
}

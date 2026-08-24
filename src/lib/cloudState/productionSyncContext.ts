import { createContext, useContext } from 'react';
import type { NamespaceSyncStatus, OngoingSyncMetadataV1 } from './syncEngineMetadata.ts';
import type { OverallSyncStatus, SyncNowResult } from './syncCoordinator.ts';
import type { ConflictRecoveryResult } from './syncCoordinator.ts';
import type { ConflictResolutionChoice, SyncConflictView } from './conflictRecovery.ts';
import type { CloudNamespace } from './types.ts';

export type ProductionSyncPhase =
  | 'disabled'
  | 'anonymous'
  | 'not_enrolled'
  | 'verifying'
  | 'synced'
  | 'syncing'
  | 'pending'
  | 'conflict'
  | 'account_mismatch'
  | 'unavailable'
  | 'attention';

export type ProductionSyncEnrollment = 'none' | 'enabled' | 'blocked';

export interface ProductionSyncSnapshot {
  featureEnabled: boolean;
  userId: string | null;
  phase: ProductionSyncPhase;
  enrollment: ProductionSyncEnrollment;
  overall: OverallSyncStatus | 'disabled';
  namespaces: Record<CloudNamespace, NamespaceSyncStatus>;
  conflicts: Partial<Record<CloudNamespace, SyncConflictView>>;
  deviceId: string | null;
  deviceLabel: string;
  lastSuccessfulSyncAt: string | null;
  message: string;
  canEnable: boolean;
  canSyncNow: boolean;
}

export type ProductionSyncActionResult =
  | { ok: true; metadata: OngoingSyncMetadataV1; reconciliation?: SyncNowResult }
  | { ok: false; code: string; message: string };

export interface ProductionSyncContextValue extends ProductionSyncSnapshot {
  enableOnThisDevice(): Promise<ProductionSyncActionResult>;
  syncNow(): Promise<ProductionSyncActionResult>;
  acknowledgeConflictBackup(namespace: CloudNamespace, conflictId: string): ConflictRecoveryResult;
  resolveConflict(
    namespace: CloudNamespace,
    choice: ConflictResolutionChoice,
    conflictId: string,
  ): Promise<ConflictRecoveryResult>;
}

const DISABLED_NAMESPACES: Record<CloudNamespace, NamespaceSyncStatus> = {
  portfolio: 'disabled',
  watchlist: 'disabled',
  preferences: 'disabled',
};

export const DISABLED_PRODUCTION_SYNC_SNAPSHOT: ProductionSyncSnapshot = {
  featureEnabled: false,
  userId: null,
  phase: 'disabled',
  enrollment: 'none',
  overall: 'disabled',
  namespaces: DISABLED_NAMESPACES,
  conflicts: {},
  deviceId: null,
  deviceLabel: 'This Browser',
  lastSuccessfulSyncAt: null,
  message: 'Account synchronization is disabled.',
  canEnable: false,
  canSyncNow: false,
};

const disabledAction = async (): Promise<ProductionSyncActionResult> => ({
  ok: false,
  code: 'feature_disabled',
  message: 'Account synchronization is disabled.',
});

const disabledConflictAction = (): ConflictRecoveryResult => ({
  ok: false,
  code: 'feature_disabled',
  message: 'Account synchronization is disabled.',
});

export const ProductionSyncContext = createContext<ProductionSyncContextValue>({
  ...DISABLED_PRODUCTION_SYNC_SNAPSHOT,
  enableOnThisDevice: disabledAction,
  syncNow: disabledAction,
  acknowledgeConflictBackup: disabledConflictAction,
  resolveConflict: async () => disabledConflictAction(),
});

export function useProductionSync(): ProductionSyncContextValue {
  return useContext(ProductionSyncContext);
}

import { createContext, useContext } from 'react';
import type { NamespaceSyncStatus, OngoingSyncMetadataV1 } from './syncEngineMetadata.ts';
import type { OverallSyncStatus, SyncNowResult } from './syncCoordinator.ts';
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

export const ProductionSyncContext = createContext<ProductionSyncContextValue>({
  ...DISABLED_PRODUCTION_SYNC_SNAPSHOT,
  enableOnThisDevice: disabledAction,
  syncNow: disabledAction,
});

export function useProductionSync(): ProductionSyncContextValue {
  return useContext(ProductionSyncContext);
}

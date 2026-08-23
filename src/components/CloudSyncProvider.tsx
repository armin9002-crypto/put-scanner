import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '../lib/authContext.ts';
import { createDormantCloudStateClient } from '../lib/cloudState/cloudStateClient.ts';
import {
  DISABLED_PRODUCTION_SYNC_SNAPSHOT,
  ProductionSyncContext,
  type ProductionSyncContextValue,
  type ProductionSyncSnapshot,
} from '../lib/cloudState/productionSyncContext.ts';
import {
  createProductionCloudSyncManager,
  type ProductionCloudSyncManager,
} from '../lib/cloudState/productionSyncLifecycle.ts';
import { supabaseAuthClient } from '../lib/supabaseClient.ts';

export default function CloudSyncProvider({ children }: { children: ReactNode }) {
  const { user, isConfigured } = useAuth();
  const userId = user?.id ?? null;
  const managerRef = useRef<ProductionCloudSyncManager | null>(null);
  if (!managerRef.current) {
    managerRef.current = createProductionCloudSyncManager({
      featureEnabled: true,
      storage: localStorage,
      clientForUser: userId => createDormantCloudStateClient(supabaseAuthClient, userId),
    });
  }
  const manager = managerRef.current;
  const [snapshot, setSnapshot] = useState<ProductionSyncSnapshot>(() => manager.getSnapshot());

  useEffect(() => manager.subscribe(setSnapshot), [manager]);

  useEffect(() => {
    void manager.setAccount(userId, isConfigured && supabaseAuthClient !== null);
    return () => {
      void manager.setAccount(null, isConfigured && supabaseAuthClient !== null);
    };
  }, [isConfigured, manager, userId]);

  const value = useMemo<ProductionSyncContextValue>(() => {
    const accountSettled = !userId || snapshot.userId === userId;
    const visibleSnapshot = accountSettled
      ? snapshot
      : {
          ...DISABLED_PRODUCTION_SYNC_SNAPSHOT,
          featureEnabled: true,
          userId,
          phase: 'verifying' as const,
          enrollment: 'blocked' as const,
          message: 'Verifying this device and account copy…',
        };
    return {
      ...visibleSnapshot,
      enableOnThisDevice: () => manager.enableOnThisDevice(),
      syncNow: () => manager.syncNow(),
    };
  }, [manager, snapshot, userId]);

  return <ProductionSyncContext.Provider value={value}>{children}</ProductionSyncContext.Provider>;
}

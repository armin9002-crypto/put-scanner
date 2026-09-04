import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { CloudOff, Loader2, RefreshCw } from 'lucide-react';
import { useAuth } from '../lib/authContext.ts';
import {
  AccountStateContext,
  DEFAULT_ACCOUNT_STATE_SNAPSHOT,
  type AccountStateContextValue,
  type AccountStateSnapshot,
} from '../lib/cloudState/accountStateContext.ts';
import {
  createCloudAuthoritativeAccountStateManager,
  type CloudAuthoritativeAccountStateManager,
} from '../lib/cloudState/accountStateLifecycle.ts';
import { accountStateStorage, type AccountStateStorageNotice } from '../lib/cloudState/accountStateStorage.ts';
import { createDormantCloudStateClient } from '../lib/cloudState/cloudStateClient.ts';
import { supabaseAuthClient } from '../lib/supabaseClient.ts';

export default function CloudSyncProvider({ children }: { children: ReactNode }) {
  const { user, isAuthLoading, isConfigured, signOut } = useAuth();
  const userId = user?.id ?? null;
  const managerRef = useRef<CloudAuthoritativeAccountStateManager | null>(null);
  if (!managerRef.current) {
    managerRef.current = createCloudAuthoritativeAccountStateManager({
      storage: accountStateStorage,
      legacyStorage: typeof localStorage === 'undefined' ? null : localStorage,
      clientForUser: accountUserId => createDormantCloudStateClient(supabaseAuthClient, accountUserId),
    });
  }
  const manager = managerRef.current;
  const [snapshot, setSnapshot] = useState<AccountStateSnapshot>(() => manager.getSnapshot());
  const [notice, setNotice] = useState<AccountStateStorageNotice | null>(null);

  useEffect(() => manager.subscribe(setSnapshot), [manager]);

  useEffect(() => {
    if (isAuthLoading) manager.setResolvingAuth();
    else void manager.setAccount(userId, isConfigured && supabaseAuthClient !== null);
  }, [isAuthLoading, isConfigured, manager, userId]);

  useEffect(() => {
    manager.activate();
    return () => manager.destroy();
  }, [manager]);

  useEffect(() => accountStateStorage.subscribeToNotices(next => setNotice(next)), []);
  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(null), 7000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  const visibleSnapshot = useMemo<AccountStateSnapshot>(() => {
    const accountSettled = !isAuthLoading && snapshot.userId === userId;
    return accountSettled
      ? snapshot
      : {
          ...DEFAULT_ACCOUNT_STATE_SNAPSHOT,
          userId,
          phase: isAuthLoading ? 'resolving_auth' : 'loading',
          message: isAuthLoading ? 'Checking account session…' : 'Loading your account data…',
          renderVersion: snapshot.renderVersion,
        };
  }, [isAuthLoading, snapshot, userId]);
  const value = useMemo<AccountStateContextValue>(() => ({
    ...visibleSnapshot,
    canWrite: visibleSnapshot.phase === 'ready' || visibleSnapshot.phase === 'saving',
    reload: () => manager.reload(),
    restoreBackup: backup => manager.restoreBackup(backup),
    commitHistoricalPortfolioImport: request => manager.commitHistoricalPortfolioImport(request),
  }), [manager, visibleSnapshot]);

  const requiresGate = visibleSnapshot.phase === 'resolving_auth'
    || visibleSnapshot.phase === 'loading'
    || (Boolean(userId) && visibleSnapshot.cloud === null);

  return (
    <AccountStateContext.Provider value={value}>
      {requiresGate
        ? (
          <main className="flex min-h-dvh items-center justify-center p-6" style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}>
            <section className="w-full max-w-sm rounded-2xl border p-6 text-center" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
              {visibleSnapshot.phase === 'error' || visibleSnapshot.phase === 'unavailable'
                ? <CloudOff className="mx-auto h-7 w-7" aria-hidden="true" style={{ color: 'var(--red)' }} />
                : <Loader2 className="mx-auto h-7 w-7 animate-spin" aria-hidden="true" style={{ color: 'var(--accent-light)' }} />}
              <h1 className="mt-3 text-base font-semibold">
                {visibleSnapshot.phase === 'error' || visibleSnapshot.phase === 'unavailable'
                  ? "Couldn't load your account"
                  : visibleSnapshot.message}
              </h1>
              {(visibleSnapshot.phase === 'error' || visibleSnapshot.phase === 'unavailable') && (
                <>
                  <p className="mt-2 text-sm leading-6" style={{ color: 'var(--text-muted)' }}>
                    Your cloud data was not changed. Put Scanner will not substitute old browser data.
                  </p>
                  <div className="mt-4 grid gap-2">
                    <button type="button" onClick={() => void manager.reload()} className="pressable flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white" style={{ backgroundColor: 'var(--accent)' }}>
                      <RefreshCw className="h-4 w-4" aria-hidden="true" /> Retry
                    </button>
                    <button type="button" onClick={() => void signOut()} className="pressable min-h-11 rounded-lg border px-4 text-sm font-semibold" style={{ borderColor: 'var(--border)', color: 'var(--text)' }}>
                      Sign Out
                    </button>
                  </div>
                </>
              )}
            </section>
          </main>
        )
        : <Fragment key={visibleSnapshot.renderVersion}>{children}</Fragment>}
      {notice && !requiresGate && (
        <div className="fixed bottom-20 left-1/2 z-[120] w-[min(92vw,28rem)] -translate-x-1/2 rounded-xl border px-4 py-3 text-sm shadow-2xl" role="alert" style={{ backgroundColor: 'var(--surface)', borderColor: notice.kind === 'sign_in_required' ? 'var(--accent-border)' : 'color-mix(in srgb, var(--red) 45%, var(--border))', color: 'var(--text)' }}>
          {notice.message}
        </div>
      )}
    </AccountStateContext.Provider>
  );
}

import type { User } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { Cloud, Database, ScanLine, Star, Briefcase, Activity } from 'lucide-react';
import { AuthContext, type AuthContextValue } from '../lib/authContext';
import {
  ProductionSyncContext,
  type ProductionSyncContextValue,
  type ProductionSyncPhase,
} from '../lib/cloudState/productionSyncContext';
import type { NamespaceSyncStatus } from '../lib/cloudState/syncEngineMetadata';
import { useResponsiveMode } from '../lib/responsive';
import { AccountPanel, DesktopAccountDialog } from './AccountControl';
import { CloudRestore } from './AccountDataSection';
import CloudSyncSection from './CloudSyncSection';
import MobileAccountSheet from './MobileAccountSheet';

const ACCOUNT_UI_TEST_FIXTURE_MARKER = 'ACCOUNT UI TEST FIXTURE';

type AccountUiFixtureState =
  | 'signed-out'
  | 'not-enrolled'
  | 'synced'
  | 'pending'
  | 'conflict'
  | 'conflict-backed-up'
  | 'account-mismatch'
  | 'attention'
  | 'restore';

const fixtureUser = {
  id: 'account-ui-fixture-user',
  email: 'owner@example.invalid',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-08-24T12:00:00.000Z',
} as User;

const disabledNamespaces: Record<'portfolio' | 'watchlist' | 'preferences', NamespaceSyncStatus> = {
  portfolio: 'disabled',
  watchlist: 'disabled',
  preferences: 'disabled',
};

function syncFixture(
  state: AccountUiFixtureState,
  backupCompleted: boolean,
  setBackupCompleted: (completed: boolean) => void,
): ProductionSyncContextValue {
  const isConflict = state === 'conflict' || state === 'conflict-backed-up';
  const phase: ProductionSyncPhase = state === 'synced'
    ? 'synced'
    : state === 'pending'
      ? 'pending'
    : isConflict
      ? 'conflict'
      : state === 'account-mismatch'
        ? 'account_mismatch'
        : state === 'attention'
          ? 'attention'
      : state === 'signed-out'
        ? 'anonymous'
        : 'not_enrolled';
  const namespaces = state === 'synced'
    ? { portfolio: 'synced', watchlist: 'synced', preferences: 'synced' } as const
    : state === 'pending'
      ? { portfolio: 'pending', watchlist: 'synced', preferences: 'synced' } as const
    : isConflict
      ? { portfolio: 'conflict', watchlist: 'synced', preferences: 'synced' } as const
      : disabledNamespaces;
  const failedFixtureAction = async () => ({
    ok: false as const,
    code: 'ui_fixture_only',
    message: 'This deterministic UI fixture performs no account operation.',
  });

  return {
    featureEnabled: true,
    userId: state === 'signed-out' ? null : fixtureUser.id,
    phase,
    enrollment: state === 'synced' || state === 'pending' || isConflict
      ? 'enabled'
      : state === 'account-mismatch' || state === 'attention'
        ? 'blocked'
        : 'none',
    overall: state === 'synced'
      ? 'all_synced'
      : state === 'pending'
        ? 'offline_saved_locally'
        : isConflict
          ? 'conflict_needs_attention'
          : state === 'account-mismatch' || state === 'attention'
            ? 'attention'
            : 'disabled',
    namespaces: { ...namespaces },
    conflicts: isConflict ? {
      portfolio: {
        id: 'portfolio:fixture-conflict',
        namespace: 'portfolio',
        label: 'Portfolio',
        thisDevice: {
          lines: ['15 open positions', '8 history items'],
          changedAt: '2026-08-25T12:01:00.000Z',
        },
        accountCopy: {
          lines: ['14 open positions', '9 history items'],
          changedAt: '2026-08-25T12:02:00.000Z',
        },
        backupCompleted,
      },
    } : {},
    deviceId: '11111111-1111-4111-8111-111111111111',
    deviceLabel: 'This Browser',
    lastSuccessfulSyncAt: state === 'synced' || state === 'pending' || isConflict ? '2026-08-24T12:00:00.000Z' : null,
    message: ACCOUNT_UI_TEST_FIXTURE_MARKER,
    canEnable: state === 'not-enrolled' || state === 'restore',
    canSyncNow: state === 'synced' || state === 'pending' || isConflict,
    enableOnThisDevice: failedFixtureAction,
    syncNow: failedFixtureAction,
    acknowledgeConflictBackup: (namespace, conflictId) => {
      if (isConflict && namespace === 'portfolio' && conflictId === 'portfolio:fixture-conflict') {
        setBackupCompleted(true);
        return { ok: true, namespace };
      }
      return { ok: false, code: 'fixture_conflict_changed', message: 'Fixture conflict changed.' };
    },
    resolveConflict: failedFixtureAction,
  };
}

function authFixture(state: AccountUiFixtureState): AuthContextValue {
  const user = state === 'signed-out' ? null : fixtureUser;
  return {
    user,
    session: null,
    isAuthLoading: false,
    isConfigured: true,
    authError: null,
    signInWithEmail: async () => true,
    signOut: async () => true,
  };
}

function AccountDataRestoreFixture() {
  return (
    <section className="space-y-3 rounded-xl border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-alt)' }} aria-label="Account Data">
      <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text)' }}>
        <Cloud className="h-4 w-4" aria-hidden="true" /> Account Data
      </div>
      <CloudRestore
        summary={{
          status: 'valid',
          portfolio: { openTradeCount: 15, historyCount: 8 },
          watchlist: { itemCount: 0 },
          preferences: { nonDefaultPreferenceCount: 4 },
          hasMeaningfulData: true,
        }}
        confirmation={null}
        busy={false}
        blocked={false}
        onDownload={() => undefined}
        onRequestRestore={() => undefined}
        onCancel={() => undefined}
        onConfirm={() => undefined}
      />
    </section>
  );
}

const fixtureTabs = [
  ['Scanner', ScanLine],
  ['Watchlist', Star],
  ['Portfolio', Briefcase],
  ['Pulse', Activity],
] as const;

export default function AccountUiTestFixture({ requestedState }: { requestedState: string }) {
  const { isPhone, isPhoneLandscape } = useResponsiveMode();
  const state: AccountUiFixtureState = ['signed-out', 'not-enrolled', 'synced', 'pending', 'conflict', 'conflict-backed-up', 'account-mismatch', 'attention', 'restore'].includes(requestedState)
    ? requestedState as AccountUiFixtureState
    : 'signed-out';
  const [backupCompleted, setBackupCompleted] = useState(state === 'conflict-backed-up');
  const [accountOpen, setAccountOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const user = state === 'signed-out' ? null : fixtureUser;

  useEffect(() => {
    triggerRef.current?.focus();
    setAccountOpen(true);
  }, []);

  return (
    <div className="min-h-[100dvh]" style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }} data-testid="account-ui-fixture">
      <header className="mobile-page-header">
        <div>
          <h1 className="text-lg font-bold">Account QA</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{ACCOUNT_UI_TEST_FIXTURE_MARKER}</p>
        </div>
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5" aria-hidden="true" />
          <button ref={triggerRef} type="button" className="sr-only" aria-label="Fixture account trigger">Open Account</button>
        </div>
      </header>
      <main className="px-4 py-8 text-sm" style={{ color: 'var(--text-muted)' }}>
        Local-only mocked presentation: {state}
      </main>
      <nav className={`mobile-bottom-nav ${isPhoneLandscape ? 'is-phone-landscape' : ''}`} aria-label="Fixture navigation">
        {fixtureTabs.map(([label, Icon], index) => (
          <span key={label} className={`mobile-bottom-nav__item${index === 0 ? ' is-active' : ''}`}>
            <Icon className="h-5 w-5" aria-hidden="true" />
            <span>{label}</span>
          </span>
        ))}
      </nav>
      <AuthContext.Provider value={authFixture(state)}>
        <ProductionSyncContext.Provider value={syncFixture(state, backupCompleted, setBackupCompleted)}>
          {accountOpen && (isPhone ? (
              <MobileAccountSheet
                identity={user?.email ?? null}
                status={user ? 'Signed in' : undefined}
                description={user ? undefined : 'Sign in to use your account across devices'}
                onClose={() => setAccountOpen(false)}
              >
                <AccountPanel
                  presentation="mobile"
                  onSignedOut={() => setAccountOpen(false)}
                  accountDataContent={state === 'restore' ? <AccountDataRestoreFixture /> : undefined}
                  accountSyncContent={<CloudSyncSection />}
                />
              </MobileAccountSheet>
            ) : <DesktopAccountDialog onClose={() => setAccountOpen(false)} accountSyncContent={<CloudSyncSection />} />)}
        </ProductionSyncContext.Provider>
      </AuthContext.Provider>
    </div>
  );
}

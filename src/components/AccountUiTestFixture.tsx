import type { User } from '@supabase/supabase-js';
import { useEffect, useRef, useState } from 'react';
import { Activity, Briefcase, Database, ScanLine, Star } from 'lucide-react';
import { AuthContext, type AuthContextValue } from '../lib/authContext';
import {
  AccountStateContext,
  type AccountStateContextValue,
  type AccountStatePhase,
} from '../lib/cloudState/accountStateContext';
import { useResponsiveMode } from '../lib/responsive';
import { AccountPanel, DesktopAccountDialog } from './AccountControl';
import CloudSyncSection from './CloudSyncSection';
import MobileAccountSheet from './MobileAccountSheet';

const ACCOUNT_UI_TEST_FIXTURE_MARKER = 'ACCOUNT UI TEST FIXTURE';
const fixtureUser = {
  id: 'account-ui-fixture-user',
  email: 'owner@example.invalid',
  app_metadata: {},
  user_metadata: {},
  aud: 'authenticated',
  created_at: '2026-08-29T12:00:00.000Z',
} as User;

function authFixture(signedOut: boolean): AuthContextValue {
  return {
    user: signedOut ? null : fixtureUser,
    session: null,
    isAuthLoading: false,
    isConfigured: true,
    authError: null,
    signInWithEmail: async () => true,
    signOut: async () => true,
  };
}

function accountFixture(state: string, signedOut: boolean): AccountStateContextValue {
  const phase: AccountStatePhase = signedOut
    ? 'anonymous'
    : state === 'pending'
      ? 'saving'
      : state === 'conflict' || state === 'conflict-backed-up'
        ? 'conflict'
        : state === 'attention' || state === 'account-mismatch'
          ? 'error'
          : 'ready';
  const message = phase === 'saving'
    ? 'Saving to your account…'
    : phase === 'conflict'
      ? 'Your account changed on another device. The latest cloud version was reloaded.'
      : phase === 'error'
        ? "Couldn't save this change. The last cloud-saved version was restored."
        : signedOut
          ? 'Sign in to save Portfolio and Watchlist data.'
          : 'Your account data is loaded from the cloud.';
  const unavailable = async () => ({ ok: false as const, code: 'fixture', message: 'Fixture only.' });
  return {
    userId: signedOut ? null : fixtureUser.id,
    phase,
    message,
    lastSavedAt: signedOut ? null : '2026-08-29T12:00:00.000Z',
    pendingWrites: phase === 'saving' ? 1 : 0,
    conflictNamespace: phase === 'conflict' ? 'portfolio' : null,
    renderVersion: 0,
    cloud: null,
    canWrite: phase === 'ready' || phase === 'saving',
    reload: unavailable,
    restoreBackup: unavailable,
  };
}

const fixtureTabs = [
  ['Scanner', ScanLine],
  ['Watchlist', Star],
  ['Portfolio', Briefcase],
  ['Pulse', Activity],
] as const;

export default function AccountUiTestFixture({ requestedState }: { requestedState: string }) {
  const { isPhone, isPhoneLandscape } = useResponsiveMode();
  const signedOut = requestedState === 'signed-out';
  const [accountOpen, setAccountOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    triggerRef.current?.focus();
    setAccountOpen(true);
  }, []);

  const account = accountFixture(requestedState, signedOut);
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
      <main className="px-4 py-8 text-sm" style={{ color: 'var(--text-muted)' }}>Cloud-authoritative mocked presentation: {requestedState}</main>
      <nav className={`mobile-bottom-nav ${isPhoneLandscape ? 'is-phone-landscape' : ''}`} aria-label="Fixture navigation">
        {fixtureTabs.map(([label, Icon], index) => (
          <span key={label} className={`mobile-bottom-nav__item${index === 0 ? ' is-active' : ''}`}>
            <Icon className="h-5 w-5" aria-hidden="true" /><span>{label}</span>
          </span>
        ))}
      </nav>
      <AuthContext.Provider value={authFixture(signedOut)}>
        <AccountStateContext.Provider value={account}>
          {accountOpen && (isPhone
            ? (
              <MobileAccountSheet
                identity={signedOut ? null : fixtureUser.email ?? null}
                status={signedOut ? undefined : 'Signed in'}
                description={signedOut ? 'Sign in to load your cloud account' : undefined}
                onClose={() => setAccountOpen(false)}
              >
                <AccountPanel presentation="mobile" onSignedOut={() => setAccountOpen(false)} accountSyncContent={<CloudSyncSection />} />
              </MobileAccountSheet>
            )
            : <DesktopAccountDialog onClose={() => setAccountOpen(false)} accountSyncContent={<CloudSyncSection />} />)}
        </AccountStateContext.Provider>
      </AuthContext.Provider>
    </div>
  );
}

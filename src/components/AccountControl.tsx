import { lazy, Suspense, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { CircleUserRound, Loader2, LogOut, Mail, X } from 'lucide-react';
import { useAuth } from '../lib/authContext';
import { useResponsiveMode } from '../lib/responsive';
import MobileAccountSheet from './MobileAccountSheet';
import { isCloudMigrationTestModeEnabled } from '../lib/cloudState/devTestMode';
import { useProductionSync } from '../lib/cloudState/productionSyncContext';

const AccountDataSection = lazy(() => import('./AccountDataSection'));
const DevCloudMigrationTestHarness = import.meta.env.DEV
  ? lazy(() => import('./CloudMigrationTestHarness'))
  : null;
const DevCloudSyncTestHarness = import.meta.env.DEV
  ? lazy(() => import('./CloudSyncTestHarness'))
  : null;
const ProductionCloudSyncSection = import.meta.env.VITE_CLOUD_SYNC_ENABLED === 'true'
  ? lazy(() => import('./CloudSyncSection'))
  : null;
const cloudSyncTestConfiguredEmail = import.meta.env.DEV
  && import.meta.env.VITE_CLOUD_SYNC_TEST_MODE === 'true'
  ? import.meta.env.VITE_CLOUD_SYNC_TEST_EMAIL?.trim().toLowerCase() ?? ''
  : '';
const cloudMigrationTestModeEnabled = isCloudMigrationTestModeEnabled({
  dev: import.meta.env.DEV,
  flag: import.meta.env.VITE_CLOUD_MIGRATION_TEST_MODE,
});

export function AccountPanel({
  onSignedOut,
  presentation,
  accountDataContent,
}: {
  onSignedOut: () => void;
  presentation: 'mobile' | 'desktop';
  accountDataContent?: ReactNode;
}) {
  const { user, isAuthLoading, authError, signInWithEmail, signOut } = useAuth();
  const productionSync = useProductionSync();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [linkSent, setLinkSent] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setLinkSent(false);
    const sent = await signInWithEmail(email);
    setLinkSent(sent);
    setSubmitting(false);
  };

  const handleSignOut = async () => {
    setSubmitting(true);
    const signedOut = await signOut();
    setSubmitting(false);
    if (signedOut) onSignedOut();
  };

  if (isAuthLoading) {
    return (
      <div className="flex min-h-32 items-center justify-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
        Checking account session...
      </div>
    );
  }

  if (user) {
    const cloudSyncTestModeEnabled = Boolean(
      DevCloudSyncTestHarness
      && cloudSyncTestConfiguredEmail
      && user.email?.trim().toLowerCase() === cloudSyncTestConfiguredEmail,
    );
    const accountData = accountDataContent ?? (
      <Suspense fallback={null}>
        <AccountDataSection userId={user.id} ongoingSyncState={productionSync.featureEnabled ? productionSync.enrollment : 'none'} />
      </Suspense>
    );
    const accountSync = ProductionCloudSyncSection ? (
      <Suspense fallback={null}>
        <ProductionCloudSyncSection />
      </Suspense>
    ) : null;
    return (
      <div className="space-y-4">
        {presentation === 'desktop' && (
          <div className="rounded-xl border p-3" style={{ backgroundColor: 'var(--surface-alt)', borderColor: 'var(--border)' }}>
            <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--green)' }}>Signed in</div>
            <div className="mt-1 break-all text-sm font-semibold" style={{ color: 'var(--text)' }}>{user.email ?? 'Put Scanner account'}</div>
          </div>
        )}
        <p className="text-xs leading-5" style={{ color: 'var(--text-muted)' }}>
          {productionSync.featureEnabled
            ? 'Your data stays on this browser first. Account Sync runs only after you enable it on this device.'
            : 'Your data stays on this browser. Account Data lets you explicitly save or restore an account copy.'}
        </p>
        {presentation === 'mobile' && accountSync}
        {accountData}
        {presentation === 'desktop' && accountSync}
        {cloudMigrationTestModeEnabled && DevCloudMigrationTestHarness && (
          <Suspense fallback={null}>
            <DevCloudMigrationTestHarness userId={user.id} />
          </Suspense>
        )}
        {cloudSyncTestModeEnabled && DevCloudSyncTestHarness && (
          <Suspense fallback={null}>
            <DevCloudSyncTestHarness key={user.id} userId={user.id} authenticatedEmail={user.email} />
          </Suspense>
        )}
        {authError && <AccountError>{authError}</AccountError>}
        <button
          type="button"
          onClick={() => void handleSignOut()}
          disabled={submitting}
          className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
          style={{ backgroundColor: 'var(--surface-alt)', color: 'var(--text)', border: '1px solid var(--border)' }}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={event => void handleSubmit(event)} className="space-y-4">
      <p className="text-xs leading-5" style={{ color: 'var(--text-muted)' }}>
        Sign in to use your account across devices. Your current app data remains local and is not uploaded merely by signing in.
      </p>
      <label className="block">
        <span className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Email</span>
        <div className="flex min-h-11 items-center gap-2 rounded-lg border px-3" style={{ backgroundColor: 'var(--input-bg)', borderColor: 'var(--border)' }}>
          <Mail className="h-4 w-4 flex-none" aria-hidden="true" style={{ color: 'var(--text-dim)' }} />
          <input
            type="email"
            value={email}
            onChange={event => { setEmail(event.target.value); setLinkSent(false); }}
            autoComplete="email"
            inputMode="email"
            required
            placeholder="you@example.com"
            className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
            style={{ color: 'var(--text)' }}
          />
        </div>
      </label>
      {linkSent && (
        <div role="status" className="rounded-lg border px-3 py-2 text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--green) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--green) 35%, transparent)', color: 'var(--green)' }}>
          Check your email for a sign-in link.
        </div>
      )}
      {authError && <AccountError>{authError}</AccountError>}
      <button
        type="submit"
        disabled={submitting || email.trim().length === 0}
        className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent)' }}
      >
        {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
        Send Sign-In Link
      </button>
      <p className="text-[11px] leading-4" style={{ color: 'var(--text-dim)' }}>
        New email addresses create an account automatically. No password is required.
      </p>
    </form>
  );
}

function AccountError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border px-3 py-2 text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--red) 9%, transparent)', borderColor: 'color-mix(in srgb, var(--red) 30%, transparent)', color: 'var(--red)' }}>
      {children}
    </div>
  );
}

export function DesktopAccountDialog({ onClose }: { onClose: () => void }) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = 'hidden';
    panelRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab' || !panelRef.current) return;
      const focusable = Array.from(panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4">
      <button type="button" className="absolute inset-0 bg-black/60" aria-label="Close account" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="overlay-panel relative z-10 max-h-[calc(100dvh-2rem)] w-full max-w-sm overflow-y-auto p-5 outline-none"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="mb-4 flex items-center justify-between gap-3 border-b pb-3" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 id={titleId} className="text-base font-semibold" style={{ color: 'var(--text)' }}>Put Scanner Account</h2>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>Optional account access</p>
          </div>
          <button type="button" onClick={onClose} className="pressable flex h-10 w-10 items-center justify-center rounded-full" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-alt)' }} aria-label="Close account">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <AccountPanel onSignedOut={onClose} presentation="desktop" />
      </div>
    </div>
  );
}

export default function AccountControl() {
  const { user, isAuthLoading, isConfigured } = useAuth();
  const { isPhone } = useResponsiveMode();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const sheetId = useId();

  if (!isConfigured) return null;

  const title = user?.email ? `Account: ${user.email}` : 'Account';
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen(true)}
        className="pressable icon-button relative flex h-11 w-11 min-h-11 min-w-11 items-center justify-center rounded-lg"
        style={{ color: user ? 'var(--accent-light)' : 'var(--text-muted)' }}
        aria-label="Account"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? sheetId : undefined}
        title={title}
      >
        {isAuthLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CircleUserRound className="h-[18px] w-[18px]" aria-hidden="true" />}
        {user && <span className="absolute right-2 top-2 h-1.5 w-1.5 rounded-full" style={{ backgroundColor: 'var(--green)' }} aria-hidden="true" />}
      </button>
      {open && (isPhone
        ? (
          <MobileAccountSheet
            id={sheetId}
            identity={user?.email ?? null}
            status={user ? 'Signed in' : undefined}
            description={isAuthLoading
              ? 'Checking account session…'
              : user
                ? undefined
                : 'Sign in to use your account across devices'}
            onClose={() => setOpen(false)}
          >
            <AccountPanel onSignedOut={() => setOpen(false)} presentation="mobile" />
          </MobileAccountSheet>
        )
        : <DesktopAccountDialog onClose={() => setOpen(false)} />)}
    </>
  );
}

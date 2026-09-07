import { lazy, Suspense, useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleUserRound, Loader2, LogOut, Mail, X } from 'lucide-react';
import { useAuth } from '../lib/authContext';
import { useResponsiveMode } from '../lib/responsive';
import MobileAccountSheet from './MobileAccountSheet';
import { useAccountState } from '../lib/cloudState/accountStateContext';

const CloudAccountStatus = lazy(() => import('./CloudSyncSection'));

export function AccountPanel({
  onSignedOut,
  presentation,
  accountSyncContent,
}: {
  onSignedOut: () => void;
  presentation: 'mobile' | 'desktop';
  accountSyncContent?: ReactNode;
}) {
  const { user, isAuthLoading, authError, signInWithEmail, signInWithPastedLink, signOut } = useAuth();
  const accountState = useAccountState();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const [showLinkFallback, setShowLinkFallback] = useState(false);
  const [pastedLink, setPastedLink] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setLinkSent(false);
    const sent = await signInWithEmail(email);
    setLinkSent(sent);
    setSubmitting(false);
  };

  const handlePastedLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    const signedIn = await signInWithPastedLink(pastedLink);
    if (signedIn) {
      setPastedLink('');
      setShowLinkFallback(false);
    }
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
    const accountSync = accountSyncContent ?? (
      <Suspense fallback={null}>
        <CloudAccountStatus />
      </Suspense>
    );
    return (
      <div className="space-y-4">
        {presentation === 'desktop' && (
          <div className="rounded-xl border p-3" style={{ backgroundColor: 'var(--surface-alt)', borderColor: 'var(--border)' }}>
            <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: 'var(--green)' }}>Signed in</div>
            <div className="mt-1 break-all text-sm font-semibold" style={{ color: 'var(--text)' }}>{user.email ?? 'Put Scanner account'}</div>
          </div>
        )}
        <p className="text-xs leading-5" style={{ color: 'var(--text-muted)' }}>
          Supabase is the durable source of truth for your Portfolio, Watchlist, and account preferences. This browser keeps only the loaded in-memory view.
        </p>
        {accountSync}
        {accountState.phase === 'conflict' && (
          <p className="rounded-lg border px-3 py-2 text-xs leading-5" style={{ borderColor: 'color-mix(in srgb, var(--yellow) 35%, var(--border))', color: 'var(--yellow)' }}>
            The latest cloud version was loaded. Retry your intended change when ready.
          </p>
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
    <div className="space-y-4">
      <p className="text-xs leading-5" style={{ color: 'var(--text-muted)' }}>
        Sign in to load your cloud Portfolio and Watchlist. Account data is not saved in this browser while signed out.
      </p>
      <form onSubmit={event => void handleSubmit(event)} className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Email</span>
          <div className="flex min-h-11 items-center gap-2 rounded-lg border px-3" style={{ backgroundColor: 'var(--input-bg)', borderColor: 'var(--border)' }}>
            <Mail className="h-4 w-4 flex-none" aria-hidden="true" style={{ color: 'var(--text-dim)' }} />
            <input
              type="email"
              value={email}
              onChange={event => { setEmail(event.target.value); setLinkSent(false); setShowLinkFallback(false); setPastedLink(''); }}
              autoComplete="email"
              inputMode="email"
              required
              placeholder="you@example.com"
              className="min-w-0 flex-1 bg-transparent py-2 text-sm outline-none"
              style={{ color: 'var(--text)' }}
            />
          </div>
        </label>
        <button
          type="submit"
          disabled={submitting || email.trim().length === 0}
          className="pressable flex min-h-11 w-full items-center justify-center gap-2 rounded-lg px-4 text-sm font-semibold text-white disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
          {linkSent ? 'Resend Sign-In Link' : 'Send Sign-In Link'}
        </button>
      </form>
      {linkSent && (
        <div className="space-y-3">
          <div role="status" className="rounded-lg border px-3 py-2 text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--green) 10%, transparent)', borderColor: 'color-mix(in srgb, var(--green) 35%, transparent)', color: 'var(--green)' }}>
            Check your email for a sign-in link.
          </div>
          {!showLinkFallback ? (
            <button type="button" onClick={() => setShowLinkFallback(true)} className="pressable min-h-11 w-full rounded-lg px-3 text-xs font-semibold" style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--surface-alt)', border: '1px solid var(--border)' }}>
              Having trouble opening the link in this app?
            </button>
          ) : (
            <form onSubmit={event => void handlePastedLink(event)} className="space-y-3 rounded-lg border p-3" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface-alt)' }}>
              <p className="text-xs leading-5" style={{ color: 'var(--text-muted)' }}>
                Using Put Scanner from your iPhone Home Screen? Long-press the Sign in link in the email, choose Copy Link, then paste it below.
              </p>
              <label className="block">
                <span className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Sign-in link</span>
                <input
                  type="url"
                  value={pastedLink}
                  onChange={event => setPastedLink(event.target.value)}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  required
                  placeholder="Paste sign-in link"
                  className="min-h-11 w-full min-w-0 rounded-lg border px-3 py-2 text-sm outline-none"
                  style={{ color: 'var(--text)', backgroundColor: 'var(--input-bg)', borderColor: 'var(--border)' }}
                />
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => { setShowLinkFallback(false); setPastedLink(''); }} disabled={submitting} className="pressable min-h-11 rounded-lg px-3 text-sm font-semibold disabled:opacity-50" style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>Cancel</button>
                <button type="submit" disabled={submitting || pastedLink.trim().length === 0} className="pressable flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold text-white disabled:opacity-50" style={{ backgroundColor: 'var(--accent)' }}>
                  {submitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                  Sign In
                </button>
              </div>
            </form>
          )}
        </div>
      )}
      {authError && <AccountError>{authError}</AccountError>}
      <p className="text-[11px] leading-4" style={{ color: 'var(--text-dim)' }}>
        New email addresses create an account automatically. No password is required.
      </p>
    </div>
  );
}

function AccountError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-lg border px-3 py-2 text-xs" style={{ backgroundColor: 'color-mix(in srgb, var(--red) 9%, transparent)', borderColor: 'color-mix(in srgb, var(--red) 30%, transparent)', color: 'var(--red)' }}>
      {children}
    </div>
  );
}

export function DesktopAccountDialog({ onClose, accountSyncContent }: { onClose: () => void; accountSyncContent?: ReactNode }) {
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

  if (typeof document === 'undefined') return null;

  const dialog = (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4" data-account-overlay="desktop">
      <button type="button" className="motion-backdrop absolute inset-0 bg-black/60" aria-label="Close account" onClick={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="motion-modal overlay-panel relative z-10 flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col overflow-hidden outline-none"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="mb-4 flex flex-none items-center justify-between gap-3 border-b px-5 pb-3 pt-5" style={{ borderColor: 'var(--border)' }}>
          <div>
            <h2 id={titleId} className="text-base font-semibold" style={{ color: 'var(--text)' }}>Put Scanner Account</h2>
            <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>Cloud-backed account data</p>
          </div>
          <button type="button" onClick={onClose} className="pressable flex h-10 w-10 items-center justify-center rounded-full" style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-alt)' }} aria-label="Close account">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-5">
          <AccountPanel onSignedOut={onClose} presentation="desktop" accountSyncContent={accountSyncContent} />
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
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

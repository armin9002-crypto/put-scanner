import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

interface AuthOperationError {
  message?: string;
  status?: number;
}

export interface AuthOnlyClient {
  auth: {
    getSession: () => Promise<{
      data: { session: Session | null };
      error: AuthOperationError | null;
    }>;
    onAuthStateChange: (
      callback: (event: AuthChangeEvent, session: Session | null) => void,
    ) => { data: { subscription: { unsubscribe: () => void } } };
    signInWithOtp: (credentials: {
      email: string;
      options: { emailRedirectTo: string; shouldCreateUser: true };
    }) => Promise<{ error: AuthOperationError | null }>;
    signOut: () => Promise<{ error: AuthOperationError | null }>;
  };
}

export interface AuthActionResult {
  ok: boolean;
  error: string | null;
}

export interface AuthRestoreResult extends AuthActionResult {
  session: Session | null;
}

function safeAuthError(error: unknown, fallback: string): string {
  if (error && typeof error === 'object') {
    const candidate = error as AuthOperationError;
    const message = typeof candidate.message === 'string' ? candidate.message.trim() : '';
    if (candidate.status === 429 || /rate.?limit|too many requests/i.test(message)) {
      return 'Too many sign-in attempts. Please wait a few minutes and try again.';
    }
    if (message) return message;
  }
  return fallback;
}

export function authRedirectForOrigin(origin: string): string {
  return new URL('/', origin).toString();
}

export async function requestMagicLink(
  client: AuthOnlyClient,
  email: string,
  origin: string,
): Promise<AuthActionResult> {
  try {
    const { error } = await client.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: authRedirectForOrigin(origin),
        shouldCreateUser: true,
      },
    });
    return error
      ? { ok: false, error: safeAuthError(error, 'Unable to send a sign-in link.') }
      : { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: safeAuthError(error, 'Authentication is temporarily unavailable.') };
  }
}

export async function restoreAuthSession(client: AuthOnlyClient): Promise<AuthRestoreResult> {
  try {
    const { data, error } = await client.auth.getSession();
    return error
      ? { ok: false, error: safeAuthError(error, 'Unable to restore the account session.'), session: null }
      : { ok: true, error: null, session: data.session };
  } catch (error) {
    return {
      ok: false,
      error: safeAuthError(error, 'Authentication is temporarily unavailable.'),
      session: null,
    };
  }
}

export function subscribeToAuthSession(
  client: AuthOnlyClient,
  onSession: (session: Session | null) => void,
): () => void {
  const { data } = client.auth.onAuthStateChange((_event, session) => onSession(session));
  return () => data.subscription.unsubscribe();
}

export async function endAuthSession(client: AuthOnlyClient): Promise<AuthActionResult> {
  try {
    const { error } = await client.auth.signOut();
    return error
      ? { ok: false, error: safeAuthError(error, 'Unable to sign out.') }
      : { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: safeAuthError(error, 'Authentication is temporarily unavailable.') };
  }
}

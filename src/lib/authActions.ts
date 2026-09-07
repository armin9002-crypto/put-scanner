import type { AuthChangeEvent, Session } from '@supabase/supabase-js';

interface AuthOperationError {
  message?: string;
  status?: number;
}

export type PastedMagicLinkParseResult =
  | { ok: true; tokenHash: string }
  | { ok: false; error: string };

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
    verifyOtp: (credentials: {
      token_hash: string;
      type: 'magiclink';
    }) => Promise<{
      data: { session: Session | null };
      error: AuthOperationError | null;
    }>;
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

function hasExactlyOne(searchParams: URLSearchParams, name: string): boolean {
  return searchParams.getAll(name).length === 1;
}

export function parsePastedMagicLink(
  pastedValue: string,
  supabaseUrl: string,
  appOrigin: string,
): PastedMagicLinkParseResult {
  let pastedUrl: URL;
  let expectedSupabaseUrl: URL;
  try {
    pastedUrl = new URL(pastedValue.trim());
    expectedSupabaseUrl = new URL('/auth/v1/verify', supabaseUrl);
  } catch {
    return { ok: false, error: 'Paste the complete sign-in link from your email.' };
  }

  if (pastedUrl.protocol !== expectedSupabaseUrl.protocol || pastedUrl.origin !== expectedSupabaseUrl.origin) {
    return { ok: false, error: 'That link is not for this Put Scanner account.' };
  }
  if (pastedUrl.pathname !== expectedSupabaseUrl.pathname || pastedUrl.username || pastedUrl.password || pastedUrl.hash) {
    return { ok: false, error: 'That link is not a supported Supabase sign-in link.' };
  }
  if (!hasExactlyOne(pastedUrl.searchParams, 'type') || pastedUrl.searchParams.get('type') !== 'magiclink') {
    return { ok: false, error: 'That link is not a supported magic sign-in link.' };
  }
  if (!hasExactlyOne(pastedUrl.searchParams, 'token')) {
    return { ok: false, error: 'That sign-in link is missing its verification token.' };
  }
  const tokenHash = pastedUrl.searchParams.get('token')?.trim() ?? '';
  if (!tokenHash) {
    return { ok: false, error: 'That sign-in link is missing its verification token.' };
  }

  if (!hasExactlyOne(pastedUrl.searchParams, 'redirect_to')) {
    return { ok: false, error: 'That sign-in link has an invalid return address.' };
  }
  const supportedParameters = new Set(['token', 'type', 'redirect_to']);
  if ([...pastedUrl.searchParams.keys()].some(name => !supportedParameters.has(name))) {
    return { ok: false, error: 'That sign-in link contains unsupported information.' };
  }
  let redirectUrl: URL;
  try {
    redirectUrl = new URL(pastedUrl.searchParams.get('redirect_to') ?? '');
  } catch {
    return { ok: false, error: 'That sign-in link has an invalid return address.' };
  }
  if (redirectUrl.toString() !== authRedirectForOrigin(appOrigin)) {
    return { ok: false, error: 'That sign-in link has an unexpected return address.' };
  }

  return { ok: true, tokenHash };
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

export async function verifyPastedMagicLink(
  client: AuthOnlyClient,
  pastedValue: string,
  supabaseUrl: string,
  appOrigin: string,
): Promise<AuthActionResult> {
  const parsed = parsePastedMagicLink(pastedValue, supabaseUrl, appOrigin);
  if (!parsed.ok) return parsed;

  try {
    const { data, error } = await client.auth.verifyOtp({
      token_hash: parsed.tokenHash,
      type: 'magiclink',
    });
    if (error || !data.session) {
      return { ok: false, error: 'That sign-in link is invalid or has expired. Request a new email and try again.' };
    }
    return { ok: true, error: null };
  } catch {
    return { ok: false, error: 'Unable to verify the sign-in link. Check your connection and try again.' };
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

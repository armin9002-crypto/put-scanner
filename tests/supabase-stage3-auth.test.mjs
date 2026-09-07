import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  authRedirectForOrigin,
  endAuthSession,
  parsePastedMagicLink,
  requestMagicLink,
  restoreAuthSession,
  subscribeToAuthSession,
  verifyPastedMagicLink,
} from '../src/lib/authActions.ts';
import {
  createConfiguredSupabaseClient,
  resolveSupabasePublicConfig,
} from '../src/lib/supabaseClient.ts';
import { PORTFOLIO_STORAGE_KEY } from '../src/lib/portfolioStorage.ts';
import { WATCHLIST_STORAGE_KEY } from '../src/lib/watchlist.ts';
import { THEME_STORAGE_KEY } from '../src/lib/themePreference.ts';
import { PORTFOLIO_MARK_BASIS_KEY } from '../src/lib/portfolioMarkPreference.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
  }

  getItem(key) {
    return this.values.get(key) ?? null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
  }

  removeItem(key) {
    this.values.delete(key);
  }

  snapshot(keys) {
    return Object.fromEntries(keys.map(key => [key, this.getItem(key)]));
  }
}

function authMock({ session = null, operationError = null, storage = null } = {}) {
  const calls = [];
  let listener = null;
  let unsubscribed = false;
  let databaseCalls = 0;
  const client = {
    auth: {
      async getSession() {
        calls.push(['getSession']);
        return { data: { session }, error: operationError };
      },
      onAuthStateChange(callback) {
        calls.push(['onAuthStateChange']);
        listener = callback;
        return { data: { subscription: { unsubscribe: () => { unsubscribed = true; } } } };
      },
      async signInWithOtp(credentials) {
        calls.push(['signInWithOtp', credentials]);
        return { error: operationError };
      },
      async verifyOtp(credentials) {
        calls.push(['verifyOtp', credentials]);
        if (!operationError && session) listener?.('SIGNED_IN', session);
        return { data: { session: operationError ? null : session }, error: operationError };
      },
      async signOut() {
        calls.push(['signOut']);
        storage?.removeItem('sb-project-auth-token');
        return { error: operationError };
      },
    },
    from() {
      databaseCalls += 1;
      throw new Error('database access is forbidden in Stage 3A');
    },
  };
  return {
    client,
    calls,
    emit(event, nextSession) { listener?.(event, nextSession); },
    wasUnsubscribed() { return unsubscribed; },
    databaseCalls() { return databaseCalls; },
  };
}

test('missing or malformed public env configuration creates no client and cannot crash startup', () => {
  let factoryCalls = 0;
  const missing = resolveSupabasePublicConfig({});
  assert.deepEqual(missing, { url: '', publishableKey: '', isConfigured: false });
  assert.equal(createConfiguredSupabaseClient(missing, () => { factoryCalls += 1; return {}; }), null);
  assert.equal(factoryCalls, 0);

  assert.equal(resolveSupabasePublicConfig({
    VITE_SUPABASE_URL: 'http://remote.example.com',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public',
  }).isConfigured, false);
  assert.equal(resolveSupabasePublicConfig({
    VITE_SUPABASE_URL: 'https://project.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'not-a-publishable-key',
  }).isConfigured, false);
});

test('configured client uses only the URL, publishable key, and persistent refreshable auth options', () => {
  const config = resolveSupabasePublicConfig({
    VITE_SUPABASE_URL: 'https://project.supabase.co',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public-test',
  });
  let captured = null;
  const fakeClient = {};
  assert.equal(createConfiguredSupabaseClient(config, (...args) => { captured = args; return fakeClient; }), fakeClient);
  assert.deepEqual(captured, [
    'https://project.supabase.co',
    'sb_publishable_public-test',
    { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } },
  ]);
});

test('app-load restoration and auth-state changes use auth only and clean up the listener', async () => {
  const initialSession = { user: { id: 'user-a', email: 'owner@example.com' } };
  const nextSession = { user: { id: 'user-b', email: 'next@example.com' } };
  const mock = authMock({ session: initialSession });
  const restored = await restoreAuthSession(mock.client);
  assert.equal(restored.ok, true);
  assert.equal(restored.session, initialSession);

  const observed = [];
  const unsubscribe = subscribeToAuthSession(mock.client, session => observed.push(session));
  mock.emit('SIGNED_IN', nextSession);
  mock.emit('SIGNED_OUT', null);
  unsubscribe();
  assert.deepEqual(observed, [nextSession, null]);
  assert.equal(mock.wasUnsubscribed(), true);
  assert.equal(mock.databaseCalls(), 0);
  assert.deepEqual(mock.calls.map(([name]) => name), ['getSession', 'onAuthStateChange']);
});

test('passwordless request uses auth only, current-origin redirect, and automatic account creation', async () => {
  const mock = authMock();
  const result = await requestMagicLink(mock.client, ' owner@example.com ', 'https://put-scanner.vercel.app/portfolio');
  assert.deepEqual(result, { ok: true, error: null });
  assert.equal(authRedirectForOrigin('http://localhost:5173/options/TQQQ'), 'http://localhost:5173/');
  assert.deepEqual(mock.calls, [[
    'signInWithOtp',
    {
      email: 'owner@example.com',
      options: {
        emailRedirectTo: 'https://put-scanner.vercel.app/',
        shouldCreateUser: true,
      },
    },
  ]]);
  assert.equal(mock.databaseCalls(), 0);
});

test('current-project magic-link action URL is parsed without navigating or retaining its token', () => {
  const token = 'hashed-secret-token';
  const link = `https://project.supabase.co/auth/v1/verify?token=${token}&type=magiclink&redirect_to=${encodeURIComponent('https://put-scanner.vercel.app/')}`;
  assert.deepEqual(parsePastedMagicLink(
    link,
    'https://project.supabase.co',
    'https://put-scanner.vercel.app',
  ), { ok: true, tokenHash: token });
});

test('pasted magic-link parsing fails closed for malformed, foreign, incomplete, and suspicious links', () => {
  const parse = link => parsePastedMagicLink(
    link,
    'https://project.supabase.co',
    'https://put-scanner.vercel.app',
  );
  const validQuery = `token=secret&type=magiclink&redirect_to=${encodeURIComponent('https://put-scanner.vercel.app/')}`;

  assert.equal(parse('not a url').ok, false);
  assert.equal(parse(`https://evil.example/auth/v1/verify?${validQuery}`).ok, false);
  assert.equal(parse(`https://other-project.supabase.co/auth/v1/verify?${validQuery}`).ok, false);
  assert.equal(parse(`https://project.supabase.co/auth/v1/token?${validQuery}`).ok, false);
  assert.equal(parse(`https://project.supabase.co/auth/v1/verify?token=secret&type=recovery&redirect_to=${encodeURIComponent('https://put-scanner.vercel.app/')}`).ok, false);
  assert.equal(parse(`https://project.supabase.co/auth/v1/verify?type=magiclink&redirect_to=${encodeURIComponent('https://put-scanner.vercel.app/')}`).ok, false);
  assert.equal(parse(`https://project.supabase.co/auth/v1/verify?${validQuery}&next=https://evil.example`).ok, false);
  assert.equal(parse(`https://project.supabase.co/auth/v1/verify?token=secret&type=magiclink&redirect_to=${encodeURIComponent('https://evil.example/')}`).ok, false);
});

test('pasted magic link verifies its token hash in the current client and establishes the canonical session', async () => {
  const session = { access_token: 'access-secret', user: { id: 'same-user', email: 'owner@example.com' } };
  const mock = authMock({ session });
  const observed = [];
  const unsubscribe = subscribeToAuthSession(mock.client, nextSession => observed.push(nextSession));
  const result = await verifyPastedMagicLink(
    mock.client,
    `https://project.supabase.co/auth/v1/verify?token=hash-secret&type=magiclink&redirect_to=${encodeURIComponent('https://put-scanner.vercel.app/')}`,
    'https://project.supabase.co',
    'https://put-scanner.vercel.app',
  );
  unsubscribe();

  assert.deepEqual(result, { ok: true, error: null });
  assert.deepEqual(mock.calls, [
    ['onAuthStateChange'],
    ['verifyOtp', { token_hash: 'hash-secret', type: 'magiclink' }],
  ]);
  assert.deepEqual(observed, [session]);
  assert.equal(mock.databaseCalls(), 0);
});

test('expired or used pasted links and network failures expose no auth secrets or application state', async () => {
  const link = `https://project.supabase.co/auth/v1/verify?token=do-not-expose&type=magiclink&redirect_to=${encodeURIComponent('https://put-scanner.vercel.app/')}`;
  const expired = authMock({ operationError: { status: 403, message: 'token do-not-expose expired' } });
  const expiredResult = await verifyPastedMagicLink(expired.client, link, 'https://project.supabase.co', 'https://put-scanner.vercel.app');
  assert.equal(expiredResult.ok, false);
  assert.doesNotMatch(expiredResult.error, /do-not-expose/);

  const offlineClient = authMock().client;
  offlineClient.auth.verifyOtp = async () => { throw new TypeError('network failed for do-not-expose'); };
  const offlineResult = await verifyPastedMagicLink(offlineClient, link, 'https://project.supabase.co', 'https://put-scanner.vercel.app');
  assert.equal(offlineResult.ok, false);
  assert.doesNotMatch(offlineResult.error, /do-not-expose/);
});

test('auth sign-out is auth-only; account-memory clearing remains provider-owned', async () => {
  const trackedKeys = [PORTFOLIO_STORAGE_KEY, WATCHLIST_STORAGE_KEY, THEME_STORAGE_KEY, PORTFOLIO_MARK_BASIS_KEY];
  const storage = new MemoryStorage({
    [PORTFOLIO_STORAGE_KEY]: '{"schemaVersion":1,"revision":7,"data":[{"id":"trade-a"}]}',
    [WATCHLIST_STORAGE_KEY]: '{"schemaVersion":1,"revision":4,"data":[{"id":"contract-a"}]}',
    [THEME_STORAGE_KEY]: 'sepia',
    [PORTFOLIO_MARK_BASIS_KEY]: 'bid',
    'sb-project-auth-token': '{"access_token":"managed-by-supabase"}',
  });
  const before = storage.snapshot(trackedKeys);
  const mock = authMock({ storage });
  assert.deepEqual(await endAuthSession(mock.client), { ok: true, error: null });
  assert.deepEqual(storage.snapshot(trackedKeys), before);
  assert.equal(storage.getItem('sb-project-auth-token'), null);
  assert.deepEqual(mock.calls, [['signOut']]);
  assert.equal(mock.databaseCalls(), 0);
});

test('auth failures remain isolated from local application state and rate limits are clear', async () => {
  const storage = new MemoryStorage({
    [PORTFOLIO_STORAGE_KEY]: 'portfolio-sentinel',
    [WATCHLIST_STORAGE_KEY]: 'watchlist-sentinel',
    [THEME_STORAGE_KEY]: 'dark-blue',
  });
  const before = storage.snapshot([PORTFOLIO_STORAGE_KEY, WATCHLIST_STORAGE_KEY, THEME_STORAGE_KEY]);
  const mock = authMock({ operationError: { status: 429, message: 'rate limit exceeded' }, storage });
  assert.deepEqual(await requestMagicLink(mock.client, 'owner@example.com', 'https://put-scanner.vercel.app'), {
    ok: false,
    error: 'Too many sign-in attempts. Please wait a few minutes and try again.',
  });
  assert.equal((await restoreAuthSession(mock.client)).ok, false);
  assert.equal((await endAuthSession(mock.client)).ok, false);
  assert.deepEqual(storage.snapshot([PORTFOLIO_STORAGE_KEY, WATCHLIST_STORAGE_KEY, THEME_STORAGE_KEY]), before);
  assert.equal(mock.databaseCalls(), 0);
});

test('Stage 3A source has no database access, durable-key mutation, protected routes, or browser secret', async () => {
  const files = [
    'src/lib/supabaseClient.ts',
    'src/lib/authActions.ts',
    'src/lib/auth.tsx',
    'src/lib/authContext.ts',
    'src/components/AccountControl.tsx',
    'src/App.tsx',
  ];
  const sources = await Promise.all(files.map(file => readFile(path.join(root, file), 'utf8')));
  const runtime = sources.join('\n');
  assert.doesNotMatch(runtime, /\.from\s*\(\s*['"`]/);
  assert.doesNotMatch(runtime, /user_state/i);
  assert.doesNotMatch(runtime, /put_scanner_(?:portfolio|watchlist|theme)|portfolio_mark_basis/i);
  assert.doesNotMatch(runtime, /(?:SUPABASE_SECRET_KEY|service_role|sb_secret_)/i);
  assert.match(runtime, /VITE_SUPABASE_URL/);
  assert.match(runtime, /VITE_SUPABASE_PUBLISHABLE_KEY/);

  const appSource = sources[5];
  assert.match(appSource, /function AppBody\(\)[\s\S]*?<ThemeProvider>[\s\S]*?<AppContent/);
  assert.match(appSource, /<AuthProvider>[\s\S]*?<AccountStateProvider>[\s\S]*?<AppBody/);
  assert.doesNotMatch(appSource, /ProtectedRoute|RequireAuth|isAuthLoading\s*\?/);
});

test('account UI is optional, truthful, and does not add a primary route or mobile tab', async () => {
  const [accountSource, appSource, packageSource, envExample, gitignore] = await Promise.all([
    readFile(path.join(root, 'src/components/AccountControl.tsx'), 'utf8'),
    readFile(path.join(root, 'src/App.tsx'), 'utf8'),
    readFile(path.join(root, 'package.json'), 'utf8'),
    readFile(path.join(root, '.env.example'), 'utf8'),
    readFile(path.join(root, '.gitignore'), 'utf8'),
  ]);
  assert.match(accountSource, /if \(!isConfigured\) return null/);
  assert.match(accountSource, /Check your email for a sign-in link\./);
  assert.match(accountSource, /Having trouble opening the link in this app\?/);
  assert.match(accountSource, /setPastedLink\(''\)/);
  assert.match(accountSource, /Supabase is the durable source of truth/);
  assert.match(accountSource, /Account data is not saved in this browser while signed out\./);
  assert.match(accountSource, /min-h-11 min-w-11/);
  assert.match(appSource, /<AccountControl \/>/);
  assert.equal((appSource.match(/to="\/account"/g) ?? []).length, 0);
  const mobileTabsSource = appSource.match(/const mobileTabs = \[([\s\S]*?)\] as const;/)?.[1] ?? '';
  assert.doesNotMatch(mobileTabsSource, /Account/);

  const packageJson = JSON.parse(packageSource);
  assert.equal(packageJson.dependencies['@supabase/supabase-js'], '^2.57.4');
  assert.equal(packageJson.devDependencies.supabase, '^2.115.0');
  assert.equal(envExample, 'VITE_SUPABASE_URL=\nVITE_SUPABASE_PUBLISHABLE_KEY=\n');
  assert.match(gitignore, /^\*\.local$/m);
});

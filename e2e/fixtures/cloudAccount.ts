import type { Page, Route } from '@playwright/test';

/**
 * The visual build points Supabase at this intercepted host.  The browser
 * still exercises the production AuthProvider and cloud-authoritative account
 * bootstrap, but no request can reach a real Supabase project.
 */
export const VISUAL_SUPABASE_HOST = 'visual-fixture.supabase.co';
export const VISUAL_SUPABASE_URL = `https://${VISUAL_SUPABASE_HOST}`;
export const VISUAL_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_visual_fixture';
export const VISUAL_ACCOUNT_USER_ID = '00000000-0000-4000-8000-000000000007';
const VISUAL_STORAGE_KEY = 'sb-visual-fixture-auth-token';
const CLOUD_TIMESTAMP = '2026-08-29T12:00:00.000Z';

type FixtureRow = {
  user_id: string;
  namespace: 'portfolio' | 'watchlist' | 'preferences';
  schema_version: 1;
  payload: { data: unknown };
  revision: number;
  created_at: string;
  updated_at: string;
};

export type DeterministicCloudFixture = {
  portfolio: unknown[];
  watchlist: unknown[];
  preferences?: Record<string, unknown>;
};

export type CloudFixtureHandle = {
  rows: FixtureRow[];
  requests: string[];
  setNamespaceData(namespace: FixtureRow['namespace'], data: unknown[]): void;
};

function durablePortfolio(value: unknown[]): unknown[] {
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const durable = { ...(item as Record<string, unknown>) };
    delete durable.latestMarketData;
    return durable;
  });
}

function durableWatchlist(value: unknown[]): unknown[] {
  return value.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    const durable = { ...(item as Record<string, unknown>) };
    delete durable.snapshot;
    delete durable.status;
    delete durable.updatedAt;
    return durable;
  });
}

function makeRows(fixture: DeterministicCloudFixture): FixtureRow[] {
  return [
    { user_id: VISUAL_ACCOUNT_USER_ID, namespace: 'portfolio', schema_version: 1, payload: { data: durablePortfolio(fixture.portfolio) }, revision: 10, created_at: CLOUD_TIMESTAMP, updated_at: CLOUD_TIMESTAMP },
    { user_id: VISUAL_ACCOUNT_USER_ID, namespace: 'watchlist', schema_version: 1, payload: { data: durableWatchlist(fixture.watchlist) }, revision: 10, created_at: CLOUD_TIMESTAMP, updated_at: CLOUD_TIMESTAMP },
    { user_id: VISUAL_ACCOUNT_USER_ID, namespace: 'preferences', schema_version: 1, payload: { data: fixture.preferences ?? {} }, revision: 10, created_at: CLOUD_TIMESTAMP, updated_at: CLOUD_TIMESTAMP },
  ];
}

function sessionValue() {
  return {
    access_token: 'visual-fixture-access-token',
    refresh_token: 'visual-fixture-refresh-token',
    expires_in: 86_400,
    expires_at: Math.floor(Date.now() / 1000) + 86_400,
    token_type: 'bearer',
    user: {
      id: VISUAL_ACCOUNT_USER_ID,
      aud: 'authenticated',
      role: 'authenticated',
      email: 'visual-fixture@example.invalid',
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {},
      created_at: CLOUD_TIMESTAMP,
      updated_at: CLOUD_TIMESTAMP,
    },
  };
}

function respond(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    headers: { 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  });
}

export async function installDeterministicCloudAccount(
  page: Page,
  fixture: DeterministicCloudFixture,
): Promise<CloudFixtureHandle> {
  const rows = makeRows(fixture);
  const requests: string[] = [];
  const session = sessionValue();

  await page.addInitScript(({ storageKey, sessionValue: value }) => {
    localStorage.setItem(storageKey, JSON.stringify(value));
    localStorage.removeItem('put_scanner_portfolio_trades');
    localStorage.removeItem('put_scanner_watchlist');
  }, { storageKey: VISUAL_STORAGE_KEY, sessionValue: session });

  await page.route(`${VISUAL_SUPABASE_URL}/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push(`${request.method()} ${url.pathname}${url.search}`);

    if (url.pathname.startsWith('/auth/v1/')) {
      if (url.pathname.endsWith('/user')) return respond(route, session.user);
      return respond(route, session);
    }

    if (url.pathname === '/rest/v1/user_state') {
      const namespaceFilter = url.searchParams.get('namespace')?.replace(/^eq\./, '');
      if (request.method() === 'GET') {
        return respond(route, namespaceFilter ? rows.filter(row => row.namespace === namespaceFilter) : rows);
      }
      if (request.method() === 'POST') return respond(route, rows, 201);
      if (request.method() === 'PATCH') {
        const row = rows.find(candidate => candidate.namespace === namespaceFilter);
        if (!row) return respond(route, [], 200);
        try {
          const body = JSON.parse(request.postData() || '{}') as { schema_version?: number; payload?: { data: unknown } };
          if (body.schema_version === 1 && body.payload) row.payload = body.payload;
        } catch {
          return respond(route, { error: 'Invalid visual cloud update.' }, 400);
        }
        row.revision += 1;
        row.updated_at = new Date().toISOString();
        return respond(route, [row]);
      }
    }

    return respond(route, { error: 'Unmocked visual Supabase request.' }, 501);
  });

  return {
    rows,
    requests,
    setNamespaceData(namespace, data) {
      const row = rows.find(candidate => candidate.namespace === namespace);
      if (row) row.payload = { data: namespace === 'portfolio' ? durablePortfolio(data) : namespace === 'watchlist' ? durableWatchlist(data) : data };
    },
  };
}

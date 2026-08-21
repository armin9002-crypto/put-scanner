import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  beginMigrationBackupSession,
  hasCurrentSessionBackupAcknowledgement,
  recordMigrationBackupExport,
} from '../src/lib/cloudState/backupGate.ts';
import {
  CLOUD_MIGRATION_TEST_NOTE,
  createDisposableLocalTestData,
  createDisposableMigrationFixture,
} from '../src/lib/cloudState/devFixture.ts';
import {
  initializeTestAccountAfterFreshCheck,
  restoreTestAccountAfterFreshFetch,
} from '../src/lib/cloudState/devMigrationHarness.ts';
import { isCloudMigrationTestModeEnabled } from '../src/lib/cloudState/devTestMode.ts';
import { readCanonicalLocalState } from '../src/lib/cloudState/localState.ts';
import {
  captureDurableLocalRecoverySnapshot,
  durableLocalSnapshotMatches,
  restoreCloudStateToLocal,
} from '../src/lib/cloudState/localRestore.ts';
import { initializationMatchesCloud } from '../src/lib/cloudState/stateComparison.ts';
import {
  CLOUD_SYNC_METADATA_KEY,
  createCloudSyncMetadata,
  writeCloudSyncMetadata,
} from '../src/lib/cloudState/syncMetadata.ts';
import { PORTFOLIO_MARK_BASIS_KEY } from '../src/lib/portfolioMarkPreference.ts';
import {
  PORTFOLIO_STORAGE_KEY,
  readPortfolioTrades,
  writePortfolioTrades,
} from '../src/lib/portfolioStorage.ts';
import { WATCHLIST_STORAGE_KEY } from '../src/lib/watchlist.ts';
import {
  LEGACY_THEME_STORAGE_KEY,
  THEME_MIGRATION_KEY,
  THEME_MIGRATION_VERSION,
  THEME_STORAGE_KEY,
} from '../src/lib/themePreference.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userId = '22222222-2222-4222-8222-222222222222';
const now = new Date('2026-08-21T12:00:00.000Z');

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
    this.writes = [];
    this.removes = [];
    this.failOnceOnKey = null;
    this.failed = false;
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (key === this.failOnceOnKey && !this.failed) {
      this.failed = true;
      throw new Error('injected write failure');
    }
    this.values.set(key, String(value));
    this.writes.push([key, String(value)]);
  }

  removeItem(key) {
    this.values.delete(key);
    this.removes.push(key);
  }
}

function cloudFromFixture(fixture = createDisposableMigrationFixture(now), overrides = {}) {
  const base = {
    portfolio: {
      userId,
      namespace: 'portfolio',
      schemaVersion: 1,
      payload: { data: fixture.data.portfolio.data },
      revision: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    watchlist: {
      userId,
      namespace: 'watchlist',
      schemaVersion: 1,
      payload: { data: fixture.data.watchlist.data },
      revision: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    preferences: {
      userId,
      namespace: 'preferences',
      schemaVersion: 1,
      payload: { data: fixture.data.preferences.data },
      revision: 1,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
  };
  return {
    portfolio: { ...base.portfolio, ...overrides.portfolio },
    watchlist: { ...base.watchlist, ...overrides.watchlist },
    preferences: { ...base.preferences, ...overrides.preferences },
  };
}

function populatedStorage() {
  const storage = new MemoryStorage();
  const fixture = createDisposableLocalTestData(storage, now);
  assert.equal(fixture.ok, true);
  storage.writes.length = 0;
  storage.removes.length = 0;
  return storage;
}

function validEmptyStorage() {
  return new MemoryStorage({
    [PORTFOLIO_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 1,
      updatedAt: null,
      revision: 0,
      data: [],
    }),
    [WATCHLIST_STORAGE_KEY]: JSON.stringify({
      schemaVersion: 1,
      updatedAt: null,
      revision: 0,
      data: [],
    }),
    [THEME_STORAGE_KEY]: 'dark',
    [LEGACY_THEME_STORAGE_KEY]: 'dark',
    [THEME_MIGRATION_KEY]: THEME_MIGRATION_VERSION,
    [PORTFOLIO_MARK_BASIS_KEY]: 'ask',
  });
}

test('double gate requires DEV and the exact true flag', () => {
  assert.equal(isCloudMigrationTestModeEnabled({ dev: true, flag: 'true' }), true);
  assert.equal(isCloudMigrationTestModeEnabled({ dev: false, flag: 'true' }), false);
  assert.equal(isCloudMigrationTestModeEnabled({ dev: true, flag: undefined }), false);
  assert.equal(isCloudMigrationTestModeEnabled({ dev: true, flag: 'false' }), false);
  assert.equal(isCloudMigrationTestModeEnabled({ dev: true, flag: true }), false);
});

test('development entry is lazy, Account-only, signed-in-only, and has no automatic cloud check', async () => {
  const [account, harness, auth, app] = await Promise.all([
    readFile(path.join(root, 'src/components/AccountControl.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/CloudMigrationTestHarness.tsx'), 'utf8'),
    readFile(path.join(root, 'src/lib/auth.tsx'), 'utf8'),
    readFile(path.join(root, 'src/App.tsx'), 'utf8'),
  ]);
  assert.match(account, /import\.meta\.env\.DEV[\s\S]*?lazy\(\(\) => import\('\.\/CloudMigrationTestHarness'\)\)/);
  assert.match(account, /VITE_CLOUD_MIGRATION_TEST_MODE/);
  assert.match(account, /if \(user\)[\s\S]*?cloudMigrationTestModeEnabled[\s\S]*?DevCloudMigrationTestHarness/);
  assert.doesNotMatch(auth, /cloudState|user_state|CloudMigrationTestHarness/);
  assert.doesNotMatch(app, /CloudMigrationTestHarness|Migration Test Harness|VITE_CLOUD_MIGRATION_TEST_MODE/);
  assert.doesNotMatch(harness, /useEffect|setInterval|onAuthStateChange|\.channel\s*\(/);
  assert.equal((harness.match(/client\.fetchAllUserState\(\)/g) ?? []).length, 1);
  assert.match(harness, /Check Cloud State/);
});

test('clean local browser accepts the canonical disposable fixture with meaningful safe counts', () => {
  const storage = new MemoryStorage();
  const result = createDisposableLocalTestData(storage, now);
  assert.equal(result.ok, true);
  assert.equal(result.local.summary.portfolio.openTradeCount, 1);
  assert.equal(result.local.summary.portfolio.historyCount, 1);
  assert.equal(result.local.summary.watchlist.itemCount, 1);
  assert.equal(result.local.summary.preferences.nonDefaultPreferenceCount, 3);
  assert.equal(result.backup.data.portfolio.data.every(trade => trade.id.startsWith('cloud-migration-test-')), true);
  assert.equal(result.backup.data.portfolio.data.every(trade => trade.notes === CLOUD_MIGRATION_TEST_NOTE), true);
  assert.equal(result.backup.data.watchlist.data[0].ticker, 'CLOUDTEST');
  assert.equal(result.backup.data.watchlist.data[0].note, CLOUD_MIGRATION_TEST_NOTE);
  assert.equal(readCanonicalLocalState(storage).status, 'ok');
});

test('non-empty preexisting local state blocks fixture creation without replace, clear, or merge', () => {
  const storage = populatedStorage();
  const before = new Map(storage.values);
  const result = createDisposableLocalTestData(storage, new Date('2026-08-22T12:00:00.000Z'));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'local_not_empty');
  assert.match(result.message, /already contains Put Scanner data/);
  assert.deepEqual(storage.values, before);
  assert.equal(storage.writes.length, 0);
  assert.equal(storage.removes.length, 0);
});

test('backup acknowledgement is successful-export-only and a reload/new session relocks', () => {
  const sessionA = beginMigrationBackupSession('stage4b-a');
  assert.equal(hasCurrentSessionBackupAcknowledgement(sessionA, 'stage4b-a'), false);
  const failed = recordMigrationBackupExport(sessionA, 'stage4b-a', 'failed');
  assert.equal(hasCurrentSessionBackupAcknowledgement(failed, 'stage4b-a'), false);
  const succeeded = recordMigrationBackupExport(failed, 'stage4b-a', 'succeeded');
  assert.equal(hasCurrentSessionBackupAcknowledgement(succeeded, 'stage4b-a'), true);
  const reloaded = beginMigrationBackupSession('stage4b-b');
  assert.equal(hasCurrentSessionBackupAcknowledgement(reloaded, 'stage4b-b'), false);
});

test('pre-initialization fresh check catches a cloud race and performs zero initialization', async () => {
  const storage = populatedStorage();
  let fetchCalls = 0;
  let initializationCalls = 0;
  const client = {
    async fetchAllUserState() {
      fetchCalls += 1;
      return { ok: true, value: { status: 'complete', state: cloudFromFixture() } };
    },
    async initializeAllNamespaces() {
      initializationCalls += 1;
      throw new Error('must not initialize');
    },
  };
  const result = await initializeTestAccountAfterFreshCheck(client, storage, userId, true, now);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'cloud_conflict');
  assert.equal(fetchCalls, 1);
  assert.equal(initializationCalls, 0);
});

test('verified initialization requires backup, fresh empty check, exact read-back, and captures revisions', async () => {
  const lockedStorage = populatedStorage();
  let lockedFetches = 0;
  const locked = await initializeTestAccountAfterFreshCheck({
    async fetchAllUserState() { lockedFetches += 1; return { ok: true, value: { status: 'empty' } }; },
    async initializeAllNamespaces() { throw new Error('must stay locked'); },
  }, lockedStorage, userId, false, now);
  assert.equal(locked.ok, false);
  assert.equal(locked.code, 'backup_required');
  assert.equal(lockedFetches, 0);

  const storage = populatedStorage();
  const local = readCanonicalLocalState(storage);
  assert.equal(local.status, 'ok');
  let fetchCalls = 0;
  let initializationCalls = 0;
  let capturedInput = null;
  const cloud = cloudFromFixture();
  const client = {
    async fetchAllUserState() {
      fetchCalls += 1;
      return { ok: true, value: { status: 'empty' } };
    },
    async initializeAllNamespaces(input) {
      initializationCalls += 1;
      capturedInput = input;
      return { ok: true, value: cloud };
    },
  };
  const result = await initializeTestAccountAfterFreshCheck(client, storage, userId, true, now);
  assert.equal(result.ok, true);
  assert.equal(fetchCalls, 1);
  assert.equal(initializationCalls, 1);
  assert.equal(initializationMatchesCloud(capturedInput, cloud), true);
  assert.equal(result.metadataWritten, true);
  assert.equal(result.metadata.migrationState, 'migration_verified');
  assert.equal(result.metadata.namespaces.portfolio.cloudRevision, 1);
  assert.equal(result.metadata.namespaces.watchlist.cloudRevision, 1);
  assert.equal(result.metadata.namespaces.preferences.cloudRevision, 1);
  assert.equal(JSON.parse(storage.getItem(CLOUD_SYNC_METADATA_KEY)).userId, userId);
});

test('account-mismatched metadata blocks migration before any cloud request', async () => {
  const storage = populatedStorage();
  assert.deepEqual(writeCloudSyncMetadata(storage, createCloudSyncMetadata('different-user')), { status: 'ok' });
  let requests = 0;
  const result = await initializeTestAccountAfterFreshCheck({
    async fetchAllUserState() { requests += 1; return { ok: true, value: { status: 'empty' } }; },
    async initializeAllNamespaces() { requests += 1; throw new Error('blocked'); },
  }, storage, userId, true, now);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'metadata_conflict');
  assert.equal(requests, 0);
  assert.equal(readCanonicalLocalState(storage).value.summary.hasMeaningfulData, true);
});

test('explicit restore fetches once, validates all namespaces, writes locally, verifies, and records metadata', async () => {
  const storage = validEmptyStorage();
  let fetchCalls = 0;
  const cloud = cloudFromFixture();
  const result = await restoreTestAccountAfterFreshFetch({
    async fetchAllUserState() {
      fetchCalls += 1;
      return { ok: true, value: { status: 'complete', state: cloud } };
    },
  }, storage, userId, { now });
  assert.equal(result.ok, true);
  assert.equal(fetchCalls, 1);
  assert.equal(initializationMatchesCloud(result.local.documents, cloud), true);
  assert.equal(result.metadataWritten, true);
  assert.equal(result.metadata.namespaces.portfolio.cloudRevision, 1);

  const portfolioRaw = JSON.parse(storage.getItem(PORTFOLIO_STORAGE_KEY));
  const watchlistRaw = JSON.parse(storage.getItem(WATCHLIST_STORAGE_KEY));
  assert.equal('localMarketData' in portfolioRaw, false);
  assert.equal('localState' in watchlistRaw, false);
  assert.equal(JSON.stringify(portfolioRaw).includes('optionBid'), false);
  assert.equal(JSON.stringify(watchlistRaw).includes('snapshot'), false);
});

test('partial, corrupt, unsupported, or wrong-owner cloud state causes zero durable local writes', () => {
  const cases = [
    (() => { const cloud = cloudFromFixture(); delete cloud.watchlist; return cloud; })(),
    cloudFromFixture(undefined, { portfolio: { schemaVersion: 99 } }),
    cloudFromFixture(undefined, {
      portfolio: { payload: { data: [{ ...createDisposableMigrationFixture(now).data.portfolio.data[0], latestMarketData: { optionBid: 1 } }] } },
    }),
    cloudFromFixture(undefined, { preferences: { userId: 'different-user' } }),
  ];
  for (const cloud of cases) {
    const storage = validEmptyStorage();
    const before = captureDurableLocalRecoverySnapshot(storage);
    const result = restoreCloudStateToLocal(storage, cloud, userId, { now });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'cloud_invalid');
    assert.equal(durableLocalSnapshotMatches(storage, before), true);
    assert.equal(storage.writes.length, 0);
    assert.equal(storage.removes.length, 0);
  }
});

test('restore failure after Portfolio write rolls every durable key back exactly', () => {
  const storage = validEmptyStorage();
  const before = captureDurableLocalRecoverySnapshot(storage);
  const result = restoreCloudStateToLocal(storage, cloudFromFixture(), userId, {
    now,
    testHooks: { afterNamespaceWrite: namespace => { if (namespace === 'portfolio') throw new Error('injected'); } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'write_failed');
  assert.equal(durableLocalSnapshotMatches(storage, before), true);
});

test('restore failure after Watchlist write rolls every durable key back exactly', () => {
  const storage = validEmptyStorage();
  const before = captureDurableLocalRecoverySnapshot(storage);
  const result = restoreCloudStateToLocal(storage, cloudFromFixture(), userId, {
    now,
    testHooks: { afterNamespaceWrite: namespace => { if (namespace === 'watchlist') throw new Error('injected'); } },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'write_failed');
  assert.equal(durableLocalSnapshotMatches(storage, before), true);
});

test('restore failure during Preferences write rolls every durable key back exactly', () => {
  const storage = validEmptyStorage();
  storage.failOnceOnKey = PORTFOLIO_MARK_BASIS_KEY;
  const before = captureDurableLocalRecoverySnapshot(storage);
  const result = restoreCloudStateToLocal(storage, cloudFromFixture(), userId, { now });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'write_failed');
  assert.equal(durableLocalSnapshotMatches(storage, before), true);
});

test('restore verification mismatch rolls every durable key back exactly', () => {
  const storage = validEmptyStorage();
  const before = captureDurableLocalRecoverySnapshot(storage);
  const result = restoreCloudStateToLocal(storage, cloudFromFixture(), userId, {
    now,
    testHooks: { forceVerificationMismatch: true },
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'verification_failed');
  assert.equal(durableLocalSnapshotMatches(storage, before), true);
});

test('normal durable edits after migration still make zero user_state UPDATE calls', async () => {
  const storage = populatedStorage();
  const read = readPortfolioTrades(storage);
  assert.equal(read.status, 'ok');
  let databaseCalls = 0;
  const unusedCloudClient = { from() { databaseCalls += 1; throw new Error('cloud update forbidden'); } };
  assert.ok(unusedCloudClient);
  const edited = read.data.map((trade, index) => index === 0 ? { ...trade, notes: 'local edit only' } : trade);
  assert.equal(writePortfolioTrades(storage, edited, { now: new Date('2026-08-21T13:00:00.000Z') }).status, 'ok');
  assert.equal(databaseCalls, 0);

  const normalRuntimeFiles = [
    'src/lib/portfolioStorage.ts',
    'src/lib/watchlist.ts',
    'src/lib/theme.tsx',
    'src/pages/PortfolioPage.tsx',
    'src/pages/WatchlistPage.tsx',
  ];
  const normalRuntime = (await Promise.all(normalRuntimeFiles.map(file => readFile(path.join(root, file), 'utf8')))).join('\n');
  assert.doesNotMatch(normalRuntime, /cloudStateClient|updateNamespaceIfRevisionMatches|user_state/);
});

test('Stage 4B changes no SQL, RLS, dashboard, Vercel, route, or navigation contract', async () => {
  const [migrations, app, envExample] = await Promise.all([
    readdir(path.join(root, 'supabase/migrations')),
    readFile(path.join(root, 'src/App.tsx'), 'utf8'),
    readFile(path.join(root, '.env.example'), 'utf8'),
  ]);
  assert.deepEqual(migrations, ['20260820154219_create_user_state.sql']);
  assert.equal((app.match(/label: '(?:Scanner|Screener|Watchlist|Portfolio|Pulse)'/g) ?? []).length, 5);
  assert.doesNotMatch(app, /migration-test|CloudMigrationTestHarness/i);
  assert.equal(envExample, 'VITE_SUPABASE_URL=\nVITE_SUPABASE_PUBLISHABLE_KEY=\nVITE_CLOUD_MIGRATION_TEST_MODE=false\n');
});

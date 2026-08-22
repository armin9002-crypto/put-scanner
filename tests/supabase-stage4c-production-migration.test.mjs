import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  initializeAccountAfterFreshCheck,
  inspectAccountData,
  restoreAccountAfterFreshFetch,
} from '../src/lib/cloudState/accountMigration.ts';
import {
  beginMigrationBackupSession,
  hasCurrentSessionBackupAcknowledgement,
  recordMigrationBackupExport,
} from '../src/lib/cloudState/backupGate.ts';
import {
  createDisposableLocalTestData,
  createDisposableMigrationFixture,
} from '../src/lib/cloudState/devFixture.ts';
import {
  captureDurableLocalRecoverySnapshot,
  durableLocalSnapshotMatches,
} from '../src/lib/cloudState/localRestore.ts';
import { readCanonicalLocalState } from '../src/lib/cloudState/localState.ts';
import { initializationMatchesCloud } from '../src/lib/cloudState/stateComparison.ts';
import {
  CLOUD_SYNC_METADATA_KEY,
  createCloudSyncMetadata,
  writeCloudSyncMetadata,
} from '../src/lib/cloudState/syncMetadata.ts';
import { PORTFOLIO_MARK_BASIS_KEY } from '../src/lib/portfolioMarkPreference.ts';
import { PORTFOLIO_STORAGE_KEY, readPortfolioTrades, writePortfolioTrades } from '../src/lib/portfolioStorage.ts';
import {
  LEGACY_THEME_STORAGE_KEY,
  THEME_MIGRATION_KEY,
  THEME_MIGRATION_VERSION,
  THEME_STORAGE_KEY,
} from '../src/lib/themePreference.ts';
import { WATCHLIST_STORAGE_KEY } from '../src/lib/watchlist.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userId = '33333333-3333-4333-8333-333333333333';
const now = new Date('2026-08-21T18:00:00.000Z');

class MemoryStorage {
  constructor(entries = {}) {
    this.values = new Map(Object.entries(entries));
    this.writes = [];
    this.removes = [];
  }

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    this.values.set(key, String(value));
    this.writes.push([key, String(value)]);
  }

  removeItem(key) {
    this.values.delete(key);
    this.removes.push(key);
  }
}

function populatedStorage() {
  const storage = new MemoryStorage();
  const fixture = createDisposableLocalTestData(storage, now);
  assert.equal(fixture.ok, true);
  storage.writes.length = 0;
  storage.removes.length = 0;
  return storage;
}

function emptyStorage() {
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

test('authentication, session restoration, and normal app mount remain cloud-write free', async () => {
  const [authProvider, authActions, app, account, accountData] = await Promise.all([
    readFile(path.join(root, 'src/lib/auth.tsx'), 'utf8'),
    readFile(path.join(root, 'src/lib/authActions.ts'), 'utf8'),
    readFile(path.join(root, 'src/App.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/AccountControl.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/AccountDataSection.tsx'), 'utf8'),
  ]);
  const authRuntime = `${authProvider}\n${authActions}\n${app}`;
  assert.doesNotMatch(authRuntime, /user_state|initializeAllNamespaces|updateNamespaceIfRevisionMatches|accountMigration/);
  assert.match(account, /if \(user\)[\s\S]*?<AccountDataSection userId=\{user\.id\}/);
  assert.doesNotMatch(accountData, /useEffect|setInterval|visibilitychange|focus|onAuthStateChange|\.channel\s*\(/);
  assert.match(accountData, /onClick=\{openAccountData\}/);
  assert.match(accountData, /void checkStatus\(\)/);
  assert.match(accountData, /statusCheckInFlight\.current/);
  assert.match(accountData, /operationInFlight\.current/);
});

test('explicit Account Data inspection performs one cloud read and no local or cloud write', async () => {
  const storage = populatedStorage();
  let fetches = 0;
  const result = await inspectAccountData({
    async fetchAllUserState() {
      fetches += 1;
      return { ok: true, value: { status: 'empty' } };
    },
  }, storage, userId);
  assert.equal(result.ok, true);
  assert.equal(result.value.plan.state, 'cloud_empty_local_has_data');
  assert.equal(fetches, 1);
  assert.equal(storage.writes.length, 0);
  assert.equal(storage.removes.length, 0);
});

test('fresh backup and explicit confirmation are both enforced before any cloud request', async () => {
  const storage = populatedStorage();
  let requests = 0;
  const client = {
    async fetchAllUserState() { requests += 1; return { ok: true, value: { status: 'empty' } }; },
    async initializeAllNamespaces() { requests += 1; throw new Error('must remain locked'); },
  };
  const noBackup = await initializeAccountAfterFreshCheck(client, storage, userId, {
    backupAcknowledgedThisSession: false,
    confirmed: true,
    now,
  });
  assert.equal(noBackup.ok, false);
  assert.equal(noBackup.code, 'backup_required');
  const noConfirmation = await initializeAccountAfterFreshCheck(client, storage, userId, {
    backupAcknowledgedThisSession: true,
    confirmed: false,
    now,
  });
  assert.equal(noConfirmation.ok, false);
  assert.equal(noConfirmation.code, 'confirmation_required');
  assert.equal(requests, 0);

  const session = beginMigrationBackupSession('production-migration-a');
  assert.equal(hasCurrentSessionBackupAcknowledgement(session, 'production-migration-a'), false);
  const failed = recordMigrationBackupExport(session, 'production-migration-a', 'failed');
  assert.equal(hasCurrentSessionBackupAcknowledgement(failed, 'production-migration-a'), false);
  const succeeded = recordMigrationBackupExport(failed, 'production-migration-a', 'succeeded');
  assert.equal(hasCurrentSessionBackupAcknowledgement(succeeded, 'production-migration-a'), true);
  assert.equal(hasCurrentSessionBackupAcknowledgement(succeeded, 'production-migration-b'), false);
});

test('owner path rechecks empty cloud, initializes exact documents once, verifies, records revisions, and preserves every durable raw value', async () => {
  const storage = populatedStorage();
  const before = captureDurableLocalRecoverySnapshot(storage);
  let fetches = 0;
  let initializations = 0;
  let uploaded = null;
  const cloud = cloudFromFixture();
  const result = await initializeAccountAfterFreshCheck({
    async fetchAllUserState() {
      fetches += 1;
      return { ok: true, value: { status: 'empty' } };
    },
    async initializeAllNamespaces(input) {
      initializations += 1;
      uploaded = input;
      return { ok: true, value: cloud };
    },
  }, storage, userId, {
    backupAcknowledgedThisSession: true,
    confirmed: true,
    now,
  });
  assert.equal(result.ok, true);
  assert.equal(fetches, 1);
  assert.equal(initializations, 1);
  assert.deepEqual(Object.keys(uploaded).sort(), ['portfolio', 'preferences', 'watchlist']);
  assert.equal(initializationMatchesCloud(uploaded, cloud), true);
  assert.equal(durableLocalSnapshotMatches(storage, before), true);
  assert.equal(result.metadata.migrationState, 'migration_verified');
  assert.equal(result.metadata.namespaces.portfolio.cloudRevision, 1);
  assert.equal(result.metadata.namespaces.watchlist.cloudRevision, 1);
  assert.equal(result.metadata.namespaces.preferences.cloudRevision, 1);
  assert.equal(JSON.parse(storage.getItem(CLOUD_SYNC_METADATA_KEY)).userId, userId);
});

test('a cloud race stops before initialization and changes no local raw value', async () => {
  const storage = populatedStorage();
  const before = captureDurableLocalRecoverySnapshot(storage);
  let initializations = 0;
  const result = await initializeAccountAfterFreshCheck({
    async fetchAllUserState() { return { ok: true, value: { status: 'complete', state: cloudFromFixture() } }; },
    async initializeAllNamespaces() { initializations += 1; throw new Error('must not write'); },
  }, storage, userId, {
    backupAcknowledgedThisSession: true,
    confirmed: true,
    now,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'cloud_conflict');
  assert.match(result.message, /Nothing was overwritten/);
  assert.equal(initializations, 0);
  assert.equal(durableLocalSnapshotMatches(storage, before), true);
  assert.equal(storage.getItem(CLOUD_SYNC_METADATA_KEY), null);
});

test('a local edit after status review invalidates the confirmation before any cloud request', async () => {
  const storage = populatedStorage();
  const reviewed = readCanonicalLocalState(storage);
  assert.equal(reviewed.status, 'ok');
  const portfolio = readPortfolioTrades(storage);
  assert.equal(portfolio.status, 'ok');
  const edited = portfolio.data.map((trade, index) => index === 0 ? { ...trade, notes: 'changed after review' } : trade);
  assert.equal(writePortfolioTrades(storage, edited, { now: new Date('2026-08-21T18:30:00.000Z') }).status, 'ok');
  let requests = 0;
  const result = await initializeAccountAfterFreshCheck({
    async fetchAllUserState() { requests += 1; return { ok: true, value: { status: 'empty' } }; },
    async initializeAllNamespaces() { requests += 1; throw new Error('must not initialize'); },
  }, storage, userId, {
    backupAcknowledgedThisSession: true,
    confirmed: true,
    expectedLocalDocuments: reviewed.value.documents,
    now,
  });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'local_changed');
  assert.equal(requests, 0);
  assert.equal(storage.getItem(CLOUD_SYNC_METADATA_KEY), null);
});

test('initialization failure or verification mismatch preserves local data and creates no verified metadata', async () => {
  for (const initializeAllNamespaces of [
    async () => ({ ok: false, error: { code: 'permission_error', operation: 'initialize_all', message: 'Initialization was not permitted.' } }),
    async () => {
      const mismatched = cloudFromFixture();
      mismatched.preferences = {
        ...mismatched.preferences,
        payload: { data: { ...mismatched.preferences.payload.data, theme: 'light' } },
      };
      return { ok: true, value: mismatched };
    },
  ]) {
    const storage = populatedStorage();
    const before = captureDurableLocalRecoverySnapshot(storage);
    const result = await initializeAccountAfterFreshCheck({
      async fetchAllUserState() { return { ok: true, value: { status: 'empty' } }; },
      initializeAllNamespaces,
    }, storage, userId, {
      backupAcknowledgedThisSession: true,
      confirmed: true,
      now,
    });
    assert.equal(result.ok, false);
    assert.equal(['initialization_failed', 'verification_failed'].includes(result.code), true);
    assert.equal(durableLocalSnapshotMatches(storage, before), true);
    assert.equal(storage.getItem(CLOUD_SYNC_METADATA_KEY), null);
  }
});

test('restore requires explicit confirmation, then fetches once and completes verified transactional hydration', async () => {
  const lockedStorage = emptyStorage();
  let lockedFetches = 0;
  const locked = await restoreAccountAfterFreshFetch({
    async fetchAllUserState() { lockedFetches += 1; return { ok: true, value: { status: 'complete', state: cloudFromFixture() } }; },
  }, lockedStorage, userId, { confirmed: false, now });
  assert.equal(locked.ok, false);
  assert.equal(locked.code, 'confirmation_required');
  assert.equal(lockedFetches, 0);

  const storage = emptyStorage();
  let fetches = 0;
  const cloud = cloudFromFixture();
  const restored = await restoreAccountAfterFreshFetch({
    async fetchAllUserState() {
      fetches += 1;
      return { ok: true, value: { status: 'complete', state: cloud } };
    },
  }, storage, userId, { confirmed: true, now });
  assert.equal(restored.ok, true);
  assert.equal(fetches, 1);
  assert.equal(initializationMatchesCloud(restored.local.documents, cloud), true);
  assert.equal(restored.metadata.migrationState, 'migration_verified');
});

test('both-populated inspection is a conflict with summaries and offers no automatic direction', async () => {
  const storage = populatedStorage();
  const result = await inspectAccountData({
    async fetchAllUserState() { return { ok: true, value: { status: 'complete', state: cloudFromFixture() } }; },
  }, storage, userId);
  assert.equal(result.ok, true);
  assert.equal(result.value.plan.state, 'both_have_data');
  assert.equal(result.value.plan.canInitializeCloud, false);
  assert.equal(result.value.plan.canHydrateLocal, false);
  assert.equal(result.value.localAssessment.hasMeaningfulData, true);
  assert.equal(result.value.cloudSummary.hasMeaningfulData, true);
  assert.equal(storage.writes.length, 0);
});

test('account-mismatched metadata blocks inspection, upload, and restore without a cloud request or durable change', async () => {
  for (const storage of [populatedStorage(), emptyStorage()]) {
    assert.deepEqual(writeCloudSyncMetadata(storage, createCloudSyncMetadata('different-user')), { status: 'ok' });
    storage.writes.length = 0;
    storage.removes.length = 0;
    const before = captureDurableLocalRecoverySnapshot(storage);
    let requests = 0;
    const client = {
      async fetchAllUserState() { requests += 1; return { ok: true, value: { status: 'empty' } }; },
      async initializeAllNamespaces() { requests += 1; throw new Error('blocked'); },
    };
    const inspected = await inspectAccountData(client, storage, userId);
    assert.equal(inspected.ok, false);
    assert.equal(inspected.code, 'metadata_conflict');
    const portfolio = readPortfolioTrades(storage);
    const operation = portfolio.status === 'ok' && portfolio.data.length > 0
      ? initializeAccountAfterFreshCheck(client, storage, userId, { backupAcknowledgedThisSession: true, confirmed: true, now })
      : restoreAccountAfterFreshFetch(client, storage, userId, { confirmed: true, now });
    const blocked = await operation;
    assert.equal(blocked.ok, false);
    assert.equal(blocked.code, 'metadata_conflict');
    assert.equal(requests, 0);
    assert.equal(durableLocalSnapshotMatches(storage, before), true);
  }
});

test('partial, corrupt, unsupported, and wrong-owner cloud responses produce zero local writes', async () => {
  const errors = ['cloud_state_incomplete', 'cloud_state_unexpected', 'schema_unsupported'];
  for (const code of errors) {
    const storage = emptyStorage();
    storage.writes.length = 0;
    storage.removes.length = 0;
    const result = await inspectAccountData({
      async fetchAllUserState() {
        return { ok: false, error: { code, operation: 'fetch_all', message: 'Account data failed validation.' } };
      },
    }, storage, userId);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'cloud_check_failed');
    assert.equal(result.errorCode, code);
    assert.equal(storage.writes.length, 0);
    assert.equal(storage.removes.length, 0);
  }

  for (const cloud of [
    (() => { const value = cloudFromFixture(); delete value.watchlist; return value; })(),
    cloudFromFixture(undefined, { portfolio: { schemaVersion: 99 } }),
    cloudFromFixture(undefined, { watchlist: { userId: 'different-user' } }),
  ]) {
    const storage = emptyStorage();
    storage.writes.length = 0;
    storage.removes.length = 0;
    const before = captureDurableLocalRecoverySnapshot(storage);
    const result = await restoreAccountAfterFreshFetch({
      async fetchAllUserState() { return { ok: true, value: { status: 'complete', state: cloud } }; },
    }, storage, userId, { confirmed: true, now });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'restore_failed');
    assert.equal(durableLocalSnapshotMatches(storage, before), true);
    assert.equal(storage.writes.length, 0);
    assert.equal(storage.removes.length, 0);
  }
});

test('normal post-migration durable edits still cause zero cloud UPDATE calls', () => {
  const storage = populatedStorage();
  const read = readPortfolioTrades(storage);
  assert.equal(read.status, 'ok');
  let cloudCalls = 0;
  const unusedCloudTransport = { from() { cloudCalls += 1; throw new Error('not wired'); } };
  assert.ok(unusedCloudTransport);
  const edited = read.data.map((trade, index) => index === 0 ? { ...trade, notes: 'local-only production edit' } : trade);
  assert.equal(writePortfolioTrades(storage, edited, { now: new Date('2026-08-21T19:00:00.000Z') }).status, 'ok');
  assert.equal(cloudCalls, 0);
});

test('production UI is real-data-only while the disposable harness remains double-gated and route-free', async () => {
  const [account, accountData, accountMigration, harness, app, envExample, migrations] = await Promise.all([
    readFile(path.join(root, 'src/components/AccountControl.tsx'), 'utf8'),
    readFile(path.join(root, 'src/components/AccountDataSection.tsx'), 'utf8'),
    readFile(path.join(root, 'src/lib/cloudState/accountMigration.ts'), 'utf8'),
    readFile(path.join(root, 'src/components/CloudMigrationTestHarness.tsx'), 'utf8'),
    readFile(path.join(root, 'src/App.tsx'), 'utf8'),
    readFile(path.join(root, '.env.example'), 'utf8'),
    readdir(path.join(root, 'supabase/migrations')),
  ]);
  assert.match(accountData, /Account Data/);
  assert.match(accountData, /Save Existing Data to My Account/);
  assert.match(accountData, /Restore to This Browser/);
  assert.doesNotMatch(`${accountData}\n${accountMigration}`, /Migration Test Harness|Disposable|devFixture|devMigrationHarness|cloud-migration-test|CLOUDTEST/);
  assert.match(account, /import\.meta\.env\.DEV[\s\S]*?VITE_CLOUD_MIGRATION_TEST_MODE/);
  assert.match(harness, /Create Disposable Local Test Data/);
  assert.doesNotMatch(app, /AccountDataSection|CloudMigrationTestHarness|\/account/);
  assert.equal((app.match(/label: '(?:Scanner|Screener|Watchlist|Portfolio|Pulse)'/g) ?? []).length, 5);
  assert.equal(envExample, 'VITE_SUPABASE_URL=\nVITE_SUPABASE_PUBLISHABLE_KEY=\nVITE_CLOUD_MIGRATION_TEST_MODE=false\nVITE_CLOUD_SYNC_TEST_MODE=false\nVITE_CLOUD_SYNC_TEST_EMAIL=\n');
  assert.deepEqual(migrations, ['20260820154219_create_user_state.sql']);
});

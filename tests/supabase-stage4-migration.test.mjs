import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDormantCloudStateClient } from '../src/lib/cloudState/cloudStateClient.ts';
import {
  beginMigrationBackupSession,
  hasCurrentSessionBackupAcknowledgement,
  recordMigrationBackupExport,
} from '../src/lib/cloudState/backupGate.ts';
import { prepareRuntimeStateFromCloud } from '../src/lib/cloudState/hydration.ts';
import {
  countNonDefaultPreferences,
  readCanonicalLocalState,
  summarizeDurableData,
} from '../src/lib/cloudState/localState.ts';
import { planCloudMigration } from '../src/lib/cloudState/migrationPlanner.ts';
import { canonicalJsonEqual, canonicalJsonSerialize } from '../src/lib/cloudState/stateComparison.ts';
import {
  CLOUD_SYNC_METADATA_KEY,
  createCloudSyncMetadata,
  readCloudSyncMetadata,
  validateCloudSyncMetadata,
  writeCloudSyncMetadata,
} from '../src/lib/cloudState/syncMetadata.ts';
import { createPutScannerBackup, serializePutScannerBackup } from '../src/lib/userDataBackup.ts';
import { PORTFOLIO_STORAGE_KEY } from '../src/lib/portfolioStorage.ts';
import { WATCHLIST_STORAGE_KEY } from '../src/lib/watchlist.ts';
import { THEME_STORAGE_KEY } from '../src/lib/themePreference.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const userId = '11111111-1111-4111-8111-111111111111';
const createdAt = '2026-08-21T01:00:00.000Z';

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

const durableTrade = (overrides = {}) => ({
  id: 'trade-1',
  ticker: 'TQQQ',
  optionType: 'put',
  strike: 50,
  expiration: '2026-10-16',
  contracts: 2,
  soldPrice: 1.25,
  soldDate: '2026-08-13',
  status: 'open',
  notes: 'owner fact',
  createdAt: '2026-08-13T12:00:00.000Z',
  updatedAt: '2026-08-13T12:00:00.000Z',
  ...overrides,
});

const durableWatchlistItem = (overrides = {}) => ({
  id: 'TQQQ|put|2026-10-16|50',
  ticker: 'TQQQ',
  expiry: '2026-10-16',
  expiryTimestamp: 1792108800,
  expiryFormatted: "Oct 16 '26",
  strike: 50,
  optionType: 'put',
  addedAt: 1_765_627_200_000,
  savedAt: 1_765_627_200_000,
  note: 'wait for red day',
  ...overrides,
});

function initializationInput() {
  return {
    portfolio: { schemaVersion: 1, payload: { data: [durableTrade()] } },
    watchlist: { schemaVersion: 1, payload: { data: [durableWatchlistItem()] } },
    preferences: {
      schemaVersion: 1,
      payload: { data: { theme: 'sepia', showNominalYield: true } },
    },
  };
}

function row(namespace, data, overrides = {}) {
  return {
    user_id: userId,
    namespace,
    schema_version: 1,
    payload: { data },
    revision: 1,
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

function validRows(overrides = {}) {
  const input = initializationInput();
  return [
    row('portfolio', input.portfolio.payload.data, overrides.portfolio),
    row('watchlist', input.watchlist.payload.data, overrides.watchlist),
    row('preferences', input.preferences.payload.data, overrides.preferences),
  ];
}

function databaseMock(queuedResponses) {
  const queue = [...queuedResponses];
  const calls = [];

  class Query {
    constructor(table) {
      this.table = table;
      this.operation = null;
      this.values = null;
      this.columns = null;
      this.filters = [];
    }

    select(columns) {
      if (this.operation === null) this.operation = 'select';
      this.columns = columns;
      return this;
    }

    insert(values) {
      this.operation = 'insert';
      this.values = values;
      return this;
    }

    update(values) {
      this.operation = 'update';
      this.values = values;
      return this;
    }

    eq(column, value) {
      this.filters.push([column, value]);
      return this;
    }

    then(onFulfilled, onRejected) {
      calls.push({
        table: this.table,
        operation: this.operation,
        values: this.values,
        columns: this.columns,
        filters: this.filters,
      });
      const next = queue.shift();
      const promise = next instanceof Error
        ? Promise.reject(next)
        : Promise.resolve(next ?? { data: null, error: null, status: 200 });
      return promise.then(onFulfilled, onRejected);
    }
  }

  return {
    client: { from: table => new Query(table) },
    calls,
    remaining: () => queue.length,
  };
}

test('fetchAllUserState validates exactly the complete three-namespace contract', async () => {
  const mock = databaseMock([{ data: validRows(), error: null, status: 200 }]);
  const result = await createDormantCloudStateClient(mock.client, userId).fetchAllUserState();
  assert.equal(result.ok, true);
  assert.equal(result.value.status, 'complete');
  assert.deepEqual(Object.keys(result.value.state).sort(), ['portfolio', 'preferences', 'watchlist']);
  assert.deepEqual(mock.calls, [{
    table: 'user_state',
    operation: 'select',
    values: null,
    columns: 'user_id,namespace,schema_version,payload,revision,created_at,updated_at',
    filters: [['user_id', userId]],
  }]);
});

test('fetch detects missing, duplicate, and unexpected namespaces without accepting partial state', async () => {
  const missing = databaseMock([{ data: validRows().slice(0, 2), error: null }]);
  const missingResult = await createDormantCloudStateClient(missing.client, userId).fetchAllUserState();
  assert.equal(missingResult.ok, false);
  assert.equal(missingResult.error.code, 'cloud_state_incomplete');

  const duplicateRows = validRows();
  duplicateRows.push(row('portfolio', []));
  const duplicate = databaseMock([{ data: duplicateRows, error: null }]);
  const duplicateResult = await createDormantCloudStateClient(duplicate.client, userId).fetchAllUserState();
  assert.equal(duplicateResult.ok, false);
  assert.equal(duplicateResult.error.code, 'cloud_state_unexpected');

  const unexpectedRows = validRows();
  unexpectedRows[2] = { ...unexpectedRows[2], namespace: 'scanner' };
  const unexpected = databaseMock([{ data: unexpectedRows, error: null }]);
  const unexpectedResult = await createDormantCloudStateClient(unexpected.client, userId).fetchAllUserState();
  assert.equal(unexpectedResult.ok, false);
  assert.equal(unexpectedResult.error.code, 'cloud_state_unexpected');
});

test('fetchNamespace validates ownership, namespace, and optional absence', async () => {
  const mock = databaseMock([
    { data: [row('portfolio', [durableTrade()])], error: null },
    { data: [], error: null },
  ]);
  const client = createDormantCloudStateClient(mock.client, userId);
  const found = await client.fetchNamespace('portfolio');
  assert.equal(found.ok, true);
  assert.equal(found.value.namespace, 'portfolio');
  assert.equal((await client.fetchNamespace('watchlist')).value, null);
  assert.deepEqual(mock.calls[0].filters, [['user_id', userId], ['namespace', 'portfolio']]);
});

test('unsupported cloud schema is explicit and never downgraded', async () => {
  const rows = validRows({ portfolio: { schema_version: 2 } });
  const mock = databaseMock([{ data: rows, error: null }]);
  const result = await createDormantCloudStateClient(mock.client, userId).fetchAllUserState();
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'schema_unsupported');
  assert.equal(result.error.namespace, 'portfolio');
});

test('corrupt cloud payload and invalid requested namespaces fail before hydration or requests', async () => {
  const corruptRows = validRows({
    portfolio: { payload: { data: [{ ...durableTrade(), latestMarketData: { optionBid: 0.5 } }] } },
  });
  const mock = databaseMock([{ data: corruptRows, error: null }]);
  const client = createDormantCloudStateClient(mock.client, userId);
  const corrupt = await client.fetchAllUserState();
  assert.equal(corrupt.ok, false);
  assert.equal(corrupt.error.code, 'cloud_state_unexpected');

  const invalid = await client.fetchNamespace('scanner');
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'cloud_state_unexpected');
  assert.equal(mock.calls.length, 1);
});

test('initialization is one multi-row insert with no managed columns, then a separate verified read', async () => {
  const input = initializationInput();
  const mock = databaseMock([
    { data: validRows(), error: null, status: 201 },
    {
      data: validRows({
        preferences: { payload: { data: { showNominalYield: true, theme: 'sepia' } } },
      }),
      error: null,
      status: 200,
    },
  ]);
  const result = await createDormantCloudStateClient(mock.client, userId).initializeAllNamespaces(input);
  assert.equal(result.ok, true);
  assert.equal(mock.calls.length, 2);
  assert.equal(mock.calls[0].operation, 'insert');
  assert.equal(mock.calls[0].values.length, 3);
  assert.deepEqual(mock.calls[0].values.map(value => value.namespace), ['portfolio', 'watchlist', 'preferences']);
  for (const value of mock.calls[0].values) {
    assert.deepEqual(Object.keys(value).sort(), ['namespace', 'payload', 'schema_version', 'user_id']);
    assert.equal('revision' in value, false);
    assert.equal('created_at' in value, false);
    assert.equal('updated_at' in value, false);
  }
  assert.equal(mock.calls[1].operation, 'select');
  assert.equal(mock.remaining(), 0);
});

test('initialization primary-key conflict fails closed without read-back or overwrite', async () => {
  const mock = databaseMock([{
    data: null,
    error: { code: '23505', message: 'duplicate key value contains internal detail' },
    status: 409,
  }]);
  const result = await createDormantCloudStateClient(mock.client, userId)
    .initializeAllNamespaces(initializationInput());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'conflict');
  assert.equal(mock.calls.length, 1);
  assert.equal(mock.calls[0].operation, 'insert');
});

test('initialization requires exactly all three validated documents before making a request', async () => {
  const mock = databaseMock([]);
  const input = initializationInput();
  delete input.preferences;
  input.scanner = { schemaVersion: 1, payload: { data: [] } };
  const result = await createDormantCloudStateClient(mock.client, userId).initializeAllNamespaces(input);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'cloud_state_unexpected');
  assert.equal(mock.calls.length, 0);
});

test('initialization read-back verification detects semantic mismatch', async () => {
  const mismatched = validRows({ preferences: { payload: { data: { theme: 'dark' } } } });
  const mock = databaseMock([
    { data: validRows(), error: null },
    { data: mismatched, error: null },
  ]);
  const result = await createDormantCloudStateClient(mock.client, userId)
    .initializeAllNamespaces(initializationInput());
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'verification_failed');
});

test('CAS update filters by account, namespace, and revision and accepts only revision+1', async () => {
  const payload = { data: [durableTrade({ notes: 'edited' })] };
  const updatedRow = row('portfolio', payload.data, { revision: 6, updated_at: '2026-08-21T02:00:00.000Z' });
  const mock = databaseMock([{ data: [updatedRow], error: null }]);
  const result = await createDormantCloudStateClient(mock.client, userId)
    .updateNamespaceIfRevisionMatches('portfolio', 5, 1, payload);
  assert.equal(result.ok, true);
  assert.equal(result.value.revision, 6);
  assert.deepEqual(mock.calls[0].filters, [
    ['user_id', userId],
    ['namespace', 'portfolio'],
    ['revision', 5],
  ]);
  assert.deepEqual(Object.keys(mock.calls[0].values).sort(), ['payload', 'schema_version']);
});

test('zero-row CAS is a conflict and is never blindly retried', async () => {
  const mock = databaseMock([{ data: [], error: null }]);
  const result = await createDormantCloudStateClient(mock.client, userId)
    .updateNamespaceIfRevisionMatches('preferences', 3, 1, { data: { theme: 'light' } });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'conflict');
  assert.equal(mock.calls.length, 1);
});

test('permission, network, configuration, and authentication failures retain typed categories', async () => {
  const denied = databaseMock([{ data: null, error: { code: '42501', message: 'RLS detail' }, status: 403 }]);
  const deniedResult = await createDormantCloudStateClient(denied.client, userId).fetchAllUserState();
  assert.equal(deniedResult.ok, false);
  assert.equal(deniedResult.error.code, 'permission_error');
  assert.doesNotMatch(deniedResult.error.message, /RLS detail/);

  const offline = databaseMock([new Error('fetch failed with sensitive URL')]);
  const offlineResult = await createDormantCloudStateClient(offline.client, userId).fetchAllUserState();
  assert.equal(offlineResult.ok, false);
  assert.equal(offlineResult.error.code, 'network_error');
  assert.doesNotMatch(offlineResult.error.message, /sensitive URL/);

  assert.equal((await createDormantCloudStateClient(null, userId).fetchAllUserState()).error.code, 'not_configured');
  assert.equal((await createDormantCloudStateClient(offline.client, null).fetchAllUserState()).error.code, 'not_authenticated');
});

test('canonical comparison ignores object key order but preserves array order and value differences', () => {
  assert.equal(canonicalJsonEqual({ b: 2, a: { y: 2, x: 1 } }, { a: { x: 1, y: 2 }, b: 2 }), true);
  assert.equal(canonicalJsonEqual({ data: [1, 2] }, { data: [2, 1] }), false);
  assert.equal(canonicalJsonEqual({ theme: 'dark' }, { theme: 'light' }), false);
  assert.equal(canonicalJsonSerialize({ z: undefined, a: 1 }), '{"a":1}');
});

const localAssessment = (hasMeaningfulData) => ({
  status: 'valid',
  portfolio: { openTradeCount: hasMeaningfulData ? 1 : 0, historyCount: 0 },
  watchlist: { itemCount: 0 },
  preferences: { nonDefaultPreferenceCount: 0 },
  hasMeaningfulData,
});

test('pure migration planner covers empty/populated pairs without selecting an overwrite direction', () => {
  const common = { syncIdentity: 'none', backupAcknowledgedThisSession: false };
  assert.equal(planCloudMigration({ ...common, local: localAssessment(false), cloud: { status: 'empty' } }).state, 'cloud_empty_local_empty');

  const localOnly = planCloudMigration({ ...common, local: localAssessment(true), cloud: { status: 'empty' } });
  assert.equal(localOnly.state, 'cloud_empty_local_has_data');
  assert.equal(localOnly.action, 'download_fresh_backup');
  assert.equal(localOnly.canInitializeCloud, false);

  const ready = planCloudMigration({
    ...common,
    local: localAssessment(true),
    cloud: { status: 'empty' },
    backupAcknowledgedThisSession: true,
  });
  assert.equal(ready.state, 'migration_ready');
  assert.equal(ready.canInitializeCloud, true);

  const cloudOnly = planCloudMigration({
    ...common,
    local: localAssessment(false),
    cloud: { status: 'complete', hasMeaningfulData: true, comparison: 'not_compared' },
  });
  assert.equal(cloudOnly.state, 'cloud_has_data_local_empty');
  assert.equal(cloudOnly.action, 'review_cloud_restore');
  assert.equal(cloudOnly.canHydrateLocal, false);

  for (const comparison of ['not_compared', 'different']) {
    const both = planCloudMigration({
      ...common,
      local: localAssessment(true),
      cloud: { status: 'complete', hasMeaningfulData: comparison === 'different', comparison },
    });
    assert.equal(both.state, 'both_have_data');
    assert.equal(both.action, 'resolve_conflict');
    assert.equal(both.canInitializeCloud, false);
    assert.equal(both.canHydrateLocal, false);
  }
});

test('pure planner fails closed for partial, corrupt, unsupported, failed, and account-mismatched assessments', () => {
  const common = {
    local: localAssessment(true),
    syncIdentity: 'match',
    backupAcknowledgedThisSession: true,
  };
  const cases = [
    [{ status: 'partial' }, 'cloud_state_incomplete'],
    [{ status: 'corrupt' }, 'cloud_state_unexpected'],
    [{ status: 'unsupported_version' }, 'schema_unsupported'],
    [{ status: 'error' }, 'network_error'],
  ];
  for (const [cloud, errorCode] of cases) {
    const result = planCloudMigration({ ...common, cloud });
    assert.equal(result.state, 'error');
    assert.equal(result.action, 'stop');
    assert.equal(result.errorCode, errorCode);
  }
  assert.equal(planCloudMigration({ ...common, local: { status: 'corrupt' }, cloud: { status: 'empty' } }).state, 'error');
  assert.equal(planCloudMigration({
    ...common,
    syncIdentity: 'mismatch',
    cloud: { status: 'empty' },
  }).state, 'conflict');
});

test('planner exposes explicit not-checked, in-progress, and verified workflow states', () => {
  const common = {
    local: localAssessment(true),
    syncIdentity: 'match',
    backupAcknowledgedThisSession: true,
  };
  assert.equal(planCloudMigration({ ...common, cloud: { status: 'not_checked' } }).state, 'not_checked');
  assert.equal(planCloudMigration({ ...common, cloud: { status: 'empty' }, phase: 'in_progress' }).state, 'migration_in_progress');
  assert.equal(planCloudMigration({
    ...common,
    cloud: { status: 'complete', hasMeaningfulData: true, comparison: 'equal' },
    phase: 'verified',
  }).state, 'migration_verified');
});

test('backup gate is successful-export-only and scoped to one migration session', () => {
  const first = beginMigrationBackupSession('migration-session-a');
  assert.equal(hasCurrentSessionBackupAcknowledgement(first, 'migration-session-a'), false);
  const failed = recordMigrationBackupExport(first, 'migration-session-a', 'failed');
  assert.equal(hasCurrentSessionBackupAcknowledgement(failed, 'migration-session-a'), false);
  const succeeded = recordMigrationBackupExport(failed, 'migration-session-a', 'succeeded');
  assert.equal(hasCurrentSessionBackupAcknowledgement(succeeded, 'migration-session-a'), true);
  assert.equal(hasCurrentSessionBackupAcknowledgement(succeeded, 'migration-session-b'), false);
  const second = beginMigrationBackupSession('migration-session-b');
  assert.equal(hasCurrentSessionBackupAcknowledgement(second, 'migration-session-b'), false);
});

test('local inventory is deliberate, excludes transient market data, and treats defaults as empty', () => {
  assert.equal(countNonDefaultPreferences({ theme: 'dark', portfolioMarkBasis: 'ask', portfolioGroupMode: 'expiration', showNominalYield: false }), 0);
  assert.equal(countNonDefaultPreferences({ theme: 'sepia', showNominalYield: true }), 2);
  assert.deepEqual(summarizeDurableData([], [], {}), {
    status: 'valid',
    portfolio: { openTradeCount: 0, historyCount: 0 },
    watchlist: { itemCount: 0 },
    preferences: { nonDefaultPreferenceCount: 0 },
    hasMeaningfulData: false,
  });

  const storage = new MemoryStorage({
    [PORTFOLIO_STORAGE_KEY]: JSON.stringify([{ ...durableTrade(), latestMarketData: { optionBid: 0.8 } }]),
    [WATCHLIST_STORAGE_KEY]: JSON.stringify([{ ...durableWatchlistItem(), snapshot: { bid: 1.1 }, status: 'live' }]),
    [THEME_STORAGE_KEY]: 'sepia',
  });
  const result = readCanonicalLocalState(storage);
  assert.equal(result.status, 'ok');
  assert.equal(result.value.summary.portfolio.openTradeCount, 1);
  assert.equal(result.value.summary.watchlist.itemCount, 1);
  assert.equal(result.value.summary.preferences.nonDefaultPreferenceCount, 1);
  assert.equal('latestMarketData' in result.value.documents.portfolio.payload.data[0], false);
  assert.equal('snapshot' in result.value.documents.watchlist.payload.data[0], false);
  assert.equal(storage.writes.length, 0);
});

test('pure cloud hydration preserves matching device-local transient state and writes no storage', async () => {
  const mock = databaseMock([{ data: validRows(), error: null }]);
  const fetched = await createDormantCloudStateClient(mock.client, userId).fetchAllUserState();
  assert.equal(fetched.ok, true);
  const currentTrade = { ...durableTrade(), latestMarketData: { optionBid: 0.75, volume: 400 } };
  const currentWatch = { ...durableWatchlistItem(), snapshot: { bid: 1.2 }, status: 'live', updatedAt: 99 };
  const hydrated = prepareRuntimeStateFromCloud(fetched.value.state, {
    portfolio: [currentTrade],
    watchlist: [currentWatch],
  });
  assert.equal(hydrated.portfolio[0].latestMarketData.optionBid, 0.75);
  assert.equal(hydrated.watchlist[0].snapshot.bid, 1.2);
  assert.equal(hydrated.watchlist[0].status, 'live');
  assert.equal(hydrated.preferences.theme, 'sepia');
});

test('sync metadata is versioned, account-scoped, token-free, and cannot mutate durable state', () => {
  const durableSentinel = JSON.stringify([durableTrade()]);
  const metadataA = createCloudSyncMetadata('user-a');
  const storage = new MemoryStorage({
    [PORTFOLIO_STORAGE_KEY]: durableSentinel,
    [CLOUD_SYNC_METADATA_KEY]: JSON.stringify(metadataA),
  });
  const mismatch = readCloudSyncMetadata(storage, 'user-b');
  assert.equal(mismatch.status, 'account_mismatch');
  assert.equal(mismatch.storedUserId, 'user-a');
  assert.equal(mismatch.metadata.userId, 'user-b');
  assert.equal(storage.getItem(PORTFOLIO_STORAGE_KEY), durableSentinel);
  assert.equal(storage.writes.length, 0);
  assert.equal(storage.removes.length, 0);

  assert.equal(validateCloudSyncMetadata({ ...metadataA, accessToken: 'forbidden' }), null);
  assert.deepEqual(writeCloudSyncMetadata(storage, metadataA), { status: 'ok' });
  assert.equal(storage.writes.at(-1)[0], CLOUD_SYNC_METADATA_KEY);

  const corrupt = new MemoryStorage({
    [PORTFOLIO_STORAGE_KEY]: durableSentinel,
    [CLOUD_SYNC_METADATA_KEY]: '{bad',
  });
  assert.equal(readCloudSyncMetadata(corrupt, 'user-a').status, 'corrupt');
  assert.equal(corrupt.getItem(PORTFOLIO_STORAGE_KEY), durableSentinel);
  assert.equal(corrupt.writes.length, 0);
  assert.equal(corrupt.removes.length, 0);
});

test('cloud sync metadata remains excluded from the unchanged backup format', () => {
  const storage = new MemoryStorage({
    [PORTFOLIO_STORAGE_KEY]: JSON.stringify([durableTrade()]),
    [WATCHLIST_STORAGE_KEY]: JSON.stringify([durableWatchlistItem()]),
    [CLOUD_SYNC_METADATA_KEY]: JSON.stringify(createCloudSyncMetadata('user-a')),
  });
  const serialized = serializePutScannerBackup(createPutScannerBackup(storage, {
    now: new Date('2026-08-21T03:00:00.000Z'),
  }));
  assert.doesNotMatch(serialized, /put_scanner_cloud_sync_meta|user-a|cloudRevision/);
  assert.deepEqual(Object.keys(JSON.parse(serialized).data).sort(), ['portfolio', 'preferences', 'watchlist']);
});

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const children = await Promise.all(entries.map(async entry => {
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(fullPath) : [fullPath];
  }));
  return children.flat();
}

test('cloud-state access remains isolated to the explicit Account Data surfaces', async () => {
  const sourceFiles = (await filesUnder(path.join(root, 'src')))
    .filter(file => /\.(?:ts|tsx|js|jsx)$/.test(file));
  const cloudDirectory = `${path.sep}lib${path.sep}cloudState${path.sep}`;
  const accountEntryFiles = new Set([
    path.join(root, 'src/components/AccountControl.tsx'),
    path.join(root, 'src/components/AccountDataSection.tsx'),
    path.join(root, 'src/components/CloudMigrationTestHarness.tsx'),
  ]);
  const runtimeFiles = sourceFiles.filter(file => (
    !file.includes(cloudDirectory) && !accountEntryFiles.has(file)
  ));
  const runtimeSources = await Promise.all(runtimeFiles.map(file => readFile(file, 'utf8')));
  const runtime = runtimeSources.join('\n');
  const runtimeWithoutDormantMutationEvents = runtime.replace(
    /^import\s+\{\s*emitDurableMutation\s*\}\s+from\s+['"][^'"]*cloudState\/syncEvents(?:\.ts)?['"];?\s*$/gmi,
    '',
  );
  assert.doesNotMatch(runtimeWithoutDormantMutationEvents, /(?:from|import\s*\()\s*['"][^'"]*cloudState/i);
  assert.doesNotMatch(runtime, /user_state|fetchAllUserState|fetchNamespace|initializeAllNamespaces|updateNamespaceIfRevisionMatches/);

  const accountSource = await readFile(path.join(root, 'src/components/AccountControl.tsx'), 'utf8');
  const accountDataSource = await readFile(path.join(root, 'src/components/AccountDataSection.tsx'), 'utf8');
  assert.match(accountSource, /import\.meta\.env\.DEV[\s\S]*?lazy\(\(\) => import\('\.\/CloudMigrationTestHarness'\)\)/);
  assert.match(accountSource, /VITE_CLOUD_MIGRATION_TEST_MODE/);
  assert.match(accountSource, /<AccountDataSection userId=\{user\.id\}/);
  assert.match(accountDataSource, /onClick=\{openAccountData\}/);
  assert.doesNotMatch(accountDataSource, /useEffect|setInterval|onAuthStateChange|\.channel\s*\(/);

  const namedRuntimePaths = [
    'src/main.tsx',
    'src/App.tsx',
    'src/lib/auth.tsx',
    'src/lib/authActions.ts',
    'src/pages/PortfolioPage.tsx',
    'src/pages/WatchlistPage.tsx',
    'src/lib/theme.tsx',
    'src/lib/portfolioStorage.ts',
    'src/lib/watchlist.ts',
  ];
  const namedRuntime = (await Promise.all(namedRuntimePaths.map(file => readFile(path.join(root, file), 'utf8')))).join('\n');
  const namedRuntimeWithoutDormantMutationEvents = namedRuntime.replace(
    /^import\s+\{\s*emitDurableMutation\s*\}\s+from\s+['"][^'"]*cloudState\/syncEvents(?:\.ts)?['"];?\s*$/gmi,
    '',
  );
  assert.doesNotMatch(namedRuntimeWithoutDormantMutationEvents, /cloudState|user_state/);

  const cloudSources = await Promise.all(
    sourceFiles.filter(file => file.includes(cloudDirectory)).map(file => readFile(file, 'utf8')),
  );
  const cloud = cloudSources.join('\n');
  const cloudClientSource = await readFile(path.join(root, 'src/lib/cloudState/cloudStateClient.ts'), 'utf8');
  assert.doesNotMatch(cloud, /supabaseAuthClient|onAuthStateChange|localStorage/);
  assert.doesNotMatch(cloud, /\.upsert\s*\(|\.channel\s*\(|setInterval\s*\(/);
  assert.doesNotMatch(cloudClientSource, /\.delete\s*\(/);
  assert.match(cloud, /insert\(insertRows\)/);
  assert.match(cloud, /\.eq\('revision', expectedRevision\)/);
});

test('Stage 4 foundation still requires no migration, dashboard, or auth configuration change', async () => {
  const [migrationNames, status] = await Promise.all([
    readdir(path.join(root, 'supabase', 'migrations')),
    readFile(path.join(root, '.env.example'), 'utf8'),
  ]);
  assert.deepEqual(migrationNames, ['20260820154219_create_user_state.sql']);
  assert.equal(status, 'VITE_SUPABASE_URL=\nVITE_SUPABASE_PUBLISHABLE_KEY=\nVITE_CLOUD_MIGRATION_TEST_MODE=false\n');
});

import { createPreferencesEnvelope, type DurablePreferences } from '../durablePreferences.ts';
import type { StorageLike } from '../durableStorage.ts';
import type { PortfolioTrade } from '../portfolioStorage.ts';
import { readPortfolioTrades, writePortfolioTrades, type DurablePortfolioTrade } from '../portfolioStorage.ts';
import { readShowNominalYield, persistShowNominalYield } from '../optionTablePreferences.ts';
import { readWatchlist, writeWatchlist, type DurableWatchlistItem } from '../watchlist.ts';
import {
  applyPutScannerBackup,
  PUT_SCANNER_BACKUP_FORMAT,
  PUT_SCANNER_BACKUP_SCHEMA_VERSION,
  validatePutScannerBackup,
  type PutScannerBackup,
} from '../userDataBackup.ts';
import {
  captureDurableLocalRecoverySnapshot,
  restoreDurableLocalRecoverySnapshot,
} from './localRestore.ts';
import { readCanonicalLocalState, type CanonicalLocalState } from './localState.ts';
import { canonicalJsonEqual } from './stateComparison.ts';
import type { CloudInitializationInput, CloudStateSet, CloudStateSnapshot } from './types.ts';

export const CLOUD_SYNC_TEST_NOTE = 'CLOUD SYNC TEST ONLY';
export const CLOUD_SYNC_TEST_ID_PREFIX = 'cloud-sync-test-';
export const CLOUD_SYNC_TEST_BLOCK_MESSAGE = 'This account contains non-test Put Scanner data. Live synchronization testing is blocked.';

const OPEN_ID = 'cloud-sync-test-open-v1';
const HISTORY_ID = 'cloud-sync-test-history-v1';
const WATCH_TICKER = 'CLOUD-SYNC-TEST-WATCH-V1';
const WATCH_ID = `${WATCH_TICKER}|put|2027-01-15|25`;

export type DisposableSyncFixtureResult =
  | { ok: true; backup: PutScannerBackup; local: CanonicalLocalState }
  | { ok: false; code: 'local_invalid' | 'local_not_empty' | 'write_failed' | 'verification_failed'; message: string };

export type DisposableLocalAssessment =
  | { status: 'empty'; local: CanonicalLocalState }
  | { status: 'fixture'; local: CanonicalLocalState }
  | { status: 'non_test'; local: CanonicalLocalState }
  | { status: 'invalid'; message: string };

export type DisposableCloudAssessment =
  | { status: 'empty' }
  | { status: 'fixture'; cloud: CloudStateSet }
  | { status: 'non_test'; message: typeof CLOUD_SYNC_TEST_BLOCK_MESSAGE };

function startsWithTestMarker(value: string): boolean {
  return value.toLowerCase().startsWith(CLOUD_SYNC_TEST_ID_PREFIX);
}

function isTestNote(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(CLOUD_SYNC_TEST_NOTE);
}

function isFixturePortfolio(data: readonly DurablePortfolioTrade[]): boolean {
  if (data.length !== 2) return false;
  const open = data.find(trade => trade.id === OPEN_ID);
  const history = data.find(trade => trade.id === HISTORY_ID);
  return Boolean(open
    && history
    && startsWithTestMarker(open.id)
    && startsWithTestMarker(history.id)
    && open.ticker === 'CLOUD-SYNC-TEST'
    && history.ticker === 'CLOUD-SYNC-TEST'
    && open.status === 'open'
    && history.status === 'closed'
    && open.strike === 25
    && history.strike === 20
    && open.contracts === 1
    && history.contracts === 1
    && isTestNote(open.notes)
    && isTestNote(history.notes));
}

function isFixtureWatchlist(data: readonly DurableWatchlistItem[]): boolean {
  const item = data[0];
  return data.length === 1
    && item.id === WATCH_ID
    && startsWithTestMarker(item.id)
    && item.ticker === WATCH_TICKER
    && item.strike === 25
    && item.expiry === '2027-01-15'
    && isTestNote(item.note);
}

function isFixturePreferences(data: DurablePreferences): boolean {
  const keys = Object.keys(data).sort();
  return canonicalJsonEqual(keys, [
    'collapsedExpirationGroups',
    'collapsedUnderlyingGroups',
    'portfolioGroupMode',
    'portfolioMarkBasis',
    'showNominalYield',
    'theme',
  ])
    && data.theme === 'sepia'
    && data.portfolioMarkBasis === 'bid'
    && data.portfolioGroupMode === 'none'
    && canonicalJsonEqual(data.collapsedExpirationGroups, { 'cloud-sync-test-expiry': true })
    && canonicalJsonEqual(data.collapsedUnderlyingGroups, { 'CLOUD-SYNC-TEST': true })
    && typeof data.showNominalYield === 'boolean';
}

export function isDisposableSyncTestDocuments(documents: CloudInitializationInput): boolean {
  return isFixturePortfolio(documents.portfolio.payload.data)
    && isFixtureWatchlist(documents.watchlist.payload.data)
    && isFixturePreferences(documents.preferences.payload.data);
}

export function isDisposableSyncTestCloud(cloud: CloudStateSet): boolean {
  return isDisposableSyncTestDocuments({
    portfolio: { schemaVersion: cloud.portfolio.schemaVersion, payload: cloud.portfolio.payload },
    watchlist: { schemaVersion: cloud.watchlist.schemaVersion, payload: cloud.watchlist.payload },
    preferences: { schemaVersion: cloud.preferences.schemaVersion, payload: cloud.preferences.payload },
  });
}

export function assessDisposableSyncTestCloud(snapshot: CloudStateSnapshot): DisposableCloudAssessment {
  if (snapshot.status === 'empty') return { status: 'empty' };
  return isDisposableSyncTestCloud(snapshot.state)
    ? { status: 'fixture', cloud: snapshot.state }
    : { status: 'non_test', message: CLOUD_SYNC_TEST_BLOCK_MESSAGE };
}

export function assessDisposableSyncTestLocal(storage: StorageLike): DisposableLocalAssessment {
  const local = readCanonicalLocalState(storage);
  if (local.status !== 'ok') {
    return { status: 'invalid', message: 'Local durable state is corrupt or unsupported. Live synchronization testing is blocked.' };
  }
  if (!local.value.summary.hasMeaningfulData) return { status: 'empty', local: local.value };
  return isDisposableSyncTestDocuments(local.value.documents)
    ? { status: 'fixture', local: local.value }
    : { status: 'non_test', local: local.value };
}

export function createDisposableSyncFixture(now = new Date()): PutScannerBackup {
  const timestamp = now.toISOString();
  const portfolio: DurablePortfolioTrade[] = [
    {
      id: OPEN_ID,
      ticker: 'CLOUD-SYNC-TEST',
      optionType: 'put',
      strike: 25,
      expiration: '2027-01-15',
      contracts: 1,
      soldPrice: 1,
      soldDate: '2026-08-20',
      status: 'open',
      notes: `${CLOUD_SYNC_TEST_NOTE} | Portfolio v1 | Bootstrap`,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: HISTORY_ID,
      ticker: 'CLOUD-SYNC-TEST',
      optionType: 'put',
      strike: 20,
      expiration: '2026-06-19',
      contracts: 1,
      soldPrice: 1,
      soldDate: '2026-05-01',
      status: 'closed',
      notes: `${CLOUD_SYNC_TEST_NOTE} | History fixture`,
      closePrice: 0.5,
      closeDate: '2026-05-15',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
  const watchlist: DurableWatchlistItem[] = [{
    id: WATCH_ID,
    ticker: WATCH_TICKER,
    expiry: '2027-01-15',
    expiryTimestamp: 1799971200,
    expiryFormatted: "Jan 15 '27",
    strike: 25,
    optionType: 'put',
    addedAt: now.getTime(),
    savedAt: now.getTime(),
    note: `${CLOUD_SYNC_TEST_NOTE} | Watchlist v1 | Bootstrap`,
  }];
  const preferences: DurablePreferences = {
    theme: 'sepia',
    portfolioMarkBasis: 'bid',
    portfolioGroupMode: 'none',
    collapsedExpirationGroups: { 'cloud-sync-test-expiry': true },
    collapsedUnderlyingGroups: { 'CLOUD-SYNC-TEST': true },
    showNominalYield: true,
  };

  return validatePutScannerBackup({
    format: PUT_SCANNER_BACKUP_FORMAT,
    schemaVersion: PUT_SCANNER_BACKUP_SCHEMA_VERSION,
    exportedAt: timestamp,
    appVersion: 'cloud-sync-test-v1',
    data: {
      portfolio: { schemaVersion: 1, updatedAt: timestamp, revision: 1, data: portfolio },
      watchlist: { schemaVersion: 1, updatedAt: timestamp, revision: 1, data: watchlist },
      preferences: createPreferencesEnvelope(preferences, { updatedAt: timestamp, revision: 1 }),
    },
  });
}

export function createDisposableLocalSyncTestData(
  storage: StorageLike,
  now = new Date(),
): DisposableSyncFixtureResult {
  const current = assessDisposableSyncTestLocal(storage);
  if (current.status === 'invalid') return { ok: false, code: 'local_invalid', message: current.message };
  if (current.status !== 'empty') {
    return {
      ok: false,
      code: 'local_not_empty',
      message: 'This browser already contains Put Scanner data. Disposable synchronization testing is blocked.',
    };
  }

  const fixture = createDisposableSyncFixture(now);
  const recovery = captureDurableLocalRecoverySnapshot(storage);
  try {
    applyPutScannerBackup(storage, fixture);
  } catch {
    return { ok: false, code: 'write_failed', message: 'Disposable synchronization test data could not be created safely.' };
  }
  const local = assessDisposableSyncTestLocal(storage);
  if (local.status !== 'fixture') {
    restoreDurableLocalRecoverySnapshot(storage, recovery);
    return { ok: false, code: 'verification_failed', message: 'Disposable synchronization test data failed verification and was rolled back.' };
  }
  return { ok: true, backup: fixture, local: local.local };
}

function nextVersion(note: string, label: string): number {
  const match = note.match(new RegExp(`${label} v(\\d+)`));
  return match ? Number(match[1]) + 1 : 2;
}

function safeDeviceLabel(value: string): 'A' | 'B' {
  return value === 'B' ? 'B' : 'A';
}

export function mutateDisposableTestPortfolio(
  storage: StorageLike,
  deviceLabel: string,
  count = 1,
  now = new Date(),
): { ok: true; version: number } | { ok: false; message: string } {
  if (assessDisposableSyncTestLocal(storage).status !== 'fixture') {
    return { ok: false, message: 'Portfolio mutation is blocked because the local Stage 5 test fixture marker is missing.' };
  }
  let version = 1;
  for (let index = 0; index < count; index += 1) {
    const read = readPortfolioTrades(storage);
    if (read.status !== 'ok' || !isFixturePortfolio(read.data)) return { ok: false, message: 'Portfolio test fixture validation failed.' };
    const open = read.data.find(trade => trade.id === OPEN_ID) as PortfolioTrade;
    version = nextVersion(open.notes ?? '', 'Portfolio');
    const changed = read.data.map(trade => trade.id === OPEN_ID ? {
      ...trade,
      notes: `${CLOUD_SYNC_TEST_NOTE} | Portfolio v${version} | Device ${safeDeviceLabel(deviceLabel)}`,
      updatedAt: new Date(now.getTime() + index).toISOString(),
    } : trade);
    const written = writePortfolioTrades(storage, changed, { now: new Date(now.getTime() + index) });
    if (written.status !== 'ok' || !written.written) return { ok: false, message: 'Portfolio test mutation could not be written.' };
  }
  return { ok: true, version };
}

export function mutateDisposableTestWatchlist(
  storage: StorageLike,
  deviceLabel: string,
  now = new Date(),
): { ok: true; version: number } | { ok: false; message: string } {
  if (assessDisposableSyncTestLocal(storage).status !== 'fixture') {
    return { ok: false, message: 'Watchlist mutation is blocked because the local Stage 5 test fixture marker is missing.' };
  }
  const read = readWatchlist(storage);
  if (read.status !== 'ok' || !isFixtureWatchlist(read.data)) return { ok: false, message: 'Watchlist test fixture validation failed.' };
  const version = nextVersion(read.data[0].note, 'Watchlist');
  const written = writeWatchlist(storage, [{
    ...read.data[0],
    note: `${CLOUD_SYNC_TEST_NOTE} | Watchlist v${version} | Device ${safeDeviceLabel(deviceLabel)}`,
  }], { now });
  return written.status === 'ok' && written.written
    ? { ok: true, version }
    : { ok: false, message: 'Watchlist test mutation could not be written.' };
}

export function mutateDisposableTestPreference(
  storage: StorageLike,
): { ok: true; enabled: boolean } | { ok: false; message: string } {
  if (assessDisposableSyncTestLocal(storage).status !== 'fixture') {
    return { ok: false, message: 'Preference mutation is blocked because the local Stage 5 test fixture marker is missing.' };
  }
  const enabled = !readShowNominalYield(storage);
  persistShowNominalYield(enabled, storage);
  return assessDisposableSyncTestLocal(storage).status === 'fixture'
    ? { ok: true, enabled }
    : { ok: false, message: 'Preference test mutation failed fixture verification.' };
}

export function disposableTestVersions(documents: CloudInitializationInput): {
  portfolio: number | null;
  watchlist: number | null;
  preference: boolean | null;
} {
  if (!isDisposableSyncTestDocuments(documents)) return { portfolio: null, watchlist: null, preference: null };
  const open = documents.portfolio.payload.data.find(trade => trade.id === OPEN_ID);
  const portfolio = open?.notes?.match(/Portfolio v(\d+)/);
  const watchlist = documents.watchlist.payload.data[0].note.match(/Watchlist v(\d+)/);
  return {
    portfolio: portfolio ? Number(portfolio[1]) : null,
    watchlist: watchlist ? Number(watchlist[1]) : null,
    preference: documents.preferences.payload.data.showNominalYield ?? null,
  };
}

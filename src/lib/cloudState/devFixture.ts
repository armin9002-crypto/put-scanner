import {
  createPreferencesEnvelope,
  type DurablePreferences,
} from '../durablePreferences.ts';
import type { StorageLike } from '../durableStorage.ts';
import type { DurablePortfolioTrade } from '../portfolioStorage.ts';
import type { DurableWatchlistItem } from '../watchlist.ts';
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
import { readCanonicalLocalState } from './localState.ts';
import { canonicalJsonEqual } from './stateComparison.ts';

export const CLOUD_MIGRATION_TEST_NOTE = 'CLOUD MIGRATION TEST ONLY';

export type DisposableFixtureResult =
  | { ok: true; backup: PutScannerBackup; local: Extract<ReturnType<typeof readCanonicalLocalState>, { status: 'ok' }>['value'] }
  | { ok: false; code: 'local_invalid' | 'local_not_empty' | 'write_failed' | 'verification_failed'; message: string };

export function createDisposableMigrationFixture(now = new Date()): PutScannerBackup {
  const timestamp = now.toISOString();
  const portfolio: DurablePortfolioTrade[] = [
    {
      id: 'cloud-migration-test-open-v1',
      ticker: 'CLOUDTEST',
      optionType: 'put',
      strike: 25,
      expiration: '2027-01-15',
      contracts: 1,
      soldPrice: 1,
      soldDate: '2026-08-20',
      status: 'open',
      notes: CLOUD_MIGRATION_TEST_NOTE,
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: 'cloud-migration-test-history-v1',
      ticker: 'CLOUDTEST',
      optionType: 'put',
      strike: 20,
      expiration: '2026-06-19',
      contracts: 1,
      soldPrice: 1,
      soldDate: '2026-05-01',
      status: 'closed',
      notes: CLOUD_MIGRATION_TEST_NOTE,
      closePrice: 0.5,
      closeDate: '2026-05-15',
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
  const watchlist: DurableWatchlistItem[] = [{
    id: 'CLOUDTEST|put|2027-01-15|25',
    ticker: 'CLOUDTEST',
    expiry: '2027-01-15',
    expiryTimestamp: 1799971200,
    expiryFormatted: "Jan 15 '27",
    strike: 25,
    optionType: 'put',
    addedAt: now.getTime(),
    savedAt: now.getTime(),
    note: CLOUD_MIGRATION_TEST_NOTE,
  }];
  const preferences: DurablePreferences = {
    theme: 'sepia',
    portfolioMarkBasis: 'bid',
    portfolioGroupMode: 'expiration',
    collapsedExpirationGroups: {},
    collapsedUnderlyingGroups: {},
    showNominalYield: true,
  };

  return validatePutScannerBackup({
    format: PUT_SCANNER_BACKUP_FORMAT,
    schemaVersion: PUT_SCANNER_BACKUP_SCHEMA_VERSION,
    exportedAt: timestamp,
    appVersion: 'cloud-migration-test-v1',
    data: {
      portfolio: { schemaVersion: 1, updatedAt: timestamp, revision: 1, data: portfolio },
      watchlist: { schemaVersion: 1, updatedAt: timestamp, revision: 1, data: watchlist },
      preferences: createPreferencesEnvelope(preferences, { updatedAt: timestamp, revision: 1 }),
    },
  });
}

export function createDisposableLocalTestData(
  storage: StorageLike,
  now = new Date(),
): DisposableFixtureResult {
  const current = readCanonicalLocalState(storage);
  if (current.status !== 'ok') {
    return { ok: false, code: 'local_invalid', message: 'Local durable state is corrupt or unsupported. Disposable testing is blocked.' };
  }
  if (current.value.summary.hasMeaningfulData) {
    return {
      ok: false,
      code: 'local_not_empty',
      message: 'This browser already contains Put Scanner data. Disposable migration testing is blocked.',
    };
  }

  const fixture = createDisposableMigrationFixture(now);
  const recovery = captureDurableLocalRecoverySnapshot(storage);
  try {
    applyPutScannerBackup(storage, fixture);
  } catch {
    return { ok: false, code: 'write_failed', message: 'Disposable test data could not be created safely.' };
  }
  const local = readCanonicalLocalState(storage);
  if (local.status !== 'ok' || !canonicalJsonEqual(local.value.documents, {
    portfolio: { schemaVersion: 1, payload: { data: fixture.data.portfolio.data } },
    watchlist: { schemaVersion: 1, payload: { data: fixture.data.watchlist.data } },
    preferences: { schemaVersion: 1, payload: { data: fixture.data.preferences.data } },
  })) {
    restoreDurableLocalRecoverySnapshot(storage, recovery);
    return { ok: false, code: 'verification_failed', message: 'Disposable test data failed verification and was rolled back.' };
  }
  return { ok: true, backup: fixture, local: local.value };
}

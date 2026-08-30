import { PORTFOLIO_MARK_BASIS_KEY } from '../portfolioMarkPreference.ts';
import { PORTFOLIO_GROUP_MODE_KEY } from '../portfolioSchedulePreferences.ts';
import { PORTFOLIO_STORAGE_KEY } from '../portfolioStorage.ts';
import { SHOW_NOMINAL_YIELD_KEY } from '../optionTablePreferences.ts';
import { LEGACY_WATCHLIST_STORAGE_KEY, WATCHLIST_STORAGE_KEY } from '../watchlist.ts';

// Historical Stage 4/5 metadata keys are repeated here intentionally so the
// retired reconciliation modules do not remain runtime dependencies.
const CLOUD_SYNC_METADATA_KEY = 'put_scanner_cloud_sync_meta:v1';
const SYNC_ENGINE_METADATA_KEY = 'put_scanner_cloud_sync_engine:v1';
const LOCAL_SYNC_DEVICE_ID_KEY = 'put_scanner_cloud_device_id:v1';

/**
 * Exact allowlist of obsolete durable-account keys. Purely device-local theme,
 * collapse preferences, navigation state, and every market cache are excluded.
 */
export const LEGACY_DURABLE_ACCOUNT_KEYS = [
  PORTFOLIO_STORAGE_KEY,
  WATCHLIST_STORAGE_KEY,
  LEGACY_WATCHLIST_STORAGE_KEY,
  PORTFOLIO_MARK_BASIS_KEY,
  PORTFOLIO_GROUP_MODE_KEY,
  SHOW_NOMINAL_YIELD_KEY,
  CLOUD_SYNC_METADATA_KEY,
  SYNC_ENGINE_METADATA_KEY,
  LOCAL_SYNC_DEVICE_ID_KEY,
] as const;

export interface LegacyCleanupResult {
  removed: string[];
  failed: string[];
}

export function retireLegacyDurableAccountKeys(
  storage: Pick<Storage, 'removeItem'>,
): LegacyCleanupResult {
  const removed: string[] = [];
  const failed: string[] = [];
  for (const key of LEGACY_DURABLE_ACCOUNT_KEYS) {
    try {
      storage.removeItem(key);
      removed.push(key);
    } catch {
      failed.push(key);
    }
  }
  return { removed, failed };
}

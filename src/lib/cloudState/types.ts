import type { DurablePreferences } from '../durablePreferences.ts';
import type { DurablePortfolioTrade } from '../portfolioStorage.ts';
import type { DurableWatchlistItem } from '../watchlist.ts';

export const CLOUD_STATE_NAMESPACES = ['portfolio', 'watchlist', 'preferences'] as const;
export type CloudNamespace = typeof CLOUD_STATE_NAMESPACES[number];

export interface CloudNamespaceDataMap {
  portfolio: DurablePortfolioTrade[];
  watchlist: DurableWatchlistItem[];
  preferences: DurablePreferences;
}

export interface CloudPayload<Namespace extends CloudNamespace = CloudNamespace> {
  data: CloudNamespaceDataMap[Namespace];
}

export interface CloudNamespaceDocument<Namespace extends CloudNamespace = CloudNamespace> {
  schemaVersion: 1;
  payload: CloudPayload<Namespace>;
}

export interface CloudInitializationInput {
  portfolio: CloudNamespaceDocument<'portfolio'>;
  watchlist: CloudNamespaceDocument<'watchlist'>;
  preferences: CloudNamespaceDocument<'preferences'>;
}

export interface CloudStateRow<Namespace extends CloudNamespace = CloudNamespace>
  extends CloudNamespaceDocument<Namespace> {
  userId: string;
  namespace: Namespace;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface CloudStateSet {
  portfolio: CloudStateRow<'portfolio'>;
  watchlist: CloudStateRow<'watchlist'>;
  preferences: CloudStateRow<'preferences'>;
}

export type CloudStateSnapshot =
  | { status: 'empty' }
  | { status: 'complete'; state: CloudStateSet };

export type CloudStateErrorCode =
  | 'not_authenticated'
  | 'not_configured'
  | 'network_error'
  | 'permission_error'
  | 'conflict'
  | 'cloud_state_incomplete'
  | 'cloud_state_unexpected'
  | 'schema_unsupported'
  | 'verification_failed';

export type CloudStateOperation =
  | 'fetch_all'
  | 'fetch_namespace'
  | 'initialize_all'
  | 'update_namespace';

export interface CloudStateError {
  code: CloudStateErrorCode;
  operation: CloudStateOperation;
  message: string;
  namespace?: CloudNamespace;
}

export type CloudStateResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; error: CloudStateError };

export interface LocalDataPresenceSummary {
  status: 'valid';
  portfolio: {
    openTradeCount: number;
    historyCount: number;
  };
  watchlist: {
    itemCount: number;
  };
  preferences: {
    nonDefaultPreferenceCount: number;
  };
  hasMeaningfulData: boolean;
}

export type LocalStateAssessment =
  | LocalDataPresenceSummary
  | { status: 'corrupt' }
  | { status: 'unsupported_version' };

export type CloudStateAssessment =
  | { status: 'not_checked' }
  | { status: 'empty' }
  | { status: 'complete'; hasMeaningfulData: boolean; comparison: 'not_compared' | 'equal' | 'different' }
  | { status: 'partial' }
  | { status: 'corrupt' }
  | { status: 'unsupported_version' }
  | { status: 'error' };

export type MigrationState =
  | 'not_checked'
  | 'cloud_empty_local_empty'
  | 'cloud_empty_local_has_data'
  | 'cloud_has_data_local_empty'
  | 'both_have_data'
  | 'migration_ready'
  | 'migration_in_progress'
  | 'migration_verified'
  | 'conflict'
  | 'error';

export type MigrationAction =
  | 'check_cloud'
  | 'wait_for_explicit_initialization'
  | 'download_fresh_backup'
  | 'initialize_all_namespaces'
  | 'review_cloud_restore'
  | 'review_equal_state'
  | 'resolve_conflict'
  | 'wait_for_verification'
  | 'none'
  | 'stop';

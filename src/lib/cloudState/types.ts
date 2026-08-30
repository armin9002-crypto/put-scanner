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

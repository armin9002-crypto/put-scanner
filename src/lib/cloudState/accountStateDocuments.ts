import {
  PREFERENCES_DURABLE_SCHEMA_VERSION,
  readDurablePreferences,
} from '../durablePreferences.ts';
import type { StorageLike } from '../durableStorage.ts';
import {
  PORTFOLIO_DURABLE_SCHEMA_VERSION,
  readPortfolioTrades,
  toDurablePortfolioState,
} from '../portfolioStorage.ts';
import {
  WATCHLIST_DURABLE_SCHEMA_VERSION,
  readWatchlist,
  toDurableWatchlistState,
} from '../watchlist.ts';
import type { CloudNamespace, CloudNamespaceDocument } from './types.ts';

export type AccountMemoryNamespaceReadResult<Namespace extends CloudNamespace> =
  | { status: 'ok'; document: CloudNamespaceDocument<Namespace> }
  | { status: 'corrupt'; namespace: Namespace; message: string }
  | { status: 'unsupported_version'; namespace: Namespace; version: number };

/** Converts the ephemeral runtime adapter into one validated cloud document. */
export function readAccountMemoryNamespace<Namespace extends CloudNamespace>(
  storage: StorageLike,
  namespace: Namespace,
): AccountMemoryNamespaceReadResult<Namespace> {
  if (namespace === 'portfolio') {
    const result = readPortfolioTrades(storage);
    if (result.status === 'corrupt') return { status: 'corrupt', namespace, message: result.error };
    if (result.status === 'unsupported_version') return { status: 'unsupported_version', namespace, version: result.version };
    return {
      status: 'ok',
      document: {
        schemaVersion: PORTFOLIO_DURABLE_SCHEMA_VERSION,
        payload: { data: result.status === 'ok' ? toDurablePortfolioState(result.data) : [] },
      } as CloudNamespaceDocument<Namespace>,
    };
  }

  if (namespace === 'watchlist') {
    const result = readWatchlist(storage);
    if (result.status === 'corrupt') return { status: 'corrupt', namespace, message: result.error };
    if (result.status === 'unsupported_version') return { status: 'unsupported_version', namespace, version: result.version };
    return {
      status: 'ok',
      document: {
        schemaVersion: WATCHLIST_DURABLE_SCHEMA_VERSION,
        payload: { data: result.status === 'ok' ? toDurableWatchlistState(result.data) : [] },
      } as CloudNamespaceDocument<Namespace>,
    };
  }

  const result = readDurablePreferences(storage);
  if (result.status === 'corrupt') return { status: 'corrupt', namespace, message: result.error };
  if (result.status === 'unsupported_version') return { status: 'unsupported_version', namespace, version: result.version };
  return {
    status: 'ok',
    document: {
      schemaVersion: PREFERENCES_DURABLE_SCHEMA_VERSION,
      payload: { data: result.status === 'ok' ? result.data : {} },
    } as CloudNamespaceDocument<Namespace>,
  };
}

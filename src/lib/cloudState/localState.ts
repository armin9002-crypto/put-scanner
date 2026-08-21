import {
  PREFERENCES_DURABLE_SCHEMA_VERSION,
  readDurablePreferences,
  type DurablePreferences,
} from '../durablePreferences.ts';
import type { StorageLike } from '../durableStorage.ts';
import {
  PORTFOLIO_DURABLE_SCHEMA_VERSION,
  readPortfolioTrades,
  toDurablePortfolioState,
  type DurablePortfolioTrade,
} from '../portfolioStorage.ts';
import {
  WATCHLIST_DURABLE_SCHEMA_VERSION,
  readWatchlist,
  toDurableWatchlistState,
  type DurableWatchlistItem,
} from '../watchlist.ts';
import type {
  CloudInitializationInput,
  CloudStateSet,
  LocalDataPresenceSummary,
} from './types.ts';

export interface CanonicalLocalState {
  documents: CloudInitializationInput;
  localUpdatedAt: Record<'portfolio' | 'watchlist' | 'preferences', string | null>;
  localRevision: Record<'portfolio' | 'watchlist' | 'preferences', number>;
  summary: LocalDataPresenceSummary;
}

export type CanonicalLocalStateReadResult =
  | { status: 'ok'; value: CanonicalLocalState }
  | { status: 'corrupt'; namespace: 'portfolio' | 'watchlist' | 'preferences'; message: string }
  | { status: 'unsupported_version'; namespace: 'portfolio' | 'watchlist' | 'preferences'; version: number };

export function countNonDefaultPreferences(preferences: DurablePreferences): number {
  let count = 0;
  if (preferences.theme !== undefined && preferences.theme !== 'dark') count += 1;
  if (preferences.portfolioMarkBasis !== undefined && preferences.portfolioMarkBasis !== 'ask') count += 1;
  if (preferences.portfolioGroupMode !== undefined && preferences.portfolioGroupMode !== 'expiration') count += 1;
  if (preferences.collapsedExpirationGroups
    && Object.values(preferences.collapsedExpirationGroups).some(value => value)) count += 1;
  if (preferences.collapsedUnderlyingGroups
    && Object.values(preferences.collapsedUnderlyingGroups).some(value => value)) count += 1;
  if (preferences.showNominalYield === true) count += 1;
  return count;
}

export function summarizeDurableData(
  portfolio: DurablePortfolioTrade[],
  watchlist: DurableWatchlistItem[],
  preferences: DurablePreferences,
): LocalDataPresenceSummary {
  const openTradeCount = portfolio.filter(trade => trade.status === 'open').length;
  const historyCount = portfolio.length - openTradeCount;
  const nonDefaultPreferenceCount = countNonDefaultPreferences(preferences);
  return {
    status: 'valid',
    portfolio: { openTradeCount, historyCount },
    watchlist: { itemCount: watchlist.length },
    preferences: { nonDefaultPreferenceCount },
    hasMeaningfulData: openTradeCount + historyCount + watchlist.length + nonDefaultPreferenceCount > 0,
  };
}

export function summarizeCloudState(state: CloudStateSet): LocalDataPresenceSummary {
  return summarizeDurableData(
    state.portfolio.payload.data,
    state.watchlist.payload.data,
    state.preferences.payload.data,
  );
}

export function readCanonicalLocalState(
  storage: StorageLike,
): CanonicalLocalStateReadResult {
  const portfolio = readPortfolioTrades(storage);
  if (portfolio.status === 'corrupt') {
    return { status: 'corrupt', namespace: 'portfolio', message: portfolio.error };
  }
  if (portfolio.status === 'unsupported_version') {
    return { status: 'unsupported_version', namespace: 'portfolio', version: portfolio.version };
  }

  const watchlist = readWatchlist(storage);
  if (watchlist.status === 'corrupt') {
    return { status: 'corrupt', namespace: 'watchlist', message: watchlist.error };
  }
  if (watchlist.status === 'unsupported_version') {
    return { status: 'unsupported_version', namespace: 'watchlist', version: watchlist.version };
  }

  const preferences = readDurablePreferences(storage);
  if (preferences.status === 'corrupt') {
    return { status: 'corrupt', namespace: 'preferences', message: preferences.error };
  }
  if (preferences.status === 'unsupported_version') {
    return { status: 'unsupported_version', namespace: 'preferences', version: preferences.version };
  }

  const portfolioData = portfolio.status === 'ok' ? toDurablePortfolioState(portfolio.data) : [];
  const watchlistData = watchlist.status === 'ok' ? toDurableWatchlistState(watchlist.data) : [];
  const preferencesData = preferences.status === 'ok' ? preferences.data : {};

  return {
    status: 'ok',
    value: {
      documents: {
        portfolio: {
          schemaVersion: PORTFOLIO_DURABLE_SCHEMA_VERSION,
          payload: { data: portfolioData },
        },
        watchlist: {
          schemaVersion: WATCHLIST_DURABLE_SCHEMA_VERSION,
          payload: { data: watchlistData },
        },
        preferences: {
          schemaVersion: PREFERENCES_DURABLE_SCHEMA_VERSION,
          payload: { data: preferencesData },
        },
      },
      localUpdatedAt: {
        portfolio: portfolio.status === 'ok' ? portfolio.updatedAt : null,
        watchlist: watchlist.status === 'ok' ? watchlist.updatedAt : null,
        preferences: preferences.status === 'ok' ? preferences.updatedAt : null,
      },
      localRevision: {
        portfolio: portfolio.status === 'ok' ? portfolio.revision : 0,
        watchlist: watchlist.status === 'ok' ? watchlist.revision : 0,
        preferences: preferences.status === 'ok' ? preferences.revision : 0,
      },
      summary: summarizeDurableData(portfolioData, watchlistData, preferencesData),
    },
  };
}

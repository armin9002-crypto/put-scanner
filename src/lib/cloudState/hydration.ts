import type { DurablePreferences } from '../durablePreferences.ts';
import {
  hydrateRuntimePortfolio,
  type PortfolioMarketData,
  type PortfolioTrade,
} from '../portfolioStorage.ts';
import {
  hydrateRuntimeWatchlist,
  type WatchlistItem,
  type WatchlistLocalState,
} from '../watchlist.ts';
import type { CloudStateSet } from './types.ts';

export interface RuntimeHydrationInput {
  portfolio: PortfolioTrade[];
  watchlist: WatchlistItem[];
}

export interface PreparedRuntimeState {
  portfolio: PortfolioTrade[];
  watchlist: WatchlistItem[];
  preferences: DurablePreferences;
}

function currentPortfolioMarketData(trades: PortfolioTrade[]): Record<string, PortfolioMarketData> {
  return Object.fromEntries(trades.flatMap(trade => (
    trade.latestMarketData ? [[trade.id, trade.latestMarketData]] : []
  )));
}

function currentWatchlistLocalState(items: WatchlistItem[]): Record<string, WatchlistLocalState> {
  return Object.fromEntries(items.flatMap(item => {
    const localState: WatchlistLocalState = {
      ...(item.snapshot ? { snapshot: item.snapshot } : {}),
      ...(item.status ? { status: item.status } : {}),
      ...(item.updatedAt !== undefined ? { updatedAt: item.updatedAt } : {}),
    };
    return Object.keys(localState).length > 0 ? [[item.id, localState]] : [];
  }));
}

export function prepareRuntimeStateFromCloud(
  cloud: CloudStateSet,
  current: RuntimeHydrationInput,
): PreparedRuntimeState {
  return {
    portfolio: hydrateRuntimePortfolio(
      cloud.portfolio.payload.data,
      currentPortfolioMarketData(current.portfolio),
    ),
    watchlist: hydrateRuntimeWatchlist(
      cloud.watchlist.payload.data,
      currentWatchlistLocalState(current.watchlist),
    ),
    preferences: {
      ...cloud.preferences.payload.data,
      ...(cloud.preferences.payload.data.collapsedExpirationGroups
        ? { collapsedExpirationGroups: { ...cloud.preferences.payload.data.collapsedExpirationGroups } }
        : {}),
      ...(cloud.preferences.payload.data.collapsedUnderlyingGroups
        ? { collapsedUnderlyingGroups: { ...cloud.preferences.payload.data.collapsedUnderlyingGroups } }
        : {}),
    },
  };
}

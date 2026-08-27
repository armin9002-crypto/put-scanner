import type { PortfolioMarketData, PortfolioTrade } from './portfolioStorage.ts';

export type PortfolioMarketDataUpdateMode = 'merge' | 'replace';

/**
 * Applies device-local current-market state without touching durable trade data.
 * In particular, PortfolioTrade.updatedAt records durable user/lifecycle changes
 * and must never be advanced by quote freshness.
 */
export function applyTransientPortfolioMarketData(
  trade: PortfolioTrade,
  marketData: PortfolioMarketData,
  mode: PortfolioMarketDataUpdateMode = 'merge',
): PortfolioTrade {
  return {
    ...trade,
    latestMarketData: mode === 'replace'
      ? { ...marketData }
      : { ...trade.latestMarketData, ...marketData },
  };
}

function sameMarketDataTarget(current: PortfolioTrade, requested: PortfolioTrade): boolean {
  return current.status === 'open'
    && requested.status === 'open'
    && current.optionType === requested.optionType
    && current.ticker.trim().toUpperCase() === requested.ticker.trim().toUpperCase()
    && current.expiration === requested.expiration
    && Math.abs(current.strike - requested.strike) < 0.0001;
}

function refreshedAt(value: PortfolioTrade): number {
  const timestamp = Date.parse(value.latestMarketData?.refreshedAt ?? '');
  return Number.isFinite(timestamp) ? timestamp : 0;
}

/**
 * Reconciles an async quote sweep with the latest durable Portfolio state.
 * Removed trades stay removed, durable edits win, and only device-local market
 * data is copied from a still-matching refresh target.
 */
export function mergePortfolioMarketRefresh(
  currentTrades: PortfolioTrade[],
  refreshedSnapshot: PortfolioTrade[],
): PortfolioTrade[] {
  const refreshedById = new Map(refreshedSnapshot.map(trade => [trade.id, trade]));
  return currentTrades.map(current => {
    const refreshed = refreshedById.get(current.id);
    if (!refreshed || !sameMarketDataTarget(current, refreshed)) return current;
    if (refreshedAt(current) > refreshedAt(refreshed)) return current;
    return {
      ...current,
      ...(refreshed.latestMarketData ? { latestMarketData: { ...refreshed.latestMarketData } } : {}),
    };
  });
}

/**
 * Applies lifecycle resolution only when the durable trade is still the exact
 * version that was inspected. This prevents passive expiration work from
 * overwriting an edit or resurrecting a deletion completed while it awaited
 * historical market data.
 */
export function mergePortfolioLifecycleResults(
  currentTrades: PortfolioTrade[],
  inspectedSnapshot: PortfolioTrade[],
  resolvedSnapshot: PortfolioTrade[],
): PortfolioTrade[] {
  const inspectedById = new Map(inspectedSnapshot.map(trade => [trade.id, trade]));
  const resolvedById = new Map(resolvedSnapshot.map(trade => [trade.id, trade]));
  return currentTrades.map(current => {
    const inspected = inspectedById.get(current.id);
    const resolved = resolvedById.get(current.id);
    if (!inspected || !resolved || current.updatedAt !== inspected.updatedAt) return current;
    if (resolved === inspected) return current;
    return resolved;
  });
}

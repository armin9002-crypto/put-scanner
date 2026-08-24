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

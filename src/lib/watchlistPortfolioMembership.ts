import { makePortfolioContractKey } from './portfolioContractIdentity.ts';
import type { PortfolioTrade } from './portfolioStorage.ts';
import type { WatchlistItem } from './watchlist.ts';

export function buildOpenPortfolioContractKeys(trades: readonly PortfolioTrade[]): Set<string> {
  return new Set(
    trades
      .filter(trade => trade.status === 'open')
      .map(trade => makePortfolioContractKey(trade)),
  );
}

export function isWatchlistContractInOpenPortfolio(
  item: Pick<WatchlistItem, 'ticker' | 'expiry' | 'strike' | 'optionType'>,
  openPortfolioContractKeys: ReadonlySet<string>,
): boolean {
  return openPortfolioContractKeys.has(makePortfolioContractKey({
    ticker: item.ticker,
    optionType: item.optionType,
    expiration: item.expiry,
    strike: item.strike,
  }));
}

import type { BatchPriceData } from './cache.ts';
import type { ScannerLiquidityLabel, ScannerOptionSnapshot } from './scannerOptionSnapshot.ts';
import type { ETFInfo } from './types';

export type ScannerSort = 'default' | 'iv60' | 'liquidity' | 'fiveDay' | 'oneMonth' | 'threeMonth' | 'drawdown52w' | 'priceHigh' | 'priceLow';
export type ScannerLiquidityFilter = 'all' | 'mediumPlus' | 'liquidPlus';

const LIQUIDITY_RANK: Record<ScannerLiquidityLabel, number> = {
  very_liquid: 5, liquid: 4, medium: 3, thin: 2, illiquid: 1, unavailable: 0,
};

export function passesScannerLiquidityFilter(snapshot: ScannerOptionSnapshot | null | undefined, filter: ScannerLiquidityFilter): boolean {
  if (filter === 'all') return true;
  const rank = snapshot ? LIQUIDITY_RANK[snapshot.liquidityLabel] : 0;
  return filter === 'mediumPlus' ? rank >= 3 : rank >= 4;
}

export function sortScannerEtfs(etfs: ETFInfo[], sort: ScannerSort, prices: BatchPriceData, snapshots: Record<string, ScannerOptionSnapshot>): ETFInfo[] {
  if (sort === 'default') return etfs;
  const numeric = (etf: ETFInfo): number | null => {
    const price = prices[etf.ticker];
    const snapshot = snapshots[etf.ticker];
    if (sort === 'iv60') return snapshot?.atmPutIv ?? null;
    if (sort === 'liquidity') return snapshot ? LIQUIDITY_RANK[snapshot.liquidityLabel] : 0;
    if (sort === 'fiveDay') return price?.fiveDay ?? null;
    if (sort === 'oneMonth') return price?.oneMonth ?? null;
    if (sort === 'threeMonth') return price?.threeMonth ?? null;
    if (sort === 'drawdown52w') return price?.fiftyTwoWeekHighPct ?? null;
    return price?.price ?? null;
  };
  return [...etfs].sort((a, b) => {
    const aValue = numeric(a);
    const bValue = numeric(b);
    if (aValue == null && bValue == null) return a.ticker.localeCompare(b.ticker);
    if (aValue == null) return 1;
    if (bValue == null) return -1;
    const direction = sort === 'priceLow' || sort === 'drawdown52w' ? 1 : -1;
    const primary = (aValue - bValue) * direction;
    if (primary !== 0) return primary;
    if (sort === 'liquidity') {
      const score = (snapshots[b.ticker]?.liquidityScore ?? -1) - (snapshots[a.ticker]?.liquidityScore ?? -1);
      if (score !== 0) return score;
    }
    return a.ticker.localeCompare(b.ticker);
  });
}

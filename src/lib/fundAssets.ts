import { makeCacheKey } from './dataCache.ts';
import { requestMarketData } from './marketDataRequest.ts';

export type FundAssetsData = Record<string, number | null>;

const SOFT_TTL_MS = 24 * 60 * 60 * 1000;
const HARD_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeFundAssets(value: unknown): number | null {
  const numeric = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function formatFundAssets(value: number | null | undefined): string {
  const assets = normalizeFundAssets(value);
  if (assets == null) return '—';
  if (assets >= 1_000_000_000) {
    return `$${(assets / 1_000_000_000).toLocaleString('en-US', { maximumFractionDigits: 1 })}B`;
  }
  if (assets < 500_000) return '<$1M';
  return `$${Math.round(assets / 1_000_000).toLocaleString('en-US')}M`;
}

export function formatFundAssetsDetail(value: number | null | undefined): string {
  const assets = normalizeFundAssets(value);
  if (assets == null) return 'Unavailable';
  return `$${assets.toLocaleString('en-US')} (${(assets / 1_000_000_000).toLocaleString('en-US', { maximumFractionDigits: 2 })} billion)`;
}

export async function fetchFundAssets(tickers: string[]): Promise<FundAssetsData> {
  const symbols = [...new Set(tickers.map(ticker => ticker.trim().toUpperCase()).filter(Boolean))].sort();
  const result = await requestMarketData<FundAssetsData>({
    key: makeCacheKey(['fund_assets_v1', ...symbols]),
    source: 'fetchFundAssets',
    endpoint: 'fund-metadata',
    softTtlMs: SOFT_TTL_MS,
    hardTtlMs: HARD_TTL_MS,
    schemaVersion: 1,
    allowStaleOnError: true,
    validator: data => data != null && typeof data === 'object',
    fetcher: async signal => {
      const response = await fetch(`/api/fund-metadata?symbols=${encodeURIComponent(symbols.join(','))}`, { signal });
      if (!response.ok) {
        const error = new Error('Failed to fetch fund assets') as Error & { status: number };
        error.status = response.status;
        throw error;
      }
      const data = await response.json() as FundAssetsData & { error?: string };
      if (data.error) throw new Error(data.error);
      return Object.fromEntries(symbols.map(symbol => [symbol, normalizeFundAssets(data[symbol])]));
    },
  });
  return result.data;
}

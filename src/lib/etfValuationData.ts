import { cachedRequest, makeCacheKey } from './dataCache';
import type { EtfPulseRow } from './etfPulseMetrics';
import { getValuationProxyForTicker } from './etfValuationProxies';

export interface ProxyValuation {
  proxyTicker: string;
  forwardPe: number | null;
  trailingPe?: number | null;
  source: 'yahoo' | 'unavailable';
  fetchedAt: string;
  error?: string;
}

export type ProxyValuationMap = Record<string, ProxyValuation>;

const PROXY_VALUATION_TTL = 24 * 60 * 60 * 1000;

function finite(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function normalizeValuation(value: unknown, ticker: string): ProxyValuation {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const source = record.source === 'yahoo' ? 'yahoo' : 'unavailable';
  const fetchedAt = typeof record.fetchedAt === 'string' ? record.fetchedAt : new Date().toISOString();
  return {
    proxyTicker: ticker,
    forwardPe: finite(record.forwardPe),
    trailingPe: finite(record.trailingPe),
    source,
    fetchedAt,
    error: typeof record.error === 'string' ? record.error : undefined,
  };
}

function isValidValuationMap(value: unknown): value is ProxyValuationMap {
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).every(item => item && typeof item === 'object' && typeof (item as ProxyValuation).proxyTicker === 'string');
}

export function getUniqueValuationProxies(rows: Array<Pick<EtfPulseRow, 'ticker'>>): string[] {
  const proxies = new Set<string>();
  rows.forEach(row => {
    const proxy = getValuationProxyForTicker(row.ticker);
    if (proxy.meaningful && proxy.proxyTicker) proxies.add(proxy.proxyTicker.toUpperCase());
  });
  return [...proxies].sort((a, b) => a.localeCompare(b));
}

export async function fetchProxyValuations(proxyTickers: string[], options: { forceRefresh?: boolean } = {}): Promise<ProxyValuationMap> {
  const uniqueTickers = [...new Set(proxyTickers.map(ticker => ticker.trim().toUpperCase()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  if (uniqueTickers.length === 0) return {};
  const key = makeCacheKey(['etf_pulse_proxy_valuations', 'v1', uniqueTickers.join(',')]);

  return cachedRequest(
    key,
    PROXY_VALUATION_TTL,
    async () => {
      const response = await fetch(`/api/proxy-valuations?tickers=${encodeURIComponent(uniqueTickers.join(','))}`);
      if (!response.ok) throw new Error('Failed to fetch proxy valuations');
      const data = await response.json();
      if (data.error) throw new Error(data.error);
      const raw = data?.valuations && typeof data.valuations === 'object' ? data.valuations as Record<string, unknown> : {};
      return uniqueTickers.reduce<ProxyValuationMap>((map, ticker) => {
        map[ticker] = normalizeValuation(raw[ticker], ticker);
        return map;
      }, {});
    },
    {
      bypassCache: options.forceRefresh,
      validator: isValidValuationMap,
    }
  );
}

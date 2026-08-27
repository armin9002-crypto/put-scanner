import { requestMarketData } from './marketDataRequest.ts';
import type { RequestEndpoint } from './requestDiagnostics';

export function makeCacheKey(parts: Array<string | number | null | undefined>): string {
  return parts.map(part => String(part ?? 'none')).join(':');
}

export async function cachedRequest<T>(
  key: string,
  ttlMs: number,
  request: (signal: AbortSignal) => Promise<T>,
  options: {
    bypassCache?: boolean;
    storage?: 'local' | 'session';
    validator?: (data: T) => boolean;
    diagnosticsEndpoint?: RequestEndpoint;
    diagnosticsSource?: string;
    hardTtlMs?: number;
    schemaVersion?: number;
    allowStaleOnError?: boolean;
    signal?: AbortSignal;
  } = {}
): Promise<T> {
  const result = await requestMarketData({
    key,
    source: options.diagnosticsSource ?? 'cachedRequest',
    endpoint: options.diagnosticsEndpoint ?? 'price',
    softTtlMs: ttlMs,
    hardTtlMs: options.hardTtlMs ?? Math.max(ttlMs * 4, ttlMs + 30 * 60 * 1000),
    schemaVersion: options.schemaVersion ?? 1,
    mode: options.bypassCache ? 'revalidate' : 'cache-first',
    allowStaleOnError: options.allowStaleOnError ?? true,
    signal: options.signal,
    storage: options.storage,
    validator: options.validator ?? (() => true),
    fetcher: signal => request(signal),
  });
  return result.data;
}

import { mapWithConcurrency } from '../../shared/concurrency.js';
import { recordChainRequestPlan, recordObservedConcurrency } from './requestDiagnostics.ts';

export interface OptionChainRequest {
  key: string;
  ticker: string;
  expirationTimestamp: number;
}

export function canonicalOptionChainKey(ticker: string, expirationTimestamp: number): string {
  return `${ticker.trim().toUpperCase()}|${expirationTimestamp}`;
}

export function planOptionChainRequests(items: ReadonlyArray<{ ticker: string; expirationTimestamp: number }>) {
  const byKey = new Map<string, OptionChainRequest>();
  items.forEach(item => {
    const ticker = item.ticker.trim().toUpperCase();
    if (!ticker || !Number.isInteger(item.expirationTimestamp) || item.expirationTimestamp <= 0) return;
    const key = canonicalOptionChainKey(ticker, item.expirationTimestamp);
    if (!byKey.has(key)) byKey.set(key, { key, ticker, expirationTimestamp: item.expirationTimestamp });
  });
  return { requestedCount: items.length, requests: [...byKey.values()] };
}

export async function acquireOptionChains<T>(
  items: ReadonlyArray<{ ticker: string; expirationTimestamp: number }>,
  options: { source: string; fetchChain: (ticker: string, expirationTimestamp: number) => Promise<T>; limit?: number },
) {
  const plan = planOptionChainRequests(items);
  recordChainRequestPlan(plan.requestedCount, plan.requests.length, options.source);
  let maxObservedConcurrency = 0;
  const settled = await mapWithConcurrency(plan.requests, options.limit ?? 3, request => options.fetchChain(request.ticker, request.expirationTimestamp), {
    onActiveChange: active => {
      maxObservedConcurrency = Math.max(maxObservedConcurrency, active);
      recordObservedConcurrency('options', active, options.source);
    },
  });
  const byKey = new Map<string, T | null>();
  const failedKeys = new Set<string>();
  settled.forEach((result, index) => {
    const key = plan.requests[index].key;
    if (result.status === 'fulfilled') byKey.set(key, result.value);
    else { byKey.set(key, null); failedKeys.add(key); }
  });
  return { byKey, failedKeys, requestedCount: plan.requestedCount, uniqueCount: plan.requests.length, maxObservedConcurrency };
}

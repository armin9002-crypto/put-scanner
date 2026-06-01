export type RequestEndpoint = 'options' | 'prices' | 'price' | 'chart-history' | 'ivrank';
export type RequestDiagnosticKind = 'attempted' | 'cacheHit' | 'network';

export interface RequestDiagnosticEntry {
  attempted: number;
  cacheHits: number;
  networkRequests: number;
  lastRequestAt: number | null;
  sources: Record<string, number>;
}

export type RequestDiagnosticsSnapshot = Record<RequestEndpoint, RequestDiagnosticEntry>;

const endpoints: RequestEndpoint[] = ['options', 'prices', 'price', 'chart-history', 'ivrank'];
const state: RequestDiagnosticsSnapshot = endpoints.reduce((acc, endpoint) => {
  acc[endpoint] = { attempted: 0, cacheHits: 0, networkRequests: 0, lastRequestAt: null, sources: {} };
  return acc;
}, {} as RequestDiagnosticsSnapshot);

function storageEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('put_scanner_debug_network') === 'true';
  } catch {
    return false;
  }
}

export function isRequestDiagnosticsEnabled(): boolean {
  return import.meta.env.DEV || storageEnabled();
}

export function recordRequestDiagnostic(endpoint: RequestEndpoint, kind: RequestDiagnosticKind, source = 'unknown'): void {
  if (!isRequestDiagnosticsEnabled()) return;
  const entry = state[endpoint];
  if (kind === 'attempted') entry.attempted += 1;
  if (kind === 'cacheHit') entry.cacheHits += 1;
  if (kind === 'network') entry.networkRequests += 1;
  entry.lastRequestAt = Date.now();
  entry.sources[source] = (entry.sources[source] ?? 0) + 1;
}

export function getRequestDiagnosticsSnapshot(): RequestDiagnosticsSnapshot {
  return endpoints.reduce((acc, endpoint) => {
    const entry = state[endpoint];
    acc[endpoint] = {
      attempted: entry.attempted,
      cacheHits: entry.cacheHits,
      networkRequests: entry.networkRequests,
      lastRequestAt: entry.lastRequestAt,
      sources: { ...entry.sources },
    };
    return acc;
  }, {} as RequestDiagnosticsSnapshot);
}

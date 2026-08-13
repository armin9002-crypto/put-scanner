export type RequestEndpoint = 'options' | 'prices' | 'price' | 'chart-history' | 'ivrank' | 'holdings';
export type RequestDiagnosticKind = 'attempted' | 'cacheHit' | 'memoryHit' | 'persistentHit' | 'network' | 'deduped' | 'staleFallback' | 'success' | 'failure';

export interface RequestDiagnosticEntry {
  attempted: number;
  cacheHits: number;
  networkRequests: number;
  memoryHits: number;
  persistentCacheHits: number;
  inFlightDedupes: number;
  staleFallbacks: number;
  failures: number;
  lastDurationMs: number | null;
  lastRequestAt: number | null;
  sources: Record<string, number>;
}

export type RequestDiagnosticsSnapshot = Record<RequestEndpoint, RequestDiagnosticEntry>;

const endpoints: RequestEndpoint[] = ['options', 'prices', 'price', 'chart-history', 'ivrank', 'holdings'];
const state: RequestDiagnosticsSnapshot = endpoints.reduce((acc, endpoint) => {
  acc[endpoint] = { attempted: 0, cacheHits: 0, networkRequests: 0, memoryHits: 0, persistentCacheHits: 0, inFlightDedupes: 0, staleFallbacks: 0, failures: 0, lastDurationMs: null, lastRequestAt: null, sources: {} };
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
  return Boolean(import.meta.env?.DEV) || storageEnabled();
}

export function recordRequestDiagnostic(endpoint: RequestEndpoint, kind: RequestDiagnosticKind, source = 'unknown', durationMs?: number): void {
  if (!isRequestDiagnosticsEnabled()) return;
  const entry = state[endpoint];
  if (kind === 'attempted') entry.attempted += 1;
  if (kind === 'cacheHit') entry.cacheHits += 1;
  if (kind === 'memoryHit') { entry.memoryHits += 1; entry.cacheHits += 1; }
  if (kind === 'persistentHit') { entry.persistentCacheHits += 1; entry.cacheHits += 1; }
  if (kind === 'network') entry.networkRequests += 1;
  if (kind === 'deduped') entry.inFlightDedupes += 1;
  if (kind === 'staleFallback') entry.staleFallbacks += 1;
  if (kind === 'failure') entry.failures += 1;
  if (typeof durationMs === 'number') entry.lastDurationMs = durationMs;
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
      memoryHits: entry.memoryHits,
      persistentCacheHits: entry.persistentCacheHits,
      inFlightDedupes: entry.inFlightDedupes,
      staleFallbacks: entry.staleFallbacks,
      failures: entry.failures,
      lastDurationMs: entry.lastDurationMs,
      lastRequestAt: entry.lastRequestAt,
      sources: { ...entry.sources },
    };
    return acc;
  }, {} as RequestDiagnosticsSnapshot);
}

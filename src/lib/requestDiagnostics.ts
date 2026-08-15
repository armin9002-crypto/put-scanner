export type RequestEndpoint = 'options' | 'prices' | 'price' | 'chart-history' | 'etf-pulse' | 'ivrank' | 'holdings' | 'fund-metadata';
export type RequestDiagnosticKind = 'attempted' | 'cacheHit' | 'memoryHit' | 'persistentHit' | 'network' | 'deduped' | 'staleFallback' | 'success' | 'failure' | 'circuitRejected';

export interface RequestDiagnosticEntry {
  attempted: number;
  cacheHits: number;
  networkRequests: number;
  memoryHits: number;
  persistentCacheHits: number;
  inFlightDedupes: number;
  staleFallbacks: number;
  failures: number;
  serverEndpointResponses: number;
  yahooUpstreamAttempts: number;
  chainsDeduplicated: number;
  maxObservedConcurrency: number;
  circuitBreakerRejections: number;
  lastDatasetVersion: string | null;
  cacheStrategies: Record<string, number>;
  lastDurationMs: number | null;
  lastRequestAt: number | null;
  sources: Record<string, number>;
}

export type RequestDiagnosticsSnapshot = Record<RequestEndpoint, RequestDiagnosticEntry>;

const endpoints: RequestEndpoint[] = ['options', 'prices', 'price', 'chart-history', 'etf-pulse', 'ivrank', 'holdings', 'fund-metadata'];
const state: RequestDiagnosticsSnapshot = endpoints.reduce((acc, endpoint) => {
  acc[endpoint] = { attempted: 0, cacheHits: 0, networkRequests: 0, memoryHits: 0, persistentCacheHits: 0, inFlightDedupes: 0, staleFallbacks: 0, failures: 0, serverEndpointResponses: 0, yahooUpstreamAttempts: 0, chainsDeduplicated: 0, maxObservedConcurrency: 0, circuitBreakerRejections: 0, lastDatasetVersion: null, cacheStrategies: {}, lastDurationMs: null, lastRequestAt: null, sources: {} };
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
  return diagnosticsOverride ?? (Boolean(import.meta.env?.DEV) || storageEnabled());
}

let diagnosticsOverride: boolean | null = null;

export function setRequestDiagnosticsEnabledForTests(enabled: boolean | null): void {
  diagnosticsOverride = enabled;
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
  if (kind === 'circuitRejected') entry.circuitBreakerRejections += 1;
  if (typeof durationMs === 'number') entry.lastDurationMs = durationMs;
  entry.lastRequestAt = Date.now();
  entry.sources[source] = (entry.sources[source] ?? 0) + 1;
}

export function recordResponseDebugHeaders(endpoint: RequestEndpoint, response: Response, source = 'unknown'): void {
  if (!isRequestDiagnosticsEnabled()) return;
  const entry = state[endpoint];
  entry.serverEndpointResponses += 1;
  const upstream = Number(response.headers.get('X-PutScanner-Upstream-Requests'));
  if (Number.isFinite(upstream) && upstream >= 0) entry.yahooUpstreamAttempts += upstream;
  const concurrency = Number(response.headers.get('X-PutScanner-Max-Observed-Concurrency'));
  if (Number.isFinite(concurrency) && concurrency >= 0) entry.maxObservedConcurrency = Math.max(entry.maxObservedConcurrency, concurrency);
  const circuitRejections = Number(response.headers.get('X-PutScanner-Circuit-Rejections'));
  if (Number.isFinite(circuitRejections) && circuitRejections >= 0) entry.circuitBreakerRejections += circuitRejections;
  const strategy = response.headers.get('X-PutScanner-Cache-Strategy');
  if (strategy) entry.cacheStrategies[strategy] = (entry.cacheStrategies[strategy] ?? 0) + 1;
  entry.lastDatasetVersion = response.headers.get('X-PutScanner-Dataset-Version') ?? entry.lastDatasetVersion;
  entry.lastRequestAt = Date.now();
  entry.sources[source] = (entry.sources[source] ?? 0) + 1;
}

export function recordChainRequestPlan(requested: number, unique: number, source: string): void {
  if (!isRequestDiagnosticsEnabled()) return;
  const entry = state.options;
  entry.chainsDeduplicated += Math.max(0, requested - unique);
  entry.sources[source] = (entry.sources[source] ?? 0) + 1;
}

export function recordObservedConcurrency(endpoint: RequestEndpoint, active: number, source: string): void {
  if (!isRequestDiagnosticsEnabled()) return;
  const entry = state[endpoint];
  entry.maxObservedConcurrency = Math.max(entry.maxObservedConcurrency, active);
  entry.sources[source] = (entry.sources[source] ?? 0) + 1;
}

export function resetRequestDiagnosticsForTests(): void {
  endpoints.forEach(endpoint => {
    const entry = state[endpoint];
    Object.assign(entry, { attempted: 0, cacheHits: 0, networkRequests: 0, memoryHits: 0, persistentCacheHits: 0, inFlightDedupes: 0, staleFallbacks: 0, failures: 0, serverEndpointResponses: 0, yahooUpstreamAttempts: 0, chainsDeduplicated: 0, maxObservedConcurrency: 0, circuitBreakerRejections: 0, lastDatasetVersion: null, cacheStrategies: {}, lastDurationMs: null, lastRequestAt: null, sources: {} });
  });
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
      serverEndpointResponses: entry.serverEndpointResponses,
      yahooUpstreamAttempts: entry.yahooUpstreamAttempts,
      chainsDeduplicated: entry.chainsDeduplicated,
      maxObservedConcurrency: entry.maxObservedConcurrency,
      circuitBreakerRejections: entry.circuitBreakerRejections,
      lastDatasetVersion: entry.lastDatasetVersion,
      cacheStrategies: { ...entry.cacheStrategies },
      lastDurationMs: entry.lastDurationMs,
      lastRequestAt: entry.lastRequestAt,
      sources: { ...entry.sources },
    };
    return acc;
  }, {} as RequestDiagnosticsSnapshot);
}

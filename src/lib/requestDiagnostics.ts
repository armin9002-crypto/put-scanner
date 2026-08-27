export type RequestEndpoint = 'options' | 'ticker-detail' | 'prices' | 'price' | 'chart-history' | 'etf-pulse' | 'screener-batch' | 'screener-expirations' | 'volatility-context' | 'holdings' | 'fund-metadata';
export type RequestDiagnosticKind = 'attempted' | 'cacheHit' | 'memoryHit' | 'persistentHit' | 'network' | 'deduped' | 'staleFallback' | 'success' | 'failure' | 'aborted' | 'circuitRejected';

export interface RequestDiagnosticEntry {
  attempted: number;
  cacheHits: number;
  networkRequests: number;
  memoryHits: number;
  persistentCacheHits: number;
  inFlightDedupes: number;
  staleFallbacks: number;
  failures: number;
  aborted: number;
  serverEndpointResponses: number;
  yahooUpstreamAttempts: number;
  chainsDeduplicated: number;
  maxObservedConcurrency: number;
  circuitBreakerRejections: number;
  lastDatasetVersion: string | null;
  cacheStrategies: Record<string, number>;
  plannedChains: number;
  responseBytes: number;
  lastDurationMs: number | null;
  lastServerDurationMs: number | null;
  lastRequestId: string | null;
  retries: number;
  failureCategories: Record<string, number>;
  lastRequestAt: number | null;
  sources: Record<string, number>;
}

export type RequestDiagnosticsSnapshot = Record<RequestEndpoint, RequestDiagnosticEntry>;

const endpoints: RequestEndpoint[] = ['options', 'ticker-detail', 'prices', 'price', 'chart-history', 'etf-pulse', 'screener-batch', 'screener-expirations', 'volatility-context', 'holdings', 'fund-metadata'];
const state: RequestDiagnosticsSnapshot = endpoints.reduce((acc, endpoint) => {
  acc[endpoint] = { attempted: 0, cacheHits: 0, networkRequests: 0, memoryHits: 0, persistentCacheHits: 0, inFlightDedupes: 0, staleFallbacks: 0, failures: 0, aborted: 0, serverEndpointResponses: 0, yahooUpstreamAttempts: 0, chainsDeduplicated: 0, maxObservedConcurrency: 0, circuitBreakerRejections: 0, lastDatasetVersion: null, cacheStrategies: {}, plannedChains: 0, responseBytes: 0, lastDurationMs: null, lastServerDurationMs: null, lastRequestId: null, retries: 0, failureCategories: {}, lastRequestAt: null, sources: {} };
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
  if (kind === 'aborted') entry.aborted += 1;
  if (kind === 'circuitRejected') entry.circuitBreakerRejections += 1;
  if (typeof durationMs === 'number') entry.lastDurationMs = durationMs;
  entry.lastRequestAt = Date.now();
  entry.sources[source] = (entry.sources[source] ?? 0) + 1;
}

export interface DevelopmentRequestEvent {
  requestId: string;
  endpoint: RequestEndpoint;
  source: string;
  status: number | null;
  outcome: 'success' | 'failure' | 'aborted';
  cacheStatus: string | null;
  providerAttempts: number;
  retryCount: number;
  serverDurationMs: number | null;
  browserDurationMs: number;
  failureCategory: string | null;
  recordedAt: number;
}

export interface DevelopmentRequestSummary {
  browserRequests: number;
  vercelResponses: number;
  providerAttempts: number;
  retries: number;
  failures: number;
  aborted: number;
  byEndpoint: Partial<Record<RequestEndpoint, { browserRequests: number; providerAttempts: number; failures: number }>>;
}

const MAX_DEVELOPMENT_REQUEST_EVENTS = 100;
const developmentRequestEvents: DevelopmentRequestEvent[] = [];
let observedResponses = new WeakSet<Response>();

function finiteHeaderNumber(response: Response, name: string): number | null {
  const raw = response.headers.get(name);
  if (raw == null || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function appendDevelopmentRequestEvent(event: DevelopmentRequestEvent): void {
  if (!isRequestDiagnosticsEnabled()) return;
  developmentRequestEvents.push(event);
  if (developmentRequestEvents.length > MAX_DEVELOPMENT_REQUEST_EVENTS) {
    developmentRequestEvents.splice(0, developmentRequestEvents.length - MAX_DEVELOPMENT_REQUEST_EVENTS);
  }
}

export function createRequestCorrelationId(
  now = Date.now(),
  random = Math.floor(Math.random() * 0x1_0000_0000),
): string {
  const safeNow = Number.isFinite(now) && now >= 0 ? Math.floor(now) : 0;
  const safeRandom = Number.isFinite(random) && random >= 0 ? Math.floor(random) >>> 0 : 0;
  return `ps-${safeNow.toString(36)}-${safeRandom.toString(36).padStart(7, '0')}`;
}

export function recordResponseDebugHeaders(
  endpoint: RequestEndpoint,
  response: Response,
  source = 'unknown',
  browserRequest?: { requestId: string; startedAt: number },
): void {
  if (!isRequestDiagnosticsEnabled()) return;
  if (observedResponses.has(response)) return;
  observedResponses.add(response);
  const entry = state[endpoint];
  entry.serverEndpointResponses += 1;
  const upstream = finiteHeaderNumber(response, 'X-PutScanner-Upstream-Requests') ?? 0;
  entry.yahooUpstreamAttempts += upstream;
  const concurrency = finiteHeaderNumber(response, 'X-PutScanner-Max-Observed-Concurrency');
  if (concurrency != null) entry.maxObservedConcurrency = Math.max(entry.maxObservedConcurrency, concurrency);
  const circuitRejections = finiteHeaderNumber(response, 'X-PutScanner-Circuit-Rejections');
  if (circuitRejections != null) entry.circuitBreakerRejections += circuitRejections;
  const plannedChains = finiteHeaderNumber(response, 'X-PutScanner-Planned-Chains');
  if (plannedChains != null) entry.plannedChains += plannedChains;
  const responseBytes = finiteHeaderNumber(response, 'X-PutScanner-Response-Bytes');
  if (responseBytes != null) entry.responseBytes += responseBytes;
  const serverDuration = finiteHeaderNumber(response, 'X-PutScanner-Server-Duration-Ms');
  if (serverDuration != null) entry.lastServerDurationMs = serverDuration;
  const retries = finiteHeaderNumber(response, 'X-PutScanner-Retry-Count') ?? 0;
  entry.retries += retries;
  const requestId = response.headers.get('X-PutScanner-Request-Id') ?? browserRequest?.requestId ?? null;
  entry.lastRequestId = requestId;
  const failureCategory = response.headers.get('X-PutScanner-Failure-Category');
  if (failureCategory && failureCategory !== 'none') {
    entry.failureCategories[failureCategory] = (entry.failureCategories[failureCategory] ?? 0) + 1;
  }
  const strategy = response.headers.get('X-PutScanner-Cache-Strategy');
  if (strategy) entry.cacheStrategies[strategy] = (entry.cacheStrategies[strategy] ?? 0) + 1;
  entry.lastDatasetVersion = response.headers.get('X-PutScanner-Dataset-Version') ?? entry.lastDatasetVersion;
  entry.lastRequestAt = Date.now();
  entry.sources[source] = (entry.sources[source] ?? 0) + 1;
  appendDevelopmentRequestEvent({
    requestId: requestId ?? 'unavailable',
    endpoint,
    source,
    status: response.status,
    outcome: response.ok ? 'success' : 'failure',
    cacheStatus: response.headers.get('X-Vercel-Cache') ?? response.headers.get('X-PutScanner-Cache-Status') ?? strategy,
    providerAttempts: upstream,
    retryCount: retries,
    serverDurationMs: serverDuration,
    browserDurationMs: Math.max(0, Date.now() - (browserRequest?.startedAt ?? Date.now())),
    failureCategory: failureCategory && failureCategory !== 'none' ? failureCategory : null,
    recordedAt: Date.now(),
  });
}

export async function fetchObservedMarketData(
  endpoint: RequestEndpoint,
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  source: string,
): Promise<Response> {
  const requestId = createRequestCorrelationId();
  const startedAt = Date.now();
  const headers = new Headers(init?.headers);
  headers.set('X-PutScanner-Request-Id', requestId);
  try {
    const response = await fetch(input, { ...init, headers });
    recordResponseDebugHeaders(endpoint, response, source, { requestId, startedAt });
    return response;
  } catch (error) {
    const aborted = (error as { name?: unknown })?.name === 'AbortError';
    appendDevelopmentRequestEvent({
      requestId,
      endpoint,
      source,
      status: null,
      outcome: aborted ? 'aborted' : 'failure',
      cacheStatus: null,
      providerAttempts: 0,
      retryCount: 0,
      serverDurationMs: null,
      browserDurationMs: Math.max(0, Date.now() - startedAt),
      failureCategory: aborted ? null : 'network',
      recordedAt: Date.now(),
    });
    throw error;
  }
}

export function getDevelopmentRequestEvents(): DevelopmentRequestEvent[] {
  return developmentRequestEvents.map(event => ({ ...event }));
}

export function getDevelopmentRequestSummary(): DevelopmentRequestSummary {
  return developmentRequestEvents.reduce<DevelopmentRequestSummary>((summary, event) => {
    summary.browserRequests += 1;
    if (event.status != null) summary.vercelResponses += 1;
    summary.providerAttempts += event.providerAttempts;
    summary.retries += event.retryCount;
    if (event.outcome === 'failure') summary.failures += 1;
    if (event.outcome === 'aborted') summary.aborted += 1;
    const endpoint = summary.byEndpoint[event.endpoint] ?? { browserRequests: 0, providerAttempts: 0, failures: 0 };
    endpoint.browserRequests += 1;
    endpoint.providerAttempts += event.providerAttempts;
    if (event.outcome === 'failure') endpoint.failures += 1;
    summary.byEndpoint[event.endpoint] = endpoint;
    return summary;
  }, { browserRequests: 0, vercelResponses: 0, providerAttempts: 0, retries: 0, failures: 0, aborted: 0, byEndpoint: {} });
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
    Object.assign(entry, { attempted: 0, cacheHits: 0, networkRequests: 0, memoryHits: 0, persistentCacheHits: 0, inFlightDedupes: 0, staleFallbacks: 0, failures: 0, aborted: 0, serverEndpointResponses: 0, yahooUpstreamAttempts: 0, chainsDeduplicated: 0, maxObservedConcurrency: 0, circuitBreakerRejections: 0, lastDatasetVersion: null, cacheStrategies: {}, plannedChains: 0, responseBytes: 0, lastDurationMs: null, lastServerDurationMs: null, lastRequestId: null, retries: 0, failureCategories: {}, lastRequestAt: null, sources: {} });
  });
  developmentRequestEvents.length = 0;
  observedResponses = new WeakSet<Response>();
  screenerScanState = emptyScreenerScanDiagnostics();
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
      aborted: entry.aborted,
      serverEndpointResponses: entry.serverEndpointResponses,
      yahooUpstreamAttempts: entry.yahooUpstreamAttempts,
      chainsDeduplicated: entry.chainsDeduplicated,
      maxObservedConcurrency: entry.maxObservedConcurrency,
      circuitBreakerRejections: entry.circuitBreakerRejections,
      lastDatasetVersion: entry.lastDatasetVersion,
      cacheStrategies: { ...entry.cacheStrategies },
      plannedChains: entry.plannedChains,
      responseBytes: entry.responseBytes,
      lastDurationMs: entry.lastDurationMs,
      lastServerDurationMs: entry.lastServerDurationMs,
      lastRequestId: entry.lastRequestId,
      retries: entry.retries,
      failureCategories: { ...entry.failureCategories },
      lastRequestAt: entry.lastRequestAt,
      sources: { ...entry.sources },
    };
    return acc;
  }, {} as RequestDiagnosticsSnapshot);
}

export interface ScreenerScanDiagnostics {
  scanId: string | null;
  plannedEtfs: number;
  plannedBatches: number;
  plannedOptionChains: number;
  uniqueChains: number;
  browserBatchRequests: number;
  vercelBatchResponses: number;
  reportedYahooUpstreamAttempts: number;
  maxClientBatchConcurrency: number;
  maxServerYahooConcurrency: number;
  failures: number;
  circuitBreakerRejections: number;
  elapsedMs: number | null;
  startedAt: number | null;
}

function emptyScreenerScanDiagnostics(): ScreenerScanDiagnostics {
  return {
  scanId: null, plannedEtfs: 0, plannedBatches: 0, plannedOptionChains: 0, uniqueChains: 0,
  browserBatchRequests: 0, vercelBatchResponses: 0, reportedYahooUpstreamAttempts: 0,
  maxClientBatchConcurrency: 0, maxServerYahooConcurrency: 0, failures: 0,
  circuitBreakerRejections: 0, elapsedMs: null, startedAt: null,
  };
}

let screenerScanState: ScreenerScanDiagnostics = emptyScreenerScanDiagnostics();

export function beginScreenerScanDiagnostics(scanId: string, plannedEtfs: number, plannedBatches: number): void {
  if (!isRequestDiagnosticsEnabled()) return;
  screenerScanState = {
    scanId, plannedEtfs, plannedBatches, plannedOptionChains: 0, uniqueChains: 0,
    browserBatchRequests: 0, vercelBatchResponses: 0, reportedYahooUpstreamAttempts: 0,
    maxClientBatchConcurrency: 0, maxServerYahooConcurrency: 0, failures: 0,
    circuitBreakerRejections: 0, elapsedMs: null, startedAt: Date.now(),
  };
}

export function observeScreenerClientConcurrency(scanId: string, active: number): void {
  if (!isRequestDiagnosticsEnabled() || screenerScanState.scanId !== scanId) return;
  screenerScanState.maxClientBatchConcurrency = Math.max(screenerScanState.maxClientBatchConcurrency, active);
}

export function recordScreenerScanBatch(scanId: string, value: {
  networkCall: boolean;
  plannedOptionChains?: number;
  uniqueChains?: number;
  upstreamRequests?: number;
  maxServerConcurrency?: number;
  failures?: number;
  circuitBreakerRejections?: number;
}): void {
  if (!isRequestDiagnosticsEnabled() || screenerScanState.scanId !== scanId) return;
  if (value.networkCall) {
    screenerScanState.browserBatchRequests += 1;
    screenerScanState.vercelBatchResponses += 1;
  }
  screenerScanState.plannedOptionChains += value.plannedOptionChains ?? 0;
  screenerScanState.uniqueChains += value.uniqueChains ?? 0;
  screenerScanState.reportedYahooUpstreamAttempts += value.networkCall ? value.upstreamRequests ?? 0 : 0;
  screenerScanState.maxServerYahooConcurrency = Math.max(screenerScanState.maxServerYahooConcurrency, value.maxServerConcurrency ?? 0);
  screenerScanState.failures += value.failures ?? 0;
  screenerScanState.circuitBreakerRejections += value.circuitBreakerRejections ?? 0;
}

export function finishScreenerScanDiagnostics(scanId: string, additionalFailures = 0): void {
  if (!isRequestDiagnosticsEnabled() || screenerScanState.scanId !== scanId) return;
  screenerScanState.failures += additionalFailures;
  screenerScanState.elapsedMs = screenerScanState.startedAt == null ? null : Date.now() - screenerScanState.startedAt;
}

export function getScreenerScanDiagnostics(): ScreenerScanDiagnostics {
  return { ...screenerScanState };
}

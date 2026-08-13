import { recordRequestDiagnostic, type RequestEndpoint } from './requestDiagnostics.ts';

export type DataFreshness = 'fresh' | 'stale' | 'expired';
export type RefreshMode = 'cache-first' | 'revalidate' | 'fresh';
export type RequestPriority = 'interactive' | 'user_refresh' | 'background_reuse' | 'bulk_manual';

export interface CacheRecord<T> {
  data: T;
  fetchedAt: number;
  softExpiresAt: number;
  hardExpiresAt: number;
  schemaVersion: number;
}

export interface MarketDataRequestMeta {
  freshness: DataFreshness;
  source: 'memory' | 'persistent' | 'network' | 'stale-fallback';
  fetchedAt: number;
  networkCall: boolean;
  deduped: boolean;
  staleFallbackUsed: boolean;
}

export interface MarketDataRequestResult<T> {
  data: T;
  meta: MarketDataRequestMeta;
}

interface MarketDataRequestOptions<T> {
  key: string;
  source: string;
  endpoint: RequestEndpoint;
  softTtlMs: number;
  hardTtlMs: number;
  schemaVersion: number;
  mode?: RefreshMode;
  priority?: RequestPriority;
  allowStaleOnError?: boolean;
  timeoutMs?: number;
  storage?: 'local' | 'session';
  validator: (data: T) => boolean;
  fetcher: (signal: AbortSignal) => Promise<T>;
}

interface ProviderHealth {
  consecutiveFailures: number;
  lastFailureAt: number | null;
  circuitOpenUntil: number | null;
}

const memoryCache = new Map<string, CacheRecord<unknown>>();
const inFlight = new Map<string, Promise<MarketDataRequestResult<unknown>>>();
const providerHealth = new Map<RequestEndpoint, ProviderHealth>();
const FAILURE_THRESHOLD = 3;
const CIRCUIT_COOLDOWN_MS = 45_000;

function getStorage(type: 'local' | 'session'): Storage | null {
  try {
    return type === 'session'
      ? typeof sessionStorage === 'undefined' ? null : sessionStorage
      : typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function freshnessOf(record: CacheRecord<unknown>, now = Date.now()): DataFreshness {
  if (now <= record.softExpiresAt) return 'fresh';
  if (now <= record.hardExpiresAt) return 'stale';
  return 'expired';
}

function isCacheRecord<T>(value: unknown): value is CacheRecord<T> {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<CacheRecord<T>>;
  return typeof record.fetchedAt === 'number'
    && typeof record.softExpiresAt === 'number'
    && typeof record.hardExpiresAt === 'number'
    && typeof record.schemaVersion === 'number'
    && 'data' in record;
}

function readRecord<T>(options: MarketDataRequestOptions<T>): { record: CacheRecord<T>; source: 'memory' | 'persistent' } | null {
  const memory = memoryCache.get(options.key) as CacheRecord<T> | undefined;
  if (memory && memory.schemaVersion === options.schemaVersion && options.validator(memory.data)) {
    return { record: memory, source: 'memory' };
  }
  if (memory) memoryCache.delete(options.key);

  const storage = getStorage(options.storage ?? 'local');
  if (!storage) return null;
  try {
    const raw = storage.getItem(options.key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    let record: CacheRecord<T> | null = null;
    if (isCacheRecord<T>(parsed)) {
      record = parsed;
    } else if (parsed && typeof parsed === 'object' && 'data' in parsed) {
      const legacy = parsed as { data: T; fetchedAt?: number; timestamp?: number };
      const fetchedAt = legacy.fetchedAt ?? legacy.timestamp;
      if (typeof fetchedAt === 'number') {
        record = {
          data: legacy.data,
          fetchedAt,
          softExpiresAt: fetchedAt + options.softTtlMs,
          hardExpiresAt: fetchedAt + options.hardTtlMs,
          schemaVersion: options.schemaVersion,
        };
      }
    }
    if (!record || record.schemaVersion !== options.schemaVersion || !options.validator(record.data)) {
      storage.removeItem(options.key);
      return null;
    }
    memoryCache.set(options.key, record);
    return { record, source: 'persistent' };
  } catch {
    try { storage.removeItem(options.key); } catch { /* ignore */ }
    return null;
  }
}

function writeRecord<T>(options: MarketDataRequestOptions<T>, data: T, fetchedAt = Date.now()): CacheRecord<T> {
  const record: CacheRecord<T> = {
    data,
    fetchedAt,
    softExpiresAt: fetchedAt + options.softTtlMs,
    hardExpiresAt: fetchedAt + options.hardTtlMs,
    schemaVersion: options.schemaVersion,
  };
  memoryCache.set(options.key, record);
  const storage = getStorage(options.storage ?? 'local');
  try { storage?.setItem(options.key, JSON.stringify(record)); } catch { /* storage full or unavailable */ }
  return record;
}

function healthFor(endpoint: RequestEndpoint): ProviderHealth {
  const health = providerHealth.get(endpoint) ?? { consecutiveFailures: 0, lastFailureAt: null, circuitOpenUntil: null };
  providerHealth.set(endpoint, health);
  return health;
}

function noteSuccess(endpoint: RequestEndpoint): void {
  providerHealth.set(endpoint, { consecutiveFailures: 0, lastFailureAt: null, circuitOpenUntil: null });
}

function noteFailure(endpoint: RequestEndpoint): void {
  const now = Date.now();
  const health = healthFor(endpoint);
  health.consecutiveFailures += 1;
  health.lastFailureAt = now;
  if (health.consecutiveFailures >= FAILURE_THRESHOLD) health.circuitOpenUntil = now + CIRCUIT_COOLDOWN_MS;
}

function isProviderFailure(error: unknown): boolean {
  const status = typeof error === 'object' && error !== null && 'status' in error
    ? Number((error as { status?: unknown }).status)
    : null;
  return status == null || !Number.isFinite(status) || status === 429 || status >= 500;
}

function resultFromRecord<T>(record: CacheRecord<T>, source: 'memory' | 'persistent' | 'stale-fallback', deduped = false): MarketDataRequestResult<T> {
  return {
    data: record.data,
    meta: {
      freshness: freshnessOf(record),
      source,
      fetchedAt: record.fetchedAt,
      networkCall: false,
      deduped,
      staleFallbackUsed: source === 'stale-fallback',
    },
  };
}

export function peekMarketData<T>(options: {
  key: string;
  softTtlMs: number;
  hardTtlMs: number;
  schemaVersion: number;
  validator: (data: T) => boolean;
  storage?: 'local' | 'session';
}): MarketDataRequestResult<T> | null {
  const cached = readRecord(options as MarketDataRequestOptions<T>);
  return cached ? resultFromRecord(cached.record, cached.source) : null;
}

export function clearMarketDataCache(key: string, storageType: 'local' | 'session' = 'local'): void {
  memoryCache.delete(key);
  try { getStorage(storageType)?.removeItem(key); } catch { /* ignore */ }
}

export async function requestMarketData<T>(options: MarketDataRequestOptions<T>): Promise<MarketDataRequestResult<T>> {
  const mode = options.mode ?? 'cache-first';
  const cached = readRecord(options);
  const cachedFreshness = cached ? freshnessOf(cached.record) : 'expired';
  recordRequestDiagnostic(options.endpoint, 'attempted', options.source);

  if (mode === 'cache-first' && cached && cachedFreshness !== 'expired') {
    recordRequestDiagnostic(options.endpoint, cached.source === 'memory' ? 'memoryHit' : 'persistentHit', options.source);
    return resultFromRecord(cached.record, cached.source);
  }

  const health = healthFor(options.endpoint);
  const circuitOpen = health.circuitOpenUntil != null && health.circuitOpenUntil > Date.now();
  if (circuitOpen && mode !== 'fresh') {
    if (cached && cachedFreshness !== 'expired' && options.allowStaleOnError !== false) {
      recordRequestDiagnostic(options.endpoint, 'staleFallback', options.source);
      return resultFromRecord(cached.record, 'stale-fallback');
    }
    throw new Error(`Market data temporarily unavailable for ${options.endpoint}; retry shortly.`);
  }

  const existing = inFlight.get(options.key) as Promise<MarketDataRequestResult<T>> | undefined;
  if (existing) {
    recordRequestDiagnostic(options.endpoint, 'deduped', options.source);
    const result = await existing;
    return { ...result, meta: { ...result.meta, deduped: true } };
  }

  const startedAt = Date.now();
  const promise = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 12_000);
    try {
      recordRequestDiagnostic(options.endpoint, 'network', options.source);
      const data = await options.fetcher(controller.signal);
      if (!options.validator(data)) throw new Error(`Invalid ${options.endpoint} response`);
      const record = writeRecord(options, data);
      noteSuccess(options.endpoint);
      recordRequestDiagnostic(options.endpoint, 'success', options.source, Date.now() - startedAt);
      return {
        data,
        meta: {
          freshness: 'fresh' as const,
          source: 'network' as const,
          fetchedAt: record.fetchedAt,
          networkCall: true,
          deduped: false,
          staleFallbackUsed: false,
        },
      };
    } catch (error) {
      if (isProviderFailure(error)) noteFailure(options.endpoint);
      recordRequestDiagnostic(options.endpoint, 'failure', options.source, Date.now() - startedAt);
      if (cached && cachedFreshness !== 'expired' && options.allowStaleOnError !== false) {
        recordRequestDiagnostic(options.endpoint, 'staleFallback', options.source);
        return resultFromRecord(cached.record, 'stale-fallback');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      inFlight.delete(options.key);
    }
  })();
  inFlight.set(options.key, promise as Promise<MarketDataRequestResult<unknown>>);
  return promise;
}

export function getMarketProviderHealth(): Record<string, ProviderHealth> {
  return Object.fromEntries([...providerHealth.entries()].map(([key, value]) => [key, { ...value }]));
}

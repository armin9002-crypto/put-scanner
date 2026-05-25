interface CacheEntry<T> {
  data: T;
  fetchedAt: number;
}

const memoryCache = new Map<string, CacheEntry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();

function getStorage(storageType: 'local' | 'session'): Storage | null {
  try {
    if (storageType === 'session') return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function makeCacheKey(parts: Array<string | number | null | undefined>): string {
  return parts.map(part => String(part ?? 'none')).join(':');
}

export function getCachedData<T>(
  key: string,
  ttlMs: number,
  options: {
    storage?: 'local' | 'session';
    validator?: (data: T) => boolean;
  } = {}
): T | null {
  const memHit = memoryCache.get(key);
  if (memHit && Date.now() - memHit.fetchedAt < ttlMs) {
    const data = memHit.data as T;
    if (!options.validator || options.validator(data)) return data;
    memoryCache.delete(key);
  }

  const storage = getStorage(options.storage ?? 'local');
  if (!storage) return null;

  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheEntry<T>;
    if (!parsed || typeof parsed.fetchedAt !== 'number' || Date.now() - parsed.fetchedAt > ttlMs) {
      storage.removeItem(key);
      return null;
    }
    if (options.validator && !options.validator(parsed.data)) {
      storage.removeItem(key);
      return null;
    }
    memoryCache.set(key, parsed);
    return parsed.data;
  } catch {
    try { storage.removeItem(key); } catch { /* ignore */ }
    return null;
  }
}

export function setCachedData<T>(
  key: string,
  data: T,
  options: { storage?: 'local' | 'session' } = {}
): void {
  const entry: CacheEntry<T> = { data, fetchedAt: Date.now() };
  memoryCache.set(key, entry);
  const storage = getStorage(options.storage ?? 'local');
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(entry));
  } catch {
    // Storage may be unavailable or full.
  }
}

export function clearCachedData(key: string, storage: 'local' | 'session' = 'local'): void {
  memoryCache.delete(key);
  const target = getStorage(storage);
  if (!target) return;
  try { target.removeItem(key); } catch { /* ignore */ }
}

export function dedupeRequest<T>(key: string, request: () => Promise<T>, bypass = false): Promise<T> {
  if (!bypass) {
    const existing = inFlight.get(key);
    if (existing) return existing as Promise<T>;
  }

  const promise = request().finally(() => {
    inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

export async function cachedRequest<T>(
  key: string,
  ttlMs: number,
  request: () => Promise<T>,
  options: {
    bypassCache?: boolean;
    storage?: 'local' | 'session';
    validator?: (data: T) => boolean;
  } = {}
): Promise<T> {
  if (!options.bypassCache) {
    const cached = getCachedData<T>(key, ttlMs, options);
    if (cached !== null) return cached;
  }

  return dedupeRequest(key, async () => {
    const data = await request();
    if (!options.validator || options.validator(data)) {
      setCachedData(key, data, options);
    }
    return data;
  }, options.bypassCache);
}

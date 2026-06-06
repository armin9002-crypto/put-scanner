type CacheRule = {
  prefix: string;
  ttlMs: number;
  timestampPaths: string[][];
};

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const CACHE_RULES: CacheRule[] = [
  { prefix: 'options_v2_', ttlMs: 2 * HOUR, timestampPaths: [['timestamp'], ['fetchedAt']] },
  { prefix: 'chart_history', ttlMs: 2 * DAY, timestampPaths: [['fetchedAt'], ['timestamp']] },
  { prefix: 'etf_pulse_rows', ttlMs: 12 * HOUR, timestampPaths: [['fetchedAt']] },
  { prefix: 'sparkline_', ttlMs: 2 * HOUR, timestampPaths: [['timestamp'], ['fetchedAt'], ['data', 'cachedAt']] },
  { prefix: 'extended_price_', ttlMs: 2 * HOUR, timestampPaths: [['timestamp'], ['fetchedAt']] },
  { prefix: 'price_cache', ttlMs: 2 * HOUR, timestampPaths: [['timestamp'], ['fetchedAt']] },
  { prefix: 'batch_prices', ttlMs: 2 * HOUR, timestampPaths: [['timestamp'], ['fetchedAt']] },
];

const LEGACY_CACHE_PREFIXES = ['trade_cockpit_scan_results'];

const LAST_CLEANUP_KEY = 'put_scanner_cache_cleanup_at';
const CLEANUP_INTERVAL_MS = 6 * HOUR;

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readPath(value: unknown, path: string[]): unknown {
  return path.reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function getTimestamp(value: unknown, rule: CacheRule): number | null {
  for (const path of rule.timestampPaths) {
    const timestamp = readPath(value, path);
    if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
      return timestamp;
    }
  }
  return null;
}

export function pruneExpiredAppCaches(now = Date.now()): number {
  const storage = getStorage();
  if (!storage) return 0;

  const lastCleanup = Number(storage.getItem(LAST_CLEANUP_KEY) || 0);
  if (Number.isFinite(lastCleanup) && now - lastCleanup < CLEANUP_INTERVAL_MS) {
    return 0;
  }

  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => key != null);
  let removed = 0;

  keys.forEach(key => {
    if (LEGACY_CACHE_PREFIXES.some(prefix => key.startsWith(prefix))) {
      storage.removeItem(key);
      removed += 1;
      return;
    }

    const rule = CACHE_RULES.find(candidate => key.startsWith(candidate.prefix));
    if (!rule) return;

    try {
      const raw = storage.getItem(key);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      const timestamp = getTimestamp(parsed, rule);
      if (timestamp == null || now - timestamp > rule.ttlMs) {
        storage.removeItem(key);
        removed += 1;
      }
    } catch {
      storage.removeItem(key);
      removed += 1;
    }
  });

  try {
    storage.setItem(LAST_CLEANUP_KEY, String(now));
  } catch {
    // Best effort only.
  }

  return removed;
}

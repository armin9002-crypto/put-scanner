const store: Record<string, { data: unknown; timestamp: number }> = {};

export function getMemCache<T = unknown>(key: string, ttlMs: number): T | null {
  const entry = store[key];
  if (entry && Date.now() - entry.timestamp < ttlMs) return entry.data as T;
  return null;
}

export function setMemCache<T>(key: string, data: T): void {
  store[key] = { data, timestamp: Date.now() };
}

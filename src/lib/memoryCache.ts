const store: Record<string, { data: any; timestamp: number }> = {};

export function getMemCache(key: string, ttlMs: number): any | null {
  const entry = store[key];
  if (entry && Date.now() - entry.timestamp < ttlMs) return entry.data;
  return null;
}

export function setMemCache(key: string, data: any): void {
  store[key] = { data, timestamp: Date.now() };
}

export function clearMemCache(key: string): void {
  delete store[key];
}

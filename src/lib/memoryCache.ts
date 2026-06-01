const store: Record<string, { data: unknown; timestamp: number }> = {};

export function getMemCache<T = unknown>(key: string, ttlMs: number): T | null {
  const entry = store[key];
  if (entry && Date.now() - entry.timestamp < ttlMs) return entry.data as T;
  return null;
}

export function setMemCache<T>(key: string, data: T): void {
  store[key] = { data, timestamp: Date.now() };
}

export function clearMemCache(key: string): void {
  delete store[key];
}

// Validate batch price data has at least 10 tickers with valid prices
export function isValidBatchPriceData(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false;
  const batch = data as Record<string, { price?: number | null; fiveDay?: number | null; oneMonth?: number | null; threeMonth?: number | null; fiftyTwoWeekHighPct?: number | null }>;
  const keys = Object.keys(batch);
  if (keys.length < 10) return false;
  const validCount = keys.filter(k => batch[k]?.price != null && Number(batch[k].price) > 0).length;
  const hasPerformanceFields = keys.some(k =>
    batch[k]?.fiveDay !== undefined &&
    batch[k]?.oneMonth !== undefined &&
    batch[k]?.threeMonth !== undefined &&
    batch[k]?.fiftyTwoWeekHighPct !== undefined
  );
  return validCount >= 10 && hasPerformanceFields;
}

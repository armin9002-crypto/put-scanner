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

// Validate batch price data has at least 5 tickers with valid prices
export function isValidBatchPriceData(data: any): boolean {
  if (!data || typeof data !== 'object') return false;
  const keys = Object.keys(data);
  if (keys.length < 5) return false;
  const validCount = keys.filter(k => data[k]?.price != null && data[k].price > 0).length;
  return validCount >= 5;
}

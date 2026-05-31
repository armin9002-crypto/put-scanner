import type { TradeScanResult } from './types';

const SCAN_CACHE_KEY = 'trade_cockpit_scan_results:v1';
const SCAN_CACHE_TTL = 30 * 60 * 1000;

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function loadCachedTradeScan(): TradeScanResult | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(SCAN_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || typeof parsed.fetchedAt !== 'number' || !Array.isArray(parsed.candidates)) return null;
    if (Date.now() - parsed.fetchedAt > SCAN_CACHE_TTL) return null;
    return parsed as unknown as TradeScanResult;
  } catch {
    return null;
  }
}

export function saveTradeScan(result: TradeScanResult): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(SCAN_CACHE_KEY, JSON.stringify(result));
  } catch {
    // Best-effort cache only.
  }
}

export function isTradeScanFresh(result: TradeScanResult | null): boolean {
  return result != null && Date.now() - result.fetchedAt <= SCAN_CACHE_TTL;
}

import { getChartHistory } from './chartHistory';
import { ETF_LIST } from './etfs';
import { buildEtfPulseRow, type EtfPulseRow } from './etfPulseMetrics';
import type { ETFInfo } from './types';

export interface EtfPulseLoadResult {
  rows: EtfPulseRow[];
  fetchedAt: number;
  total: number;
  loaded: number;
  failed: number;
  errors: Array<{ ticker: string; message: string }>;
}

export interface EtfPulseProgress {
  loaded: number;
  total: number;
  ticker?: string;
}

const ROW_CACHE_KEY = 'etf_pulse_rows:v2';
const ROW_CACHE_TTL = 6 * 60 * 60 * 1000;
const CONCURRENCY_LIMIT = 5;

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

function isValidPulseRow(value: unknown): value is EtfPulseRow {
  if (!isRecord(value)) return false;
  return typeof value.ticker === 'string' && typeof value.name === 'string' && isRecord(value.returns);
}

function isValidLoadResult(value: unknown): value is EtfPulseLoadResult {
  if (!isRecord(value)) return false;
  return typeof value.fetchedAt === 'number' &&
    Array.isArray(value.rows) &&
    value.rows.every(isValidPulseRow) &&
    typeof value.total === 'number' &&
    typeof value.loaded === 'number' &&
    typeof value.failed === 'number' &&
    Array.isArray(value.errors);
}

export function readEtfPulseRowsCache(): EtfPulseLoadResult | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(ROW_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isValidLoadResult(parsed)) return null;
    return Date.now() - parsed.fetchedAt < ROW_CACHE_TTL ? parsed : null;
  } catch {
    return null;
  }
}

function writeRowsCache(result: EtfPulseLoadResult): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(ROW_CACHE_KEY, JSON.stringify(result));
  } catch {
    // Best effort only.
  }
}

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];
  for (const task of tasks) {
    const promise = task().then(result => {
      results.push(result);
    });
    const tracked = promise.finally(() => {
      const index = executing.indexOf(tracked);
      if (index >= 0) executing.splice(index, 1);
    });
    executing.push(tracked);
    if (executing.length >= limit) await Promise.race(executing);
  }
  await Promise.all(executing);
  return results;
}

export function getEtfPulseUniverse(): ETFInfo[] {
  const byTicker = new Map<string, ETFInfo>();
  ETF_LIST.forEach(etf => byTicker.set(etf.ticker.toUpperCase(), { ...etf, ticker: etf.ticker.toUpperCase() }));
  byTicker.set('QQQ', {
    ticker: 'QQQ',
    name: 'Invesco QQQ Trust',
    leverage: '1x',
    underlying: 'Nasdaq 100',
    type: 'Broad Index',
  });
  byTicker.set('SPY', {
    ticker: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    leverage: '1x',
    underlying: 'S&P 500',
    type: 'Broad Index',
  });
  return [...byTicker.values()].sort((a, b) => a.ticker.localeCompare(b.ticker));
}

export async function fetchEtfPulseHistory(ticker: string, options: { forceRefresh?: boolean } = {}) {
  return getChartHistory(ticker, '2Y', { forceRefresh: options.forceRefresh });
}

export async function buildEtfPulseRows(options: {
  forceRefresh?: boolean;
  onProgress?: (progress: EtfPulseProgress) => void;
} = {}): Promise<EtfPulseLoadResult> {
  if (!options.forceRefresh) {
    const cached = readEtfPulseRowsCache();
    if (cached) return cached;
  }

  const universe = getEtfPulseUniverse();
  let completed = 0;
  const errors: Array<{ ticker: string; message: string }> = [];
  const tasks = universe.map(etf => async (): Promise<EtfPulseRow | null> => {
    try {
      const history = await fetchEtfPulseHistory(etf.ticker, { forceRefresh: options.forceRefresh });
      return buildEtfPulseRow(etf, history.points, history.latestPrice);
    } catch (error) {
      errors.push({ ticker: etf.ticker, message: error instanceof Error ? error.message : 'History unavailable' });
      return null;
    } finally {
      completed += 1;
      options.onProgress?.({ loaded: completed, total: universe.length, ticker: etf.ticker });
    }
  });

  const settled = await runWithConcurrency(tasks, CONCURRENCY_LIMIT);
  const rows = settled.filter((row): row is EtfPulseRow => row != null).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const result: EtfPulseLoadResult = {
    rows,
    fetchedAt: Date.now(),
    total: universe.length,
    loaded: rows.length,
    failed: errors.length,
    errors,
  };
  writeRowsCache(result);
  return result;
}

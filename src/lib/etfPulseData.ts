import { buildEtfPulseRow, withEtfPulseTechnicalAssessment, type EtfPulseAssessmentSourceRow, type EtfPulseRow } from './etfPulseMetrics.ts';
import type { ETFInfo } from './types.ts';
import type { ChartPoint } from './chartHistory.ts';
import { fetchObservedMarketData, recordRequestDiagnostic } from './requestDiagnostics.ts';
import { isAbortError } from './marketDataRequest.ts';
import { ETF_PULSE_TICKERS } from '../../shared/etfPulseUniverse.js';
import { ETF_PULSE_SYMBOLS } from '../../shared/symbolRegistry.js';
import { isUnderlyingTechnicalAssessment } from './underlyingTechnical.ts';

export interface EtfPulseLoadResult {
  rows: EtfPulseRow[];
  fetchedAt: number;
  total: number;
  loaded: number;
  failed: number;
  errors: Array<{ ticker: string; message: string }>;
  stale?: boolean;
  lastSuccessfulAt?: number;
}

export interface EtfPulseProgress {
  loaded: number;
  total: number;
  ticker?: string;
}

const ROW_CACHE_KEY = 'etf_pulse_rows:v3';
const LEGACY_ROW_CACHE_KEY = 'etf_pulse_rows:v2';
const ROW_CACHE_TTL = 6 * 60 * 60 * 1000;
const ROW_CACHE_HARD_TTL = 24 * 60 * 60 * 1000;

interface EtfPulseHistory {
  ticker: string;
  timeframe: '2Y';
  points: ChartPoint[];
  latestPrice: number | null;
  providerMarketTime?: number | null;
}

interface EtfPulseDataset {
  datasetVersion: number;
  fetchedAt: number;
  tickers: string[];
  histories: Record<string, EtfPulseHistory>;
  errors: Array<{ ticker: string; message: string }>;
}

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

function isValidLegacyPulseRow(value: unknown): value is EtfPulseAssessmentSourceRow {
  if (!isRecord(value)) return false;
  return typeof value.ticker === 'string'
    && typeof value.name === 'string'
    && isRecord(value.returns)
    && ('price' in value)
    && ('rsi14' in value)
    && ('realizedVolatility20' in value)
    && ('distance20' in value)
    && ('distance50' in value)
    && ('distance200' in value);
}

function isValidPulseRow(value: unknown): value is EtfPulseRow {
  return isValidLegacyPulseRow(value)
    && isRecord(value)
    && isUnderlyingTechnicalAssessment(value.technicalAssessment);
}

function isValidLegacyLoadResult(value: unknown): value is Omit<EtfPulseLoadResult, 'rows'> & { rows: EtfPulseAssessmentSourceRow[] } {
  if (!isRecord(value)) return false;
  return typeof value.fetchedAt === 'number'
    && Array.isArray(value.rows)
    && value.rows.every(isValidLegacyPulseRow)
    && typeof value.total === 'number'
    && typeof value.loaded === 'number'
    && typeof value.failed === 'number'
    && Array.isArray(value.errors);
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

export function readEtfPulseRowsCache(allowStale = false): EtfPulseLoadResult | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const maxAge = allowStale ? ROW_CACHE_HARD_TTL : ROW_CACHE_TTL;
    const raw = storage.getItem(ROW_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidLoadResult(parsed) && Date.now() - parsed.fetchedAt < maxAge) return parsed;
    }
    const legacyRaw = storage.getItem(LEGACY_ROW_CACHE_KEY);
    if (!legacyRaw) return null;
    const legacy = JSON.parse(legacyRaw);
    if (!isValidLegacyLoadResult(legacy) || Date.now() - legacy.fetchedAt >= maxAge) return null;
    const upgraded: EtfPulseLoadResult = {
      ...legacy,
      rows: legacy.rows.map(withEtfPulseTechnicalAssessment),
    };
    writeRowsCache(upgraded);
    return upgraded;
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

export function getEtfPulseUniverse(): ETFInfo[] {
  return ETF_PULSE_SYMBOLS.map(symbol => ({
    ticker: symbol.ticker,
    name: symbol.name,
    leverage: `${symbol.leverageMultiple}x`,
    underlying: symbol.exposure ?? symbol.name,
    type: symbol.etfCategory ?? 'Broad Index',
  }));
}

function isEtfPulseDataset(value: unknown): value is EtfPulseDataset {
  if (!isRecord(value) || value.datasetVersion !== 1 || typeof value.fetchedAt !== 'number' || !Array.isArray(value.tickers) || !isRecord(value.histories) || !Array.isArray(value.errors)) return false;
  const expectedTickers = new Set(ETF_PULSE_TICKERS);
  if (value.tickers.length !== expectedTickers.size || value.tickers.some(ticker => typeof ticker !== 'string' || !expectedTickers.has(ticker))) return false;
  if (!value.errors.every(error => isRecord(error) && typeof error.ticker === 'string' && typeof error.message === 'string')) return false;
  return Object.entries(value.histories).every(([ticker, history]) => expectedTickers.has(ticker)
    && isRecord(history)
    && history.ticker === ticker
    && history.timeframe === '2Y'
    && (history.latestPrice == null || typeof history.latestPrice === 'number')
    && (history.providerMarketTime == null || typeof history.providerMarketTime === 'number')
    && Array.isArray(history.points)
    && history.points.every(point => isRecord(point) && typeof point.timestamp === 'number' && typeof point.date === 'string' && typeof point.price === 'number'));
}

export async function fetchEtfPulseDataset(options: { forceRefresh?: boolean; signal?: AbortSignal } = {}): Promise<EtfPulseDataset> {
  const source = 'EtfPulse:dataset';
  const url = `/api/etf-pulse${options.forceRefresh ? `?fresh=1&_=${Date.now()}` : ''}`;
  recordRequestDiagnostic('etf-pulse', 'attempted', source);
  recordRequestDiagnostic('etf-pulse', 'network', source);
  const startedAt = Date.now();
  try {
    const response = await fetchObservedMarketData('etf-pulse', url, { ...(options.forceRefresh ? { cache: 'no-store' as RequestCache } : {}), signal: options.signal }, source);
    if (!response.ok) throw new Error('Failed to fetch ETF Pulse dataset');
    const data: unknown = await response.json();
    if (!isEtfPulseDataset(data)) throw new Error('Invalid ETF Pulse dataset response');
    recordRequestDiagnostic('etf-pulse', 'success', source, Date.now() - startedAt);
    return data;
  } catch (error) {
    recordRequestDiagnostic('etf-pulse', isAbortError(error) ? 'aborted' : 'failure', source, Date.now() - startedAt);
    throw error;
  }
}

export async function buildEtfPulseRows(options: {
  forceRefresh?: boolean;
  signal?: AbortSignal;
  onProgress?: (progress: EtfPulseProgress) => void;
} = {}): Promise<EtfPulseLoadResult> {
  const previous = readEtfPulseRowsCache(true);
  if (!options.forceRefresh) {
    const cached = readEtfPulseRowsCache(false);
    if (cached) return cached;
  }

  const universe = getEtfPulseUniverse();
  let dataset: EtfPulseDataset;
  try {
    dataset = await fetchEtfPulseDataset({ forceRefresh: options.forceRefresh, signal: options.signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (previous) {
      return {
        ...previous,
        failed: universe.length,
        stale: true,
        errors: [{ ticker: 'DATASET', message: error instanceof Error ? error.message : 'ETF Pulse refresh failed' }],
        lastSuccessfulAt: previous.lastSuccessfulAt ?? previous.fetchedAt,
      };
    }
    throw error;
  }
  let completed = 0;
  const errors = [...dataset.errors];
  const errorTickers = new Set(errors.map(error => error.ticker));
  const rows = universe.map((etf): EtfPulseRow | null => {
    try {
      const history = dataset.histories[etf.ticker];
      if (!history) {
        if (!errorTickers.has(etf.ticker)) errors.push({ ticker: etf.ticker, message: 'History unavailable' });
        return previous?.rows.find(row => row.ticker === etf.ticker) ?? null;
      }
      return buildEtfPulseRow(etf, history.points, history.latestPrice);
    } catch (error) {
      errors.push({ ticker: etf.ticker, message: error instanceof Error ? error.message : 'History unavailable' });
      return previous?.rows.find(row => row.ticker === etf.ticker) ?? null;
    } finally {
      completed += 1;
      options.onProgress?.({ loaded: completed, total: universe.length, ticker: etf.ticker });
    }
  });
  const validRows = rows.filter((row): row is EtfPulseRow => row != null).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const result: EtfPulseLoadResult = {
    rows: validRows,
    fetchedAt: dataset.fetchedAt,
    total: universe.length,
    loaded: validRows.length,
    failed: errors.length,
    errors,
    stale: errors.length > 0,
    lastSuccessfulAt: errors.length === 0 ? dataset.fetchedAt : previous?.lastSuccessfulAt ?? previous?.fetchedAt,
  };
  if (validRows.length > 0) writeRowsCache(result);
  return result;
}

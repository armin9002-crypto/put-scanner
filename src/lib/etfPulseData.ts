import { buildEtfPulseRow, type EtfPulseRow } from './etfPulseMetrics.ts';
import type { ETFInfo } from './types.ts';
import type { ChartPoint } from './chartHistory.ts';
import { fetchObservedMarketData, recordRequestDiagnostic } from './requestDiagnostics.ts';
import { isAbortError } from './marketDataRequest.ts';
import { ETF_PULSE_TICKERS } from '../../shared/etfPulseUniverse.js';
import { ETF_PULSE_SYMBOLS } from '../../shared/symbolRegistry.js';
import { isUnderlyingTechnicalAssessment } from './underlyingTechnical.ts';
import type { EvidenceFreshness } from './evidence.ts';

export interface EtfPulseRowEvidence {
  freshness: EvidenceFreshness;
  observedAt: number | null;
  source: 'network' | 'persistent' | 'snapshot' | 'unknown';
  retentionReason?: string | null;
}

export interface EtfPulseLoadResult {
  rows: EtfPulseRow[];
  fetchedAt: number;
  total: number;
  loaded: number;
  failed: number;
  errors: Array<{ ticker: string; message: string }>;
  stale?: boolean;
  lastSuccessfulAt?: number;
  currentRows?: number;
  retainedRows?: number;
  unavailableRows?: number;
  rowEvidence?: Record<string, EtfPulseRowEvidence>;
}

export interface EtfPulseProgress {
  loaded: number;
  total: number;
  ticker?: string;
  phase?: 'acquiring' | 'processing';
}

const ROW_CACHE_KEY = 'etf_pulse_rows:v5';
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

function isValidPulseRow(value: unknown): value is EtfPulseRow {
  if (!isRecord(value)) return false;
  return typeof value.ticker === 'string'
    && typeof value.name === 'string'
    && isRecord(value.returns)
    && ('price' in value)
    && ('rsi14' in value)
    && ('realizedVolatility20' in value)
    && ('distance20' in value)
    && ('distance50' in value)
    && ('distance200' in value)
    && isUnderlyingTechnicalAssessment(value.technicalAssessment);
}

function hasCurrentPulseUniverseShape(rows: Array<{ ticker: string }>, total: number): boolean {
  const expected = new Set(ETF_PULSE_TICKERS);
  const rowTickers = rows.map(row => row.ticker.trim().toUpperCase());
  return total === expected.size
    && new Set(rowTickers).size === rowTickers.length
    && rowTickers.every(ticker => expected.has(ticker));
}

function isValidLoadResult(value: unknown): value is EtfPulseLoadResult {
  if (!isRecord(value)) return false;
  if (!(typeof value.fetchedAt === 'number' &&
    Array.isArray(value.rows) &&
    value.rows.every(isValidPulseRow) &&
    typeof value.total === 'number' &&
    typeof value.loaded === 'number' &&
    typeof value.failed === 'number' &&
    Array.isArray(value.errors))) return false;
  return hasCurrentPulseUniverseShape(value.rows, value.total);
}

function normalizedCachedResult(result: EtfPulseLoadResult): EtfPulseLoadResult {
  const rowEvidence = Object.fromEntries(result.rows.map(row => {
    const prior = result.rowEvidence?.[row.ticker];
    return [row.ticker, prior?.freshness === 'retained-stale'
      ? { ...prior, source: 'snapshot' as const }
      : {
        freshness: 'cached-current' as const,
        observedAt: prior?.observedAt ?? result.fetchedAt,
        source: 'persistent' as const,
      }];
  }));
  return {
    ...result,
    loaded: result.currentRows ?? result.loaded,
    currentRows: result.currentRows ?? result.loaded,
    retainedRows: result.retainedRows ?? 0,
    unavailableRows: result.unavailableRows ?? result.failed,
    rowEvidence,
  };
}

export function readEtfPulseRowsCache(allowStale = false): EtfPulseLoadResult | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const maxAge = allowStale ? ROW_CACHE_HARD_TTL : ROW_CACHE_TTL;
    const raw = storage.getItem(ROW_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (isValidLoadResult(parsed) && Date.now() - parsed.fetchedAt < maxAge) return normalizedCachedResult(parsed);
    }
    return null;
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
  if (!isRecord(value) || value.datasetVersion !== 2 || typeof value.fetchedAt !== 'number' || !Array.isArray(value.tickers) || !isRecord(value.histories) || !Array.isArray(value.errors)) return false;
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
  const query = new URLSearchParams({ v: '2' });
  if (options.forceRefresh) {
    query.set('fresh', '1');
    query.set('_', String(Date.now()));
  }
  const url = `/api/etf-pulse?${query}`;
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
  options.onProgress?.({ loaded: 0, total: universe.length, phase: 'acquiring' });
  let dataset: EtfPulseDataset;
  try {
    dataset = await fetchEtfPulseDataset({ forceRefresh: options.forceRefresh, signal: options.signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (previous) {
      return {
        ...previous,
        failed: 0,
        loaded: 0,
        currentRows: 0,
        retainedRows: previous.rows.length,
        unavailableRows: 0,
        rowEvidence: Object.fromEntries(previous.rows.map(row => [row.ticker, {
          freshness: 'retained-stale' as const,
          observedAt: previous.rowEvidence?.[row.ticker]?.observedAt ?? previous.fetchedAt,
          source: 'snapshot' as const,
          retentionReason: 'ETF Pulse aggregate refresh failed; the prior row was retained.',
        }])),
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
  const rowEvidence: Record<string, EtfPulseRowEvidence> = {};
  const rows = universe.map((etf): EtfPulseRow | null => {
    try {
      const history = dataset.histories[etf.ticker];
      if (!history) {
        if (!errorTickers.has(etf.ticker)) errors.push({ ticker: etf.ticker, message: 'History unavailable' });
        const retained = previous?.rows.find(row => row.ticker === etf.ticker) ?? null;
        if (retained) rowEvidence[etf.ticker] = { freshness: 'retained-stale', observedAt: previous?.rowEvidence?.[etf.ticker]?.observedAt ?? previous?.fetchedAt ?? null, source: 'snapshot', retentionReason: 'No current history was returned; the prior row was retained.' };
        else rowEvidence[etf.ticker] = { freshness: 'unavailable', observedAt: null, source: 'unknown' };
        return retained;
      }
      rowEvidence[etf.ticker] = { freshness: 'current', observedAt: dataset.fetchedAt, source: 'network' };
      return buildEtfPulseRow(etf, history.points, history.latestPrice);
    } catch (error) {
      errors.push({ ticker: etf.ticker, message: error instanceof Error ? error.message : 'History unavailable' });
      const retained = previous?.rows.find(row => row.ticker === etf.ticker) ?? null;
      rowEvidence[etf.ticker] = retained
        ? { freshness: 'retained-stale', observedAt: previous?.rowEvidence?.[etf.ticker]?.observedAt ?? previous?.fetchedAt ?? null, source: 'snapshot', retentionReason: 'Current row processing failed; the prior row was retained.' }
        : { freshness: 'unavailable', observedAt: null, source: 'unknown' };
      return retained;
    } finally {
      completed += 1;
      options.onProgress?.({ loaded: completed, total: universe.length, ticker: etf.ticker, phase: 'processing' });
    }
  });
  const validRows = rows.filter((row): row is EtfPulseRow => row != null).sort((a, b) => a.ticker.localeCompare(b.ticker));
  const result: EtfPulseLoadResult = {
    rows: validRows,
    fetchedAt: dataset.fetchedAt,
    total: universe.length,
    loaded: validRows.filter(row => rowEvidence[row.ticker]?.freshness === 'current').length,
    failed: universe.filter(etf => rowEvidence[etf.ticker]?.freshness === 'unavailable').length,
    errors,
    stale: validRows.some(row => rowEvidence[row.ticker]?.freshness === 'retained-stale') || errors.length > 0,
    lastSuccessfulAt: errors.length === 0 ? dataset.fetchedAt : previous?.lastSuccessfulAt ?? previous?.fetchedAt,
    currentRows: validRows.filter(row => rowEvidence[row.ticker]?.freshness === 'current').length,
    retainedRows: validRows.filter(row => rowEvidence[row.ticker]?.freshness === 'retained-stale').length,
    unavailableRows: universe.filter(etf => rowEvidence[etf.ticker]?.freshness === 'unavailable').length,
    rowEvidence,
  };
  if (validRows.length > 0) writeRowsCache(result);
  return result;
}

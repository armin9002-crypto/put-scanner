import { SCREENER_TICKERS } from '../../shared/screenerUniverse.js';
import { calendarDateIso, calendarDaysBetween, usMarketDateIso } from '../../shared/marketDate.js';

export const SCREENER_EXPIRATION_EVIDENCE_CACHE_KEY = 'screener_expiration_availability_lkg_v4';
export const SCREENER_EXPIRATION_EVIDENCE_CACHE_TTL_SECONDS = 14 * 24 * 60 * 60;

function normalizedExpirationMap(value) {
  if (!value || typeof value !== 'object') return null;
  const result = {};
  for (const [rawTicker, dates] of Object.entries(value)) {
    const ticker = rawTicker.trim().toUpperCase();
    if (!ticker || Object.prototype.hasOwnProperty.call(result, ticker) || !Array.isArray(dates)
      || dates.some(date => !Number.isSafeInteger(date) || date <= 0)) return null;
    result[ticker] = [...new Set(dates)].sort((left, right) => left - right);
  }
  return result;
}

/** Only a complete, error-free response for the entire master universe is trusted. */
export function isStructurallyCompleteExpirationDataset(value) {
  if (!value || typeof value !== 'object' || value.datasetVersion !== 4 || value.complete !== true || !Number.isFinite(value.fetchedAt)
    || !Array.isArray(value.errors) || value.errors.length > 0) return false;
  const expirationsByTicker = normalizedExpirationMap(value.expirationsByTicker);
  if (!expirationsByTicker || Object.keys(expirationsByTicker).length !== SCREENER_TICKERS.length) return false;
  const expected = new Set(SCREENER_TICKERS);
  return Object.keys(expirationsByTicker).every(ticker => expected.has(ticker));
}

/** Re-evaluate listed dates against the current canonical market date at every read. */
export function filterExpiredScreenerExpirationDataset(value, nowMs = Date.now()) {
  const marketDate = usMarketDateIso(nowMs);
  const expirationsByTicker = normalizedExpirationMap(value?.expirationsByTicker) ?? {};
  const filtered = Object.fromEntries(Object.entries(expirationsByTicker).map(([ticker, dates]) => [ticker,
    marketDate
      ? dates.filter(date => (calendarDaysBetween(marketDate, calendarDateIso(date)) ?? -1) > 0)
      : [],
  ]));
  return { ...value, expirationsByTicker: filtered };
}

export async function readLastKnownGoodExpirationDataset(cache, nowMs = Date.now()) {
  if (!cache?.get) return null;
  try {
    const value = await cache.get(SCREENER_EXPIRATION_EVIDENCE_CACHE_KEY);
    return isStructurallyCompleteExpirationDataset(value)
      ? filterExpiredScreenerExpirationDataset(value, nowMs)
      : null;
  } catch {
    return null;
  }
}

export async function writeLastKnownGoodExpirationDataset(cache, value) {
  if (!cache?.get || !cache?.set || !isStructurallyCompleteExpirationDataset(value)) return false;
  try {
    const existing = await cache.get(SCREENER_EXPIRATION_EVIDENCE_CACHE_KEY);
    if (isStructurallyCompleteExpirationDataset(existing) && existing.fetchedAt > value.fetchedAt) return false;
    await cache.set(SCREENER_EXPIRATION_EVIDENCE_CACHE_KEY, value, {
      ttl: SCREENER_EXPIRATION_EVIDENCE_CACHE_TTL_SECONDS,
      tags: ['screener-expiration-availability'],
      name: 'screener-expiration-availability-last-known-good',
    });
    return true;
  } catch {
    return false;
  }
}

function retainedDataset(value, refreshErrors = [], nowMs = Date.now()) {
  const filtered = filterExpiredScreenerExpirationDataset(value, nowMs);
  return {
    ...filtered,
    complete: true,
    errors: [],
    refreshErrors,
    retainedFromLastKnownGood: true,
    retentionReason: `Using last-known-good optionability observed at ${new Date(value.fetchedAt).toISOString()}.`,
    refreshDiagnostics: value.diagnostics,
  };
}

function mergePartialWithRetained(current, retained, nowMs) {
  const currentDataset = filterExpiredScreenerExpirationDataset(current, nowMs);
  const retainedDatasetValue = filterExpiredScreenerExpirationDataset(retained, nowMs);
  const currentErrors = Array.isArray(current.errors) ? current.errors : [];
  const hasGlobalError = currentErrors.some(error => error?.ticker == null);
  const currentTickers = currentDataset.expirationsByTicker ?? {};
  const retainedExpirationsByTicker = {};
  const expirationsByTicker = {};
  for (const ticker of SCREENER_TICKERS) {
    const tickerError = currentErrors.some(error => error?.ticker?.trim?.().toUpperCase() === ticker);
    if (!hasGlobalError && !tickerError && Object.prototype.hasOwnProperty.call(currentTickers, ticker)) {
      // An explicit [] from a partial response is still authoritative for that ticker.
      expirationsByTicker[ticker] = currentTickers[ticker];
      continue;
    }
    const dates = retainedDatasetValue.expirationsByTicker?.[ticker];
    if (Array.isArray(dates) && dates.length > 0) {
      retainedExpirationsByTicker[ticker] = { dates, fetchedAt: retained.fetchedAt };
    }
  }
  return {
    ...currentDataset,
    expirationsByTicker,
    retainedExpirationsByTicker,
    retainedFromLastKnownGood: true,
    retentionReason: `Partial refresh retained last-known-good optionability observed at ${new Date(retained.fetchedAt).toISOString()}.`,
    refreshErrors: currentErrors,
    refreshDiagnostics: current.diagnostics,
  };
}

/** Resolve a request without making provider traffic when closed-market evidence is retained. */
export async function resolveScreenerExpirationDataset({ cache, freshRequested = false, nowMs = Date.now(), acquire }) {
  const retained = await readLastKnownGoodExpirationDataset(cache, nowMs);
  if (!freshRequested && retained) {
    return { dataset: retainedDataset(retained, [], nowMs), source: 'last-known-good', upstreamAttempted: false, upstreamRequests: 0 };
  }

  let current;
  try {
    current = await acquire();
  } catch (error) {
    if (retained) {
      return {
        dataset: retainedDataset(retained, [{ message: error instanceof Error ? error.message : 'Current expiration acquisition failed' }], nowMs),
        source: 'last-known-good',
        upstreamAttempted: true,
        upstreamRequests: 0,
      };
    }
    throw error;
  }

  if (isStructurallyCompleteExpirationDataset(current)) {
    await writeLastKnownGoodExpirationDataset(cache, current);
    return { dataset: filterExpiredScreenerExpirationDataset(current, nowMs), source: 'network-complete', upstreamAttempted: true, upstreamRequests: current.diagnostics?.upstreamRequests ?? 0 };
  }
  if (retained) {
    return { dataset: mergePartialWithRetained(current, retained, nowMs), source: 'last-known-good', upstreamAttempted: true, upstreamRequests: current.diagnostics?.upstreamRequests ?? 0 };
  }
  return { dataset: filterExpiredScreenerExpirationDataset(current, nowMs), source: 'network-partial', upstreamAttempted: true, upstreamRequests: current.diagnostics?.upstreamRequests ?? 0 };
}

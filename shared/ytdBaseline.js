import { usMarketDateIso } from './marketDate.js';

function finitePositive(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function timestampMs(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.abs(value) < 10_000_000_000 ? value * 1000 : value;
}

export function dailyObservationMarketDate(point) {
  if (!point || typeof point !== 'object') return null;
  const timestamp = timestampMs(point.timestamp);
  if (timestamp != null) return usMarketDateIso(timestamp);
  return typeof point.date === 'string' ? usMarketDateIso(point.date) : null;
}

function normalizedObservation(point) {
  if (!point || typeof point !== 'object' || !finitePositive(point.price)) return null;
  const marketDate = dailyObservationMarketDate(point);
  const timestamp = typeof point.timestamp === 'number' && Number.isFinite(point.timestamp) && point.timestamp > 0
    ? point.timestamp
    : null;
  if (!marketDate || timestamp == null) return null;
  return {
    marketDate,
    timestamp,
    date: typeof point.date === 'string' ? point.date : new Date(timestampMs(timestamp)).toISOString(),
    price: point.price,
  };
}

function isLaterProviderObservation(candidate, current) {
  const candidateTime = timestampMs(candidate.timestamp) ?? 0;
  const currentTime = timestampMs(current.timestamp) ?? 0;
  if (candidateTime !== currentTime) return candidateTime > currentTime;
  if (candidate.date !== current.date) return candidate.date > current.date;
  return candidate.price > current.price;
}

/**
 * Normalize daily provider observations to one valid positive close per New York market
 * date. The latest raw provider timestamp wins; exact-timestamp conflicts use stable
 * date/price tie-breakers and are never averaged.
 */
export function normalizeDailyHistory(points) {
  if (!Array.isArray(points)) return [];
  const byMarketDate = new Map();
  for (const point of points) {
    const candidate = normalizedObservation(point);
    if (!candidate) continue;
    const current = byMarketDate.get(candidate.marketDate);
    if (!current || isLaterProviderObservation(candidate, current)) {
      byMarketDate.set(candidate.marketDate, candidate);
    }
  }
  return [...byMarketDate.values()].sort((left, right) =>
    left.marketDate.localeCompare(right.marketDate) || left.timestamp - right.timestamp
  );
}

export function marketYearForAsOf(asOf = new Date()) {
  const marketDate = usMarketDateIso(asOf);
  if (!marketDate) return null;
  const year = Number(marketDate.slice(0, 4));
  return Number.isInteger(year) ? year : null;
}

export function resolveCanonicalYtdBaseline(points, asOf = new Date()) {
  const marketYear = marketYearForAsOf(asOf);
  if (marketYear == null) return null;
  const boundary = `${marketYear}-01-01`;
  return normalizeDailyHistory(points).filter(point => point.marketDate < boundary).at(-1) ?? null;
}

export function resolveCanonicalYtdEnd(points, asOf = new Date()) {
  const marketDate = usMarketDateIso(asOf);
  const marketYear = marketYearForAsOf(asOf);
  if (!marketDate || marketYear == null) return null;
  const boundary = `${marketYear}-01-01`;
  return normalizeDailyHistory(points)
    .filter(point => point.marketDate >= boundary && point.marketDate <= marketDate)
    .at(-1) ?? null;
}

function alignedObservation(leftPoints, rightPoints, predicate) {
  const leftByDate = new Map(normalizeDailyHistory(leftPoints).map(point => [point.marketDate, point]));
  const rightByDate = new Map(normalizeDailyHistory(rightPoints).map(point => [point.marketDate, point]));
  const marketDate = [...leftByDate.keys()]
    .filter(date => rightByDate.has(date) && predicate(date))
    .sort()
    .at(-1);
  return marketDate
    ? { marketDate, left: leftByDate.get(marketDate), right: rightByDate.get(marketDate) }
    : null;
}

export function resolveAlignedYtdBaselines(leftPoints, rightPoints, asOf = new Date()) {
  const marketYear = marketYearForAsOf(asOf);
  if (marketYear == null) return null;
  const boundary = `${marketYear}-01-01`;
  return alignedObservation(leftPoints, rightPoints, marketDate => marketDate < boundary);
}

export function resolveAlignedYtdEnds(leftPoints, rightPoints, asOf = new Date(), endAt = asOf) {
  const asOfMarketDate = usMarketDateIso(asOf);
  const endMarketDate = usMarketDateIso(endAt);
  const marketYear = marketYearForAsOf(asOf);
  if (!asOfMarketDate || !endMarketDate || marketYear == null) return null;
  const boundary = `${marketYear}-01-01`;
  const limit = endMarketDate < asOfMarketDate ? endMarketDate : asOfMarketDate;
  return alignedObservation(leftPoints, rightPoints, marketDate => marketDate >= boundary && marketDate <= limit);
}

/** Keep current-year display points distinct from pre-year calculation references. */
export function buildCanonicalYtdView(points, asOf = new Date()) {
  const asOfMarketDate = usMarketDateIso(asOf);
  const marketYear = marketYearForAsOf(asOf);
  if (!asOfMarketDate || marketYear == null) {
    return { marketYear: null, baseline: null, preYearPoints: [], points: [] };
  }
  const boundary = `${marketYear}-01-01`;
  const normalized = normalizeDailyHistory(points);
  return {
    marketYear,
    baseline: normalized.filter(point => point.marketDate < boundary).at(-1) ?? null,
    preYearPoints: normalized.filter(point => point.marketDate < boundary),
    points: normalized.filter(point => point.marketDate >= boundary && point.marketDate <= asOfMarketDate),
  };
}

import type { ChartPoint } from './chartHistory';

export interface TrueLeverageResult {
  etfReturn: number | null;
  proxyReturn: number | null;
  leverage: number | null;
  directionDiverged: boolean;
  startTimestamp: number | null;
  endTimestamp: number | null;
}

const MIN_PROXY_RETURN = 0.005;

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function calculateReturn(startPrice: number | null | undefined, endPrice: number | null | undefined): number | null {
  if (!isFiniteNumber(startPrice) || !isFiniteNumber(endPrice) || startPrice <= 0) return null;
  return endPrice / startPrice - 1;
}

export function calculateTrueLeverage(etfReturn: number | null | undefined, proxyReturn: number | null | undefined): number | null {
  if (!isFiniteNumber(etfReturn) || !isFiniteNumber(proxyReturn) || Math.abs(proxyReturn) < MIN_PROXY_RETURN) return null;
  const leverage = etfReturn / proxyReturn;
  return Number.isFinite(leverage) ? leverage : null;
}

function pointAtOrAfter(points: ChartPoint[], timestamp: number): ChartPoint | null {
  return points.find(point => point.timestamp >= timestamp) ?? points[points.length - 1] ?? null;
}

function pointAtOrBefore(points: ChartPoint[], timestamp: number): ChartPoint | null {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index].timestamp <= timestamp) return points[index];
  }
  return points[0] ?? null;
}

function nearestPoint(points: ChartPoint[], timestamp: number): ChartPoint | null {
  if (points.length === 0) return null;
  return points.reduce((nearest, point) =>
    Math.abs(point.timestamp - timestamp) < Math.abs(nearest.timestamp - timestamp) ? point : nearest
  );
}

function normalizeRange(startTimestamp: number, endTimestamp: number): { start: number; end: number } {
  return startTimestamp <= endTimestamp
    ? { start: startTimestamp, end: endTimestamp }
    : { start: endTimestamp, end: startTimestamp };
}

export function getTrueLeverageForPeriod(etfPoints: ChartPoint[], proxyPoints: ChartPoint[]): TrueLeverageResult {
  if (etfPoints.length < 2 || proxyPoints.length < 2) {
    return emptyResult();
  }

  const overlapStart = Math.max(etfPoints[0].timestamp, proxyPoints[0].timestamp);
  const overlapEnd = Math.min(etfPoints[etfPoints.length - 1].timestamp, proxyPoints[proxyPoints.length - 1].timestamp);
  if (overlapEnd <= overlapStart) return emptyResult();

  return getTrueLeverageForRange(etfPoints, proxyPoints, overlapStart, overlapEnd, 'overlap');
}

export function getTrueLeverageForRange(
  etfPoints: ChartPoint[],
  proxyPoints: ChartPoint[],
  startTimestamp: number,
  endTimestamp: number,
  mode: 'nearest' | 'overlap' = 'nearest'
): TrueLeverageResult {
  if (etfPoints.length < 2 || proxyPoints.length < 2) return emptyResult();
  const range = normalizeRange(startTimestamp, endTimestamp);

  const etfStart = mode === 'overlap' ? pointAtOrAfter(etfPoints, range.start) : nearestPoint(etfPoints, range.start);
  const etfEnd = mode === 'overlap' ? pointAtOrBefore(etfPoints, range.end) : nearestPoint(etfPoints, range.end);
  const proxyStart = mode === 'overlap' ? pointAtOrAfter(proxyPoints, range.start) : nearestPoint(proxyPoints, range.start);
  const proxyEnd = mode === 'overlap' ? pointAtOrBefore(proxyPoints, range.end) : nearestPoint(proxyPoints, range.end);

  if (!etfStart || !etfEnd || !proxyStart || !proxyEnd || etfStart.timestamp === etfEnd.timestamp || proxyStart.timestamp === proxyEnd.timestamp) {
    return emptyResult();
  }

  const etfReturn = calculateReturn(etfStart.price, etfEnd.price);
  const proxyReturn = calculateReturn(proxyStart.price, proxyEnd.price);
  const leverage = calculateTrueLeverage(etfReturn, proxyReturn);
  const directionDiverged = isFiniteNumber(etfReturn) && isFiniteNumber(proxyReturn) && etfReturn !== 0 && proxyReturn !== 0 && Math.sign(etfReturn) !== Math.sign(proxyReturn);

  return {
    etfReturn,
    proxyReturn,
    leverage,
    directionDiverged,
    startTimestamp: Math.max(etfStart.timestamp, proxyStart.timestamp),
    endTimestamp: Math.min(etfEnd.timestamp, proxyEnd.timestamp),
  };
}

function emptyResult(): TrueLeverageResult {
  return {
    etfReturn: null,
    proxyReturn: null,
    leverage: null,
    directionDiverged: false,
    startTimestamp: null,
    endTimestamp: null,
  };
}

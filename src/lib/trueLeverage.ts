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

  return getTrueLeverageForRange(etfPoints, proxyPoints, overlapStart, overlapEnd);
}

export function getTrueLeverageForRange(
  etfPoints: ChartPoint[],
  proxyPoints: ChartPoint[],
  startTimestamp: number,
  endTimestamp: number
): TrueLeverageResult {
  if (etfPoints.length < 2 || proxyPoints.length < 2) return emptyResult();
  const range = normalizeRange(startTimestamp, endTimestamp);
  const etfByTimestamp = new Map(etfPoints.map(point => [point.timestamp, point]));
  const commonPoints = proxyPoints
    .filter(point => point.timestamp >= range.start && point.timestamp <= range.end && etfByTimestamp.has(point.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (commonPoints.length < 2) return emptyResult();

  const proxyStart = commonPoints[0];
  const proxyEnd = commonPoints[commonPoints.length - 1];
  const etfStart = etfByTimestamp.get(proxyStart.timestamp)!;
  const etfEnd = etfByTimestamp.get(proxyEnd.timestamp)!;

  const etfReturn = calculateReturn(etfStart.price, etfEnd.price);
  const proxyReturn = calculateReturn(proxyStart.price, proxyEnd.price);
  const leverage = calculateTrueLeverage(etfReturn, proxyReturn);
  const directionDiverged = isFiniteNumber(etfReturn) && isFiniteNumber(proxyReturn) && etfReturn !== 0 && proxyReturn !== 0 && Math.sign(etfReturn) !== Math.sign(proxyReturn);

  return {
    etfReturn,
    proxyReturn,
    leverage,
    directionDiverged,
    startTimestamp: proxyStart.timestamp,
    endTimestamp: proxyEnd.timestamp,
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

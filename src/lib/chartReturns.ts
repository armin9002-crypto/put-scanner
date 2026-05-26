const ONE_DAY_SECONDS = 24 * 60 * 60;
const ONE_YEAR_DAYS = 365;

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function calculateSimpleReturn(startPrice: number | null | undefined, endPrice: number | null | undefined): { change: number | null; percent: number | null } {
  if (!isFiniteNumber(startPrice) || !isFiniteNumber(endPrice) || startPrice === 0) {
    return { change: null, percent: null };
  }
  const change = endPrice - startPrice;
  return { change, percent: (change / startPrice) * 100 };
}

export function shouldShowAnnualizedReturn(startTimestamp: number | null | undefined, endTimestamp: number | null | undefined): boolean {
  if (!isFiniteNumber(startTimestamp) || !isFiniteNumber(endTimestamp)) return false;
  const daysHeld = Math.abs(endTimestamp - startTimestamp) / ONE_DAY_SECONDS;
  return daysHeld > ONE_YEAR_DAYS;
}

export function calculateAnnualizedReturn(
  startPrice: number | null | undefined,
  endPrice: number | null | undefined,
  startTimestamp: number | null | undefined,
  endTimestamp: number | null | undefined
): number | null {
  if (!isFiniteNumber(startPrice) || !isFiniteNumber(endPrice) || startPrice <= 0 || endPrice <= 0) return null;
  if (!shouldShowAnnualizedReturn(startTimestamp, endTimestamp)) return null;

  const daysHeld = Math.abs((endTimestamp as number) - (startTimestamp as number)) / ONE_DAY_SECONDS;
  const years = daysHeld / ONE_YEAR_DAYS;
  const annualized = Math.pow(endPrice / startPrice, 1 / years) - 1;

  return Number.isFinite(annualized) ? annualized * 100 : null;
}

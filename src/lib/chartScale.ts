export interface YAxisScale {
  min: number;
  max: number;
  ticks: number[];
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function niceStep(rawStep: number): number {
  if (!isFiniteNumber(rawStep) || rawStep <= 0) return 1;

  const exponent = Math.floor(Math.log10(rawStep));
  const magnitude = 10 ** exponent;
  const normalized = rawStep / magnitude;

  if (normalized <= 1) return magnitude;
  if (normalized <= 2) return 2 * magnitude;
  if (normalized <= 2.5) return 2.5 * magnitude;
  if (normalized <= 5) return 5 * magnitude;
  return 10 * magnitude;
}

export function getNiceYAxisScale(values: number[], targetTicks = 5): YAxisScale | null {
  const finiteValues = values.filter(isFiniteNumber);
  if (finiteValues.length === 0) return null;

  let min = Math.min(...finiteValues);
  let max = Math.max(...finiteValues);
  if (min === max) {
    const padding = Math.max(Math.abs(min) * 0.02, 1);
    min -= padding;
    max += padding;
  }

  const rawRange = max - min;
  const paddedMin = min - rawRange * 0.08;
  const paddedMax = max + rawRange * 0.08;
  const step = niceStep((paddedMax - paddedMin) / Math.max(1, targetTicks - 1));
  const niceMin = Math.floor(paddedMin / step) * step;
  const niceMax = Math.ceil(paddedMax / step) * step;
  const ticks: number[] = [];

  for (let value = niceMin; value <= niceMax + step * 0.5; value += step) {
    ticks.push(Number(value.toFixed(8)));
  }

  return { min: niceMin, max: niceMax, ticks };
}

export function formatChartYAxisTick(value: number, kind: 'price' | 'volatility'): string {
  const abs = Math.abs(value);
  const decimals = abs < 10 && value % 1 !== 0 ? 2 : abs < 100 && value % 1 !== 0 ? 1 : 0;
  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  return kind === 'price' ? `$${formatted}` : formatted;
}

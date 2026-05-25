import { isFiniteNumber } from './optionMetrics';

export const EMPTY_VALUE = '—';

export function formatNullable(value: unknown, formatter: (value: number) => string): string {
  return isFiniteNumber(value) ? formatter(value) : EMPTY_VALUE;
}

export function formatCurrency(value: number | null | undefined, decimals = 2): string {
  return formatNullable(value, n => n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }));
}

export function formatOptionPrice(value: number | null | undefined): string {
  return formatNullable(value, n => n.toFixed(2));
}

export function formatNumber(value: number | null | undefined, decimals = 0): string {
  return formatNullable(value, n => n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }));
}

export function formatPercent(value: number | null | undefined, decimals = 2): string {
  return formatNullable(value, n => `${(n * 100).toFixed(decimals)}%`);
}

export function formatPercentPoints(value: number | null | undefined, decimals = 2): string {
  return formatNullable(value, n => `${n.toFixed(decimals)}%`);
}

export function formatSignedPercent(value: number | null | undefined, decimals = 2): string {
  return formatNullable(value, n => `${n >= 0 ? '+' : ''}${n.toFixed(decimals)}%`);
}

export function formatSignedCurrency(value: number | null | undefined, decimals = 2): string {
  return formatNullable(value, n => {
    const sign = n >= 0 ? '+' : '-';
    return `${sign}${formatCurrency(Math.abs(n), decimals)}`;
  });
}

export function formatDate(value: number | string | Date | null | undefined): string {
  if (value == null) return EMPTY_VALUE;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDte(value: number | null | undefined): string {
  return isFiniteNumber(value) ? `${value} DTE` : `${EMPTY_VALUE} DTE`;
}

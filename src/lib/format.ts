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

export function normalizeTimestampMs(value: number | null | undefined): number | null {
  if (!isFiniteNumber(value) || value <= 0) return null;
  const timestamp = value < 100_000_000_000 ? value * 1000 : value;
  return Number.isNaN(new Date(timestamp).getTime()) ? null : timestamp;
}

export function formatDateTime(value: number | null | undefined): string {
  const timestamp = normalizeTimestampMs(value);
  if (timestamp == null) return EMPTY_VALUE;
  return new Date(timestamp).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function formatRelativeAge(value: number | null | undefined, now = Date.now()): string {
  const timestamp = normalizeTimestampMs(value);
  if (timestamp == null) return EMPTY_VALUE;

  const diffMs = Math.max(0, now - timestamp);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diffMs < minute) return 'Just now';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)}m ago`;
  if (diffMs < day) {
    const hours = Math.floor(diffMs / hour);
    const minutes = Math.floor((diffMs % hour) / minute);
    return minutes > 0 ? `${hours}h ${minutes}m ago` : `${hours}h ago`;
  }
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)}d ago`;
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDte(value: number | null | undefined): string {
  return isFiniteNumber(value) ? `${value} DTE` : `${EMPTY_VALUE} DTE`;
}

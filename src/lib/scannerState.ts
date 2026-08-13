import type { ScannerLiquidityFilter, ScannerSort } from './scannerDiscovery.ts';

export interface ScannerState {
  search: string;
  leverage: string;
  type: string;
  expiration: string;
  sort: ScannerSort;
  liquidity: ScannerLiquidityFilter;
}

export const DEFAULT_SCANNER_STATE: ScannerState = {
  search: '',
  leverage: 'All',
  type: 'All',
  expiration: 'all',
  sort: 'default',
  liquidity: 'all',
};

const LEVERAGE_VALUES = new Set(['All', '2x', '3x']);
const TYPE_VALUES = new Set(['All', 'Broad Index', 'Sector', 'Commodity', 'Country']);
const SORT_VALUES = new Set<ScannerSort>(['default', 'iv60', 'liquidity', 'fiveDay', 'oneMonth', 'threeMonth', 'drawdown52w', 'priceHigh', 'priceLow']);
const LIQUIDITY_VALUES = new Set<ScannerLiquidityFilter>(['all', 'mediumPlus', 'liquidPlus']);

function expirationFromParam(value: string | null): string {
  if (!value || value === 'all' || value === 'lte_30dte') return value || 'all';
  if (/^date_\d+$/.test(value)) return value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return 'all';
  const timestamp = Date.parse(`${value}T00:00:00Z`) / 1000;
  return Number.isFinite(timestamp) ? `date_${timestamp}` : 'all';
}

function expirationToParam(value: string): string {
  if (!value.startsWith('date_')) return value;
  const timestamp = Number(value.slice(5));
  if (!Number.isFinite(timestamp)) return 'all';
  return new Date(timestamp * 1000).toISOString().slice(0, 10);
}

export function parseScannerState(params: URLSearchParams): ScannerState {
  const leverage = params.get('leverage');
  const type = params.get('type');
  const sort = params.get('sort') as ScannerSort | null;
  const liquidity = params.get('liquidity') as ScannerLiquidityFilter | null;
  return {
    search: params.get('q')?.trim() ?? '',
    leverage: leverage && LEVERAGE_VALUES.has(leverage) ? leverage : DEFAULT_SCANNER_STATE.leverage,
    type: type && TYPE_VALUES.has(type) ? type : DEFAULT_SCANNER_STATE.type,
    expiration: expirationFromParam(params.get('expiry')),
    sort: sort && SORT_VALUES.has(sort) ? sort : DEFAULT_SCANNER_STATE.sort,
    liquidity: liquidity && LIQUIDITY_VALUES.has(liquidity) ? liquidity : DEFAULT_SCANNER_STATE.liquidity,
  };
}

export function serializeScannerState(state: ScannerState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.search) params.set('q', state.search);
  if (state.leverage !== DEFAULT_SCANNER_STATE.leverage) params.set('leverage', state.leverage);
  if (state.type !== DEFAULT_SCANNER_STATE.type) params.set('type', state.type);
  if (state.expiration !== DEFAULT_SCANNER_STATE.expiration) params.set('expiry', expirationToParam(state.expiration));
  if (state.sort !== DEFAULT_SCANNER_STATE.sort) params.set('sort', state.sort);
  if (state.liquidity !== DEFAULT_SCANNER_STATE.liquidity) params.set('liquidity', state.liquidity);
  return params;
}

export function resolveScannerExpiration(value: string, availableDates: number[], hasShortDated = availableDates.length > 0): string {
  if (value === 'all') return value;
  if (value === 'lte_30dte') return hasShortDated ? value : 'all';
  const requested = value.startsWith('date_') ? Number(value.slice(5)) : NaN;
  if (!Number.isFinite(requested) || availableDates.length === 0) return 'all';
  if (availableDates.includes(requested)) return value;
  const nearest = availableDates.reduce((best, date) => (
    Math.abs(date - requested) < Math.abs(best - requested) ? date : best
  ));
  return `date_${nearest}`;
}

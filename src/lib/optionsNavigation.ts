import { normalizeAnalyzeTicker } from './tickerDetail.ts';
import { getLastScannerUrl, scannerFallbackPath } from './scannerNavigation.ts';

export const OPTIONS_ORIGIN_VERSION = 1 as const;

export type OptionsOriginKind =
  | 'scanner'
  | 'pulse'
  | 'screener'
  | 'watchlist'
  | 'portfolio'
  | 'recommendations';

export interface PulseOriginPresentation {
  search: string;
  leverageFilter: string;
  typeFilter: string;
  trendFilter: string;
  sortField: string;
  sortDirection: 'asc' | 'desc';
  selectedVisualPeriod: string;
  mobileVisual?: 'list' | 'heatmap' | 'momentum';
}

export interface ScreenerOriginPresentation {
  sortField: string;
  sortDir: 'asc' | 'desc';
  viewSignature: string;
}

export interface WatchlistOriginPresentation {
  sortField: string;
  sortDir: 'asc' | 'desc';
  sortOverrideField?: string | null;
  sortOverrideDirection?: 'asc' | 'desc' | null;
  groupMode: string;
  showNominalYields: boolean;
}

export interface PortfolioOriginPresentation {
  sortField: string;
  sortDir: 'asc' | 'desc';
  groupMode: string;
  mobileAnalytics: 'maturity' | 'ticker' | 'attention' | 'close';
  analyticsExpanded: boolean;
  mobileHistoryOpen: boolean;
}

export interface RecommendationsOriginPresentation {
  boardSort: string;
  showAllBoardRows: boolean;
}

export type OptionsOriginPresentation =
  | PulseOriginPresentation
  | ScreenerOriginPresentation
  | WatchlistOriginPresentation
  | PortfolioOriginPresentation
  | RecommendationsOriginPresentation;

export interface OptionsOriginDescriptor {
  version: typeof OPTIONS_ORIGIN_VERSION;
  kind: OptionsOriginKind;
  path: string;
  presentation?: OptionsOriginPresentation;
  stateKey?: string;
  scrollY?: number;
}

export interface OptionsNavigationState {
  optionsOrigin: OptionsOriginDescriptor;
}

export interface OptionsReturnState {
  optionsReturn: OptionsOriginDescriptor;
}

const ORIGIN_PATHS: Record<OptionsOriginKind, string> = {
  scanner: '/',
  pulse: '/pulse',
  screener: '/screener',
  watchlist: '/watchlist',
  portfolio: '/portfolio',
  recommendations: '/recommendations',
};

const ORIGIN_LABELS: Record<OptionsOriginKind, string> = {
  scanner: 'Scanner',
  pulse: 'ETF Pulse',
  screener: 'Screener',
  watchlist: 'Watchlist',
  portfolio: 'Portfolio',
  recommendations: 'Recommendations',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function isAllowedKind(value: unknown): value is OptionsOriginKind {
  return typeof value === 'string' && value in ORIGIN_PATHS;
}

function safeOriginPath(value: unknown, kind: OptionsOriginKind): string | null {
  if (typeof value !== 'string' || value.length > 120 || !value.startsWith('/')) return null;
  try {
    const url = new URL(value, 'https://scanner.local');
    if (url.origin !== 'https://scanner.local' || url.pathname !== ORIGIN_PATHS[kind]) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function boundedString(value: unknown, maxLength = 80): value is string {
  return typeof value === 'string' && value.length <= maxLength;
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

function validPresentation(kind: OptionsOriginKind, value: unknown): value is OptionsOriginPresentation {
  if (value == null) return true;
  if (!isRecord(value)) return false;
  if (kind === 'pulse') {
    return hasOnlyKeys(value, ['search', 'leverageFilter', 'typeFilter', 'trendFilter', 'sortField', 'sortDirection', 'selectedVisualPeriod', 'mobileVisual'])
      && boundedString(value.search)
      && boundedString(value.leverageFilter)
      && boundedString(value.typeFilter)
      && boundedString(value.trendFilter)
      && boundedString(value.sortField)
      && (value.sortDirection === 'asc' || value.sortDirection === 'desc')
      && boundedString(value.selectedVisualPeriod)
      && (value.mobileVisual == null || value.mobileVisual === 'list' || value.mobileVisual === 'heatmap' || value.mobileVisual === 'momentum');
  }
  if (kind === 'screener') {
    return hasOnlyKeys(value, ['sortField', 'sortDir', 'viewSignature'])
      && boundedString(value.sortField)
      && (value.sortDir === 'asc' || value.sortDir === 'desc')
      && boundedString(value.viewSignature, 140);
  }
  if (kind === 'watchlist') {
    return hasOnlyKeys(value, ['sortField', 'sortDir', 'sortOverrideField', 'sortOverrideDirection', 'groupMode', 'showNominalYields'])
      && boundedString(value.sortField)
      && (value.sortDir === 'asc' || value.sortDir === 'desc')
      && (value.sortOverrideField == null || boundedString(value.sortOverrideField))
      && (value.sortOverrideDirection == null || value.sortOverrideDirection === 'asc' || value.sortOverrideDirection === 'desc')
      && boundedString(value.groupMode)
      && typeof value.showNominalYields === 'boolean';
  }
  if (kind === 'portfolio') {
    return hasOnlyKeys(value, ['sortField', 'sortDir', 'groupMode', 'mobileAnalytics', 'analyticsExpanded', 'mobileHistoryOpen'])
      && boundedString(value.sortField)
      && (value.sortDir === 'asc' || value.sortDir === 'desc')
      && boundedString(value.groupMode)
      && (value.mobileAnalytics === 'maturity' || value.mobileAnalytics === 'ticker' || value.mobileAnalytics === 'attention' || value.mobileAnalytics === 'close')
      && typeof value.analyticsExpanded === 'boolean'
      && typeof value.mobileHistoryOpen === 'boolean';
  }
  if (kind === 'recommendations') {
    return hasOnlyKeys(value, ['boardSort', 'showAllBoardRows'])
      && boundedString(value.boardSort)
      && typeof value.showAllBoardRows === 'boolean';
  }
  return false;
}

export function parseOptionsOrigin(value: unknown): OptionsOriginDescriptor | null {
  if (!isRecord(value) || value.version !== OPTIONS_ORIGIN_VERSION || !isAllowedKind(value.kind)) return null;
  if (!hasOnlyKeys(value, ['version', 'kind', 'path', 'presentation', 'stateKey', 'scrollY'])) return null;
  const path = safeOriginPath(value.path, value.kind);
  if (!path || !validPresentation(value.kind, value.presentation)) return null;
  if (value.stateKey != null && !boundedString(value.stateKey, 80)) return null;
  if (value.scrollY != null && (typeof value.scrollY !== 'number' || !Number.isFinite(value.scrollY) || value.scrollY < 0 || value.scrollY > 10_000_000)) return null;
  return {
    version: OPTIONS_ORIGIN_VERSION,
    kind: value.kind,
    path,
    presentation: value.presentation as OptionsOriginPresentation | undefined,
    stateKey: value.stateKey as string | undefined,
    scrollY: value.scrollY as number | undefined,
  };
}

export function optionsOriginPath(kind: OptionsOriginKind, path?: string): string {
  return safeOriginPath(path ?? ORIGIN_PATHS[kind], kind) ?? ORIGIN_PATHS[kind];
}

export function createOptionsOrigin(
  kind: OptionsOriginKind,
  options: { path?: string; presentation?: OptionsOriginPresentation; stateKey?: string; scrollY?: number } = {},
): OptionsOriginDescriptor {
  const candidate = {
    version: OPTIONS_ORIGIN_VERSION,
    kind,
    path: optionsOriginPath(kind, options.path),
    presentation: options.presentation,
    stateKey: options.stateKey,
    scrollY: options.scrollY,
  };
  return parseOptionsOrigin(candidate) ?? {
    version: OPTIONS_ORIGIN_VERSION,
    kind,
    path: ORIGIN_PATHS[kind],
  };
}

export function createOptionsNavigationState(
  kind: OptionsOriginKind,
  options: { path?: string; presentation?: OptionsOriginPresentation; stateKey?: string; scrollY?: number } = {},
): OptionsNavigationState {
  return { optionsOrigin: createOptionsOrigin(kind, options) };
}

export function createOptionsReturnState(origin: OptionsOriginDescriptor): OptionsReturnState {
  return { optionsReturn: origin };
}

export function resolveOptionsReturnOrigin(value: unknown, kind: OptionsOriginKind): OptionsOriginDescriptor | null {
  if (!isRecord(value) || !('optionsReturn' in value)) return null;
  const origin = parseOptionsOrigin(value.optionsReturn);
  return origin?.kind === kind ? origin : null;
}

export function resolveOptionsOrigin(value: unknown): OptionsOriginDescriptor {
  if (isRecord(value) && 'optionsOrigin' in value) {
    const parsed = parseOptionsOrigin(value.optionsOrigin);
    if (parsed) return parsed;
  }
  // Prompt #4 Scanner links used this marker. Keep accepting it during migration.
  if (isRecord(value) && value.fromScanner === true) {
    return createOptionsOrigin('scanner', { path: getLastScannerUrl() });
  }
  return createOptionsOrigin('scanner', { path: getLastScannerUrl() });
}

export function optionsReturnLabel(kind: OptionsOriginKind): string {
  return `Back to ${ORIGIN_LABELS[kind]}`;
}

export function optionsOriginKindForPath(pathname: string): OptionsOriginKind {
  if (pathname === '/pulse' || pathname === '/cockpit') return 'pulse';
  if (pathname === '/screener') return 'screener';
  if (pathname === '/watchlist') return 'watchlist';
  if (pathname === '/portfolio') return 'portfolio';
  if (pathname === '/recommendations') return 'recommendations';
  return 'scanner';
}

export function normalizeOptionTicker(value: string): string {
  return normalizeAnalyzeTicker(value)?.ticker ?? value.trim().toUpperCase();
}

function isoFromTimestamp(timestamp: number): string | null {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  try {
    const iso = new Date(timestamp * 1_000).toISOString().slice(0, 10);
    const parsed = Date.parse(`${iso}T00:00:00Z`) / 1_000;
    return Number.isSafeInteger(parsed) && parsed === timestamp ? iso : null;
  } catch {
    return null;
  }
}

function parseCanonicalExpiry(value: string): number | null {
  if (/^\d+$/.test(value)) {
    const timestamp = Number(value);
    return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const timestamp = Date.parse(`${value}T00:00:00Z`) / 1_000;
  return Number.isSafeInteger(timestamp) && isoFromTimestamp(timestamp) === value ? timestamp : null;
}

export function normalizeOptionsExpiry(value: string | number | null | undefined): string | null {
  if (typeof value === 'number') return isoFromTimestamp(value);
  if (typeof value !== 'string' || value.length === 0) return null;
  const timestamp = parseCanonicalExpiry(value);
  return timestamp == null ? null : isoFromTimestamp(timestamp);
}

export function buildOptionsPath(ticker: string, expiry?: string | number | null): string {
  const normalizedTicker = normalizeOptionTicker(ticker);
  const base = `/options/${encodeURIComponent(normalizedTicker)}`;
  const canonicalExpiry = normalizeOptionsExpiry(expiry);
  return canonicalExpiry ? `${base}?expiry=${canonicalExpiry}` : base;
}

export function scannerFallbackOptionsPath(): string {
  return scannerFallbackPath(getLastScannerUrl());
}

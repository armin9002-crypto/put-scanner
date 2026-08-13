export const LAST_SCANNER_URL_KEY = 'put_scanner:last_url:v1';

export interface ScannerNavigationState {
  fromScanner: true;
}

export function isScannerNavigationState(value: unknown): value is ScannerNavigationState {
  return Boolean(value && typeof value === 'object' && (value as { fromScanner?: unknown }).fromScanner === true);
}

export function scannerFallbackPath(value: string | null | undefined): string {
  if (!value) return '/';
  try {
    const url = new URL(value, 'https://scanner.local');
    return url.origin === 'https://scanner.local' && url.pathname === '/'
      ? `${url.pathname}${url.search}${url.hash}`
      : '/';
  } catch {
    return '/';
  }
}

export function saveLastScannerUrl(path: string): void {
  try {
    sessionStorage.setItem(LAST_SCANNER_URL_KEY, scannerFallbackPath(path));
  } catch { /* session storage unavailable */ }
}

export function getLastScannerUrl(): string {
  try {
    return scannerFallbackPath(sessionStorage.getItem(LAST_SCANNER_URL_KEY));
  } catch {
    return '/';
  }
}

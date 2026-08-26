import { getSymbolMetadata } from '../../shared/symbolRegistry.js';

export function normalizeDisplayTicker(ticker: string): string {
  const normalized = ticker.trim().toUpperCase();
  if (normalized === '^VIX') return 'VIX';
  if (normalized === '^VXN') return 'VXN';
  return normalized;
}

export function getInstrumentName(ticker: string, displayTicker?: string): string | null {
  const candidates = [
    ticker.trim().toUpperCase(),
    normalizeDisplayTicker(ticker),
    displayTicker?.trim().toUpperCase() ?? '',
  ].filter(Boolean);

  for (const candidate of candidates) {
    const symbol = getSymbolMetadata(candidate);
    if (symbol) return symbol.name;
  }

  return null;
}

export function isVolatilityInstrument(ticker: string, displayTicker?: string): boolean {
  const normalized = normalizeDisplayTicker(displayTicker || ticker);
  return normalized === 'VIX' || normalized === 'VXN';
}

import { ETF_LIST } from './etfs';

const STATIC_INSTRUMENT_NAMES: Record<string, string> = {
  SPY: 'SPDR S&P 500 ETF Trust',
  QQQ: 'Invesco QQQ Trust',
  VIX: 'CBOE Volatility Index',
  VXN: 'CBOE Nasdaq-100 Volatility Index',
  '^VIX': 'CBOE Volatility Index',
  '^VXN': 'CBOE Nasdaq-100 Volatility Index',
};

const ETF_NAME_BY_TICKER = new Map(ETF_LIST.map(etf => [etf.ticker.toUpperCase(), etf.name]));

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
    const staticName = STATIC_INSTRUMENT_NAMES[candidate];
    if (staticName) return staticName;

    const etfName = ETF_NAME_BY_TICKER.get(candidate);
    if (etfName) return etfName;
  }

  return null;
}

export function isVolatilityInstrument(ticker: string, displayTicker?: string): boolean {
  const normalized = normalizeDisplayTicker(displayTicker || ticker);
  return normalized === 'VIX' || normalized === 'VXN';
}

import { resolvePutDelta } from './putDelta.ts';
import { canonicalOptionChainKey } from './optionChainRequests.ts';
import { calculateMoneyness, calculateYieldPercent } from './optionMetrics.ts';
import type { OptionsChainData } from './types.ts';

export interface ScreenerRow {
  ticker: string;
  currentPrice: number;
  expDate: number;
  expLabel: string;
  dte: number;
  strike: number;
  moneynessPct: number;
  moneynessLabel: string;
  moneynessColor: string;
  delta: number | null;
  bid: number | null;
  last: number | null;
  lastTradeDate: number | null;
  ask: number | null;
  iv: number | null;
  nomYieldBid: number | null;
  nomYieldAsk: number | null;
  nomYieldLast: number | null;
  annYieldBid: number | null;
  annYieldAsk: number | null;
  annYieldLast: number | null;
  volume: number | null;
  openInterest: number | null;
  volOI: number | null;
  ivVsRealizedRange: number | null;
}

export interface ScreenerFilterCriteria {
  deltaFilter: string;
  moneynessFilter: string;
  yieldFilter: string;
  oiFilter: string;
  volFilter: string;
  ivVsRealizedRangeFilter: string;
}

export interface ScreenerAcquiredData {
  initialResults: Map<string, OptionsChainData>;
  chainsByKey: Map<string, OptionsChainData>;
  ivVsRealizedRangeByTicker: Map<string, number | null>;
}

export interface ScreenerExpirationCandidate { date: number; dte: number }

function matchDeltaAbs(delta: number | null, filter: string): boolean {
  if (filter === 'all') return true;
  if (delta == null || !Number.isFinite(delta)) return false;
  const abs = Math.abs(delta);
  switch (filter) {
    case 'below_0.05': return abs < 0.05;
    case 'below_0.10': return abs < 0.10;
    case 'below_0.15': return abs < 0.15;
    case 'below_0.20': return abs < 0.20;
    case 'below_0.25': return abs < 0.25;
    case 'below_0.30': return abs < 0.30;
    case 'below_0.40': return abs < 0.40;
    case 'delta_0.05_to_0.10': return abs >= 0.05 && abs < 0.10;
    case '0.05_to_0.15': return abs >= 0.05 && abs <= 0.15;
    case '0.10_to_0.20': return abs >= 0.10 && abs <= 0.20;
    case '0.15_to_0.25': return abs >= 0.15 && abs <= 0.25;
    case '0.20_to_0.30': return abs >= 0.20 && abs <= 0.30;
    case '0.30_to_0.50': return abs >= 0.30 && abs <= 0.50;
    case 'above_0.50': return abs > 0.50;
    default: return true;
  }
}

function matchMoneyness(moneynessPct: number, filter: string): boolean {
  if (filter === 'all') return true;
  if (!Number.isFinite(moneynessPct)) return false;
  const isOTM = moneynessPct > 0;
  const isITM = moneynessPct < 0;
  const absM = Math.abs(moneynessPct);
  switch (filter) {
    case 'otm_only': return isOTM;
    case 'itm_only': return isITM;
    case '5+_otm': return isOTM && absM >= 5;
    case '10+_otm': return isOTM && absM >= 10;
    case '15+_otm': return isOTM && absM >= 15;
    case '20+_otm': return isOTM && absM >= 20;
    case '25+_otm': return isOTM && absM >= 25;
    case '30+_otm': return isOTM && absM >= 30;
    case '40+_otm': return isOTM && absM >= 40;
    case '50+_otm': return isOTM && absM >= 50;
    case '60+_otm': return isOTM && absM >= 60;
    case '0-10_otm': return isOTM && absM >= 0 && absM <= 10;
    case '10-20_otm': return isOTM && absM >= 10 && absM <= 20;
    case '20-30_otm': return isOTM && absM >= 20 && absM <= 30;
    case '30-40_otm': return isOTM && absM >= 30 && absM < 40;
    case '40-50_otm': return isOTM && absM >= 40 && absM < 50;
    case '50-60_otm': return isOTM && absM >= 50 && absM < 60;
    case 'any_itm': return isITM;
    case '0-10_itm': return isITM && absM >= 0 && absM <= 10;
    case '10+_itm': return isITM && absM >= 10;
    default: return true;
  }
}

function matchYield(value: number | null, filter: string): boolean {
  if (filter === 'all') return true;
  if (value == null || !Number.isFinite(value)) return false;
  switch (filter) {
    case '5_to_10': return value >= 5 && value < 10;
    case '5_to_15': return value >= 5 && value < 15;
    case '10_to_15': return value >= 10 && value < 15;
    case '10_to_20': return value >= 10 && value < 20;
    case '15_to_20': return value >= 15 && value < 20;
    default: {
      const threshold = Number.parseFloat(filter.replace('>', ''));
      return Number.isFinite(threshold) ? value > threshold : true;
    }
  }
}

function matchMinimum(value: number | null, filter: string): boolean {
  if (filter === 'all') return true;
  if (value == null || !Number.isFinite(value)) return false;
  const threshold = Number.parseFloat(filter.replace('>', ''));
  return Number.isFinite(threshold) ? value > threshold : true;
}

function matchIvVsRealizedRange(value: number | null, filter: string): boolean {
  if (filter === 'all') return true;
  if (value == null || !Number.isFinite(value)) return false;
  switch (filter) {
    case 'below_20': return value < 20;
    case 'below_40': return value < 40;
    case 'below_60': return value < 60;
    case 'above_50': return value >= 50;
    case 'above_70': return value >= 70;
    case 'above_80': return value >= 80;
    case 'above_90': return value >= 90;
    case '20_to_50': return value >= 20 && value <= 50;
    case '50_to_80': return value >= 50 && value <= 80;
    default: return true;
  }
}

export function applyScreenerFilters(rows: ScreenerRow[], criteria: ScreenerFilterCriteria): ScreenerRow[] {
  return rows.filter(row => matchDeltaAbs(row.delta, criteria.deltaFilter)
    && matchMoneyness(row.moneynessPct, criteria.moneynessFilter)
    && matchYield(row.annYieldBid, criteria.yieldFilter)
    && matchMinimum(row.openInterest, criteria.oiFilter)
    && matchMinimum(row.volume, criteria.volFilter)
    && matchIvVsRealizedRange(row.ivVsRealizedRange, criteria.ivVsRealizedRangeFilter));
}

export function getExpsToFetchForFilter(allExps: ScreenerExpirationCandidate[], expFilter: string): ScreenerExpirationCandidate[] {
  if (expFilter === 'all') return allExps.slice(0, 2);
  if (expFilter === 'lte_30dte') return allExps.filter(expiration => expiration.dte <= 30).slice(0, 2);
  if (expFilter.startsWith('date_')) {
    const targetDate = Number.parseInt(expFilter.replace('date_', ''), 10);
    return allExps.filter(expiration => expiration.date === targetDate);
  }
  return allExps.slice(0, 2);
}

export function collectScreenerExpirations(initialResults: Map<string, OptionsChainData>): ScreenerExpirationCandidate[] {
  const byDate = new Map<number, ScreenerExpirationCandidate>();
  initialResults.forEach(data => data.expirations.forEach(expiration => {
    if (!byDate.has(expiration.date)) byDate.set(expiration.date, { date: expiration.date, dte: expiration.dte });
  }));
  return [...byDate.values()].sort((a, b) => a.date - b.date);
}

export function formatScreenerExpiration(timestamp: number, dte: number): string {
  const date = new Date(timestamp * 1000);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  const year = String(date.getUTCFullYear() % 100).padStart(2, '0');
  return `${month}/${day}/${year} (${dte})`;
}

export function buildScreenerRows(data: ScreenerAcquiredData, expFilter: string): { rows: ScreenerRow[]; expirations: ScreenerExpirationCandidate[] } {
  const expirations = collectScreenerExpirations(data.initialResults);
  const rows: ScreenerRow[] = [];

  for (const [ticker, initialData] of data.initialResults) {
    const currentPrice = initialData.currentPrice;
    // "Nearest" is a per-ticker property. Selecting from the global union can
    // exclude a ticker whose own first two expirations differ from another
    // ticker's calendar, even though both chains were acquired successfully.
    const tickerExpirations = getExpsToFetchForFilter(initialData.expirations, expFilter);
    for (const expiration of tickerExpirations) {
      const chain = data.chainsByKey.get(canonicalOptionChainKey(ticker, expiration.date))
        ?? (expiration.date === initialData.expirations[0]?.date ? initialData : null);
      if (!chain) continue;
      const price = chain.currentPrice || currentPrice;
      // Preserve 0-DTE as 0. Yield annualization and model-Delta fallback are
      // intentionally unavailable at 0 DTE; provider Delta can still survive.
      const dte = Math.max(0, expiration.dte);
      for (const put of chain.puts) {
        const delta = resolvePutDelta({
          providerDelta: put.delta,
          underlyingPrice: price,
          strike: put.strike,
          dte,
          impliedVolatilityPercent: put.impliedVolatility,
        });

        const moneyness = calculateMoneyness(price, put.strike);
        const moneynessPct = moneyness.pct ?? 0;
        const moneynessLabel = moneyness.label === '—' ? '—' : moneyness.label.replace(/(\d+\.\d)%/, match => `${Number.parseFloat(match).toFixed(2)}%`);
        const bidYield = calculateYieldPercent(put.bid, put.strike, dte);
        const askYield = calculateYieldPercent(put.ask, put.strike, dte);
        const lastYield = calculateYieldPercent(put.last, put.strike, dte);
        const volOI = put.volume != null && put.volume > 0 && put.openInterest != null && put.openInterest > 0 ? put.volume / put.openInterest : null;

        rows.push({
          ticker,
          currentPrice: price,
          expDate: expiration.date,
          expLabel: formatScreenerExpiration(expiration.date, dte),
          dte,
          strike: put.strike,
          moneynessPct,
          moneynessLabel,
          moneynessColor: moneyness.color,
          delta,
          bid: put.bid,
          last: put.last,
          lastTradeDate: put.lastTradeDate,
          ask: put.ask,
          iv: put.impliedVolatility,
          nomYieldBid: bidYield.nominal,
          nomYieldAsk: askYield.nominal,
          nomYieldLast: lastYield.nominal,
          annYieldBid: bidYield.annualized,
          annYieldAsk: askYield.annualized,
          annYieldLast: lastYield.annualized,
          volume: put.volume,
          openInterest: put.openInterest,
          volOI,
          ivVsRealizedRange: data.ivVsRealizedRangeByTicker.get(ticker) ?? null,
        });
      }
    }
  }
  return { rows, expirations };
}

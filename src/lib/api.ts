import type { OptionsChainData, ExpirationDate, OptionContract } from './types';
import { threeLayerCache, clearLsCache, BATCH_PRICE_KEY, BATCH_PRICE_MEM_TTL, BATCH_PRICE_LS_TTL, SPARKLINE_MEM_TTL, SPARKLINE_LS_TTL, OPTIONS_MEM_TTL, OPTIONS_LS_TTL, EXTENDED_PRICE_MEM_TTL, EXTENDED_PRICE_LS_TTL } from './cache';
import type { BatchPriceData } from './cache';
import { clearMemCache, isValidBatchPriceData } from './memoryCache';

const API_BASE = '/api';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function calculateDTE(expirationTimestamp: number): number {
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const expiryDate = new Date(expirationTimestamp * 1000);
  const expiryUTC = Date.UTC(
    expiryDate.getUTCFullYear(),
    expiryDate.getUTCMonth(),
    expiryDate.getUTCDate()
  );
  const dte = Math.round((expiryUTC - todayUTC) / (1000 * 60 * 60 * 24));
  return Math.max(0, dte);
}

function formatExpirationLabel(timestamp: number, currentUtcYear: number): string {
  const d = new Date(timestamp * 1000);
  const monthDay = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
  const year = d.getUTCFullYear();
  return year !== currentUtcYear
    ? `${monthDay} '${String(year % 100).padStart(2, '0')}`
    : monthDay;
}

export async function fetchBatchPrices(tickers: string[]): Promise<BatchPriceData> {
  return threeLayerCache<BatchPriceData>(
    BATCH_PRICE_KEY,
    BATCH_PRICE_MEM_TTL,
    BATCH_PRICE_LS_TTL,
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      try {
        const res = await fetch(`${API_BASE}/prices?tickers=${encodeURIComponent(tickers.join(','))}`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error('Failed to fetch batch prices');
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        return data;
      } finally {
        clearTimeout(timeout);
      }
    },
    isValidBatchPriceData
  );
}

export function clearBatchPriceCache(): void {
  clearMemCache(BATCH_PRICE_KEY);
  clearLsCache(BATCH_PRICE_KEY);
}

export async function fetchOptions(ticker: string, date?: number): Promise<OptionsChainData> {
  const cacheKey = `options_v2_${ticker}_${date ?? 'initial'}`;
  return threeLayerCache<OptionsChainData>(
    cacheKey,
    OPTIONS_MEM_TTL,
    OPTIONS_LS_TTL,
    async () => {
      let url = `${API_BASE}/options?ticker=${encodeURIComponent(ticker)}`;
      if (date) url += `&date=${date}`;

      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to fetch options for ${ticker}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      const result = data?.optionChain?.result?.[0];
      if (!result) throw new Error('No options data available');

      const currentPrice = result.quote?.regularMarketPrice ?? 0;
      const expDates: number[] = result.expirationDates || [];

      const currentYear = new Date().getUTCFullYear();

      const expirations: ExpirationDate[] = expDates.map((ts: number) => {
        const dte = calculateDTE(ts);
        const label = formatExpirationLabel(ts, currentYear);
        return { date: ts, label, dte };
      });

      const putsRaw = result.options?.[0]?.puts || [];

      const puts: OptionContract[] = putsRaw
        .filter((p: any) => p.strike != null)
        .map((p: any) => {
          const yahooDelta = p.greeks?.delta ?? p.delta ?? null;
          const delta = yahooDelta != null && yahooDelta !== 0
            ? (yahooDelta > 0 ? -yahooDelta : yahooDelta)
            : null;

          let iv: number | null = null;
          const rawIv = p.impliedVolatility;
          if (rawIv != null && rawIv !== 0) {
            iv = rawIv > 5 ? rawIv : rawIv * 100;
          }

          return {
            strike: p.strike,
            last: p.lastPrice ?? null,
            bid: p.bid ?? null,
            ask: p.ask ?? null,
            delta,
            impliedVolatility: iv,
            volume: p.volume ?? null,
            openInterest: p.openInterest ?? null,
          };
        });

      return { expirations, puts, currentPrice };
    }
  );
}

function normalCDF(x: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

export function calculatePutDelta(S: number, K: number, T: number, r: number, sigma: number): number {
  if (T <= 0 || sigma <= 0) return -0.5;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  return normalCDF(d1) - 1;
}

export function blackScholesPutDelta(
  S: number, K: number, T: number, r: number, sigma: number
): number {
  return calculatePutDelta(S, K, T, r, sigma);
}

export function formatPrice(n: number | null): string {
  if (n == null) return '—';
  return n.toFixed(2);
}

export function formatYield(n: number): string {
  return n.toFixed(2) + '%';
}

export function yieldColor(annYield: number): string {
  if (annYield < 5) return '#64748b';
  if (annYield < 15) return '#eab308';
  if (annYield < 30) return '#f97316';
  return '#22c55e';
}

export function formatNumber(n: number | null): string {
  if (n == null || n === 0) return '—';
  return n.toLocaleString('en-US');
}

export interface SparklineData {
  price: number;
  change: number;
  changePercent: number;
  sparkline: number[];
  cachedAt?: number;
}

export async function fetchSparkline(ticker: string): Promise<SparklineData> {
  const cacheKey = `sparkline_${ticker}`;
  return threeLayerCache<SparklineData>(
    cacheKey,
    SPARKLINE_MEM_TTL,
    SPARKLINE_LS_TTL,
    async () => {
      const res = await fetch(`${API_BASE}/price?ticker=${encodeURIComponent(ticker)}&range=1d&interval=1m`);
      if (!res.ok) throw new Error(`Failed to fetch sparkline for ${ticker}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);

      return {
        price: data.price,
        change: data.change,
        changePercent: data.changePct,
        sparkline: data.sparkline || [],
      };
    }
  );
}

export interface ExtendedPriceData {
  price: number;
  change: number;
  changePercent: number;
  fiveDay: number | null;
  oneMonth: number | null;
  threeMonth: number | null;
  fiftyTwoWeekHighPct: number | null;
  sparkline: number[];
}

export async function fetchExtendedPrice(ticker: string): Promise<ExtendedPriceData> {
  const cacheKey = `extended_price_${ticker}`;
  return threeLayerCache<ExtendedPriceData>(
    cacheKey,
    EXTENDED_PRICE_MEM_TTL,
    EXTENDED_PRICE_LS_TTL,
    async () => {
      const res = await fetch(`${API_BASE}/price?ticker=${encodeURIComponent(ticker)}&extended=true`);
      if (!res.ok) throw new Error(`Failed to fetch extended price for ${ticker}`);
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      return {
        price: data.price,
        change: data.change,
        changePercent: data.changePct,
        fiveDay: data.fiveDay ?? null,
        oneMonth: data.oneMonth ?? null,
        threeMonth: data.threeMonth ?? null,
        fiftyTwoWeekHighPct: data.fiftyTwoWeekHighPct ?? null,
        sparkline: data.sparkline || [],
      };
    }
  );
}

export interface IVRankData {
  currentIV: number | null;
  ivRank: number | null;
  ivPercentile: number | null;
}

export async function fetchIVRank(ticker: string): Promise<IVRankData> {
  const res = await fetch(`${API_BASE}/ivrank?ticker=${encodeURIComponent(ticker)}`);
  if (!res.ok) throw new Error(`Failed to fetch IV Rank for ${ticker}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return {
    currentIV: data.currentIV ?? null,
    ivRank: data.ivRank ?? null,
    ivPercentile: data.ivPercentile ?? null,
  };
}

// Concurrency-limited fetch for screener (Opt 4)
export async function fetchWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit = 5
): Promise<PromiseSettledResult<T>[]> {
  const results: Promise<T>[] = [];
  const executing: Promise<void>[] = [];

  for (const task of tasks) {
    const p = task();
    results.push(p);
    const e: Promise<void> = p.then(() => {
      executing.splice(executing.indexOf(e), 1);
    }).catch(() => {
      executing.splice(executing.indexOf(e), 1);
    });
    executing.push(e);
    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.allSettled(results);
}

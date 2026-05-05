import type { PriceData, OptionsChainData, ExpirationDate, OptionContract } from './types';

const API_BASE = '/.netlify/functions';

export async function fetchPrice(ticker: string): Promise<PriceData> {
  const res = await fetch(`${API_BASE}/price?ticker=${encodeURIComponent(ticker)}`);
  if (!res.ok) throw new Error(`Failed to fetch price for ${ticker}`);
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return { price: data.price, change: data.change, changePercent: data.changePct };
}

export async function fetchOptions(ticker: string, date?: number): Promise<OptionsChainData> {
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

  const currentYear = new Date().getFullYear();

  const expirations: ExpirationDate[] = expDates.map((ts: number) => {
    const dte = Math.max(1, Math.ceil((ts * 1000 - Date.now()) / (1000 * 60 * 60 * 24)));
    const d = new Date(ts * 1000);
    const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const label = d.getFullYear() !== currentYear
      ? `${monthDay} '${String(d.getFullYear() % 100).padStart(2, '0')}`
      : monthDay;
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
}

export async function fetchSparkline(ticker: string): Promise<SparklineData> {
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

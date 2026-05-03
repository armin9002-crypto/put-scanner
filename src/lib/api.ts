import type { PriceData, OptionsChainData, ExpirationDate, OptionContract } from './types';

const API_BASE = '/api';

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

  const expirations: ExpirationDate[] = expDates.map((ts: number) => {
    const dte = Math.max(1, Math.ceil((ts * 1000 - Date.now()) / (1000 * 60 * 60 * 24)));
    const d = new Date(ts * 1000);
    const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { date: ts, label, dte };
  });

  const putsRaw = result.options?.[0]?.puts || [];

  const puts: OptionContract[] = putsRaw
    .filter((p: any) => p.strike != null)
    .map((p: any) => ({
      strike: p.strike,
      last: p.lastPrice ?? 0,
      bid: p.bid ?? 0,
      ask: p.ask ?? 0,
      delta: p.delta != null ? (p.delta > 0 ? -p.delta : p.delta) : null,
    }));

  return { expirations, puts, currentPrice };
}

export function blackScholesPutDelta(
  S: number, K: number, T: number, r: number, sigma: number
): number {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return -0.5;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const cdf = (x: number) => {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const sign = x < 0 ? -1 : 1;
    const t = 1 / (1 + p * Math.abs(x));
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x / 2);
    return 0.5 * (1 + sign * y);
  };
  return cdf(d1) - 1;
}

export function formatPrice(n: number): string {
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

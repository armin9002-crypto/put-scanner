import type { PriceData, OptionsChainData, ExpirationDate, OptionContract } from './types';

const TRADIER_TOKEN = 'YOUR_TOKEN_HERE';
const TRADIER_BASE = 'https://sandbox.tradier.com/v1';

const headers = {
  Authorization: `Bearer ${TRADIER_TOKEN}`,
  Accept: 'application/json',
};

export async function fetchPrice(ticker: string): Promise<PriceData> {
  const res = await fetch(`${TRADIER_BASE}/markets/quotes?symbols=${encodeURIComponent(ticker)}`, { headers });
  if (!res.ok) throw new Error(`Failed to fetch price for ${ticker}`);
  const data = await res.json();

  const quote = data?.quotes?.quote;
  if (!quote) throw new Error(`No quote data for ${ticker}`);

  const price = quote.last ?? 0;
  const change = quote.change ?? 0;
  const changePercent = quote.change_percentage ?? 0;

  return { price, change, changePercent };
}

export async function fetchOptions(ticker: string, date?: number): Promise<OptionsChainData> {
  const [expRes, quoteRes] = await Promise.all([
    fetch(`${TRADIER_BASE}/markets/options/expirations?symbol=${encodeURIComponent(ticker)}`, { headers }),
    fetch(`${TRADIER_BASE}/markets/quotes?symbols=${encodeURIComponent(ticker)}`, { headers }),
  ]);

  if (!expRes.ok) throw new Error('Failed to fetch expirations');
  if (!quoteRes.ok) throw new Error('Failed to fetch quote');

  const expData = await expRes.json();
  const quoteData = await quoteRes.json();

  const currentPrice = quoteData?.quotes?.quote?.last ?? 0;

  const dateStrings: string[] = expData?.expirations?.date || [];
  const expirations: ExpirationDate[] = dateStrings.map((ds: string) => {
    const expDate = new Date(ds + 'T00:00:00');
    const dte = Math.max(1, Math.ceil((expDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24)));
    const label = expDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return { date: Math.floor(expDate.getTime() / 1000), label, dte };
  });

  let selectedExp: ExpirationDate | undefined;
  if (date) {
    selectedExp = expirations.find(e => e.date === date);
  }
  if (!selectedExp && expirations.length > 0) {
    selectedExp = expirations[0];
  }

  let puts: OptionContract[] = [];
  if (selectedExp) {
    const expStr = new Date(selectedExp.date * 1000).toISOString().split('T')[0];
    const chainRes = await fetch(
      `${TRADIER_BASE}/markets/options/chains?symbol=${encodeURIComponent(ticker)}&expiration=${expStr}&greeks=true`,
      { headers }
    );
    if (chainRes.ok) {
      const chainData = await chainRes.json();
      const options: any[] = chainData?.options?.option || [];
      puts = options
        .filter((o: any) => o.option_type === 'put')
        .map((o: any) => ({
          strike: o.strike,
          last: o.last ?? 0,
          bid: o.bid ?? 0,
          ask: o.ask ?? 0,
          delta: o.greeks?.delta ?? null,
        }));
    }
  }

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

function normalCDF(value: number): number {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * absolute);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-absolute * absolute);
  return 0.5 * (1.0 + sign * y);
}

function positiveFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function calculatePutDelta(S: number, K: number, T: number, r: number, sigma: number): number | null {
  if (!positiveFinite(S) || !positiveFinite(K) || !positiveFinite(T) || !positiveFinite(sigma) || !Number.isFinite(r)) return null;
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const delta = normalCDF(d1) - 1;
  return Number.isFinite(delta) && delta >= -1 && delta <= 0 ? delta : null;
}

export function resolvePutDelta({
  providerDelta,
  underlyingPrice,
  strike,
  dte,
  impliedVolatilityPercent,
  riskFreeRate = 0.045,
}: {
  providerDelta: number | null | undefined;
  underlyingPrice: number | null | undefined;
  strike: number | null | undefined;
  dte: number | null | undefined;
  impliedVolatilityPercent: number | null | undefined;
  riskFreeRate?: number;
}): number | null {
  if (typeof dte === 'number' && Number.isFinite(dte) && dte < 0) return null;
  if (typeof providerDelta === 'number' && Number.isFinite(providerDelta) && Math.abs(providerDelta) <= 1) {
    return providerDelta > 0 ? -providerDelta : providerDelta;
  }
  if (!positiveFinite(underlyingPrice) || !positiveFinite(strike) || !positiveFinite(dte) || !positiveFinite(impliedVolatilityPercent)) return null;
  return calculatePutDelta(underlyingPrice, strike, dte / 365, riskFreeRate, impliedVolatilityPercent / 100);
}

export interface PortfolioContractIdentity {
  ticker: string;
  optionType: string;
  expiration: string;
  strike: number;
}

export function normalizePortfolioContractExpiration(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const timestamp = Date.parse(`${trimmed}T00:00:00Z`);
    if (Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === trimmed) return trimmed;
  }
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : trimmed;
}

export function normalizePortfolioContractStrike(value: number): string {
  return Number.isFinite(value) ? Number(value.toFixed(4)).toString() : String(value);
}

/** Stable exact-contract identity. Sold Date deliberately is not part of this key. */
export function makePortfolioContractKey(identity: PortfolioContractIdentity): string {
  const ticker = identity.ticker.trim().toUpperCase();
  const optionType = identity.optionType.trim().toLowerCase();
  const expiration = normalizePortfolioContractExpiration(identity.expiration);
  const strike = normalizePortfolioContractStrike(identity.strike);
  return `${ticker}|${optionType}|${expiration}|${strike}`;
}

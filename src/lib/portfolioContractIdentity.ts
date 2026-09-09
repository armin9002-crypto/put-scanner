export interface PortfolioContractIdentity {
  ticker: string;
  optionType: string;
  expiration: string;
  strike: number;
}

export type ExactOptionContractIdentity = PortfolioContractIdentity;

export function normalizePortfolioContractExpiration(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const timestamp = Date.parse(`${trimmed}T00:00:00Z`);
    if (Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === trimmed) return trimmed;
  }
  const timestamp = Date.parse(trimmed);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString().slice(0, 10) : trimmed;
}

/** Shared exact-contract strike serialization. Keep the established four-decimal rounding. */
export function serializeExactOptionContractStrike(value: number): string {
  return Number(value.toFixed(4)).toString();
}

/** Shared final serializer; expiration must already satisfy the caller's compatibility adapter. */
export function buildExactOptionContractKey(identity: ExactOptionContractIdentity): string {
  const ticker = identity.ticker.trim().toUpperCase();
  const optionType = identity.optionType.trim().toLowerCase();
  const strike = serializeExactOptionContractStrike(identity.strike);
  return `${ticker}|${optionType}|${identity.expiration}|${strike}`;
}

export function normalizePortfolioContractStrike(value: number): string {
  return Number.isFinite(value) ? serializeExactOptionContractStrike(value) : String(value);
}

/** Stable exact-contract identity. Sold Date deliberately is not part of this key. */
export function makePortfolioContractKey(identity: PortfolioContractIdentity): string {
  const expiration = normalizePortfolioContractExpiration(identity.expiration);
  if (!Number.isFinite(identity.strike)) {
    return `${identity.ticker.trim().toUpperCase()}|${identity.optionType.trim().toLowerCase()}|${expiration}|${String(identity.strike)}`;
  }
  return buildExactOptionContractKey({ ...identity, expiration });
}

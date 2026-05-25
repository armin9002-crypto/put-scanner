export interface MoneynessMetrics {
  pct: number | null;
  label: string;
  color: string;
  state: 'itm' | 'otm' | 'atm' | 'unknown';
}

export interface YieldMetrics {
  nominal: number | null;
  annualized: number | null;
}

export interface PositionMetrics {
  totalPremium: number | null;
  equityAtRisk: number | null;
  maximumLoss: number | null;
  breakeven: number | null;
  netCapitalAtRisk: number | null;
  returnOnRisk: number | null;
  annualizedReturn: number | null;
  downsideCushion: number | null;
}

export interface OptionQuoteLike {
  strike: number;
  bid?: number | null;
  ask?: number | null;
  last?: number | null;
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function sanitizePositive(value: number | null | undefined, allowZero = false): number | null {
  if (!isFiniteNumber(value)) return null;
  if (allowZero ? value < 0 : value <= 0) return null;
  return value;
}

export function calculateDte(expiration: number | string | Date | null | undefined): number | null {
  if (expiration == null) return null;

  let expiryUTC: number | null = null;
  if (typeof expiration === 'number' && Number.isFinite(expiration)) {
    const date = new Date(expiration > 100000000000 ? expiration : expiration * 1000);
    expiryUTC = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  } else if (typeof expiration === 'string') {
    const match = expiration.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const [, year, month, day] = match;
      expiryUTC = Date.UTC(Number(year), Number(month) - 1, Number(day));
    } else {
      const parsed = new Date(expiration);
      if (!Number.isNaN(parsed.getTime())) {
        expiryUTC = Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate());
      }
    }
  } else if (expiration instanceof Date && !Number.isNaN(expiration.getTime())) {
    expiryUTC = Date.UTC(expiration.getUTCFullYear(), expiration.getUTCMonth(), expiration.getUTCDate());
  }

  if (expiryUTC == null) return null;
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((expiryUTC - todayUTC) / (1000 * 60 * 60 * 24));
}

export function calculateMoneyness(underlyingPrice: number | null | undefined, strike: number | null | undefined): MoneynessMetrics {
  const underlying = sanitizePositive(underlyingPrice);
  const validStrike = sanitizePositive(strike);
  if (underlying == null || validStrike == null) {
    return { pct: null, label: '—', color: 'var(--text-dim)', state: 'unknown' };
  }

  const signedPct = ((underlying - validStrike) / underlying) * 100;
  const absPct = Math.abs(signedPct);
  if (absPct < 0.5) {
    return { pct: signedPct, label: 'ATM', color: 'var(--yellow)', state: 'atm' };
  }
  if (validStrike < underlying) {
    return { pct: signedPct, label: `${absPct.toFixed(1)}% OTM`, color: 'var(--red)', state: 'otm' };
  }
  return { pct: signedPct, label: `${absPct.toFixed(1)}% ITM`, color: 'var(--green)', state: 'itm' };
}

export function calculateBreakeven(strike: number | null | undefined, optionPrice: number | null | undefined): number | null {
  const validStrike = sanitizePositive(strike);
  const price = sanitizePositive(optionPrice, true);
  return validStrike != null && price != null ? validStrike - price : null;
}

export function calculatePremiumPerContract(optionPrice: number | null | undefined): number | null {
  const price = sanitizePositive(optionPrice, true);
  return price != null ? price * 100 : null;
}

export function calculateTotalPremium(optionPrice: number | null | undefined, contracts: number | null | undefined): number | null {
  const premium = calculatePremiumPerContract(optionPrice);
  const validContracts = Number.isInteger(contracts) && isFiniteNumber(contracts) && contracts >= 1 ? contracts : null;
  return premium != null && validContracts != null ? premium * validContracts : null;
}

export function calculateEquityAtRisk(strike: number | null | undefined, contracts: number | null | undefined): number | null {
  const validStrike = sanitizePositive(strike);
  const validContracts = Number.isInteger(contracts) && isFiniteNumber(contracts) && contracts >= 1 ? contracts : null;
  return validStrike != null && validContracts != null ? validStrike * 100 * validContracts : null;
}

export function calculateMaxLoss(strike: number | null | undefined, optionPrice: number | null | undefined, contracts: number | null | undefined): number | null {
  const equityAtRisk = calculateEquityAtRisk(strike, contracts);
  const totalPremium = calculateTotalPremium(optionPrice, contracts);
  return equityAtRisk != null && totalPremium != null ? equityAtRisk - totalPremium : null;
}

export function calculateNetCapitalAtRisk(strike: number | null | undefined, optionPrice: number | null | undefined, contracts: number | null | undefined): number | null {
  return calculateMaxLoss(strike, optionPrice, contracts);
}

export function calculateNominalYield(optionPrice: number | null | undefined, strike: number | null | undefined): number | null {
  const price = sanitizePositive(optionPrice);
  const validStrike = sanitizePositive(strike);
  return price != null && validStrike != null ? price / validStrike : null;
}

export function calculateAnnualizedYield(optionPrice: number | null | undefined, strike: number | null | undefined, dte: number | null | undefined): number | null {
  const nominal = calculateNominalYield(optionPrice, strike);
  return nominal != null && isFiniteNumber(dte) && dte > 0 ? nominal * (365 / dte) : null;
}

export function calculateYieldPercent(optionPrice: number | null | undefined, strike: number | null | undefined, dte: number | null | undefined): YieldMetrics {
  const nominal = calculateNominalYield(optionPrice, strike);
  const annualized = calculateAnnualizedYield(optionPrice, strike, dte);
  return {
    nominal: nominal != null ? nominal * 100 : null,
    annualized: annualized != null ? annualized * 100 : null,
  };
}

export function calculateDownsideCushion(underlyingPrice: number | null | undefined, breakevenPrice: number | null | undefined): number | null {
  const underlying = sanitizePositive(underlyingPrice);
  return underlying != null && isFiniteNumber(breakevenPrice)
    ? (underlying - breakevenPrice) / underlying
    : null;
}

export function calculateBidAskSpread(bid: number | null | undefined, ask: number | null | undefined): number | null {
  const validBid = sanitizePositive(bid, true);
  const validAsk = sanitizePositive(ask, true);
  return validBid != null && validAsk != null && validAsk >= validBid ? validAsk - validBid : null;
}

export function calculateBidAskSpreadPercent(bid: number | null | undefined, ask: number | null | undefined): number | null {
  const spread = calculateBidAskSpread(bid, ask);
  const validBid = sanitizePositive(bid, true);
  const validAsk = sanitizePositive(ask, true);
  const mid = validBid != null && validAsk != null ? (validBid + validAsk) / 2 : null;
  return spread != null && mid != null && mid > 0 ? spread / mid : null;
}

export function calculatePositionMetrics({
  strike,
  soldPrice,
  contracts,
  dte,
  underlyingPrice,
}: {
  strike: number | null | undefined;
  soldPrice: number | null | undefined;
  contracts: number | null | undefined;
  dte: number | null | undefined;
  underlyingPrice?: number | null;
}): PositionMetrics {
  const totalPremium = calculateTotalPremium(soldPrice, contracts);
  const equityAtRisk = calculateEquityAtRisk(strike, contracts);
  const maximumLoss = calculateMaxLoss(strike, soldPrice, contracts);
  const breakeven = calculateBreakeven(strike, soldPrice);
  const netCapitalAtRisk = calculateNetCapitalAtRisk(strike, soldPrice, contracts);
  const returnOnRisk = totalPremium != null && netCapitalAtRisk != null && netCapitalAtRisk > 0
    ? totalPremium / netCapitalAtRisk
    : null;
  const annualizedReturn = returnOnRisk != null && isFiniteNumber(dte) && dte > 0
    ? returnOnRisk * (365 / dte)
    : null;

  return {
    totalPremium,
    equityAtRisk,
    maximumLoss,
    breakeven,
    netCapitalAtRisk,
    returnOnRisk,
    annualizedReturn,
    downsideCushion: calculateDownsideCushion(underlyingPrice, breakeven),
  };
}

export function calculateOptionMetrics(option: OptionQuoteLike, underlyingPrice: number | null | undefined, dte: number | null | undefined) {
  const mid = sanitizePositive(option.bid, true) != null && sanitizePositive(option.ask, true) != null
    ? ((option.bid as number) + (option.ask as number)) / 2
    : null;
  const optionPrice = mid ?? sanitizePositive(option.last, true);
  const breakeven = calculateBreakeven(option.strike, optionPrice);

  return {
    mid,
    optionPrice,
    premiumPerContract: calculatePremiumPerContract(optionPrice),
    breakeven,
    downsideCushion: calculateDownsideCushion(underlyingPrice, breakeven),
    simpleYield: calculateNominalYield(optionPrice, option.strike),
    annualizedYield: calculateAnnualizedYield(optionPrice, option.strike, dte),
    bidAskSpread: calculateBidAskSpread(option.bid, option.ask),
    bidAskSpreadPercent: calculateBidAskSpreadPercent(option.bid, option.ask),
    moneyness: calculateMoneyness(underlyingPrice, option.strike),
  };
}

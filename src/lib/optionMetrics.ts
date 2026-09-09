import { calendarDateIso, calendarDaysBetween, usMarketDateIso } from './usMarketCalendar.ts';
import { shortPutMoneynessPresentation, type ShortPutMoneynessState } from './moneynessPresentation.ts';

export interface MoneynessMetrics {
  pct: number | null;
  label: string;
  color: string;
  state: ShortPutMoneynessState;
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

export function calculateVolumeOpenInterestRatio(volume: unknown, openInterest: unknown): number | null {
  if (!isFiniteNumber(volume) || volume < 0 || !isFiniteNumber(openInterest) || openInterest <= 0) return null;
  const ratio = volume / openInterest;
  return isFiniteNumber(ratio) ? ratio : null;
}

/** Put Scanner's canonical simple 365-calendar-day annualization convention. */
export function calculateSimpleAnnualizedValue(value: number | null | undefined, calendarDays: number | null | undefined): number | null {
  if (!isFiniteNumber(value) || !isFiniteNumber(calendarDays) || calendarDays <= 0) return null;
  const annualized = value * (365 / calendarDays);
  return isFiniteNumber(annualized) ? annualized : null;
}

export function calculateDte(
  expiration: number | string | Date | null | undefined,
  asOf: number | string | Date = new Date(),
): number | null {
  const expirationDate = calendarDateIso(expiration);
  const marketDate = usMarketDateIso(asOf);
  return expirationDate == null || marketDate == null
    ? null
    : calendarDaysBetween(marketDate, expirationDate);
}

export function calculateMoneyness(underlyingPrice: number | null | undefined, strike: number | null | undefined): MoneynessMetrics {
  const underlying = sanitizePositive(underlyingPrice);
  const validStrike = sanitizePositive(strike);
  if (underlying == null || validStrike == null) {
    return { pct: null, label: '—', color: shortPutMoneynessPresentation('unknown').color, state: 'unknown' };
  }

  const signedPct = ((underlying - validStrike) / underlying) * 100;
  const absPct = Math.abs(signedPct);
  if (absPct < 0.5) {
    return { pct: signedPct, label: 'ATM', color: shortPutMoneynessPresentation('atm').color, state: 'atm' };
  }
  if (validStrike < underlying) {
    return { pct: signedPct, label: `${absPct.toFixed(1)}% OTM`, color: shortPutMoneynessPresentation('otm').color, state: 'otm' };
  }
  return { pct: signedPct, label: `${absPct.toFixed(1)}% ITM`, color: shortPutMoneynessPresentation('itm').color, state: 'itm' };
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

export const calculateGrossSecuredCash = calculateEquityAtRisk;

export function calculateMaxLoss(strike: number | null | undefined, optionPrice: number | null | undefined, contracts: number | null | undefined): number | null {
  const equityAtRisk = calculateEquityAtRisk(strike, contracts);
  const totalPremium = calculateTotalPremium(optionPrice, contracts);
  return equityAtRisk != null && totalPremium != null ? equityAtRisk - totalPremium : null;
}

export function calculateNetCapitalAtRisk(strike: number | null | undefined, optionPrice: number | null | undefined, contracts: number | null | undefined): number | null {
  return calculateMaxLoss(strike, optionPrice, contracts);
}

export const calculateNetMaximumLossCapital = calculateNetCapitalAtRisk;

export function calculateNominalYield(optionPrice: number | null | undefined, strike: number | null | undefined): number | null {
  const price = sanitizePositive(optionPrice, true);
  const validStrike = sanitizePositive(strike);
  return price != null && validStrike != null ? price / validStrike : null;
}

export const calculateSecuredCashYield = calculateNominalYield;

export function calculateAnnualizedYield(optionPrice: number | null | undefined, strike: number | null | undefined, dte: number | null | undefined): number | null {
  const nominal = calculateNominalYield(optionPrice, strike);
  return nominal == null ? null : calculateSimpleAnnualizedValue(nominal, dte);
}

/** Inverse of the canonical simple annualized-yield contract. */
export function calculateCreditForAnnualizedYield(annualizedYield: number | null | undefined, strike: number | null | undefined, dte: number | null | undefined): number | null {
  const validStrike = sanitizePositive(strike);
  return isFiniteNumber(annualizedYield) && annualizedYield >= 0 && validStrike != null && isFiniteNumber(dte) && dte > 0
    ? annualizedYield * validStrike * (dte / 365)
    : null;
}

export const calculateAnnualizedSecuredCashYield = calculateAnnualizedYield;

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
  const annualizedReturn = returnOnRisk == null ? null : calculateSimpleAnnualizedValue(returnOnRisk, dte);

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

import { PUT_METRIC_CONTRACT } from './putMetricContract.ts';
import { getOptionLastTradeFreshness, type OptionLastTradeFreshnessPresentation } from './optionLastTradeFreshness.ts';
import type { MarketDateInput } from './usMarketCalendar.ts';
import type { OptionIntegrityStatus } from './types.ts';

export const OPTION_QUOTE_DISPLAY_ORDER = ['last', 'bid', 'mid', 'ask'] as const;
export const OPTION_QUOTE_TABLE_DISPLAY_ORDER = ['last', 'bid', 'ask'] as const;
export const OPTION_YIELD_DISPLAY_ORDER = [
  'nomYieldLast',
  'annYieldLast',
  'nomYieldBid',
  'annYieldBid',
  'nomYieldAsk',
  'annYieldAsk',
] as const;

export const OPTION_NOMINAL_TO_ANNUALIZED_YIELD_FIELD: Record<
  Extract<OptionYieldDisplayField, `nomYield${string}`>,
  Extract<OptionYieldDisplayField, `annYield${string}`>
> = {
  nomYieldLast: 'annYieldLast',
  nomYieldBid: 'annYieldBid',
  nomYieldAsk: 'annYieldAsk',
};

export type OptionQuoteDisplayField = typeof OPTION_QUOTE_DISPLAY_ORDER[number];
export type OptionQuoteTableDisplayField = typeof OPTION_QUOTE_TABLE_DISPLAY_ORDER[number];
export type OptionYieldDisplayField = typeof OPTION_YIELD_DISPLAY_ORDER[number];
export type OptionSoldPriceBasis = OptionQuoteDisplayField | 'manual';

export interface OptionSoldPriceSelection {
  basis: Exclude<OptionSoldPriceBasis, 'ask' | 'manual'>;
  value: number;
}

export interface OptionDrawerQuoteInput {
  last: number | null | undefined;
  lastTradeDate?: MarketDateInput | null;
  bid: number | null | undefined;
  ask: number | null | undefined;
  integrityStatus?: OptionIntegrityStatus;
  /** Valuation-only Portfolio Last must never enter generic Drawer quote authority. */
  lastFallbackOnly?: boolean;
}

export interface OptionDrawerQuoteState {
  rawLast: number | null | undefined;
  rawBid: number | null | undefined;
  rawAsk: number | null | undefined;
  trustedLast: number | null;
  trustedBid: number | null;
  trustedAsk: number | null;
  mid: number | null;
  lastTradeFreshness: OptionLastTradeFreshnessPresentation;
  defaultSoldPrice: OptionSoldPriceSelection | null;
  integrityStatus?: OptionIntegrityStatus;
}

export const OPTION_QUOTE_DISPLAY_LABELS: Record<OptionQuoteDisplayField, string> = {
  last: 'Last',
  bid: 'Bid',
  mid: 'Mid',
  ask: 'Ask',
};

export const OPTION_YIELD_DISPLAY_LABELS: Record<OptionYieldDisplayField, { short: string; full: string }> = {
  nomYieldLast: { short: 'NY Last', full: `${PUT_METRIC_CONTRACT.securedCashYield.label} (Last): ${PUT_METRIC_CONTRACT.securedCashYield.formula}` },
  annYieldLast: { short: 'AY Last', full: `${PUT_METRIC_CONTRACT.annualizedSecuredCashYield.label} (Last): Nominal Yield × 365 ÷ DTE` },
  nomYieldBid: { short: 'NY Bid', full: `${PUT_METRIC_CONTRACT.securedCashYield.label} (Bid): ${PUT_METRIC_CONTRACT.securedCashYield.formula}` },
  annYieldBid: { short: 'AY Bid', full: `${PUT_METRIC_CONTRACT.annualizedSecuredCashYield.label} (Bid): Nominal Yield × 365 ÷ DTE` },
  nomYieldAsk: { short: 'NY Ask', full: `${PUT_METRIC_CONTRACT.securedCashYield.label} (Ask): ${PUT_METRIC_CONTRACT.securedCashYield.formula}` },
  annYieldAsk: { short: 'AY Ask', full: `${PUT_METRIC_CONTRACT.annualizedSecuredCashYield.label} (Ask): Nominal Yield × 365 ÷ DTE` },
};

export function isNominalYieldField(field: OptionYieldDisplayField): boolean {
  return field.startsWith('nomYield');
}

export function visibleOptionYieldFields(showNominalYields: boolean): OptionYieldDisplayField[] {
  return showNominalYields
    ? [...OPTION_YIELD_DISPLAY_ORDER]
    : OPTION_YIELD_DISPLAY_ORDER.filter(field => !isNominalYieldField(field));
}

export function annualizedYieldFieldForNominal(
  field: OptionYieldDisplayField,
): OptionYieldDisplayField {
  return isNominalYieldField(field)
    ? OPTION_NOMINAL_TO_ANNUALIZED_YIELD_FIELD[field as keyof typeof OPTION_NOMINAL_TO_ANNUALIZED_YIELD_FIELD]
    : field;
}

export function orderedOptionQuoteEntries<T>(
  values: Record<OptionQuoteDisplayField, T>,
): Array<{ field: OptionQuoteDisplayField; label: string; value: T }> {
  return OPTION_QUOTE_DISPLAY_ORDER.map(field => ({
    field,
    label: OPTION_QUOTE_DISPLAY_LABELS[field],
    value: values[field],
  }));
}

/** A live option price must be positive to represent an executable selection. */
export function executableOptionPrice(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

export function calculateExecutableMidPrice({
  bid,
  ask,
}: Pick<Record<OptionQuoteDisplayField, number | null | undefined>, 'bid' | 'ask'>): number | null {
  const executableBid = executableOptionPrice(bid);
  const executableAsk = executableOptionPrice(ask);
  return executableBid != null && executableAsk != null ? (executableBid + executableAsk) / 2 : null;
}

/**
 * Select the canonical automatic sold-price basis. Last is automatic only when
 * its exact trade is recent; stale, future-invalid, and undated Last remain
 * available as explicit reference evidence but never become the default.
 */
export function selectDefaultSoldPrice(
  quote: Pick<Record<OptionQuoteDisplayField, number | null | undefined>, 'last' | 'bid' | 'ask'> & Pick<OptionDrawerQuoteInput, 'lastTradeDate' | 'integrityStatus' | 'lastFallbackOnly'>,
  now: MarketDateInput = new Date(),
): OptionSoldPriceSelection | null {
  if (quote.integrityStatus === 'invalid' || quote.lastFallbackOnly) return null;
  const bid = executableOptionPrice(quote.bid);
  if (bid != null) return { basis: 'bid', value: bid };
  const mid = calculateExecutableMidPrice(quote);
  if (mid != null) return { basis: 'mid', value: mid };
  const last = executableOptionPrice(quote.last);
  const freshness = getOptionLastTradeFreshness(quote.lastTradeDate, now);
  return last != null && freshness.freshness === 'recent' ? { basis: 'last', value: last } : null;
}

/** Build the small source-neutral quote contract consumed by OptionDetailDrawer. */
export function buildOptionDrawerQuoteState(
  input: OptionDrawerQuoteInput,
  now: MarketDateInput = new Date(),
): OptionDrawerQuoteState {
  const integrityAllowsEconomics = input.integrityStatus !== 'invalid';
  const trustedBid = integrityAllowsEconomics ? executableOptionPrice(input.bid) : null;
  const trustedAsk = integrityAllowsEconomics ? executableOptionPrice(input.ask) : null;
  const trustedLast = integrityAllowsEconomics && !input.lastFallbackOnly ? executableOptionPrice(input.last) : null;
  const mid = calculateExecutableMidPrice({ bid: trustedBid, ask: trustedAsk });
  const lastTradeFreshness = getOptionLastTradeFreshness(input.lastTradeDate, now);
  const defaultSoldPrice = selectDefaultSoldPrice({
    last: trustedLast,
    bid: trustedBid,
    ask: trustedAsk,
    lastTradeDate: input.lastTradeDate,
    integrityStatus: input.integrityStatus,
    lastFallbackOnly: input.lastFallbackOnly,
  }, now);

  return {
    rawLast: input.last,
    rawBid: input.bid,
    rawAsk: input.ask,
    trustedLast,
    trustedBid,
    trustedAsk,
    mid,
    lastTradeFreshness,
    defaultSoldPrice,
    integrityStatus: input.integrityStatus,
  };
}

export function formatOptionQuoteValue(
  field: OptionQuoteDisplayField,
  value: number | null | undefined,
  formatter: (price: number) => string,
): string {
  const executable = executableOptionPrice(value);
  if (executable != null) return formatter(executable);
  return field === 'bid' && value === 0 ? 'No Bid' : '\u2014';
}

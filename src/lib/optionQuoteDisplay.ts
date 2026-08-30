import { PUT_METRIC_CONTRACT } from './putMetricContract.ts';

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

export type OptionQuoteDisplayField = typeof OPTION_QUOTE_DISPLAY_ORDER[number];
export type OptionQuoteTableDisplayField = typeof OPTION_QUOTE_TABLE_DISPLAY_ORDER[number];
export type OptionYieldDisplayField = typeof OPTION_YIELD_DISPLAY_ORDER[number];

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

export function orderedOptionQuoteEntries<T>(
  values: Record<OptionQuoteDisplayField, T>,
): Array<{ field: OptionQuoteDisplayField; label: string; value: T }> {
  return OPTION_QUOTE_DISPLAY_ORDER.map(field => ({
    field,
    label: OPTION_QUOTE_DISPLAY_LABELS[field],
    value: values[field],
  }));
}

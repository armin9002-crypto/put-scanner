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
  nomYieldLast: { short: 'NY Last', full: 'Nom. Yield (Last)' },
  annYieldLast: { short: 'AY Last', full: 'Ann. Yield (Last)' },
  nomYieldBid: { short: 'NY Bid', full: 'Nom. Yield (Bid)' },
  annYieldBid: { short: 'AY Bid', full: 'Ann. Yield (Bid)' },
  nomYieldAsk: { short: 'NY Ask', full: 'Nom. Yield (Ask)' },
  annYieldAsk: { short: 'AY Ask', full: 'Ann. Yield (Ask)' },
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

export const OPTION_QUOTE_DISPLAY_ORDER = ['last', 'bid', 'mid', 'ask'] as const;
export const OPTION_QUOTE_TABLE_DISPLAY_ORDER = ['last', 'bid', 'ask'] as const;

export type OptionQuoteDisplayField = typeof OPTION_QUOTE_DISPLAY_ORDER[number];
export type OptionQuoteTableDisplayField = typeof OPTION_QUOTE_TABLE_DISPLAY_ORDER[number];

export const OPTION_QUOTE_DISPLAY_LABELS: Record<OptionQuoteDisplayField, string> = {
  last: 'Last',
  bid: 'Bid',
  mid: 'Mid',
  ask: 'Ask',
};

export function orderedOptionQuoteEntries<T>(
  values: Record<OptionQuoteDisplayField, T>,
): Array<{ field: OptionQuoteDisplayField; label: string; value: T }> {
  return OPTION_QUOTE_DISPLAY_ORDER.map(field => ({
    field,
    label: OPTION_QUOTE_DISPLAY_LABELS[field],
    value: values[field],
  }));
}

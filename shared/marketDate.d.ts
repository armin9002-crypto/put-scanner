export type MarketDateInput = Date | number | string;

export declare function calendarDateIso(value: MarketDateInput | null | undefined): string | null;
export declare function usMarketDateIso(value?: MarketDateInput | null): string | null;
export declare function calendarDaysBetween(start: string | null | undefined, end: string | null | undefined): number | null;

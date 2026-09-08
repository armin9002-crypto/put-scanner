import type { MarketDateInput } from './marketDate.js';

export interface DailyHistoryPoint {
  timestamp: number;
  date: string;
  price: number;
}

export interface NormalizedDailyHistoryPoint extends DailyHistoryPoint {
  marketDate: string;
}

export interface AlignedDailyObservations {
  marketDate: string;
  left: NormalizedDailyHistoryPoint;
  right: NormalizedDailyHistoryPoint;
}

export declare function dailyObservationMarketDate(point: DailyHistoryPoint): string | null;
export declare function normalizeDailyHistory(points: readonly DailyHistoryPoint[]): NormalizedDailyHistoryPoint[];
export declare function marketYearForAsOf(asOf?: MarketDateInput): number | null;
export declare function resolveCanonicalYtdBaseline(points: readonly DailyHistoryPoint[], asOf?: MarketDateInput): NormalizedDailyHistoryPoint | null;
export declare function resolveCanonicalYtdEnd(points: readonly DailyHistoryPoint[], asOf?: MarketDateInput): NormalizedDailyHistoryPoint | null;
export declare function resolveAlignedYtdBaselines(leftPoints: readonly DailyHistoryPoint[], rightPoints: readonly DailyHistoryPoint[], asOf?: MarketDateInput): AlignedDailyObservations | null;
export declare function resolveAlignedYtdEnds(leftPoints: readonly DailyHistoryPoint[], rightPoints: readonly DailyHistoryPoint[], asOf?: MarketDateInput, endAt?: MarketDateInput): AlignedDailyObservations | null;
export declare function buildCanonicalYtdView(points: readonly DailyHistoryPoint[], asOf?: MarketDateInput): {
  marketYear: number | null;
  baseline: NormalizedDailyHistoryPoint | null;
  preYearPoints: NormalizedDailyHistoryPoint[];
  points: NormalizedDailyHistoryPoint[];
};

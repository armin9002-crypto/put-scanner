import type { RegimeLabel } from '../marketRead/types.ts';

export interface RecommendationPolicyV1 {
  version: 2;
  compensation: {
    minimumAnnualizedYieldByRegime: Record<RegimeLabel, number>;
    shortDtePremium: number;
    mediumDtePremium: number;
    longDtePremium: number;
    nearMinimumCushionPremium: number;
    moderateCushionPremium: number;
    nearMaximumDeltaPremium: number;
    watchUnderlyingPremium: number;
    materialAnnualizedYieldDifference: number;
    relativeRiskAnnualizedYieldPremium: number;
  };
  comparison: {
    materialDeltaDifference: number;
    materialCushionDifference: number;
    similarDteDays: number;
    crossDurationMinimumDifferenceDays: number;
    longerDurationMinimumAyPremium: number;
    longerDurationMaximumDefensiveAyGiveUp: number;
  };
  pricing: {
    tightSpreadPercent: number;
    acceptableSpreadPercent: number;
    maximumNeighborSpreadPercent: number;
    maximumFreshAgeMs: number;
    maximumStaleAgeMs: number;
    monotonicDollarTolerance: number;
    monotonicRelativeTolerance: number;
    maximumBracketSpacingRatio: number;
    maximumIvGapPct: number;
    maximumDeltaGap: number;
    quoteTick: number;
  };
  evidence: {
    minimumUnderlyingTechnicalFieldsHigh: number;
    minimumUnderlyingTechnicalFieldsModerate: number;
  };
  robustness: {
    hurdlePerturbation: number;
    materialDeltaPerturbation: number;
    materialCushionPerturbation: number;
    highMinimumStableShare: number;
    moderateMinimumStableShare: number;
  };
}

export const RECOMMENDATION_POLICY_V1: RecommendationPolicyV1 = Object.freeze({
  version: 2,
  compensation: {
    minimumAnnualizedYieldByRegime: {
      'Complacent Risk-On': 0.16,
      'Healthy Risk-On': 0.13,
      'Healthy Pullback': 0.14,
      'Choppy / Elevated Vol': 0.18,
      'Risk-Off': 0.24,
      'Oversold Panic': 0.28,
      'Mixed / No Edge': 0.18,
    },
    shortDtePremium: 0.04,
    mediumDtePremium: 0.015,
    longDtePremium: 0.03,
    nearMinimumCushionPremium: 0.03,
    moderateCushionPremium: 0.01,
    nearMaximumDeltaPremium: 0.02,
    watchUnderlyingPremium: 0.03,
    materialAnnualizedYieldDifference: 0.015,
    relativeRiskAnnualizedYieldPremium: 0.025,
  },
  comparison: {
    materialDeltaDifference: 0.03,
    materialCushionDifference: 0.05,
    similarDteDays: 21,
    crossDurationMinimumDifferenceDays: 45,
    longerDurationMinimumAyPremium: 0.02,
    longerDurationMaximumDefensiveAyGiveUp: 0.015,
  },
  pricing: {
    tightSpreadPercent: 0.25,
    acceptableSpreadPercent: 0.55,
    maximumNeighborSpreadPercent: 0.8,
    maximumFreshAgeMs: 30 * 60 * 1_000,
    maximumStaleAgeMs: 2 * 60 * 60 * 1_000,
    monotonicDollarTolerance: 0.02,
    monotonicRelativeTolerance: 0.05,
    maximumBracketSpacingRatio: 3,
    maximumIvGapPct: 40,
    maximumDeltaGap: 0.18,
    quoteTick: 0.01,
  },
  evidence: {
    minimumUnderlyingTechnicalFieldsHigh: 7,
    minimumUnderlyingTechnicalFieldsModerate: 4,
  },
  robustness: {
    hurdlePerturbation: 0.02,
    materialDeltaPerturbation: 0.01,
    materialCushionPerturbation: 0.02,
    highMinimumStableShare: 0.8,
    moderateMinimumStableShare: 0.5,
  },
});

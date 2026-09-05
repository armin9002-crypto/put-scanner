import type { EtfPulseRow } from '../etfPulseMetrics.ts';
import type { RegimeAnalysis, TradePosture } from '../marketRead/types.ts';
import type { ScreenerRow } from '../screenerRows.ts';
import type { OptionsChainData } from '../types.ts';
import type { UnderlyingTechnicalAssessment } from '../underlyingTechnical.ts';

export const RECOMMENDATION_ENGINE_VERSION = 4 as const;
export const RECOMMENDATION_POLICY_VERSION = 3 as const;

export type RecommendationBand = 'STRONG' | 'GOOD' | 'MIXED' | 'WEAK';
export type RecommendationEvidenceQuality = 'HIGH' | 'MODERATE' | 'LOW';
export type PricingConfidence = 'HIGH' | 'MODERATE' | 'LOW';
export type Actionability = 'HIGH' | 'MODERATE' | 'LOW';
export type PricingProvenance = 'DIRECT_MARKET' | 'INDICATIVE_RANGE' | 'INSUFFICIENT_PRICING_EVIDENCE';
export type PriceDiscoveryTier = 'DIRECT_RECENT' | 'RECENT_NEARBY_CONFIRMED' | 'QUOTED_TRANSACTION_STALE' | 'INDICATIVE_SURFACE' | 'INSUFFICIENT_PRICE_DISCOVERY';
export type TransactionRecency = 'RECENT' | 'STALE' | 'VERY_STALE' | 'UNAVAILABLE';
export type NearbyTransactionProxy = 'TWO_SIDED_RECENT' | 'ONE_VERY_CLOSE_RECENT' | 'ONE_DISTANT_RECENT' | 'NONE';
export type UnderlyingQualification = 'ELIGIBLE' | 'WATCH' | 'HARD_FAIL';
export type CandidateVerdict = 'ACTIONABLE' | 'CONDITIONAL' | 'WATCH' | 'PASS';
export type RecommendationDistinction = 'BEST_OVERALL' | 'MORE_DEFENSIVE' | 'HIGHER_COMPENSATION';
export type RecommendationOperationalStatus = 'COMPLETE' | 'INCOMPLETE';
export type RecommendationRunVerdict = 'OPPORTUNITIES_FOUND' | 'NO_TRADE';
export type RobustnessClassification = 'HIGH' | 'MODERATE' | 'LOW';

export type RecommendationReasonCode =
  | 'ABSOLUTE_HURDLE_CLEARED'
  | 'ABSOLUTE_HURDLE_MISSED'
  | 'BROKEN_TREND'
  | 'CLEAN_DIRECT_MARKET'
  | 'COHERENT_PRICE_BRACKET'
  | 'CONSTRUCTIVE_PULLBACK_CONTEXT'
  | 'DEFENSIVE_TRADEOFF_FAVORABLE'
  | 'DURATION_NOT_COMPENSATED'
  | 'DOWNSIDE_TAIL_RISK'
  | 'DTE_OUTSIDE_POSTURE'
  | 'DETERIORATING_UNDERLYING'
  | 'EVIDENCE_GAPS'
  | 'HIGHER_COMPENSATION_JUSTIFIED'
  | 'INDICATIVE_BELOW_HURDLE'
  | 'INSUFFICIENT_PRICE_DISCOVERY'
  | 'INSUFFICIENT_CUSHION'
  | 'INVALID_CONTRACT'
  | 'MARGINAL_COMPENSATION'
  | 'MISSING_DELTA'
  | 'LONGER_DURATION_DEFENSIVE_VALUE'
  | 'NO_CLEAR_LEADER'
  | 'NO_DIRECT_BID'
  | 'OVERSOLD_INTACT_CONTEXT'
  | 'POOR_RELATIVE_VALUE'
  | 'PRICING_UNCERTAINTY'
  | 'REGIME_INCOMPATIBLE'
  | 'RECENT_DIRECT_TRANSACTION'
  | 'RECENT_NEARBY_TRANSACTION_PROXY'
  | 'RECOVERY_CONTEXT'
  | 'RELATIVE_HURDLE_CLEARED'
  | 'ROBUSTNESS_LOW'
  | 'SHORTLIST_CAP'
  | 'STALE_TRANSACTION_EVIDENCE'
  | 'SHORTER_DURATION_EFFICIENT'
  | 'STRONG_CUSHION'
  | 'SUPPORTIVE_UNDERLYING'
  | 'EXTENDED_UNDERLYING'
  | 'VERY_STALE_TRANSACTION_EVIDENCE'
  | 'VOLATILITY_NOT_RICH_ENOUGH'
  | 'WEAK_ACTIONABILITY'
  | 'WEAK_OPPORTUNITY_SET'
  | 'YIELD_TRAP';

export interface RecommendationCoverage {
  trackedUnderlyings: string[];
  hardFailedBeforeChainAcquisition: string[];
  requestedForOptionScan: string[];
  successfullyAnalyzedUnderlyings: string[];
  failedUnderlyings: Array<{ ticker: string; message: string }>;
  failedBatches: number[];
  expirationsCovered: Array<{ ticker: string; expirationDates: number[] }>;
  expirationPlans: Array<{
    ticker: string;
    availableExpirationDates: number[];
    eligibleExpirationDates: number[];
    selectedExpirationDates: number[];
    discoveryExpiration: number | null;
  }>;
  contractsEvaluated: number;
  pulse: {
    requested: number;
    loaded: number;
    failed: number;
    stale: boolean;
  };
  provenance: {
    pulseFetchedAt: number | null;
    chainSources: Array<{ ticker: string; expiration: number; source: string; fetchedAt: number | null }>;
  };
}

export interface RecommendationChainSnapshot {
  ticker: string;
  expiration: number;
  data: OptionsChainData;
}

export interface RecommendationSnapshot {
  asOf: string;
  engineVersion: typeof RECOMMENDATION_ENGINE_VERSION;
  policyVersion: typeof RECOMMENDATION_POLICY_VERSION;
  universe: RecommendationUniverse;
  market: {
    regime: RegimeAnalysis;
    posture: TradePosture;
  };
  underlyings: EtfPulseRow[];
  chains: RecommendationChainSnapshot[];
  screenerRows: ScreenerRow[];
  coverage: RecommendationCoverage;
}

export interface RecommendationUniverse {
  onlyEvaluateAtLeast60Dte: boolean;
  minimumDte: number;
  maximumDte: number;
  maxExpirationsPerUnderlying: number;
  expirationPlanner: 'NEAR_MIDDLE_FAR';
}

export function recommendationUniverse(onlyEvaluateAtLeast60Dte: boolean): RecommendationUniverse {
  return {
    onlyEvaluateAtLeast60Dte,
    minimumDte: onlyEvaluateAtLeast60Dte ? 60 : 0,
    maximumDte: 365,
    maxExpirationsPerUnderlying: 3,
    expirationPlanner: 'NEAR_MIDDLE_FAR',
  };
}

export interface UnderlyingAssessment {
  ticker: string;
  technicalAssessment: UnderlyingTechnicalAssessment;
  setup: RecommendationBand;
  qualification: UnderlyingQualification;
  evidenceQuality: RecommendationEvidenceQuality;
  lenses: {
    trendIntegrity: RecommendationBand;
    resetExtension: RecommendationBand;
    volatilityContext: RecommendationBand;
    regimeFit: RecommendationBand;
  };
  reasonCodes: RecommendationReasonCode[];
  metrics: {
    realizedVolatility20: number | null;
  };
  evidence: Array<{ label: string; value: string }>;
}

export interface PriceNeighborEvidence {
  strike: number;
  side: 'LOWER' | 'CANDIDATE' | 'UPPER';
  bid: number | null;
  ask: number | null;
  last: number | null;
  lastTradeDate: number | null;
  tradingSessionAge: number | null;
  strikeDistanceRatio: number;
  recentTransaction: boolean;
  delta: number | null;
  iv: number | null;
  openInterest: number | null;
  volume: number | null;
  spreadPercent: number | null;
}

export interface RecommendationPricing {
  provenance: PricingProvenance;
  directBid: number | null;
  directAsk: number | null;
  last: number | null;
  lastTradeDate: number | null;
  exactTradeSessionAge: number | null;
  exactTradeRecency: TransactionRecency;
  discoveryTier: PriceDiscoveryTier;
  nearbyTransactionProxy: NearbyTransactionProxy;
  recentNeighborCount: number;
  closestRecentNeighborDistanceRatio: number | null;
  recentLowerBracket: boolean;
  recentUpperBracket: boolean;
  chainEvidence: {
    fetchedAt: number | null;
    ageMs: number | null;
    source: string;
    stale: boolean;
  };
  indicativeRange: { low: number; high: number } | null;
  confidence: PricingConfidence;
  actionability: Actionability;
  surface: {
    bracketed: boolean;
    monotonic: boolean;
    coherent: boolean;
    neighbors: PriceNeighborEvidence[];
    reasonCodes: RecommendationReasonCode[];
  };
}

export interface CandidateComparison {
  otherCandidateId: string;
  relationship: 'OUTRANKS' | 'OUTRANKED_BY' | 'EFFECTIVE_TIE' | 'TRADEOFF';
  reasonCodes: RecommendationReasonCode[];
  advantages: string[];
  disadvantages: string[];
}

export interface CandidateComparisonSummary {
  totalCount: number;
  retainedDetailCount: number;
  relationshipCounts: Record<CandidateComparison['relationship'], number>;
  retainedRelationshipCounts: Record<CandidateComparison['relationship'], number>;
  outranksCandidateIds: string[];
  outrankedByCandidateIds: string[];
  reasonCodes: RecommendationReasonCode[];
  outrankedByReasonCodes: RecommendationReasonCode[];
}

export interface RecommendationCandidate {
  id: string;
  ticker: string;
  expiration: number;
  expirationLabel: string;
  dte: number;
  strike: number;
  underlyingPrice: number;
  canonicalRow: ScreenerRow;
  underlying: UnderlyingAssessment;
  pricing: RecommendationPricing;
  economics: {
    nominalYieldBidPct: number | null;
    annualizedYieldBidPct: number | null;
    indicativeAnnualizedYieldRangePct: { low: number; high: number } | null;
    delta: number | null;
    moneynessPct: number;
    breakevenAtBasis: number | null;
    breakevenCushionAtBasis: number | null;
    ivPct: number | null;
    ivVsRealizedRangePct: number | null;
  };
  minimumAttractiveCredit: {
    absoluteCredit: number | null;
    relativeFrontierCredit: number | null;
    credit: number | null;
    requiredAnnualizedYieldPct: number;
  };
  lenses: {
    compensation: RecommendationBand;
    cushion: RecommendationBand;
    volatilityOpportunity: RecommendationBand;
    underlyingSetup: RecommendationBand;
    pricingConfidence: RecommendationBand;
    actionability: RecommendationBand;
  };
  evidenceQuality: RecommendationEvidenceQuality;
  policyChecks: Array<{
    code: RecommendationReasonCode;
    passed: boolean;
    severity: 'BLOCKING' | 'INFORMATIONAL';
    phase: 'VALIDITY' | 'RISK' | 'UNDERLYING' | 'DURATION_CONTEXT';
    detail: string;
  }>;
  dominatedBy: string[];
  dominates: string[];
  comparisons: CandidateComparison[];
  comparisonSummary: CandidateComparisonSummary;
  skeptic: { code: RecommendationReasonCode; message: string; veto: boolean };
  robustness: {
    classification: RobustnessClassification;
    stableScenarios: number;
    totalScenarios: number;
    reasonCodes: RecommendationReasonCode[];
  };
  verdict: CandidateVerdict;
  whyReasonCodes: RecommendationReasonCode[];
  tradeoffReasonCodes: RecommendationReasonCode[];
  why: string;
  tradeoff: string;
  rank: RecommendationRankMetadata | null;
}

export interface RecommendationSelection {
  candidateId: string;
  shortlistRank: number;
  distinctions: RecommendationDistinction[];
}

export interface RecommendationRankMetadata {
  ordinal: number;
  verdictRank: number;
  priceDiscoveryRank: number;
  pricingActionabilityRank: number;
  pricingConfidenceRank: number;
  robustnessRank: number;
  underlyingQualificationRank: number;
  technicalStateRank: number;
  skepticVetoRank: number;
  relativeLossCount: number;
  compensationMarginPctPoints: number | null;
  breakevenCushionPct: number | null;
  absoluteDelta: number | null;
  majorTierKey: string;
  canonicalTieBreak: string;
}

export interface RecommendationNearMiss {
  candidateId: string;
  reasonCode: RecommendationReasonCode;
  text: string;
}

export type RecommendationDecisionTraceStageKey =
  | 'TRACKED_UNDERLYINGS'
  | 'QUALIFIED_UNDERLYINGS'
  | 'UNDERLYING_HARD_FAILS'
  | 'CHAINS_ACQUIRED'
  | 'CONTRACTS_EVALUATED'
  | 'INVALID_CONTRACTS'
  | 'RISK_POLICY_FAILURES'
  | 'COMPENSATION_FAILURES'
  | 'PRICING_DISCOVERY_INSUFFICIENCY'
  | 'STALE_TRANSACTION_EVIDENCE'
  | 'ROBUSTNESS_FAILURES'
  | 'SKEPTIC_VETOES'
  | 'DOMINANCE_FRONTIER_LOSSES'
  | 'ACTIONABLE'
  | 'CONDITIONAL'
  | 'WATCH'
  | 'PASS'
  | 'POLICY_SURVIVORS'
  | 'SURFACED_SHORTLIST'
  | 'SURFACING_CAP_EXCLUDED';

export interface RecommendationDecisionTrace {
  stages: Array<{
    key: RecommendationDecisionTraceStageKey;
    label: string;
    count: number;
    definition: string;
  }>;
  topRejectionReasons: Array<{
    code: RecommendationReasonCode;
    label: string;
    count: number;
  }>;
}

export interface RecommendationRun {
  engineVersion: typeof RECOMMENDATION_ENGINE_VERSION;
  policyVersion: typeof RECOMMENDATION_POLICY_VERSION;
  asOf: string;
  universe: RecommendationUniverse;
  operationalStatus: RecommendationOperationalStatus;
  runVerdict: RecommendationRunVerdict | null;
  market: RecommendationSnapshot['market'];
  coverage: RecommendationCoverage;
  underlyingAssessments: UnderlyingAssessment[];
  candidates: RecommendationCandidate[];
  frontiers: Array<{ ticker: string; candidateIds: string[] }>;
  recommendations: RecommendationSelection[];
  nearMisses: RecommendationNearMiss[];
  decisionTrace: RecommendationDecisionTrace;
  reasonCodes: RecommendationReasonCode[];
}

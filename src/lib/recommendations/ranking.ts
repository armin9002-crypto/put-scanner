import type { UnderlyingTechnicalState } from '../underlyingTechnical.ts';
import type { RecommendationPolicy } from './policy.ts';
import { RECOMMENDATION_POLICY } from './policy.ts';
import type {
  Actionability,
  CandidateVerdict,
  PriceDiscoveryTier,
  PricingConfidence,
  RecommendationCandidate,
  RecommendationDistinction,
  RecommendationRankMetadata,
  RecommendationSelection,
  RobustnessClassification,
  UnderlyingQualification,
} from './types.ts';

const VERDICT_RANK: Record<CandidateVerdict, number> = { ACTIONABLE: 0, CONDITIONAL: 1, WATCH: 2, PASS: 3 };
const DISCOVERY_RANK: Record<PriceDiscoveryTier, number> = {
  DIRECT_RECENT: 0,
  RECENT_NEARBY_CONFIRMED: 1,
  QUOTED_TRANSACTION_STALE: 2,
  INDICATIVE_SURFACE: 3,
  INSUFFICIENT_PRICE_DISCOVERY: 4,
};
const ACTIONABILITY_RANK: Record<Actionability, number> = { HIGH: 0, MODERATE: 1, LOW: 2 };
const CONFIDENCE_RANK: Record<PricingConfidence, number> = { HIGH: 0, MODERATE: 1, LOW: 2 };
const ROBUSTNESS_RANK: Record<RobustnessClassification, number> = { HIGH: 0, MODERATE: 1, LOW: 2 };
const QUALIFICATION_RANK: Record<UnderlyingQualification, number> = { ELIGIBLE: 0, WATCH: 1, HARD_FAIL: 2 };
const TECHNICAL_STATE_RANK: Record<UnderlyingTechnicalState, number> = {
  STRONG_TREND: 0,
  CONSTRUCTIVE_PULLBACK: 1,
  RECOVERY_RECLAIM: 2,
  OVERSOLD_INTACT: 3,
  RANGE_NEUTRAL: 4,
  EXTENDED: 5,
  TRANSITION_DETERIORATING: 6,
  INSUFFICIENT_DATA: 7,
  BROKEN_TREND: 8,
};

const DISCOVERY_LABELS: Record<PriceDiscoveryTier, string> = {
  DIRECT_RECENT: 'Direct Recent',
  RECENT_NEARBY_CONFIRMED: 'Nearby Confirmed',
  QUOTED_TRANSACTION_STALE: 'Quoted / Trade Stale',
  INDICATIVE_SURFACE: 'Indicative Surface',
  INSUFFICIENT_PRICE_DISCOVERY: 'Insufficient',
};

export function priceDiscoveryLabel(tier: PriceDiscoveryTier): string {
  return DISCOVERY_LABELS[tier];
}

function candidateAnnualizedYieldPct(candidate: RecommendationCandidate): number | null {
  if (candidate.pricing.directBid != null) return candidate.economics.annualizedYieldBidPct;
  const range = candidate.economics.indicativeAnnualizedYieldRangePct;
  return range ? (range.low + range.high) / 2 : null;
}

function relativeLossCount(candidate: RecommendationCandidate): number {
  return new Set([
    ...candidate.dominatedBy,
    ...candidate.comparisons.filter(comparison => comparison.relationship === 'OUTRANKED_BY').map(comparison => comparison.otherCandidateId),
  ]).size;
}

function finiteOrNull(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function compareNullableDescending(left: number | null, right: number | null): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return right - left;
}

function compareNullableAscending(left: number | null, right: number | null): number {
  if (left == null && right == null) return 0;
  if (left == null) return 1;
  if (right == null) return -1;
  return left - right;
}

function factors(candidate: RecommendationCandidate) {
  const annualizedYield = candidateAnnualizedYieldPct(candidate);
  const requiredYield = finiteOrNull(candidate.minimumAttractiveCredit.requiredAnnualizedYieldPct);
  const compensationMarginPctPoints = annualizedYield == null || requiredYield == null ? null : annualizedYield - requiredYield;
  const cushion = finiteOrNull(candidate.economics.breakevenCushionAtBasis);
  const delta = finiteOrNull(candidate.economics.delta);
  const verdictRank = VERDICT_RANK[candidate.verdict];
  const priceDiscoveryRank = DISCOVERY_RANK[candidate.pricing.discoveryTier];
  const robustnessRank = ROBUSTNESS_RANK[candidate.robustness.classification];
  const underlyingQualificationRank = QUALIFICATION_RANK[candidate.underlying.qualification];
  const technicalStateRank = TECHNICAL_STATE_RANK[candidate.underlying.technicalAssessment.state];
  return {
    verdictRank,
    priceDiscoveryRank,
    pricingActionabilityRank: ACTIONABILITY_RANK[candidate.pricing.actionability],
    pricingConfidenceRank: CONFIDENCE_RANK[candidate.pricing.confidence],
    robustnessRank,
    underlyingQualificationRank,
    technicalStateRank,
    skepticVetoRank: candidate.skeptic.veto ? 1 : 0,
    relativeLossCount: relativeLossCount(candidate),
    compensationMarginPctPoints,
    breakevenCushionPct: cushion == null ? null : cushion * 100,
    absoluteDelta: delta == null ? null : Math.abs(delta),
    majorTierKey: [verdictRank, priceDiscoveryRank, robustnessRank, underlyingQualificationRank, technicalStateRank].join('|'),
    canonicalTieBreak: candidate.id,
  };
}

export function compareRecommendationCandidates(left: RecommendationCandidate, right: RecommendationCandidate): number {
  const a = factors(left);
  const b = factors(right);
  return a.verdictRank - b.verdictRank
    || a.priceDiscoveryRank - b.priceDiscoveryRank
    || a.pricingActionabilityRank - b.pricingActionabilityRank
    || a.pricingConfidenceRank - b.pricingConfidenceRank
    || a.robustnessRank - b.robustnessRank
    || a.underlyingQualificationRank - b.underlyingQualificationRank
    || a.technicalStateRank - b.technicalStateRank
    || a.skepticVetoRank - b.skepticVetoRank
    || a.relativeLossCount - b.relativeLossCount
    || compareNullableDescending(a.compensationMarginPctPoints, b.compensationMarginPctPoints)
    || compareNullableDescending(a.breakevenCushionPct, b.breakevenCushionPct)
    || compareNullableAscending(a.absoluteDelta, b.absoluteDelta)
    || a.canonicalTieBreak.localeCompare(b.canonicalTieBreak);
}

export function compareMaterialRecommendationRank(left: RecommendationCandidate, right: RecommendationCandidate): number {
  const a = factors(left);
  const b = factors(right);
  return a.verdictRank - b.verdictRank
    || a.priceDiscoveryRank - b.priceDiscoveryRank
    || a.pricingActionabilityRank - b.pricingActionabilityRank
    || a.pricingConfidenceRank - b.pricingConfidenceRank
    || a.robustnessRank - b.robustnessRank
    || a.underlyingQualificationRank - b.underlyingQualificationRank
    || a.technicalStateRank - b.technicalStateRank
    || a.skepticVetoRank - b.skepticVetoRank
    || a.relativeLossCount - b.relativeLossCount
    || compareNullableDescending(a.compensationMarginPctPoints, b.compensationMarginPctPoints)
    || compareNullableDescending(a.breakevenCushionPct, b.breakevenCushionPct)
    || compareNullableAscending(a.absoluteDelta, b.absoluteDelta);
}

export function assignRecommendationRanks(candidates: RecommendationCandidate[]): void {
  [...candidates].sort(compareRecommendationCandidates).forEach((candidate, index) => {
    const rankFactors = factors(candidate);
    candidate.rank = { ordinal: index + 1, ...rankFactors } satisfies RecommendationRankMetadata;
  });
}

function diversityWithinMajorTier(candidates: RecommendationCandidate[], perTickerBeforeDiversity: number): RecommendationCandidate[] {
  const preferred: RecommendationCandidate[] = [];
  const repeated: RecommendationCandidate[] = [];
  const counts = new Map<string, number>();
  candidates.forEach(candidate => {
    const count = counts.get(candidate.ticker) ?? 0;
    counts.set(candidate.ticker, count + 1);
    if (count < perTickerBeforeDiversity) preferred.push(candidate);
    else repeated.push(candidate);
  });
  return [...preferred, ...repeated];
}

function applyTierBoundedDiversity(candidates: RecommendationCandidate[], perTickerBeforeDiversity: number): RecommendationCandidate[] {
  const result: RecommendationCandidate[] = [];
  let start = 0;
  while (start < candidates.length) {
    const tier = factors(candidates[start]).majorTierKey;
    let end = start + 1;
    while (end < candidates.length && factors(candidates[end]).majorTierKey === tier) end += 1;
    result.push(...diversityWithinMajorTier(candidates.slice(start, end), perTickerBeforeDiversity));
    start = end;
  }
  return result;
}

function addDistinction(byCandidate: Map<string, RecommendationDistinction[]>, candidateId: string, distinction: RecommendationDistinction): void {
  const current = byCandidate.get(candidateId) ?? [];
  if (!current.includes(distinction)) current.push(distinction);
  byCandidate.set(candidateId, current);
}

export function buildRankedRecommendationShortlist(
  candidates: RecommendationCandidate[],
  policy: RecommendationPolicy = RECOMMENDATION_POLICY,
): { selections: RecommendationSelection[]; noClearLeader: boolean; policySurvivorCount: number; capExcluded: number } {
  const qualifying = [...candidates]
    .filter(candidate => (candidate.verdict === 'ACTIONABLE' || candidate.verdict === 'CONDITIONAL') && !candidate.skeptic.veto)
    .sort(compareRecommendationCandidates);
  const unique = qualifying.filter((candidate, index) => qualifying.findIndex(other => other.id === candidate.id) === index);
  const diversified = applyTierBoundedDiversity(unique, policy.selection.sameTickerContractsBeforeDiversity);
  const selected = diversified.slice(0, policy.selection.maximumShortlistSize);
  const noClearLeader = selected.length > 1 && (
    compareMaterialRecommendationRank(selected[0], selected[1]) === 0
    || selected[0].comparisons.some(comparison => comparison.otherCandidateId === selected[1].id && comparison.relationship === 'EFFECTIVE_TIE')
    || selected[1].comparisons.some(comparison => comparison.otherCandidateId === selected[0].id && comparison.relationship === 'EFFECTIVE_TIE')
  );
  const distinctions = new Map<string, RecommendationDistinction[]>();
  if (selected[0] && !noClearLeader) addDistinction(distinctions, selected[0].id, 'BEST_OVERALL');

  const reference = selected[0];
  if (reference) {
    const referenceDelta = reference.economics.delta == null ? null : Math.abs(reference.economics.delta);
    const defensive = selected.find(candidate => {
      if (candidate.id === reference.id || candidate.economics.delta == null || referenceDelta == null) return false;
      const candidateCushion = candidate.economics.breakevenCushionAtBasis;
      const referenceCushion = reference.economics.breakevenCushionAtBasis;
      return Math.abs(candidate.economics.delta) <= referenceDelta - policy.comparison.materialDeltaDifference
        || (candidateCushion != null && referenceCushion != null && candidateCushion >= referenceCushion + policy.comparison.materialCushionDifference);
    });
    if (defensive) addDistinction(distinctions, defensive.id, 'MORE_DEFENSIVE');

    const referenceAy = candidateAnnualizedYieldPct(reference);
    const higherCompensation = selected.find(candidate => {
      const ay = candidateAnnualizedYieldPct(candidate);
      return candidate.id !== reference.id && ay != null && referenceAy != null
        && ay >= referenceAy + policy.compensation.materialAnnualizedYieldDifference * 100
        && !candidate.comparisons.some(comparison => comparison.otherCandidateId === reference.id && comparison.relationship === 'OUTRANKED_BY');
    });
    if (higherCompensation) addDistinction(distinctions, higherCompensation.id, 'HIGHER_COMPENSATION');
  }

  return {
    selections: selected.map((candidate, index) => ({
      candidateId: candidate.id,
      shortlistRank: index + 1,
      distinctions: distinctions.get(candidate.id) ?? [],
    })),
    noClearLeader,
    policySurvivorCount: unique.length,
    capExcluded: Math.max(0, unique.length - selected.length),
  };
}

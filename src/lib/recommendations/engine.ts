import {
  calculateAnnualizedYield,
  calculateBreakeven,
  calculateCreditForAnnualizedYield,
  calculateDownsideCushion,
  isFiniteNumber,
} from '../optionMetrics.ts';
import type { TradePosture } from '../marketRead/types.ts';
import type { RecommendationPolicy } from './policy.ts';
import { RECOMMENDATION_POLICY } from './policy.ts';
import { assessUnderlyingUniverse } from './underlying.ts';
import { discoverContractPricing } from './pricing.ts';
import { assignRecommendationRanks, buildRankedRecommendationShortlist, compareRecommendationCandidates } from './ranking.ts';
import { buildCandidateExplanation, buildNearMissText, reasonCopy } from './explanations.ts';
import {
  RECOMMENDATION_ENGINE_VERSION,
  RECOMMENDATION_POLICY_VERSION,
  recommendationUniverse,
  type Actionability,
  type CandidateComparison,
  type CandidateVerdict,
  type PricingConfidence,
  type RecommendationBand,
  type RecommendationCandidate,
  type RecommendationEvidenceQuality,
  type RecommendationReasonCode,
  type RecommendationRun,
  type RecommendationSnapshot,
  type RobustnessClassification,
  type UnderlyingAssessment,
} from './types.ts';

const BAND_RANK: Record<RecommendationBand, number> = { WEAK: 0, MIXED: 1, GOOD: 2, STRONG: 3 };
const CONFIDENCE_RANK: Record<PricingConfidence, number> = { LOW: 0, MODERATE: 1, HIGH: 2 };
const ACTIONABILITY_RANK: Record<Actionability, number> = { LOW: 0, MODERATE: 1, HIGH: 2 };
const EVIDENCE_RANK: Record<RecommendationEvidenceQuality, number> = { LOW: 0, MODERATE: 1, HIGH: 2 };

function finitePositive(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function candidateId(ticker: string, expiration: number, strike: number): string {
  return `${ticker.trim().toUpperCase()}|${expiration}|${Number(strike.toFixed(4))}`;
}

function priceRound(value: number): number {
  return Number(value.toFixed(2));
}

function pricingBand(confidence: PricingConfidence): RecommendationBand {
  return confidence === 'HIGH' ? 'STRONG' : confidence === 'MODERATE' ? 'GOOD' : 'WEAK';
}

function actionabilityBand(actionability: Actionability): RecommendationBand {
  return actionability === 'HIGH' ? 'STRONG' : actionability === 'MODERATE' ? 'GOOD' : 'WEAK';
}

function basisCredit(candidate: Pick<RecommendationCandidate, 'pricing'>): number | null {
  if (candidate.pricing.directBid != null) return candidate.pricing.directBid;
  const range = candidate.pricing.indicativeRange;
  return range ? (range.low + range.high) / 2 : null;
}

function candidateAnnualizedYieldPct(candidate: RecommendationCandidate): number | null {
  if (candidate.pricing.directBid != null) return candidate.economics.annualizedYieldBidPct;
  const range = candidate.economics.indicativeAnnualizedYieldRangePct;
  return range ? (range.low + range.high) / 2 : null;
}

function technicalContextReason(candidate: RecommendationCandidate): RecommendationReasonCode | null {
  const state = candidate.underlying.technicalAssessment.state;
  if (state === 'CONSTRUCTIVE_PULLBACK') return 'CONSTRUCTIVE_PULLBACK_CONTEXT';
  if (state === 'RECOVERY_RECLAIM') return 'RECOVERY_CONTEXT';
  if (state === 'OVERSOLD_INTACT') return 'OVERSOLD_INTACT_CONTEXT';
  if (state === 'EXTENDED') return 'EXTENDED_UNDERLYING';
  if (state === 'TRANSITION_DETERIORATING') return 'DETERIORATING_UNDERLYING';
  return null;
}

function requiredAnnualizedYield(input: {
  regime: RecommendationSnapshot['market']['regime'];
  posture: TradePosture;
  rowDte: number;
  delta: number | null;
  cushion: number | null;
  underlying: UnderlyingAssessment;
  policy: RecommendationPolicy;
}): number {
  const { policy } = input;
  let required = policy.compensation.minimumAnnualizedYieldByRegime[input.regime.label];
  if (input.rowDte < 21) required += policy.compensation.shortDtePremium;
  else if (input.rowDte > 75) required += policy.compensation.longDtePremium;
  else if (input.rowDte > 45) required += policy.compensation.mediumDtePremium;

  if (input.cushion != null) {
    const margin = input.cushion - input.posture.minDistanceToBreakeven;
    if (margin < 0.03) required += policy.compensation.nearMinimumCushionPremium;
    else if (margin < 0.08) required += policy.compensation.moderateCushionPremium;
  }
  if (input.delta != null && Math.abs(input.delta) >= input.posture.maxDelta - 0.03) {
    required += policy.compensation.nearMaximumDeltaPremium;
  }
  if (input.underlying.qualification === 'WATCH') required += policy.compensation.watchUnderlyingPremium;
  return required;
}

function compensationBand(annualizedYieldPct: number | null, requiredPct: number, policy: RecommendationPolicy): RecommendationBand {
  if (annualizedYieldPct == null) return 'WEAK';
  const difference = (annualizedYieldPct - requiredPct) / 100;
  if (difference >= 0.05) return 'STRONG';
  if (difference >= 0) return 'GOOD';
  if (difference >= -policy.compensation.materialAnnualizedYieldDifference) return 'MIXED';
  return 'WEAK';
}

function cushionBand(cushion: number | null, posture: TradePosture): RecommendationBand {
  if (cushion == null) return 'WEAK';
  const margin = cushion - posture.minDistanceToBreakeven;
  if (margin >= 0.1) return 'STRONG';
  if (margin >= 0) return 'GOOD';
  if (margin >= -0.05) return 'MIXED';
  return 'WEAK';
}

function volatilityBand(row: RecommendationCandidate['canonicalRow'], underlying: UnderlyingAssessment): RecommendationBand {
  const range = row.ivVsRealizedRange;
  if (isFiniteNumber(range)) {
    if (range >= 70) return 'STRONG';
    if (range >= 50) return 'GOOD';
    if (range >= 30) return 'MIXED';
    return 'WEAK';
  }
  if (isFiniteNumber(row.iv)) {
    const realized = underlying.metrics.realizedVolatility20;
    if (realized != null && realized > 0) {
      const iv = row.iv / 100;
      if (iv >= realized * 1.35) return 'STRONG';
      if (iv >= realized * 1.1) return 'GOOD';
    }
  }
  return row.iv == null ? 'MIXED' : 'WEAK';
}

function candidateEvidenceQuality(input: {
  underlying: UnderlyingAssessment;
  row: RecommendationCandidate['canonicalRow'];
  pricingConfidence: PricingConfidence;
  chainStale: boolean;
}): RecommendationEvidenceQuality {
  if (input.underlying.evidenceQuality === 'LOW' || input.row.delta == null || input.pricingConfidence === 'LOW' || input.chainStale) return 'LOW';
  const optionalMissing = [input.row.iv, input.row.openInterest, input.row.volume, input.row.lastTradeDate].filter(value => value == null).length;
  if (input.underlying.evidenceQuality === 'MODERATE' || optionalMissing > 0) return 'MODERATE';
  return 'HIGH';
}

function chainFor(snapshot: RecommendationSnapshot, ticker: string, expiration: number) {
  return snapshot.chains.find(chain => chain.ticker === ticker && chain.expiration === expiration)?.data ?? null;
}

function initialPolicyChecks(input: {
  row: RecommendationCandidate['canonicalRow'];
  underlying: UnderlyingAssessment;
  posture: TradePosture;
  breakevenCushion: number | null;
  valid: boolean;
}): RecommendationCandidate['policyChecks'] {
  const strikeCushion = input.row.moneynessPct / 100;
  const checks: RecommendationCandidate['policyChecks'] = [
    { code: 'INVALID_CONTRACT', passed: input.valid, severity: 'BLOCKING', phase: 'VALIDITY', detail: input.valid ? 'Required contract fields and quote ordering are valid.' : 'Required contract fields or quote ordering are invalid.' },
    { code: 'DTE_OUTSIDE_POSTURE', passed: input.row.dte >= input.posture.dteMin && input.row.dte <= input.posture.dteMax, severity: 'INFORMATIONAL', phase: 'DURATION_CONTEXT', detail: `${input.row.dte} DTE versus the contextual ${input.posture.dteMin}–${input.posture.dteMax} posture range; this is not a hard veto.` },
    { code: input.row.delta == null ? 'MISSING_DELTA' : 'INSUFFICIENT_CUSHION', passed: input.row.delta != null && Math.abs(input.row.delta) <= input.posture.maxDelta, severity: 'BLOCKING', phase: 'RISK', detail: input.row.delta == null ? 'Delta unavailable.' : `${Math.abs(input.row.delta).toFixed(3)} absolute Delta versus ${input.posture.maxDelta.toFixed(2)} maximum.` },
    { code: 'INSUFFICIENT_CUSHION', passed: strikeCushion >= input.posture.minDistanceToStrike, severity: 'BLOCKING', phase: 'RISK', detail: `${(strikeCushion * 100).toFixed(1)}% strike cushion versus ${(input.posture.minDistanceToStrike * 100).toFixed(0)}% minimum.` },
    { code: 'INSUFFICIENT_CUSHION', passed: input.breakevenCushion != null && input.breakevenCushion >= input.posture.minDistanceToBreakeven, severity: 'BLOCKING', phase: 'RISK', detail: input.breakevenCushion == null ? 'Breakeven cushion unavailable.' : `${(input.breakevenCushion * 100).toFixed(1)}% breakeven cushion versus ${(input.posture.minDistanceToBreakeven * 100).toFixed(0)}% minimum.` },
    { code: input.underlying.qualification === 'HARD_FAIL' ? 'BROKEN_TREND' : 'SUPPORTIVE_UNDERLYING', passed: input.underlying.qualification === 'ELIGIBLE', severity: 'BLOCKING', phase: 'UNDERLYING', detail: `${input.underlying.setup} setup; ${input.underlying.qualification}.` },
  ];
  return checks;
}

function blockingPolicyChecksPass(candidate: RecommendationCandidate): boolean {
  return candidate.policyChecks.filter(check => check.severity === 'BLOCKING').every(check => check.passed);
}

function validityCheckPasses(candidate: RecommendationCandidate): boolean {
  return candidate.policyChecks.some(check => check.phase === 'VALIDITY' && check.passed);
}

function buildCandidate(
  snapshot: RecommendationSnapshot,
  row: RecommendationSnapshot['screenerRows'][number],
  underlying: UnderlyingAssessment,
  policy: RecommendationPolicy,
): RecommendationCandidate {
  const chain = chainFor(snapshot, row.ticker, row.expDate);
  const validCore = finitePositive(row.currentPrice) && finitePositive(row.strike) && Number.isInteger(row.expDate) && row.expDate > 0 && Number.isInteger(row.dte) && row.dte > 0;
  const quoteCorrupt = row.bid != null && row.ask != null && row.bid > row.ask;
  const pricing = chain
    ? discoverContractPricing({ strike: row.strike, dte: row.dte, chain, asOf: snapshot.asOf, policy })
    : {
      provenance: 'INSUFFICIENT_PRICING_EVIDENCE' as const,
      directBid: null,
      directAsk: row.ask,
      last: row.last,
      lastTradeDate: row.lastTradeDate,
      exactTradeSessionAge: null,
      exactTradeRecency: 'UNAVAILABLE' as const,
      discoveryTier: 'INSUFFICIENT_PRICE_DISCOVERY' as const,
      nearbyTransactionProxy: 'NONE' as const,
      recentNeighborCount: 0,
      closestRecentNeighborDistanceRatio: null,
      recentLowerBracket: false,
      recentUpperBracket: false,
      chainEvidence: { fetchedAt: null, ageMs: null, source: 'unavailable', stale: false },
      indicativeRange: null,
      confidence: 'LOW' as const,
      actionability: 'LOW' as const,
      surface: { bracketed: false, monotonic: false, coherent: false, neighbors: [], reasonCodes: ['PRICING_UNCERTAINTY' as const, 'INSUFFICIENT_PRICE_DISCOVERY' as const] },
    };
  const credit = pricing.directBid ?? (pricing.indicativeRange ? (pricing.indicativeRange.low + pricing.indicativeRange.high) / 2 : null);
  const breakeven = calculateBreakeven(row.strike, credit);
  const breakevenCushion = calculateDownsideCushion(row.currentPrice, breakeven);
  const requiredYield = requiredAnnualizedYield({
    regime: snapshot.market.regime,
    posture: snapshot.market.posture,
    rowDte: row.dte,
    delta: row.delta,
    cushion: breakevenCushion,
    underlying,
    policy,
  });
  const absoluteCredit = calculateCreditForAnnualizedYield(requiredYield, row.strike, row.dte);
  const indicativeLowYield = pricing.indicativeRange ? calculateAnnualizedYield(pricing.indicativeRange.low, row.strike, row.dte) : null;
  const indicativeHighYield = pricing.indicativeRange ? calculateAnnualizedYield(pricing.indicativeRange.high, row.strike, row.dte) : null;
  const indicativeAnnualizedYieldRangePct = indicativeLowYield != null && indicativeHighYield != null
    ? { low: indicativeLowYield * 100, high: indicativeHighYield * 100 }
    : null;
  const chainStale = chain?.chainMeta?.source === 'stale' || chain?.chainMeta?.freshness === 'stale';
  const evidenceQuality = candidateEvidenceQuality({ underlying, row, pricingConfidence: pricing.confidence, chainStale });
  const economicAy = pricing.directBid != null ? row.annYieldBid : indicativeAnnualizedYieldRangePct ? (indicativeAnnualizedYieldRangePct.low + indicativeAnnualizedYieldRangePct.high) / 2 : null;
  const candidate: RecommendationCandidate = {
    id: candidateId(row.ticker, row.expDate, row.strike),
    ticker: row.ticker,
    expiration: row.expDate,
    expirationLabel: row.expLabel,
    dte: row.dte,
    strike: row.strike,
    underlyingPrice: row.currentPrice,
    canonicalRow: { ...row },
    underlying,
    pricing,
    economics: {
      nominalYieldBidPct: pricing.directBid != null ? row.nomYieldBid : null,
      annualizedYieldBidPct: pricing.directBid != null ? row.annYieldBid : null,
      indicativeAnnualizedYieldRangePct,
      delta: row.delta,
      moneynessPct: row.moneynessPct,
      breakevenAtBasis: breakeven,
      breakevenCushionAtBasis: breakevenCushion,
      ivPct: row.iv,
      ivVsRealizedRangePct: row.ivVsRealizedRange,
    },
    minimumAttractiveCredit: {
      absoluteCredit: absoluteCredit == null ? null : priceRound(absoluteCredit),
      relativeFrontierCredit: null,
      credit: absoluteCredit == null ? null : priceRound(absoluteCredit),
      requiredAnnualizedYieldPct: requiredYield * 100,
    },
    lenses: {
      compensation: compensationBand(economicAy, requiredYield * 100, policy),
      cushion: cushionBand(breakevenCushion, snapshot.market.posture),
      volatilityOpportunity: 'MIXED',
      underlyingSetup: underlying.setup,
      pricingConfidence: pricingBand(pricing.confidence),
      actionability: actionabilityBand(pricing.actionability),
    },
    evidenceQuality,
    policyChecks: initialPolicyChecks({ row, underlying, posture: snapshot.market.posture, breakevenCushion, valid: validCore && !quoteCorrupt }),
    dominatedBy: [],
    dominates: [],
    comparisons: [],
    skeptic: { code: 'DOWNSIDE_TAIL_RISK', message: reasonCopy('DOWNSIDE_TAIL_RISK'), veto: false },
    robustness: { classification: 'LOW', stableScenarios: 0, totalScenarios: 0, reasonCodes: [] },
    verdict: 'PASS',
    whyReasonCodes: [],
    tradeoffReasonCodes: [],
    why: '',
    tradeoff: '',
    rank: null,
  };
  candidate.lenses.volatilityOpportunity = volatilityBand(row, underlying);
  return candidate;
}

function comparable(left: RecommendationCandidate, right: RecommendationCandidate, policy: RecommendationPolicy): boolean {
  return left.ticker === right.ticker && Math.abs(left.dte - right.dte) <= policy.comparison.similarDteDays;
}

function materialDominates(left: RecommendationCandidate, right: RecommendationCandidate, policy: RecommendationPolicy): boolean {
  if (!comparable(left, right, policy)) return false;
  if (!blockingPolicyChecksPass(left)) return false;
  const leftAy = candidateAnnualizedYieldPct(left);
  const rightAy = candidateAnnualizedYieldPct(right);
  const leftDelta = left.economics.delta == null ? null : Math.abs(left.economics.delta);
  const rightDelta = right.economics.delta == null ? null : Math.abs(right.economics.delta);
  const leftCushion = left.economics.breakevenCushionAtBasis;
  const rightCushion = right.economics.breakevenCushionAtBasis;
  if (leftAy == null || rightAy == null || leftDelta == null || rightDelta == null || leftCushion == null || rightCushion == null) return false;
  const noDisadvantage = leftAy >= rightAy - policy.compensation.materialAnnualizedYieldDifference * 100
    && leftDelta <= rightDelta + policy.comparison.materialDeltaDifference
    && leftCushion >= rightCushion - policy.comparison.materialCushionDifference
    && CONFIDENCE_RANK[left.pricing.confidence] >= CONFIDENCE_RANK[right.pricing.confidence]
    && ACTIONABILITY_RANK[left.pricing.actionability] >= ACTIONABILITY_RANK[right.pricing.actionability];
  const advantage = leftAy >= rightAy + policy.compensation.materialAnnualizedYieldDifference * 100
    || leftDelta <= rightDelta - policy.comparison.materialDeltaDifference
    || leftCushion >= rightCushion + policy.comparison.materialCushionDifference
    || CONFIDENCE_RANK[left.pricing.confidence] > CONFIDENCE_RANK[right.pricing.confidence]
    || ACTIONABILITY_RANK[left.pricing.actionability] > ACTIONABILITY_RANK[right.pricing.actionability];
  return noDisadvantage && advantage;
}

function applyDominanceAndRelativeHurdles(candidates: RecommendationCandidate[], policy: RecommendationPolicy): void {
  for (const left of candidates) {
    for (const right of candidates) {
      if (left.id === right.id || !materialDominates(left, right, policy)) continue;
      if (!right.dominatedBy.includes(left.id)) right.dominatedBy.push(left.id);
      if (!left.dominates.includes(right.id)) left.dominates.push(right.id);
    }
  }
  candidates.forEach(candidate => {
    const candidateDelta = candidate.economics.delta == null ? null : Math.abs(candidate.economics.delta);
    const candidateCushion = candidate.economics.breakevenCushionAtBasis;
    const safer = candidates.filter(other => {
      if (other.id === candidate.id || !comparable(candidate, other, policy)) return false;
      if (!blockingPolicyChecksPass(other)) return false;
      const otherAy = candidateAnnualizedYieldPct(other);
      const otherDelta = other.economics.delta == null ? null : Math.abs(other.economics.delta);
      const otherCushion = other.economics.breakevenCushionAtBasis;
      if (otherAy == null || candidateDelta == null || otherDelta == null || candidateCushion == null || otherCushion == null) return false;
      return otherDelta <= candidateDelta - policy.comparison.materialDeltaDifference
        || otherCushion >= candidateCushion + policy.comparison.materialCushionDifference;
    });
    const frontierRequiredAy = safer.reduce((maximum, other) => {
      const ay = candidateAnnualizedYieldPct(other);
      return ay == null ? maximum : Math.max(maximum, ay / 100 + policy.compensation.relativeRiskAnnualizedYieldPremium);
    }, 0);
    const relativeCredit = frontierRequiredAy > 0
      ? calculateCreditForAnnualizedYield(frontierRequiredAy, candidate.strike, candidate.dte)
      : null;
    if (relativeCredit != null && candidate.minimumAttractiveCredit.absoluteCredit != null) {
      candidate.minimumAttractiveCredit.relativeFrontierCredit = priceRound(relativeCredit);
      candidate.minimumAttractiveCredit.credit = priceRound(Math.max(candidate.minimumAttractiveCredit.absoluteCredit, relativeCredit));
      candidate.minimumAttractiveCredit.requiredAnnualizedYieldPct = Math.max(candidate.minimumAttractiveCredit.requiredAnnualizedYieldPct, frontierRequiredAy * 100);
    }
    const ay = candidateAnnualizedYieldPct(candidate);
    candidate.lenses.compensation = compensationBand(ay, candidate.minimumAttractiveCredit.requiredAnnualizedYieldPct, policy);
  });
}

function riskPolicyClears(candidate: RecommendationCandidate, posture: TradePosture, deltaTolerance = 0, cushionTolerance = 0): boolean {
  const delta = candidate.economics.delta == null ? null : Math.abs(candidate.economics.delta);
  const strikeCushion = candidate.economics.moneynessPct / 100;
  const breakevenCushion = candidate.economics.breakevenCushionAtBasis;
  return candidate.underlying.qualification === 'ELIGIBLE'
    && validityCheckPasses(candidate)
    && delta != null
    && delta <= posture.maxDelta + deltaTolerance
    && strikeCushion >= posture.minDistanceToStrike + cushionTolerance
    && breakevenCushion != null
    && breakevenCushion >= posture.minDistanceToBreakeven + cushionTolerance;
}

function creditAtScenario(candidate: RecommendationCandidate, scenario: 'BASIS' | 'LOW' | 'HIGH'): number | null {
  if (candidate.pricing.directBid != null) {
    if (scenario === 'LOW') return candidate.pricing.directBid;
    if (scenario === 'HIGH') return candidate.pricing.directAsk ?? candidate.pricing.directBid;
    if (candidate.minimumAttractiveCredit.credit != null && candidate.pricing.directBid < candidate.minimumAttractiveCredit.credit && candidate.pricing.directAsk != null) {
      return (candidate.pricing.directBid + candidate.pricing.directAsk) / 2;
    }
    return candidate.pricing.directBid;
  }
  if (!candidate.pricing.indicativeRange) return null;
  if (scenario === 'LOW') return candidate.pricing.indicativeRange.low;
  if (scenario === 'HIGH') return candidate.pricing.indicativeRange.high;
  return basisCredit(candidate);
}

function classifyRobustness(candidate: RecommendationCandidate, snapshot: RecommendationSnapshot, policy: RecommendationPolicy): RecommendationCandidate['robustness'] {
  const scenarios: Array<{ hurdle: number; delta: number; cushion: number; price: 'BASIS' | 'LOW' | 'HIGH' }> = [
    { hurdle: 0, delta: 0, cushion: 0, price: 'BASIS' },
    { hurdle: policy.robustness.hurdlePerturbation, delta: 0, cushion: 0, price: 'BASIS' },
    { hurdle: -policy.robustness.hurdlePerturbation, delta: 0, cushion: 0, price: 'BASIS' },
    { hurdle: 0, delta: -policy.robustness.materialDeltaPerturbation, cushion: policy.robustness.materialCushionPerturbation, price: 'BASIS' },
    { hurdle: 0, delta: policy.robustness.materialDeltaPerturbation, cushion: -policy.robustness.materialCushionPerturbation, price: 'BASIS' },
    { hurdle: 0, delta: 0, cushion: 0, price: 'LOW' },
    { hurdle: 0, delta: 0, cushion: 0, price: 'HIGH' },
  ];
  const stableScenarios = scenarios.filter(scenario => {
    const credit = creditAtScenario(candidate, scenario.price);
    const adjustedAbsolute = calculateCreditForAnnualizedYield(
      Math.max(0, candidate.minimumAttractiveCredit.requiredAnnualizedYieldPct / 100 + scenario.hurdle),
      candidate.strike,
      candidate.dte,
    );
    if (adjustedAbsolute == null) return false;
    const hurdle = Math.max(candidate.minimumAttractiveCredit.relativeFrontierCredit ?? 0, adjustedAbsolute);
    return credit != null
      && credit >= hurdle
      && riskPolicyClears(candidate, snapshot.market.posture, scenario.delta, scenario.cushion);
  }).length;
  const share = stableScenarios / scenarios.length;
  let classification: RobustnessClassification = share >= policy.robustness.highMinimumStableShare
    ? 'HIGH'
    : share >= policy.robustness.moderateMinimumStableShare
      ? 'MODERATE'
      : 'LOW';
  const effectiveTie = candidate.comparisons.some(comparison => comparison.relationship === 'EFFECTIVE_TIE');
  if (effectiveTie && classification === 'HIGH') classification = 'MODERATE';
  return {
    classification,
    stableScenarios,
    totalScenarios: scenarios.length,
    reasonCodes: [
      ...(classification === 'LOW' ? ['ROBUSTNESS_LOW' as const] : []),
      ...(effectiveTie ? ['NO_CLEAR_LEADER' as const] : []),
    ],
  };
}

function selectSkeptic(candidate: RecommendationCandidate, snapshot: RecommendationSnapshot): RecommendationCandidate['skeptic'] {
  const allRiskChecks = riskPolicyClears(candidate, snapshot.market.posture);
  let code: RecommendationReasonCode = 'DOWNSIDE_TAIL_RISK';
  let veto = false;
  if (candidate.underlying.qualification === 'HARD_FAIL' || candidate.underlying.setup === 'WEAK') {
    code = candidate.lenses.compensation === 'STRONG' ? 'YIELD_TRAP' : 'BROKEN_TREND';
    veto = true;
  } else if (!validityCheckPasses(candidate)) {
    code = 'INVALID_CONTRACT';
    veto = true;
  } else if (!allRiskChecks) {
    code = candidate.economics.delta == null ? 'MISSING_DELTA' : 'INSUFFICIENT_CUSHION';
    veto = true;
  } else if (candidate.dominatedBy.length > 0) {
    code = candidate.comparisons.some(comparison => comparison.reasonCodes.includes('DURATION_NOT_COMPENSATED'))
      ? 'DURATION_NOT_COMPENSATED'
      : candidate.comparisons.some(comparison => comparison.reasonCodes.includes('LONGER_DURATION_DEFENSIVE_VALUE'))
        ? 'LONGER_DURATION_DEFENSIVE_VALUE'
        : 'POOR_RELATIVE_VALUE';
    veto = true;
  } else if (candidate.pricing.discoveryTier === 'INSUFFICIENT_PRICE_DISCOVERY') {
    code = 'INSUFFICIENT_PRICE_DISCOVERY';
    veto = true;
  } else if (candidate.pricing.exactTradeRecency === 'VERY_STALE' && candidate.pricing.nearbyTransactionProxy === 'NONE') {
    code = 'VERY_STALE_TRANSACTION_EVIDENCE';
    veto = true;
  } else if (candidate.pricing.confidence === 'LOW') {
    code = 'PRICING_UNCERTAINTY';
    veto = true;
  } else if (candidate.comparisons.some(comparison => comparison.relationship === 'EFFECTIVE_TIE')) {
    code = 'NO_CLEAR_LEADER';
  } else if (candidate.pricing.actionability === 'LOW') {
    code = 'WEAK_ACTIONABILITY';
  } else if (candidate.lenses.volatilityOpportunity === 'WEAK') {
    code = 'VOLATILITY_NOT_RICH_ENOUGH';
  } else if (candidate.lenses.compensation === 'MIXED' || candidate.lenses.compensation === 'WEAK') {
    code = 'MARGINAL_COMPENSATION';
  }
  return { code, message: reasonCopy(code), veto };
}

function assignVerdict(candidate: RecommendationCandidate, snapshot: RecommendationSnapshot): CandidateVerdict {
  const riskClear = riskPolicyClears(candidate, snapshot.market.posture);
  const hurdle = candidate.minimumAttractiveCredit.credit;
  const directMeets = hurdle != null && candidate.pricing.directBid != null && candidate.pricing.directBid >= hurdle;
  const indicativeReaches = hurdle != null && candidate.pricing.indicativeRange != null && candidate.pricing.indicativeRange.high >= hurdle;
  const askReaches = hurdle != null && candidate.pricing.directAsk != null && candidate.pricing.directAsk >= hurdle;
  const permitsIndicativeConditional = snapshot.market.regime.label !== 'Risk-Off' && snapshot.market.regime.label !== 'Oversold Panic';
  if (candidate.underlying.qualification === 'HARD_FAIL' || !validityCheckPasses(candidate)) return 'PASS';
  if (candidate.dominatedBy.length > 0) return 'WATCH';
  if (directMeets
    && riskClear
    && candidate.pricing.confidence !== 'LOW'
    && candidate.pricing.actionability !== 'LOW'
    && candidate.evidenceQuality !== 'LOW'
    && candidate.robustness.classification !== 'LOW'
    && !candidate.skeptic.veto) return 'ACTIONABLE';
  if (riskClear
    && candidate.underlying.qualification === 'ELIGIBLE'
    && candidate.evidenceQuality !== 'LOW'
    && candidate.robustness.classification !== 'LOW'
    && candidate.pricing.confidence !== 'LOW'
    && !candidate.skeptic.veto
    && ((permitsIndicativeConditional && indicativeReaches) || (!directMeets && candidate.pricing.directBid != null && askReaches))) return 'CONDITIONAL';
  const bestAvailable = candidate.pricing.directBid ?? candidate.pricing.indicativeRange?.high ?? candidate.pricing.directAsk;
  if (hurdle != null && bestAvailable != null && bestAvailable >= hurdle * 0.85) return 'WATCH';
  return candidate.lenses.compensation !== 'WEAK' || candidate.lenses.cushion !== 'WEAK' ? 'WATCH' : 'PASS';
}

function dimensionFacts(left: RecommendationCandidate, right: RecommendationCandidate, policy: RecommendationPolicy): { advantages: string[]; disadvantages: string[] } {
  const advantages: string[] = [];
  const disadvantages: string[] = [];
  const leftAy = candidateAnnualizedYieldPct(left);
  const rightAy = candidateAnnualizedYieldPct(right);
  if (leftAy != null && rightAy != null) {
    const difference = leftAy - rightAy;
    if (difference >= policy.compensation.materialAnnualizedYieldDifference * 100) advantages.push(`${difference.toFixed(1)}pp more AY compensation`);
    if (difference <= -policy.compensation.materialAnnualizedYieldDifference * 100) disadvantages.push(`${Math.abs(difference).toFixed(1)}pp less AY compensation`);
  }
  const leftDelta = left.economics.delta == null ? null : Math.abs(left.economics.delta);
  const rightDelta = right.economics.delta == null ? null : Math.abs(right.economics.delta);
  if (leftDelta != null && rightDelta != null) {
    const difference = rightDelta - leftDelta;
    if (difference >= policy.comparison.materialDeltaDifference) advantages.push(`${difference.toFixed(2)} lower absolute Delta`);
    if (difference <= -policy.comparison.materialDeltaDifference) disadvantages.push(`${Math.abs(difference).toFixed(2)} higher absolute Delta`);
  }
  const leftCushion = left.economics.breakevenCushionAtBasis;
  const rightCushion = right.economics.breakevenCushionAtBasis;
  if (leftCushion != null && rightCushion != null) {
    const difference = leftCushion - rightCushion;
    if (difference >= policy.comparison.materialCushionDifference) advantages.push(`${(difference * 100).toFixed(1)}pp more breakeven cushion`);
    if (difference <= -policy.comparison.materialCushionDifference) disadvantages.push(`${Math.abs(difference * 100).toFixed(1)}pp less breakeven cushion`);
  }
  if (BAND_RANK[left.underlying.setup] > BAND_RANK[right.underlying.setup]) advantages.push('stronger underlying setup');
  if (BAND_RANK[left.underlying.setup] < BAND_RANK[right.underlying.setup]) disadvantages.push('weaker underlying setup');
  if (CONFIDENCE_RANK[left.pricing.confidence] > CONFIDENCE_RANK[right.pricing.confidence]) advantages.push('stronger pricing evidence');
  if (CONFIDENCE_RANK[left.pricing.confidence] < CONFIDENCE_RANK[right.pricing.confidence]) disadvantages.push('weaker pricing evidence');
  if (ACTIONABILITY_RANK[left.pricing.actionability] > ACTIONABILITY_RANK[right.pricing.actionability]) advantages.push('better actionability');
  if (ACTIONABILITY_RANK[left.pricing.actionability] < ACTIONABILITY_RANK[right.pricing.actionability]) disadvantages.push('worse actionability');
  if (EVIDENCE_RANK[left.evidenceQuality] > EVIDENCE_RANK[right.evidenceQuality]) advantages.push('better evidence quality');
  if (EVIDENCE_RANK[left.evidenceQuality] < EVIDENCE_RANK[right.evidenceQuality]) disadvantages.push('weaker evidence quality');
  return { advantages, disadvantages };
}

function isSeriousFinalist(candidate: RecommendationCandidate, snapshot: RecommendationSnapshot): boolean {
  const hurdle = candidate.minimumAttractiveCredit.credit;
  const availableCredits = [candidate.pricing.directBid, candidate.pricing.indicativeRange?.high, candidate.pricing.directAsk]
    .filter((credit): credit is number => credit != null);
  return hurdle != null
    && availableCredits.some(credit => credit >= hurdle)
    && candidate.dominatedBy.length === 0
    && candidate.evidenceQuality !== 'LOW'
    && candidate.pricing.confidence !== 'LOW'
    && riskPolicyClears(candidate, snapshot.market.posture);
}

function comparisonReasonCodes(
  relationship: CandidateComparison['relationship'],
  facts: { advantages: string[]; disadvantages: string[] },
): RecommendationReasonCode[] {
  if (relationship === 'EFFECTIVE_TIE') return ['NO_CLEAR_LEADER'];
  if (relationship === 'TRADEOFF') return ['MARGINAL_COMPENSATION'];
  const materialFacts = relationship === 'OUTRANKS' ? facts.advantages : facts.disadvantages;
  const reasonCodes: RecommendationReasonCode[] = [];
  if (materialFacts.some(fact => fact.includes('AY compensation'))) reasonCodes.push('HIGHER_COMPENSATION_JUSTIFIED');
  if (materialFacts.some(fact => /cushion|Delta/.test(fact))) reasonCodes.push('DEFENSIVE_TRADEOFF_FAVORABLE');
  if (relationship === 'OUTRANKED_BY') reasonCodes.push('POOR_RELATIVE_VALUE');
  return reasonCodes.length > 0 ? reasonCodes : ['MARGINAL_COMPENSATION'];
}

function applyOutranking(candidates: RecommendationCandidate[], snapshot: RecommendationSnapshot, policy: RecommendationPolicy): void {
  const finalists = candidates.filter(candidate => isSeriousFinalist(candidate, snapshot));
  for (let leftIndex = 0; leftIndex < finalists.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < finalists.length; rightIndex += 1) {
      const left = finalists[leftIndex];
      const right = finalists[rightIndex];
      const leftFacts = dimensionFacts(left, right, policy);
      const rightFacts = { advantages: [...leftFacts.disadvantages], disadvantages: [...leftFacts.advantages] };
      const materiallyDifferentDte = Math.abs(left.dte - right.dte) > policy.comparison.similarDteDays;
      const crossDurationPair = left.ticker === right.ticker
        && Math.abs(left.dte - right.dte) >= policy.comparison.crossDurationMinimumDifferenceDays;
      if (crossDurationPair) {
        const shorter = left.dte < right.dte ? left : right;
        const longer = shorter.id === left.id ? right : left;
        const shorterFacts = shorter.id === left.id ? leftFacts : rightFacts;
        const longerFacts = longer.id === left.id ? leftFacts : rightFacts;
        const shorterAy = candidateAnnualizedYieldPct(shorter);
        const longerAy = candidateAnnualizedYieldPct(longer);
        const shorterDelta = shorter.economics.delta == null ? null : Math.abs(shorter.economics.delta);
        const longerDelta = longer.economics.delta == null ? null : Math.abs(longer.economics.delta);
        const shorterCushion = shorter.economics.breakevenCushionAtBasis;
        const longerCushion = longer.economics.breakevenCushionAtBasis;
        const defensiveGain = (shorterDelta != null && longerDelta != null && longerDelta <= shorterDelta - policy.comparison.materialDeltaDifference)
          || (shorterCushion != null && longerCushion != null && longerCushion >= shorterCushion + policy.comparison.materialCushionDifference);
        const limitedYieldGiveUp = shorterAy != null && longerAy != null
          && longerAy >= shorterAy - policy.comparison.longerDurationMaximumDefensiveAyGiveUp * 100;
        const durationCompensatedByYield = shorterAy != null && longerAy != null
          && longerAy >= shorterAy + policy.comparison.longerDurationMinimumAyPremium * 100;
        if (defensiveGain && limitedYieldGiveUp) {
          longerFacts.advantages.push('material defensive value across the longer tenor');
          shorterFacts.disadvantages.push('less defensive value than the longer tenor');
          if (!shorter.dominatedBy.includes(longer.id)) shorter.dominatedBy.push(longer.id);
          if (!longer.dominates.includes(shorter.id)) longer.dominates.push(shorter.id);
          longer.comparisons.push({ otherCandidateId: shorter.id, relationship: 'OUTRANKS', reasonCodes: ['LONGER_DURATION_DEFENSIVE_VALUE'], ...longerFacts });
          shorter.comparisons.push({ otherCandidateId: longer.id, relationship: 'OUTRANKED_BY', reasonCodes: ['LONGER_DURATION_DEFENSIVE_VALUE', 'POOR_RELATIVE_VALUE'], ...shorterFacts });
          continue;
        }
        if (!durationCompensatedByYield && !defensiveGain) {
          shorterFacts.advantages.push(`${longer.dte - shorter.dte} fewer days committed with comparable risk evidence`);
          longerFacts.disadvantages.push('longer duration is not compensated by yield or defensive value');
          if (!longer.dominatedBy.includes(shorter.id)) longer.dominatedBy.push(shorter.id);
          if (!shorter.dominates.includes(longer.id)) shorter.dominates.push(longer.id);
          shorter.comparisons.push({ otherCandidateId: longer.id, relationship: 'OUTRANKS', reasonCodes: ['SHORTER_DURATION_EFFICIENT'], ...shorterFacts });
          longer.comparisons.push({ otherCandidateId: shorter.id, relationship: 'OUTRANKED_BY', reasonCodes: ['DURATION_NOT_COMPENSATED', 'POOR_RELATIVE_VALUE'], ...longerFacts });
          continue;
        }
        const durationFact = `${longer.dte - shorter.dte}-day tenor difference carries explicit duration tradeoffs`;
        shorterFacts.disadvantages.push(durationFact);
        longerFacts.disadvantages.push(durationFact);
        shorter.comparisons.push({ otherCandidateId: longer.id, relationship: 'TRADEOFF', reasonCodes: ['MARGINAL_COMPENSATION'], ...shorterFacts });
        longer.comparisons.push({ otherCandidateId: shorter.id, relationship: 'TRADEOFF', reasonCodes: ['HIGHER_COMPENSATION_JUSTIFIED'], ...longerFacts });
        continue;
      }
      if (materiallyDifferentDte) {
        const fact = `${Math.abs(left.dte - right.dte)}-day DTE difference prevents direct outranking`;
        leftFacts.disadvantages.push(fact);
        rightFacts.disadvantages.push(fact);
      }
      const leftCriticalDisadvantage = leftFacts.disadvantages.some(fact => /cushion|Delta|pricing|actionability|evidence/.test(fact));
      const rightCriticalDisadvantage = rightFacts.disadvantages.some(fact => /cushion|Delta|pricing|actionability|evidence/.test(fact));
      let leftRelationship: CandidateComparison['relationship'] = 'TRADEOFF';
      let rightRelationship: CandidateComparison['relationship'] = 'TRADEOFF';
      if (leftFacts.advantages.length === 0 && leftFacts.disadvantages.length === 0) {
        leftRelationship = 'EFFECTIVE_TIE';
        rightRelationship = 'EFFECTIVE_TIE';
      } else if (!materiallyDifferentDte && leftFacts.advantages.length >= 2 && !leftCriticalDisadvantage) {
        leftRelationship = 'OUTRANKS';
        rightRelationship = 'OUTRANKED_BY';
      } else if (!materiallyDifferentDte && rightFacts.advantages.length >= 2 && !rightCriticalDisadvantage) {
        leftRelationship = 'OUTRANKED_BY';
        rightRelationship = 'OUTRANKS';
      }
      left.comparisons.push({ otherCandidateId: right.id, relationship: leftRelationship, reasonCodes: comparisonReasonCodes(leftRelationship, leftFacts), ...leftFacts });
      right.comparisons.push({ otherCandidateId: left.id, relationship: rightRelationship, reasonCodes: comparisonReasonCodes(rightRelationship, rightFacts), ...rightFacts });
    }
  }
}

function buildDecisionTrace(
  snapshot: RecommendationSnapshot,
  candidates: RecommendationCandidate[],
  selection: ReturnType<typeof buildRankedRecommendationShortlist>,
  policy: RecommendationPolicy,
) {
  const clearsCompensation = (candidate: RecommendationCandidate) => {
    const bestAvailable = candidate.pricing.directBid ?? candidate.pricing.indicativeRange?.high ?? candidate.pricing.directAsk;
    return bestAvailable != null
      && candidate.minimumAttractiveCredit.credit != null
      && bestAvailable >= candidate.minimumAttractiveCredit.credit;
  };
  const surfacedCandidateIds = new Set(selection.selections.map(item => item.candidateId));
  const policySurvivors = candidates.filter(candidate => candidate.verdict === 'ACTIONABLE' || candidate.verdict === 'CONDITIONAL');
  const stages = [
    { key: 'TRACKED_UNDERLYINGS' as const, label: 'Tracked underlyings', count: snapshot.coverage.trackedUnderlyings.length, definition: 'Configured leveraged-ETF opportunity universe.' },
    { key: 'QUALIFIED_UNDERLYINGS' as const, label: 'Qualified underlyings', count: snapshot.coverage.requestedForOptionScan.length, definition: 'Underlyings not hard-failed before option acquisition.' },
    { key: 'UNDERLYING_HARD_FAILS' as const, label: 'Underlying hard-fails', count: snapshot.coverage.hardFailedBeforeChainAcquisition.length, definition: 'Severe ticker-level damage rejected before option acquisition.' },
    { key: 'CHAINS_ACQUIRED' as const, label: 'Chains acquired', count: snapshot.coverage.expirationsCovered.reduce((sum, item) => sum + item.expirationDates.length, 0), definition: 'Selected representative expirations with usable chain responses.' },
    { key: 'CONTRACTS_EVALUATED' as const, label: 'Contracts evaluated', count: candidates.length, definition: 'Contracts inside the run’s bounded DTE universe.' },
    { key: 'INVALID_CONTRACTS' as const, label: 'Invalid contracts', count: candidates.filter(candidate => !validityCheckPasses(candidate)).length, definition: 'Invalid identity, DTE, underlying price, or quote ordering evidence.' },
    { key: 'RISK_POLICY_FAILURES' as const, label: 'Risk-policy failures', count: candidates.filter(candidate => candidate.policyChecks.some(check => check.phase === 'RISK' && check.severity === 'BLOCKING' && !check.passed)).length, definition: 'Delta, strike-cushion, or breakeven-cushion hard gates not cleared.' },
    { key: 'COMPENSATION_FAILURES' as const, label: 'Compensation failures', count: candidates.filter(candidate => !clearsCompensation(candidate)).length, definition: 'Available bid, ask opportunity, or indicative upper bound does not reach the candidate hurdle.' },
    { key: 'PRICING_DISCOVERY_INSUFFICIENCY' as const, label: 'Pricing discovery insufficient', count: candidates.filter(candidate => candidate.pricing.discoveryTier === 'INSUFFICIENT_PRICE_DISCOVERY').length, definition: 'Current and same-expiration transaction evidence cannot establish a usable pricing basis.' },
    { key: 'STALE_TRANSACTION_EVIDENCE' as const, label: 'Stale exact transactions', count: candidates.filter(candidate => candidate.pricing.exactTradeRecency === 'STALE' || candidate.pricing.exactTradeRecency === 'VERY_STALE').length, definition: 'Exact-contract Last is older than the 10-trading-session recent window.' },
    { key: 'ROBUSTNESS_FAILURES' as const, label: 'Robustness failures', count: candidates.filter(candidate => candidate.robustness.classification === 'LOW').length, definition: 'Conclusion fails too many bounded hurdle, risk, or price perturbations.' },
    { key: 'SKEPTIC_VETOES' as const, label: 'Skeptic vetoes', count: candidates.filter(candidate => candidate.skeptic.veto).length, definition: 'Strongest typed objection is severe enough to veto promotion.' },
    { key: 'DOMINANCE_FRONTIER_LOSSES' as const, label: 'Dominance / frontier losses', count: candidates.filter(candidate => candidate.dominatedBy.length > 0).length, definition: 'A comparable contract is materially better or a tenor is not compensated.' },
    { key: 'ACTIONABLE' as const, label: 'Actionable', count: candidates.filter(candidate => candidate.verdict === 'ACTIONABLE').length, definition: 'Direct current economics clear every hard gate with adequate pricing actionability.' },
    { key: 'CONDITIONAL' as const, label: 'Conditional', count: candidates.filter(candidate => candidate.verdict === 'CONDITIONAL').length, definition: 'A bounded price opportunity reaches policy without executable bid economics.' },
    { key: 'WATCH' as const, label: 'Watch', count: candidates.filter(candidate => candidate.verdict === 'WATCH').length, definition: 'Some evidence is useful, but one or more promotion requirements are not met.' },
    { key: 'PASS' as const, label: 'Pass', count: candidates.filter(candidate => candidate.verdict === 'PASS').length, definition: 'Invalid, hard-failed, or economically weak contract.' },
    { key: 'POLICY_SURVIVORS' as const, label: 'Policy survivors', count: selection.policySurvivorCount, definition: 'All genuine Actionable and Conditional contracts before the shortlist cap.' },
    { key: 'SURFACED_SHORTLIST' as const, label: 'Surfaced shortlist', count: surfacedCandidateIds.size, definition: 'Distinct ranked contracts shown in Top Opportunities.' },
    { key: 'SURFACING_CAP_EXCLUDED' as const, label: 'Excluded only by cap', count: selection.capExcluded, definition: `Otherwise eligible policy survivors beyond the maximum ${policy.selection.maximumShortlistSize}-contract shortlist.` },
  ];
  const pricingRejectionCodes = new Set<RecommendationReasonCode>([
    'PRICING_UNCERTAINTY',
    'NO_DIRECT_BID',
    'INSUFFICIENT_PRICE_DISCOVERY',
    'STALE_TRANSACTION_EVIDENCE',
    'VERY_STALE_TRANSACTION_EVIDENCE',
  ]);
  const rejectionCounts = new Map<RecommendationReasonCode, number>();
  candidates.forEach(candidate => {
    const reasons = new Set<RecommendationReasonCode>();
    candidate.policyChecks.filter(check => check.severity === 'BLOCKING' && !check.passed).forEach(check => reasons.add(check.code));
    candidate.pricing.surface.reasonCodes.filter(code => pricingRejectionCodes.has(code)).forEach(code => reasons.add(code));
    candidate.comparisons.filter(comparison => comparison.relationship === 'OUTRANKED_BY').forEach(comparison => comparison.reasonCodes.forEach(code => reasons.add(code)));
    candidate.robustness.reasonCodes.forEach(code => reasons.add(code));
    if (candidate.skeptic.veto || (candidate.verdict !== 'ACTIONABLE' && candidate.verdict !== 'CONDITIONAL')) reasons.add(candidate.skeptic.code);
    if (policySurvivors.includes(candidate) && !surfacedCandidateIds.has(candidate.id)) reasons.add('SHORTLIST_CAP');
    reasons.forEach(code => rejectionCounts.set(code, (rejectionCounts.get(code) ?? 0) + 1));
  });
  const topRejectionReasons = [...rejectionCounts.entries()]
    .map(([code, count]) => ({ code, count, label: reasonCopy(code) }))
    .sort((left, right) => right.count - left.count || left.code.localeCompare(right.code))
    .slice(0, 8);
  return { stages, topRejectionReasons };
}

export function runRecommendationEngine(
  snapshot: RecommendationSnapshot,
  policy: RecommendationPolicy = RECOMMENDATION_POLICY,
): RecommendationRun {
  if (snapshot.engineVersion !== RECOMMENDATION_ENGINE_VERSION || snapshot.policyVersion !== RECOMMENDATION_POLICY_VERSION || policy.version !== RECOMMENDATION_POLICY_VERSION) {
    throw new Error('Unsupported recommendation engine or policy version.');
  }
  const underlyingAssessments = assessUnderlyingUniverse(snapshot.underlyings, snapshot.market.regime, policy);
  const universe = snapshot.universe ?? recommendationUniverse(false);
  const underlyingByTicker = new Map(underlyingAssessments.map(assessment => [assessment.ticker, assessment]));
  const seenContracts = new Set<string>();
  const candidates = [...snapshot.screenerRows]
    .filter(row => row.dte >= universe.minimumDte && row.dte <= universe.maximumDte)
    .sort((left, right) => left.ticker.localeCompare(right.ticker) || left.expDate - right.expDate || left.strike - right.strike)
    .flatMap(row => {
      const id = candidateId(row.ticker, row.expDate, row.strike);
      if (seenContracts.has(id)) return [];
      seenContracts.add(id);
      const underlying = underlyingByTicker.get(row.ticker);
      return underlying ? [buildCandidate(snapshot, row, underlying, policy)] : [];
    });

  applyDominanceAndRelativeHurdles(candidates, policy);
  applyOutranking(candidates, snapshot, policy);
  candidates.forEach(candidate => {
    candidate.skeptic = selectSkeptic(candidate, snapshot);
    candidate.robustness = classifyRobustness(candidate, snapshot, policy);
    if (candidate.robustness.classification === 'LOW' && !candidate.skeptic.veto) {
      candidate.skeptic = { code: 'ROBUSTNESS_LOW', message: reasonCopy('ROBUSTNESS_LOW'), veto: true };
    }
    candidate.verdict = assignVerdict(candidate, snapshot);
    const credit = candidate.pricing.directBid ?? candidate.pricing.indicativeRange?.high ?? null;
    const hurdleCleared = credit != null && candidate.minimumAttractiveCredit.credit != null && credit >= candidate.minimumAttractiveCredit.credit;
    candidate.whyReasonCodes = [
      hurdleCleared ? 'ABSOLUTE_HURDLE_CLEARED' : 'ABSOLUTE_HURDLE_MISSED',
      ...(hurdleCleared && candidate.minimumAttractiveCredit.relativeFrontierCredit != null ? ['RELATIVE_HURDLE_CLEARED' as const] : []),
      ...(candidate.underlying.qualification === 'ELIGIBLE' ? ['SUPPORTIVE_UNDERLYING' as const] : []),
      ...(candidate.lenses.cushion === 'STRONG' ? ['STRONG_CUSHION' as const] : []),
      ...(technicalContextReason(candidate) ? [technicalContextReason(candidate) as RecommendationReasonCode] : []),
      ...candidate.pricing.surface.reasonCodes,
    ];
    candidate.tradeoffReasonCodes = [
      candidate.skeptic.code,
      ...(candidate.pricing.indicativeRange != null
        && candidate.minimumAttractiveCredit.credit != null
        && candidate.pricing.indicativeRange.high < candidate.minimumAttractiveCredit.credit
        ? ['INDICATIVE_BELOW_HURDLE' as const]
        : []),
    ];
    const copy = buildCandidateExplanation(candidate);
    candidate.why = copy.why;
    candidate.tradeoff = copy.tradeoff;
  });
  assignRecommendationRanks(candidates);
  const selection = buildRankedRecommendationShortlist(candidates, policy);
  if (selection.noClearLeader) {
    candidates.filter(candidate => candidate.verdict === 'ACTIONABLE' || candidate.verdict === 'CONDITIONAL').forEach(candidate => {
      if (!candidate.tradeoffReasonCodes.includes('NO_CLEAR_LEADER')) candidate.tradeoffReasonCodes.push('NO_CLEAR_LEADER');
      if (candidate.skeptic.code === 'DOWNSIDE_TAIL_RISK') {
        candidate.skeptic = { code: 'NO_CLEAR_LEADER', message: reasonCopy('NO_CLEAR_LEADER'), veto: false };
        const copy = buildCandidateExplanation(candidate);
        candidate.why = copy.why;
        candidate.tradeoff = copy.tradeoff;
      }
    });
  }
  const operationalStatus = snapshot.coverage.failedBatches.length > 0
    || snapshot.coverage.failedUnderlyings.length > 0
    || snapshot.coverage.pulse.failed > 0
    ? 'INCOMPLETE'
    : 'COMPLETE';
  const hasOpportunities = candidates.some(candidate => candidate.verdict === 'ACTIONABLE' || candidate.verdict === 'CONDITIONAL');
  const runVerdict = operationalStatus === 'INCOMPLETE' ? (hasOpportunities ? 'OPPORTUNITIES_FOUND' : null) : hasOpportunities ? 'OPPORTUNITIES_FOUND' : 'NO_TRADE';
  const nearMisses = candidates
    .filter(candidate => candidate.verdict === 'WATCH')
    .sort((left, right) => {
      const leftCredit = left.pricing.directBid ?? left.pricing.indicativeRange?.high;
      const rightCredit = right.pricing.directBid ?? right.pricing.indicativeRange?.high;
      const leftGap = left.minimumAttractiveCredit.credit == null || leftCredit == null ? Number.MAX_SAFE_INTEGER : Math.max(0, left.minimumAttractiveCredit.credit - leftCredit);
      const rightGap = right.minimumAttractiveCredit.credit == null || rightCredit == null ? Number.MAX_SAFE_INTEGER : Math.max(0, right.minimumAttractiveCredit.credit - rightCredit);
      return leftGap - rightGap || left.id.localeCompare(right.id);
    })
    .slice(0, 3)
    .map(candidate => ({ candidateId: candidate.id, reasonCode: candidate.skeptic.code, text: buildNearMissText(candidate) }));
  const frontiers = [...new Set(underlyingAssessments.map(assessment => assessment.ticker))]
    .sort()
    .map(ticker => ({
      ticker,
      candidateIds: candidates
        .filter(candidate => candidate.ticker === ticker && candidate.dominatedBy.length === 0)
        .sort(compareRecommendationCandidates)
        .map(candidate => candidate.id),
    }));
  const reasonCodes: RecommendationReasonCode[] = [];
  if (!hasOpportunities) reasonCodes.push('WEAK_OPPORTUNITY_SET');
  if (selection.noClearLeader) reasonCodes.push('NO_CLEAR_LEADER');
  const decisionTrace = buildDecisionTrace(snapshot, candidates, selection, policy);

  return {
    engineVersion: RECOMMENDATION_ENGINE_VERSION,
    policyVersion: RECOMMENDATION_POLICY_VERSION,
    asOf: snapshot.asOf,
    universe,
    operationalStatus,
    runVerdict,
    market: snapshot.market,
    coverage: { ...snapshot.coverage },
    underlyingAssessments,
    candidates,
    frontiers,
    recommendations: selection.selections,
    nearMisses,
    decisionTrace,
    reasonCodes,
  };
}

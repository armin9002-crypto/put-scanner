import type { RecommendationCandidate, RecommendationReasonCode } from './types.ts';
import { technicalStateLabel } from '../underlyingTechnical.ts';

const REASON_COPY: Record<RecommendationReasonCode, string> = {
  ABSOLUTE_HURDLE_CLEARED: 'Seller compensation clears the versioned absolute hurdle.',
  ABSOLUTE_HURDLE_MISSED: 'Current seller compensation is below the versioned absolute hurdle.',
  BROKEN_TREND: 'The underlying trend is materially damaged.',
  CLEAN_DIRECT_MARKET: 'A real two-sided market and coherent neighboring strikes support the displayed bid.',
  COHERENT_PRICE_BRACKET: 'Usable same-expiration strikes bracket the contract with coherent market evidence.',
  CONSTRUCTIVE_PULLBACK_CONTEXT: 'Constructive pullback inside an intact longer-term trend.',
  DEFENSIVE_TRADEOFF_FAVORABLE: 'The additional cushion is material relative to the compensation surrendered.',
  DURATION_NOT_COMPENSATED: 'The longer commitment does not add enough yield or defensive value.',
  DOWNSIDE_TAIL_RISK: 'A short put retains assignment and gap risk even with substantial current cushion.',
  DTE_OUTSIDE_POSTURE: 'Days to expiration fall outside the current Market Read posture.',
  DETERIORATING_UNDERLYING: 'Intermediate trend is deteriorating; additional compensation is required.',
  EVIDENCE_GAPS: 'Important technical or contract evidence is unavailable.',
  HIGHER_COMPENSATION_JUSTIFIED: 'Higher compensation is material without a veto-level risk disadvantage.',
  INDICATIVE_BELOW_HURDLE: 'The indicative credit range remains below the minimum attractive credit.',
  INSUFFICIENT_PRICE_DISCOVERY: 'Current and recent same-expiration evidence do not establish a usable price.',
  INSUFFICIENT_CUSHION: 'Strike or breakeven cushion does not clear the current posture.',
  INVALID_CONTRACT: 'Required contract or quote structure is invalid.',
  MARGINAL_COMPENSATION: 'The additional compensation is too small for the added Delta or lost cushion.',
  MISSING_DELTA: 'Delta is unavailable, so the risk policy cannot be fully verified.',
  LONGER_DURATION_DEFENSIVE_VALUE: 'The longer tenor earns consideration through materially better Delta or cushion with limited yield give-up.',
  NO_CLEAR_LEADER: 'Finalists are effectively tied or contain unresolved tradeoffs.',
  NO_DIRECT_BID: 'No displayed seller bid is available.',
  OVERSOLD_INTACT_CONTEXT: 'The underlying is oversold while long-term structure remains intact; that is context, not an automatic bullish signal.',
  POOR_RELATIVE_VALUE: 'A comparable contract is materially better without a critical disadvantage.',
  PRICING_UNCERTAINTY: 'The local same-expiration price surface does not constrain current seller credit reliably.',
  REGIME_INCOMPATIBLE: 'The setup is incompatible with the current defensive market posture.',
  RECENT_DIRECT_TRANSACTION: 'Recent direct trade supports price discovery.',
  RECENT_NEARBY_TRANSACTION_PROXY: 'Recent same-expiration nearby strikes support the current market.',
  RECOVERY_CONTEXT: 'The underlying is reclaiming short-term structure with improving momentum.',
  RELATIVE_HURDLE_CLEARED: 'Compensation clears the premium required over a safer comparable contract.',
  ROBUSTNESS_LOW: 'The conclusion changes under small, explicit policy or price perturbations.',
  SHORTLIST_CAP: 'The contract survived policy but ranked below the maximum shortlist size.',
  STALE_TRANSACTION_EVIDENCE: 'The exact contract transaction is outside the 10-trading-session recent window.',
  SHORTER_DURATION_EFFICIENT: 'The shorter tenor retains comparable economics and risk evidence with less time committed.',
  STRONG_CUSHION: 'Strike and breakeven cushions clear the posture with room to spare.',
  SUPPORTIVE_UNDERLYING: 'Trend, reset, volatility, and regime evidence support the underlying setup.',
  EXTENDED_UNDERLYING: 'The underlying remains extended despite its positive longer-term trend.',
  VERY_STALE_TRANSACTION_EVIDENCE: 'The exact contract transaction is more than 60 U.S. equity trading sessions old.',
  VOLATILITY_NOT_RICH_ENOUGH: 'Volatility compensation is not rich enough relative to the available evidence.',
  WEAK_ACTIONABILITY: 'Execution evidence is weak even if the economics are interesting.',
  WEAK_OPPORTUNITY_SET: 'The analyzed opportunity set does not contain a compelling alternative.',
  YIELD_TRAP: 'High headline yield does not compensate for underlying damage or a policy veto.',
};

export function reasonCopy(code: RecommendationReasonCode): string {
  return REASON_COPY[code];
}

function pct(value: number | null): string {
  return value == null ? '—' : `${value.toFixed(1)}%`;
}

export function buildCandidateExplanation(candidate: RecommendationCandidate): { why: string; tradeoff: string } {
  const annualized = candidate.economics.annualizedYieldBidPct;
  const range = candidate.economics.indicativeAnnualizedYieldRangePct;
  const compensation = annualized != null && candidate.pricing.discoveryTier !== 'INSUFFICIENT_PRICE_DISCOVERY'
    ? `${pct(annualized)} AY at Bid clears a ${pct(candidate.minimumAttractiveCredit.requiredAnnualizedYieldPct)} hurdle`
    : range != null
      ? `The ${pct(range.low)}–${pct(range.high)} indicative AY range reaches a ${pct(candidate.minimumAttractiveCredit.requiredAnnualizedYieldPct)} hurdle`
      : 'Pricing evidence does not establish qualifying seller compensation';
  const deltaEvidence = candidate.economics.delta == null ? 'unavailable Delta' : `${Math.abs(candidate.economics.delta).toFixed(2)} absolute Delta`;
  const durationReason = candidate.comparisons.flatMap(comparison => comparison.reasonCodes)
    .find(code => code === 'LONGER_DURATION_DEFENSIVE_VALUE' || code === 'SHORTER_DURATION_EFFICIENT');
  const technicalState = candidate.underlying.technicalAssessment.state;
  const technicalEvidence = technicalState === 'CONSTRUCTIVE_PULLBACK'
    ? reasonCopy('CONSTRUCTIVE_PULLBACK_CONTEXT')
    : technicalState === 'RECOVERY_RECLAIM'
      ? reasonCopy('RECOVERY_CONTEXT')
      : technicalState === 'OVERSOLD_INTACT'
        ? reasonCopy('OVERSOLD_INTACT_CONTEXT')
        : technicalState === 'EXTENDED'
          ? reasonCopy('EXTENDED_UNDERLYING')
          : technicalState === 'TRANSITION_DETERIORATING'
            ? reasonCopy('DETERIORATING_UNDERLYING')
            : `Shared technical assessment: ${technicalStateLabel(technicalState)}.`;
  const discoveryEvidence = candidate.pricing.discoveryTier === 'DIRECT_RECENT'
    ? reasonCopy('RECENT_DIRECT_TRANSACTION')
    : candidate.pricing.discoveryTier === 'RECENT_NEARBY_CONFIRMED'
      ? `${candidate.pricing.exactTradeRecency === 'STALE' || candidate.pricing.exactTradeRecency === 'VERY_STALE' ? 'Exact contract trade is stale, but ' : ''}${reasonCopy('RECENT_NEARBY_TRANSACTION_PROXY').replace(/^Recent /, 'recent ')}`
      : candidate.pricing.discoveryTier === 'QUOTED_TRANSACTION_STALE'
        ? `${reasonCopy(candidate.pricing.exactTradeRecency === 'VERY_STALE' ? 'VERY_STALE_TRANSACTION_EVIDENCE' : 'STALE_TRANSACTION_EVIDENCE')} Pricing confidence is reduced.`
        : candidate.pricing.discoveryTier === 'INDICATIVE_SURFACE'
          ? reasonCopy('COHERENT_PRICE_BRACKET')
          : reasonCopy('INSUFFICIENT_PRICE_DISCOVERY');
  const why = `${compensation}; ${deltaEvidence} and ${pct(candidate.economics.moneynessPct)} OTM are assessed against a ${candidate.underlying.setup.toLowerCase()} underlying setup. ${technicalEvidence} ${discoveryEvidence}${durationReason ? ` ${reasonCopy(durationReason)}` : ''}`;
  const durationTradeoff = candidate.comparisons.flatMap(comparison => comparison.reasonCodes).find(code => code === 'DURATION_NOT_COMPENSATED');
  const tradeoff = reasonCopy(durationTradeoff ?? candidate.skeptic.code);
  return { why, tradeoff };
}

export function buildNearMissText(candidate: RecommendationCandidate): string {
  return `${candidate.ticker} $${candidate.strike.toFixed(2)} — ${reasonCopy(candidate.skeptic.code)}`;
}

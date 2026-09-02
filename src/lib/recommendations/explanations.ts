import type { RecommendationCandidate, RecommendationReasonCode } from './types.ts';

const REASON_COPY: Record<RecommendationReasonCode, string> = {
  ABSOLUTE_HURDLE_CLEARED: 'Seller compensation clears the versioned absolute hurdle.',
  ABSOLUTE_HURDLE_MISSED: 'Current seller compensation is below the versioned absolute hurdle.',
  BROKEN_TREND: 'The underlying trend is materially damaged.',
  CLEAN_DIRECT_MARKET: 'A real two-sided market and coherent neighboring strikes support the displayed bid.',
  COHERENT_PRICE_BRACKET: 'Usable same-expiration strikes bracket the contract with coherent market evidence.',
  DEFENSIVE_TRADEOFF_FAVORABLE: 'The additional cushion is material relative to the compensation surrendered.',
  DOWNSIDE_TAIL_RISK: 'A short put retains assignment and gap risk even with substantial current cushion.',
  DTE_OUTSIDE_POSTURE: 'Days to expiration fall outside the current Market Read posture.',
  EVIDENCE_GAPS: 'Important technical or contract evidence is unavailable.',
  HIGHER_COMPENSATION_JUSTIFIED: 'Higher compensation is material without a veto-level risk disadvantage.',
  INDICATIVE_BELOW_HURDLE: 'The indicative credit range remains below the minimum attractive credit.',
  INSUFFICIENT_CUSHION: 'Strike or breakeven cushion does not clear the current posture.',
  INVALID_CONTRACT: 'Required contract or quote structure is invalid.',
  MARGINAL_COMPENSATION: 'The additional compensation is too small for the added Delta or lost cushion.',
  MISSING_DELTA: 'Delta is unavailable, so the risk policy cannot be fully verified.',
  NO_CLEAR_LEADER: 'Finalists are effectively tied or contain unresolved tradeoffs.',
  NO_DIRECT_BID: 'No displayed seller bid is available.',
  POOR_RELATIVE_VALUE: 'A comparable contract is materially better without a critical disadvantage.',
  PRICING_UNCERTAINTY: 'The local same-expiration price surface does not constrain current seller credit reliably.',
  REGIME_INCOMPATIBLE: 'The setup is incompatible with the current defensive market posture.',
  RELATIVE_HURDLE_CLEARED: 'Compensation clears the premium required over a safer comparable contract.',
  ROBUSTNESS_LOW: 'The conclusion changes under small, explicit policy or price perturbations.',
  STALE_EVIDENCE: 'Material market evidence is stale.',
  STRONG_CUSHION: 'Strike and breakeven cushions clear the posture with room to spare.',
  SUPPORTIVE_UNDERLYING: 'Trend, reset, volatility, and regime evidence support the underlying setup.',
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
  const compensation = annualized != null
    ? `${pct(annualized)} AY at the displayed bid clears a ${pct(candidate.minimumAttractiveCredit.requiredAnnualizedYieldPct)} hurdle`
    : range != null
      ? `The ${pct(range.low)}–${pct(range.high)} indicative AY range reaches a ${pct(candidate.minimumAttractiveCredit.requiredAnnualizedYieldPct)} hurdle`
      : 'Pricing evidence does not establish qualifying seller compensation';
  const deltaEvidence = candidate.economics.delta == null ? 'unavailable Delta' : `${Math.abs(candidate.economics.delta).toFixed(2)} absolute Delta`;
  const why = `${compensation}; ${deltaEvidence} and ${pct(candidate.economics.moneynessPct)} OTM are assessed against a ${candidate.underlying.setup.toLowerCase()} underlying setup.`;
  const tradeoff = reasonCopy(candidate.skeptic.code);
  return { why, tradeoff };
}

export function buildNearMissText(candidate: RecommendationCandidate): string {
  return `${candidate.ticker} $${candidate.strike.toFixed(2)} — ${reasonCopy(candidate.skeptic.code)}`;
}

import { resolvePortfolioMark } from './portfolioValuation.ts';
import { isFiniteNumber } from './optionMetrics.ts';
import {
  getTradeDistanceToBreakeven,
  getTradeDistanceToStrike,
  getTradeGrossRisk,
} from './portfolioAnalytics.ts';
import {
  calculateCurrentAnnualizedYield,
  calculateCurrentMarkValueAbsolute,
  calculateCurrentOptionMark,
  calculatePercentCaptured,
  calculateRemainingDte,
  type MarkBasis,
} from './portfolioMetrics.ts';
import type { PortfolioTrade } from './portfolioStorage.ts';
import { getPortfolioQuoteFreshness, isPortfolioQuoteDecisionEligible, type PortfolioQuoteFreshnessState } from './portfolioQuoteFreshness.ts';

export const PORTFOLIO_CLOSE_POLICY = Object.freeze({
  highCapture: 0.75,
  standardCapture: 0.50,
  lowAnnualizedRemainingLiability: 0.05,
  smallRemainingOptionMark: 0.05,
  nearExpiryDte: 14,
  nearExpiryBreakevenCushion: 0.20,
});

export const PORTFOLIO_ATTENTION_POLICY = Object.freeze({
  missingBreakevenScore: 20,
  belowBreakevenBaseScore: 120,
  belowBreakevenMaxExtraScore: 60,
  distanceToBreakevenBaseScore: 80,
  belowStrikeScore: 60,
  distanceToStrikeBaseScore: 45,
  expiredScore: 40,
  dteBaseScore: 35,
  maxDeltaScore: 45,
  maxGrossRiskScore: 35,
});

export interface CloseCandidate {
  trade: PortfolioTrade;
  percentCaptured: number | null;
  currentAnnualizedYield: number | null;
  remainingPremium: number | null;
  dte: number | null;
  score: number;
  reasons: string[];
  freshness: PortfolioQuoteFreshnessState;
}

export interface PortfolioAttentionAssessment {
  trade: PortfolioTrade;
  score: number;
  freshness: PortfolioQuoteFreshnessState;
  needsFreshQuote: boolean;
  reasonCodes: PortfolioAttentionReasonCode[];
  reasons: string[];
}

export type PortfolioAttentionReasonCode =
  | 'NEEDS_FRESH_QUOTE'
  | 'CURRENT_BREAKEVEN_UNAVAILABLE'
  | 'BELOW_BREAKEVEN'
  | 'LOW_BREAKEVEN_CUSHION'
  | 'NEAR_STRIKE'
  | 'CURRENT_DELTA_EVIDENCE'
  | 'ELEVATED_CURRENT_DELTA'
  | 'EXPIRED_OR_ZERO_DTE'
  | 'NEAR_MATURITY';

export const PORTFOLIO_ATTENTION_REASON_LABELS: Readonly<Record<PortfolioAttentionReasonCode, string>> = Object.freeze({
  NEEDS_FRESH_QUOTE: 'Needs fresh quote',
  CURRENT_BREAKEVEN_UNAVAILABLE: 'Current breakeven unavailable',
  BELOW_BREAKEVEN: 'Below breakeven',
  LOW_BREAKEVEN_CUSHION: 'Low breakeven cushion',
  NEAR_STRIKE: 'Near strike',
  CURRENT_DELTA_EVIDENCE: 'Current Delta evidence',
  ELEVATED_CURRENT_DELTA: 'Elevated current Delta',
  EXPIRED_OR_ZERO_DTE: 'Expired or 0 DTE',
  NEAR_MATURITY: 'Near maturity',
});

/** Ranking only: every supplied open trade remains eligible for the Top-N list. */
export function buildNeedsAttention(trades: PortfolioTrade[], now = new Date()): PortfolioTrade[] {
  return trades
    .map(trade => assessPortfolioAttention(trade, now))
    .sort((a, b) => b.score - a.score || compareAttentionTrades(a.trade, b.trade))
    .map(assessment => assessment.trade);
}

export function assessPortfolioAttention(trade: PortfolioTrade, now = new Date()): PortfolioAttentionAssessment {
  const freshness = getPortfolioQuoteFreshness(trade, now);
  const quoteEligible = isPortfolioQuoteDecisionEligible(trade, now);
  const distanceToBreakeven = getTradeDistanceToBreakeven(trade);
  const distanceToStrike = getTradeDistanceToStrike(trade);
  const dte = calculateRemainingDte(trade);
  const grossRisk = getTradeGrossRisk(trade) ?? 0;
  const delta = trade.latestMarketData?.delta;
  const reasonCodes: PortfolioAttentionReasonCode[] = [];
  let score = 0;

  if (quoteEligible) {
    if (!isFiniteNumber(distanceToBreakeven)) {
      score += PORTFOLIO_ATTENTION_POLICY.missingBreakevenScore;
      reasonCodes.push('CURRENT_BREAKEVEN_UNAVAILABLE');
    }
    else if (distanceToBreakeven < 0) {
      score += PORTFOLIO_ATTENTION_POLICY.belowBreakevenBaseScore
        + Math.min(PORTFOLIO_ATTENTION_POLICY.belowBreakevenMaxExtraScore, Math.abs(distanceToBreakeven) * 300);
      reasonCodes.push('BELOW_BREAKEVEN');
    } else {
      score += Math.max(0, PORTFOLIO_ATTENTION_POLICY.distanceToBreakevenBaseScore - distanceToBreakeven * 800);
      if (distanceToBreakeven < PORTFOLIO_ATTENTION_POLICY.distanceToBreakevenBaseScore / 800) reasonCodes.push('LOW_BREAKEVEN_CUSHION');
    }

    if (isFiniteNumber(distanceToStrike)) {
      score += distanceToStrike < 0
        ? PORTFOLIO_ATTENTION_POLICY.belowStrikeScore
        : Math.max(0, PORTFOLIO_ATTENTION_POLICY.distanceToStrikeBaseScore - distanceToStrike * 450);
      if (distanceToStrike < PORTFOLIO_ATTENTION_POLICY.distanceToStrikeBaseScore / 450) reasonCodes.push('NEAR_STRIKE');
    }
    if (isFiniteNumber(delta)) {
      score += Math.min(PORTFOLIO_ATTENTION_POLICY.maxDeltaScore, Math.abs(delta) * 70);
      reasonCodes.push(Math.abs(delta) > 0.20 ? 'ELEVATED_CURRENT_DELTA' : 'CURRENT_DELTA_EVIDENCE');
    }
  } else {
    // Quote-dependent components are gated. The trade remains visible as a distinct
    // request for fresh market data instead of receiving a high-confidence risk score.
    score += PORTFOLIO_ATTENTION_POLICY.missingBreakevenScore;
    reasonCodes.push('NEEDS_FRESH_QUOTE');
  }
  if (isFiniteNumber(dte)) {
    score += dte <= 0
      ? PORTFOLIO_ATTENTION_POLICY.expiredScore
      : Math.max(0, PORTFOLIO_ATTENTION_POLICY.dteBaseScore - dte);
    if (dte <= 0) reasonCodes.push('EXPIRED_OR_ZERO_DTE');
    else if (dte < PORTFOLIO_ATTENTION_POLICY.dteBaseScore) reasonCodes.push('NEAR_MATURITY');
  }
  score += Math.min(PORTFOLIO_ATTENTION_POLICY.maxGrossRiskScore, grossRisk / 10_000);

  return {
    trade,
    score,
    freshness: freshness.state,
    needsFreshQuote: !quoteEligible,
    reasonCodes,
    reasons: reasonCodes.map(code => PORTFOLIO_ATTENTION_REASON_LABELS[code]),
  };
}

export function getPortfolioAttentionScore(trade: PortfolioTrade, now = new Date()): number {
  return assessPortfolioAttention(trade, now).score;
}

function compareAttentionTrades(left: PortfolioTrade, right: PortfolioTrade): number {
  const leftStrike = Number.isFinite(left.strike) ? left.strike : Number.POSITIVE_INFINITY;
  const rightStrike = Number.isFinite(right.strike) ? right.strike : Number.POSITIVE_INFINITY;
  const strikeOrder = leftStrike < rightStrike ? -1 : leftStrike > rightStrike ? 1 : 0;

  return left.ticker.trim().toUpperCase().localeCompare(right.ticker.trim().toUpperCase())
    || left.expiration.localeCompare(right.expiration)
    || strikeOrder
    || left.id.localeCompare(right.id);
}

export function buildCloseCandidates(trades: PortfolioTrade[], basis: MarkBasis, now = new Date()): CloseCandidate[] {
  return trades
    .map(trade => {
      const freshness = getPortfolioQuoteFreshness(trade, now);
      const quoteEligible = isPortfolioQuoteDecisionEligible(trade, now);
      const percentCaptured = calculatePercentCaptured(trade, basis);
      const currentAnnualizedYield = calculateCurrentAnnualizedYield(trade, basis);
      const remainingPremium = calculateCurrentMarkValueAbsolute(trade, basis);
      const currentMark = calculateCurrentOptionMark(trade, basis);
      const dte = calculateRemainingDte(trade);
      const breakevenCushion = getTradeDistanceToBreakeven(trade);
      const reasons: string[] = [];

      if (!quoteEligible || resolvePortfolioMark(trade, basis).source === 'last_fallback') return { trade, percentCaptured, currentAnnualizedYield, remainingPremium, dte, score: 0, reasons, freshness: freshness.state };
      if (isFiniteNumber(percentCaptured) && percentCaptured >= PORTFOLIO_CLOSE_POLICY.highCapture) reasons.push('75%+ captured');
      else if (isFiniteNumber(percentCaptured) && percentCaptured >= PORTFOLIO_CLOSE_POLICY.standardCapture) reasons.push('50%+ captured');
      if (isFiniteNumber(percentCaptured)
        && percentCaptured >= PORTFOLIO_CLOSE_POLICY.standardCapture
        && isFiniteNumber(currentAnnualizedYield)
        && currentAnnualizedYield < PORTFOLIO_CLOSE_POLICY.lowAnnualizedRemainingLiability) {
        reasons.push('Low Current AY');
      }
      if (isFiniteNumber(currentMark) && currentMark <= PORTFOLIO_CLOSE_POLICY.smallRemainingOptionMark) reasons.push('small remaining premium');
      if (isFiniteNumber(dte)
        && dte <= PORTFOLIO_CLOSE_POLICY.nearExpiryDte
        && isFiniteNumber(breakevenCushion)
        && breakevenCushion >= PORTFOLIO_CLOSE_POLICY.nearExpiryBreakevenCushion) {
        reasons.push('near expiry with cushion');
      }

      let score = 0;
      if (isFiniteNumber(percentCaptured)) score += percentCaptured * 100;
      if (isFiniteNumber(currentAnnualizedYield)) score += Math.max(0, 20 - currentAnnualizedYield * 200);
      if (isFiniteNumber(currentMark) && currentMark <= PORTFOLIO_CLOSE_POLICY.smallRemainingOptionMark) score += 30;
      if (isFiniteNumber(dte)) score += Math.max(0, 20 - dte);
      if (isFiniteNumber(breakevenCushion)) score += Math.min(20, breakevenCushion * 50);

      return { trade, percentCaptured, currentAnnualizedYield, remainingPremium, dte, score, reasons, freshness: freshness.state };
    })
    .filter(candidate => candidate.reasons.length > 0)
    .sort((a, b) => b.score - a.score);
}

export function getRedeployBadges(trade: PortfolioTrade, basis: MarkBasis): string[] {
  if (!isPortfolioQuoteDecisionEligible(trade)) return [];
  const percentCaptured = calculatePercentCaptured(trade, basis);
  const currentAnnualizedYield = calculateCurrentAnnualizedYield(trade, basis);
  const dte = calculateRemainingDte(trade);
  const badges: string[] = [];

  if (isFiniteNumber(percentCaptured) && percentCaptured >= PORTFOLIO_CLOSE_POLICY.highCapture) badges.push('75%+ Captured');
  else if (isFiniteNumber(percentCaptured) && percentCaptured >= PORTFOLIO_CLOSE_POLICY.standardCapture) badges.push('50%+ Captured');
  if (isFiniteNumber(currentAnnualizedYield) && currentAnnualizedYield < PORTFOLIO_CLOSE_POLICY.lowAnnualizedRemainingLiability) badges.push('Low Current AY');
  if (isFiniteNumber(dte) && dte <= PORTFOLIO_CLOSE_POLICY.nearExpiryDte) badges.push('Near Expiry');

  return badges;
}

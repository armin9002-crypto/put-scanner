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
}

/** Ranking only: every supplied open trade remains eligible for the Top-N list. */
export function buildNeedsAttention(trades: PortfolioTrade[]): PortfolioTrade[] {
  return [...trades].sort((a, b) => getPortfolioAttentionScore(b) - getPortfolioAttentionScore(a));
}

export function assessPortfolioAttention(trade: PortfolioTrade, now = new Date()): PortfolioAttentionAssessment {
  const freshness = getPortfolioQuoteFreshness(trade, now);
  const quoteEligible = isPortfolioQuoteDecisionEligible(trade, now);
  const distanceToBreakeven = getTradeDistanceToBreakeven(trade);
  const distanceToStrike = getTradeDistanceToStrike(trade);
  const dte = calculateRemainingDte(trade);
  const grossRisk = getTradeGrossRisk(trade) ?? 0;
  const delta = trade.latestMarketData?.delta;
  let score = 0;

  if (quoteEligible) {
    if (!isFiniteNumber(distanceToBreakeven)) score += PORTFOLIO_ATTENTION_POLICY.missingBreakevenScore;
    else if (distanceToBreakeven < 0) {
      score += PORTFOLIO_ATTENTION_POLICY.belowBreakevenBaseScore
        + Math.min(PORTFOLIO_ATTENTION_POLICY.belowBreakevenMaxExtraScore, Math.abs(distanceToBreakeven) * 300);
    } else {
      score += Math.max(0, PORTFOLIO_ATTENTION_POLICY.distanceToBreakevenBaseScore - distanceToBreakeven * 800);
    }

    if (isFiniteNumber(distanceToStrike)) {
      score += distanceToStrike < 0
        ? PORTFOLIO_ATTENTION_POLICY.belowStrikeScore
        : Math.max(0, PORTFOLIO_ATTENTION_POLICY.distanceToStrikeBaseScore - distanceToStrike * 450);
    }
    if (isFiniteNumber(delta)) score += Math.min(PORTFOLIO_ATTENTION_POLICY.maxDeltaScore, Math.abs(delta) * 70);
  } else {
    // Quote-dependent components are gated. The trade remains visible as a distinct
    // request for fresh market data instead of receiving a high-confidence risk score.
    score += PORTFOLIO_ATTENTION_POLICY.missingBreakevenScore;
  }
  if (isFiniteNumber(dte)) {
    score += dte <= 0
      ? PORTFOLIO_ATTENTION_POLICY.expiredScore
      : Math.max(0, PORTFOLIO_ATTENTION_POLICY.dteBaseScore - dte);
  }
  score += Math.min(PORTFOLIO_ATTENTION_POLICY.maxGrossRiskScore, grossRisk / 10_000);

  return { trade, score, freshness: freshness.state, needsFreshQuote: !quoteEligible };
}

export function getPortfolioAttentionScore(trade: PortfolioTrade, now = new Date()): number {
  return assessPortfolioAttention(trade, now).score;
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

      if (!quoteEligible) return { trade, percentCaptured, currentAnnualizedYield, remainingPremium, dte, score: 0, reasons, freshness: freshness.state };
      if (isFiniteNumber(percentCaptured) && percentCaptured >= PORTFOLIO_CLOSE_POLICY.highCapture) reasons.push('75%+ captured');
      else if (isFiniteNumber(percentCaptured) && percentCaptured >= PORTFOLIO_CLOSE_POLICY.standardCapture) reasons.push('50%+ captured');
      if (isFiniteNumber(percentCaptured)
        && percentCaptured >= PORTFOLIO_CLOSE_POLICY.standardCapture
        && isFiniteNumber(currentAnnualizedYield)
        && currentAnnualizedYield < PORTFOLIO_CLOSE_POLICY.lowAnnualizedRemainingLiability) {
        reasons.push('low annualized remaining liability');
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
  if (isFiniteNumber(currentAnnualizedYield) && currentAnnualizedYield < PORTFOLIO_CLOSE_POLICY.lowAnnualizedRemainingLiability) badges.push('Low Ann. Remaining Liability');
  if (isFiniteNumber(dte) && dte <= PORTFOLIO_CLOSE_POLICY.nearExpiryDte) badges.push('Near Expiry');

  return badges;
}

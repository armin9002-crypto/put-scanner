import type { RegimeAnalysis, TradePosture } from './types';

export function postureFromRegime(regime: RegimeAnalysis): TradePosture {
  switch (regime.label) {
    case 'Complacent Risk-On':
      return {
        label: 'Selective / Patient',
        styleRecommendation: 'Favor patience, wider cushions, and healthy pullbacks over chasing thin premium.',
        maxDelta: 0.18,
        minDistanceToStrike: 0.25,
        minDistanceToBreakeven: 0.28,
        dteMin: 21,
        dteMax: 60,
        liquidityGuidance: 'Use smaller size if premium is not compelling; do not pay yourself too little for tail risk.',
        explanation: 'Strong trends lower assignment odds, but extended markets can make put premium unattractive.',
      };
    case 'Healthy Risk-On':
      return {
        label: 'Balanced',
        styleRecommendation: 'Favor liquid OTM puts on leaders with clean trend support.',
        maxDelta: 0.2,
        minDistanceToStrike: 0.25,
        minDistanceToBreakeven: 0.28,
        dteMin: 21,
        dteMax: 75,
        liquidityGuidance: 'Avoid extremely wide spreads even in strong trends.',
        explanation: 'Supportive trend and breadth allow balanced put selling, but cushion and bid-side yield still matter.',
      };
    case 'Healthy Pullback':
      return {
        label: 'Opportunistic',
        styleRecommendation: 'Look for controlled pullbacks above long-term trend support.',
        maxDelta: 0.18,
        minDistanceToStrike: 0.28,
        minDistanceToBreakeven: 0.3,
        dteMin: 21,
        dteMax: 60,
        liquidityGuidance: 'Use premium improvement, but do not chase falling knives.',
        explanation: 'Pullbacks can improve entry premiums, especially when the underlying remains above its 200D trend.',
      };
    case 'Choppy / Elevated Vol':
      return {
        label: 'Defensive',
        styleRecommendation: 'Favor smaller, more liquid trades with extra cushion.',
        maxDelta: 0.16,
        minDistanceToStrike: 0.3,
        minDistanceToBreakeven: 0.33,
        dteMin: 21,
        dteMax: 60,
        liquidityGuidance: 'Prefer tighter spreads and avoid weak underlyings below 200D.',
        explanation: 'Elevated volatility can be useful, but the margin of error is thinner.',
      };
    case 'Risk-Off':
    case 'Oversold Panic':
      return {
        label: 'Very Defensive',
        styleRecommendation: 'Scan mainly for awareness; avoid damaged trends unless explicitly speculative.',
        maxDelta: 0.15,
        minDistanceToStrike: 0.35,
        minDistanceToBreakeven: 0.38,
        dteMin: 14,
        dteMax: 45,
        liquidityGuidance: 'Require liquid chains, real bids, and very wide cushion.',
        explanation: 'Trend damage and drawdown risk make assignment quality more important than headline yield.',
      };
    default:
      return {
        label: 'Defensive',
        styleRecommendation: 'Keep filters conservative until regime improves or becomes clearer.',
        maxDelta: 0.17,
        minDistanceToStrike: 0.3,
        minDistanceToBreakeven: 0.33,
        dteMin: 21,
        dteMax: 60,
        liquidityGuidance: 'Let liquidity and cushion filter out marginal setups.',
        explanation: 'When the edge is unclear, the default posture should protect against overtrading.',
      };
  }
}

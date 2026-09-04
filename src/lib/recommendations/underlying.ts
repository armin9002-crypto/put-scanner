import type { EtfPulseRow } from '../etfPulseMetrics.ts';
import type { RegimeAnalysis } from '../marketRead/types.ts';
import { technicalStateLabel, type UnderlyingTechnicalAssessment } from '../underlyingTechnical.ts';
import type { RecommendationPolicyV1 } from './policy.ts';
import { RECOMMENDATION_POLICY_V1 } from './policy.ts';
import type { RecommendationBand, RecommendationReasonCode, UnderlyingAssessment } from './types.ts';

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function pct(value: number | null | undefined): string {
  return finite(value) ? `${(value * 100).toFixed(1)}%` : '—';
}

function trendIntegrity(technical: UnderlyingTechnicalAssessment): RecommendationBand {
  if (technical.signals.structure === 'BROKEN' || technical.state === 'BROKEN_TREND') return 'WEAK';
  if (technical.state === 'STRONG_TREND') return 'STRONG';
  if (technical.signals.structure === 'STRONG' || technical.signals.structure === 'POSITIVE') return 'GOOD';
  return 'MIXED';
}

function resetExtension(technical: UnderlyingTechnicalAssessment): RecommendationBand {
  if (technical.signals.resetExtension === 'EXTENDED') return 'WEAK';
  if (technical.signals.resetExtension === 'CONSTRUCTIVE_RESET' || technical.signals.resetExtension === 'RECOVERING') return 'STRONG';
  if (technical.signals.resetExtension === 'NEUTRAL') return 'GOOD';
  return 'MIXED';
}

function volatilityContext(technical: UnderlyingTechnicalAssessment): RecommendationBand {
  if (technical.signals.volatilityStress === 'STRESSED') return 'WEAK';
  if (technical.signals.volatilityStress === 'NORMAL') return 'GOOD';
  return 'MIXED';
}

function regimeFit(technical: UnderlyingTechnicalAssessment, regime: RegimeAnalysis): RecommendationBand {
  const damaged = technical.signals.structure === 'BROKEN' || technical.state === 'BROKEN_TREND';
  if ((regime.label === 'Risk-Off' || regime.label === 'Oversold Panic') && damaged) return 'WEAK';
  if (regime.label === 'Risk-Off' || regime.label === 'Oversold Panic' || regime.label === 'Choppy / Elevated Vol') {
    return technical.signals.structure === 'STRONG' ? 'GOOD' : 'MIXED';
  }
  if (technical.signals.structure === 'STRONG') return 'STRONG';
  if (technical.signals.structure === 'POSITIVE') return 'GOOD';
  return 'MIXED';
}

function overallSetup(lenses: UnderlyingAssessment['lenses']): RecommendationBand {
  const values = Object.values(lenses);
  const weak = values.filter(value => value === 'WEAK').length;
  const strong = values.filter(value => value === 'STRONG').length;
  const supportive = values.filter(value => value === 'STRONG' || value === 'GOOD').length;
  if (weak >= 2 || lenses.trendIntegrity === 'WEAK') return 'WEAK';
  if (strong >= 2 && weak === 0) return 'STRONG';
  if (supportive >= 3 && weak === 0) return 'GOOD';
  return 'MIXED';
}

export function assessUnderlying(
  row: EtfPulseRow,
  regime: RegimeAnalysis,
  policy: RecommendationPolicyV1 = RECOMMENDATION_POLICY_V1,
): UnderlyingAssessment {
  void policy;
  const technical = row.technicalAssessment;
  const lenses = {
    trendIntegrity: trendIntegrity(technical),
    resetExtension: resetExtension(technical),
    volatilityContext: volatilityContext(technical),
    regimeFit: regimeFit(technical, regime),
  };
  const uncappedSetup = overallSetup(lenses);
  const setup = technical.state === 'OVERSOLD_INTACT' && (uncappedSetup === 'STRONG' || uncappedSetup === 'GOOD')
    ? 'MIXED'
    : uncappedSetup;
  const quality = technical.evidenceQuality;
  const severeTrendDamage = technical.state === 'BROKEN_TREND';
  const regimeDamage = (regime.label === 'Risk-Off' || regime.label === 'Oversold Panic')
    && technical.signals.structure === 'BROKEN';
  const qualification: UnderlyingAssessment['qualification'] = severeTrendDamage || regimeDamage
    ? 'HARD_FAIL'
    : (setup === 'STRONG' || setup === 'GOOD') && quality !== 'LOW'
      ? 'ELIGIBLE'
      : 'WATCH';
  const reasonCodes: RecommendationReasonCode[] = [];
  if (qualification === 'HARD_FAIL') reasonCodes.push('BROKEN_TREND');
  else if (setup === 'STRONG' || setup === 'GOOD') reasonCodes.push('SUPPORTIVE_UNDERLYING');
  if (quality === 'LOW') reasonCodes.push('EVIDENCE_GAPS');
  if (lenses.regimeFit === 'WEAK') reasonCodes.push('REGIME_INCOMPATIBLE');

  return {
    ticker: row.ticker,
    technicalAssessment: technical,
    setup,
    qualification,
    evidenceQuality: quality,
    lenses,
    reasonCodes,
    metrics: {
      realizedVolatility20: finite(row.realizedVolatility20) ? row.realizedVolatility20 : null,
    },
    evidence: [
      { label: 'Technical state', value: technicalStateLabel(technical.state) },
      { label: 'Structure', value: technical.signals.structure },
      { label: 'Momentum', value: technical.signals.momentum },
      { label: 'vs 50D', value: pct(row.distance50) },
      { label: 'vs 200D', value: pct(row.distance200) },
      { label: 'RSI 14', value: finite(row.rsi14) ? row.rsi14.toFixed(1) : '—' },
      { label: 'RSI Δ5', value: finite(row.rsi14Change5) ? row.rsi14Change5.toFixed(1) : '—' },
      { label: 'Recent drawdown', value: pct(row.recentDrawdown30) },
      { label: '20D realized vol', value: pct(row.realizedVolatility20) },
      { label: '20D / 60D RV', value: finite(row.realizedVolatilityAcceleration) ? `${row.realizedVolatilityAcceleration.toFixed(2)}×` : '—' },
      { label: '52W position', value: pct(row.position52Week) },
    ],
  };
}

export function assessUnderlyingUniverse(
  rows: readonly EtfPulseRow[],
  regime: RegimeAnalysis,
  policy: RecommendationPolicyV1 = RECOMMENDATION_POLICY_V1,
): UnderlyingAssessment[] {
  return [...rows]
    .sort((left, right) => left.ticker.localeCompare(right.ticker))
    .map(row => assessUnderlying(row, regime, policy));
}

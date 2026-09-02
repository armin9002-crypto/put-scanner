import type { EtfPulseRow } from '../etfPulseMetrics.ts';
import type { RegimeAnalysis } from '../marketRead/types.ts';
import type { RecommendationPolicyV1 } from './policy.ts';
import { RECOMMENDATION_POLICY_V1 } from './policy.ts';
import type { RecommendationBand, RecommendationReasonCode, UnderlyingAssessment } from './types.ts';

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function pct(value: number | null | undefined): string {
  return finite(value) ? `${(value * 100).toFixed(1)}%` : '—';
}

function evidenceQuality(row: EtfPulseRow, policy: RecommendationPolicyV1): UnderlyingAssessment['evidenceQuality'] {
  const fields = [
    row.price,
    row.distance20,
    row.distance50,
    row.distance200,
    row.rsi14,
    row.realizedVolatility20,
    row.position52Week,
    row.drawdown52Week,
    row.recentDrawdown30,
  ];
  const count = fields.filter(finite).length;
  if (count >= policy.evidence.minimumUnderlyingTechnicalFieldsHigh) return 'HIGH';
  if (count >= policy.evidence.minimumUnderlyingTechnicalFieldsModerate) return 'MODERATE';
  return 'LOW';
}

function trendIntegrity(row: EtfPulseRow): RecommendationBand {
  if (row.trend === 'Downtrend' || (finite(row.distance200) && row.distance200 < -0.08)) return 'WEAK';
  if (row.trend === 'Strong Uptrend' && finite(row.distance50) && row.distance50 > 0 && finite(row.distance200) && row.distance200 > 0) return 'STRONG';
  if (row.trend === 'Uptrend' && finite(row.distance200) && row.distance200 > 0) return 'GOOD';
  if (row.trend === 'Weakening' && finite(row.distance200) && row.distance200 > 0) return 'MIXED';
  return 'MIXED';
}

function resetExtension(row: EtfPulseRow): RecommendationBand {
  const rsi = row.rsi14;
  const recentDrawdown = row.recentDrawdown30;
  if ((finite(rsi) && rsi > 72) || (finite(row.position52Week) && row.position52Week >= 0.97)) return 'WEAK';
  if (finite(recentDrawdown) && recentDrawdown < -0.2) return 'WEAK';
  if (finite(rsi) && rsi >= 38 && rsi <= 58 && finite(recentDrawdown) && recentDrawdown <= -0.02 && recentDrawdown >= -0.12) return 'STRONG';
  if (finite(rsi) && rsi >= 35 && rsi <= 65 && finite(recentDrawdown) && recentDrawdown >= -0.15) return 'GOOD';
  return 'MIXED';
}

function volatilityContext(row: EtfPulseRow): RecommendationBand {
  const rv = row.realizedVolatility20;
  if (!finite(rv)) return 'MIXED';
  if (rv > 1.2 && finite(row.recentDrawdown30) && row.recentDrawdown30 < -0.12) return 'WEAK';
  if (rv >= 0.35 && rv <= 0.75) return 'STRONG';
  if (rv >= 0.2 && rv <= 0.95) return 'GOOD';
  return 'MIXED';
}

function regimeFit(row: EtfPulseRow, regime: RegimeAnalysis): RecommendationBand {
  const damaged = row.trend === 'Downtrend' || (finite(row.distance200) && row.distance200 < -0.05);
  if ((regime.label === 'Risk-Off' || regime.label === 'Oversold Panic') && damaged) return 'WEAK';
  if (regime.label === 'Risk-Off' || regime.label === 'Oversold Panic' || regime.label === 'Choppy / Elevated Vol') {
    return row.trend === 'Strong Uptrend' && finite(row.distance200) && row.distance200 > 0 ? 'GOOD' : 'MIXED';
  }
  if (finite(row.distance200) && row.distance200 > 0 && (row.trend === 'Strong Uptrend' || row.trend === 'Uptrend')) return 'STRONG';
  if (finite(row.distance200) && row.distance200 > 0) return 'GOOD';
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
  const lenses = {
    trendIntegrity: trendIntegrity(row),
    resetExtension: resetExtension(row),
    volatilityContext: volatilityContext(row),
    regimeFit: regimeFit(row, regime),
  };
  const setup = overallSetup(lenses);
  const quality = evidenceQuality(row, policy);
  const severeTrendDamage = row.trend === 'Downtrend'
    && ((finite(row.distance200) && row.distance200 <= -0.08) || (finite(row.recentDrawdown30) && row.recentDrawdown30 <= -0.2));
  const regimeDamage = (regime.label === 'Risk-Off' || regime.label === 'Oversold Panic')
    && row.trend === 'Downtrend'
    && finite(row.distance200)
    && row.distance200 < 0;
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
    setup,
    qualification,
    evidenceQuality: quality,
    lenses,
    reasonCodes,
    metrics: {
      realizedVolatility20: finite(row.realizedVolatility20) ? row.realizedVolatility20 : null,
    },
    evidence: [
      { label: 'Trend', value: row.trend },
      { label: 'vs 50D', value: pct(row.distance50) },
      { label: 'vs 200D', value: pct(row.distance200) },
      { label: 'RSI 14', value: finite(row.rsi14) ? row.rsi14.toFixed(1) : '—' },
      { label: 'Recent drawdown', value: pct(row.recentDrawdown30) },
      { label: '20D realized vol', value: pct(row.realizedVolatility20) },
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

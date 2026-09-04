export const UNDERLYING_TECHNICAL_VERSION = 1 as const;

export const UNDERLYING_TECHNICAL_CONFIG = Object.freeze({
  version: UNDERLYING_TECHNICAL_VERSION,
  lookbacks: {
    annualTradingObservations: 252,
    oneDayReturn: 1,
    fiveDayReturn: 5,
    thirtyDayReturn: 30,
    threeMonthReturn: 63,
    sixMonthReturn: 126,
    oneYearReturn: 252,
    sma20: 20,
    sma50: 50,
    sma200: 200,
    sma20Slope: 5,
    sma50Slope: 10,
    sma200Slope: 20,
    persistence: 20,
    rsi: 14,
    rsiChange: 5,
    realizedVolatility20: 20,
    realizedVolatility60: 60,
    recentDrawdown: 30,
    recoveryLow: 20,
    year: 252,
  },
  evidence: {
    highMinimumCoreFields: 12,
    highMinimumOrthogonalFields: 7,
  },
  structure: {
    positiveDistance50Floor: -0.03,
    strongPersistence50: 0.75,
    strongPersistence200: 0.8,
    brokenDistance200: -0.08,
    brokenRecentDrawdown: -0.2,
  },
  momentum: {
    strongRsiFloor: 55,
    oversoldRsi: 35,
    meaningfulRsiChange: 5,
  },
  reset: {
    constructiveDrawdownMin: -0.15,
    constructiveDrawdownMax: -0.03,
    constructiveDistance20Max: 0.03,
    recoveryFromLow: 0.05,
    recoveryDistance20Floor: -0.01,
  },
  volatility: {
    acceleratingRatio: 1.25,
    elevatedRv20: 0.95,
    stressedRv20: 1.2,
    stressedDrawdown: -0.12,
  },
  extension: {
    rsi: 72,
    overboughtRsi: 70,
    rsiDistance20: 0.04,
    position52Week: 0.97,
    positionDistance20: 0.03,
    distance20: 0.12,
    distance50: 0.18,
  },
} as const);

export type UnderlyingTechnicalState =
  | 'STRONG_TREND'
  | 'CONSTRUCTIVE_PULLBACK'
  | 'OVERSOLD_INTACT'
  | 'RECOVERY_RECLAIM'
  | 'EXTENDED'
  | 'TRANSITION_DETERIORATING'
  | 'BROKEN_TREND'
  | 'RANGE_NEUTRAL'
  | 'INSUFFICIENT_DATA';

export type UnderlyingTechnicalEvidenceQuality = 'HIGH' | 'MODERATE' | 'LOW';
export type UnderlyingStructureSignal = 'STRONG' | 'POSITIVE' | 'MIXED' | 'DETERIORATING' | 'BROKEN' | 'UNAVAILABLE';
export type UnderlyingMomentumSignal = 'STRONG' | 'POSITIVE' | 'NEUTRAL' | 'OVERSOLD' | 'DETERIORATING' | 'UNAVAILABLE';
export type UnderlyingResetExtensionSignal = 'CONSTRUCTIVE_RESET' | 'RECOVERING' | 'OVERSOLD' | 'EXTENDED' | 'NEUTRAL' | 'UNAVAILABLE';
export type UnderlyingVolatilityStressSignal = 'NORMAL' | 'ACCELERATING' | 'ELEVATED' | 'STRESSED' | 'UNAVAILABLE';
export type UnderlyingMaStack = 'BULLISH' | 'BEARISH' | 'MIXED' | 'UNAVAILABLE';

export type UnderlyingTechnicalReasonCode =
  | 'COMPLETE_TECHNICAL_EVIDENCE'
  | 'PARTIAL_TECHNICAL_EVIDENCE'
  | 'INSUFFICIENT_TECHNICAL_EVIDENCE'
  | 'BULLISH_MA_STACK'
  | 'BEARISH_MA_STACK'
  | 'LONG_TERM_STRUCTURE_INTACT'
  | 'LONG_TERM_STRUCTURE_BROKEN'
  | 'POSITIVE_TREND_PERSISTENCE'
  | 'CONTROLLED_PULLBACK'
  | 'OVERSOLD_NOT_BULLISH'
  | 'MOMENTUM_IMPROVING'
  | 'MOMENTUM_DETERIORATING'
  | 'VOLATILITY_ACCELERATING'
  | 'VOLATILITY_STRESSED'
  | 'EXTENSION_RISK'
  | 'RANGE_BOUND';

export interface UnderlyingTechnicalMetrics {
  latest: number | null;
  returns: {
    oneDay: number | null;
    fiveDay: number | null;
    thirtyDay: number | null;
    threeMonth: number | null;
    sixMonth: number | null;
    oneYear: number | null;
  };
  rsi14: number | null;
  rsi14Change5: number | null;
  realizedVolatility20: number | null;
  realizedVolatility60: number | null;
  realizedVolatilityAcceleration: number | null;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  distance20: number | null;
  distance50: number | null;
  distance200: number | null;
  sma20Slope5: number | null;
  sma50Slope10: number | null;
  sma200Slope20: number | null;
  persistenceAbove50: number | null;
  persistenceAbove200: number | null;
  maStack: UnderlyingMaStack;
  recentDrawdown30: number | null;
  recoveryFromLow20: number | null;
  percentOf52WeekHigh: number | null;
  position52Week: number | null;
  drawdown52Week: number | null;
}

export interface UnderlyingTechnicalAssessment {
  version: typeof UNDERLYING_TECHNICAL_VERSION;
  state: UnderlyingTechnicalState;
  evidenceQuality: UnderlyingTechnicalEvidenceQuality;
  signals: {
    structure: UnderlyingStructureSignal;
    momentum: UnderlyingMomentumSignal;
    resetExtension: UnderlyingResetExtensionSignal;
    volatilityStress: UnderlyingVolatilityStressSignal;
  };
  reasonCodes: UnderlyingTechnicalReasonCode[];
  metrics: UnderlyingTechnicalMetrics;
}

export const UNDERLYING_TECHNICAL_STATE_LABELS: Readonly<Record<UnderlyingTechnicalState, string>> = Object.freeze({
  STRONG_TREND: 'Strong Trend',
  CONSTRUCTIVE_PULLBACK: 'Constructive Pullback',
  OVERSOLD_INTACT: 'Oversold Intact',
  RECOVERY_RECLAIM: 'Recovery / Reclaim',
  EXTENDED: 'Extended',
  TRANSITION_DETERIORATING: 'Deteriorating',
  BROKEN_TREND: 'Broken Trend',
  RANGE_NEUTRAL: 'Range / Neutral',
  INSUFFICIENT_DATA: 'Insufficient Data',
});

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function technicalEvidenceQuality(metrics: UnderlyingTechnicalMetrics): UnderlyingTechnicalEvidenceQuality {
  const core = [
    metrics.latest,
    metrics.distance20,
    metrics.distance50,
    metrics.distance200,
    metrics.returns.fiveDay,
    metrics.returns.thirtyDay,
    metrics.returns.threeMonth,
    metrics.rsi14,
    metrics.realizedVolatility20,
    metrics.recentDrawdown30,
    metrics.position52Week,
    metrics.drawdown52Week,
  ].filter(finite).length;
  const orthogonal = [
    metrics.rsi14Change5,
    metrics.realizedVolatility60,
    metrics.realizedVolatilityAcceleration,
    metrics.sma20Slope5,
    metrics.sma50Slope10,
    metrics.sma200Slope20,
    metrics.persistenceAbove50,
    metrics.persistenceAbove200,
    metrics.recoveryFromLow20,
  ].filter(finite).length;
  if (core >= UNDERLYING_TECHNICAL_CONFIG.evidence.highMinimumCoreFields
    && orthogonal >= UNDERLYING_TECHNICAL_CONFIG.evidence.highMinimumOrthogonalFields) return 'HIGH';
  const essential = [
    metrics.latest,
    metrics.distance20,
    metrics.distance50,
    metrics.distance200,
    metrics.returns.thirtyDay,
    metrics.rsi14,
    metrics.realizedVolatility20,
    metrics.recentDrawdown30,
  ];
  return essential.every(finite) ? 'MODERATE' : 'LOW';
}

function structureSignal(metrics: UnderlyingTechnicalMetrics): UnderlyingStructureSignal {
  const { distance20, distance50, distance200 } = metrics;
  if (!finite(distance20) || !finite(distance50) || !finite(distance200)) return 'UNAVAILABLE';
  if (distance50 < 0 && distance200 < 0) return 'BROKEN';
  const nonNegativeSlope50 = metrics.sma50Slope10 == null || metrics.sma50Slope10 >= 0;
  const nonNegativeSlope200 = metrics.sma200Slope20 == null || metrics.sma200Slope20 >= 0;
  const persistent50 = metrics.persistenceAbove50 == null || metrics.persistenceAbove50 >= UNDERLYING_TECHNICAL_CONFIG.structure.strongPersistence50;
  const persistent200 = metrics.persistenceAbove200 == null || metrics.persistenceAbove200 >= UNDERLYING_TECHNICAL_CONFIG.structure.strongPersistence200;
  if (metrics.maStack === 'BULLISH'
    && distance20 > 0
    && distance50 > 0
    && distance200 > 0
    && nonNegativeSlope50
    && nonNegativeSlope200
    && persistent50
    && persistent200) return 'STRONG';
  if (distance200 > 0 && distance50 >= UNDERLYING_TECHNICAL_CONFIG.structure.positiveDistance50Floor) return 'POSITIVE';
  if (distance20 < 0 || distance50 < 0 || (finite(metrics.sma20Slope5) && metrics.sma20Slope5 < 0) || (finite(metrics.sma50Slope10) && metrics.sma50Slope10 < 0)) return 'DETERIORATING';
  return 'MIXED';
}

function momentumSignal(metrics: UnderlyingTechnicalMetrics): UnderlyingMomentumSignal {
  const { fiveDay, thirtyDay, threeMonth } = metrics.returns;
  const { rsi14 } = metrics;
  if (!finite(fiveDay) || !finite(thirtyDay) || !finite(threeMonth) || !finite(rsi14)) return 'UNAVAILABLE';
  if (rsi14 < UNDERLYING_TECHNICAL_CONFIG.momentum.oversoldRsi && fiveDay <= 0) return 'OVERSOLD';
  if ((fiveDay < 0 && thirtyDay < 0)
    || (finite(metrics.rsi14Change5) && metrics.rsi14Change5 <= -UNDERLYING_TECHNICAL_CONFIG.momentum.meaningfulRsiChange)) return 'DETERIORATING';
  if (fiveDay > 0 && thirtyDay > 0 && threeMonth > 0
    && rsi14 >= UNDERLYING_TECHNICAL_CONFIG.momentum.strongRsiFloor
    && (metrics.rsi14Change5 == null || metrics.rsi14Change5 >= 0)) return 'STRONG';
  if (thirtyDay > 0 && threeMonth > 0) return 'POSITIVE';
  return 'NEUTRAL';
}

function volatilityStressSignal(metrics: UnderlyingTechnicalMetrics): UnderlyingVolatilityStressSignal {
  if (!finite(metrics.realizedVolatility20)) return 'UNAVAILABLE';
  if (metrics.realizedVolatility20 >= UNDERLYING_TECHNICAL_CONFIG.volatility.stressedRv20
    && finite(metrics.recentDrawdown30)
    && metrics.recentDrawdown30 <= UNDERLYING_TECHNICAL_CONFIG.volatility.stressedDrawdown) return 'STRESSED';
  if (finite(metrics.realizedVolatilityAcceleration)
    && metrics.realizedVolatilityAcceleration >= UNDERLYING_TECHNICAL_CONFIG.volatility.acceleratingRatio) return 'ACCELERATING';
  if (metrics.realizedVolatility20 >= UNDERLYING_TECHNICAL_CONFIG.volatility.elevatedRv20) return 'ELEVATED';
  return 'NORMAL';
}

function resetExtensionSignal(metrics: UnderlyingTechnicalMetrics): UnderlyingResetExtensionSignal {
  const { rsi14, distance20, distance50, distance200, recentDrawdown30 } = metrics;
  if (!finite(rsi14) || !finite(distance20) || !finite(distance50) || !finite(distance200) || !finite(recentDrawdown30)) return 'UNAVAILABLE';
  const extended = (rsi14 > UNDERLYING_TECHNICAL_CONFIG.extension.rsi && distance20 >= UNDERLYING_TECHNICAL_CONFIG.extension.rsiDistance20)
    || (finite(metrics.position52Week) && metrics.position52Week >= UNDERLYING_TECHNICAL_CONFIG.extension.position52Week && distance20 >= UNDERLYING_TECHNICAL_CONFIG.extension.positionDistance20)
    || distance20 >= UNDERLYING_TECHNICAL_CONFIG.extension.distance20
    || distance50 >= UNDERLYING_TECHNICAL_CONFIG.extension.distance50;
  if (extended) return 'EXTENDED';
  if (distance200 > 0 && rsi14 < UNDERLYING_TECHNICAL_CONFIG.momentum.oversoldRsi) return 'OVERSOLD';
  const recovering = finite(metrics.recoveryFromLow20)
    && metrics.recoveryFromLow20 >= UNDERLYING_TECHNICAL_CONFIG.reset.recoveryFromLow
    && finite(metrics.rsi14Change5)
    && metrics.rsi14Change5 >= UNDERLYING_TECHNICAL_CONFIG.momentum.meaningfulRsiChange
    && finite(metrics.returns.fiveDay)
    && metrics.returns.fiveDay > 0
    && distance20 >= UNDERLYING_TECHNICAL_CONFIG.reset.recoveryDistance20Floor
    && distance50 >= UNDERLYING_TECHNICAL_CONFIG.structure.positiveDistance50Floor;
  if (recovering) return 'RECOVERING';
  if (distance200 > 0
    && recentDrawdown30 >= UNDERLYING_TECHNICAL_CONFIG.reset.constructiveDrawdownMin
    && recentDrawdown30 <= UNDERLYING_TECHNICAL_CONFIG.reset.constructiveDrawdownMax
    && distance50 >= UNDERLYING_TECHNICAL_CONFIG.structure.positiveDistance50Floor
    && distance20 <= UNDERLYING_TECHNICAL_CONFIG.reset.constructiveDistance20Max) return 'CONSTRUCTIVE_RESET';
  return 'NEUTRAL';
}

function stateFor(metrics: UnderlyingTechnicalMetrics, evidenceQuality: UnderlyingTechnicalEvidenceQuality, signals: UnderlyingTechnicalAssessment['signals']): UnderlyingTechnicalState {
  if (evidenceQuality === 'LOW') return 'INSUFFICIENT_DATA';
  const severeBroken = signals.structure === 'BROKEN'
    && ((finite(metrics.distance200) && metrics.distance200 <= UNDERLYING_TECHNICAL_CONFIG.structure.brokenDistance200)
      || (finite(metrics.recentDrawdown30) && metrics.recentDrawdown30 <= UNDERLYING_TECHNICAL_CONFIG.structure.brokenRecentDrawdown));
  if (severeBroken) return 'BROKEN_TREND';
  if (signals.resetExtension === 'EXTENDED') return 'EXTENDED';
  if (signals.resetExtension === 'OVERSOLD') return 'OVERSOLD_INTACT';
  if (signals.resetExtension === 'RECOVERING') return 'RECOVERY_RECLAIM';
  if (signals.resetExtension === 'CONSTRUCTIVE_RESET' && signals.volatilityStress !== 'STRESSED') return 'CONSTRUCTIVE_PULLBACK';
  if (signals.structure === 'STRONG' && signals.momentum === 'STRONG') return 'STRONG_TREND';
  if (signals.structure === 'BROKEN' || signals.structure === 'DETERIORATING' || signals.momentum === 'DETERIORATING' || signals.volatilityStress === 'STRESSED') return 'TRANSITION_DETERIORATING';
  return 'RANGE_NEUTRAL';
}

function reasonsFor(assessment: Omit<UnderlyingTechnicalAssessment, 'reasonCodes' | 'version'>): UnderlyingTechnicalReasonCode[] {
  const reasons: UnderlyingTechnicalReasonCode[] = [];
  if (assessment.evidenceQuality === 'HIGH') reasons.push('COMPLETE_TECHNICAL_EVIDENCE');
  else if (assessment.evidenceQuality === 'MODERATE') reasons.push('PARTIAL_TECHNICAL_EVIDENCE');
  else reasons.push('INSUFFICIENT_TECHNICAL_EVIDENCE');
  if (assessment.metrics.maStack === 'BULLISH') reasons.push('BULLISH_MA_STACK');
  if (assessment.metrics.maStack === 'BEARISH') reasons.push('BEARISH_MA_STACK');
  if (finite(assessment.metrics.distance200) && assessment.metrics.distance200 > 0) reasons.push('LONG_TERM_STRUCTURE_INTACT');
  if (assessment.signals.structure === 'BROKEN') reasons.push('LONG_TERM_STRUCTURE_BROKEN');
  if ((assessment.metrics.persistenceAbove50 ?? 0) >= UNDERLYING_TECHNICAL_CONFIG.structure.strongPersistence50) reasons.push('POSITIVE_TREND_PERSISTENCE');
  if (assessment.signals.resetExtension === 'CONSTRUCTIVE_RESET') reasons.push('CONTROLLED_PULLBACK');
  if (assessment.signals.resetExtension === 'OVERSOLD') reasons.push('OVERSOLD_NOT_BULLISH');
  if (assessment.signals.resetExtension === 'RECOVERING') reasons.push('MOMENTUM_IMPROVING');
  if (assessment.signals.momentum === 'DETERIORATING') reasons.push('MOMENTUM_DETERIORATING');
  if (assessment.signals.volatilityStress === 'ACCELERATING') reasons.push('VOLATILITY_ACCELERATING');
  if (assessment.signals.volatilityStress === 'STRESSED') reasons.push('VOLATILITY_STRESSED');
  if (assessment.signals.resetExtension === 'EXTENDED') reasons.push('EXTENSION_RISK');
  if (assessment.state === 'RANGE_NEUTRAL') reasons.push('RANGE_BOUND');
  return reasons;
}

export function assessUnderlyingTechnicalMetrics(metrics: UnderlyingTechnicalMetrics): UnderlyingTechnicalAssessment {
  const evidenceQuality = technicalEvidenceQuality(metrics);
  const signals = {
    structure: structureSignal(metrics),
    momentum: momentumSignal(metrics),
    resetExtension: resetExtensionSignal(metrics),
    volatilityStress: volatilityStressSignal(metrics),
  };
  const state = stateFor(metrics, evidenceQuality, signals);
  const withoutReasons = { state, evidenceQuality, signals, metrics };
  return {
    version: UNDERLYING_TECHNICAL_VERSION,
    ...withoutReasons,
    reasonCodes: reasonsFor(withoutReasons),
  };
}

export function technicalStateLabel(state: UnderlyingTechnicalState): string {
  return UNDERLYING_TECHNICAL_STATE_LABELS[state];
}

export function isUnderlyingTechnicalAssessment(value: unknown): value is UnderlyingTechnicalAssessment {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<UnderlyingTechnicalAssessment>;
  return candidate.version === UNDERLYING_TECHNICAL_VERSION
    && typeof candidate.state === 'string'
    && Object.prototype.hasOwnProperty.call(UNDERLYING_TECHNICAL_STATE_LABELS, candidate.state)
    && (candidate.evidenceQuality === 'HIGH' || candidate.evidenceQuality === 'MODERATE' || candidate.evidenceQuality === 'LOW')
    && !!candidate.signals
    && !!candidate.metrics
    && Array.isArray(candidate.reasonCodes);
}

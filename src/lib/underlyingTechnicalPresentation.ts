import type {
  UnderlyingMomentumSignal,
  UnderlyingResetExtensionSignal,
  UnderlyingStructureSignal,
  UnderlyingTechnicalAssessment,
  UnderlyingTechnicalEvidenceQuality,
  UnderlyingTechnicalReasonCode,
  UnderlyingTechnicalState,
  UnderlyingVolatilityStressSignal,
} from './underlyingTechnical.ts';
import { technicalStateLabel } from './underlyingTechnical.ts';

export type TechnicalPresentationTone = 'positive' | 'constructive' | 'caution' | 'warning' | 'danger' | 'neutral' | 'muted';

export interface UnderlyingTechnicalStatePresentation {
  state: UnderlyingTechnicalState;
  label: string;
  tone: TechnicalPresentationTone;
  color: string;
  backgroundColor: string;
  borderColor: string;
  accessibleLabel: string;
}

export interface UnderlyingTechnicalEvidencePresentation {
  quality: UnderlyingTechnicalEvidenceQuality;
  label: string;
  tone: TechnicalPresentationTone;
  color: string;
  accessibleLabel: string;
}

export const UNDERLYING_TECHNICAL_STATE_PRESENTATION: Readonly<Record<UnderlyingTechnicalState, UnderlyingTechnicalStatePresentation>> = Object.freeze({
  STRONG_TREND: {
    state: 'STRONG_TREND', label: technicalStateLabel('STRONG_TREND'), tone: 'positive',
    color: 'var(--green)', backgroundColor: 'rgba(34,197,94,0.10)', borderColor: 'rgba(34,197,94,0.25)',
    accessibleLabel: 'Strong Trend; favorable technical state.',
  },
  CONSTRUCTIVE_PULLBACK: {
    state: 'CONSTRUCTIVE_PULLBACK', label: technicalStateLabel('CONSTRUCTIVE_PULLBACK'), tone: 'constructive',
    color: 'var(--green)', backgroundColor: 'rgba(34,197,94,0.06)', borderColor: 'rgba(34,197,94,0.18)',
    accessibleLabel: 'Constructive Pullback; intact trend with a controlled reset.',
  },
  OVERSOLD_INTACT: {
    state: 'OVERSOLD_INTACT', label: technicalStateLabel('OVERSOLD_INTACT'), tone: 'constructive',
    color: 'var(--accent-light)', backgroundColor: 'var(--accent-bg)', borderColor: 'var(--accent-border)',
    accessibleLabel: 'Oversold Intact; oversold conditions with intact long-term structure.',
  },
  RECOVERY_RECLAIM: {
    state: 'RECOVERY_RECLAIM', label: technicalStateLabel('RECOVERY_RECLAIM'), tone: 'positive',
    color: 'var(--green)', backgroundColor: 'rgba(34,197,94,0.06)', borderColor: 'rgba(34,197,94,0.18)',
    accessibleLabel: 'Recovery / Reclaim; improving technical structure.',
  },
  EXTENDED: {
    state: 'EXTENDED', label: technicalStateLabel('EXTENDED'), tone: 'caution',
    color: 'var(--orange)', backgroundColor: 'rgba(251,146,60,0.10)', borderColor: 'rgba(251,146,60,0.28)',
    accessibleLabel: 'Extended; extension risk is elevated.',
  },
  TRANSITION_DETERIORATING: {
    state: 'TRANSITION_DETERIORATING', label: technicalStateLabel('TRANSITION_DETERIORATING'), tone: 'warning',
    color: 'var(--yellow)', backgroundColor: 'rgba(250,204,21,0.10)', borderColor: 'rgba(250,204,21,0.25)',
    accessibleLabel: 'Deteriorating; technical conditions are weakening.',
  },
  BROKEN_TREND: {
    state: 'BROKEN_TREND', label: technicalStateLabel('BROKEN_TREND'), tone: 'danger',
    color: 'var(--red)', backgroundColor: 'rgba(239,68,68,0.10)', borderColor: 'rgba(239,68,68,0.25)',
    accessibleLabel: 'Broken Trend; adverse technical state.',
  },
  RANGE_NEUTRAL: {
    state: 'RANGE_NEUTRAL', label: technicalStateLabel('RANGE_NEUTRAL'), tone: 'neutral',
    color: 'var(--text-muted)', backgroundColor: 'var(--surface-alt)', borderColor: 'var(--border)',
    accessibleLabel: 'Range / Neutral; no directional technical state.',
  },
  INSUFFICIENT_DATA: {
    state: 'INSUFFICIENT_DATA', label: technicalStateLabel('INSUFFICIENT_DATA'), tone: 'muted',
    color: 'var(--text-dim)', backgroundColor: 'var(--surface-alt)', borderColor: 'var(--border)',
    accessibleLabel: 'Insufficient Data; technical state is unavailable.',
  },
});

export const UNDERLYING_TECHNICAL_EVIDENCE_PRESENTATION: Readonly<Record<UnderlyingTechnicalEvidenceQuality, UnderlyingTechnicalEvidencePresentation>> = Object.freeze({
  HIGH: { quality: 'HIGH', label: 'High', tone: 'positive', color: 'var(--green)', accessibleLabel: 'High technical evidence quality.' },
  MODERATE: { quality: 'MODERATE', label: 'Moderate', tone: 'caution', color: 'var(--yellow)', accessibleLabel: 'Moderate technical evidence quality.' },
  LOW: { quality: 'LOW', label: 'Low', tone: 'muted', color: 'var(--text-dim)', accessibleLabel: 'Low technical evidence quality.' },
});

export const UNDERLYING_TECHNICAL_SIGNAL_LABELS = Object.freeze({
  structure: {
    STRONG: 'Strong', POSITIVE: 'Positive', MIXED: 'Mixed', DETERIORATING: 'Deteriorating', BROKEN: 'Broken', UNAVAILABLE: 'Unavailable',
  } satisfies Record<UnderlyingStructureSignal, string>,
  momentum: {
    STRONG: 'Strong', POSITIVE: 'Positive', NEUTRAL: 'Neutral', OVERSOLD: 'Oversold', DETERIORATING: 'Deteriorating', UNAVAILABLE: 'Unavailable',
  } satisfies Record<UnderlyingMomentumSignal, string>,
  resetExtension: {
    CONSTRUCTIVE_RESET: 'Constructive Reset', RECOVERING: 'Recovering', OVERSOLD: 'Oversold', EXTENDED: 'Extended', NEUTRAL: 'Neutral', UNAVAILABLE: 'Unavailable',
  } satisfies Record<UnderlyingResetExtensionSignal, string>,
  volatilityStress: {
    NORMAL: 'Normal', ACCELERATING: 'Accelerating', ELEVATED: 'Elevated', STRESSED: 'Stressed', UNAVAILABLE: 'Unavailable',
  } satisfies Record<UnderlyingVolatilityStressSignal, string>,
});

export const UNDERLYING_TECHNICAL_REASON_EXPLANATIONS: Readonly<Record<UnderlyingTechnicalReasonCode, string>> = Object.freeze({
  COMPLETE_TECHNICAL_EVIDENCE: 'Complete technical evidence is available.',
  PARTIAL_TECHNICAL_EVIDENCE: 'Some technical evidence is unavailable.',
  INSUFFICIENT_TECHNICAL_EVIDENCE: 'Technical evidence is insufficient for a directional assessment.',
  BULLISH_MA_STACK: 'Moving averages retain a bullish stack.',
  BEARISH_MA_STACK: 'Moving averages retain a bearish stack.',
  LONG_TERM_STRUCTURE_INTACT: 'Long-term structure remains above the 200-day average.',
  LONG_TERM_STRUCTURE_BROKEN: 'Long-term structure is below the 50-day and 200-day averages.',
  POSITIVE_TREND_PERSISTENCE: 'Price has persisted above the 50-day average.',
  CONTROLLED_PULLBACK: 'The recent pullback remains controlled within intact structure.',
  OVERSOLD_NOT_BULLISH: 'Oversold conditions are context, not an automatic bullish signal.',
  MOMENTUM_IMPROVING: 'Momentum is improving during a recovery.',
  MOMENTUM_DETERIORATING: 'Momentum is deteriorating.',
  VOLATILITY_ACCELERATING: 'Realized volatility is accelerating.',
  VOLATILITY_STRESSED: 'Realized volatility and drawdown show stress.',
  EXTENSION_RISK: 'Price extension creates additional pullback risk.',
  RANGE_BOUND: 'The available signals remain range-bound and neutral.',
});

export function underlyingTechnicalStatePresentation(state: UnderlyingTechnicalState): UnderlyingTechnicalStatePresentation {
  return UNDERLYING_TECHNICAL_STATE_PRESENTATION[state];
}

export const technicalStatePresentation = underlyingTechnicalStatePresentation;

export function underlyingTechnicalEvidencePresentation(quality: UnderlyingTechnicalEvidenceQuality): UnderlyingTechnicalEvidencePresentation {
  return UNDERLYING_TECHNICAL_EVIDENCE_PRESENTATION[quality];
}

export const technicalEvidenceQualityPresentation = underlyingTechnicalEvidencePresentation;

export function technicalSignalLabels(signals: UnderlyingTechnicalAssessment['signals']): {
  structure: string;
  momentum: string;
  resetExtension: string;
  volatilityStress: string;
} {
  return {
    structure: UNDERLYING_TECHNICAL_SIGNAL_LABELS.structure[signals.structure],
    momentum: UNDERLYING_TECHNICAL_SIGNAL_LABELS.momentum[signals.momentum],
    resetExtension: UNDERLYING_TECHNICAL_SIGNAL_LABELS.resetExtension[signals.resetExtension],
    volatilityStress: UNDERLYING_TECHNICAL_SIGNAL_LABELS.volatilityStress[signals.volatilityStress],
  };
}

export function technicalReasonExplanation(code: UnderlyingTechnicalReasonCode): string {
  return UNDERLYING_TECHNICAL_REASON_EXPLANATIONS[code];
}

export function presentUnderlyingTechnicalAssessment(assessment: UnderlyingTechnicalAssessment) {
  const state = underlyingTechnicalStatePresentation(assessment.state);
  const evidenceQuality = underlyingTechnicalEvidencePresentation(assessment.evidenceQuality);
  const signals = technicalSignalLabels(assessment.signals);
  return {
    state,
    evidenceQuality,
    signals,
    reasonExplanations: assessment.reasonCodes.map(technicalReasonExplanation),
  };
}

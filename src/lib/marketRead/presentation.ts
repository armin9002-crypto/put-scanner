import type { RegimeAnalysis } from './types.ts';

export type RegimeTone = 'positive' | 'caution' | 'negative' | 'neutral';

export interface RegimePresentation {
  label: string;
  confidenceLabel: string;
  coverageLabel: string;
  tone: RegimeTone;
  reasons: string[];
}

function toneFor(label: RegimeAnalysis['label']): RegimeTone {
  if (label.includes('Risk-On')) return 'positive';
  if (label === 'Risk-Off' || label === 'Oversold Panic') return 'negative';
  if (label === 'Healthy Pullback' || label === 'Choppy / Elevated Vol') return 'caution';
  return 'neutral';
}

export function regimePresentation(regime: RegimeAnalysis): RegimePresentation {
  const { currentLeveraged, retainedLeveraged, unavailableLeveraged, intendedLeveraged } = regime.coverage;
  const coverageLabel = `${currentLeveraged}/${intendedLeveraged} current${retainedLeveraged > 0 ? ` | ${retainedLeveraged} retained` : ''}${unavailableLeveraged > 0 ? ` | ${unavailableLeveraged} unavailable` : ''}`;
  const reasons = regime.warnings.length > 0 ? regime.warnings : regime.drivers.slice(0, 2);
  return {
    label: regime.label,
    confidenceLabel: `${regime.confidence} confidence`,
    coverageLabel,
    tone: toneFor(regime.label),
    reasons,
  };
}

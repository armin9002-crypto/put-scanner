export type ShortPutMoneynessState = 'itm' | 'otm' | 'atm' | 'unknown';

export type MoneynessTone = 'positive' | 'warning' | 'danger' | 'muted';

export interface ShortPutMoneynessPresentation {
  state: ShortPutMoneynessState;
  label: 'ITM' | 'OTM' | 'ATM' | '—';
  tone: MoneynessTone;
  color: string;
  backgroundColor: string | null;
  borderColor: string;
  accessibleLabel: string;
}

export const SHORT_PUT_MONEYNESS_PRESENTATION: Readonly<Record<ShortPutMoneynessState, ShortPutMoneynessPresentation>> = Object.freeze({
  otm: {
    state: 'otm',
    label: 'OTM',
    tone: 'positive',
    color: 'var(--green)',
    backgroundColor: 'rgba(34,197,94,0.08)',
    borderColor: 'rgba(34,197,94,0.18)',
    accessibleLabel: 'Out of the money; favorable short-put moneyness.',
  },
  atm: {
    state: 'atm',
    label: 'ATM',
    tone: 'warning',
    color: 'var(--yellow)',
    backgroundColor: 'rgba(234,179,8,0.08)',
    borderColor: 'rgba(234,179,8,0.18)',
    accessibleLabel: 'At the money; caution short-put moneyness.',
  },
  itm: {
    state: 'itm',
    label: 'ITM',
    tone: 'danger',
    color: 'var(--red)',
    backgroundColor: 'rgba(239,68,68,0.08)',
    borderColor: 'rgba(239,68,68,0.18)',
    accessibleLabel: 'In the money; adverse short-put moneyness.',
  },
  unknown: {
    state: 'unknown',
    label: '—',
    tone: 'muted',
    color: 'var(--text-dim)',
    backgroundColor: null,
    borderColor: 'var(--border)',
    accessibleLabel: 'Moneyness unavailable.',
  },
});

export function shortPutMoneynessPresentation(state: ShortPutMoneynessState): ShortPutMoneynessPresentation {
  return SHORT_PUT_MONEYNESS_PRESENTATION[state];
}

export const getShortPutMoneynessPresentation = shortPutMoneynessPresentation;

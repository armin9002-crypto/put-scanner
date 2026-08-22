import type { MarkBasis } from './portfolioMetrics.ts';
import { emitDurableMutation } from './cloudState/syncEvents.ts';

export const PORTFOLIO_MARK_BASIS_KEY = 'put_scanner_portfolio_mark_basis';
export const PORTFOLIO_MARK_BASIS_OPTIONS: MarkBasis[] = ['last', 'bid', 'ask'];

export function readPortfolioMarkBasis(
  storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage,
): MarkBasis {
  try {
    const saved = storage?.getItem(PORTFOLIO_MARK_BASIS_KEY);
    return PORTFOLIO_MARK_BASIS_OPTIONS.includes(saved as MarkBasis) ? saved as MarkBasis : 'ask';
  } catch {
    return 'ask';
  }
}

export function persistPortfolioMarkBasis(
  value: MarkBasis,
  storage: (Pick<Storage, 'setItem'> & Partial<Pick<Storage, 'getItem'>>) | null = typeof localStorage === 'undefined' ? null : localStorage,
): void {
  try {
    const previous = storage?.getItem?.(PORTFOLIO_MARK_BASIS_KEY);
    storage?.setItem(PORTFOLIO_MARK_BASIS_KEY, value);
    if (storage && previous !== value) emitDurableMutation('preferences');
  } catch {
    // Preference persistence is best-effort only.
  }
}

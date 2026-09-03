import { getAccountStateStorage } from './cloudState/accountStateStorage.ts';
import { emitDurableMutation } from './cloudState/syncEvents.ts';

export const RECOMMENDATIONS_MINIMUM_DTE_KEY = 'put_scanner_recommendations_minimum_dte:v1';

type PreferenceWriteStorage = Pick<Storage, 'setItem'> & Partial<Pick<Storage, 'getItem'>>;

export function readOnlyEvaluateAtLeast60Dte(storage: Pick<Storage, 'getItem'> | null = getAccountStateStorage()): boolean {
  try {
    const value = storage?.getItem(RECOMMENDATIONS_MINIMUM_DTE_KEY);
    return value == null ? true : value !== 'false';
  } catch {
    return true;
  }
}

export function persistOnlyEvaluateAtLeast60Dte(
  value: boolean,
  storage: PreferenceWriteStorage | null = getAccountStateStorage(),
): void {
  try {
    const serialized = String(value);
    const previous = storage?.getItem?.(RECOMMENDATIONS_MINIMUM_DTE_KEY);
    storage?.setItem(RECOMMENDATIONS_MINIMUM_DTE_KEY, serialized);
    if (storage && previous !== serialized) emitDurableMutation('preferences');
  } catch { /* Account storage reports signed-out/save failures centrally. */ }
}

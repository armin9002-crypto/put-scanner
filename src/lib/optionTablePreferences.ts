import { emitDurableMutation } from './cloudState/syncEvents.ts';
import { getAccountStateStorage } from './cloudState/accountStateStorage.ts';

export const SHOW_NOMINAL_YIELD_KEY = 'put_scanner_show_nominal_yield:v1';

type PreferenceWriteStorage = Pick<Storage, 'setItem'> & Partial<Pick<Storage, 'getItem'>>;

export function readShowNominalYield(storage: Pick<Storage, 'getItem'> | null = getAccountStateStorage()): boolean {
  try { return storage?.getItem(SHOW_NOMINAL_YIELD_KEY) === 'true'; } catch { return false; }
}

export function persistShowNominalYield(value: boolean, storage: PreferenceWriteStorage | null = getAccountStateStorage()): void {
  try {
    const serialized = String(value);
    const previous = storage?.getItem?.(SHOW_NOMINAL_YIELD_KEY);
    storage?.setItem(SHOW_NOMINAL_YIELD_KEY, serialized);
    if (storage && previous !== serialized) emitDurableMutation('preferences');
  } catch { /* Account storage reports signed-out/save failures centrally. */ }
}

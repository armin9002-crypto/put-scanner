import { emitDurableMutation } from './cloudState/syncEvents.ts';

export const SHOW_NOMINAL_YIELD_KEY = 'put_scanner_show_nominal_yield:v1';

type PreferenceWriteStorage = Pick<Storage, 'setItem'> & Partial<Pick<Storage, 'getItem'>>;

export function readShowNominalYield(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  try { return storage?.getItem(SHOW_NOMINAL_YIELD_KEY) === 'true'; } catch { return false; }
}

export function persistShowNominalYield(value: boolean, storage: PreferenceWriteStorage | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try {
    const serialized = String(value);
    const previous = storage?.getItem?.(SHOW_NOMINAL_YIELD_KEY);
    storage?.setItem(SHOW_NOMINAL_YIELD_KEY, serialized);
    if (storage && previous !== serialized) emitDurableMutation('preferences');
  } catch { /* best effort */ }
}

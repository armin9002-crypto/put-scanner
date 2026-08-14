export const SHOW_NOMINAL_YIELD_KEY = 'put_scanner_show_nominal_yield:v1';

export function readShowNominalYield(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): boolean {
  try { return storage?.getItem(SHOW_NOMINAL_YIELD_KEY) === 'true'; } catch { return false; }
}

export function persistShowNominalYield(value: boolean, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(SHOW_NOMINAL_YIELD_KEY, String(value)); } catch { /* best effort */ }
}

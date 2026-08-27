export const PORTFOLIO_EXPIRY_GROUPS_KEY = 'put_scanner_portfolio_expiry_groups:v1';
export const PORTFOLIO_UNDERLYING_GROUPS_KEY = 'put_scanner_portfolio_underlying_groups:v1';
export const PORTFOLIO_GROUP_MODE_KEY = 'put_scanner_portfolio_group_mode:v1';
export type PortfolioGroupMode = 'expiration' | 'underlying' | 'none';
import { notifyLocalStorageFailure } from './storageFeedback.ts';

function readCollapsedGroups(key: string, storage: Pick<Storage, 'getItem'> | null): Record<string, boolean> {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
  } catch { return {}; }
}

type PreferenceWriteStorage = Pick<Storage, 'setItem'> & Partial<Pick<Storage, 'getItem'>>;

function persistCollapsedGroups(key: string, value: Record<string, boolean>, storage: PreferenceWriteStorage | null): void {
  try {
    const serialized = JSON.stringify(value);
    const previous = storage?.getItem?.(key);
    storage?.setItem(key, serialized);
    if (storage && previous !== serialized) emitDurableMutation('preferences');
  } catch { notifyLocalStorageFailure(); }
}

export function readCollapsedExpirationGroups(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): Record<string, boolean> {
  return readCollapsedGroups(PORTFOLIO_EXPIRY_GROUPS_KEY, storage);
}

export function persistCollapsedExpirationGroups(value: Record<string, boolean>, storage: PreferenceWriteStorage | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  persistCollapsedGroups(PORTFOLIO_EXPIRY_GROUPS_KEY, value, storage);
}

export function readCollapsedUnderlyingGroups(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): Record<string, boolean> {
  return readCollapsedGroups(PORTFOLIO_UNDERLYING_GROUPS_KEY, storage);
}

export function persistCollapsedUnderlyingGroups(value: Record<string, boolean>, storage: PreferenceWriteStorage | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  persistCollapsedGroups(PORTFOLIO_UNDERLYING_GROUPS_KEY, value, storage);
}

export function readPortfolioGroupMode(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): PortfolioGroupMode {
  try {
    const value = storage?.getItem(PORTFOLIO_GROUP_MODE_KEY);
    return value === 'underlying' || value === 'none' ? value : 'expiration';
  } catch { return 'expiration'; }
}

export function persistPortfolioGroupMode(value: PortfolioGroupMode, storage: PreferenceWriteStorage | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try {
    const previous = storage?.getItem?.(PORTFOLIO_GROUP_MODE_KEY);
    storage?.setItem(PORTFOLIO_GROUP_MODE_KEY, value);
    if (storage && previous !== value) emitDurableMutation('preferences');
  } catch { notifyLocalStorageFailure(); }
}

export function toggleCollapsedExpirationGroup(value: Record<string, boolean>, expiration: string): Record<string, boolean> {
  return { ...value, [expiration]: value[expiration] !== true };
}

export function setAllExpirationGroupsCollapsed(expirations: string[], collapsed: boolean): Record<string, boolean> {
  return Object.fromEntries(expirations.map(expiration => [expiration, collapsed]));
}
import { emitDurableMutation } from './cloudState/syncEvents.ts';

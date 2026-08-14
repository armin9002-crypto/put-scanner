export const PORTFOLIO_EXPIRY_GROUPS_KEY = 'put_scanner_portfolio_expiry_groups:v1';
export const PORTFOLIO_UNDERLYING_GROUPS_KEY = 'put_scanner_portfolio_underlying_groups:v1';
export const PORTFOLIO_GROUP_MODE_KEY = 'put_scanner_portfolio_group_mode:v1';
export type PortfolioGroupMode = 'expiration' | 'underlying';

function readCollapsedGroups(key: string, storage: Pick<Storage, 'getItem'> | null): Record<string, boolean> {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(key) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
  } catch { return {}; }
}

function persistCollapsedGroups(key: string, value: Record<string, boolean>, storage: Pick<Storage, 'setItem'> | null): void {
  try { storage?.setItem(key, JSON.stringify(value)); } catch { /* best effort */ }
}

export function readCollapsedExpirationGroups(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): Record<string, boolean> {
  return readCollapsedGroups(PORTFOLIO_EXPIRY_GROUPS_KEY, storage);
}

export function persistCollapsedExpirationGroups(value: Record<string, boolean>, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  persistCollapsedGroups(PORTFOLIO_EXPIRY_GROUPS_KEY, value, storage);
}

export function readCollapsedUnderlyingGroups(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): Record<string, boolean> {
  return readCollapsedGroups(PORTFOLIO_UNDERLYING_GROUPS_KEY, storage);
}

export function persistCollapsedUnderlyingGroups(value: Record<string, boolean>, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  persistCollapsedGroups(PORTFOLIO_UNDERLYING_GROUPS_KEY, value, storage);
}

export function readPortfolioGroupMode(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): PortfolioGroupMode {
  try { return storage?.getItem(PORTFOLIO_GROUP_MODE_KEY) === 'underlying' ? 'underlying' : 'expiration'; } catch { return 'expiration'; }
}

export function persistPortfolioGroupMode(value: PortfolioGroupMode, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(PORTFOLIO_GROUP_MODE_KEY, value); } catch { /* best effort */ }
}

export function toggleCollapsedExpirationGroup(value: Record<string, boolean>, expiration: string): Record<string, boolean> {
  return { ...value, [expiration]: value[expiration] !== true };
}

export function setAllExpirationGroupsCollapsed(expirations: string[], collapsed: boolean): Record<string, boolean> {
  return Object.fromEntries(expirations.map(expiration => [expiration, collapsed]));
}

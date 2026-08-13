export const PORTFOLIO_EXPIRY_GROUPS_KEY = 'put_scanner_portfolio_expiry_groups:v1';

export function readCollapsedExpirationGroups(storage: Pick<Storage, 'getItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): Record<string, boolean> {
  if (!storage) return {};
  try {
    const parsed = JSON.parse(storage.getItem(PORTFOLIO_EXPIRY_GROUPS_KEY) ?? '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === 'boolean'));
  } catch { return {}; }
}

export function persistCollapsedExpirationGroups(value: Record<string, boolean>, storage: Pick<Storage, 'setItem'> | null = typeof localStorage === 'undefined' ? null : localStorage): void {
  try { storage?.setItem(PORTFOLIO_EXPIRY_GROUPS_KEY, JSON.stringify(value)); } catch { /* best effort */ }
}

export function toggleCollapsedExpirationGroup(value: Record<string, boolean>, expiration: string): Record<string, boolean> {
  return { ...value, [expiration]: value[expiration] !== true };
}

export function setAllExpirationGroupsCollapsed(expirations: string[], collapsed: boolean): Record<string, boolean> {
  return Object.fromEntries(expirations.map(expiration => [expiration, collapsed]));
}

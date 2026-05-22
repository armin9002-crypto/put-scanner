export interface WatchlistItem {
  id: string;
  ticker: string;
  expiry: string; // ISO date string "2025-06-20"
  expiryFormatted: string; // "Jun 20 '25"
  strike: number;
  addedAt: number; // Date.now()
  note: string;
}

const STORAGE_KEY = 'watchlist';

function getStorage(): Storage | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function getWatchlist(): WatchlistItem[] {
  const storage = getStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as WatchlistItem[];
  } catch {
    return [];
  }
}

function saveWatchlist(items: WatchlistItem[]): void {
  const storage = getStorage();
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch { /* storage full */ }
}

export function addToWatchlist(item: WatchlistItem): WatchlistItem[] {
  const items = getWatchlist();
  if (items.some(i => i.id === item.id)) return items;
  const updated = [...items, item];
  saveWatchlist(updated);
  return updated;
}

export function removeFromWatchlist(id: string): WatchlistItem[] {
  const items = getWatchlist().filter(i => i.id !== id);
  saveWatchlist(items);
  return items;
}

export function isInWatchlist(id: string): boolean {
  return getWatchlist().some(i => i.id === id);
}

export function updateWatchlistNote(id: string, note: string): WatchlistItem[] {
  const items = getWatchlist().map(i => i.id === id ? { ...i, note } : i);
  saveWatchlist(items);
  return items;
}

export function clearExpiredItems(): WatchlistItem[] {
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const items = getWatchlist().filter(i => {
    const [year, month, day] = i.expiry.split('-').map(Number);
    const expiryUTC = Date.UTC(year, month - 1, day);
    return expiryUTC >= todayUTC;
  });
  saveWatchlist(items);
  return items;
}

export function makeWatchlistId(ticker: string, expiry: string, strike: number): string {
  return `${ticker}_${expiry}_${strike.toFixed(2)}`;
}

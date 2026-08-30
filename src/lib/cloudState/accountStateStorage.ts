import type { StorageLike } from '../durableStorage.ts';

export class AccountStateWriteError extends Error {
  constructor(message = 'Sign in to save account data.') {
    super(message);
    this.name = 'AccountStateWriteError';
  }
}

export type AccountStateStorageNotice = {
  kind: 'sign_in_required' | 'save_failed' | 'conflict';
  message: string;
};

type NoticeListener = (notice: AccountStateStorageNotice) => void;

/**
 * Process-memory compatibility adapter for the existing Portfolio/Watchlist
 * domain modules. It is never backed by localStorage or IndexedDB.
 */
export class AccountStateMemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();
  private writable = false;
  private readonly noticeListeners = new Set<NoticeListener>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (!this.writable) {
      const error = new AccountStateWriteError();
      this.notify({ kind: 'sign_in_required', message: error.message });
      throw error;
    }
    this.values.set(key, String(value));
  }

  removeItem(key: string): void {
    if (!this.writable) {
      const error = new AccountStateWriteError();
      this.notify({ kind: 'sign_in_required', message: error.message });
      throw error;
    }
    this.values.delete(key);
  }

  /** Provider-only hydration path; bypasses the user-write lock. */
  replace(entries: Iterable<readonly [string, string]>, writable: boolean): void {
    this.values.clear();
    for (const [key, value] of entries) this.values.set(key, value);
    this.writable = writable;
  }

  /** Provider-only namespace rollback/hydration path. */
  replaceKeys(remove: readonly string[], entries: Iterable<readonly [string, string]>): void {
    for (const key of remove) this.values.delete(key);
    for (const [key, value] of entries) this.values.set(key, value);
  }

  lockAndClear(): void {
    this.writable = false;
    this.values.clear();
  }

  setWritable(value: boolean): void {
    this.writable = value;
  }

  isWritable(): boolean {
    return this.writable;
  }

  subscribeToNotices(listener: NoticeListener): () => void {
    this.noticeListeners.add(listener);
    return () => this.noticeListeners.delete(listener);
  }

  publishNotice(notice: AccountStateStorageNotice): void {
    this.notify(notice);
  }

  private notify(notice: AccountStateStorageNotice): void {
    for (const listener of [...this.noticeListeners]) listener(notice);
  }
}

export const accountStateStorage = new AccountStateMemoryStorage();

export function getAccountStateStorage(): AccountStateMemoryStorage {
  return accountStateStorage;
}

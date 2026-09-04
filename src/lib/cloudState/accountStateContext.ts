import { createContext, useContext } from 'react';
import type { DurablePortfolioTrade } from '../portfolioStorage.ts';
import type { PutScannerBackup } from '../userDataBackup.ts';
import type { CloudNamespace, CloudStateSet } from './types.ts';

export type AccountStatePhase =
  | 'resolving_auth'
  | 'anonymous'
  | 'loading'
  | 'ready'
  | 'saving'
  | 'error'
  | 'conflict'
  | 'unavailable';

export interface AccountStateSnapshot {
  userId: string | null;
  phase: AccountStatePhase;
  message: string;
  lastSavedAt: string | null;
  pendingWrites: number;
  conflictNamespace: CloudNamespace | null;
  renderVersion: number;
  cloud: CloudStateSet | null;
}

export type AccountStateActionResult =
  | { ok: true }
  | { ok: false; code: string; message: string };

export interface HistoricalPortfolioImportCommitRequest {
  reviewPortfolioRevision: number;
  trades: DurablePortfolioTrade[];
  acknowledgedExistingDuplicateIds: string[];
  appVersion: string;
  downloadBackup(backup: PutScannerBackup): void;
}

export type HistoricalPortfolioImportCommitResult =
  | { ok: true; importedCount: number; backupFilename: string }
  | { ok: false; code: string; message: string };

export interface AccountStateContextValue extends AccountStateSnapshot {
  canWrite: boolean;
  reload(): Promise<AccountStateActionResult>;
  restoreBackup(backup: PutScannerBackup): Promise<AccountStateActionResult>;
  commitHistoricalPortfolioImport(request: HistoricalPortfolioImportCommitRequest): Promise<HistoricalPortfolioImportCommitResult>;
}

const unavailableAction = async (): Promise<AccountStateActionResult> => ({
  ok: false,
  code: 'account_unavailable',
  message: 'Account data is unavailable.',
});

const unavailableHistoricalImport = async (): Promise<HistoricalPortfolioImportCommitResult> => ({
  ok: false,
  code: 'account_unavailable',
  message: 'Account data is unavailable.',
});

export const DEFAULT_ACCOUNT_STATE_SNAPSHOT: AccountStateSnapshot = {
  userId: null,
  phase: 'resolving_auth',
  message: 'Checking account session…',
  lastSavedAt: null,
  pendingWrites: 0,
  conflictNamespace: null,
  renderVersion: 0,
  cloud: null,
};

export const AccountStateContext = createContext<AccountStateContextValue>({
  ...DEFAULT_ACCOUNT_STATE_SNAPSHOT,
  canWrite: false,
  reload: unavailableAction,
  restoreBackup: unavailableAction,
  commitHistoricalPortfolioImport: unavailableHistoricalImport,
});

export function useAccountState(): AccountStateContextValue {
  return useContext(AccountStateContext);
}

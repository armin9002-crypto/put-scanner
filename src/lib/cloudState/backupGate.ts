export type BackupExportOutcome = 'succeeded' | 'failed';

export interface MigrationBackupGateState {
  sessionId: string;
  status: 'backup_required' | 'backup_acknowledged';
}

export function beginMigrationBackupSession(sessionId: string): MigrationBackupGateState {
  const normalized = sessionId.trim();
  if (!normalized) throw new Error('Migration session id is required.');
  return { sessionId: normalized, status: 'backup_required' };
}

export function recordMigrationBackupExport(
  state: MigrationBackupGateState,
  sessionId: string,
  outcome: BackupExportOutcome,
): MigrationBackupGateState {
  if (sessionId !== state.sessionId || outcome !== 'succeeded') return state;
  return { ...state, status: 'backup_acknowledged' };
}

export function hasCurrentSessionBackupAcknowledgement(
  state: MigrationBackupGateState,
  sessionId: string,
): boolean {
  return state.sessionId === sessionId && state.status === 'backup_acknowledged';
}

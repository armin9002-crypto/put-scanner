import type { SyncCoordinatorDiagnosticEvent } from './syncCoordinator.ts';

export interface SyncTestDiagnosticCounters {
  cloudSelectCount: number;
  casAttemptCount: number;
  verifiedCasSuccessCount: number;
  networkRetryCount: number;
  conflictCount: number;
  pullCount: number;
  mutationEventCount: number;
}

export interface SyncTestDiagnostics {
  snapshot(): SyncTestDiagnosticCounters;
  record(event: SyncCoordinatorDiagnosticEvent): void;
}

export function createSyncTestDiagnostics(
  onChange?: (counters: SyncTestDiagnosticCounters) => void,
): SyncTestDiagnostics {
  const counters: SyncTestDiagnosticCounters = {
    cloudSelectCount: 0,
    casAttemptCount: 0,
    verifiedCasSuccessCount: 0,
    networkRetryCount: 0,
    conflictCount: 0,
    pullCount: 0,
    mutationEventCount: 0,
  };
  const publish = () => onChange?.({ ...counters });
  return {
    snapshot: () => ({ ...counters }),
    record(event) {
      if (event.type === 'cloud_select') counters.cloudSelectCount += 1;
      if (event.type === 'cas_attempt') counters.casAttemptCount += 1;
      if (event.type === 'verified_cas') counters.verifiedCasSuccessCount += 1;
      if (event.type === 'network_retry') counters.networkRetryCount += 1;
      if (event.type === 'conflict') counters.conflictCount += 1;
      if (event.type === 'pull') counters.pullCount += 1;
      if (event.type === 'mutation') counters.mutationEventCount += 1;
      publish();
    },
  };
}

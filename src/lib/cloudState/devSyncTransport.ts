import type { DormantCloudStateClient } from './cloudStateClient.ts';
import type {
  CloudNamespace,
  CloudStateOperation,
  CloudStateResult,
  CloudStateRow,
  CloudStateSnapshot,
} from './types.ts';

export interface DevelopmentSyncTestTransport extends DormantCloudStateClient {
  isOffline(): boolean;
  setOffline(offline: boolean): void;
}

function offlineError<Value>(operation: CloudStateOperation, namespace?: CloudNamespace): CloudStateResult<Value> {
  return {
    ok: false,
    error: {
      code: 'network_error',
      operation,
      message: 'Stage 5 test cloud transport is simulating an offline device.',
      ...(namespace ? { namespace } : {}),
    },
  };
}

/** A per-harness wrapper. It never changes Auth, market data, or global browser networking. */
export function createDevelopmentSyncTestTransport(
  base: DormantCloudStateClient,
  observer: {
    onSnapshot?: (snapshot: CloudStateSnapshot) => void;
    onVerifiedRow?: (row: CloudStateRow) => void;
  } = {},
): DevelopmentSyncTestTransport {
  let offline = false;
  let recoveryFetchRequired = false;
  return {
    isOffline: () => offline,
    setOffline(value) { offline = value; },
    async fetchAllUserState() {
      if (offline) return offlineError('fetch_all');
      const result = await base.fetchAllUserState();
      if (result.ok) {
        // A deliberate fetch (the first step in Sync Now) is what releases
        // writes after an offline simulation. Merely resuming never does.
        recoveryFetchRequired = false;
        observer.onSnapshot?.(result.value);
      }
      return result;
    },
    async fetchNamespace(namespace) {
      return offline ? offlineError('fetch_namespace', namespace) : base.fetchNamespace(namespace);
    },
    async initializeAllNamespaces(input) {
      return offline ? offlineError('initialize_all') : base.initializeAllNamespaces(input);
    },
    async updateNamespaceIfRevisionMatches(namespace, expectedRevision, schemaVersion, payload) {
      if (offline) {
        recoveryFetchRequired = true;
        return offlineError('update_namespace', namespace);
      }
      if (recoveryFetchRequired) return offlineError('update_namespace', namespace);
      const result = await base.updateNamespaceIfRevisionMatches(namespace, expectedRevision, schemaVersion, payload);
      if (result.ok) observer.onVerifiedRow?.(result.value);
      return result;
    },
  };
}

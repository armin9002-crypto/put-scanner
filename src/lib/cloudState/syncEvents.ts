import type { CloudNamespace } from './types.ts';

export interface DurableMutationEvent {
  namespace: CloudNamespace;
}

export type DurableMutationListener = (event: DurableMutationEvent) => void;

const listeners = new Set<DurableMutationListener>();

/**
 * Emits only a namespace signal. Durable payloads, account ids, and auth data
 * never enter the event channel.
 */
export function emitDurableMutation(namespace: CloudNamespace): void {
  for (const listener of [...listeners]) {
    try {
      listener({ namespace });
    } catch {
      // A future sync listener must never make a completed local write fail.
    }
  }
}

/**
 * Stage 5A has no production caller. A later controlled activation may attach
 * the coordinator explicitly and must retain the returned unsubscribe handle.
 */
export function subscribeToDurableMutations(listener: DurableMutationListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function durableMutationListenerCount(): number {
  return listeners.size;
}

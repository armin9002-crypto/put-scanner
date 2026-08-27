export const LOCAL_STORAGE_FAILURE_MESSAGE = 'Put Scanner could not save this change locally.';

type Listener = () => void;
const listeners = new Set<Listener>();

export function notifyLocalStorageFailure(): void {
  listeners.forEach(listener => listener());
}

export function subscribeToLocalStorageFailures(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export const LOCAL_STORAGE_FAILURE_MESSAGE = "Put Scanner couldn't save this change on this browser.";

type Listener = () => void;
const listeners = new Set<Listener>();

export function notifyLocalStorageFailure(): void {
  listeners.forEach(listener => listener());
}

export function subscribeToLocalStorageFailures(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

import { canonicalJsonSerialize } from './stateComparison.ts';
import type {
  CloudInitializationInput,
  CloudNamespace,
  CloudNamespaceDocument,
  CloudStateSet,
} from './types.ts';

export type SyncFingerprint = `fnv1a64:${string}`;

function fnv1a64(value: string): SyncFingerprint {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    hash ^= BigInt(codeUnit & 0xff);
    hash = (hash * prime) & mask;
    hash ^= BigInt(codeUnit >>> 8);
    hash = (hash * prime) & mask;
  }
  return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

/** Fingerprints only the validated, canonical durable namespace document. */
export function fingerprintNamespaceDocument<Namespace extends CloudNamespace>(
  document: CloudNamespaceDocument<Namespace>,
): SyncFingerprint {
  return fnv1a64(canonicalJsonSerialize({
    schemaVersion: document.schemaVersion,
    payload: document.payload,
  }));
}

export function fingerprintInitialization(
  documents: CloudInitializationInput,
): Record<CloudNamespace, SyncFingerprint> {
  return {
    portfolio: fingerprintNamespaceDocument(documents.portfolio),
    watchlist: fingerprintNamespaceDocument(documents.watchlist),
    preferences: fingerprintNamespaceDocument(documents.preferences),
  };
}

export function fingerprintCloudState(
  state: CloudStateSet,
): Record<CloudNamespace, SyncFingerprint> {
  return {
    portfolio: fingerprintNamespaceDocument(state.portfolio),
    watchlist: fingerprintNamespaceDocument(state.watchlist),
    preferences: fingerprintNamespaceDocument(state.preferences),
  };
}

export function isSyncFingerprint(value: unknown): value is SyncFingerprint {
  return typeof value === 'string' && /^fnv1a64:[0-9a-f]{16}$/.test(value);
}

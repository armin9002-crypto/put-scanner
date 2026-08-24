import type { CanonicalLocalNamespaceState } from './localState.ts';
import { fingerprintNamespaceDocument, type SyncFingerprint } from './syncFingerprint.ts';
import { reconcileNamespace } from './syncReconciler.ts';
import type { OngoingNamespaceSyncMetadata } from './syncEngineMetadata.ts';
import type {
  CloudNamespace,
  CloudNamespaceDocument,
  CloudStateRow,
} from './types.ts';

export type ConflictResolutionChoice = 'keep_this_device' | 'use_account_copy';

export interface ConflictVersionSummary {
  lines: string[];
  changedAt: string | null;
}

export interface SyncConflictView {
  id: string;
  namespace: CloudNamespace;
  label: string;
  thisDevice: ConflictVersionSummary;
  accountCopy: ConflictVersionSummary;
  backupCompleted: boolean;
}

export interface CapturedConflictSnapshot<Namespace extends CloudNamespace = CloudNamespace> {
  id: string;
  namespace: Namespace;
  userId: string;
  localDocument: CloudNamespaceDocument<Namespace>;
  localFingerprint: SyncFingerprint;
  localUpdatedAt: string | null;
  cloud: CloudStateRow<Namespace>;
  cloudFingerprint: SyncFingerprint;
  capturedAt: string;
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value;
}

function plural(count: number, singular: string, pluralLabel = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralLabel}`;
}

function friendlyValue(value: string): string {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map(part => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(' ');
}

function summarizeDocument<Namespace extends CloudNamespace>(
  namespace: Namespace,
  document: CloudNamespaceDocument<Namespace>,
  changedAt: string | null,
): ConflictVersionSummary {
  if (namespace === 'portfolio') {
    const trades = (document as CloudNamespaceDocument<'portfolio'>).payload.data;
    const open = trades.filter(trade => trade.status === 'open').length;
    return {
      lines: [
        plural(open, 'open position'),
        plural(trades.length - open, 'history item'),
      ],
      changedAt,
    };
  }
  if (namespace === 'watchlist') {
    const items = (document as CloudNamespaceDocument<'watchlist'>).payload.data;
    return { lines: [plural(items.length, 'saved contract')], changedAt };
  }
  const preferences = (document as CloudNamespaceDocument<'preferences'>).payload.data;
  return {
    lines: [
      `${friendlyValue(preferences.theme ?? 'dark')} theme`,
      `Mark book: ${friendlyValue(preferences.portfolioMarkBasis ?? 'ask')}`,
    ],
    changedAt,
  };
}

export function namespaceLabel(namespace: CloudNamespace): string {
  if (namespace === 'portfolio') return 'Portfolio';
  if (namespace === 'watchlist') return 'Watchlist';
  return 'Preferences';
}

export function captureConflictSnapshot<Namespace extends CloudNamespace>(input: {
  namespace: Namespace;
  userId: string;
  local: CanonicalLocalNamespaceState<Namespace>;
  cloud: CloudStateRow<Namespace>;
  metadata: OngoingNamespaceSyncMetadata;
  now?: Date;
}): CapturedConflictSnapshot<Namespace> | null {
  const userId = input.userId.trim();
  if (!userId || input.cloud.userId !== userId || input.cloud.namespace !== input.namespace) return null;
  const localFingerprint = fingerprintNamespaceDocument(input.local.document);
  const cloudFingerprint = fingerprintNamespaceDocument(input.cloud);
  const reconciliation = reconcileNamespace({
    accountMatches: true,
    localFingerprint,
    lastSyncedFingerprint: input.metadata.lastSyncedFingerprint,
    knownCloudRevision: input.metadata.cloudRevision,
    cloud: {
      status: 'ok',
      revision: input.cloud.revision,
      fingerprint: cloudFingerprint,
    },
  });
  if (reconciliation.classification !== 'BOTH_CHANGED') return null;
  const id = [input.namespace, input.cloud.revision, localFingerprint, cloudFingerprint].join(':');
  return {
    id,
    namespace: input.namespace,
    userId,
    localDocument: clone(input.local.document),
    localFingerprint,
    localUpdatedAt: input.local.localUpdatedAt,
    cloud: clone(input.cloud),
    cloudFingerprint,
    capturedAt: (input.now ?? new Date()).toISOString(),
  };
}

export function conflictSnapshotView(
  snapshot: CapturedConflictSnapshot,
  backupCompleted: boolean,
): SyncConflictView {
  return {
    id: snapshot.id,
    namespace: snapshot.namespace,
    label: namespaceLabel(snapshot.namespace),
    thisDevice: summarizeDocument(
      snapshot.namespace,
      snapshot.localDocument,
      snapshot.localUpdatedAt,
    ),
    accountCopy: summarizeDocument(
      snapshot.namespace,
      snapshot.cloud,
      snapshot.cloud.updatedAt,
    ),
    backupCompleted,
  };
}

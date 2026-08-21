import { isIsoTimestamp, isRecord } from '../durableStorage.ts';
import {
  migratePreferencesState,
  PREFERENCES_DURABLE_SCHEMA_VERSION,
} from '../durablePreferences.ts';
import {
  migratePortfolioState,
  PORTFOLIO_DURABLE_SCHEMA_VERSION,
} from '../portfolioStorage.ts';
import {
  migrateWatchlistState,
  WATCHLIST_DURABLE_SCHEMA_VERSION,
} from '../watchlist.ts';
import {
  CLOUD_STATE_NAMESPACES,
  type CloudNamespace,
  type CloudNamespaceDocument,
  type CloudStateError,
  type CloudStateOperation,
  type CloudStateResult,
  type CloudStateRow,
  type CloudStateSet,
  type CloudStateSnapshot,
} from './types.ts';

export function isCloudNamespace(value: unknown): value is CloudNamespace {
  return typeof value === 'string' && CLOUD_STATE_NAMESPACES.includes(value as CloudNamespace);
}

function validationError(
  code: CloudStateError['code'],
  operation: CloudStateOperation,
  message: string,
  namespace?: CloudNamespace,
): CloudStateResult<never> {
  return { ok: false, error: { code, operation, message, ...(namespace ? { namespace } : {}) } };
}

export function validateCloudNamespaceDocument<Namespace extends CloudNamespace>(
  namespace: Namespace,
  schemaVersion: unknown,
  payload: unknown,
  operation: CloudStateOperation,
): CloudStateResult<CloudNamespaceDocument<Namespace>> {
  const currentVersion = namespace === 'portfolio'
    ? PORTFOLIO_DURABLE_SCHEMA_VERSION
    : namespace === 'watchlist'
      ? WATCHLIST_DURABLE_SCHEMA_VERSION
      : PREFERENCES_DURABLE_SCHEMA_VERSION;

  if (!Number.isInteger(schemaVersion) || Number(schemaVersion) !== currentVersion) {
    return validationError(
      'schema_unsupported',
      operation,
      `Cloud ${namespace} uses an unsupported schema version.`,
      namespace,
    );
  }
  if (!isRecord(payload)
    || Object.keys(payload).length !== 1
    || !Object.prototype.hasOwnProperty.call(payload, 'data')) {
    return validationError(
      'cloud_state_unexpected',
      operation,
      `Cloud ${namespace} payload does not match the durable namespace contract.`,
      namespace,
    );
  }

  if (namespace === 'portfolio') {
    const migrated = migratePortfolioState(currentVersion, payload.data);
    if (migrated.status !== 'ok') {
      return validationError(
        migrated.status === 'unsupported_version' ? 'schema_unsupported' : 'cloud_state_unexpected',
        operation,
        `Cloud ${namespace} payload failed durable validation.`,
        namespace,
      );
    }
    return {
      ok: true,
      value: { schemaVersion: currentVersion, payload: { data: migrated.state.data } } as CloudNamespaceDocument<Namespace>,
    };
  }

  if (namespace === 'watchlist') {
    const migrated = migrateWatchlistState(currentVersion, payload.data);
    if (migrated.status !== 'ok') {
      return validationError(
        migrated.status === 'unsupported_version' ? 'schema_unsupported' : 'cloud_state_unexpected',
        operation,
        `Cloud ${namespace} payload failed durable validation.`,
        namespace,
      );
    }
    return {
      ok: true,
      value: { schemaVersion: currentVersion, payload: { data: migrated.state.data } } as CloudNamespaceDocument<Namespace>,
    };
  }

  const migrated = migratePreferencesState(currentVersion, payload.data);
  if (migrated.status !== 'ok') {
    return validationError(
      migrated.status === 'unsupported_version' ? 'schema_unsupported' : 'cloud_state_unexpected',
      operation,
      `Cloud ${namespace} payload failed durable validation.`,
      namespace,
    );
  }
  return {
    ok: true,
    value: { schemaVersion: currentVersion, payload: { data: migrated.data } } as CloudNamespaceDocument<Namespace>,
  };
}

export function validateCloudStateRow(
  value: unknown,
  expectedUserId: string,
  operation: CloudStateOperation,
  expectedNamespace?: CloudNamespace,
): CloudStateResult<CloudStateRow> {
  if (!isRecord(value) || !isCloudNamespace(value.namespace)) {
    return validationError('cloud_state_unexpected', operation, 'Cloud state returned an unexpected namespace.');
  }
  const namespace = value.namespace;
  if (expectedNamespace && namespace !== expectedNamespace) {
    return validationError('cloud_state_unexpected', operation, 'Cloud state returned the wrong namespace.', expectedNamespace);
  }
  if (value.user_id !== expectedUserId) {
    return validationError('cloud_state_unexpected', operation, 'Cloud state ownership did not match the authenticated account.', namespace);
  }
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) <= 0) {
    return validationError('cloud_state_unexpected', operation, `Cloud ${namespace} revision is invalid.`, namespace);
  }
  if (!isIsoTimestamp(value.created_at) || !isIsoTimestamp(value.updated_at)) {
    return validationError('cloud_state_unexpected', operation, `Cloud ${namespace} timestamps are invalid.`, namespace);
  }

  const document = validateCloudNamespaceDocument(namespace, value.schema_version, value.payload, operation);
  if (!document.ok) return document;
  return {
    ok: true,
    value: {
      userId: expectedUserId,
      namespace,
      schemaVersion: document.value.schemaVersion,
      payload: document.value.payload,
      revision: Number(value.revision),
      createdAt: new Date(value.created_at).toISOString(),
      updatedAt: new Date(value.updated_at).toISOString(),
    },
  };
}

export function validateCloudStateRows(
  value: unknown,
  expectedUserId: string,
  operation: CloudStateOperation = 'fetch_all',
): CloudStateResult<CloudStateSnapshot> {
  if (!Array.isArray(value)) {
    return validationError('cloud_state_unexpected', operation, 'Cloud state response was not a row collection.');
  }
  if (value.length === 0) return { ok: true, value: { status: 'empty' } };

  const byNamespace = new Map<CloudNamespace, CloudStateRow>();
  for (const rawRow of value) {
    const validated = validateCloudStateRow(rawRow, expectedUserId, operation);
    if (!validated.ok) return validated;
    if (byNamespace.has(validated.value.namespace)) {
      return validationError(
        'cloud_state_unexpected',
        operation,
        `Cloud state returned duplicate ${validated.value.namespace} rows.`,
        validated.value.namespace,
      );
    }
    byNamespace.set(validated.value.namespace, validated.value);
  }

  if (byNamespace.size !== CLOUD_STATE_NAMESPACES.length
    || CLOUD_STATE_NAMESPACES.some(namespace => !byNamespace.has(namespace))) {
    return validationError(
      'cloud_state_incomplete',
      operation,
      'Cloud state is partial; all three durable namespaces are required.',
    );
  }

  return {
    ok: true,
    value: {
      status: 'complete',
      state: {
        portfolio: byNamespace.get('portfolio') as CloudStateSet['portfolio'],
        watchlist: byNamespace.get('watchlist') as CloudStateSet['watchlist'],
        preferences: byNamespace.get('preferences') as CloudStateSet['preferences'],
      },
    },
  };
}

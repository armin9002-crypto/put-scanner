import type { SupabaseClient } from '@supabase/supabase-js';
import { canonicalJsonEqual, initializationMatchesCloud } from './stateComparison.ts';
import {
  isCloudNamespace,
  validateCloudNamespaceDocument,
  validateCloudStateRow,
  validateCloudStateRows,
} from './cloudValidation.ts';
import {
  CLOUD_STATE_NAMESPACES,
  type CloudInitializationInput,
  type CloudNamespace,
  type CloudStateError,
  type CloudStateOperation,
  type CloudStateResult,
  type CloudStateRow,
  type CloudStateSet,
  type CloudStateSnapshot,
} from './types.ts';

const USER_STATE_TABLE = 'user_state';
const USER_STATE_COLUMNS = 'user_id,namespace,schema_version,payload,revision,created_at,updated_at';

export type CloudStateDatabaseClient = Pick<SupabaseClient, 'from'>;

interface DatabaseErrorShape {
  code?: string;
  message?: string;
  status?: number;
}

interface DatabaseQueryResult {
  data: unknown;
  error: DatabaseErrorShape | null;
  status?: number;
}

interface FilterQuery extends PromiseLike<DatabaseQueryResult> {
  eq(column: string, value: unknown): FilterQuery;
  select(columns: string): FilterQuery;
}

interface UserStateTableQuery {
  select(columns: string): FilterQuery;
  insert(values: Array<Record<string, unknown>>): FilterQuery;
  update(values: Record<string, unknown>): FilterQuery;
}

export interface DormantCloudStateClient {
  fetchAllUserState(): Promise<CloudStateResult<CloudStateSnapshot>>;
  fetchNamespace<Namespace extends CloudNamespace>(
    namespace: Namespace,
  ): Promise<CloudStateResult<CloudStateRow<Namespace> | null>>;
  initializeAllNamespaces(input: CloudInitializationInput): Promise<CloudStateResult<CloudStateSet>>;
  updateNamespaceIfRevisionMatches<Namespace extends CloudNamespace>(
    namespace: Namespace,
    expectedRevision: number,
    schemaVersion: number,
    payload: unknown,
  ): Promise<CloudStateResult<CloudStateRow<Namespace>>>;
}

function operationError(
  code: CloudStateError['code'],
  operation: CloudStateOperation,
  message: string,
  namespace?: CloudNamespace,
): CloudStateResult<never> {
  return { ok: false, error: { code, operation, message, ...(namespace ? { namespace } : {}) } };
}

function classifyDatabaseError(
  error: DatabaseErrorShape,
  operation: CloudStateOperation,
  namespace?: CloudNamespace,
): CloudStateResult<never> {
  const status = error.status;
  const code = error.code ?? '';
  const message = error.message ?? '';
  if (code === '23505') {
    return operationError('conflict', operation, 'Cloud state already exists and was not overwritten.', namespace);
  }
  if (status === 401 || status === 403 || code === '42501' || /^PGRST30[123]$/.test(code)) {
    return operationError('permission_error', operation, 'Cloud state access was denied.', namespace);
  }
  if (code === 'PGRST116') {
    return operationError('cloud_state_unexpected', operation, 'Cloud state returned an unexpected row count.', namespace);
  }
  if (/permission|row-level security|rls/i.test(message)) {
    return operationError('permission_error', operation, 'Cloud state access was denied.', namespace);
  }
  return operationError('network_error', operation, 'Cloud state could not be reached.', namespace);
}

function queryTable(client: CloudStateDatabaseClient): UserStateTableQuery {
  return client.from(USER_STATE_TABLE) as unknown as UserStateTableQuery;
}

function precondition(
  client: CloudStateDatabaseClient | null,
  userId: string | null,
  operation: CloudStateOperation,
  namespace?: CloudNamespace,
): CloudStateResult<{ client: CloudStateDatabaseClient; userId: string }> {
  if (!client) return operationError('not_configured', operation, 'Cloud state transport is not configured.', namespace);
  const normalizedUserId = userId?.trim() ?? '';
  if (!normalizedUserId) {
    return operationError('not_authenticated', operation, 'Cloud state requires an authenticated user.', namespace);
  }
  return { ok: true, value: { client, userId: normalizedUserId } };
}

async function safelyAwaitQuery(
  query: PromiseLike<DatabaseQueryResult>,
  operation: CloudStateOperation,
  namespace?: CloudNamespace,
): Promise<CloudStateResult<DatabaseQueryResult>> {
  try {
    const response = await query;
    return response.error
      ? classifyDatabaseError(
          { ...response.error, status: response.error.status ?? response.status },
          operation,
          namespace,
        )
      : { ok: true, value: response };
  } catch {
    return operationError('network_error', operation, 'Cloud state could not be reached.', namespace);
  }
}

export function createDormantCloudStateClient(
  databaseClient: CloudStateDatabaseClient | null,
  authenticatedUserId: string | null,
): DormantCloudStateClient {
  async function fetchAllUserState(): Promise<CloudStateResult<CloudStateSnapshot>> {
    const ready = precondition(databaseClient, authenticatedUserId, 'fetch_all');
    if (!ready.ok) return ready;
    const response = await safelyAwaitQuery(
      queryTable(ready.value.client).select(USER_STATE_COLUMNS).eq('user_id', ready.value.userId),
      'fetch_all',
    );
    return response.ok
      ? validateCloudStateRows(response.value.data, ready.value.userId, 'fetch_all')
      : response;
  }

  async function fetchNamespace<Namespace extends CloudNamespace>(
    namespace: Namespace,
  ): Promise<CloudStateResult<CloudStateRow<Namespace> | null>> {
    if (!isCloudNamespace(namespace)) {
      return operationError('cloud_state_unexpected', 'fetch_namespace', 'Requested cloud namespace is invalid.');
    }
    const ready = precondition(databaseClient, authenticatedUserId, 'fetch_namespace', namespace);
    if (!ready.ok) return ready;
    const response = await safelyAwaitQuery(
      queryTable(ready.value.client)
        .select(USER_STATE_COLUMNS)
        .eq('user_id', ready.value.userId)
        .eq('namespace', namespace),
      'fetch_namespace',
      namespace,
    );
    if (!response.ok) return response;
    if (!Array.isArray(response.value.data)) {
      return operationError('cloud_state_unexpected', 'fetch_namespace', 'Cloud namespace response was not a row collection.', namespace);
    }
    if (response.value.data.length === 0) return { ok: true, value: null };
    if (response.value.data.length !== 1) {
      return operationError('cloud_state_unexpected', 'fetch_namespace', 'Cloud namespace returned an unexpected row count.', namespace);
    }
    const validated = validateCloudStateRow(response.value.data[0], ready.value.userId, 'fetch_namespace', namespace);
    return validated.ok
      ? { ok: true, value: validated.value as CloudStateRow<Namespace> }
      : validated;
  }

  async function initializeAllNamespaces(
    input: CloudInitializationInput,
  ): Promise<CloudStateResult<CloudStateSet>> {
    const ready = precondition(databaseClient, authenticatedUserId, 'initialize_all');
    if (!ready.ok) return ready;

    const rawInput = input as unknown;
    if (typeof rawInput !== 'object' || rawInput === null || Array.isArray(rawInput)
      || Object.keys(rawInput).length !== CLOUD_STATE_NAMESPACES.length) {
      return operationError('cloud_state_unexpected', 'initialize_all', 'Cloud initialization requires exactly three namespace documents.');
    }
    const documents = {} as CloudInitializationInput;
    for (const namespace of CLOUD_STATE_NAMESPACES) {
      const rawDocument = (rawInput as Record<string, unknown>)[namespace];
      if (typeof rawDocument !== 'object' || rawDocument === null || Array.isArray(rawDocument)) {
        return operationError('cloud_state_unexpected', 'initialize_all', `Cloud initialization is missing ${namespace}.`, namespace);
      }
      const validated = validateCloudNamespaceDocument(
        namespace,
        (rawDocument as Record<string, unknown>).schemaVersion,
        (rawDocument as Record<string, unknown>).payload,
        'initialize_all',
      );
      if (!validated.ok) return validated;
      documents[namespace] = validated.value as never;
    }

    const insertRows = CLOUD_STATE_NAMESPACES.map(namespace => ({
      user_id: ready.value.userId,
      namespace,
      schema_version: documents[namespace].schemaVersion,
      payload: documents[namespace].payload,
    }));
    const inserted = await safelyAwaitQuery(
      queryTable(ready.value.client).insert(insertRows).select(USER_STATE_COLUMNS),
      'initialize_all',
    );
    if (!inserted.ok) return inserted;
    const insertedRows = validateCloudStateRows(inserted.value.data, ready.value.userId, 'initialize_all');
    if (!insertedRows.ok) return insertedRows;
    if (insertedRows.value.status !== 'complete') {
      return operationError('verification_failed', 'initialize_all', 'Atomic initialization did not return all three namespaces.');
    }

    const readBack = await fetchAllUserState();
    if (!readBack.ok) return readBack;
    if (readBack.value.status !== 'complete'
      || !initializationMatchesCloud(documents, readBack.value.state)) {
      return operationError('verification_failed', 'initialize_all', 'Cloud read-back did not match the intended canonical state.');
    }
    return { ok: true, value: readBack.value.state };
  }

  async function updateNamespaceIfRevisionMatches<Namespace extends CloudNamespace>(
    namespace: Namespace,
    expectedRevision: number,
    schemaVersion: number,
    payload: unknown,
  ): Promise<CloudStateResult<CloudStateRow<Namespace>>> {
    if (!isCloudNamespace(namespace)) {
      return operationError('cloud_state_unexpected', 'update_namespace', 'Requested cloud namespace is invalid.');
    }
    const ready = precondition(databaseClient, authenticatedUserId, 'update_namespace', namespace);
    if (!ready.ok) return ready;
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision <= 0) {
      return operationError('cloud_state_unexpected', 'update_namespace', 'Expected cloud revision is invalid.', namespace);
    }
    const document = validateCloudNamespaceDocument(namespace, schemaVersion, payload, 'update_namespace');
    if (!document.ok) return document;

    const response = await safelyAwaitQuery(
      queryTable(ready.value.client)
        .update({ schema_version: document.value.schemaVersion, payload: document.value.payload })
        .eq('user_id', ready.value.userId)
        .eq('namespace', namespace)
        .eq('revision', expectedRevision)
        .select(USER_STATE_COLUMNS),
      'update_namespace',
      namespace,
    );
    if (!response.ok) return response;
    if (!Array.isArray(response.value.data)) {
      return operationError('cloud_state_unexpected', 'update_namespace', 'Cloud update response was not a row collection.', namespace);
    }
    if (response.value.data.length === 0) {
      return operationError('conflict', 'update_namespace', 'Cloud state changed before this update and was not overwritten.', namespace);
    }
    if (response.value.data.length !== 1) {
      return operationError('cloud_state_unexpected', 'update_namespace', 'Cloud update returned an unexpected row count.', namespace);
    }
    const validated = validateCloudStateRow(response.value.data[0], ready.value.userId, 'update_namespace', namespace);
    if (!validated.ok) return validated;
    if (validated.value.revision !== expectedRevision + 1
      || validated.value.schemaVersion !== document.value.schemaVersion
      || !canonicalJsonEqual(validated.value.payload, document.value.payload)) {
      return operationError('verification_failed', 'update_namespace', 'Cloud update response failed revision or payload verification.', namespace);
    }
    return { ok: true, value: validated.value as CloudStateRow<Namespace> };
  }

  return {
    fetchAllUserState,
    fetchNamespace,
    initializeAllNamespaces,
    updateNamespaceIfRevisionMatches,
  };
}

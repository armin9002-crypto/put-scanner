import type {
  CloudStateAssessment,
  CloudStateErrorCode,
  LocalStateAssessment,
  MigrationAction,
  MigrationState,
} from './types.ts';

export interface MigrationPlannerInput {
  local: LocalStateAssessment;
  cloud: CloudStateAssessment;
  syncIdentity: 'none' | 'match' | 'mismatch';
  backupAcknowledgedThisSession: boolean;
  phase?: 'idle' | 'in_progress' | 'verified';
}

export interface MigrationPlan {
  state: MigrationState;
  action: MigrationAction;
  canInitializeCloud: boolean;
  canHydrateLocal: boolean;
  reason: string;
  errorCode?: CloudStateErrorCode;
}

function plan(
  state: MigrationState,
  action: MigrationAction,
  reason: string,
  options: {
    canInitializeCloud?: boolean;
    canHydrateLocal?: boolean;
    errorCode?: CloudStateErrorCode;
  } = {},
): MigrationPlan {
  return {
    state,
    action,
    canInitializeCloud: options.canInitializeCloud ?? false,
    canHydrateLocal: options.canHydrateLocal ?? false,
    reason,
    ...(options.errorCode ? { errorCode: options.errorCode } : {}),
  };
}

export function planCloudMigration(input: MigrationPlannerInput): MigrationPlan {
  if (input.syncIdentity === 'mismatch') {
    return plan(
      'conflict',
      'resolve_conflict',
      'Device sync metadata belongs to a different account; local durable data remains untouched.',
      { errorCode: 'conflict' },
    );
  }
  if (input.local.status === 'corrupt') {
    return plan('error', 'stop', 'Local durable state is corrupt and cannot be treated as empty.');
  }
  if (input.local.status === 'unsupported_version') {
    return plan('error', 'stop', 'Local durable state uses an unsupported schema.', { errorCode: 'schema_unsupported' });
  }
  if (input.cloud.status === 'not_checked') {
    return plan('not_checked', 'check_cloud', 'Cloud state has not been deliberately checked.');
  }
  if (input.cloud.status === 'partial') {
    return plan(
      'error',
      'stop',
      'Cloud state is partial; no upload or restore direction is safe.',
      { errorCode: 'cloud_state_incomplete' },
    );
  }
  if (input.cloud.status === 'corrupt') {
    return plan(
      'error',
      'stop',
      'Cloud state failed durable validation and cannot be hydrated locally.',
      { errorCode: 'cloud_state_unexpected' },
    );
  }
  if (input.cloud.status === 'unsupported_version') {
    return plan(
      'error',
      'stop',
      'Cloud state uses a newer unsupported schema and must not be downgraded.',
      { errorCode: 'schema_unsupported' },
    );
  }
  if (input.cloud.status === 'error') {
    return plan('error', 'stop', 'Cloud state could not be assessed safely.', { errorCode: 'network_error' });
  }
  if (input.phase === 'verified' && input.cloud.status === 'complete') {
    return plan('migration_verified', 'none', 'All three initialized namespaces passed canonical read-back verification.');
  }
  if (input.phase === 'in_progress') {
    return plan('migration_in_progress', 'wait_for_verification', 'Atomic initialization is awaiting read-back verification.');
  }

  if (input.cloud.status === 'empty') {
    if (!input.local.hasMeaningfulData) {
      return plan(
        'cloud_empty_local_empty',
        'wait_for_explicit_initialization',
        'Neither side has meaningful durable data; initialization remains an explicit future action.',
      );
    }
    if (!input.backupAcknowledgedThisSession) {
      return plan(
        'cloud_empty_local_has_data',
        'download_fresh_backup',
        'Local durable data exists and requires a successful backup in this migration session before upload.',
      );
    }
    return plan(
      'migration_ready',
      'initialize_all_namespaces',
      'Cloud has no rows, local durable data exists, and this session has a backup acknowledgement.',
      { canInitializeCloud: true },
    );
  }

  if (!input.local.hasMeaningfulData) {
    return plan(
      'cloud_has_data_local_empty',
      'review_cloud_restore',
      'All cloud namespace rows exist; any restore must be explicitly reviewed before local hydration.',
    );
  }
  if (input.cloud.comparison === 'equal') {
    return plan(
      'both_have_data',
      'review_equal_state',
      'Both sides contain durable data and compare equal; no automatic write is allowed.',
    );
  }
  return plan(
    'both_have_data',
    'resolve_conflict',
    'Both sides contain durable state; neither side may silently overwrite the other.',
    { errorCode: 'conflict' },
  );
}

export const CLOUD_SYNC_TEST_EMAIL_GUARD_MARKER = 'stage5b-exact-test-email-allow-list';

export interface CloudSyncTestGateInput {
  dev: boolean;
  flag: unknown;
  configuredEmail: unknown;
  authenticatedEmail: unknown;
}

export function normalizeCloudSyncTestEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function isCloudSyncTestModeEnabled(input: CloudSyncTestGateInput): boolean {
  const configuredEmail = normalizeCloudSyncTestEmail(input.configuredEmail);
  const authenticatedEmail = normalizeCloudSyncTestEmail(input.authenticatedEmail);
  return input.dev === true
    && input.flag === 'true'
    && configuredEmail.length > 0
    && authenticatedEmail === configuredEmail;
}

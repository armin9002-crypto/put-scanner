export interface CloudMigrationTestModeEnvironment {
  dev: boolean;
  flag: unknown;
}

export function isCloudMigrationTestModeEnabled(
  environment: CloudMigrationTestModeEnvironment,
): boolean {
  return environment.dev === true && environment.flag === 'true';
}

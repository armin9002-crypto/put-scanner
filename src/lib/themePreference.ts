export type Theme = 'dark' | 'dark-blue' | 'light' | 'sepia';

export const THEME_STORAGE_KEY = 'put_scanner_theme';
export const LEGACY_THEME_STORAGE_KEY = 'theme';
export const THEME_MIGRATION_VERSION = '2';
export const THEME_MIGRATION_KEY = 'theme_migration_version';

export function normalizeSavedTheme(value: string | null, migrated: boolean): Theme | null {
  if (value === 'grey') return 'dark';
  if (value === 'darkBlue' || value === 'dark-blue') return 'dark-blue';
  if (value === 'dark') return migrated ? 'dark' : 'dark-blue';
  if (value === 'light' || value === 'sepia') return value;
  return null;
}

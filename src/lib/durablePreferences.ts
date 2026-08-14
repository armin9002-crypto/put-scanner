import { SHOW_NOMINAL_YIELD_KEY } from './optionTablePreferences.ts';
import { PORTFOLIO_MARK_BASIS_KEY, PORTFOLIO_MARK_BASIS_OPTIONS } from './portfolioMarkPreference.ts';
import {
  PORTFOLIO_EXPIRY_GROUPS_KEY,
  PORTFOLIO_GROUP_MODE_KEY,
  PORTFOLIO_UNDERLYING_GROUPS_KEY,
  type PortfolioGroupMode,
} from './portfolioSchedulePreferences.ts';
import {
  LEGACY_THEME_STORAGE_KEY,
  normalizeSavedTheme,
  THEME_MIGRATION_KEY,
  THEME_MIGRATION_VERSION,
  THEME_STORAGE_KEY,
  type Theme,
} from './themePreference.ts';
import {
  isRecord,
  normalizeEnvelopeTimestamp,
  type DurableStateEnvelope,
  type StorageLike,
  type StorageReadResult,
} from './durableStorage.ts';

export const PREFERENCES_DURABLE_SCHEMA_VERSION = 1 as const;

export interface DurablePreferences {
  theme?: Theme;
  portfolioMarkBasis?: 'last' | 'bid' | 'ask';
  portfolioGroupMode?: PortfolioGroupMode;
  collapsedExpirationGroups?: Record<string, boolean>;
  collapsedUnderlyingGroups?: Record<string, boolean>;
  showNominalYield?: boolean;
}

export type DurablePreferencesEnvelopeV1 = DurableStateEnvelope<DurablePreferences, 1>;

const THEMES: Theme[] = ['dark', 'dark-blue', 'light', 'sepia'];
const GROUP_MODES: PortfolioGroupMode[] = ['expiration', 'underlying', 'none'];
const PORTABLE_FIELDS = new Set([
  'theme',
  'portfolioMarkBasis',
  'portfolioGroupMode',
  'collapsedExpirationGroups',
  'collapsedUnderlyingGroups',
  'showNominalYield',
]);

function validateBooleanRecord(value: unknown, field: string): Record<string, boolean> {
  if (!isRecord(value) || Object.values(value).some(entry => typeof entry !== 'boolean')) {
    throw new Error(`${field} must contain only boolean values.`);
  }
  return { ...value } as Record<string, boolean>;
}

export type PreferencesStateMigrationOutcome =
  | { status: 'ok'; data: DurablePreferences }
  | { status: 'error'; error: string }
  | { status: 'unsupported_version'; version: number };

export function migratePreferencesState(inputVersion: number, value: unknown): PreferencesStateMigrationOutcome {
  if (inputVersion !== 0 && inputVersion !== PREFERENCES_DURABLE_SCHEMA_VERSION) {
    return { status: 'unsupported_version', version: inputVersion };
  }
  if (value == null) return { status: 'ok', data: {} };
  if (!isRecord(value)) return { status: 'error', error: 'Preferences data must be an object.' };
  const unknown = Object.keys(value).find(key => !PORTABLE_FIELDS.has(key));
  if (unknown) return { status: 'error', error: `Preferences data contains unsupported field ${unknown}.` };

  try {
    const data: DurablePreferences = {};
    if (value.theme !== undefined) {
      if (!THEMES.includes(value.theme as Theme)) throw new Error('theme is invalid.');
      data.theme = value.theme as Theme;
    }
    if (value.portfolioMarkBasis !== undefined) {
      if (!PORTFOLIO_MARK_BASIS_OPTIONS.includes(value.portfolioMarkBasis as 'last' | 'bid' | 'ask')) {
        throw new Error('portfolioMarkBasis is invalid.');
      }
      data.portfolioMarkBasis = value.portfolioMarkBasis as 'last' | 'bid' | 'ask';
    }
    if (value.portfolioGroupMode !== undefined) {
      if (!GROUP_MODES.includes(value.portfolioGroupMode as PortfolioGroupMode)) throw new Error('portfolioGroupMode is invalid.');
      data.portfolioGroupMode = value.portfolioGroupMode as PortfolioGroupMode;
    }
    if (value.collapsedExpirationGroups !== undefined) {
      data.collapsedExpirationGroups = validateBooleanRecord(value.collapsedExpirationGroups, 'collapsedExpirationGroups');
    }
    if (value.collapsedUnderlyingGroups !== undefined) {
      data.collapsedUnderlyingGroups = validateBooleanRecord(value.collapsedUnderlyingGroups, 'collapsedUnderlyingGroups');
    }
    if (value.showNominalYield !== undefined) {
      if (typeof value.showNominalYield !== 'boolean') throw new Error('showNominalYield must be boolean.');
      data.showNominalYield = value.showNominalYield;
    }
    return { status: 'ok', data };
  } catch (error) {
    return { status: 'error', error: error instanceof Error ? error.message : 'Preferences data is invalid.' };
  }
}

function parseBooleanRecord(raw: string, label: string): Record<string, boolean> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    throw new Error(`${label} contains malformed JSON.`);
  }
  return validateBooleanRecord(parsed, label);
}

export function readDurablePreferences(
  storage: Pick<StorageLike, 'getItem'> | null,
): StorageReadResult<DurablePreferences> {
  if (!storage) return { status: 'corrupt', error: 'Preferences storage is unavailable.' };
  try {
    const themeCurrent = storage.getItem(THEME_STORAGE_KEY);
    const themeLegacy = themeCurrent === null ? storage.getItem(LEGACY_THEME_STORAGE_KEY) : null;
    const markBasis = storage.getItem(PORTFOLIO_MARK_BASIS_KEY);
    const groupMode = storage.getItem(PORTFOLIO_GROUP_MODE_KEY);
    const expiryGroups = storage.getItem(PORTFOLIO_EXPIRY_GROUPS_KEY);
    const underlyingGroups = storage.getItem(PORTFOLIO_UNDERLYING_GROUPS_KEY);
    const showNominal = storage.getItem(SHOW_NOMINAL_YIELD_KEY);
    const hasPortableValue = [themeCurrent, themeLegacy, markBasis, groupMode, expiryGroups, underlyingGroups, showNominal]
      .some(value => value !== null);
    if (!hasPortableValue) return { status: 'missing' };

    const data: DurablePreferences = {};
    if (themeCurrent !== null) {
      const theme = normalizeSavedTheme(themeCurrent, true);
      if (!theme) throw new Error(`${THEME_STORAGE_KEY} is invalid.`);
      data.theme = theme;
    } else if (themeLegacy !== null) {
      const migrated = storage.getItem(THEME_MIGRATION_KEY) === THEME_MIGRATION_VERSION;
      const theme = normalizeSavedTheme(themeLegacy, migrated);
      if (!theme) throw new Error(`${LEGACY_THEME_STORAGE_KEY} is invalid.`);
      data.theme = theme;
    }
    if (markBasis !== null) {
      if (!PORTFOLIO_MARK_BASIS_OPTIONS.includes(markBasis as 'last' | 'bid' | 'ask')) {
        throw new Error(`${PORTFOLIO_MARK_BASIS_KEY} is invalid.`);
      }
      data.portfolioMarkBasis = markBasis as 'last' | 'bid' | 'ask';
    }
    if (groupMode !== null) {
      if (!GROUP_MODES.includes(groupMode as PortfolioGroupMode)) throw new Error(`${PORTFOLIO_GROUP_MODE_KEY} is invalid.`);
      data.portfolioGroupMode = groupMode as PortfolioGroupMode;
    }
    if (expiryGroups !== null) data.collapsedExpirationGroups = parseBooleanRecord(expiryGroups, PORTFOLIO_EXPIRY_GROUPS_KEY);
    if (underlyingGroups !== null) data.collapsedUnderlyingGroups = parseBooleanRecord(underlyingGroups, PORTFOLIO_UNDERLYING_GROUPS_KEY);
    if (showNominal !== null) {
      if (showNominal !== 'true' && showNominal !== 'false') throw new Error(`${SHOW_NOMINAL_YIELD_KEY} is invalid.`);
      data.showNominalYield = showNominal === 'true';
    }
    return {
      status: 'ok',
      data,
      schemaVersion: 0,
      source: 'legacy',
      updatedAt: null,
      revision: 0,
    };
  } catch (error) {
    return {
      status: 'corrupt',
      error: `${error instanceof Error ? error.message : 'Preferences data could not be read.'} Existing values were preserved.`,
    };
  }
}

export function validatePreferencesEnvelope(value: unknown): DurablePreferencesEnvelopeV1 {
  if (!isRecord(value) || value.schemaVersion !== PREFERENCES_DURABLE_SCHEMA_VERSION) {
    throw new Error('Preferences envelope is invalid.');
  }
  const updatedAt = normalizeEnvelopeTimestamp(value.updatedAt);
  if (updatedAt === undefined || !Number.isInteger(value.revision) || Number(value.revision) < 0) {
    throw new Error('Preferences metadata is invalid.');
  }
  const migrated = migratePreferencesState(PREFERENCES_DURABLE_SCHEMA_VERSION, value.data);
  if (migrated.status !== 'ok') {
    throw new Error(migrated.status === 'error' ? migrated.error : 'Preferences schema is unsupported.');
  }
  return {
    schemaVersion: PREFERENCES_DURABLE_SCHEMA_VERSION,
    updatedAt,
    revision: Number(value.revision),
    data: migrated.data,
  };
}

export function createPreferencesEnvelope(
  data: DurablePreferences,
  metadata: { updatedAt: string | null; revision: number },
): DurablePreferencesEnvelopeV1 {
  return validatePreferencesEnvelope({
    schemaVersion: PREFERENCES_DURABLE_SCHEMA_VERSION,
    updatedAt: metadata.updatedAt,
    revision: metadata.revision,
    data,
  });
}

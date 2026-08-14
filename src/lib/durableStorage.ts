export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface DurableStateEnvelope<T, Version extends number = number> {
  schemaVersion: Version;
  updatedAt: string | null;
  revision: number;
  data: T;
}

export type StorageReadResult<T> =
  | {
      status: 'ok';
      data: T;
      schemaVersion: number;
      source: 'legacy' | 'canonical';
      updatedAt: string | null;
      revision: number;
    }
  | { status: 'missing' }
  | { status: 'corrupt'; error: string; rawValue?: string }
  | { status: 'unsupported_version'; version: number; rawValue?: string };

export type StorageWriteResult =
  | { status: 'ok'; written: boolean }
  | { status: 'error'; error: string };

export class DurableStorageReadError extends Error {
  readonly result: Exclude<StorageReadResult<never>, { status: 'ok' } | { status: 'missing' }>;

  constructor(result: Exclude<StorageReadResult<never>, { status: 'ok' } | { status: 'missing' }>) {
    super(result.status === 'unsupported_version'
      ? `Stored data uses unsupported schema version ${result.version}.`
      : result.error);
    this.name = 'DurableStorageReadError';
    this.result = result;
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function normalizeEnvelopeTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  return isIsoTimestamp(value) ? new Date(value).toISOString() : undefined;
}

export function parseStoredJson(rawValue: string, label: string):
  | { status: 'ok'; value: unknown }
  | { status: 'corrupt'; error: string; rawValue: string } {
  try {
    return { status: 'ok', value: JSON.parse(rawValue) as unknown };
  } catch {
    return {
      status: 'corrupt',
      error: `${label} contains malformed JSON. The original value was preserved.`,
      rawValue,
    };
  }
}

export function serializeAndValidate<T>(
  value: T,
  validate: (parsed: unknown) => void,
): { status: 'ok'; serialized: string } | { status: 'error'; error: string } {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== 'string') return { status: 'error', error: 'The value could not be serialized.' };
    validate(JSON.parse(serialized) as unknown);
    return { status: 'ok', serialized };
  } catch (error) {
    return {
      status: 'error',
      error: error instanceof Error ? error.message : 'The value could not be serialized safely.',
    };
  }
}

export function writeValidatedStorageValue<T>(
  storage: Pick<StorageLike, 'setItem'>,
  key: string,
  value: T,
  validate: (parsed: unknown) => void,
): StorageWriteResult {
  const serialized = serializeAndValidate(value, validate);
  if (serialized.status === 'error') return serialized;
  try {
    storage.setItem(key, serialized.serialized);
    return { status: 'ok', written: true };
  } catch (error) {
    return { status: 'error', error: error instanceof Error ? error.message : `Storage key ${key} could not be written.` };
  }
}

export function stableJsonEqual(left: unknown, right: unknown): boolean {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

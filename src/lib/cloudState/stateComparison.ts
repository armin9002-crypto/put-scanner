import type { CloudInitializationInput, CloudNamespace, CloudStateSet } from './types.ts';

function canonicalJson(value: unknown, seen: Set<object>, arrayMember = false): string | undefined {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'undefined') return arrayMember ? 'null' : undefined;
  if (typeof value !== 'object') return undefined;
  if (seen.has(value)) throw new TypeError('Cloud state cannot contain circular data.');
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map(item => canonicalJson(item, seen, true) ?? 'null').join(',')}]`;
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record).sort().flatMap(key => {
      const serialized = canonicalJson(record[key], seen);
      return serialized === undefined ? [] : [`${JSON.stringify(key)}:${serialized}`];
    });
    return `{${entries.join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

export function canonicalJsonSerialize(value: unknown): string {
  const serialized = canonicalJson(value, new Set());
  if (serialized === undefined) throw new TypeError('Cloud state contains a non-JSON value.');
  return serialized;
}

export function canonicalJsonEqual(left: unknown, right: unknown): boolean {
  try {
    return canonicalJsonSerialize(left) === canonicalJsonSerialize(right);
  } catch {
    return false;
  }
}

export function initializationMatchesCloud(
  intended: CloudInitializationInput,
  actual: CloudStateSet,
): boolean {
  return (Object.keys(intended) as CloudNamespace[]).every(namespace => (
    intended[namespace].schemaVersion === actual[namespace].schemaVersion
    && canonicalJsonEqual(intended[namespace].payload, actual[namespace].payload)
  ));
}

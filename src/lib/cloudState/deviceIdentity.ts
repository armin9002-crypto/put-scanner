import type { StorageLike } from '../durableStorage.ts';

export const LOCAL_SYNC_DEVICE_ID_KEY = 'put_scanner_cloud_device_id:v1';

interface LocalSyncDeviceIdentityV1 {
  version: 1;
  id: string;
}

function validIdentity(value: unknown): value is LocalSyncDeviceIdentityV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).sort().join(',') === 'id,version'
    && record.version === 1
    && typeof record.id === 'string'
    && /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(record.id);
}

export function getOrCreateLocalSyncDeviceId(
  storage: Pick<StorageLike, 'getItem' | 'setItem'>,
  randomUuid: () => string = () => globalThis.crypto.randomUUID(),
): string | null {
  try {
    const raw = storage.getItem(LOCAL_SYNC_DEVICE_ID_KEY);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as unknown;
      return validIdentity(parsed) ? parsed.id : null;
    }
    const id = randomUuid();
    const identity: LocalSyncDeviceIdentityV1 = { version: 1, id };
    if (!validIdentity(identity)) return null;
    storage.setItem(LOCAL_SYNC_DEVICE_ID_KEY, JSON.stringify(identity));
    return id;
  } catch {
    return null;
  }
}

export function localDeviceLabel(userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): string {
  return /iPhone/i.test(userAgent) ? 'This iPhone' : 'This Browser';
}

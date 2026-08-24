import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => readFile(path.join(root, relativePath), 'utf8');

test('Account Sync exposes backup-first per-area recovery without automatic winner language', async () => {
  const source = await read('src/components/CloudSyncSection.tsx');
  for (const text of [
    'Sync conflict',
    'No data has been overwritten.',
    'Download Recovery Backup',
    'Recovery Backup Ready',
    'Keep This Device',
    'Use Account Copy',
    'Review Latest Account Copy',
  ]) assert.match(source, new RegExp(text));
  assert.match(source, /disabled=\{!conflict\.backupCompleted \|\| busy\}/);
  assert.match(source, /downloadPutScannerBackup[\s\S]*acknowledgeConflictBackup/);
  assert.doesNotMatch(source, />BOTH_CHANGED|>CAS|>Revision|>Fingerprint|>Namespace/);
  assert.doesNotMatch(source, /Newest wins|Keep both|Merge automatically|Last Write Wins/);
});

test('both winner choices require a clear, viewport-safe confirmation dialog', async () => {
  const [source, css] = await Promise.all([
    read('src/components/ConflictResolutionDialog.tsx'),
    read('src/index.css'),
  ]);
  for (const text of [
    "Keep this device's",
    'Use the account copy?',
    'Your recovery backup will remain available.',
    'Cancel',
    'Keep This Device',
    'Use Account Copy',
  ]) assert.match(source, new RegExp(text.replace(/[?]/g, '\\?')));
  assert.match(source, /createPortal[\s\S]*document\.body/);
  assert.match(source, /role="alertdialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /z-\[120\]/);
  assert.match(source, /min-h-11/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key !== 'Tab'/);
  assert.match(css, /conflict-confirmation-dialog[\s\S]*100dvh/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
});

test('conflict summaries stay concise and non-sensitive for all durable areas', async () => {
  const source = await read('src/lib/cloudState/conflictRecovery.ts');
  for (const text of ['open position', 'history item', 'saved contract', 'theme', 'Mark book:']) {
    assert.match(source, new RegExp(text));
  }
  assert.doesNotMatch(source, /JSON\.stringify\([^)]*payload/);
  assert.match(source, /reconcileNamespace/);
  assert.match(source, /classification !== 'BOTH_CHANGED'/);
});

test('the development fixture renders pre-backup, post-backup, and confirmation-ready conflict states locally', async () => {
  const source = await read('src/components/AccountUiTestFixture.tsx');
  assert.match(source, /'conflict'/);
  assert.match(source, /'conflict-backed-up'/);
  assert.match(source, /15 open positions/);
  assert.match(source, /14 open positions/);
  assert.match(source, /acknowledgeConflictBackup/);
  assert.match(source, /setBackupCompleted\(true\)/);
  assert.match(source, /ACCOUNT UI TEST FIXTURE/);
});

test('invalid or stale conflict state cannot expose engine winner actions', async () => {
  const [coordinator, section] = await Promise.all([
    read('src/lib/cloudState/syncCoordinator.ts'),
    read('src/components/CloudSyncSection.tsx'),
  ]);
  assert.match(coordinator, /removeConflictSnapshot\(namespace\)[\s\S]*setNamespaceStatus\(namespace, 'attention'/);
  assert.match(coordinator, /cloud_changed_again/);
  assert.match(coordinator, /Nothing was overwritten/);
  assert.match(section, /conflictViews\.length === 0/);
  assert.match(section, /Review Latest Account Copy/);
});

test('device identity is random, stable, local-only, and has no cloud registry', async () => {
  const [identity, lifecycle] = await Promise.all([
    read('src/lib/cloudState/deviceIdentity.ts'),
    read('src/lib/cloudState/productionSyncLifecycle.ts'),
  ]);
  assert.match(identity, /crypto\.randomUUID\(\)/);
  assert.match(identity, /put_scanner_cloud_device_id:v1/);
  assert.match(identity, /This iPhone/);
  assert.match(identity, /This Browser/);
  assert.match(lifecycle, /getOrCreateLocalSyncDeviceId/);
  assert.doesNotMatch(identity + lifecycle, /IP address|geolocation|hardwareId|device registry/i);
});

test('normal synchronization remains event-driven with no polling, Realtime, or focus watcher', async () => {
  const sources = await Promise.all([
    read('src/lib/cloudState/syncCoordinator.ts'),
    read('src/lib/cloudState/productionSyncLifecycle.ts'),
    read('src/components/CloudSyncProvider.tsx'),
  ]);
  const combined = sources.join('\n');
  assert.doesNotMatch(combined, /setInterval\s*\(/);
  assert.doesNotMatch(combined, /visibilitychange|document\.hasFocus|window\.addEventListener\(['"]focus/);
  assert.doesNotMatch(combined, /\.channel\(|postgres_changes|RealtimeChannel/);
  assert.match(combined, /subscribeToDurableMutations|attachMutationEvents/);
});

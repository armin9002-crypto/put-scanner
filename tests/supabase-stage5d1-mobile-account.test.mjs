import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = async relativePath => readFile(path.join(root, relativePath), 'utf8');
const readOptional = async relativePath => {
  try {
    return await read(relativePath);
  } catch {
    return '';
  }
};

test('mobile Account uses a body-level portal that escapes the sticky header stacking context', async () => {
  const source = await readOptional('src/components/MobileAccountSheet.tsx');
  assert.match(source, /createPortal/);
  assert.match(source, /document\.body/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /fixed inset-0/);
  assert.match(source, /z-\[1(?:0|1)0\]/);
  assert.match(source, /min-h-11 min-w-11|h-11 w-11/);
});

test('mobile Account sheet is safe-area, dynamic-viewport, scroll, and keyboard-height aware', async () => {
  const [source, css] = await Promise.all([
    readOptional('src/components/MobileAccountSheet.tsx'),
    read('src/index.css'),
  ]);
  assert.match(source, /overflow-y-auto/);
  assert.match(source, /document\.documentElement\.style\.overflow/);
  assert.match(source, /window\.scrollY/);
  assert.match(source, /window\.scrollTo/);
  assert.match(css, /\.mobile-account-sheet/);
  assert.match(css, /100dvh/);
  assert.match(css, /safe-area-inset-top/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.match(css, /overscroll-behavior/);
  assert.match(css, /scroll-padding-bottom/);
});

test('all required phone viewports resolve to the mobile Account presentation', async () => {
  const responsive = await import('../src/lib/responsive.ts');
  assert.equal(typeof responsive.resolveResponsiveMode, 'function');
  for (const [width, height] of [[390, 844], [430, 932], [375, 667], [844, 390], [667, 375]]) {
    const mode = responsive.resolveResponsiveMode(width, height, width > height);
    assert.equal(mode.isPhone, true, `${width}x${height} should be phone UI`);
    assert.equal(mode.isDesktop, false, `${width}x${height} must not use desktop Account`);
  }
  assert.equal(responsive.resolveResponsiveMode(844, 390, true).isPhoneLandscape, true);
  assert.equal(responsive.resolveResponsiveMode(667, 375, true).isPhoneLandscape, true);
});

test('mobile Account trigger is unambiguous, touch-safe, and exposes dialog state', async () => {
  const source = await read('src/components/AccountControl.tsx');
  assert.match(source, /ref=\{triggerRef\}/);
  assert.match(source, /aria-label="Account"/);
  assert.match(source, /aria-haspopup="dialog"/);
  assert.match(source, /aria-expanded=\{open\}/);
  assert.match(source, /aria-controls=/);
  assert.match(source, /h-11 w-11 min-h-11 min-w-11/);
  assert.match(source, /MobileAccountSheet/);
  assert.doesNotMatch(source, /MobileBottomSheet/);
});

test('mobile Account prioritizes identity, Account Sync, Account Data, and Sign Out with shared actions', async () => {
  const source = await read('src/components/AccountControl.tsx');
  assert.match(source, /presentation: 'mobile' \| 'desktop'/);
  assert.match(source, /presentation === 'mobile'/);
  assert.match(source, /ProductionCloudSyncSection/);
  assert.match(source, /AccountDataSection/);
  assert.match(source, /Sign Out/);
  assert.match(source, /Sign in to use your account across devices/);
  assert.match(source, /onSignedOut/);
  assert.match(source, /signInWithEmail/);
  assert.match(source, /signOut/);
});

test('Account Sync presents every mobile production state without implementation jargon', async () => {
  const source = await read('src/components/CloudSyncSection.tsx');
  for (const copy of [
    'Not enabled on this device',
    'Synced',
    'Saved locally',
    'Account sync pending',
    'Sync conflict',
    'No data was overwritten.',
    'This browser is associated with another account.',
    'No data has been changed.',
    'Account data needs attention.',
    'Put Scanner will not overwrite this browser.',
    'Download Local Backup',
    'Sync details',
  ]) assert.match(source, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.doesNotMatch(source, />Namespace details</);
  assert.doesNotMatch(source, />CAS|>Revision|>Engine metadata/);
  assert.match(source, /sync\.canSyncNow && sync\.phase !== 'conflict'/);
});

test('Account Data keeps explicit restore/migration actions and established-copy safety', async () => {
  const source = await read('src/components/AccountDataSection.tsx');
  for (const copy of [
    'Account Data Found',
    'Download Local Recovery Backup',
    'Restore to This Browser',
    'Existing Browser Data',
    'Download Backup',
    'Save Existing Data to My Account',
    'Account copy established',
    'Sync is enabled on this device',
  ]) assert.match(source, new RegExp(copy.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('Account sheet remains route-independent and cannot own coordinator lifecycle', async () => {
  const [app, account, mobileSheet, options] = await Promise.all([
    read('src/App.tsx'),
    read('src/components/AccountControl.tsx'),
    readOptional('src/components/MobileAccountSheet.tsx'),
    read('src/pages/OptionsPage.tsx'),
  ]);
  assert.match(app, /<AuthProvider>[\s\S]*?<ProductionCloudSyncProvider>[\s\S]*?<AppBody \/>/);
  for (const route of ['/', '/screener', '/watchlist', '/portfolio', '/pulse', '/options/:ticker']) {
    assert.match(app, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(options, /import AccountControl/);
  assert.match(options, /<AccountControl \/>/);
  assert.doesNotMatch(account + mobileSheet, /createProductionCloudSyncManager|setAccount\(|dispose\(|attachMutationListener|subscribeToDurableMutations/);
});

test('production UI fixture and development sync harnesses remain development-only', async () => {
  const [app, fixture, report] = await Promise.all([
    read('src/App.tsx'),
    readOptional('src/components/AccountUiTestFixture.tsx'),
    read('scripts/build-report.mjs'),
  ]);
  assert.match(app, /import\.meta\.env\.DEV/);
  assert.match(fixture, /ACCOUNT UI TEST FIXTURE/);
  for (const state of ['signed-out', 'not-enrolled', 'synced', 'pending', 'conflict', 'account-mismatch', 'attention', 'restore']) {
    assert.match(fixture, new RegExp(`'${state}'`));
  }
  assert.match(report, /ACCOUNT UI TEST FIXTURE/);
  assert.match(report, /VITE_CLOUD_SYNC_TEST_MODE/);
  assert.match(report, /VITE_CLOUD_MIGRATION_TEST_MODE/);
});

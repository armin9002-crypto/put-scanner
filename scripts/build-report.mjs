import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const distDir = fileURLToPath(new URL('../dist/assets', import.meta.url));
const MAIN_CHUNK_WARN_KB = 500;

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(fullPath);
    const info = await stat(fullPath);
    return [{ path: fullPath, size: info.size }];
  }));
  return files.flat();
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(1)} kB`;
}

const files = (await listFiles(distDir))
  .filter(file => /\.(js|css)$/.test(file.path))
  .sort((a, b) => b.size - a.size);

console.log('\nLargest built assets:');
files.slice(0, 12).forEach(file => {
  const name = relative(distDir, file.path);
  console.log(`${formatKb(file.size).padStart(10)}  ${name}`);
});

const largestJs = files.find(file => file.path.endsWith('.js'));
if (largestJs && largestJs.size > MAIN_CHUNK_WARN_KB * 1024) {
  console.warn(`\nWarning: largest JS asset is ${formatKb(largestJs.size)}. Route splitting is active, but this chunk is still above ${MAIN_CHUNK_WARN_KB} kB.`);
}

const javascript = (await Promise.all(
  files.filter(file => file.path.endsWith('.js')).map(file => readFile(file.path, 'utf8')),
)).join('\n');
const retiredLocalFirstMarkers = [
  'Enable Sync on This Device',
  'Keep This Device',
  'Use Account Copy',
  'BOTH_CHANGED',
  'LOCAL_AHEAD',
];
const cloudAuthoritativeMarkers = [
  'Loading your account data',
  'Sign in to save account data',
  'Your account changed on another device',
];
const missingAuthoritativeMarker = cloudAuthoritativeMarkers.find(marker => !javascript.includes(marker));
if (missingAuthoritativeMarker) {
  throw new Error(`Cloud-authoritative account bundle is incomplete: ${missingAuthoritativeMarker}`);
}
const leakedLocalFirstMarker = retiredLocalFirstMarkers.find(marker => javascript.includes(marker));
if (leakedLocalFirstMarker) {
  throw new Error(`Retired local-first account architecture entered the production bundle: ${leakedLocalFirstMarker}`);
}
console.log('\nCloud-authoritative account bootstrap/CAS handling is present; local-first enrollment and reconciliation are absent.');

const stage5bHarnessMarkers = [
  'Sync Test Harness',
  'Enable Test Sync',
  'Resume Test Sync',
  'Pause Test Network',
  'Mutate Test Portfolio',
  'Mutate Test Watchlist',
  'Mutate Test Preferences',
  'stage5b-exact-test-email-allow-list',
  'VITE_CLOUD_SYNC_TEST_MODE',
  'VITE_CLOUD_SYNC_TEST_EMAIL',
  'cloud-sync-test-',
  'CLOUD SYNC TEST ONLY',
];
const leakedStage5bMarker = stage5bHarnessMarkers.find(marker => javascript.includes(marker));
if (leakedStage5bMarker) {
  throw new Error(`Development Stage 5B test harness entered the production bundle: ${leakedStage5bMarker}`);
}
const forcedTestEmail = process.env.VITE_CLOUD_SYNC_TEST_EMAIL?.trim();
if (forcedTestEmail && javascript.includes(forcedTestEmail)) {
  throw new Error('Configured development sync-test email entered the production bundle.');
}
const stage4bHarnessMarkers = [
  'Migration Test Harness',
  'CLOUD MIGRATION TEST ONLY',
  'VITE_CLOUD_MIGRATION_TEST_MODE',
];
const leakedStage4bMarker = stage4bHarnessMarkers.find(marker => javascript.includes(marker));
if (leakedStage4bMarker) {
  throw new Error(`Development Stage 4B migration harness entered the production bundle: ${leakedStage4bMarker}`);
}
const accountUiFixtureMarkers = [
  'ACCOUNT UI TEST FIXTURE',
  'account-ui-fixture',
  'AccountUiTestFixture',
];
const leakedAccountUiMarker = accountUiFixtureMarkers.find(marker => javascript.includes(marker));
if (leakedAccountUiMarker) {
  throw new Error(`Development Account UI fixture entered the production bundle: ${leakedAccountUiMarker}`);
}
console.log('Retired Stage 4B/5B harnesses and Account UI fixtures are excluded from production assets.');

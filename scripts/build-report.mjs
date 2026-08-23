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
const dormantSyncMarkers = [
  'put_scanner_cloud_sync_engine:v1',
  'Only verified eligible device metadata can enable sync.',
  'Sync retry delays must be non-negative durations.',
];
const productionSyncMarkers = [
  'Enable Sync on This Device',
  'Account sync is up to date.',
];
const productionSyncPresent = javascript.includes('Enable Sync on This Device');
if (productionSyncPresent) {
  const missingMarker = productionSyncMarkers.find(marker => !javascript.includes(marker));
  if (missingMarker) {
    throw new Error(`Feature-enabled production sync bundle is incomplete: ${missingMarker}`);
  }
  const missingEngineMarker = dormantSyncMarkers.find(marker => !javascript.includes(marker));
  if (missingEngineMarker) {
    throw new Error(`Feature-enabled production sync engine is incomplete: ${missingEngineMarker}`);
  }
  console.log('\nFeature-gated production sync orchestration is present and includes explicit enrollment.');
} else {
  const leakedMarker = dormantSyncMarkers.find(marker => javascript.includes(marker));
  if (leakedMarker) {
    throw new Error(`Dormant Stage 5 sync engine entered the feature-disabled production bundle: ${leakedMarker}`);
  }
  console.log('\nFeature-disabled production bundle excludes sync orchestration and the Stage 5 engine.');
}

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
console.log('Development Stage 5B harness, coordinator attachment, fixtures, and email allow-list are excluded from production assets.');

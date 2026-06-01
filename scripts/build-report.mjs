import { readdir, stat } from 'node:fs/promises';
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

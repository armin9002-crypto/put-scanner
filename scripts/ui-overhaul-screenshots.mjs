import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const phase = process.argv[2];
if (phase !== 'before' && phase !== 'after') {
  console.error('Usage: npm run visual:ui1 -- before|after');
  process.exit(1);
}

const cli = path.join(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js');
const result = spawnSync(process.execPath, [cli, 'test', 'e2e/ui-overhaul.visual.spec.ts'], {
  env: { ...process.env, UI_OVERHAUL_CAPTURE: phase },
  stdio: 'inherit',
});

if (result.error) console.error(result.error.message);

process.exit(result.status ?? 1);

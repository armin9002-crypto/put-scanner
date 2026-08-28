import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const phase = process.argv[2];
if (phase !== 'baseline' && phase !== 'final') {
  console.error('Usage: npm run visual:ui5 -- baseline|final');
  process.exit(1);
}

const cli = path.join(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js');
const result = spawnSync(process.execPath, [cli, 'test', 'e2e/ui-overhaul-ui5.visual.spec.ts'], {
  env: { ...process.env, UI_OVERHAUL_CAPTURE: phase, UI_OVERHAUL_SUITE: 'ui5' },
  stdio: 'inherit',
});

if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);

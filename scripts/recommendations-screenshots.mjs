import { spawnSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';

const cli = path.join(process.cwd(), 'node_modules', '@playwright', 'test', 'cli.js');
const result = spawnSync(process.execPath, [cli, 'test', 'e2e/recommendations.visual.spec.ts', '--project=desktop-1440x900'], {
  env: {
    ...process.env,
    UI_OVERHAUL_CAPTURE: 'final',
    RECOMMENDATIONS_VISUAL_CAPTURE: 'final',
  },
  stdio: 'inherit',
});

if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);

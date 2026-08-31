import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('visual account fixtures use the cloud-authoritative bootstrap path', async () => {
  const [fixture, config, ...visualSpecs] = await Promise.all([
    readFile(path.join(root, 'e2e/fixtures/cloudAccount.ts'), 'utf8'),
    readFile(path.join(root, 'playwright.config.ts'), 'utf8'),
    ...['ui-overhaul.visual.spec.ts', 'ui-overhaul-ui2.visual.spec.ts', 'ui-overhaul-ui3.visual.spec.ts', 'ui-overhaul-ui5.visual.spec.ts']
      .map(name => readFile(path.join(root, 'e2e', name), 'utf8')),
  ]);

  assert.match(fixture, /VISUAL_SUPABASE_HOST/);
  assert.match(fixture, /installDeterministicCloudAccount/);
  assert.match(fixture, /durablePortfolio/);
  assert.match(fixture, /durableWatchlist/);
  assert.match(fixture, /localStorage\.removeItem\('put_scanner_portfolio_trades'\)/);
  assert.match(fixture, /localStorage\.removeItem\('put_scanner_watchlist'\)/);
  assert.match(config, /VITE_SUPABASE_URL=https:\/\/visual-fixture\.supabase\.co/);
  assert.match(config, /VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_visual_fixture/);

  for (const source of visualSpecs) {
    assert.match(source, /installDeterministicCloudAccount/);
    assert.doesNotMatch(source, /localStorage\.setItem\(['"]put_scanner_(portfolio_trades|watchlist)['"]/);
  }
});

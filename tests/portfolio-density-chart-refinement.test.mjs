import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

test('Portfolio density uses compact card tokens without changing headline composition', async () => {
  const [source, styles] = await Promise.all([
    read('src/pages/PortfolioPage.tsx'),
    read('src/index.css'),
  ]);
  assert.match(source, /className="portfolio-summary-grid hidden grid-cols-2 md:grid md:grid-cols-5 2xl:grid-cols-10 gap-1\.5 mb-3"/);
  for (const label of ['Open Trades', 'Premium', 'Gross Risk', 'Net Risk', 'Gain/Loss', '% Captured', 'Entry Wtd. Avg. AY', 'Current Wtd. Avg. AY', 'Weighted Avg Delta', 'Weighted Avg DTE']) {
    assert.match(source, new RegExp(`label="${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }
  assert.match(styles, /\.portfolio-summary-grid > \* \{[\s\S]*min-height: 54px/);
  assert.match(styles, /\.portfolio-summary-card \{[\s\S]*padding-block: 0\.25rem !important/);
  assert.match(styles, /\.portfolio-history-summary-grid > \* \{[\s\S]*min-height: 52px/);
  assert.match(styles, /\.portfolio-priority-card \{[\s\S]*height: 100%[\s\S]*padding: 0\.4rem 0\.6rem/);
  assert.match(styles, /\.portfolio-priority-item \{[\s\S]*min-height: 29px/);
  assert.match(styles, /\.portfolio-history-outcome-bar \{[\s\S]*margin-bottom: 0\.375rem !important/);
});

test('Realized P&L chart renders canonical month labels and collision-safe semantic value labels', async () => {
  const [source, styles, browser] = await Promise.all([
    read('src/pages/PortfolioPage.tsx'),
    read('src/index.css'),
    read('e2e/ui-overhaul-ui3.visual.spec.ts'),
  ]);
  assert.match(source, /function formatMonthlyRealizedPnlLabel\(value: number\): string/);
  assert.match(source, /if \(value === 0\) return ''/);
  assert.match(source, /const formatted = formatCurrency\(Math\.abs\(value\), 0\)/);
  assert.match(source, /return value < 0 \? `\(\$\{formatted\}\)` : formatted/);
  assert.match(source, /data-chart-pnl-label/);
  assert.match(source, /data-chart-month-label/);
  assert.match(source, /backgroundColor: 'var\(--positive\)'/);
  assert.match(source, /backgroundColor: 'var\(--negative\)'/);
  assert.match(source, /overflow-x-auto[\s\S]*min-w-\[48px\]/);
  assert.match(styles, /\.portfolio-realized-pnl-chart__month,[\s\S]*font-size: 0\.625rem/);
  assert.match(styles, /\.portfolio-realized-pnl-chart__value--positive \{[\s\S]*color: var\(--positive\)/);
  assert.match(styles, /\.portfolio-realized-pnl-chart__value--negative \{[\s\S]*color: var\(--negative\)/);
  assert.match(browser, /expect\(values\)\.toContain\('\(\$150\)'\)/);
  assert.ok(browser.includes("expect(values.every(value => !/\\.\\d/.test(value))).toBe(true);"));
  assert.match(browser, /document\.documentElement\.scrollWidth <= document\.documentElement\.clientWidth \+ 1/);
});

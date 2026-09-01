import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

test('Stage 3 option rows preserve identity hierarchy at phone widths', async () => {
  const [row, styles, watchlist, screener] = await Promise.all([
    read('src/components/mobile/MobileOptionRow.tsx'),
    read('src/index.css'),
    read('src/pages/WatchlistPage.tsx'),
    read('src/pages/ScreenerPage.tsx'),
  ]);

  assert.match(row, /mobile-option-chain-cell__identity/);
  assert.match(row, /mobile-option-chain-cell__ticker/);
  assert.match(row, /mobile-option-chain-cell__strike-value/);
  assert.match(row, /mobile-option-chain-cell__expiry/);
  assert.match(styles, /\.mobile-option-chain-cell--strike \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(styles, /grid-template-columns: minmax\(7rem, 1\.45fr\)/);
  assert.match(watchlist, /<MobileOptionRow/);
  assert.match(screener, /<MobileOptionRow/);
});

test('Stage 3 Screener states and Portfolio landscape chrome use local density rules', async () => {
  const [screener, styles, portfolio] = await Promise.all([
    read('src/pages/ScreenerPage.tsx'),
    read('src/index.css'),
    read('src/pages/PortfolioPage.tsx'),
  ]);

  for (const state of ['ready', 'error', 'empty']) assert.match(screener, new RegExp(`screener-mobile-state--${state}`));
  assert.match(styles, /\.screener-mobile-state \{[\s\S]*padding-block: 2rem/);
  assert.match(styles, /\.screener-mobile-state \{[\s\S]*padding-block: 1rem/);
  assert.match(styles, /\.portfolio-page \.page-header__title,[\s\S]*display: none/);
  assert.match(portfolio, /<PageHeader[\s\S]*title="Portfolio"/);
  assert.match(portfolio, /Import Screenshot/);
  assert.match(portfolio, /Maintenance/);
});

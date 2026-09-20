import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

test('portrait Screener and Watchlist reuse the compact financial table architecture', async () => {
  const [table, styles, watchlist, screener] = await Promise.all([
    read('src/components/mobile/MobileFinancialTable.tsx'),
    read('src/index.css'),
    read('src/pages/WatchlistPage.tsx'),
    read('src/pages/ScreenerPage.tsx'),
  ]);

  assert.match(table, /<table/);
  assert.match(table, /scope="col"/);
  for (const source of [watchlist, screener]) {
    assert.match(source, /<MobileFinancialTable /);
    assert.match(source, /mobile-financial-table-identity/);
    assert.doesNotMatch(source, /MobileOptionRow|mobile-option-chain-row/);
  }
  assert.match(watchlist, /StickyNote/);
  assert.match(watchlist, /MobileBottomSheet/);
  assert.match(styles, /\.mobile-financial-table-route \{/);
  assert.match(styles, /\.mobile-financial-table-scroll \{[\s\S]*overflow: auto/);
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
  assert.match(portfolio, /Data Tools/);
  assert.doesNotMatch(portfolio, /Import Screenshot/);
  assert.match(portfolio, /Maintenance/);
});

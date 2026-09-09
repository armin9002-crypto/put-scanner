import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

test('XAPP-020 preserves the canonical Motion V2 tokens and reduced-motion contract', async () => {
  const styles = await read('src/index.css');
  assert.match(styles, /--motion-instant: 90ms;/);
  assert.match(styles, /--motion-fast: 150ms;/);
  assert.match(styles, /--motion-medium: 210ms;/);
  assert.match(styles, /--ease-ui: cubic-bezier\(0\.2, 0, 0, 1\);/);
  assert.match(styles, /--ease-emphasized: cubic-bezier\(0\.16, 1, 0\.3, 1\);/);
  assert.match(styles, /--transition-ui: var\(--motion-fast\) var\(--ease-ui\);/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation-duration: 0\.01ms !important;/);
  assert.match(styles, /\.motion-backdrop[\s\S]*animation: ui-backdrop var\(--motion-fast\) var\(--ease-ui\);/);
  assert.match(styles, /\.motion-modal[\s\S]*animation: ui-modal var\(--motion-medium\) var\(--ease-emphasized\);/);
});

test('XAPP-020 normalizes both Portfolio import modal overlays', async () => {
  const screenshot = await read('src/components/PortfolioScreenshotImportModal.tsx');
  assert.match(screenshot, /className="motion-backdrop absolute inset-0 bg-black\/55"/);
  assert.match(screenshot, /className="motion-modal portfolio-import-sheet/);

  const historicalExcel = await read('src/components/PortfolioHistoricalExcelImportModal.tsx');
  assert.match(historicalExcel, /className="motion-backdrop-surface fixed inset-0/);
  assert.match(historicalExcel, /className="motion-modal flex max-h-\[96dvh\]/);
});

test('XAPP-020 removes geometric Screener progress animation', async () => {
  const screener = await read('src/pages/ScreenerPage.tsx');
  assert.doesNotMatch(screener, /transition-all duration-300/);
  assert.match(screener, /className="h-full rounded-full"[\s\S]*style=\{\{ width: `\$\{progressPct\}%`/);
});

test('XAPP-020 keeps dense Pulse rows and Drawer quote controls spatially still', async () => {
  const styles = await read('src/index.css');
  assert.match(styles, /:not\([^)]*\.mobile-pulse-list-item/);
  assert.match(styles, /:not\([^)]*\.drawer-quote-selector > button/);
  assert.match(styles, /:is\([^)]*\.mobile-pulse-list-item, \.drawer-quote-selector > button/);

  const drawer = await read('src/components/OptionDetailDrawer.tsx');
  assert.match(drawer, /className="grid grid-cols-4 gap-1 mb-3 rounded-xl p-1 drawer-quote-selector"/);
});

test('XAPP-020 uses the shared transition token for realized P&L bar opacity', async () => {
  const styles = await read('src/index.css');
  assert.match(styles, /\.portfolio-realized-pnl-chart__bar \{[\s\S]*transition: opacity var\(--transition-ui\);/);
  assert.doesNotMatch(styles, /transition: opacity 120ms ease;/);
});

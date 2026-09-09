import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

test('SCN-007 keeps filter and result-count feedback immediate and token-based', async () => {
  const home = await read('src/pages/HomePage.tsx');
  const styles = await read('src/index.css');
  assert.match(home, /className="scanner-filter-control/);
  assert.match(home, /<ScannerResultCount count=\{filtered\.length\}/);
  assert.match(home, /key=\{count\}/);
  assert.match(styles, /\.scanner-filter-control[\s\S]*transition: color var\(--transition-ui\)/);
  assert.doesNotMatch(home, /requestAnimationFrame/);
});

test('SCN-008 keeps the grid mounted and avoids layout-position animation', async () => {
  const home = await read('src/pages/HomePage.tsx');
  const styles = await read('src/index.css');
  assert.match(home, /<div className="scanner-results-grid">/);
  assert.match(home, /key=\{etf\.ticker\}/);
  assert.match(home, /const filtered = useMemo\(/);
  assert.doesNotMatch(styles, /\.scanner-results-grid\s*\{[^}]*\b(top|left|width|height)\s*:/);
  assert.doesNotMatch(home, /getBoundingClientRect|requestAnimationFrame|FLIP/i);
});

test('SCN-009 retains last-good chart data with displayed-timeframe semantics', async () => {
  const chart = await read('src/components/InteractivePriceChartModal.tsx');
  const styles = await read('src/index.css');
  assert.match(chart, /const displayedTimeframe = activeData\?\.timeframe/);
  assert.match(chart, /const chartTimeframe = displayedTimeframe \?\? timeframe/);
  assert.match(chart, /Loading \$\{timeframe\} · showing \$\{displayedTimeframe\} until ready/);
  assert.match(chart, /\{error && !activeData \?/);
  assert.match(chart, /getChartHistory\(requestedTicker, timeframe/);
  assert.match(chart, /chartRequestGenerationRef/);
  assert.doesNotMatch(chart, /setData\(null\)/);
  assert.match(styles, /\.chart-data-surface[\s\S]*animation: chart-data-crossfade var\(--motion-fast\)/);
});

test('SCN-012 gives clickable cards canonical press feedback while mobile rows stay spatially still', async () => {
  const card = await read('src/components/ETFCard.tsx');
  const mobile = await read('src/components/mobile/MobileEtfRow.tsx');
  const styles = await read('src/index.css');
  assert.match(card, /scanner-card-link/);
  assert.match(styles, /:is\(\.instrument-card, \.scanner-market-card\):active[\s\S]*scale: \.985/);
  assert.match(styles, /\.scanner-market-card:hover[\s\S]*translate: 0 -1px/);
  assert.doesNotMatch(mobile, /<Link[\s\S]*className="pressable/);
  assert.match(styles, /\.mobile-etf-row:active[\s\S]*background: var\(--surface-alt\)/);
});

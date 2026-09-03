import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

test('portrait financial surfaces use compact primary fields and preserve drawer details', async () => {
  const [options, optionRow, positionRow, portfolio] = await Promise.all([
    read('src/pages/OptionsPage.tsx'),
    read('src/components/mobile/MobileOptionRow.tsx'),
    read('src/components/mobile/MobilePositionRow.tsx'),
    read('src/pages/PortfolioPage.tsx'),
  ]);
  assert.match(options, /if \(isPhone && !isPhoneLandscape\)/);
  for (const label of ['Strike', 'Last Trade', 'OTM\/ITM', 'AY Last', 'AY Bid', 'AY Ask']) assert.match(options, new RegExp(label));
  for (const field of ['ay-last', 'ay-bid', 'ay-ask']) assert.match(optionRow, new RegExp(`data-field="${field}"`));
  assert.match(optionRow, /formatOptionLastTradeDate\(props\.lastTradeDate/);
  assert.doesNotMatch(optionRow, /data-field="last"[\s\S]*money\(props\.last\)/);
  assert.match(optionRow, /onClick=\{props\.onSelect\}/);
  assert.match(optionRow, /onToggleWatchlist/);
  assert.match(positionRow, /data-expanded=\{expanded \? 'true' : 'false'\}/);
  assert.match(positionRow, /Gain\/Loss/);
  assert.match(positionRow, /% Captured/);
  assert.match(portfolio, /const visibleFreshness = freshness\.state === 'stale' \|\| freshness\.state === 'unavailable'/);
});

test('portrait Option Chain uses the real header with a measured sticky offset', async () => {
  const [options, styles] = await Promise.all([
    read('src/pages/OptionsPage.tsx'),
    read('src/index.css'),
  ]);
  assert.match(options, /mobileOptionHeaderRef/);
  assert.match(options, /ResizeObserver/);
  assert.match(options, /--mobile-option-chain-sticky-top/);
  assert.match(styles, /\.mobile-option-chain-table \{[\s\S]*overflow: visible/);
  assert.match(styles, /\.mobile-option-chain-header \{[\s\S]*position: -webkit-sticky/);
  assert.match(styles, /top: var\(--mobile-option-chain-sticky-top/);
  assert.match(styles, /background: var\(--bg-inset\)/);
  assert.match(styles, /box-shadow: 0 1px 0 var\(--border-default\)/);
  assert.match(styles, /\.mobile-option-route-page \{[\s\S]*height: 100dvh[\s\S]*overflow-y: auto/);
});

test('landscape tables freeze only the Ticker identity and portrait hides priority rail', async () => {
  const [styles, portfolio] = await Promise.all([read('src/index.css'), read('src/pages/PortfolioPage.tsx')]);
  assert.match(styles, /\.portfolio-schedule-surface \.financial-table tbody tr > td:first-child,[\s\S]*position: sticky/);
  assert.match(styles, /\.portfolio-history-table tbody tr > td:first-child \{[\s\S]*left: 0/);
  assert.match(styles, /@media \(max-width: 767px\) and \(orientation: portrait\)[\s\S]*\.portfolio-priority-rail \{[\s\S]*display: none/);
  assert.match(styles, /\.portfolio-history-group-toggle \{[\s\S]*height: 20px/);
  assert.match(styles, /\.portfolio-realized-pnl-chart__canvas \{[\s\S]*display: grid[\s\S]*height: 9rem/);
  assert.match(styles, /\.portfolio-realized-pnl-chart__plot\.is-scrollable \{[\s\S]*overflow-x: auto/);
  assert.match(portfolio, /const \{ isPhone, isPhoneLandscape \} = useResponsiveMode\(\)/);
  assert.match(portfolio, /if \(isPhone && !isPhoneLandscape\)/);
});

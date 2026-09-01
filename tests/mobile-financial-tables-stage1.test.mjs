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

test('landscape tables freeze only the Ticker identity and portrait hides priority rail', async () => {
  const [styles, portfolio] = await Promise.all([read('src/index.css'), read('src/pages/PortfolioPage.tsx')]);
  assert.match(styles, /\.portfolio-schedule-surface \.financial-table tbody tr > td:first-child,[\s\S]*position: sticky/);
  assert.match(styles, /\.portfolio-history-table tbody tr > td:first-child \{[\s\S]*left: 0/);
  assert.match(styles, /@media \(max-width: 767px\) and \(orientation: portrait\)[\s\S]*\.portfolio-priority-rail \{[\s\S]*display: none/);
  assert.match(styles, /\.portfolio-history-group-toggle \{[\s\S]*height: 20px/);
  assert.match(styles, /\.portfolio-realized-pnl-chart__bar-stack \{[\s\S]*gap: 0\.375rem/);
  assert.match(portfolio, /const \{ isPhone, isPhoneLandscape \} = useResponsiveMode\(\)/);
  assert.match(portfolio, /if \(isPhone && !isPhoneLandscape\)/);
});

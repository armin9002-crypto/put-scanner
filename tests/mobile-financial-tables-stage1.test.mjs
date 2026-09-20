import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

test('portrait financial surfaces use compact primary fields and preserve drawer details', async () => {
  const [options, positionRow, portfolio] = await Promise.all([
    read('src/pages/OptionsPage.tsx'),
    read('src/components/mobile/MobilePositionRow.tsx'),
    read('src/pages/PortfolioPage.tsx'),
  ]);
  assert.match(options, /if \(isPhone && !isPhoneLandscape\)/);
  for (const label of ['Strike', 'Last Trade', 'OTM\/ITM', 'AY Last', 'AY Bid', 'AY Ask']) assert.match(options, new RegExp(label));
  assert.match(options, /data-option-strike/);
  assert.match(options, /formatOptionLastTradeDate\(put\.lastTradeDate/);
  assert.match(options, /event\.stopPropagation\(\); toggleWatchlist\(put\)/);
  assert.match(positionRow, /data-expanded=\{expanded \? 'true' : 'false'\}/);
  assert.match(positionRow, /Gain\/Loss/);
  assert.match(positionRow, /% Captured/);
  assert.match(portfolio, /const visibleFreshness = .*'Stale Last' : freshness\.state === 'stale' \|\| freshness\.state === 'unavailable'/);
});

test('portrait Option Chain uses a native table below the actual route controls', async () => {
  const [options, screener, watchlist, styles, table] = await Promise.all([
    read('src/pages/OptionsPage.tsx'), read('src/pages/ScreenerPage.tsx'), read('src/pages/WatchlistPage.tsx'), read('src/index.css'), read('src/components/mobile/MobileFinancialTable.tsx'),
  ]);
  assert.match(options, /<MobileFinancialTable /);
  assert.doesNotMatch(options, /MobileOptionCard|MobileOptionRow|ResizeObserver/);
  for (const source of [screener, watchlist]) {
    assert.match(source, /<MobileFinancialTable /);
    assert.doesNotMatch(source, /MobileOptionRow|mobile-option-chain-row/);
    assert.match(source, /mobile-financial-table-route/);
    assert.match(source, /event\.target !== event\.currentTarget/);
    assert.match(source, /event\.stopPropagation\(\)/);
  }
  for (const label of ['Ticker', 'Exp', 'Strike', 'Delta', 'AY Last', 'AY Bid', 'Moneyness', 'Last Trade', 'AY Ask', 'IV vs 1Y RV']) assert.match(screener, new RegExp(`label: '${label}'`));
  for (const label of ['Ticker', 'Exp', 'Strike', 'Last', 'Bid', 'Ask', 'Delta', 'Moneyness', 'IV', 'Last Trade', 'AY Last', 'AY Bid', 'AY Ask', 'State', 'Added']) assert.match(watchlist, new RegExp(`label: '${label}'`));
  assert.match(watchlist, /MobileFinancialTableDivider/);
  assert.match(watchlist, /StickyNote/);
  assert.doesNotMatch(watchlist, /watchlist-mobile-note border/);
  assert.match(table, /<table/);
  assert.match(table, /scope="col"/);
  assert.match(table, /<tbody>/);
  assert.match(styles, /\.mobile-financial-table-scroll \{[^}]*overflow: auto/);
  assert.match(styles, /\.mobile-financial-table thead th \{[^}]*position: sticky;[^}]*top: 0/);
  assert.match(styles, /tbody th\.mobile-financial-table-identity \{[^}]*left: 0/);
  assert.match(options, /<MobileFinancialTableDivider/);
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

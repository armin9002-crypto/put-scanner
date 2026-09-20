import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

test('Scanner mobile discovery rows keep only essential opportunity information while using compact layout hooks', async () => {
  const [row, scanner, styles, browser] = await Promise.all([
    read('src/components/mobile/MobileEtfRow.tsx'),
    read('src/pages/HomePage.tsx'),
    read('src/index.css'),
    read('e2e/scanner-density.visual.spec.ts'),
  ]);

  assert.match(scanner, /if \(isPhone\)/);
  assert.match(scanner, /<MobileEtfRow/);
  assert.match(scanner, /mobile-etf-row--skeleton/);
  assert.match(row, /className="pressable mobile-etf-row"/);
  assert.match(row, /mobile-etf-row__main/);
  assert.doesNotMatch(row, /mobile-etf-row__performance/);
  assert.doesNotMatch(row, /mobile-etf-row__footer/);
  for (const label of ['5D', '1M', '3M', '52W']) assert.doesNotMatch(row, new RegExp(`\\['${label}',`), `${label} metric should stay out of the Scanner row`);
  assert.doesNotMatch(row, /IV60|scannerLiquidityCompactText|formatFundAssets/);
  assert.doesNotMatch(row, /onEvidenceOpen|Show .*options evidence/);
  assert.match(row, /title=\{etf\.name\}/);
  assert.match(styles, /\.mobile-etf-row__main \{[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(styles, /\.mobile-etf-row \{[\s\S]*min-height: 44px;[\s\S]*padding: 0\.3rem 0\.75rem/);
  assert.match(styles, /\.mobile-scanner-empty-state \{[\s\S]*padding-block: 2rem/);
  assert.match(browser, /phase === 'final'/);
  assert.match(browser, /cardHeight[\s\S]*toBeLessThanOrEqual\(90\)/);
  assert.match(browser, /pageOverflow[\s\S]*toBe\(false\)/);
});

test('ETF Pulse mobile List adopts the shared compact table without changing Heatmap or Momentum ownership', async () => {
  const [source, styles, browser] = await Promise.all([
    read('src/pages/EtfPulsePage.tsx'),
    read('src/index.css'),
    read('e2e/ui-overhaul-ui4.visual.spec.ts'),
  ]);

  assert.match(source, /if \(isPhone\)/);
  assert.match(source, /mobileVisual === 'list'/);
  assert.match(source, /<MobileFinancialTable label="ETF Pulse results"/);
  assert.match(source, /mobile-financial-table-route/);
  assert.match(source, /mobilePulseColumns/);
  assert.match(source, /mobile-pulse-loading-row/);
  assert.match(source, /title=\{tickerTitle\}/);
  for (const label of ['Ticker', 'Price', '1D', '5D', '30D', '3M', '6M', 'YTD', '1Y', 'Recent DD', 'RSI', '20D RV', 'vs 20D', 'vs 50D', 'vs 200D', '52W High', '% 52W High', '52W Pos', '52W DD', 'Trend']) assert.match(source, new RegExp(`label: '${label}'`));
  assert.doesNotMatch(source, /mobile-pulse-list-item|pulse-mobile-performance|pulse-mobile-support/);
  assert.match(source, /mobileVisual === 'heatmap'/);
  assert.match(source, /mobileVisual === 'momentum'/);
  assert.match(source, /<UniverseHeatmap rows=\{filteredRows\}/);
  assert.match(source, /<MomentumQuadrant rows=\{filteredRows\}/);
  assert.match(styles, /\.mobile-financial-table \.pulse-performance-column\.is-selected/);
  assert.match(styles, /\.mobile-financial-table \.pulse-technical-cell/);
  assert.match(styles, /@media \(orientation: landscape\) and \(max-height: 520px\) and \(max-width: 950px\)/);
  assert.match(browser, /measurePulseDensity/);
  assert.match(browser, /mobile-pulse-loading/);
  assert.match(browser, /mobile-pulse-\$\{visual\.toLowerCase\(\)\}/);
  assert.match(browser, /rowHeight[\s\S]*toBeLessThanOrEqual\(90\)/);
  assert.match(browser, /visibleSkeletons/);
});

test('Stage 2 discovery density styles stay scoped to mobile contexts and preserve desktop card/table selectors', async () => {
  const styles = await read('src/index.css');
  const stage2 = styles.slice(styles.indexOf('/* Stage 2 discovery density:'));
  assert.ok(stage2.includes('@media (max-width: 767px)'), 'Stage 2 portrait rules should be mobile scoped');
  assert.ok(stage2.includes('max-width: 950px'), 'Stage 2 landscape rules should include phone-landscape width');
  assert.match(styles, /\.instrument-card \{/);
  assert.match(styles, /\.etf-pulse-table-card \{/);
  assert.match(styles, /\.instrument-card__metrics \{/);
  assert.match(styles, /\.etf-pulse-table-card \.financial-table/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

test('Scanner mobile discovery rows keep the full opportunity hierarchy while using compact layout hooks', async () => {
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
  assert.match(row, /mobile-etf-row__performance/);
  assert.match(row, /mobile-etf-row__footer/);
  for (const label of ['5D', '1M', '3M', '52W']) assert.ok(row.includes(`['${label}',`), `${label} metric should remain in the Scanner row`);
  assert.match(row, /IV60/);
  assert.match(row, /scannerLiquidityCompactText/);
  assert.match(row, /formatFundAssets/);
  assert.match(row, /title=\{etf\.name\}/);
  assert.match(styles, /\.mobile-etf-row__main,[\s\S]*grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(styles, /\.mobile-etf-row \{[\s\S]*min-height: 0;[\s\S]*padding: 0\.15rem 0\.75rem/);
  assert.match(styles, /\.mobile-scanner-empty-state,[\s\S]*padding-block: 2rem/);
  assert.match(browser, /phase === 'final'/);
  assert.match(browser, /cardHeight[\s\S]*toBeLessThanOrEqual\(90\)/);
  assert.match(browser, /pageOverflow[\s\S]*toBe\(false\)/);
});

test('ETF Pulse mobile List is compact without changing Heatmap or Momentum view ownership', async () => {
  const [source, styles, browser] = await Promise.all([
    read('src/pages/EtfPulsePage.tsx'),
    read('src/index.css'),
    read('e2e/ui-overhaul-ui4.visual.spec.ts'),
  ]);

  assert.match(source, /if \(isPhone\)/);
  assert.match(source, /mobileVisual === 'list'/);
  assert.match(source, /mobile-pulse-list-item/);
  assert.match(source, /pulse-mobile-skeleton/);
  assert.match(source, /pulse-mobile-empty-state/);
  assert.match(source, /title=\{row\.name\}/);
  assert.match(source, /mobileVisual === 'heatmap'/);
  assert.match(source, /mobileVisual === 'momentum'/);
  assert.match(source, /<UniverseHeatmap rows=\{filteredRows\}/);
  assert.match(source, /<MomentumQuadrant rows=\{filteredRows\}/);
  assert.match(styles, /\.mobile-pulse-list-item \{[\s\S]*min-height: 0;[\s\S]*padding: 0\.3rem 0\.75rem !important/);
  assert.match(styles, /\.mobile-pulse-list-item__performance \{[\s\S]*padding-block: 0\.25rem !important/);
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

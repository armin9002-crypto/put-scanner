import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFile(path.join(root, file), 'utf8');

test('portrait ETF Pulse List uses the shared compact financial table', async () => {
  const [pulse, table, styles] = await Promise.all([
    read('src/pages/EtfPulsePage.tsx'),
    read('src/components/mobile/MobileFinancialTable.tsx'),
    read('src/index.css'),
  ]);

  assert.match(pulse, /import MobileFinancialTable/);
  assert.match(pulse, /mobile-financial-table-route/);
  assert.match(pulse, /<MobileFinancialTable label="ETF Pulse results" columns=\{mobilePulseColumns\}/);
  assert.doesNotMatch(pulse, /mobile-pulse-list-item|mobile-pulse-list-item__performance|mobile-pulse-list-item__footer/);
  assert.match(pulse, /<th scope="row" className="mobile-financial-table-identity" title=\{tickerTitle\}/);
  assert.match(pulse, /<Link to=\{buildOptionsPath\(row\.ticker\)\} state=\{optionsNavigationState\}/);

  const columnStart = pulse.indexOf('const mobilePulseColumns');
  const columnBlock = pulse.slice(columnStart, pulse.indexOf('const mobilePulsePerformanceClass', columnStart));
  const labels = ['Ticker', 'Price', '1D', '5D', '30D', '3M', '6M', 'YTD', '1Y', 'Recent DD', 'RSI', '20D RV', 'vs 20D', 'vs 50D', 'vs 200D', '52W High', '% 52W High', '52W Pos', '52W DD', 'Trend'];
  let previous = -1;
  for (const label of labels) {
    const next = columnBlock.indexOf(`label: '${label}'`);
    assert.ok(next > previous, `${label} should follow the prior mobile Pulse column`);
    previous = next;
  }

  assert.match(table, /className\?: string/);
  assert.match(table, /column\.className/);
  assert.match(styles, /\.mobile-financial-table-scroll \{[\s\S]*overflow: auto/);
  assert.match(styles, /\.mobile-financial-table thead th \{[\s\S]*position: sticky;[\s\S]*top: 0/);
  assert.match(styles, /tbody th\.mobile-financial-table-identity \{[\s\S]*left: 0/);
  assert.match(styles, /\.mobile-financial-table \.pulse-performance-column\.is-selected/);
});

test('ETF Pulse List preserves client sorting, origin state, and non-list visual branches', async () => {
  const pulse = await read('src/pages/EtfPulsePage.tsx');

  assert.match(pulse, /return \[\.\.\.filtered\]\.sort/);
  assert.match(pulse, /createOptionsNavigationState\('pulse'/);
  assert.match(pulse, /selectedVisualPeriod/);
  assert.match(pulse, /mobileVisual === 'heatmap'/);
  assert.match(pulse, /<UniverseHeatmap rows=\{filteredRows\} period=\{selectedVisualPeriod\}/);
  assert.match(pulse, /mobileVisual === 'momentum'/);
  assert.match(pulse, /<MomentumQuadrant rows=\{filteredRows\} period=\{selectedVisualPeriod\}/);
  assert.match(pulse, /<MobileBottomSheet title="ETF Pulse filters"/);
  assert.match(pulse, /onClick=\{\(\) => void loadRows\(true\)\}/);
});

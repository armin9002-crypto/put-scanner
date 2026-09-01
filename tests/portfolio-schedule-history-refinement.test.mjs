import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

test('Schedule Entry Delta / IV display toggle defaults off and preserves canonical current values', async () => {
  const [portfolio, mobile] = await Promise.all([
    read('src/pages/PortfolioPage.tsx'),
    read('src/components/mobile/MobilePositionRow.tsx'),
  ]);
  assert.match(portfolio, /const \[showEntryDeltas, setShowEntryDeltas\] = useState\(false\)/);
  const controls = portfolio.slice(portfolio.indexOf('Show Nominal Yield'), portfolio.indexOf('Show Notes / Errors') + 'Show Notes / Errors'.length);
  assert.ok(controls.indexOf('Show Nominal Yield') < controls.indexOf('Show Entry Deltas / IV'));
  assert.ok(controls.indexOf('Show Entry Deltas / IV') < controls.indexOf('Show OI / Volume'));
  assert.match(portfolio, /showEntryDeltas \? 'Entry \/ Current Delta' : 'Current Delta'/);
  assert.match(portfolio, /showEntryDeltas \? 'Entry \/ Current IV' : 'IV'/);
  assert.match(portfolio, /showEntryDeltas \? <><span[^>]*>Entry/);
  assert.match(portfolio, /showEntryDeltas \? <><span[^>]*>Entry[\s\S]*?: <span className="font-semibold"[^>]*>\{formatDelta\(delta\)/);
  assert.match(portfolio, /showEntryDelta=\{showEntryDeltas\}/);
  assert.match(portfolio, /showEntryIv=\{showEntryDeltas\}/);
  assert.match(portfolio, /entryDate=\{formatHistoryDate\(trade\.soldDate\)\}/);
  assert.match(portfolio, /sortButton\('entry', 'Entry'\)/);
  assert.match(portfolio, /showEntryDeltas \? <><span[^>]*>Entry \{isValidEntryIv/);
  assert.match(mobile, /showEntryIv &&/);
  assert.match(mobile, /Current IV/);
  assert.match(mobile, /showEntryDelta = true/);
  assert.match(mobile, /showEntryDelta &&/);
  assert.doesNotMatch(portfolio, /persistShowEntryDeltas|SHOW_ENTRY_DELTAS/);
  assert.match(portfolio, /isValidEntryDelta\(trade\.entryDelta\)/);
});

test('History renders canonical Gross Risk and aligned aggregate fields with bulk disclosure controls', async () => {
  const source = await read('src/pages/PortfolioPage.tsx');
  assert.match(source, /historyGrossRisk/);
  assert.match(source, /HISTORY_SORT_OPTIONS\.map\(option => historySortButton/);
  assert.doesNotMatch(source, /portfolio-history-group-header/);
  assert.match(source, /<tr className="portfolio-history-group-subtotal" aria-label=\{`\$\{label\} subtotal`\}>/);
  for (const field of [
    'group.grossRisk',
    'group.weightedAverageDaysHeld',
    'group.weightedAverageNy',
    'group.weightedAverageEntryVix',
    'group.weightedAverageRealizedIrr',
    'group.weightedAveragePercentCaptured',
    'group.weightedAverageEntryDelta',
    'group.weightedAverageEntryIv',
  ]) assert.match(source, new RegExp(field.replace('.', '\\.'), 'g'));
  assert.match(source, /allHistoryGroupsCollapsed/);
  assert.match(source, /toggleAllHistoryGroups/);
  assert.match(source, /allHistoryGroupsCollapsed \? 'Expand All' : 'Collapse All'/);
  assert.match(source, /groupMode !== 'none' && visibleGroups.length > 0/);
  assert.match(source, /Gross-Risk-weighted average of individual position Realized IRRs\./);
  assert.match(source, /formatAverageDays\(group\.weightedAverageDaysHeld\)/);
  assert.match(source, /formatCurrency\(historyGrossRisk\(trade\), 0\)/);
  assert.match(source, /group\.entryIvCoverage/);
  assert.doesNotMatch(source, /group\.strike|group\.soldPrice|group\.expirationClosePrice/);
});

test('History defaults grouped views collapsed and keeps the requested headline order', async () => {
  const source = await read('src/pages/PortfolioPage.tsx');
  assert.match(source, /collapsedHistoryGroups\[historyGroupKey\(group\)\] \?\? true/);
  assert.match(source, /const isHistoryGroupCollapsed/);
  const cards = source.slice(source.indexOf('portfolio-history-summary-grid'), source.indexOf('portfolio-history-summary-grid') + 3000);
  const labels = ['Realized P&L', 'Total Realized IRR', 'Blended Capture', 'Total Historical Notional', 'Resolved Trades', 'Avg. Days Held', 'Wtd. Avg. Entry Delta', 'Wtd. Avg. Entry IV'];
  let previous = -1;
  for (const label of labels) {
    const next = cards.indexOf(`label="${label}"`);
    assert.ok(next > previous, `${label} follows the requested order`);
    previous = next;
  }
  assert.match(source, /Realized P&amp;L by Expiration Month/);
  assert.match(source, /month\.month\.slice\(2, 4\)/);
  assert.doesNotMatch(source, /\{months\.length\} months/);
  assert.match(source, /visibleSummary\.counts\.expired_worthless/);
});

test('Portfolio header no longer carries the removed subtitle or replacement copy', async () => {
  const source = await read('src/pages/PortfolioPage.tsx');
  assert.doesNotMatch(source, /Sold-put positions, capital exposure, and lifecycle analytics\./);
  const header = source.slice(source.indexOf('<PageHeader'), source.indexOf('/>', source.indexOf('<PageHeader')) + 2);
  assert.match(header, /title="Portfolio"/);
  assert.doesNotMatch(header, /description=/);
});

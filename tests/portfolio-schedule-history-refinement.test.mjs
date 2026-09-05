import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

test('Schedule Entry Delta / IV display toggle defaults off and keeps paired values dense', async () => {
  const [portfolio, mobile, styles] = await Promise.all([
    read('src/pages/PortfolioPage.tsx'),
    read('src/components/mobile/MobilePositionRow.tsx'),
    read('src/index.css'),
  ]);
  assert.match(portfolio, /const \[showEntryDeltas, setShowEntryDeltas\] = useState\(false\)/);
  const controls = portfolio.slice(portfolio.indexOf('Show Nominal Yield'), portfolio.indexOf('Show Notes / Errors') + 'Show Notes / Errors'.length);
  assert.ok(controls.indexOf('Show Nominal Yield') < controls.indexOf('Show Entry Deltas / IV'));
  assert.ok(controls.indexOf('Show Entry Deltas / IV') < controls.indexOf('Show OI / Volume'));
  assert.match(portfolio, /showEntryDeltas \? 'Entry \/ Current Delta' : 'Current Delta'/);
  assert.match(portfolio, /showEntryDeltas \? 'Entry \/ Current IV' : 'IV'/);
  assert.match(portfolio, /showEntryDeltas && <span className="portfolio-paired-metric__line"><span className="portfolio-paired-metric__label">Entry/);
  assert.match(portfolio, /<span className="portfolio-paired-metric__line">\{showEntryDeltas && <span className="portfolio-paired-metric__label">Current<\/span>\} <span className="font-semibold"[^>]*>\{formatDelta\(delta\)/);
  assert.match(portfolio, /const quoteFreshness = getPortfolioQuoteFreshness\(trade\)/);
  assert.match(portfolio, /const visibleFreshness = quoteFreshness\.state === 'stale' \|\| quoteFreshness\.state === 'unavailable' \? quoteFreshness\.label : null/);
  assert.match(portfolio, /visibleFreshness && <span className="portfolio-paired-metric__status" data-freshness=\{quoteFreshness\.state\}>/);
  assert.doesNotMatch(portfolio, /<br \/><\/span><span className="text-\[9px\]"/);
  assert.match(portfolio, /showEntryDelta=\{showEntryDeltas\}/);
  assert.match(portfolio, /showEntryIv=\{showEntryDeltas\}/);
  assert.match(portfolio, /const entryDate = isPortfolioContractPosition\(trade\) \? formatPositionEntryDate\(trade\) : formatHistoryDate\(trade\.soldDate\)/);
  assert.match(portfolio, /entryDate=\{entryDate\}/);
  assert.match(portfolio, /sortButton\('entry', 'Entry'\)/);
  assert.match(portfolio, /showEntryDeltas && <span className="portfolio-paired-metric__line"><span className="portfolio-paired-metric__label">Entry<\/span> \{isValidEntryIv/);
  assert.match(mobile, /showEntryIv &&/);
  assert.match(mobile, /Current IV/);
  assert.match(mobile, /showEntryDelta = true/);
  assert.match(mobile, /showEntryDelta &&/);
  assert.match(mobile, /const freshnessStatus = freshness \?/);
  assert.match(mobile, /Current IV[\s\S]*freshnessStatus/);
  assert.doesNotMatch(mobile, /OTM<br \/>\{freshness\}/);
  assert.match(styles, /\.portfolio-paired-metric__line \{[\s\S]*display: block/);
  assert.match(styles, /\.portfolio-paired-metric__status \{/);
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

test('History keeps Schedule parity for density, grouping, semantic values, and safe ticker navigation', async () => {
  const [source, styles, docs] = await Promise.all([
    read('src/pages/PortfolioPage.tsx'),
    read('src/index.css'),
    read('docs/UI_PORTFOLIO_TABLE_PARITY_REFINEMENT.md'),
  ]);
  assert.match(source, /<Link to=\{`\/options\/\$\{trade\.ticker\.trim\(\)\.toUpperCase\(\)\}`\}/g);
  assert.match(source, /className="portfolio-history-table financial-table/);
  assert.match(styles, /\.portfolio-history-table thead th \{[\s\S]*height: 34px[\s\S]*background: var\(--bg-inset\)/);
  assert.match(styles, /\.portfolio-history-table tbody td \{[\s\S]*height: 28px[\s\S]*padding-block: 0\.25rem/);
  assert.match(styles, /\.portfolio-history-group-toggle \{[\s\S]*height: 20px[\s\S]*min-height: 20px/);
  assert.match(styles, /\.portfolio-history-group-subtotal td \{[\s\S]*height: 20px[\s\S]*color: var\(--text-primary\)/);
  assert.match(styles, /\.portfolio-history-group-subtotal__pnl \{[\s\S]*font-weight: 740/);
  assert.match(source, /<HistoryAggregateValue value=\{String\(group\.contractCount\)\}/);
  assert.match(source, /portfolio-history-actions[\s\S]*icon-button h-7 w-7/);
  assert.match(docs, /Fresh quote status is visually silent/);
  assert.match(docs, /safe current\/default `\/options\/TICKER` route/);
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
  assert.match(source, /const chartTitle = `\$\{metricLabel\} by Expiration \$\{periodLabel\}`/);
  assert.match(source, /aria-label=\{`\$\{metricLabel\} period`\}/);
  assert.match(source, /Only Show ETFs/);
  assert.match(source, /buildHistoryInstrumentScope/);
  assert.match(source, /visibleSummary\.totalHistoricalNotional/);
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

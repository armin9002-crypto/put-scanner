import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatOptionLastTradeDate } from '../src/lib/format.ts';
import { formatScannerDailyChangePercent } from '../src/lib/scannerPresentation.ts';
import { getOptionLastTradeFreshness } from '../src/lib/optionLastTradeFreshness.ts';
import { persistShowNominalYield, readShowNominalYield, SHOW_NOMINAL_YIELD_KEY } from '../src/lib/optionTablePreferences.ts';
import { OPTION_QUOTE_DISPLAY_ORDER, OPTION_QUOTE_TABLE_DISPLAY_ORDER, OPTION_YIELD_DISPLAY_ORDER, orderedOptionQuoteEntries } from '../src/lib/optionQuoteDisplay.ts';

test('option last-trade dates use compact US dates with a safe fallback', () => {
  assert.equal(formatOptionLastTradeDate(Date.parse('2026-10-16T15:45:00Z')), '10/16/26');
  assert.equal(formatOptionLastTradeDate(null), '—');
  assert.equal(formatOptionLastTradeDate(Number.NaN), '—');
});

test('desktop Scanner daily move presentation is percentage-only', () => {
  assert.equal(formatScannerDailyChangePercent(1.234), '+1.23%');
  assert.equal(formatScannerDailyChangePercent(-0.5), '-0.50%');
  assert.equal(formatScannerDailyChangePercent(null), '—');
});

test('Nominal Yield visibility defaults off and persists locally', () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  assert.equal(readShowNominalYield(storage), false);
  persistShowNominalYield(true, storage);
  assert.equal(values.get(SHOW_NOMINAL_YIELD_KEY), 'true');
  assert.equal(readShowNominalYield(storage), true);
  persistShowNominalYield(false, storage);
  assert.equal(readShowNominalYield(storage), false);
});

test('Last Trade freshness keeps thresholds and maps recent activity to success green', () => {
  const now = new Date(2026, 7, 13, 12).getTime();
  const timestamp = daysAgo => new Date(2026, 7, 13 - daysAgo, 12).getTime();
  assert.deepEqual(getOptionLastTradeFreshness(timestamp(2), now), { freshness: 'recent', ageDays: 2, label: null, color: 'var(--green)' });
  assert.deepEqual(getOptionLastTradeFreshness(timestamp(3), now), { freshness: 'stale', ageDays: 3, label: 'Stale', color: 'var(--yellow)' });
  assert.deepEqual(getOptionLastTradeFreshness(timestamp(8), now), { freshness: 'very_stale', ageDays: 8, label: 'Very stale', color: 'var(--red)' });
  assert.deepEqual(getOptionLastTradeFreshness(null, now), { freshness: 'unavailable', ageDays: null, label: null, color: 'var(--text-muted)' });
});

test('all quote views share deterministic LAST, BID, MID, ASK display order', () => {
  const optionsSource = readFileSync(new URL('../src/pages/OptionsPage.tsx', import.meta.url), 'utf8');
  const screenerSource = readFileSync(new URL('../src/pages/ScreenerPage.tsx', import.meta.url), 'utf8');
  const watchlistSource = readFileSync(new URL('../src/pages/WatchlistPage.tsx', import.meta.url), 'utf8');
  const drawerSource = readFileSync(new URL('../src/components/OptionDetailDrawer.tsx', import.meta.url), 'utf8');
  const portfolioSource = readFileSync(new URL('../src/pages/PortfolioPage.tsx', import.meta.url), 'utf8');
  const scannerCardSource = readFileSync(new URL('../src/components/ETFCard.tsx', import.meta.url), 'utf8');
  const mobileSource = readFileSync(new URL('../src/components/mobile/MobileOptionRow.tsx', import.meta.url), 'utf8');
  assert.deepEqual(OPTION_QUOTE_DISPLAY_ORDER, ['last', 'bid', 'mid', 'ask']);
  assert.deepEqual(OPTION_QUOTE_TABLE_DISPLAY_ORDER, ['last', 'bid', 'ask']);
  assert.deepEqual(orderedOptionQuoteEntries({ last: 4, bid: 3, mid: 2, ask: 1 }).map(entry => [entry.field, entry.value]), [
    ['last', 4], ['bid', 3], ['mid', 2], ['ask', 1],
  ]);
  for (const source of [optionsSource, screenerSource, watchlistSource]) {
    assert.match(source, /OPTION_QUOTE_TABLE_DISPLAY_ORDER\.map\(field => quoteColumns\[field\]\)/);
    assert.match(source, /OPTION_QUOTE_TABLE_DISPLAY_ORDER\.map\(field => <td/);
  }
  assert.match(mobileSource, /orderedOptionQuoteEntries\(\{ last: props\.last, bid: props\.bid, mid, ask: props\.ask \}\)/);
  assert.match(drawerSource, /orderedOptionQuoteEntries\(\{ last: usableLast, bid, mid, ask \}\)/);
  assert.match(portfolioSource, /orderedOptionQuoteEntries\(\{[\s\S]*?last: trade\.latestMarketData\?\.optionLast,[\s\S]*?bid: trade\.latestMarketData\?\.optionBid,[\s\S]*?mid: getPortfolioMidMark\(trade\),[\s\S]*?ask: trade\.latestMarketData\?\.optionAsk/);
  assert.match(scannerCardSource, /orderedOptionQuoteEntries\(\{ last: snapshot\?\.last, bid: snapshot\?\.bid, mid: snapshot\?\.midpoint, ask: snapshot\?\.ask \}\)/);
});

test('derived yield columns and values follow LAST, BID, ASK order', () => {
  const optionsSource = readFileSync(new URL('../src/pages/OptionsPage.tsx', import.meta.url), 'utf8');
  const screenerSource = readFileSync(new URL('../src/pages/ScreenerPage.tsx', import.meta.url), 'utf8');
  const watchlistSource = readFileSync(new URL('../src/pages/WatchlistPage.tsx', import.meta.url), 'utf8');
  assert.deepEqual(OPTION_YIELD_DISPLAY_ORDER, [
    'nomYieldLast', 'annYieldLast',
    'nomYieldBid', 'annYieldBid',
    'nomYieldAsk', 'annYieldAsk',
  ]);
  assert.deepEqual(OPTION_YIELD_DISPLAY_ORDER.filter(field => !field.startsWith('nomYield')), [
    'annYieldLast', 'annYieldBid', 'annYieldAsk',
  ]);
  for (const source of [optionsSource, screenerSource, watchlistSource]) {
    assert.match(source, /OPTION_YIELD_DISPLAY_ORDER\.map\(field => yieldColumns\[field\]\)/);
    assert.match(source, /(?:OPTION_YIELD_DISPLAY_ORDER|visibleYieldFields)\.map\(field => \{/);
  }
  for (const field of OPTION_YIELD_DISPLAY_ORDER) {
    assert.match(optionsSource, new RegExp(`case '${field}': return put\\.${field};`));
    assert.match(screenerSource, new RegExp(`case '${field}': aVal = a\\.${field}; bVal = b\\.${field}; break;`));
    assert.match(watchlistSource, new RegExp(`case '${field}': aVal = a\\.${field}; bVal = b\\.${field}; break;`));
  }
});

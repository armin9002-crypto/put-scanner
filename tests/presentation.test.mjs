import test from 'node:test';
import assert from 'node:assert/strict';
import { formatOptionLastTradeDate } from '../src/lib/format.ts';
import { formatScannerDailyChangePercent } from '../src/lib/scannerPresentation.ts';
import { getOptionLastTradeFreshness } from '../src/lib/optionLastTradeFreshness.ts';
import { persistShowNominalYield, readShowNominalYield, SHOW_NOMINAL_YIELD_KEY } from '../src/lib/optionTablePreferences.ts';

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

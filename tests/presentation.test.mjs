import test from 'node:test';
import assert from 'node:assert/strict';
import { formatOptionLastTradeDate } from '../src/lib/format.ts';
import { formatScannerDailyChangePercent } from '../src/lib/scannerPresentation.ts';

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

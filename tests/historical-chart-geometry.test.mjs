import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHistoricalCalendarTicks,
  segmentHistoricalPoints,
  selectHistoricalValueLabels,
} from '../src/lib/historicalChartGeometry.ts';

test('calendar ticks use true calendar boundaries and width spacing', () => {
  assert.deepEqual(buildHistoricalCalendarTicks('2024-01-01', '2025-04-01', 800), [
    { date: '2024-01-01', label: "Jan '24" },
    { date: '2024-04-01', label: "Apr '24" },
    { date: '2024-07-01', label: "Jul '24" },
    { date: '2024-10-01', label: "Oct '24" },
    { date: '2025-01-01', label: "Jan '25" },
    { date: '2025-04-01', label: "Apr '25" },
  ]);
  assert.deepEqual(buildHistoricalCalendarTicks('2024-02-27', '2024-03-01', 500), [
    { date: '2024-02-27', label: 'Feb 27' },
    { date: '2024-02-28', label: 'Feb 28' },
    { date: '2024-02-29', label: 'Feb 29' },
    { date: '2024-03-01', label: 'Mar 1' },
  ]);
  assert.deepEqual(buildHistoricalCalendarTicks('2023-01-01', '2026-02-01', 600), [
    { date: '2023-01-01', label: '2023' },
    { date: '2024-01-01', label: '2024' },
    { date: '2025-01-01', label: '2025' },
    { date: '2026-01-01', label: '2026' },
  ]);
  assert.deepEqual(buildHistoricalCalendarTicks('2023-01-01', '2029-02-01', 180), [
    { date: '2023-01-01', label: '2023' },
    { date: '2028-01-01', label: '2028' },
  ]);
});

test('value labels prioritize current then extrema and treat negative finite values correctly', () => {
  const labels = selectHistoricalValueLabels([
    { date: '2026-01-01', value: -3 },
    { date: '2026-01-02', value: null },
    { date: '2026-01-03', value: -1 },
    { date: '2026-01-04', value: -3 },
  ]);
  assert.deepEqual(labels, [
    { index: 3, roles: ['Current', 'Low'] },
    { index: 2, roles: ['High'] },
  ]);
  assert.deepEqual(selectHistoricalValueLabels([{ date: '2026-01-01', value: null }]), []);
});

test('segments preserve singleton islands, null gaps, and partial-window edge status', () => {
  assert.deepEqual(segmentHistoricalPoints([
    { date: '2026-01-01', value: 1, fullWindow: false },
    { date: '2026-01-02', value: 2, fullWindow: true },
    { date: '2026-01-03', value: null, fullWindow: true },
    { date: '2026-01-04', value: -1, fullWindow: true },
    { date: '2026-01-05', value: null, fullWindow: false },
    { date: '2026-01-06', value: 0, fullWindow: false },
  ]), [
    { kind: 'partial', indexes: [0, 1] },
    { kind: 'solid', indexes: [3] },
    { kind: 'partial', indexes: [5] },
  ]);
  assert.deepEqual(segmentHistoricalPoints([
    { date: '2026-01-01', value: 1, fullWindow: false },
    { date: '2026-01-02', value: 2, fullWindow: false },
    { date: '2026-01-03', value: 3, fullWindow: true },
    { date: '2026-01-04', value: 4, fullWindow: true },
    { date: '2026-01-05', value: 5, fullWindow: true },
  ]), [
    { kind: 'partial', indexes: [0, 1, 2] },
    { kind: 'solid', indexes: [2, 3, 4] },
  ]);
});

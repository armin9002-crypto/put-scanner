import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HISTORICAL_VISIBLE_RANGE_LABELS,
  HISTORICAL_VISIBLE_RANGES,
  selectHistoricalVisiblePoints,
} from '../src/lib/historicalVisibleRange.ts';
const points = ['2024-08-31', '2025-08-31', '2026-02-28', '2026-05-31', '2026-08-31'].map((date, index) => ({ date, value: index === 3 ? null : index, fullWindow: index > 1 }));
test('visible ranges retain exact original observations, nulls and partial metadata', () => {
  assert.equal(selectHistoricalVisiblePoints(points, '2026-08-31', 'Since Inception'), points);
  for (const [range, start] of [['L3M', 3], ['L6M', 2], ['L1Y', 1], ['L2Y', 0]]) {
    const result = selectHistoricalVisiblePoints(points, '2026-08-31', range);
    assert.deepEqual(result, points.slice(start));
    result.forEach((point, index) => assert.equal(point, points[start + index]));
  }
});
test('empty history remains empty and month ends clamp without invented timestamps', () => {
  assert.deepEqual(selectHistoricalVisiblePoints([], '2026-08-31', 'L3M'), []);
  assert.equal(selectHistoricalVisiblePoints(points, '2026-08-31', 'L6M')[0].date, '2026-02-28');
});
test('YTD uses the supplied canonical end date and multi-year ranges retain leap-day boundaries', () => {
  const dated = ['2023-02-28', '2023-03-01', '2024-01-01', '2024-02-29', '2026-02-28', '2026-03-01']
    .map(date => ({ date }));
  assert.deepEqual(selectHistoricalVisiblePoints(dated, '2024-02-29', 'YTD').map(point => point.date), ['2024-01-01', '2024-02-29']);
  assert.deepEqual(selectHistoricalVisiblePoints(dated, '2026-02-28', 'L3Y').map(point => point.date), ['2023-02-28', '2023-03-01', '2024-01-01', '2024-02-29', '2026-02-28']);
});
test('range keys retain internal compatibility while exposing compact display labels', () => {
  assert.deepEqual(HISTORICAL_VISIBLE_RANGES, ['L3M', 'L6M', 'YTD', 'L1Y', 'L2Y', 'L3Y', 'Since Inception']);
  assert.deepEqual(HISTORICAL_VISIBLE_RANGE_LABELS, {
    L3M: '3M', L6M: '6M', YTD: 'YTD', L1Y: '1Y', L2Y: '2Y', L3Y: '3Y', 'Since Inception': 'All',
  });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { selectHistoricalVisiblePoints } from '../src/lib/historicalVisibleRange.ts';
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

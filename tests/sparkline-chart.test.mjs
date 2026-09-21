import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSparklineGeometry } from '../src/lib/sparklineGeometry.ts';

const sample = [100, 106, 101, 112, 103];

test('sparkline geometry maps asymmetric data to both plot edges and vertical bounds', () => {
  const geometry = buildSparklineGeometry(sample, 240, 74);

  assert.equal(geometry.points[0].x, 2);
  assert.equal(geometry.points.at(-1)?.x, 238);
  assert.equal(Math.min(...geometry.points.map(point => point.y)), 2);
  assert.equal(Math.max(...geometry.points.map(point => point.y)), 72);
  assert.match(geometry.path, /^M2,/);
  assert.match(geometry.path, /238,.*$/);
});

test('responsive dimensions recalculate geometry instead of stretching a legacy rectangle', () => {
  const wide = buildSparklineGeometry(sample, 480, 40);
  const compact = buildSparklineGeometry(sample, 240, 74);

  for (const [index, point] of wide.points.entries()) {
    const wideX = (point.x - 2) / (480 - 4);
    const compactX = (compact.points[index].x - 2) / (240 - 4);
    const wideY = (point.y - 2) / (40 - 4);
    const compactY = (compact.points[index].y - 2) / (74 - 4);
    assert.ok(Math.abs(wideX - compactX) < 1e-12);
    assert.ok(Math.abs(wideY - compactY) < 1e-12);
  }

  assert.equal(wide.points[0].y, 38);
  assert.equal(wide.points[3].y, 2);
});

test('previous-close reference remains part of the responsive y-domain', () => {
  const geometry = buildSparklineGeometry(sample, 320, 44, 98);

  assert.equal(geometry.referenceY, 42);
  assert.equal(Math.min(...geometry.points.map(point => point.y)), 2);
  assert.ok(Math.max(...geometry.points.map(point => point.y)) < 42);
});

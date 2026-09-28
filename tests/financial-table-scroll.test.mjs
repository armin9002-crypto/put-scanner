import test from 'node:test';
import assert from 'node:assert/strict';
import { updateFinancialTableScroll } from '../src/lib/financialTableScroll.ts';

test('scroll boundary writes only on edge crossings, without touching rows', () => {
  const writes = [];
  const owner = { scrollLeft: 0, dataset: new Proxy({}, { set(target, key, value) { writes.push(value); target[key] = value; return true; } }) };
  for (const left of [0, 0, 0.5, 2, 80, 400, 20, 0, -8, 0]) {
    owner.scrollLeft = left;
    updateFinancialTableScroll({ currentTarget: owner });
  }
  assert.deepEqual(writes, ['false', 'true', 'false']);
});

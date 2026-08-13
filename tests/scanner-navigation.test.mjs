import test from 'node:test';
import assert from 'node:assert/strict';
import { isScannerNavigationState, scannerFallbackPath } from '../src/lib/scannerNavigation.ts';

test('ETF back navigation recognizes only explicit Scanner history state', () => {
  assert.equal(isScannerNavigationState({ fromScanner: true }), true);
  assert.equal(isScannerNavigationState({ fromScanner: false }), false);
  assert.equal(isScannerNavigationState(null), false);
});

test('ETF direct/new-tab fallback accepts only local Scanner URLs', () => {
  assert.equal(scannerFallbackPath('/?expiry=2026-10-16&leverage=3x&q=boil'), '/?expiry=2026-10-16&leverage=3x&q=boil');
  assert.equal(scannerFallbackPath('/'), '/');
  assert.equal(scannerFallbackPath('/options/BOIL?expiry=1'), '/');
  assert.equal(scannerFallbackPath('https://example.com/?expiry=2026-10-16'), '/');
  assert.equal(scannerFallbackPath(null), '/');
});

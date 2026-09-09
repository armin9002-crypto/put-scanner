import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOptionsPath,
  createOptionsOrigin,
  createOptionsNavigationState,
  parseOptionsOrigin,
  resolveOptionsOrigin,
  OPTIONS_ORIGIN_VERSION,
} from '../src/lib/optionsNavigation.ts';

const expiry = Date.parse('2027-01-15T00:00:00Z') / 1_000;

test('XAPP-011 allows only the six internal semantic origins', () => {
  for (const [kind, path] of [
    ['scanner', '/'],
    ['pulse', '/pulse'],
    ['screener', '/screener'],
    ['watchlist', '/watchlist'],
    ['portfolio', '/portfolio'],
    ['recommendations', '/recommendations'],
  ]) {
    const origin = createOptionsOrigin(kind, { path });
    assert.equal(origin.kind, kind);
    assert.equal(origin.path, path);
    assert.equal(parseOptionsOrigin(origin)?.kind, kind);
  }
});

test('XAPP-011 rejects malformed, stale, external, and mismatched origins', () => {
  const valid = createOptionsOrigin('pulse');
  assert.equal(parseOptionsOrigin(null), null);
  assert.equal(parseOptionsOrigin({ ...valid, version: OPTIONS_ORIGIN_VERSION + 1 }), null);
  assert.equal(parseOptionsOrigin({ ...valid, path: 'https://example.com' }), null);
  assert.equal(parseOptionsOrigin({ ...valid, path: '/screener' }), null);
  assert.equal(parseOptionsOrigin({ ...valid, kind: 'not-a-kind' }), null);
  assert.equal(parseOptionsOrigin({ ...valid, stateKey: { unsafe: true } }), null);
  assert.equal(resolveOptionsOrigin({ optionsOrigin: { ...valid, path: '/options/TQQQ' } }).kind, 'scanner');
});

test('XAPP-011 fallback is Scanner and legacy Scanner state remains accepted', () => {
  assert.equal(resolveOptionsOrigin(null).kind, 'scanner');
  assert.equal(resolveOptionsOrigin({ fromScanner: true }).kind, 'scanner');
  assert.equal(resolveOptionsOrigin({ fromScanner: true }).path, '/');
});

test('Options path builder normalizes ticker and canonicalizes ISO and Unix expiry', () => {
  assert.equal(buildOptionsPath(' tqqq '), '/options/TQQQ');
  assert.equal(buildOptionsPath('tqqq', '2027-01-15'), '/options/TQQQ?expiry=2027-01-15');
  assert.equal(buildOptionsPath('tqqq', String(expiry)), '/options/TQQQ?expiry=2027-01-15');
  assert.equal(buildOptionsPath('tqqq', 'not-an-expiry'), '/options/TQQQ');
});

test('source state contains only the validated origin descriptor', () => {
  const state = createOptionsNavigationState('recommendations', { path: '/recommendations' });
  assert.deepEqual(Object.keys(state), ['optionsOrigin']);
  assert.equal(state.optionsOrigin.path, '/recommendations');
});

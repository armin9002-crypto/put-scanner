import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExactOptionContractKey,
  makePortfolioContractKey,
} from '../src/lib/portfolioContractIdentity.ts';
import {
  getOptionContractKey,
  makeWatchlistId,
  normalizeWatchlistItem,
} from '../src/lib/watchlist.ts';
import { buildOpenContractPositions } from '../src/lib/portfolioContractPositions.ts';

const canonicalIdentity = {
  ticker: 'TQQQ',
  optionType: 'put',
  expiration: '2027-01-15',
  strike: 50,
};

test('XAPP-013 canonical valid contract identity outputs are locked', () => {
  const expected = 'TQQQ|put|2027-01-15|50';
  assert.equal(buildExactOptionContractKey(canonicalIdentity), expected);
  assert.equal(getOptionContractKey(canonicalIdentity), expected);
  assert.equal(makeWatchlistId('TQQQ', '2027-01-15', 50), expected);
  assert.equal(makePortfolioContractKey(canonicalIdentity), expected);
  assert.equal(getOptionContractKey({ ...canonicalIdentity, ticker: ' tqqq ' }), expected);
  assert.equal(makePortfolioContractKey({ ...canonicalIdentity, ticker: ' tqqq ' }), expected);
  assert.equal(makePortfolioContractKey({ ...canonicalIdentity, ticker: 'TQQQ', optionType: ' PUT ' }), expected);
});

test('XAPP-013 exact strike serialization preserves current four-decimal boundaries', () => {
  const expectedByStrike = new Map([
    [50, 'TQQQ|put|2027-01-15|50'],
    [50.0, 'TQQQ|put|2027-01-15|50'],
    [50.000049, 'TQQQ|put|2027-01-15|50'],
    [50.00005, 'TQQQ|put|2027-01-15|50.0001'],
    [49.99995, 'TQQQ|put|2027-01-15|49.9999'],
    [40.12345678, 'TQQQ|put|2027-01-15|40.1235'],
  ]);

  for (const [strike, expected] of expectedByStrike) {
    const identity = { ...canonicalIdentity, strike };
    assert.equal(getOptionContractKey(identity), expected, `Watchlist strike ${strike}`);
    assert.equal(makePortfolioContractKey(identity), expected, `Portfolio strike ${strike}`);
  }
});

test('XAPP-013 keeps Watchlist and Portfolio expiration adapters distinct', () => {
  const unixSeconds = 1_790_035_200;
  assert.equal(
    getOptionContractKey({ ticker: 'TQQQ', optionType: 'put', expiration: unixSeconds, strike: 50 }),
    'TQQQ|put|2026-09-22|50',
  );
  assert.equal(
    getOptionContractKey({ ticker: 'TQQQ', optionType: 'put', expiration: String(unixSeconds), strike: 50 }),
    'TQQQ|put|2026-09-22|50',
  );
  assert.throws(
    () => makePortfolioContractKey({ ...canonicalIdentity, expiration: unixSeconds }),
    TypeError,
  );
  assert.equal(
    makePortfolioContractKey({ ...canonicalIdentity, expiration: '2027-01-15T12:00:00Z' }),
    'TQQQ|put|2027-01-15|50',
  );
  assert.equal(
    makePortfolioContractKey({ ...canonicalIdentity, expiration: 'Jan 15 2027' }),
    'TQQQ|put|2027-01-15|50',
  );
});

test('XAPP-013 expiryTimestamp precedence and persisted Watchlist IDs remain compatible', () => {
  const persisted = normalizeWatchlistItem({
    id: 'TQQQ|put|2026-09-22|50',
    ticker: ' tqqq ',
    expiry: '2027-01-15',
    expiryTimestamp: 1_790_035_200,
    expiryFormatted: "Sep 22 '26",
    strike: 50,
    optionType: 'put',
    addedAt: 1,
    savedAt: 1,
    note: '',
  });
  assert.ok(persisted);
  assert.equal(persisted.id, 'TQQQ|put|2026-09-22|50');
  assert.equal(persisted.expiry, '2026-09-22');
  assert.equal(persisted.expiryTimestamp, 1_790_035_200);
});

test('XAPP-013 derived Portfolio identity groups lots without changing durable lot IDs', () => {
  const lot = (id, soldDate, soldPrice) => ({
    id,
    ticker: 'TQQQ',
    optionType: 'put',
    strike: 50,
    expiration: '2027-01-15',
    contracts: 1,
    soldPrice,
    soldDate,
    status: 'open',
    createdAt: `${soldDate}T15:00:00Z`,
    updatedAt: `${soldDate}T15:00:00Z`,
  });
  const trades = [lot('lot-a', '2026-05-01', 1.2), lot('lot-b', '2026-05-20', 1.65)];
  const positions = buildOpenContractPositions(trades, 'ask');

  assert.deepEqual(trades.map(trade => trade.id), ['lot-a', 'lot-b']);
  assert.equal(positions.length, 1);
  assert.equal(positions[0].contractKey, 'TQQQ|put|2027-01-15|50');
  assert.equal(positions[0].id, 'contract:TQQQ|put|2027-01-15|50');
  assert.deepEqual(positions[0].lots.map(trade => trade.id), ['lot-a', 'lot-b']);
});

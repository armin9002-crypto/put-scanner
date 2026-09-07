import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWatchlistGroups } from '../src/lib/watchlistPresentation.ts';
import { pruneExpiredWatchlistItems, pruneExpiredWatchlist, mergeWatchlistRefreshItems, writeWatchlist, readWatchlist } from '../src/lib/watchlist.ts';
import { getAccountStateStorage } from '../src/lib/cloudState/accountStateStorage.ts';
const now = new Date('2026-09-07T16:00:00Z');

const item = (ticker, expiry, strike) => ({ id: `${ticker}|put|${expiry}|${strike}`, ticker, expiry, expiryTimestamp: Date.parse(`${expiry}T00:00:00Z`) / 1000, expiryFormatted: expiry, strike, optionType: 'put', addedAt: 1, savedAt: 1, note: 'remove with contract' });
test('Watchlist None is one globally sorted flat population in either direction', () => {
  const rows = [item('ZZZ', '2028-01-21', 20), item('AAA', '2027-01-15', 40), item('ZZZ', '2027-01-15', 30)];
  for (const [direction, expected] of [['asc', [20, 30, 40]], ['desc', [40, 30, 20]]]) {
    const groups = buildWatchlistGroups(rows, 'none', { field: 'strike', direction });
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].rows.map(row => row.strike), expected);
  }
  assert.equal(buildWatchlistGroups(rows, 'underlying').length, 2);
  assert.equal(buildWatchlistGroups(rows, 'expiry').length, 2);
});

test('Watchlist keeps all expiration trading day; day after prunes durable item and note, refresh cannot resurrect', () => {
  const expired = item('LABU', '2026-09-04', 40);
  const future = item('LABU', '2028-01-21', 50);
  assert.equal(pruneExpiredWatchlistItems([expired], new Date('2026-09-05T03:59:59Z')).length, 1);
  assert.equal(pruneExpiredWatchlistItems([expired], new Date('2026-09-05T04:00:00Z')).length, 0);
  const storage = getAccountStateStorage();
  storage.setWritable(true);
  assert.equal(writeWatchlist(storage, [expired, future]).status, 'ok');
  const remaining = pruneExpiredWatchlist(now);
  assert.deepEqual(remaining.map(row => row.id), [future.id]);
  assert.deepEqual(readWatchlist(storage).data.map(row => row.id), [future.id]);
  assert.deepEqual(mergeWatchlistRefreshItems(remaining, [expired, future]).map(row => row.id), [future.id]);
});


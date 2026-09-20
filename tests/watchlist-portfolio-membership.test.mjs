import test from 'node:test';
import assert from 'node:assert/strict';

import { buildOpenPortfolioContractKeys, isWatchlistContractInOpenPortfolio } from '../src/lib/watchlistPortfolioMembership.ts';
import { formatWatchlistExpiry } from '../src/lib/watchlist.ts';

const watchlistContract = (overrides = {}) => ({
  ticker: 'TQQQ',
  expiry: '2027-01-15',
  strike: 50,
  optionType: 'put',
  ...overrides,
});

const portfolioTrade = (overrides = {}) => ({
  id: 'lot-1',
  ticker: 'TQQQ',
  optionType: 'put',
  expiration: '2027-01-15',
  strike: 50,
  status: 'open',
  ...overrides,
});

test('Watchlist membership is green only for an exact open Portfolio contract', () => {
  const openKeys = buildOpenPortfolioContractKeys([portfolioTrade()]);
  assert.equal(isWatchlistContractInOpenPortfolio(watchlistContract(), openKeys), true);
  assert.equal(isWatchlistContractInOpenPortfolio(watchlistContract({ strike: 50.01 }), openKeys), false);
  assert.equal(isWatchlistContractInOpenPortfolio(watchlistContract({ expiry: '2027-01-22' }), openKeys), false);
});

test('closed or historical Portfolio lots do not count, while duplicate open lots do', () => {
  const openKeys = buildOpenPortfolioContractKeys([
    portfolioTrade({ id: 'closed', status: 'closed' }),
    portfolioTrade({ id: 'historical', status: 'expired' }),
    portfolioTrade({ id: 'open-a' }),
    portfolioTrade({ id: 'open-b' }),
  ]);
  assert.equal(openKeys.size, 1);
  assert.equal(isWatchlistContractInOpenPortfolio(watchlistContract(), openKeys), true);
  assert.equal(isWatchlistContractInOpenPortfolio(watchlistContract({ ticker: 'SPY' }), openKeys), false);
});

test('Watchlist display expiry always uses compact canonical year-inclusive formatting', () => {
  assert.equal(formatWatchlistExpiry('2026-12-18'), "Dec 18 '26");
  assert.equal(formatWatchlistExpiry('2027-01-15'), "Jan 15 '27");
  assert.equal(formatWatchlistExpiry('2027-03-19'), "Mar 19 '27");
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { accountStateStorage } from '../src/lib/cloudState/accountStateStorage.ts';
import { makePortfolioContractKey } from '../src/lib/portfolioContractIdentity.ts';
import {
  buildAddToPositionSeed,
  buildHistoricalContractPositions,
  buildOpenContractPositions,
} from '../src/lib/portfolioContractPositions.ts';
import {
  buildHistoryAnalytics,
  filterHistoryTrades,
  historyRealizedPnl,
} from '../src/lib/portfolioHistoryAnalytics.ts';
import {
  calculateOriginalAnnualizedYield,
  calculatePercentCaptured,
  calculatePremiumCollected,
  calculateTotalGainLoss,
} from '../src/lib/portfolioMetrics.ts';
import {
  addPortfolioTrade,
  deletePortfolioTrade,
  updatePortfolioTrade,
  writePortfolioTrades,
} from '../src/lib/portfolioStorage.ts';

const lot = (overrides = {}) => ({
  id: 'lot-a',
  ticker: 'TQQQ',
  optionType: 'put',
  strike: 40,
  expiration: '2027-01-15',
  contracts: 10,
  soldPrice: 1.2,
  soldDate: '2026-05-01',
  status: 'open',
  entryDelta: -0.2,
  entryIv: 40,
  entryVixClose: 20,
  createdAt: '2026-05-01T15:00:00Z',
  updatedAt: '2026-05-01T15:00:00Z',
  latestMarketData: {
    underlyingPrice: 55,
    optionBid: 0.4,
    optionAsk: 0.6,
    optionMid: 0.5,
    optionLast: 0.55,
    delta: -0.15,
    iv: 55,
    refreshedAt: '2026-08-01T15:00:00Z',
    availabilityStatus: 'live',
  },
  ...overrides,
});

function assertClose(actual, expected, message, tolerance = 1e-12) {
  assert.ok(actual != null, `${message}: expected a numeric value`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected}, received ${actual}`);
}

test('canonical contract identity normalizes contract facts and excludes Sold Date', () => {
  const first = makePortfolioContractKey({ ticker: ' tqqq ', optionType: 'PUT', expiration: '2027-01-15T12:00:00Z', strike: 40.00000001 });
  const second = makePortfolioContractKey({ ticker: 'TQQQ', optionType: 'put', expiration: '2027-01-15', strike: 40 });
  assert.equal(first, 'TQQQ|put|2027-01-15|40');
  assert.equal(second, first);
  assert.equal(makePortfolioContractKey({ ticker: 'TQQQ', optionType: 'put', expiration: '2027-01-15', strike: 40 }), second);
});

test('two independent lots derive one open contract position with canonical aggregate economics', () => {
  const first = lot();
  const second = lot({
    id: 'lot-b', contracts: 5, soldPrice: 1.65, soldDate: '2026-05-20', entryDelta: -0.4, entryIv: 80, entryVixClose: 30,
    createdAt: '2026-05-20T15:00:00Z', updatedAt: '2026-08-02T15:00:00Z',
    latestMarketData: { underlyingPrice: 56, optionBid: 0.45, optionAsk: 0.5, optionMid: 0.475, optionLast: 0.48, delta: -0.12, iv: 52, refreshedAt: '2026-08-02T15:00:00Z', availabilityStatus: 'live' },
  });
  const canonical = [first, second];
  const positions = buildOpenContractPositions(canonical, 'ask');
  assert.equal(canonical.length, 2);
  assert.equal(new Set(canonical.map(item => item.id)).size, 2);
  assert.equal(positions.length, 1);
  const position = positions[0];
  assert.equal(position.lotCount, 2);
  assert.equal(position.totalContracts, 15);
  assert.deepEqual(position.lots.map(item => item.id), ['lot-a', 'lot-b']);
  assertClose(position.soldPrice, 1.35, 'contract-weighted sold credit');
  assert.equal(position.positionMetrics.premiumCollected, 2_025);
  assert.equal(position.positionMetrics.grossRisk, 60_000);
  assert.equal(position.positionMetrics.netCapitalRisk, 57_975);
  assert.equal(position.positionMetrics.currentValue, -750);
  assert.equal(position.positionMetrics.totalGainLoss, 1_275);
  assertClose(position.positionMetrics.percentCaptured, 1_275 / 2_025, 'aggregate capture');
  assertClose(calculatePercentCaptured(position, 'ask'), 1_275 / 2_025, 'visible capture');
  assert.equal(calculateTotalGainLoss(position, 'ask'), 1_275);
  assert.equal(position.positionMetrics.breakeven, 38.65);
  assertClose(position.entryDelta, (-0.2 * 40_000 + -0.4 * 20_000) / 60_000, 'Gross-Risk-weighted Entry Delta');
  assertClose(position.entryIv, (40 * 40_000 + 80 * 20_000) / 60_000, 'Gross-Risk-weighted Entry IV');
  assertClose(position.entryVixClose, (20 * 40_000 + 30 * 20_000) / 60_000, 'Gross-Risk-weighted Entry VIX');
  const expectedEntryAy = (calculateOriginalAnnualizedYield(first) * 40_000 + calculateOriginalAnnualizedYield(second) * 20_000) / 60_000;
  assertClose(position.positionMetrics.originalAnnualizedYield, expectedEntryAy, 'lot-level Entry AY aggregation');
  assertClose(calculateOriginalAnnualizedYield(position), expectedEntryAy, 'derived Entry AY is not synthesized from one date');
  assert.equal(position.latestMarketData.optionAsk, 0.5, 'freshest valid contract observation wins');
  assert.equal(position.latestMarketData.delta, -0.12, 'current Delta remains a contract fact');
  assert.equal(position.importedSnapshot, undefined, 'multi-lot positions never inherit one lot snapshot as aggregate state');
});

test('same contract and Sold Date with different prices remains two lots and one position', () => {
  const positions = buildOpenContractPositions([lot(), lot({ id: 'lot-b', contracts: 5, soldPrice: 1.65 })], 'ask');
  assert.equal(positions.length, 1);
  assert.equal(positions[0].lotCount, 2);
});

test('three-entry editor foundation retains every lot and Add to Position leaves entry facts blank', () => {
  const position = buildOpenContractPositions([lot(), lot({ id: 'lot-b' }), lot({ id: 'lot-c' })], 'ask')[0];
  assert.deepEqual(position.lots.map(item => item.id), ['lot-a', 'lot-b', 'lot-c']);
  const seed = buildAddToPositionSeed(position);
  assert.deepEqual({ ticker: seed.ticker, optionType: seed.optionType, expiration: seed.expiration, strike: seed.strike }, { ticker: 'TQQQ', optionType: 'put', expiration: '2027-01-15', strike: 40 });
  assert.equal(Number.isNaN(seed.contracts), true);
  assert.equal(Number.isNaN(seed.soldPrice), true);
  assert.equal(seed.soldDate, '');
  assert.equal(seed.id, undefined);
});

test('lot-scoped edit, delete, and add operations preserve sibling entries and allocate a fresh ID', () => {
  accountStateStorage.replace([], true);
  const original = [lot(), lot({ id: 'lot-b', contracts: 5, soldPrice: 1.65 })];
  assert.equal(writePortfolioTrades(accountStateStorage, original).status, 'ok');
  const edited = updatePortfolioTrade('lot-b', { soldPrice: 1.8 });
  assert.equal(edited.find(item => item.id === 'lot-a').soldPrice, 1.2);
  assert.equal(edited.find(item => item.id === 'lot-b').soldPrice, 1.8);
  const deleted = deletePortfolioTrade('lot-b');
  assert.deepEqual(deleted.map(item => item.id), ['lot-a']);
  const added = addPortfolioTrade({ ...buildAddToPositionSeed(buildOpenContractPositions(deleted, 'ask')[0]), contracts: 2, soldPrice: 1.4, soldDate: '2026-06-01', status: 'open' });
  assert.equal(added.length, 2);
  assert.equal(added[0].id, 'lot-a');
  assert.notEqual(added[1].id, 'lot-a');
  accountStateStorage.lockAndClear();
});

test('History filters lots before grouping and preserves event analytics', () => {
  const expired = lot({
    status: 'expired', resolutionType: 'expired_worthless', expiration: '2026-06-19', soldDate: '2026-05-01',
    finalOptionValue: 0, realizedPnl: 1_200, premiumCollected: 1_200, percentCaptured: 1, daysHeld: 49,
  });
  const closed = lot({
    id: 'lot-b', contracts: 5, soldPrice: 1.65, status: 'closed', expiration: '2026-06-19', soldDate: '2026-05-20', closeDate: '2026-06-10', closePrice: 0.5,
    closeUnderlyingPrice: 72, closeUnderlyingPriceSource: 'imported',
  });
  const allLots = [expired, closed];
  const allPositions = buildHistoricalContractPositions(filterHistoryTrades(allLots, 'all'));
  assert.equal(allPositions.length, 1);
  assert.equal(allPositions[0].outcomeLabel, 'Mixed');
  assert.equal(allPositions[0].positionMetrics.realizedPnl, historyRealizedPnl(expired) + historyRealizedPnl(closed));
  assertClose(allPositions[0].positionMetrics.historicalPercentCaptured, (1_200 + 575) / (1_200 + 825), 'historical aggregate capture');
  const expiredOnly = buildHistoricalContractPositions(filterHistoryTrades(allLots, 'expired_worthless'));
  const closedOnly = buildHistoricalContractPositions(filterHistoryTrades(allLots, 'closed'));
  assert.equal(closedOnly[0].closeUnderlyingPrice, 72);
  assert.equal(closedOnly[0].positionMetrics.priceAtExpiration, 72);
  assert.deepEqual(expiredOnly[0].lots.map(item => item.id), ['lot-a']);
  assert.deepEqual(closedOnly[0].lots.map(item => item.id), ['lot-b']);
  assert.equal(buildHistoryAnalytics(allLots).resolvedTrades, 2, 'historical activity remains lot/event based');
});

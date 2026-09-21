import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { buildOpenContractPositions, buildPortfolioValuationLots } from '../src/lib/portfolioContractPositions.ts';
import { calculatePortfolioMarkSummary, calculatePortfolioCurrentAyCoverage, calculateOriginalAnnualizedYield, calculatePremiumCollected } from '../src/lib/portfolioMetrics.ts';
import { getPortfolioTotals, buildExpirationScheduleGroups, buildUnderlyingScheduleGroups } from '../src/lib/portfolioAnalytics.ts';
import { buildWatchlistRow } from '../src/lib/watchlistRows.ts';
import { normalizeWatchlistItem } from '../src/lib/watchlist.ts';
import { calculateDte } from '../src/lib/optionMetrics.ts';
import { CALCULATED_PUT_DELTA_MODEL } from '../src/lib/putDelta.ts';

const near = (a, b) => { assert.ok(Number.isFinite(a) && Number.isFinite(b)); assert.ok(Math.abs(a - b) < 1e-10, `${a} != ${b}`); };
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
// Execute the actual TSX boundary expressions rather than copying their mappings.
// Only pure object/function expressions selected from the repository are evaluated.
function boundaryExpression(file, predicate, context) {
  const source = ts.createSourceFile(file, read(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found;
  const visit = node => { if (predicate(node)) found = node; else ts.forEachChild(node, visit); };
  visit(source);
  assert.ok(found, `missing boundary in ${file}`);
  const expression = ts.isPropertyAssignment(found) ? found.initializer.getText(source) : found.getText(source);
  const javascript = ts.transpileModule(`const boundary = (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return Function(...Object.keys(context), `${javascript}; return boundary;`)(...Object.values(context));
}
const snapshotNode = node => ts.isPropertyAssignment(node) && node.name.getText() === 'snapshot';

test('discovery save and Watchlist Drawer preserve Delta provenance and invalid economics', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-01T16:00:00Z') });
  const expiry = '2026-10-16';
  const expiryTimestamp = Date.parse(`${expiry}T00:00Z`) / 1000;
  for (const deltaSource of ['provider', 'calculated']) {
    for (const integrityStatus of ['clean', 'invalid']) {
      const put = { strike: 50, bid: 1.234567, ask: 1.45, last: 1.35, lastTradeDate: null, delta: -0.234567, deltaSource, deltaModelVersion: deltaSource === 'calculated' ? CALCULATED_PUT_DELTA_MODEL.version : null, impliedVolatility: 61.234567, iv: 61.234567, integrityStatus, integrityReasonCodes: integrityStatus === 'invalid' ? ['CROSSED_MARKET'] : [], dte: 45 };
      const contexts = [
        ['src/pages/OptionsPage.tsx', { put, currentPrice: 55, exp: { date: expiryTimestamp }, calculateDte }],
        ['src/pages/RecommendationsPage.tsx', { row: put, candidate: { underlyingPrice: 55 }, CALCULATED_PUT_DELTA_MODEL }],
      ];
      for (const [file, context] of contexts) {
        const snapshot = boundaryExpression(file, snapshotNode, context);
        assert.equal(snapshot.deltaSource, deltaSource);
        assert.equal(snapshot.deltaModelVersion, put.deltaModelVersion);
        assert.equal(snapshot.integrityStatus, integrityStatus);
        const saved = normalizeWatchlistItem({ id: 'TST:fixture', ticker: 'TST', optionType: 'put', expiry, expiryTimestamp, strike: 50, addedAt: Date.now(), savedAt: Date.now(), snapshot });
        assert.ok(saved);
        const row = buildWatchlistRow(saved);
        const mapDrawer = boundaryExpression('src/pages/WatchlistPage.tsx', node => ts.isFunctionDeclaration(node) && node.name?.text === 'optionDetailFromWatchlistRow', {});
        const drawer = mapDrawer(row);
        if (integrityStatus === 'invalid') {
          for (const field of ['annYieldBid', 'annYieldAsk', 'annYieldLast', 'delta', 'iv']) assert.equal(row[field], null, `${file}: invalid ${field}`);
          assert.equal(drawer.integrityStatus, 'invalid');
          assert.equal(row.bid, put.bid, 'raw quote remains auditable');
        } else {
          assert.equal(drawer.deltaSource, deltaSource);
          assert.equal(drawer.deltaModelVersion, put.deltaModelVersion);
          near(row.annYieldLast, put.last / 50 * 365 / 45 * 100);
        }
      }
    }
  }
});

test('contract observation reconciles rows, headline, schedule and lot-weighted entry yields', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-01T16:00:00Z') });
  const lot = { ticker: 'TST', optionType: 'put', strike: 50.125, expiration: '2026-10-16', status: 'open', createdAt: '2026-08-01T15:00Z', updatedAt: '2026-08-01T15:00Z' };
  for (const oldMarket of [undefined, { optionAsk: 1.111111, refreshedAt: '2026-08-28T16:00Z', availabilityStatus: 'live', delta: -0.5 }]) {
    const lots = [{ ...lot, id: 'old', soldDate: '2026-08-01', contracts: 2, soldPrice: 1.234567, latestMarketData: oldMarket }, { ...lot, id: 'new', soldDate: '2026-08-20', contracts: 3, soldPrice: 1.987654, latestMarketData: { optionAsk: 0.456789, refreshedAt: '2026-09-01T16:00Z', availabilityStatus: 'live', delta: -0.2 } }];
    const before = structuredClone(lots);
    const positions = buildOpenContractPositions(lots, 'ask');
    const valuationLots = buildPortfolioValuationLots(positions);
    const headline = calculatePortfolioMarkSummary(valuationLots, 'ask');
    const totals = getPortfolioTotals(valuationLots, 'ask');
    const premium = 1.234567 * 200 + 1.987654 * 300;
    near(headline.totalCurrentValue, -0.456789 * 500);
    near(headline.totalGainLoss, premium - 0.456789 * 500);
    near(headline.weightedAverageDelta, -0.2);
    near(headline.portfolioOriginalAnnualizedYield, (calculateOriginalAnnualizedYield(lots[0]) * 2 + calculateOriginalAnnualizedYield(lots[1]) * 3) / 5);
    near(headline.totalCurrentValue, positions[0].positionMetrics.currentValue);
    near(totals.totalGainLoss, headline.totalGainLoss);
    for (const groups of [buildExpirationScheduleGroups(positions, 'ask'), buildUnderlyingScheduleGroups(positions, 'ask')]) near(groups.reduce((sum, group) => sum + group.totalGainLoss, 0), headline.totalGainLoss);
    assert.equal(calculatePortfolioCurrentAyCoverage(valuationLots, 'ask').eligibleCount, 2);
    assert.deepEqual(lots, before, 'no durable mutation');
    assert.deepEqual(valuationLots.map(({ latestMarketData, ...entry }) => entry), lots.map(({ latestMarketData, ...entry }) => entry));
  }
  const page = read('src/pages/PortfolioPage.tsx');
  for (const call of ['calculatePortfolioMarkSummary', 'calculatePortfolioCurrentAyCoverage', 'buildScheduleTotals']) assert.ok(page.includes(`${call}(valuationLots, markBasis)`), `${call} must share contract observations`);
});

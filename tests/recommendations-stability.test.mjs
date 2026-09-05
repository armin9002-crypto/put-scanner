import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildRecommendationBoardRows } from '../src/lib/recommendations/board.ts';
import { runRecommendationEngine } from '../src/lib/recommendations/engine.ts';
import { discoverContractPricing, prepareRecommendationPricingChain } from '../src/lib/recommendations/pricing.ts';
import { RECOMMENDATION_POLICY } from '../src/lib/recommendations/policy.ts';
import { buildRecommendationScaleSnapshot } from './fixtures/recommendationsScale.mjs';

function diagnostics() {
  return { phaseMs: {}, dominancePairVisits: 0, relativeHurdlePairVisits: 0, outrankingPairs: 0, rankFactorComputations: 0 };
}

function financialProjection(run) {
  const { candidates, ...runCore } = run;
  return {
    run: runCore,
    candidates: candidates.map(candidate => {
      const { comparisons: _retainedDetails, comparisonSummary, ...core } = candidate;
      return {
        core,
        relationshipCounts: comparisonSummary.relationshipCounts,
        outranksCandidateIds: comparisonSummary.outranksCandidateIds,
        outrankedByCandidateIds: comparisonSummary.outrankedByCandidateIds,
        reasonCodes: [...comparisonSummary.reasonCodes].sort(),
        outrankedByReasonCodes: [...comparisonSummary.outrankedByReasonCodes].sort(),
      };
    }),
  };
}

test('production-scale Recommendation path is deterministic and structurally bounded', () => {
  const snapshot = buildRecommendationScaleSnapshot();
  const firstDiagnostics = diagnostics();
  const first = runRecommendationEngine(snapshot, RECOMMENDATION_POLICY, firstDiagnostics);
  const secondDiagnostics = diagnostics();
  const second = runRecommendationEngine(snapshot, RECOMMENDATION_POLICY, secondDiagnostics);

  assert.equal(snapshot.coverage.requestedForOptionScan.length, 37);
  assert.equal(snapshot.chains.length, 111);
  assert.equal(snapshot.screenerRows.length, 3_996);
  const firstProjection = financialProjection(first);
  assert.deepEqual(firstProjection, financialProjection(second));
  // Captured from the unmodified 0b817fc engine after normalizing only the bounded comparison-detail representation.
  assert.equal(createHash('sha256').update(JSON.stringify(firstProjection)).digest('hex'),
    'd044d823086af57d7ca5cb3f8549296b3dfe4b910e34c3e9e59fa027ed33f113',
    'the production-scale financial golden changed');
  assert.equal(firstDiagnostics.rankFactorComputations, first.candidates.length);
  assert.equal(firstDiagnostics.dominancePairVisits, firstDiagnostics.relativeHurdlePairVisits);
  assert.ok(firstDiagnostics.dominancePairVisits < first.candidates.length ** 2 / 50, 'dominance must stay inside ticker/DTE windows');
  assert.equal(firstDiagnostics.outrankingPairs, 98_346, 'cross-underlying finalist comparisons remain global and deterministic');
  assert.ok(first.candidates.every(candidate => candidate.comparisons.length <= 8));
  assert.ok(first.candidates.every(candidate => candidate.comparisonSummary.totalCount
    === Object.values(candidate.comparisonSummary.relationshipCounts).reduce((sum, count) => sum + count, 0)));
  assert.deepEqual(buildRecommendationBoardRows(first, 'actionability').map(row => row.candidate?.id ?? null),
    buildRecommendationBoardRows(second, 'actionability').map(row => row.candidate?.id ?? null));
});

test('prepared chain pricing preserves exact candidate pricing inputs and results', () => {
  const snapshot = buildRecommendationScaleSnapshot(1, 12);
  const chain = snapshot.chains[0].data;
  const row = snapshot.screenerRows.find(candidate => candidate.expDate === snapshot.chains[0].expiration);
  assert.ok(row);
  const direct = discoverContractPricing({ strike: row.strike, dte: row.dte, chain, asOf: snapshot.asOf });
  const prepared = discoverContractPricing({ strike: row.strike, dte: row.dte, chain, asOf: snapshot.asOf,
    prepared: prepareRecommendationPricingChain({ chain, dte: row.dte, asOf: snapshot.asOf }) });
  assert.deepEqual(prepared, direct);
});

test('dominance equivalence keeps ticker and DTE comparison boundaries exact', () => {
  const snapshot = buildRecommendationScaleSnapshot(2, 8);
  const run = runRecommendationEngine(snapshot);
  for (const candidate of run.candidates) {
    const relatedIds = [...candidate.dominatedBy, ...candidate.dominates];
    for (const otherId of relatedIds) {
      const other = run.candidates.find(item => item.id === otherId);
      assert.ok(other);
      assert.equal(other.ticker, candidate.ticker, 'different tickers must never enter dominance');
      assert.ok(Math.abs(other.dte - candidate.dte) <= RECOMMENDATION_POLICY.comparison.similarDteDays,
        'dissimilar DTEs must never enter material dominance');
    }
  }
});

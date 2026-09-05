import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRecommendationBoardRows, recommendationRepresentativeCandidate } from '../src/lib/recommendations/board.ts';
import { buildRankedRecommendationShortlist, compareRecommendationCandidates } from '../src/lib/recommendations/ranking.ts';
import { buildRecommendationVisualFixture } from '../src/lib/recommendations/visualFixtures.ts';

const fixtureRun = buildRecommendationVisualFixture('actionable');
const fixtureCandidate = fixtureRun.candidates.find(candidate => candidate.strike === 65) ?? fixtureRun.candidates[0];
assert.ok(fixtureCandidate, 'visual fixture must supply a reusable candidate shape');

function candidate(ticker, index, overrides = {}) {
  const item = structuredClone(fixtureCandidate);
  const strike = 50 + index;
  item.id = `${ticker}|1797552000|${strike.toFixed(4)}`;
  item.ticker = ticker;
  item.strike = strike;
  item.canonicalRow.ticker = ticker;
  item.canonicalRow.strike = strike;
  item.underlying.ticker = ticker;
  item.verdict = 'ACTIONABLE';
  item.pricing.discoveryTier = 'DIRECT_RECENT';
  item.pricing.provenance = 'DIRECT_MARKET';
  item.pricing.directBid = 2;
  item.pricing.confidence = 'HIGH';
  item.pricing.actionability = 'HIGH';
  item.robustness.classification = 'HIGH';
  item.underlying.qualification = 'ELIGIBLE';
  item.underlying.technicalAssessment.state = 'STRONG_TREND';
  item.skeptic = { code: 'DOWNSIDE_TAIL_RISK', message: 'Fixture trade-off.', veto: false };
  item.dominatedBy = [];
  item.dominates = [];
  item.comparisons = [];
  item.comparisonSummary = {
    totalCount: 0,
    retainedDetailCount: 0,
    relationshipCounts: { OUTRANKS: 0, OUTRANKED_BY: 0, EFFECTIVE_TIE: 0, TRADEOFF: 0 },
    retainedRelationshipCounts: { OUTRANKS: 0, OUTRANKED_BY: 0, EFFECTIVE_TIE: 0, TRADEOFF: 0 },
    outranksCandidateIds: [],
    outrankedByCandidateIds: [],
    reasonCodes: [],
    outrankedByReasonCodes: [],
  };
  item.economics.annualizedYieldBidPct = 20;
  item.economics.breakevenCushionAtBasis = 0.4;
  item.economics.delta = -0.1;
  item.minimumAttractiveCredit.requiredAnnualizedYieldPct = 15;
  item.rank = null;
  for (const [key, value] of Object.entries(overrides)) {
    if (key === 'pricing') Object.assign(item.pricing, value);
    else if (key === 'economics') Object.assign(item.economics, value);
    else if (key === 'robustness') Object.assign(item.robustness, value);
    else if (key === 'underlying') Object.assign(item.underlying, value);
    else Object.assign(item, { [key]: value });
  }
  return item;
}

test('ranked shortlist surfaces 8–15 genuine candidates, enforces a hard 15 cap, and has no minimum', () => {
  const twelve = Array.from({ length: 12 }, (_, index) => candidate(`T${index.toString().padStart(2, '0')}`, index));
  const twenty = Array.from({ length: 20 }, (_, index) => candidate(`U${index.toString().padStart(2, '0')}`, index));
  const two = [candidate('AAA', 1), candidate('BBB', 2)];

  const twelveResult = buildRankedRecommendationShortlist(twelve);
  const cappedResult = buildRankedRecommendationShortlist(twenty);
  assert.equal(twelveResult.selections.length, 12);
  assert.equal(twelveResult.policySurvivorCount, 12);
  assert.equal(cappedResult.selections.length, 15);
  assert.equal(cappedResult.capExcluded, 5);
  assert.equal(buildRankedRecommendationShortlist(two).selections.length, 2);
  assert.equal(buildRankedRecommendationShortlist([]).selections.length, 0);
});

test('shortlist order is deterministic, Actionable precedes Conditional, and discovery outranks nominal AY', () => {
  const direct = candidate('DIRECT', 1, { economics: { annualizedYieldBidPct: 17 } });
  const poorDiscovery = candidate('POOR', 2, {
    pricing: { discoveryTier: 'INSUFFICIENT_PRICE_DISCOVERY', confidence: 'LOW', actionability: 'LOW' },
    economics: { annualizedYieldBidPct: 80 },
  });
  const conditional = candidate('CONDITIONAL', 3, { verdict: 'CONDITIONAL', economics: { annualizedYieldBidPct: 40 } });
  const input = [poorDiscovery, conditional, direct];
  const first = buildRankedRecommendationShortlist(input).selections.map(item => item.candidateId);
  const second = buildRankedRecommendationShortlist([...input].reverse()).selections.map(item => item.candidateId);
  assert.deepEqual(first, second);
  assert.equal(first[0], direct.id);
  assert.ok(first.indexOf(direct.id) < first.indexOf(conditional.id));
  assert.ok(compareRecommendationCandidates(direct, poorDiscovery) < 0);
});

test('hard vetoes remain excluded, exact duplicates collapse, and badges never determine eligibility', () => {
  const valid = Array.from({ length: 8 }, (_, index) => candidate(`V${index}`, index));
  const vetoed = candidate('VETO', 20, { skeptic: { code: 'INVALID_CONTRACT', message: 'Invalid.', veto: true } });
  const duplicate = structuredClone(valid[0]);
  const result = buildRankedRecommendationShortlist([...valid, duplicate, vetoed]);
  assert.equal(result.policySurvivorCount, 8);
  assert.equal(result.selections.length, 8);
  assert.equal(new Set(result.selections.map(item => item.candidateId)).size, 8);
  assert.equal(result.selections.some(item => item.candidateId === vetoed.id), false);
  assert.ok(result.selections.filter(item => item.distinctions.length === 0).length >= 5);
});

test('diversity delays a third same-ticker contract only inside an equal major rank tier', () => {
  const a1 = candidate('AAA', 1);
  const a2 = candidate('AAA', 2);
  const a3 = candidate('AAA', 3);
  const b1 = candidate('BBB', 4);
  const equalTier = buildRankedRecommendationShortlist([a3, b1, a2, a1]).selections.map(item => item.candidateId);
  assert.deepEqual(equalTier, [a1.id, a2.id, b1.id, a3.id]);

  const staleB = candidate('BBB', 4, { pricing: { discoveryTier: 'QUOTED_TRANSACTION_STALE', confidence: 'MODERATE', actionability: 'MODERATE' } });
  const materialTier = buildRankedRecommendationShortlist([a3, staleB, a2, a1]).selections.map(item => item.candidateId);
  assert.deepEqual(materialTier, [a1.id, a2.id, a3.id, staleB.id]);
});

test('Opportunity Board uses the true best candidate per underlying and supports actionability, ticker, and setup sorts', () => {
  const aWeak = candidate('AAA', 9, { pricing: { discoveryTier: 'QUOTED_TRANSACTION_STALE', confidence: 'MODERATE', actionability: 'MODERATE' } });
  const aBest = candidate('AAA', 1);
  const b = candidate('BBB', 2, { pricing: { discoveryTier: 'RECENT_NEARBY_CONFIRMED' } });
  const aUnderlying = { ...structuredClone(aBest.underlying), ticker: 'AAA', setup: 'GOOD' };
  const bUnderlying = { ...structuredClone(b.underlying), ticker: 'BBB', setup: 'STRONG' };
  const run = {
    ...fixtureRun,
    candidates: [aWeak, b, aBest],
    underlyingAssessments: [aUnderlying, bUnderlying],
    recommendations: [{ candidateId: aWeak.id, shortlistRank: 1, distinctions: [] }],
  };

  assert.equal(recommendationRepresentativeCandidate(run, 'AAA').id, aBest.id);
  assert.deepEqual(buildRecommendationBoardRows(run, 'actionability').map(row => row.underlying.ticker), ['AAA', 'BBB']);
  assert.deepEqual(buildRecommendationBoardRows(run, 'ticker').map(row => row.underlying.ticker), ['AAA', 'BBB']);
  assert.deepEqual(buildRecommendationBoardRows(run, 'setup').map(row => row.underlying.ticker), ['BBB', 'AAA']);
});

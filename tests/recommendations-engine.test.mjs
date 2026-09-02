import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { canonicalOptionChainKey } from '../src/lib/optionChainRequests.ts';
import { calculateAnnualizedYield, calculateCreditForAnnualizedYield } from '../src/lib/optionMetrics.ts';
import { postureFromRegime } from '../src/lib/marketRead/posture.ts';
import { buildScreenerRows } from '../src/lib/screenerRows.ts';
import { runRecommendationEngine } from '../src/lib/recommendations/engine.ts';
import { discoverContractPricing } from '../src/lib/recommendations/pricing.ts';
import { assessUnderlying } from '../src/lib/recommendations/underlying.ts';
import { clearInMemoryRecommendationRunForTests, getInMemoryRecommendationRun, publishInMemoryRecommendationRun, refreshRecommendations } from '../src/lib/recommendations/acquisition.ts';
import { RECOMMENDATION_ENGINE_VERSION, RECOMMENDATION_POLICY_VERSION } from '../src/lib/recommendations/types.ts';

const AS_OF = '2026-09-02T15:00:00.000Z';
const AS_OF_MS = Date.parse(AS_OF);
const EXPIRATION = Math.floor(Date.parse('2026-10-16T00:00:00.000Z') / 1_000);
const DTE = 44;

function put(strike, overrides = {}) {
  return {
    strike,
    last: 1,
    lastTradeDate: Math.floor((AS_OF_MS - 86_400_000) / 1_000),
    bid: 1,
    ask: 1.1,
    delta: -0.08,
    impliedVolatility: 70,
    volume: 12,
    openInterest: 80,
    contractSymbol: `FIXTUREP${strike}`,
    ...overrides,
  };
}

function surface(candidate = put(65, { bid: 1.3, ask: 1.45, delta: -0.12 }), overrides = {}) {
  return [
    put(60, { bid: 0.8, ask: 0.9, delta: -0.07, impliedVolatility: 72 }),
    candidate,
    put(70, { bid: 2.1, ask: 2.3, delta: -0.17, impliedVolatility: 68 }),
  ].map(contract => ({ ...contract, ...overrides[contract.strike] }));
}

function chain(ticker, puts, overrides = {}) {
  return {
    expirations: [{ date: EXPIRATION, label: "Oct 16 '26", dte: DTE }],
    puts,
    currentPrice: 100,
    chainMeta: {
      ticker,
      requestedExpiration: EXPIRATION,
      returnedExpiration: EXPIRATION,
      expirationDate: EXPIRATION,
      fetchedAt: AS_OF_MS,
      source: 'network',
      putCount: puts.length,
      ...overrides,
    },
  };
}

function pulse(ticker, overrides = {}) {
  return {
    ticker,
    name: `${ticker} Fund`,
    type: 'Broad Index',
    leverage: '3x',
    underlying: 'Fixture Index',
    price: 100,
    returns: { oneDay: 0.01, fiveDay: -0.02, thirtyDay: 0.05, threeMonth: 0.12, sixMonth: 0.2, yearToDate: 0.3, oneYear: 0.4 },
    rsi14: 48,
    realizedVolatility20: 0.55,
    sma20: 103,
    sma50: 95,
    sma200: 75,
    distance20: -0.03,
    distance50: 0.05,
    distance200: 0.33,
    high52Week: 120,
    low52Week: 45,
    percentOf52WeekHigh: 0.83,
    position52Week: 0.73,
    drawdown52Week: -0.17,
    recentDrawdown30: -0.05,
    trend: 'Strong Uptrend',
    isOversold: false,
    isOverbought: false,
    ...overrides,
  };
}

function regime(label = 'Healthy Risk-On') {
  return {
    label,
    confidence: 'High',
    explanation: 'Fixture regime',
    marketRead: 'Fixture market read',
    putSellingImplication: 'Fixture posture',
    favor: [],
    avoid: [],
    drivers: [],
    warnings: [],
    stats: {
      spyTrend: 'Uptrend', qqqTrend: 'Uptrend', breadthAbove50: 0.8, breadthAbove200: 0.8,
      downtrendCount: 0, oversoldCount: 0, overboughtCount: 0, medianThirtyDayReturn: 0.05,
      medianRealizedVolatility20: 0.5, spyRsi: 50, qqqRsi: 50, spyPosition52Week: 0.8,
      qqqPosition52Week: 0.8, vixTrend: null, vxnTrend: null,
      biggestThirtyDayWinners: [], biggestThirtyDayLosers: [],
    },
    fetchedAt: AS_OF_MS,
  };
}

function snapshot({ pulseRows = [pulse('TQQQ')], chains = [chain('TQQQ', surface())], regimeLabel = 'Healthy Risk-On', failedBatches = [], failedUnderlyings = [], hardFailed = [] } = {}) {
  const initialResults = new Map();
  const chainsByKey = new Map();
  const ivVsRealizedRangeByTicker = new Map();
  for (const item of chains) {
    const ticker = item.chainMeta.ticker;
    if (!initialResults.has(ticker)) initialResults.set(ticker, item);
    chainsByKey.set(canonicalOptionChainKey(ticker, EXPIRATION), item);
    ivVsRealizedRangeByTicker.set(ticker, 75);
  }
  const built = buildScreenerRows({ initialResults, chainsByKey, ivVsRealizedRangeByTicker }, 'all');
  const marketRegime = regime(regimeLabel);
  const tickers = pulseRows.map(row => row.ticker).sort();
  return {
    asOf: AS_OF,
    engineVersion: RECOMMENDATION_ENGINE_VERSION,
    policyVersion: RECOMMENDATION_POLICY_VERSION,
    market: { regime: marketRegime, posture: postureFromRegime(marketRegime) },
    underlyings: pulseRows,
    chains: chains.map(data => ({ ticker: data.chainMeta.ticker, expiration: EXPIRATION, data })),
    screenerRows: built.rows,
    coverage: {
      trackedUnderlyings: tickers,
      hardFailedBeforeChainAcquisition: hardFailed,
      requestedForOptionScan: chains.map(data => data.chainMeta.ticker).sort(),
      successfullyAnalyzedUnderlyings: [...new Set(chains.map(data => data.chainMeta.ticker))].sort(),
      failedUnderlyings,
      failedBatches,
      expirationsCovered: chains.map(data => ({ ticker: data.chainMeta.ticker, expirationDates: [EXPIRATION] })),
      contractsEvaluated: built.rows.length,
      pulse: { requested: tickers.length, loaded: tickers.length, failed: 0, stale: false },
      provenance: {
        pulseFetchedAt: AS_OF_MS,
        chainSources: chains.map(data => ({ ticker: data.chainMeta.ticker, expiration: EXPIRATION, source: data.chainMeta.source, fetchedAt: data.chainMeta.fetchedAt })),
      },
    },
  };
}

function candidateAt(run, ticker, strike) {
  const candidate = run.candidates.find(item => item.ticker === ticker && item.strike === strike);
  assert.ok(candidate, `expected ${ticker} ${strike} candidate`);
  return candidate;
}

test('canonical inverse annualized-yield helper round-trips without changing yield semantics', () => {
  const credit = calculateCreditForAnnualizedYield(0.18, 65, DTE);
  assert.ok(credit != null);
  assert.ok(Math.abs(calculateAnnualizedYield(credit, 65, DTE) - 0.18) < 1e-12);
});

test('A: huge AY cannot rescue a deteriorating underlying', () => {
  const damaged = pulse('TQQQ', { trend: 'Downtrend', distance50: -0.2, distance200: -0.14, recentDrawdown30: -0.26, rsi14: 27 });
  const rich = chain('TQQQ', surface(put(65, { bid: 8, ask: 8.3, delta: -0.12 })));
  const run = runRecommendationEngine(snapshot({ pulseRows: [damaged], chains: [rich] }));
  const candidate = candidateAt(run, 'TQQQ', 65);
  assert.equal(candidate.underlying.qualification, 'HARD_FAIL');
  assert.equal(candidate.verdict, 'PASS');
  assert.ok(['YIELD_TRAP', 'BROKEN_TREND'].includes(candidate.skeptic.code));
  assert.equal(run.runVerdict, 'NO_TRADE');
});

test('B and H: strong setup with terrible compensation remains Watch/Pass and complete mediocre sets return NO_TRADE', () => {
  const weakPremium = chain('TQQQ', [
    put(60, { bid: 0.08, ask: 0.12, delta: -0.04 }),
    put(65, { bid: 0.25, ask: 0.35, delta: -0.08 }),
    put(70, { bid: 0.38, ask: 0.48, delta: -0.13 }),
  ]);
  const run = runRecommendationEngine(snapshot({ chains: [weakPremium] }));
  assert.ok(['WATCH', 'PASS'].includes(candidateAt(run, 'TQQQ', 65).verdict));
  assert.equal(run.operationalStatus, 'COMPLETE');
  assert.equal(run.runVerdict, 'NO_TRADE');
  assert.deepEqual(run.recommendations, []);
});

test('C: no bid with a coherent same-expiration bracket can be Conditional but never Actionable or High confidence', () => {
  const noBid = chain('TQQQ', surface(put(65, { bid: 0, ask: 1.55, last: 1.42, delta: -0.12 })));
  const run = runRecommendationEngine(snapshot({ chains: [noBid] }));
  const candidate = candidateAt(run, 'TQQQ', 65);
  assert.equal(candidate.pricing.provenance, 'INDICATIVE_RANGE');
  assert.equal(candidate.pricing.confidence, 'MODERATE');
  assert.equal(candidate.pricing.actionability, 'LOW');
  assert.equal(candidate.verdict, 'CONDITIONAL');
  assert.notEqual(candidate.verdict, 'ACTIONABLE');
  assert.ok(candidate.pricing.indicativeRange.high >= candidate.pricing.indicativeRange.low);
  assert.ok(run.recommendations.some(selection => selection.class === 'CONDITIONAL_PRICE_OPPORTUNITY' && selection.candidateId === candidate.id));
  assert.equal(run.recommendations.some(selection => selection.class === 'BEST_OVERALL'), false);
});

test('D, P, Q: incoherent, monotonicity-broken, or unbracketed no-bid surfaces do not fabricate pricing', () => {
  const incoherent = chain('TQQQ', [
    put(60, { bid: 2.2, ask: 2.4, delta: -0.07 }),
    put(65, { bid: 0, ask: 8, last: 7, delta: -0.12 }),
    put(70, { bid: 1, ask: 1.2, delta: -0.17 }),
  ]);
  const broken = discoverContractPricing({ strike: 65, dte: DTE, chain: incoherent, asOf: AS_OF });
  assert.equal(broken.provenance, 'INSUFFICIENT_PRICING_EVIDENCE');
  assert.equal(broken.confidence, 'LOW');
  assert.equal(broken.indicativeRange, null);
  assert.equal(broken.surface.monotonic, false);

  const unbracketed = chain('TQQQ', [put(60, { bid: 0.8, ask: 0.9 }), put(65, { bid: 0, ask: 9, last: 8 })]);
  const sparse = discoverContractPricing({ strike: 65, dte: DTE, chain: unbracketed, asOf: AS_OF });
  assert.equal(sparse.provenance, 'INSUFFICIENT_PRICING_EVIDENCE');
  assert.equal(sparse.indicativeRange, null);
});

test('E and F: material dominance favors cushion when the yield pickup is too small', () => {
  const puts = [
    put(55, { bid: 0.45, ask: 0.5, delta: -0.035 }),
    put(60, { bid: 1.05, ask: 1.15, delta: -0.07 }),
    put(65, { bid: 1.18, ask: 1.3, delta: -0.12 }),
    put(70, { bid: 2.1, ask: 2.3, delta: -0.17 }),
  ];
  const run = runRecommendationEngine(snapshot({ chains: [chain('TQQQ', puts)] }));
  const safer = candidateAt(run, 'TQQQ', 60);
  const riskier = candidateAt(run, 'TQQQ', 65);
  assert.ok(riskier.dominatedBy.includes(safer.id));
  assert.ok(safer.dominates.includes(riskier.id));
  assert.notEqual(riskier.verdict, 'ACTIONABLE');
});

test('G and R: Risk-Off materially raises hurdles and insufficient cushion still fails despite high AY', () => {
  const candidateSurface = surface(put(65, { bid: 1.35, ask: 1.5, delta: -0.12 }));
  const healthyRun = runRecommendationEngine(snapshot({ chains: [chain('TQQQ', candidateSurface)] }));
  const riskOffRun = runRecommendationEngine(snapshot({ chains: [chain('TQQQ', candidateSurface)], regimeLabel: 'Risk-Off' }));
  assert.ok(candidateAt(riskOffRun, 'TQQQ', 65).minimumAttractiveCredit.credit > candidateAt(healthyRun, 'TQQQ', 65).minimumAttractiveCredit.credit);
  assert.notEqual(candidateAt(riskOffRun, 'TQQQ', 65).verdict, 'ACTIONABLE');

  const highAyLowCushion = chain('TQQQ', [put(75, { bid: 3, ask: 3.2, delta: -0.12 }), put(80, { bid: 8, ask: 8.4, delta: -0.14 }), put(85, { bid: 12, ask: 12.5, delta: -0.18 })]);
  const lowCushionRun = runRecommendationEngine(snapshot({ chains: [highAyLowCushion], regimeLabel: 'Risk-Off' }));
  assert.notEqual(candidateAt(lowCushionRun, 'TQQQ', 80).verdict, 'ACTIONABLE');
  assert.equal(candidateAt(lowCushionRun, 'TQQQ', 80).skeptic.code, 'INSUFFICIENT_CUSHION');
});

test('I and S: near-identical finalists are treated as an effective tie without false precision', () => {
  const rows = [pulse('AAA'), pulse('BBB')];
  const chains = [chain('AAA', surface()), chain('BBB', surface(put(65, { bid: 1.305, ask: 1.455, delta: -0.121 })))];
  const run = runRecommendationEngine(snapshot({ pulseRows: rows, chains }));
  const a = candidateAt(run, 'AAA', 65);
  const b = candidateAt(run, 'BBB', 65);
  assert.ok(a.comparisons.some(comparison => comparison.otherCandidateId === b.id && comparison.relationship === 'EFFECTIVE_TIE'));
  assert.ok(run.reasonCodes.includes('NO_CLEAR_LEADER'));
  assert.equal(run.recommendations.some(selection => selection.class === 'BEST_OVERALL'), false);
  assert.notEqual(a.robustness.classification, 'HIGH');
  assert.notEqual(b.robustness.classification, 'HIGH');
});

test('J: stale Last with no real market remains non-executable and insufficient', () => {
  const stale = chain('TQQQ', [put(65, { bid: 0, ask: 3, last: 2.8, lastTradeDate: Math.floor((AS_OF_MS - 20 * 86_400_000) / 1_000) })]);
  const pricing = discoverContractPricing({ strike: 65, dte: DTE, chain: stale, asOf: AS_OF });
  assert.equal(pricing.directBid, null);
  assert.equal(pricing.indicativeRange, null);
  assert.equal(pricing.provenance, 'INSUFFICIENT_PRICING_EVIDENCE');
  assert.ok(pricing.surface.reasonCodes.includes('STALE_EVIDENCE'));
});

test('K: low OI and zero volume do not veto a coherent direct market', () => {
  const thin = chain('TQQQ', surface(put(65, { bid: 1.4, ask: 1.5, delta: -0.12, openInterest: 2, volume: 0 })));
  const candidate = candidateAt(runRecommendationEngine(snapshot({ chains: [thin] })), 'TQQQ', 65);
  assert.equal(candidate.pricing.provenance, 'DIRECT_MARKET');
  assert.equal(candidate.pricing.actionability, 'HIGH');
  assert.equal(candidate.verdict, 'ACTIONABLE');
});

test('L: identical immutable snapshots produce byte-equivalent deterministic outputs', () => {
  const fixture = snapshot();
  const first = runRecommendationEngine(fixture);
  const second = runRecommendationEngine(fixture);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

test('M: partial acquisition failure is operationally INCOMPLETE and never unconditional NO_TRADE', () => {
  const weakPremium = chain('TQQQ', [
    put(60, { bid: 0.06, ask: 0.1, delta: -0.04 }),
    put(65, { bid: 0.2, ask: 0.3, delta: -0.08 }),
    put(70, { bid: 0.35, ask: 0.45, delta: -0.13 }),
  ]);
  const fixture = snapshot({ chains: [weakPremium], failedBatches: [4], failedUnderlyings: [{ ticker: 'LABU', message: 'fixture batch failed' }] });
  fixture.coverage.pulse.failed = 1;
  const run = runRecommendationEngine(fixture);
  assert.equal(run.operationalStatus, 'INCOMPLETE');
  assert.equal(run.runVerdict, null);
});

test('N: inferable price below Minimum Attractive Credit does not become Conditional', () => {
  const low = chain('TQQQ', [
    put(60, { bid: 0.1, ask: 0.14, delta: -0.07 }),
    put(65, { bid: 0, ask: 0.28, delta: -0.12 }),
    put(70, { bid: 0.35, ask: 0.42, delta: -0.17 }),
  ]);
  const candidate = candidateAt(runRecommendationEngine(snapshot({ chains: [low] })), 'TQQQ', 65);
  assert.equal(candidate.pricing.provenance, 'INDICATIVE_RANGE');
  assert.ok(candidate.pricing.indicativeRange.high < candidate.minimumAttractiveCredit.credit);
  assert.notEqual(candidate.verdict, 'CONDITIONAL');
});

test('O: a bid below Attractive At with a credible ask above it can be Conditional, never Actionable', () => {
  const market = chain('TQQQ', surface(put(65, { bid: 1.0, ask: 1.35, delta: -0.1 })));
  const candidate = candidateAt(runRecommendationEngine(snapshot({ chains: [market] })), 'TQQQ', 65);
  assert.ok(candidate.pricing.directBid < candidate.minimumAttractiveCredit.credit);
  assert.ok(candidate.pricing.directAsk >= candidate.minimumAttractiveCredit.credit);
  assert.equal(candidate.verdict, 'CONDITIONAL');
});

test('T: missing technical context lowers evidence quality without silently substituting zero', () => {
  const sparse = pulse('TQQQ', { rsi14: null, realizedVolatility20: null, distance20: null, distance50: null, distance200: null, position52Week: null, drawdown52Week: null, recentDrawdown30: null, trend: 'Neutral' });
  const assessment = assessUnderlying(sparse, regime());
  assert.equal(assessment.evidenceQuality, 'LOW');
  assert.equal(assessment.qualification, 'WATCH');
  assert.ok(assessment.evidence.some(item => item.value === '—'));
  const candidate = candidateAt(runRecommendationEngine(snapshot({ pulseRows: [sparse] })), 'TQQQ', 65);
  assert.equal(candidate.evidenceQuality, 'LOW');
  assert.notEqual(candidate.verdict, 'ACTIONABLE');
});

test('U: threshold instability is exposed as Low robustness instead of a confidence percentage', () => {
  const marginal = chain('TQQQ', surface(put(65, { bid: 0.95, ask: 1.2, delta: -0.19 })));
  const candidate = candidateAt(runRecommendationEngine(snapshot({ chains: [marginal] })), 'TQQQ', 65);
  assert.equal(candidate.robustness.classification, 'LOW');
  assert.ok(candidate.robustness.stableScenarios < candidate.robustness.totalScenarios);
  assert.equal('confidencePercent' in candidate.robustness, false);
});

test('price discovery handles direct, one-sided, malformed, wide, duplicate, irregular, and boundary fixtures without NaN/Infinity', () => {
  const direct = discoverContractPricing({ strike: 65, dte: DTE, chain: chain('TQQQ', surface()), asOf: AS_OF });
  assert.equal(direct.provenance, 'DIRECT_MARKET');
  assert.equal(direct.confidence, 'HIGH');

  for (const puts of [
    [put(65, { bid: 0, ask: 1.5 })],
    [put(65, { bid: 2, ask: 1 })],
    [put(60, { bid: 0.5, ask: 3 }), put(65, { bid: 0, ask: 2 }), put(70, { bid: 2, ask: 7 })],
    [put(50, { bid: 0.2, ask: 0.3 }), put(65, { bid: 0, ask: 1.5 }), put(66, { bid: 1.5, ask: 1.7 })],
    [put(60, { bid: 0.8, ask: 0.9 }), put(65, { bid: 0, ask: 1.5, contractSymbol: 'B' }), put(65, { bid: 0, ask: 1.4, contractSymbol: 'A' }), put(70, { bid: 2, ask: 2.2 })],
    [put(60, { bid: 0.8, ask: 0.9 }), put(65, { bid: 0, ask: 1.5, delta: null, impliedVolatility: null }), put(70, { bid: 2, ask: 2.2 })],
  ]) {
    const result = discoverContractPricing({ strike: 65, dte: DTE, chain: chain('TQQQ', puts), asOf: AS_OF });
    assert.equal(JSON.stringify(result).includes('NaN'), false);
    assert.equal(JSON.stringify(result).includes('Infinity'), false);
  }

  const lowerBoundary = discoverContractPricing({ strike: 60, dte: DTE, chain: chain('TQQQ', surface()), asOf: AS_OF });
  const upperBoundary = discoverContractPricing({ strike: 70, dte: DTE, chain: chain('TQQQ', surface()), asOf: AS_OF });
  assert.equal(lowerBoundary.surface.bracketed, false);
  assert.equal(upperBoundary.surface.bracketed, false);
});

test('invalid candidate economics fail closed without serializing NaN or Infinity', () => {
  const fixture = snapshot();
  fixture.screenerRows = fixture.screenerRows.map(row => ({ ...row, dte: 0 }));
  const run = runRecommendationEngine(fixture);
  const candidate = candidateAt(run, 'TQQQ', 65);
  assert.equal(candidate.minimumAttractiveCredit.absoluteCredit, null);
  assert.equal(candidate.minimumAttractiveCredit.credit, null);
  assert.equal(candidate.verdict, 'PASS');
  assert.equal(candidate.skeptic.code, 'INVALID_CONTRACT');
  assert.equal(JSON.stringify(run).includes('NaN'), false);
  assert.equal(JSON.stringify(run).includes('Infinity'), false);
});

test('financial reconciliation preserves canonical Screener values for direct Bid economics', () => {
  const fixture = snapshot();
  const run = runRecommendationEngine(fixture);
  const candidate = candidateAt(run, 'TQQQ', 65);
  const row = fixture.screenerRows.find(item => item.ticker === 'TQQQ' && item.strike === 65);
  assert.ok(row);
  assert.equal(candidate.economics.nominalYieldBidPct, row.nomYieldBid);
  assert.equal(candidate.economics.annualizedYieldBidPct, row.annYieldBid);
  assert.equal(candidate.economics.delta, row.delta);
  assert.equal(candidate.economics.moneynessPct, row.moneynessPct);
  assert.equal(candidate.economics.ivPct, row.iv);
  assert.equal(candidate.dte, row.dte);
});

test('Recommendations acquisition is one explicit cache-aware Pulse pass plus one bounded Screener pass and skips hard-fails', async () => {
  const damaged = pulse('TQQQ', { trend: 'Downtrend', distance50: -0.2, distance200: -0.14, recentDrawdown30: -0.26, rsi14: 27 });
  let pulseCalls = 0;
  let scanCalls = 0;
  const result = await refreshRecommendations({
    scanId: 'recommendations-fixture',
    dependencies: {
      now: () => AS_OF_MS,
      loadPulse: async () => {
        pulseCalls += 1;
        return { rows: [damaged], fetchedAt: AS_OF_MS, total: 1, loaded: 1, failed: 0, errors: [], stale: false };
      },
      scan: async options => {
        scanCalls += 1;
        assert.equal(options.expFilter, 'all');
        assert.equal(options.selectedTickers.includes('TQQQ'), false);
        return {
          initialResults: new Map(), chainsByKey: new Map(), ivVsRealizedRangeByTicker: new Map(), errors: [],
          plannedBatches: 14, completedBatches: 14, failedBatchIds: [],
        };
      },
    },
  });
  assert.equal(pulseCalls, 1);
  assert.equal(scanCalls, 1);
  assert.ok(result.snapshot.coverage.hardFailedBeforeChainAcquisition.includes('TQQQ'));
  assert.equal(getInMemoryRecommendationRun(), null, 'a result is not published until the current generation accepts it');
  publishInMemoryRecommendationRun(result.run);
  assert.equal(getInMemoryRecommendationRun(), result.run);
  clearInMemoryRecommendationRunForTests();
});

test('Recommendations domain has no inference client, direct fetch, Portfolio lens, or universal score', () => {
  const source = readdirSync('src/lib/recommendations', { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.ts'))
    .map(entry => readFileSync(`src/lib/recommendations/${entry.name}`, 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /from\s+['"](?:openai|@anthropic|.*ai-sdk)/i);
  assert.doesNotMatch(source, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /portfolio\s*fit/i);
  assert.doesNotMatch(source, /\b(?:overall|opportunity|risk|fit)Score\b/i);
});

import { withEtfPulseTechnicalAssessment, type EtfPulseRow } from '../etfPulseMetrics.ts';
import { postureFromRegime } from '../marketRead/posture.ts';
import type { RegimeAnalysis } from '../marketRead/types.ts';
import { canonicalOptionChainKey } from '../optionChainRequests.ts';
import { buildScreenerRows } from '../screenerRows.ts';
import type { OptionContract, OptionsChainData } from '../types.ts';
import { runRecommendationEngine } from './engine.ts';
import { RECOMMENDATION_ENGINE_VERSION, RECOMMENDATION_POLICY_VERSION, recommendationUniverse, type RecommendationRun, type RecommendationSnapshot } from './types.ts';

export type RecommendationVisualFixture = 'actionable' | 'conditional' | 'no-trade' | 'incomplete';

const AS_OF = '2026-09-02T15:00:00.000Z';
const FETCHED_AT = Date.parse(AS_OF);
const EXPIRATION = Math.floor(Date.parse('2026-12-18T00:00:00.000Z') / 1_000);
const DTE = 107;

function option(strike: number, values: Partial<OptionContract>): OptionContract {
  return {
    strike,
    last: 1,
    lastTradeDate: Math.floor(FETCHED_AT / 1_000) - 3_600,
    bid: 1,
    ask: 1.1,
    delta: -0.08,
    impliedVolatility: 75,
    volume: 18,
    openInterest: 120,
    contractSymbol: `VISUALP${strike}`,
    ...values,
  };
}

function chain(ticker: string, candidate: OptionContract, values: Partial<OptionsChainData['chainMeta']> = {}): OptionsChainData {
  const puts = [
    option(candidate.strike - 5, { bid: candidate.bid === 0 ? 0.55 : Math.max(0.05, (candidate.bid ?? 1) * 0.55), ask: candidate.bid === 0 ? 0.65 : Math.max(0.1, (candidate.ask ?? 1.2) * 0.6), delta: -0.06 }),
    candidate,
    option(candidate.strike + 5, { bid: Math.max(0.2, (candidate.ask ?? 1.4) * 1.45), ask: Math.max(0.3, (candidate.ask ?? 1.4) * 1.6), delta: candidate.bid === 0 ? -0.24 : -0.17 }),
  ];
  return {
    expirations: [{ date: EXPIRATION, label: "Dec 18 '26", dte: DTE }],
    puts,
    currentPrice: 100,
    chainMeta: {
      ticker,
      requestedExpiration: EXPIRATION,
      returnedExpiration: EXPIRATION,
      expirationDate: EXPIRATION,
      fetchedAt: FETCHED_AT,
      source: 'cache',
      putCount: puts.length,
      ...values,
    },
  };
}

function underlying(ticker: string, values: Partial<EtfPulseRow> = {}): EtfPulseRow {
  return withEtfPulseTechnicalAssessment({
    ticker,
    name: `${ticker} leveraged ETF`,
    type: 'Sector',
    leverage: '3x',
    underlying: 'Visual fixture exposure',
    price: 100,
    returns: { oneDay: -0.01, fiveDay: -0.02, thirtyDay: 0.05, threeMonth: 0.12, sixMonth: 0.2, yearToDate: 0.3, oneYear: 0.4 },
    rsi14: 48,
    realizedVolatility20: 0.58,
    sma20: 102,
    sma50: 94,
    sma200: 72,
    distance20: -0.02,
    distance50: 0.06,
    distance200: 0.38,
    high52Week: 122,
    low52Week: 45,
    percentOf52WeekHigh: 0.82,
    position52Week: 0.71,
    drawdown52Week: -0.18,
    recentDrawdown30: -0.05,
    ...values,
  });
}

function market(): RegimeAnalysis {
  return {
    label: 'Healthy Pullback',
    confidence: 'High',
    explanation: 'Trend remains intact while short-term weakness improves entry levels.',
    marketRead: 'Trend remains intact while short-term weakness has reset some premium and entry levels.',
    putSellingImplication: 'Selective but constructive put environment.',
    favor: ['controlled pullbacks'], avoid: ['broken trends'], drivers: ['SPY Uptrend, QQQ Uptrend'], warnings: [],
    stats: {
      spyTrend: 'Uptrend', qqqTrend: 'Uptrend', breadthAbove50: 0.62, breadthAbove200: 0.74, downtrendCount: 2,
      oversoldCount: 1, overboughtCount: 2, medianThirtyDayReturn: 0.03, medianRealizedVolatility20: 0.55,
      spyRsi: 51, qqqRsi: 49, spyPosition52Week: 0.82, qqqPosition52Week: 0.78, vixTrend: null, vxnTrend: null,
      biggestThirtyDayWinners: [], biggestThirtyDayLosers: [],
    },
    fetchedAt: FETCHED_AT,
  };
}

function snapshot(rows: EtfPulseRow[], chains: OptionsChainData[], incomplete = false): RecommendationSnapshot {
  const initialResults = new Map(chains.map(item => [item.chainMeta?.ticker ?? '', item]));
  const chainsByKey = new Map(chains.map(item => [canonicalOptionChainKey(item.chainMeta?.ticker ?? '', EXPIRATION), item]));
  const ivVsRealizedRangeByTicker = new Map(chains.map(item => [item.chainMeta?.ticker ?? '', 76]));
  const built = buildScreenerRows({ initialResults, chainsByKey, ivVsRealizedRangeByTicker }, 'all');
  const regime = market();
  const hardFailed = rows.filter(row => row.technicalAssessment.state === 'BROKEN_TREND').map(row => row.ticker);
  const successful = chains.map(item => item.chainMeta?.ticker ?? '').sort();
  return {
    asOf: AS_OF,
    engineVersion: RECOMMENDATION_ENGINE_VERSION,
    policyVersion: RECOMMENDATION_POLICY_VERSION,
    universe: recommendationUniverse(true),
    market: { regime, posture: postureFromRegime(regime) },
    underlyings: rows,
    chains: chains.map(data => ({ ticker: data.chainMeta?.ticker ?? '', expiration: EXPIRATION, data })),
    screenerRows: built.rows,
    coverage: {
      trackedUnderlyings: rows.map(row => row.ticker).sort(),
      hardFailedBeforeChainAcquisition: hardFailed,
      requestedForOptionScan: rows.filter(row => !hardFailed.includes(row.ticker)).map(row => row.ticker).sort(),
      successfullyAnalyzedUnderlyings: successful,
      failedUnderlyings: incomplete ? [{ ticker: 'LABU', message: 'Visual fixture batch unavailable.' }] : [],
      failedBatches: incomplete ? [6] : [],
      expirationsCovered: successful.map(ticker => ({ ticker, expirationDates: [EXPIRATION] })),
      expirationPlans: successful.map(ticker => ({ ticker, availableExpirationDates: [EXPIRATION], eligibleExpirationDates: [EXPIRATION], selectedExpirationDates: [EXPIRATION], discoveryExpiration: EXPIRATION })),
      contractsEvaluated: built.rows.length,
      pulse: { requested: rows.length, loaded: rows.length, failed: 0, stale: false },
      provenance: { pulseFetchedAt: FETCHED_AT, chainSources: successful.map(ticker => ({ ticker, expiration: EXPIRATION, source: 'cache', fetchedAt: FETCHED_AT })) },
    },
  };
}

export function buildRecommendationVisualFixture(name: RecommendationVisualFixture): RecommendationRun {
  const tqqq = underlying('TQQQ');
  const soxl = underlying('SOXL', { rsi14: 54, distance50: 0.03 });
  const labu = underlying('LABU', { distance20: -0.05, distance50: -0.04, distance200: 0.08, recentDrawdown30: -0.14 });
  const boil = underlying('BOIL', { distance20: -0.15, distance50: -0.18, distance200: -0.12, recentDrawdown30: -0.25, rsi14: 28 });
  const actionable = chain('TQQQ', option(65, { bid: 1.45, ask: 1.56, last: 1.5, delta: -0.11, impliedVolatility: 82 }));
  const conditional = chain('SOXL', option(60, { bid: 0, ask: 5, last: 4.4, delta: -0.1, impliedVolatility: 95 }));
  const weak = chain('LABU', option(60, { bid: 0.18, ask: 0.28, last: 0.22, delta: -0.08, impliedVolatility: 45 }));
  if (name === 'conditional') return runRecommendationEngine(snapshot([soxl], [conditional]));
  if (name === 'no-trade') return runRecommendationEngine(snapshot([labu, boil], [weak]));
  if (name === 'incomplete') return runRecommendationEngine(snapshot([tqqq, soxl, labu], [actionable, conditional], true));
  return runRecommendationEngine(snapshot([tqqq, soxl, labu, boil], [actionable, conditional, weak]));
}

import { canonicalOptionChainKey } from '../../src/lib/optionChainRequests.ts';
import { postureFromRegime } from '../../src/lib/marketRead/posture.ts';
import { buildScreenerRows } from '../../src/lib/screenerRows.ts';
import { withEtfPulseTechnicalAssessment } from '../../src/lib/etfPulseMetrics.ts';
import { RECOMMENDATION_ENGINE_VERSION, RECOMMENDATION_POLICY_VERSION, recommendationUniverse } from '../../src/lib/recommendations/types.ts';

export const SCALE_AS_OF = '2026-09-02T15:00:00.000Z';
const asOfMs = Date.parse(SCALE_AS_OF);
const day = Math.floor(Date.parse('2026-09-02T00:00:00.000Z') / 1_000);
const dtes = [60, 120, 240];

function pulse(ticker) {
  return withEtfPulseTechnicalAssessment({
    ticker, name: `${ticker} Fund`, type: 'Broad Index', leverage: '3x', underlying: 'Fixture Index', price: 100,
    returns: { oneDay: 0.01, fiveDay: -0.02, thirtyDay: 0.05, threeMonth: 0.12, sixMonth: 0.2, yearToDate: 0.3, oneYear: 0.4 },
    rsi14: 48, realizedVolatility20: 0.55, sma20: 103, sma50: 95, sma200: 75,
    distance20: -0.03, distance50: 0.05, distance200: 0.33, high52Week: 120, low52Week: 45,
    percentOf52WeekHigh: 0.83, position52Week: 0.73, drawdown52Week: -0.17, recentDrawdown30: -0.05,
  });
}

function regime() {
  return {
    label: 'Healthy Risk-On', confidence: 'High', explanation: 'Scale fixture regime', marketRead: 'Scale fixture market read',
    putSellingImplication: 'Scale fixture posture', favor: [], avoid: [], drivers: [], warnings: [],
    stats: { spyTrend: 'Uptrend', qqqTrend: 'Uptrend', breadthAbove50: 0.8, breadthAbove200: 0.8,
      downtrendCount: 0, oversoldCount: 0, overboughtCount: 0, medianThirtyDayReturn: 0.05,
      medianRealizedVolatility20: 0.5, spyRsi: 50, qqqRsi: 50, spyPosition52Week: 0.8,
      qqqPosition52Week: 0.8, vixTrend: null, vxnTrend: null, biggestThirtyDayWinners: [], biggestThirtyDayLosers: [] },
    fetchedAt: asOfMs,
  };
}

function option(ticker, dte, index) {
  const strike = 50 + index;
  const bid = Number((0.35 + index * 0.055 + dte * 0.008).toFixed(2));
  return { strike, last: bid, lastTradeDate: Math.floor((asOfMs - 86_400_000) / 1_000), bid, ask: bid + 0.12,
    delta: -(0.04 + index * 0.0045), impliedVolatility: 70 - index * 0.25, volume: 12, openInterest: 80,
    contractSymbol: `${ticker}P${dte}P${strike}` };
}

export function buildRecommendationScaleSnapshot(tickerCount = 37, strikesPerChain = 36) {
  const tickers = Array.from({ length: tickerCount }, (_, index) => `T${index.toString().padStart(2, '0')}`);
  const initialResults = new Map();
  const chainsByKey = new Map();
  const chains = [];
  for (const ticker of tickers) {
    const expirations = dtes.map(dte => ({ date: day + dte * 86_400, label: `Fixture ${dte}D`, dte }));
    for (const expiration of expirations) {
      const puts = Array.from({ length: strikesPerChain }, (_, index) => option(ticker, expiration.dte, index));
      const data = { expirations, puts, currentPrice: 100, chainMeta: { ticker, requestedExpiration: expiration.date,
        returnedExpiration: expiration.date, expirationDate: expiration.date, fetchedAt: asOfMs, source: 'network', putCount: puts.length } };
      if (!initialResults.has(ticker)) initialResults.set(ticker, data);
      chainsByKey.set(canonicalOptionChainKey(ticker, expiration.date), data);
      chains.push({ ticker, expiration: expiration.date, data });
    }
  }
  const expirationPlansByTicker = new Map(tickers.map(ticker => [ticker, { selectedExpirationDates: dtes.map(dte => day + dte * 86_400) }]));
  const built = buildScreenerRows({ initialResults, chainsByKey,
    ivVsRealizedRangeByTicker: new Map(tickers.map(ticker => [ticker, 75])), expirationPlansByTicker }, 'all');
  const marketRegime = regime();
  return {
    asOf: SCALE_AS_OF, engineVersion: RECOMMENDATION_ENGINE_VERSION, policyVersion: RECOMMENDATION_POLICY_VERSION,
    universe: recommendationUniverse(true), market: { regime: marketRegime, posture: postureFromRegime(marketRegime) },
    underlyings: tickers.map(pulse), chains, screenerRows: built.rows,
    coverage: { trackedUnderlyings: tickers, hardFailedBeforeChainAcquisition: [], requestedForOptionScan: tickers,
      successfullyAnalyzedUnderlyings: tickers, failedUnderlyings: [], failedBatches: [],
      expirationsCovered: tickers.map(ticker => ({ ticker, expirationDates: dtes.map(dte => day + dte * 86_400) })),
      expirationPlans: tickers.map(ticker => ({ ticker, availableExpirationDates: dtes.map(dte => day + dte * 86_400), eligibleExpirationDates: dtes.map(dte => day + dte * 86_400), selectedExpirationDates: dtes.map(dte => day + dte * 86_400), discoveryExpiration: day + dtes[0] * 86_400 })),
      contractsEvaluated: built.rows.length, pulse: { requested: tickers.length, loaded: tickers.length, failed: 0, stale: false },
      provenance: { pulseFetchedAt: asOfMs, chainSources: chains.map(item => ({ ticker: item.ticker, expiration: item.expiration, source: 'network', fetchedAt: asOfMs })) } },
  };
}

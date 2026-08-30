import {
  buildScannerOptionSnapshot,
  cacheScannerOptionSnapshot,
  getScannerOptionSnapshots,
  selectScannerSnapshotExpiration,
  updateScannerSnapshotForTicker,
} from '../src/lib/scannerOptionSnapshot.ts';
import { buildExpirationScheduleGroups } from '../src/lib/portfolioAnalytics.ts';
import { clearMarketDataCache, requestMarketData } from '../src/lib/marketDataRequest.ts';
import { normalizeFiniteNumber, normalizeTimestampSeconds, normalizeYahooIvPercent } from '../src/lib/marketDataNormalize.ts';
import { getYahooProviderHealth, invalidateYahooSession, yahooFetch } from '../api/_lib/yahoo.js';
import { getChartHistory } from '../src/lib/chartHistory.ts';
import optionsHandler from '../api/options.js';
import pricesHandler from '../api/prices.js';
import { OPTION_QUOTE_DISPLAY_ORDER, OPTION_QUOTE_TABLE_DISPLAY_ORDER, OPTION_YIELD_DISPLAY_ORDER, orderedOptionQuoteEntries } from '../src/lib/optionQuoteDisplay.ts';

const EPSILON = 1e-9;

function assert(name, condition, details = '') {
  if (!condition) {
    throw new Error(`${name}${details ? `: ${details}` : ''}`);
  }
}

function assertClose(name, actual, expected, tolerance = EPSILON) {
  assert(
    name,
    Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    `expected ${expected}, got ${actual}`
  );
}

function assertRange(name, value, min, max) {
  assert(
    name,
    Number.isFinite(value) && value >= min && value <= max,
    `expected ${min}..${max}, got ${value}`
  );
}

function calculateBreakeven(strike, premium) {
  return strike - premium;
}

function calculateDownsideCushion(underlying, breakeven) {
  return (underlying - breakeven) / underlying;
}

function calculateNominalYield(premium, strike) {
  return premium / strike;
}

function calculateAnnualizedYield(premium, strike, dte) {
  return calculateNominalYield(premium, strike) * (365 / dte);
}

function calculateBidAskSpreadDecimal(bid, ask) {
  const mid = (bid + ask) / 2;
  return mid > 0 ? (ask - bid) / mid : null;
}

function normalizePercentInput(value, fallback) {
  if (!Number.isFinite(value) || value < 0) return fallback;
  return value > 1 ? value / 100 : value;
}

function getDistanceToStrikeDecimal(underlying, strike) {
  if (!Number.isFinite(underlying) || !Number.isFinite(strike) || underlying <= 0) return null;
  return (underlying - strike) / underlying;
}

function calculate52WeekPosition(latest, low, high) {
  if (latest == null || low == null || high == null || high <= low) return null;
  const position = (latest - low) / (high - low);
  return Number.isFinite(position) ? Math.max(0, Math.min(1, position)) : null;
}

function calculate52WeekDrawdown(latest, high) {
  if (latest == null || high == null || high <= 0) return null;
  return Math.min(0, latest / high - 1);
}

function calculateRecentDrawdown(closes, period = 30) {
  const window = closes.slice(-period);
  const latest = closes.at(-1);
  const high = Math.max(...window);
  if (!Number.isFinite(latest) || !Number.isFinite(high) || high <= 0) return null;
  return Math.min(0, latest / high - 1);
}

function calculateRsi14(closes) {
  if (closes.length < 15) return null;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - 14; i < closes.length; i += 1) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gains += change;
    else losses -= change;
  }
  const avgGain = gains / 14;
  const avgLoss = losses / 14;
  if (avgLoss === 0 && avgGain === 0) return 50;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function estimateOptionRequests(tickerCount, minDte, maxExpirationsPerTicker) {
  const initialLookupPerTicker = 1;
  const initialChainLikelyUsable = minDte <= 45;
  const additionalDatedChains = initialChainLikelyUsable
    ? Math.max(0, maxExpirationsPerTicker - 1)
    : maxExpirationsPerTicker;
  return tickerCount * (initialLookupPerTicker + additionalDatedChains);
}

const SNAPSHOT_NOW = new Date('2026-06-08T15:00:00Z');

function unixDate(isoDate) {
  return Math.floor(Date.parse(`${isoDate}T00:00:00Z`) / 1000);
}

function futureExpiration(days) {
  return Math.floor(Date.UTC(2026, 5, 8 + days) / 1000);
}

function expirationCandidate(days) {
  return selectScannerSnapshotExpiration([futureExpiration(days)], SNAPSHOT_NOW);
}

function put(strike, overrides = {}) {
  return {
    strike,
    bid: 1,
    ask: 1.1,
    last: 1.05,
    lastTradeDate: unixDate('2026-06-05'),
    impliedVolatility: 80,
    openInterest: 600,
    volume: 30,
    ...overrides,
  };
}

function snapshotChain(puts, expiration = futureExpiration(60), expirations = [expiration], currentPrice = 100) {
  return {
    expirations: expirations.map(date => ({ date, label: 'Test', dte: Math.round((date - futureExpiration(0)) / 86400) })),
    puts,
    calls: [],
    currentPrice,
    chainMeta: {
      returnedExpiration: expiration,
      expirationDate: expiration,
      fetchedAt: SNAPSHOT_NOW.getTime(),
    },
  };
}

function snapshotFor(puts, days = 60, currentPrice = 100) {
  const candidate = expirationCandidate(days);
  assert(`candidate exists for ${days} DTE`, candidate != null);
  return buildScannerOptionSnapshot('TST', snapshotChain(puts, candidate.date, [candidate.date], currentPrice), candidate, SNAPSHOT_NOW);
}

const strongZone = [put(69), put(70), put(71), put(99, { impliedVolatility: 70 }), put(101, { impliedVolatility: 90 })];
const strongSnapshot = snapshotFor(strongZone);
const interpolatedSnapshot = snapshotFor([
  put(70),
  put(99, { impliedVolatility: 70 }),
  put(101, { impliedVolatility: 90 }),
]);
const nearestSnapshot = snapshotFor([
  put(70),
  put(99, { impliedVolatility: null }),
  put(102, { impliedVolatility: 77 }),
]);
const skippedMissingIvSnapshot = snapshotFor([
  put(70),
  put(99, { impliedVolatility: null }),
  put(108, { impliedVolatility: 82 }),
]);
const noNearbyIvSnapshot = snapshotFor([
  put(70, { impliedVolatility: null }),
  put(79, { impliedVolatility: 91 }),
]);
const expandedZoneSnapshot = snapshotFor([put(62), put(99), put(101)]);
const broadZoneSnapshot = snapshotFor([put(53), put(99), put(101)]);
const outsideZoneSnapshot = snapshotFor([put(49), put(99), put(101)]);
const twoStrikeZoneSnapshot = snapshotFor([put(69), put(71), put(99), put(101)]);
const oneSidedSnapshot = snapshotFor([
  put(69, { ask: null }),
  put(70, { ask: null }),
  put(71, { ask: null }),
  put(99),
  put(101),
]);
const askOnlySnapshot = snapshotFor([
  put(69, { bid: 0 }),
  put(70, { bid: 0 }),
  put(71, { bid: 0 }),
  put(99),
  put(101),
]);
const missingTradeSnapshot = snapshotFor([
  put(69, { lastTradeDate: null }),
  put(70, { lastTradeDate: null }),
  put(71, { lastTradeDate: null }),
  put(99),
  put(101),
]);
const missingVolumeSnapshot = snapshotFor([
  put(69, { volume: null }),
  put(70, { volume: null }),
  put(71, { volume: null }),
  put(99),
  put(101),
]);
const staleTradeSnapshot = snapshotFor([
  put(69, { lastTradeDate: unixDate('2026-05-01') }),
  put(70, { lastTradeDate: unixDate('2026-05-01') }),
  put(71, { lastTradeDate: unixDate('2026-05-01') }),
  put(99),
  put(101),
]);
const isolatedSnapshot = snapshotFor([
  put(70),
  put(99),
  put(101),
]);
const cheapWideRelativeSnapshot = snapshotFor([
  put(69, { bid: 0.01, ask: 0.06 }),
  put(70, { bid: 0.01, ask: 0.06 }),
  put(71, { bid: 0.01, ask: 0.06 }),
  put(99),
  put(101),
]);

const scheduleTrades = [
  {
    id: 'schedule-a', ticker: 'AAA', optionType: 'put', strike: 50, expiration: '2099-01-15', contracts: 2,
    soldPrice: 2, soldDate: '2098-11-15', status: 'open', notes: '', createdAt: SNAPSHOT_NOW.toISOString(), updatedAt: SNAPSHOT_NOW.toISOString(),
    latestMarketData: { optionBid: 0.8, optionAsk: 1, optionLast: 0.9, delta: -0.2 },
  },
  {
    id: 'schedule-b', ticker: 'BBB', optionType: 'put', strike: 40, expiration: '2099-01-15', contracts: 1,
    soldPrice: 1, soldDate: '2098-12-01', status: 'open', notes: '', createdAt: SNAPSHOT_NOW.toISOString(), updatedAt: SNAPSHOT_NOW.toISOString(),
    latestMarketData: { optionBid: 0.4, optionAsk: 0.5, optionLast: 0.45, delta: -0.4 },
  },
  {
    id: 'schedule-c', ticker: 'CCC', optionType: 'put', strike: 30, expiration: '2099-02-19', contracts: 3,
    soldPrice: 1.5, soldDate: '2098-12-15', status: 'open', notes: '', createdAt: SNAPSHOT_NOW.toISOString(), updatedAt: SNAPSHOT_NOW.toISOString(),
    latestMarketData: { optionBid: 0.6, optionAsk: 0.75, optionLast: 0.7, delta: -0.1 },
  },
  {
    id: 'schedule-archived', ticker: 'OLD', optionType: 'put', strike: 20, expiration: '2099-01-15', contracts: 9,
    soldPrice: 2, soldDate: '2098-11-15', status: 'closed', notes: '', createdAt: SNAPSHOT_NOW.toISOString(), updatedAt: SNAPSHOT_NOW.toISOString(),
    latestMarketData: { optionBid: 1, optionAsk: 1.2, delta: -0.5 },
  },
];
const scheduleGroupsAsk = buildExpirationScheduleGroups(scheduleTrades, 'ask');
const januaryScheduleGroup = scheduleGroupsAsk[0];
const scheduleGroupsBid = buildExpirationScheduleGroups(scheduleTrades, 'bid');

const checks = [
  () => assert('quote details use Last/Bid/Mid/Ask order', OPTION_QUOTE_DISPLAY_ORDER.join('/') === 'last/bid/mid/ask'),
  () => assert('quote tables use Last/Bid/Ask order', OPTION_QUOTE_TABLE_DISPLAY_ORDER.join('/') === 'last/bid/ask'),
  () => assert('yield columns group NY/AY by Last/Bid/Ask basis', OPTION_YIELD_DISPLAY_ORDER.join('/') === 'nomYieldLast/annYieldLast/nomYieldBid/annYieldBid/nomYieldAsk/annYieldAsk'),
  () => assert('default annualized yield columns use Last/Bid/Ask order', OPTION_YIELD_DISPLAY_ORDER.filter(field => field.startsWith('annYield')).join('/') === 'annYieldLast/annYieldBid/annYieldAsk'),
  () => assert('ordered quote values stay attached to their labels', orderedOptionQuoteEntries({ last: 4, bid: 3, mid: 2, ask: 1 }).map(entry => `${entry.field}:${entry.value}`).join('|') === 'last:4|bid:3|mid:2|ask:1'),
  () => assertClose('breakeven uses premium per share', calculateBreakeven(50, 2), 48),
  () => assertClose('downside cushion is decimal', calculateDownsideCushion(60, 48), 0.2),
  () => assertClose('nominal yield is decimal', calculateNominalYield(2, 50), 0.04),
  () => assertClose('annualized yield is decimal', calculateAnnualizedYield(2, 50, 73), 0.2),
  () => assertClose('bid/ask spread is decimal of midpoint', calculateBidAskSpreadDecimal(1, 1.5), 0.4),
  () => assertClose('percent input 30 becomes decimal', normalizePercentInput(30, 0.25), 0.3),
  () => assertClose('percent input 0.3 stays decimal', normalizePercentInput(0.3, 0.25), 0.3),
  () => assertClose('distance to strike is decimal', getDistanceToStrikeDecimal(100, 70), 0.3),
  () => assertClose('52W position clamps above high', calculate52WeekPosition(120, 80, 100), 1),
  () => assertClose('52W position clamps below low', calculate52WeekPosition(70, 80, 100), 0),
  () => assertClose('52W drawdown cannot be positive', calculate52WeekDrawdown(120, 100), 0),
  () => assertClose('52W drawdown is negative below high', calculate52WeekDrawdown(80, 100), -0.2),
  () => assertClose('recent drawdown is zero at recent high', calculateRecentDrawdown([80, 90, 100], 3), 0),
  () => assertClose('recent drawdown is negative below recent high', calculateRecentDrawdown([100, 95, 90], 3), -0.1),
  () => assertRange('RSI stays in 0..100', calculateRsi14([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]), 0, 100),
  () => assertClose('flat RSI is neutral', calculateRsi14(Array(15).fill(100)), 50),
  () => assertClose('long-DTE scan estimate counts initial plus dated chains', estimateOptionRequests(5, 60, 2), 15),
  () => assertClose('near-DTE scan estimate reuses initial chain', estimateOptionRequests(5, 14, 2), 10),
  () => assert('selects exact 60 DTE', selectScannerSnapshotExpiration([futureExpiration(60)], SNAPSHOT_NOW)?.dte === 60),
  () => assert('selects nearest 58 DTE', selectScannerSnapshotExpiration([futureExpiration(45), futureExpiration(58), futureExpiration(75)], SNAPSHOT_NOW)?.dte === 58),
  () => assert('uses normal 83-DTE fallback', selectScannerSnapshotExpiration([futureExpiration(29), futureExpiration(83)], SNAPSHOT_NOW)?.tier === 'normal'),
  () => assert('uses expanded 21-DTE fallback', selectScannerSnapshotExpiration([futureExpiration(21)], SNAPSHOT_NOW)?.tier === 'expanded'),
  () => assert('equidistant expirations prefer earlier date', selectScannerSnapshotExpiration([futureExpiration(62), futureExpiration(58)], SNAPSHOT_NOW)?.dte === 58),
  () => assert('rejects expiration outside 7-180 DTE', selectScannerSnapshotExpiration([futureExpiration(2), futureExpiration(181)], SNAPSHOT_NOW) == null),
  () => assertClose('ATM IV interpolates bracketing puts', interpolatedSnapshot.atmPutIv, 80),
  () => assert('ATM IV records interpolation method', interpolatedSnapshot.atmIvMethod === 'interpolated'),
  () => assertClose('ATM IV uses one valid nearby strike', nearestSnapshot.atmPutIv, 77),
  () => assertClose('ATM IV skips nearest missing IV', skippedMissingIvSnapshot.atmPutIv, 82),
  () => assert('8%-from-spot IV is reduced confidence', skippedMissingIvSnapshot.atmConfidence === 'reduced'),
  () => assert('ATM IV beyond 20% is unavailable', noNearbyIvSnapshot.atmPutIv == null),
  () => assert('unavailable ATM IV is neither NaN nor false zero', noNearbyIvSnapshot.atmPutIv === null),
  () => assertClose('exact 30%-OTM strike is selected', strongSnapshot.liquidityStrike, 70),
  () => assertClose('nearest ideal strike at 27% OTM is selected', snapshotFor([put(73), put(99), put(101)]).liquidityStrike, 73),
  () => assert('38%-OTM strike uses expanded tier', expandedZoneSnapshot.liquiditySelectionTier === 'expanded'),
  () => assert('47%-OTM strike uses nearest usable tier', broadZoneSnapshot.liquiditySelectionTier === 'nearest_usable'),
  () => assert('strike beyond 50% OTM is unavailable', outsideZoneSnapshot.liquidityLabel === 'unavailable'),
  () => assert('sparse two-strike zone remains evaluable', twoStrikeZoneSnapshot.neighboringStrikeCount === 2 && twoStrikeZoneSnapshot.liquidityLabel !== 'unavailable'),
  () => assert('strong two-sided zone is very liquid', strongSnapshot.liquidityLabel === 'very_liquid'),
  () => assert('bid with missing ask cannot exceed medium', ['illiquid', 'thin', 'medium'].includes(oneSidedSnapshot.liquidityLabel)),
  () => assert('ask with zero bid cannot exceed thin', ['illiquid', 'thin'].includes(askOnlySnapshot.liquidityLabel)),
  () => assert('missing last trade remains rated', missingTradeSnapshot.liquidityLabel !== 'unavailable'),
  () => assert('missing volume remains rated', missingVolumeSnapshot.liquidityLabel !== 'unavailable'),
  () => assert('stale trade reduces score', staleTradeSnapshot.liquidityScore < strongSnapshot.liquidityScore),
  () => assert('isolated strike is downgraded', isolatedSnapshot.liquidityLabel !== 'very_liquid'),
  () => assert('small absolute spread activates cheap-option guardrail', cheapWideRelativeSnapshot.spreadGuardrail?.includes('Tiny-premium')),
  () => assert('snapshot numeric outputs contain no non-finite values', Object.values(strongSnapshot).every(value => typeof value !== 'number' || Number.isFinite(value))),
  () => assert('market normalization preserves missing values', normalizeFiniteNumber(null) === null && normalizeYahooIvPercent(undefined) === null),
  () => assertClose('market normalization accepts numeric strings', normalizeFiniteNumber('12.5'), 12.5),
  () => assertClose('market normalization converts Yahoo IV decimals', normalizeYahooIvPercent('0.82'), 82),
  () => assertClose('market normalization converts millisecond timestamps', normalizeTimestampSeconds(1893456000000), 1893456000),
  () => assert('schedule groups only open trades by expiration', scheduleGroupsAsk.length === 2 && januaryScheduleGroup.tradeCount === 2),
  () => assert('schedule groups are chronological', scheduleGroupsAsk[0].expiration === '2099-01-15' && scheduleGroupsAsk[1].expiration === '2099-02-19'),
  () => assertClose('expiration contracts sum', januaryScheduleGroup.contractCount, 3),
  () => assertClose('expiration premium reconciles', januaryScheduleGroup.premiumCollected, 500),
  () => assertClose('expiration gross risk reconciles', januaryScheduleGroup.grossRisk, 14000),
  () => assertClose('expiration net capital reconciles', januaryScheduleGroup.netCapitalAtRisk, 13500),
  () => assertClose('expiration current value reconciles', januaryScheduleGroup.currentValue, -250),
  () => assertClose('expiration gain loss uses aggregate economics', januaryScheduleGroup.totalGainLoss, 250),
  () => assertClose('expiration captured percentage is blended', januaryScheduleGroup.totalGainLoss / januaryScheduleGroup.premiumCollected, 0.5),
  () => assertClose('expiration delta is gross-risk weighted', januaryScheduleGroup.weightedAverageDelta, (-0.2 * 10000 - 0.4 * 4000) / 14000),
  () => assertClose('expiration original nominal yield is aggregate', januaryScheduleGroup.originalNY, 500 / 13500),
  () => assertClose('expiration original annualized yield uses dollar-days', januaryScheduleGroup.originalAY, 500 / ((9600 * 61 + 3900 * 45) / 365)),
  () => assertClose('expiration current nominal yield is aggregate', januaryScheduleGroup.currentNY, 250 / 13500),
  () => assertClose('expiration current annualized yield uses remaining dollar-days', januaryScheduleGroup.currentAY, 250 / (13500 * januaryScheduleGroup.dte / 365)),
  () => assertClose('mark basis recomputes expiration current value', scheduleGroupsBid[0].currentValue, -200),
  () => assertClose('expiration premiums reconcile to all-group total', scheduleGroupsAsk.reduce((total, group) => total + group.premiumCollected, 0), 950),
  () => assertClose('expiration gross risk reconciles to all-group total', scheduleGroupsAsk.reduce((total, group) => total + group.grossRisk, 0), 23000),
  () => assertClose('expiration net capital reconciles to all-group total', scheduleGroupsAsk.reduce((total, group) => total + group.netCapitalAtRisk, 0), 22050),
  () => assertClose('expiration current values reconcile to all-group total', scheduleGroupsAsk.reduce((total, group) => total + group.currentValue, 0), -475),
  () => assertClose('expiration gain loss reconciles to all-group total', scheduleGroupsAsk.reduce((total, group) => total + group.totalGainLoss, 0), 475),
  () => {
    const collapsedState = { '2099-01-15': true, '2099-02-19': false };
    assert('collapse state is presentation-only', collapsedState['2099-01-15'] && JSON.stringify(buildExpirationScheduleGroups(scheduleTrades, 'ask')) === JSON.stringify(scheduleGroupsAsk));
  },
];

let passed = 0;
for (const check of checks) {
  check();
  passed += 1;
}

const primaryExpiration = futureExpiration(60);
const fallbackExpiration = futureExpiration(58);
let usableRequests = 0;
const usableOutcome = await updateScannerSnapshotForTicker({
  ticker: 'ONE',
  scannerPrice: 100,
  expirationDates: [primaryExpiration, primaryExpiration, fallbackExpiration],
  now: SNAPSHOT_NOW,
  fetchChain: async expiration => {
    usableRequests += 1;
    return snapshotChain(strongZone, expiration);
  },
});
assert('usable primary does not fetch second expiration', usableRequests === 1 && usableOutcome.requestCount === 1);
assert('duplicate expiration candidates are deduplicated', usableOutcome.requestedExpirations.length === 1);
passed += 2;

let fallbackRequests = 0;
const fallbackOutcome = await updateScannerSnapshotForTicker({
  ticker: 'TWO',
  scannerPrice: 100,
  expirationDates: [primaryExpiration, fallbackExpiration],
  now: SNAPSHOT_NOW,
  fetchChain: async expiration => {
    fallbackRequests += 1;
    return snapshotChain(expiration === primaryExpiration ? [put(99, { impliedVolatility: null })] : strongZone, expiration);
  },
});
assert('unusable primary fetches exactly one fallback', fallbackRequests === 2 && fallbackOutcome.requestCount === 2);
assert('fallback never exceeds two requests', fallbackOutcome.requestedExpirations.length <= 2);
assert('fallback records second-expiration use', fallbackOutcome.snapshot?.usedSecondExpiration === true);
passed += 3;

let failedRequests = 0;
const failedOutcome = await updateScannerSnapshotForTicker({
  ticker: 'FAIL',
  scannerPrice: 100,
  expirationDates: [primaryExpiration],
  now: SNAPSHOT_NOW,
  fetchChain: async () => {
    failedRequests += 1;
    throw new Error('network failed');
  },
});
assert('failed update is distinguished from unavailable', failedOutcome.status === 'failed' && failedRequests === 1);
passed += 1;

const originalLocalStorage = globalThis.localStorage;
const memory = new Map();
globalThis.localStorage = {
  getItem: key => memory.get(key) ?? null,
  setItem: (key, value) => memory.set(key, value),
  removeItem: key => memory.delete(key),
  clear: () => memory.clear(),
  key: index => [...memory.keys()][index] ?? null,
  get length() { return memory.size; },
};

const brokerKey = 'selfcheck:market-broker:stale';
clearMarketDataCache(brokerKey);
let brokerCalls = 0;
const brokerOptions = {
  key: brokerKey,
  source: 'selfcheck',
  endpoint: 'volatility-context',
  softTtlMs: 0,
  hardTtlMs: 60_000,
  schemaVersion: 1,
  allowStaleOnError: true,
  validator: data => data?.value === 7,
};
const brokerFresh = await requestMarketData({
  ...brokerOptions,
  fetcher: async () => { brokerCalls += 1; return { value: 7 }; },
});
assert('market broker stores successful response', brokerFresh.data.value === 7 && brokerCalls === 1);
const brokerStale = await requestMarketData({
  ...brokerOptions,
  mode: 'revalidate',
  fetcher: async () => { brokerCalls += 1; throw new Error('temporary failure'); },
});
assert('market broker serves stale-on-error without overwriting data', brokerStale.data.value === 7 && brokerStale.meta.staleFallbackUsed && brokerCalls === 2);

await requestMarketData({ ...brokerOptions, mode: 'revalidate', fetcher: async () => { brokerCalls += 1; throw new Error('failure two'); } });
await requestMarketData({ ...brokerOptions, mode: 'revalidate', fetcher: async () => { brokerCalls += 1; throw new Error('failure three'); } });
const circuitFallback = await requestMarketData({ ...brokerOptions, mode: 'revalidate', fetcher: async () => { brokerCalls += 1; return { value: 7 }; } });
assert('market broker circuit breaker suppresses cascading calls', circuitFallback.meta.staleFallbackUsed && brokerCalls === 4);

const dedupeKey = 'selfcheck:market-broker:dedupe';
clearMarketDataCache(dedupeKey);
let dedupeCalls = 0;
const dedupeOptions = {
  key: dedupeKey,
  source: 'selfcheck',
  endpoint: 'price',
  softTtlMs: 60_000,
  hardTtlMs: 120_000,
  schemaVersion: 1,
  mode: 'revalidate',
  validator: data => data?.ok === true,
  fetcher: async () => { dedupeCalls += 1; await Promise.resolve(); return { ok: true }; },
};
const dedupedResults = await Promise.all([requestMarketData(dedupeOptions), requestMarketData(dedupeOptions)]);
assert('market broker deduplicates in-flight requests', dedupeCalls === 1 && dedupedResults.some(result => result.meta.deduped));

const chartNowSeconds = Math.floor(Date.now() / 1000);
const chartPoints = [300, 120, 10].map(daysAgo => {
  const timestamp = chartNowSeconds - daysAgo * 86400;
  return { timestamp, date: new Date(timestamp * 1000).toISOString(), price: 100 + daysAgo };
});
await requestMarketData({
  key: 'chart_history_cache:TST:1Y',
  source: 'selfcheck',
  endpoint: 'chart-history',
  softTtlMs: 6 * 60 * 60 * 1000,
  hardTtlMs: 72 * 60 * 60 * 1000,
  schemaVersion: 3,
  validator: data => data?.timeframe === '1Y',
  fetcher: async () => ({ ticker: 'TST', displayTicker: 'TST', timeframe: '1Y', points: chartPoints, corporateActions: [], fetchedAt: Date.now(), metadata: { interval: '1d' } }),
});
const derivedSixMonth = await getChartHistory('TST', '6M');
assert('richer daily chart cache satisfies shorter timeframe without a request', derivedSixMonth.metadata?.derivedFrom === '1Y' && derivedSixMonth.points.length === 2);

const originalFetch = globalThis.fetch;
const makeApiResponse = () => ({
  statusCode: 200,
  headers: {},
  body: null,
  setHeader(name, value) { this.headers[name] = value; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return body; },
});

invalidateYahooSession();
let optionUpstreamCalls = 0;
globalThis.fetch = async url => {
  optionUpstreamCalls += 1;
  if (String(url).includes('finance.yahoo.com/quote/')) {
    return new Response('{"crumb":"session-crumb"}', { status: 200, headers: { 'set-cookie': 'B=session; Path=/' } });
  }
  return Response.json({ optionChain: { result: [{ quote: { regularMarketPrice: 100 }, expirationDates: [], options: [] }] } });
};
const firstOptionsResponse = makeApiResponse();
const secondOptionsResponse = makeApiResponse();
await optionsHandler({ query: { ticker: 'AAA' } }, firstOptionsResponse);
await optionsHandler({ query: { ticker: 'BBB' } }, secondOptionsResponse);
assert('Yahoo option session is reused across warm requests', firstOptionsResponse.statusCode === 200 && secondOptionsResponse.statusCode === 200 && optionUpstreamCalls === 3);

let pricesUpstreamCalls = 0;
const priceCloses = Array.from({ length: 66 }, (_, index) => 80 + index / 2);
globalThis.fetch = async () => {
  pricesUpstreamCalls += 1;
  return Response.json({ spark: { result: [{ symbol: 'TQQQ', response: [{ meta: { regularMarketPrice: 112.5, chartPreviousClose: 111, fiftyTwoWeekHigh: 120, fiftyTwoWeekLow: 60 }, indicators: { quote: [{ close: priceCloses }] } }] }] } });
};
const pricesResponse = makeApiResponse();
await pricesHandler({ query: { tickers: 'TQQQ' } }, pricesResponse);
assert('batch prices use one Yahoo payload per chunk for all metrics', pricesUpstreamCalls === 1 && pricesResponse.body.TQQQ.fiveDay != null && pricesResponse.body.TQQQ.oneMonth != null && pricesResponse.body.TQQQ.threeMonth != null && pricesResponse.body.TQQQ.high52w === 120);

let yahooCalls = 0;
globalThis.fetch = async () => {
  yahooCalls += 1;
  return new Response('', { status: yahooCalls <= 3 ? 503 : 200 });
};
await yahooFetch('https://example.invalid/one', { endpoint: 'selfcheck' });
await yahooFetch('https://example.invalid/two', { endpoint: 'selfcheck' });
await yahooFetch('https://example.invalid/three', { endpoint: 'selfcheck' });
let circuitOpened = false;
try { await yahooFetch('https://example.invalid/four', { endpoint: 'selfcheck' }); } catch { circuitOpened = true; }
assert('Yahoo circuit opens after consecutive provider failures', circuitOpened && yahooCalls === 3 && getYahooProviderHealth().selfcheck.circuitOpenUntil > Date.now());
const overrideResponse = await yahooFetch('https://example.invalid/override', { endpoint: 'selfcheck', overrideCircuit: true });
assert('Yahoo circuit allows one explicit override and resets on success', overrideResponse.ok && yahooCalls === 4 && getYahooProviderHealth().selfcheck.consecutiveFailures === 0);
globalThis.fetch = originalFetch;
passed += 9;

memory.set('scanner_option_snapshots_v1', JSON.stringify({ OLD: { ticker: 'OLD', updatedAt: SNAPSHOT_NOW.toISOString() } }));
assert('old snapshot schema is invalidated', getScannerOptionSnapshots().OLD == null);
cacheScannerOptionSnapshot({ ...strongSnapshot, ticker: 'KEEP' });
const beforeFailure = getScannerOptionSnapshots().KEEP;
await updateScannerSnapshotForTicker({
  ticker: 'KEEP',
  scannerPrice: 100,
  expirationDates: [primaryExpiration],
  now: SNAPSHOT_NOW,
  fetchChain: async () => { throw new Error('refresh failed'); },
});
assert('failed update leaves previous cached snapshot intact', getScannerOptionSnapshots().KEEP?.updatedAt === beforeFailure.updatedAt);
passed += 2;
if (originalLocalStorage === undefined) delete globalThis.localStorage;
else globalThis.localStorage = originalLocalStorage;

console.log(`Self-checks passed: ${passed}/${checks.length + 17}`);

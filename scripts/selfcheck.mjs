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
  return Math.floor((Date.UTC(2026, 5, 8 + days)) / 1000);
}

function snapshotChain(puts, expiration = futureExpiration(60)) {
  return {
    expirations: [
      { date: futureExpiration(40), label: 'Jul 18', dte: 40 },
      { date: expiration, label: 'Aug 7', dte: 60 },
      { date: futureExpiration(80), label: 'Aug 27', dte: 80 },
    ],
    puts,
    currentPrice: 100,
    chainMeta: {
      returnedExpiration: expiration,
      expirationDate: expiration,
      fetchedAt: SNAPSHOT_NOW.getTime(),
    },
  };
}

const liquidSnapshot = buildScannerOptionSnapshot('TST', snapshotChain([
  { strike: 69, bid: 0.20, ask: 0.28, last: 0.22, lastTradeDate: unixDate('2026-06-05'), impliedVolatility: 95, openInterest: 150, volume: 8 },
  { strike: 70, bid: 0.34, ask: 0.43, last: 0.38, lastTradeDate: unixDate('2026-06-05'), impliedVolatility: 93, openInterest: 284, volume: 17 },
  { strike: 71, bid: 0.40, ask: 0.50, last: 0.44, lastTradeDate: unixDate('2026-06-05'), impliedVolatility: 92, openInterest: 210, volume: 12 },
  { strike: 99, bid: 3.80, ask: 4.10, last: 3.95, lastTradeDate: unixDate('2026-06-05'), impliedVolatility: 87.2, openInterest: 100, volume: 5 },
  { strike: 100, bid: 4.20, ask: 4.50, last: 4.35, lastTradeDate: unixDate('2026-06-05'), impliedVolatility: null, openInterest: 100, volume: 5 },
]), { date: futureExpiration(60), dte: 60 }, SNAPSHOT_NOW);

const oneBidSnapshot = buildScannerOptionSnapshot('TST', snapshotChain([
  { strike: 69, bid: 0, ask: 0.20, last: 0.10, lastTradeDate: unixDate('2026-06-05'), impliedVolatility: 95, openInterest: 100, volume: 5 },
  { strike: 70, bid: 0.10, ask: null, last: 0.10, lastTradeDate: unixDate('2026-06-05'), impliedVolatility: 93, openInterest: 120, volume: 8 },
  { strike: 71, bid: null, ask: 0.25, last: 0.15, lastTradeDate: unixDate('2026-06-05'), impliedVolatility: 92, openInterest: 100, volume: 5 },
  { strike: 100, bid: 4.20, ask: 4.50, last: 4.35, lastTradeDate: unixDate('2026-06-05'), impliedVolatility: 80, openInterest: 100, volume: 5 },
]), { date: futureExpiration(60), dte: 60 }, SNAPSHOT_NOW);

const noBidSnapshot = buildScannerOptionSnapshot('TST', snapshotChain([
  { strike: 69, bid: 0.10, ask: 0.20, last: 0.10, lastTradeDate: unixDate('2026-06-05'), impliedVolatility: 95, openInterest: 100, volume: 5 },
  { strike: 70, bid: 0, ask: 0.20, last: 0.15, lastTradeDate: unixDate('2026-06-05'), impliedVolatility: 93, openInterest: 600, volume: 30 },
  { strike: 71, bid: 0.10, ask: 0.20, last: 0.10, lastTradeDate: unixDate('2026-06-05'), impliedVolatility: 92, openInterest: 100, volume: 5 },
  { strike: 100, bid: 4.20, ask: 4.50, last: 4.35, lastTradeDate: unixDate('2026-06-05'), impliedVolatility: 80, openInterest: 100, volume: 5 },
]), { date: futureExpiration(60), dte: 60 }, SNAPSHOT_NOW);

const outOfRangeSnapshot = buildScannerOptionSnapshot('TST', snapshotChain([
  { strike: 80, bid: 0.10, ask: 0.20, last: 0.15, lastTradeDate: unixDate('2026-06-05'), impliedVolatility: 90, openInterest: 600, volume: 30 },
  { strike: 100, bid: 4.20, ask: 4.50, last: 4.35, lastTradeDate: unixDate('2026-06-05'), impliedVolatility: 80, openInterest: 100, volume: 5 },
]), { date: futureExpiration(60), dte: 60 }, SNAPSHOT_NOW);

const holidayRecencySnapshot = buildScannerOptionSnapshot('TST', snapshotChain([
  { strike: 69, bid: 0.20, ask: 0.28, last: 0.22, lastTradeDate: unixDate('2026-07-02'), impliedVolatility: 95, openInterest: 150, volume: 8 },
  { strike: 70, bid: 0.34, ask: 0.43, last: 0.38, lastTradeDate: unixDate('2026-07-02'), impliedVolatility: 93, openInterest: 284, volume: 17 },
  { strike: 71, bid: 0.40, ask: 0.50, last: 0.44, lastTradeDate: unixDate('2026-07-02'), impliedVolatility: 92, openInterest: 210, volume: 12 },
  { strike: 100, bid: 4.20, ask: 4.50, last: 4.35, lastTradeDate: unixDate('2026-07-02'), impliedVolatility: 80, openInterest: 100, volume: 5 },
]), { date: futureExpiration(60), dte: 60 }, new Date('2026-07-06T15:00:00Z'));

const checks = [
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
  () => assert('60-DTE selection prefers 45-75 DTE', selectScannerSnapshotExpiration([futureExpiration(40), futureExpiration(55), futureExpiration(80)], SNAPSHOT_NOW)?.dte === 55),
  () => assert('60-DTE selection falls back to 30-90 DTE', selectScannerSnapshotExpiration([futureExpiration(28), futureExpiration(85)], SNAPSHOT_NOW)?.dte === 85),
  () => assertClose('ATM IV skips nearest invalid IV contract', liquidSnapshot?.atmPutIv, 87.2),
  () => assertClose('30%-OTM strike selection uses nearest listed strike', liquidSnapshot?.liquidityStrike, 70),
  () => assertClose('spread uses bid/ask midpoint', liquidSnapshot?.spreadPercent, (0.43 - 0.34) / ((0.43 + 0.34) / 2)),
  () => assert('Friday trade is prior trading day on Monday and earns full recency score', liquidSnapshot?.liquidityScore === 88),
  () => assert('high-quality market classifies as very liquid', liquidSnapshot?.liquidityLabel === 'very_liquid'),
  () => assert('one nearby valid bid downgrades one level', oneBidSnapshot?.liquidityLabel === 'thin'),
  () => assert('no valid selected bid cannot exceed thin', noBidSnapshot?.liquidityLabel === 'thin'),
  () => assert('strike outside 25%-35% OTM is unavailable', outOfRangeSnapshot?.liquidityLabel === 'unavailable'),
  () => assert('observed Independence Day is excluded from trading-day recency', holidayRecencySnapshot?.liquidityScore === 88),
];

let passed = 0;
for (const check of checks) {
  check();
  passed += 1;
}

console.log(`Self-checks passed: ${passed}/${checks.length}`);
import {
  buildScannerOptionSnapshot,
  selectScannerSnapshotExpiration,
} from '../src/lib/scannerOptionSnapshot.ts';

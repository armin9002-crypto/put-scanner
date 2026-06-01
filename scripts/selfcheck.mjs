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
];

let passed = 0;
for (const check of checks) {
  check();
  passed += 1;
}

console.log(`Self-checks passed: ${passed}/${checks.length}`);

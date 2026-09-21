import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { calculateAnnualizedYield, calculateBreakeven, calculateDte, calculateMoneyness, calculatePositionMetrics, calculateYieldPercent } from '../src/lib/optionMetrics.ts';
import { buildOptionDrawerQuoteState } from '../src/lib/optionQuoteDisplay.ts';
import { buildScreenerRows } from '../src/lib/screenerRows.ts';
import { mergeWatchlistRefreshItem } from '../src/lib/watchlistRefresh.ts';
import { buildWatchlistRow } from '../src/lib/watchlistRows.ts';
import { normalizeOptionChainData } from '../src/lib/yahooOptionAdapter.ts';
import { calculatePutDelta, resolvePutDeltaWithSource } from '../src/lib/putDelta.ts';
import { discoverContractPricing } from '../src/lib/recommendations/pricing.ts';
import { calculateRemainingDte, calculateDistanceToStrike, calculateDistanceToBreakeven } from '../src/lib/portfolioMetrics.ts';
import { formatPercent, formatPercentPoints } from '../src/lib/format.ts';
import { runRecommendationEngine } from '../src/lib/recommendations/engine.ts';
import { buildRecommendationScaleSnapshot } from './fixtures/recommendationsScale.mjs';

const AS_OF = '2026-09-01T16:00:00Z';
const EXPIRY = '2026-10-16';
const EXP = Date.parse(`${EXPIRY}T00:00:00Z`) / 1000;
const near = (actual, expected, message) => {
  assert.ok(Number.isFinite(actual), `${message}: ${actual} is not finite`);
  assert.ok(Math.abs(actual - expected) < 1e-10, `${message}: ${actual} != ${expected}`);
};
const base = { strike: 50.125, bid: 1.21, ask: 1.39, lastPrice: 1.28, lastTradeDate: Date.parse(AS_OF) / 1000, delta: -0.23456789, impliedVolatility: 0.61234567, volume: 12, openInterest: 100 };
// A-H: each fixture traverses provider normalization, actual Screener and Watchlist
// consumers, Drawer selection, and Recommendations pricing without acquisition.
const matrix = [
  ['A normal OTM', {}],
  ['B full precision', { bid: 1.23456789, ask: 1.45678912, lastPrice: 1.34567891 }],
  ['C No Bid', { bid: 0 }],
  ['D stale Last', { lastTradeDate: Date.parse('2026-06-01T16:00:00Z') / 1000 }],
  ['E unknown Last age', { lastTradeDate: null }],
  ['F provider Delta zero', { delta: 0 }],
  ['G calculated Delta', { delta: null }],
  ['H near expiration', {}, '2026-10-15T23:59:00Z'],
];

for (const [name, overrides, asOf = AS_OF] of matrix) {
  test(name, t => {
    t.mock.timers.enable({ apis: ['Date'], now: new Date(asOf) });
    const raw = { ...base, ...overrides };
    const chain = normalizeOptionChainData({ optionChain: { result: [{
      quote: { regularMarketPrice: 57.12345678 }, expirationDates: [EXP],
      options: [{ expirationDate: EXP, puts: [raw], calls: [] }],
    }] } }, 'TST', EXP, 'fixture', 'network', null);
    const before = structuredClone(chain);
    const option = chain.puts[0];
    const dte = asOf === AS_OF ? 45 : 1;
    const row = buildScreenerRows({ initialResults: new Map([['TST', chain]]), chainsByKey: new Map([[`TST:${EXP}`, chain]]), ivVsRealizedRangeByTicker: new Map() }, 'all', { asOf }).rows[0];
    const watch = buildWatchlistRow(mergeWatchlistRefreshItem({ id: 'fixture', ticker: 'TST', optionType: 'put', strike: raw.strike, expiry: EXPIRY, expiryTimestamp: EXP, createdAt: Date.parse(asOf), updatedAt: Date.parse(asOf) }, chain, chain.currentPrice, false));
    const drawer = buildOptionDrawerQuoteState({ ...option, integrityStatus: option.integrity.status }, asOf);
    assert.equal(row.dte, dte);
    assert.equal(watch.dte, dte);
    assert.deepEqual(drawer.defaultSoldPrice, { basis: 'last', value: raw.lastPrice });
    if (name.startsWith('D')) assert.notEqual(drawer.lastTradeFreshness.freshness, 'recent');
    if (name.startsWith('E')) assert.equal(drawer.lastTradeFreshness.ageSessions, null);
    for (const [basis, price] of [['Bid', raw.bid], ['Ask', raw.ask], ['Last', raw.lastPrice]]) {
      // No Bid is unavailable executable credit, although arithmetic NY(0) is zero.
      const expected = price > 0 ? price / raw.strike : null;
      if (expected == null) {
        assert.equal(row[`nomYield${basis}`], null);
        assert.equal(watch[`annYield${basis}`], null);
        continue;
      }
      const annualized = expected * 365 / dte;
      for (const surface of [row, watch]) {
        near(surface[`nomYield${basis}`], expected * 100, `${basis} NY points`);
        near(surface[`annYield${basis}`], annualized * 100, `${basis} AY points`);
      }
      near(calculateAnnualizedYield(drawer[`trusted${basis}`], raw.strike, dte), annualized, `${basis} Drawer AY fraction`);
      assert.equal(formatPercent(annualized), formatPercentPoints(row[`annYield${basis}`]));
    }
    if (raw.bid > 0) near(drawer.mid, (raw.bid + raw.ask) / 2, 'Mid full precision');
    else assert.equal(drawer.mid, null);
    const metrics = calculatePositionMetrics({ strike: raw.strike, soldPrice: drawer.defaultSoldPrice.value, contracts: 3, dte, underlyingPrice: chain.currentPrice });
    near(metrics.totalPremium, raw.lastPrice * 300, 'Drawer premium');
    near(metrics.breakeven, raw.strike - raw.lastPrice, 'breakeven');
    near(metrics.downsideCushion, (chain.currentPrice - raw.strike + raw.lastPrice) / chain.currentPrice, 'cushion fraction');
    near(row.moneynessPct, (chain.currentPrice - raw.strike) / chain.currentPrice * 100, 'moneyness points');
    assert.equal(row.moneynessPct, watch.moneynessPct);
    assert.equal(row.moneynessLabel, watch.moneynessLabel, 'canonical display rounding');
    const portfolio = { strike: raw.strike, soldPrice: raw.lastPrice, latestMarketData: { underlyingPrice: chain.currentPrice } };
    near(calculateDistanceToStrike(portfolio) * 100, row.moneynessPct, 'distance units');
    near(calculateDistanceToBreakeven(portfolio), metrics.downsideCushion, 'cushion and entry distance');
    near(row.iv, raw.impliedVolatility * 100, 'provider IV fraction to points');
    assert.equal(watch.iv, row.iv);
    const expectedDelta = raw.delta ?? calculatePutDelta(chain.currentPrice, raw.strike, dte / 365, 0.045, raw.impliedVolatility);
    near(row.delta, expectedDelta, 'Delta');
    assert.equal(watch.delta, row.delta);
    assert.equal(row.deltaSource, raw.delta == null ? 'calculated' : 'provider');
    assert.equal(watch.deltaSource, row.deltaSource);
    const pricing = discoverContractPricing({ strike: raw.strike, dte, chain, asOf });
    assert.equal(pricing.directBid, raw.bid > 0 ? raw.bid : null, 'Recommendations uses Bid, never Last as executable credit');
    assert.equal(pricing.last, raw.lastPrice);
    if (name.startsWith('B')) assert.notEqual(row.annYieldLast, calculateYieldPercent(Number(raw.lastPrice.toFixed(2)), raw.strike, dte).annualized);
    assert.deepEqual(chain, before, 'derived surfaces do not rewrite provider evidence');
  });
}

test('market midnight, DST, expiration and provider/calculated Delta boundaries', () => {
  for (const [asOf, expected] of [['2026-10-16T03:59:59Z', 1], ['2026-10-16T04:00:00Z', 0], ['2026-10-17T04:00:00Z', -1]]) {
    assert.equal(calculateDte(EXPIRY, asOf), expected);
    assert.equal(calculateRemainingDte({ expiration: EXPIRY }, asOf), Math.max(0, expected));
    if (expected <= 0) assert.equal(calculateAnnualizedYield(1.234567, 50.125, expected), null);
  }
  assert.equal(calculateDte('2026-03-09', '2026-03-08T04:59:59Z'), 2);
  assert.equal(calculateDte('2026-03-09', '2026-03-08T05:00:00Z'), 1);
  assert.equal(calculateDte('2026-11-02', '2026-11-01T04:00:00Z'), 1);
  const delta = { providerDelta: -0.2, underlyingPrice: 55, strike: 50, dte: 0, impliedVolatilityPercent: 60 };
  assert.equal(resolvePutDeltaWithSource(delta).source, 'provider');
  assert.equal(resolvePutDeltaWithSource({ ...delta, providerDelta: null }), null);
  assert.equal(resolvePutDeltaWithSource({ ...delta, dte: -1 }), null);
  for (const iv of [null, 0, -1, NaN]) assert.equal(resolvePutDeltaWithSource({ ...delta, providerDelta: null, dte: 1, impliedVolatilityPercent: iv }), null);
});

test('invalid and valuation-only Last never become Drawer defaults; Bid fallback is precise', () => {
  const quote = { last: 1.34567891, bid: 1.23456789, ask: 1.45678912 };
  assert.equal(buildOptionDrawerQuoteState({ ...quote, integrityStatus: 'invalid' }).defaultSoldPrice, null);
  assert.deepEqual(buildOptionDrawerQuoteState({ ...quote, lastFallbackOnly: true }).defaultSoldPrice, { basis: 'bid', value: quote.bid });
  assert.equal(buildOptionDrawerQuoteState({ ...quote, bid: 0, lastFallbackOnly: true }).defaultSoldPrice, null);
  assert.equal(buildOptionDrawerQuoteState({ ...quote, last: null, bid: null }).defaultSoldPrice, null);
});

test('Recommendation candidate economics consume full-precision canonical Bid facts', () => {
  const snapshot = buildRecommendationScaleSnapshot(1, 3);
  for (const { data } of snapshot.chains) {
    data.puts = data.puts.map(put => ({ ...put, bid: put.bid + 0.003456789, ask: put.ask + 0.003456789, last: put.last + 0.087654321 }));
  }
  const chainsByKey = new Map(snapshot.chains.map(chain => [`${chain.ticker}:${chain.expiration}`, chain.data]));
  const first = snapshot.chains[0];
  snapshot.screenerRows = buildScreenerRows({
    initialResults: new Map([[first.ticker, first.data]]), chainsByKey, ivVsRealizedRangeByTicker: new Map(),
    expirationPlansByTicker: new Map([[first.ticker, { selectedExpirationDates: snapshot.chains.map(chain => chain.expiration) }]]),
  }, 'all', { asOf: snapshot.asOf }).rows;
  const run = runRecommendationEngine(snapshot);
  assert.ok(run.candidates.length > 0);
  for (const candidate of run.candidates) {
    const row = candidate.canonicalRow, economics = candidate.economics;
    assert.equal(candidate.pricing.directBid, row.bid);
    near(economics.nominalYieldBidPct, row.bid / row.strike * 100, 'Recommendation NY points');
    near(economics.annualizedYieldBidPct, row.bid / row.strike * 365 / row.dte * 100, 'Recommendation AY points');
    near(economics.breakevenAtBasis, row.strike - row.bid, 'Bid breakeven');
    near(economics.breakevenCushionAtBasis, (row.currentPrice - row.strike + row.bid) / row.currentPrice, 'Bid cushion');
    assert.equal(economics.delta, row.delta);
    assert.equal(economics.ivPct, row.iv);
    assert.notEqual(economics.annualizedYieldBidPct, row.annYieldLast);
  }
});

test('consumer wiring preserves raw quote state and canonical yield/Greek boundaries', () => {
  const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
  const drawer = read('src/components/OptionDetailDrawer.tsx');
  assert.match(drawer, /setSoldPrice\(defaultPrice != null \? String\(defaultPrice.value\)/);
  assert.match(drawer, /setSoldPrice\(String\(executable\)\)/);
  assert.match(drawer, /calculateAnnualizedSecuredCashYield\(activeSoldPrice, option.strike, dte\)/);
  const chain = read('src/pages/OptionsPage.tsx');
  for (const basis of ['bid', 'ask', 'last']) assert.ok(chain.includes(`calculateYieldPercent(trustedOptionPrice(p, '${basis}'), p.strike, dte)`));
  assert.match(chain, /calculateMoneyness\(currentPrice, p.strike\)/);
  assert.match(chain, /resolvePutDeltaWithSource\(/);
  assert.match(chain, /impliedVolatilityPercent:.*p.impliedVolatility/);
  assert.equal(calculateBreakeven(50.125, 1.23456789), 50.125 - 1.23456789);
  assert.equal(calculateMoneyness(57.12345678, 50.125).pct, (57.12345678 - 50.125) / 57.12345678 * 100);
});

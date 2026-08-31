import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  calculateAnnualizedSecuredCashYield,
  calculateBidAskSpread,
  calculateBidAskSpreadPercent,
  calculateBreakeven,
  calculateGrossSecuredCash,
  calculateNetMaximumLossCapital,
  calculatePremiumPerContract,
  calculateSecuredCashYield,
  calculateTotalPremium,
  calculateYieldPercent,
} from '../src/lib/optionMetrics.ts';
import { PUT_METRIC_CONTRACT } from '../src/lib/putMetricContract.ts';
import { OPTION_YIELD_DISPLAY_LABELS } from '../src/lib/optionQuoteDisplay.ts';
import { compareNullableMetric, formatMetric, getMetricAvailability } from '../src/lib/metricValue.ts';
import { calculatePutDelta, resolvePutDelta } from '../src/lib/putDelta.ts';
import {
  calculateNetCapitalAtRisk as calculatePortfolioNetCapitalAtRisk,
  calculateOriginalAnnualizedYield,
  calculatePremiumCollected,
} from '../src/lib/portfolioMetrics.ts';
import { buildScreenerRows } from '../src/lib/screenerRows.ts';
import { normalizeAnalyzeTicker, resolveTickerDetailInstrument } from '../src/lib/tickerDetail.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

test('canonical metric contract preserves formulas while making every denominator explicit', () => {
  assert.equal(PUT_METRIC_CONTRACT.securedCashYield.denominator, 'gross secured cash');
  assert.equal(PUT_METRIC_CONTRACT.entryNominalYield.denominator, 'gross secured cash');
  assert.equal(PUT_METRIC_CONTRACT.currentNominalYield.denominator, 'gross secured cash');
  assert.equal(PUT_METRIC_CONTRACT.annualizedRemainingPremiumOnCurrentNetRisk.denominator, 'current net maximum-loss capital');

  assert.equal(calculatePremiumPerContract(2), 200);
  assert.equal(calculateTotalPremium(2, 2), 400);
  assert.equal(calculateGrossSecuredCash(100, 2), 20_000);
  assert.equal(calculateNetMaximumLossCapital(100, 2, 2), 19_600);
  assert.equal(calculateSecuredCashYield(2, 100), 0.02);
  assert.equal(calculateAnnualizedSecuredCashYield(2, 100, 30), 0.02 * 365 / 30);
  assert.equal(calculateBreakeven(100, 2), 98);
  assert.equal(calculateBidAskSpread(2, 2.5), 0.5);
  assert.equal(calculateBidAskSpreadPercent(2, 2.5), 0.5 / 2.25);
});

test('yield and risk labels use the restored NY/AY nomenclature', () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(PUT_METRIC_CONTRACT).map(([key, value]) => [key, value.label])),
    {
      premiumPerContract: 'Premium per Contract',
      grossSecuredCash: 'Gross Risk',
      netMaximumLossCapital: 'Net Risk',
      securedCashYield: 'Nominal Yield',
      annualizedSecuredCashYield: 'Annualized Yield',
      entryNominalYield: 'Entry NY',
      entryAnnualizedYield: 'Entry AY',
      currentNominalYield: 'Current NY',
      currentAnnualizedYield: 'Current AY',
      annualizedRemainingPremiumOnCurrentNetRisk: 'Remaining AY to Maturity',
    },
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(OPTION_YIELD_DISPLAY_LABELS).map(([key, value]) => [key, value.short])),
    {
      nomYieldLast: 'NY Last',
      annYieldLast: 'AY Last',
      nomYieldBid: 'NY Bid',
      annYieldBid: 'AY Bid',
      nomYieldAsk: 'NY Ask',
      annYieldAsk: 'AY Ask',
    },
  );
  assert.deepEqual(
    Object.fromEntries(Object.entries(OPTION_YIELD_DISPLAY_LABELS).map(([key, value]) => [key, value.full])),
    {
      nomYieldLast: 'Nominal Yield (Last): premium ÷ gross strike cash',
      annYieldLast: 'Annualized Yield (Last): Nominal Yield × 365 ÷ DTE',
      nomYieldBid: 'Nominal Yield (Bid): premium ÷ gross strike cash',
      annYieldBid: 'Annualized Yield (Bid): Nominal Yield × 365 ÷ DTE',
      nomYieldAsk: 'Nominal Yield (Ask): premium ÷ gross strike cash',
      annYieldAsk: 'Annualized Yield (Ask): Nominal Yield × 365 ÷ DTE',
    },
  );
});

test('current UI surfaces contain canonical labels and no retired metric copy', async () => {
  const sources = await Promise.all([
    read('src/pages/OptionsPage.tsx'),
    read('src/pages/ScreenerPage.tsx'),
    read('src/pages/WatchlistPage.tsx'),
    read('src/pages/PortfolioPage.tsx'),
    read('src/components/OptionDetailDrawer.tsx'),
    read('src/components/mobile/MobileOptionRow.tsx'),
  ]);
  const currentUi = sources.join('\n');
  assert.match(currentUi, /Show Nominal Yield/);
  assert.match(currentUi, /Gross Risk/);
  assert.match(currentUi, /Net Risk/);
  assert.match(currentUi, /Entry Wtd\. Avg\. AY/);
  assert.match(currentUi, /Current Wtd\. Avg\. AY/);
  assert.doesNotMatch(currentUi, /Secured-Cash Yield|Ann\. SCY|Net Maximum-Loss Capital|Net-Risk Return|Remaining Liability \/ Entry Net Risk/);
});

test('the same deterministic contract reconciles discovery, Screener, drawer, and Portfolio economics', () => {
  const expiration = 1_800_576_000;
  const chain = {
    expirations: [{ date: expiration, label: 'Fixture', dte: 30 }],
    currentPrice: 110,
    puts: [{ strike: 100, last: 2.2, lastTradeDate: 1_799_000_000, bid: 2, ask: 2.5, delta: -0.2, impliedVolatility: 40, volume: 10, openInterest: 100 }],
  };
  const rows = buildScreenerRows({
    initialResults: new Map([['TST', chain]]),
    chainsByKey: new Map([['TST:1800576000', chain]]),
    ivVsRealizedRangeByTicker: new Map([['TST', 42]]),
  }, 'all').rows;
  assert.equal(rows.length, 1);
  assert.deepEqual(
    { nominal: rows[0].nomYieldBid, annualized: rows[0].annYieldBid },
    calculateYieldPercent(2, 100, 30),
  );

  const trade = { ticker: 'TST', optionType: 'put', strike: 100, expiration: '2026-01-31', contracts: 2, soldPrice: 2, soldDate: '2026-01-01', status: 'open' };
  assert.equal(calculatePremiumCollected(trade), 400);
  assert.equal(calculatePortfolioNetCapitalAtRisk(trade), 19_600);
  assert.equal(calculateOriginalAnnualizedYield(trade), 400 / 20_000 * 365 / 30);
  assert.equal(rows[0].annYieldBid / 100, calculateOriginalAnnualizedYield(trade), 'equivalent price bases use the same Gross Risk denominator');
});

test('missing-value semantics distinguish zero, unavailable, stale, and loading', () => {
  assert.equal(formatMetric(0, value => String(value)), '0');
  assert.equal(formatMetric(null, value => String(value)), '—');
  assert.equal(formatMetric(5, value => String(value), { stale: true }), '5 (stale)');
  assert.equal(formatMetric(undefined, value => String(value), { loaded: false }), 'Loading…');
  assert.equal(getMetricAvailability(Number.NaN), 'unavailable');
  assert.equal(getMetricAvailability(0), 'available');
});

test('unavailable and non-finite values sort last in both directions with stable ties', () => {
  const fixture = [
    { id: 'missing-a', value: null },
    { id: 'five-a', value: 5 },
    { id: 'nan', value: Number.NaN },
    { id: 'zero', value: 0 },
    { id: 'five-b', value: 5 },
    { id: 'missing-b', value: undefined },
  ];
  const ascending = [...fixture].sort((a, b) => compareNullableMetric(a.value, b.value, 'asc'));
  const descending = [...fixture].sort((a, b) => compareNullableMetric(a.value, b.value, 'desc'));
  assert.deepEqual(ascending.map(item => item.id), ['zero', 'five-a', 'five-b', 'missing-a', 'nan', 'missing-b']);
  assert.deepEqual(descending.map(item => item.id), ['five-a', 'five-b', 'zero', 'missing-a', 'nan', 'missing-b']);
});

test('Delta uses provider values or complete valid model inputs and never fabricates invalid fallbacks', () => {
  const fallback = calculatePutDelta(100, 95, 30 / 365, 0.045, 0.4);
  assert.ok(fallback != null && fallback < 0 && fallback >= -1);
  assert.equal(resolvePutDelta({ providerDelta: -0.22, underlyingPrice: null, strike: 95, dte: 30, impliedVolatilityPercent: 40 }), -0.22);
  assert.equal(resolvePutDelta({ providerDelta: 0.22, underlyingPrice: 100, strike: 95, dte: 30, impliedVolatilityPercent: 40 }), -0.22);
  assert.equal(resolvePutDelta({ providerDelta: null, underlyingPrice: 100, strike: 95, dte: 30, impliedVolatilityPercent: 40 }), fallback);
  assert.equal(resolvePutDelta({ providerDelta: null, underlyingPrice: null, strike: 95, dte: 30, impliedVolatilityPercent: 40 }), null);
  assert.equal(resolvePutDelta({ providerDelta: null, underlyingPrice: 0, strike: 95, dte: 30, impliedVolatilityPercent: 40 }), null);
  assert.equal(resolvePutDelta({ providerDelta: null, underlyingPrice: -1, strike: 95, dte: 30, impliedVolatilityPercent: 40 }), null);
  assert.equal(resolvePutDelta({ providerDelta: null, underlyingPrice: 100, strike: 95, dte: 30, impliedVolatilityPercent: null }), null);
  assert.equal(resolvePutDelta({ providerDelta: null, underlyingPrice: 100, strike: 95, dte: 0, impliedVolatilityPercent: 40 }), null);
  assert.equal(resolvePutDelta({ providerDelta: -0.5, underlyingPrice: 100, strike: 95, dte: 0, impliedVolatilityPercent: 40 }), -0.5);
  assert.equal(resolvePutDelta({ providerDelta: 0, underlyingPrice: 100, strike: 95, dte: 0, impliedVolatilityPercent: 40 }), 0);
  assert.equal(resolvePutDelta({ providerDelta: -0.5, underlyingPrice: 100, strike: 95, dte: -1, impliedVolatilityPercent: 40 }), null);
  assert.equal(calculatePutDelta(Number.NaN, 95, 30 / 365, 0.045, 0.4), null);
});

test('Analyze Ticker normalization preserves meaningful punctuation and asset capabilities are safe', () => {
  assert.deepEqual(normalizeAnalyzeTicker(' NvDa '), { ticker: 'NVDA', error: null });
  assert.deepEqual(normalizeAnalyzeTicker('brk-b'), { ticker: 'BRK-B', error: null });
  assert.deepEqual(normalizeAnalyzeTicker('^vix'), { ticker: '^VIX', error: null });
  assert.equal(normalizeAnalyzeTicker('bad/ticker').ticker, null);

  const leveraged = resolveTickerDetailInstrument('TQQQ');
  assert.deepEqual({ assetType: leveraged.assetType, leveraged: leveraged.leveraged, holdings: leveraged.showHoldings, leverage: leveraged.showLeverage }, { assetType: 'etf', leveraged: true, holdings: true, leverage: true });
  const normalEtf = resolveTickerDetailInstrument('SPY');
  assert.deepEqual({ assetType: normalEtf.assetType, leveraged: normalEtf.leveraged, holdings: normalEtf.showHoldings, leverage: normalEtf.showLeverage }, { assetType: 'etf', leveraged: false, holdings: true, leverage: false });
  const stock = resolveTickerDetailInstrument('NVDA', { name: 'NVIDIA Corporation', quoteType: 'EQUITY' });
  assert.deepEqual({ assetType: stock.assetType, name: stock.name, holdings: stock.showHoldings, leverage: stock.showLeverage }, { assetType: 'stock', name: 'NVIDIA Corporation', holdings: false, leverage: false });
  const unknown = resolveTickerDetailInstrument('XYZ', { name: 'Example', quoteType: null });
  assert.deepEqual({ assetType: unknown.assetType, holdings: unknown.showHoldings, leverage: unknown.showLeverage }, { assetType: 'unknown', holdings: false, leverage: false });
});

test('Analyze Ticker is explicit, transient, refresh-safe, and detail acquisition is bounded', async () => {
  const [form, home, options, endpoint, chart] = await Promise.all([
    read('src/components/AnalyzeTickerForm.tsx'),
    read('src/pages/HomePage.tsx'),
    read('src/pages/OptionsPage.tsx'),
    read('api/ticker-detail.js'),
    read('src/components/InteractivePriceChartModal.tsx'),
  ]);
  assert.match(form, /onSubmit=/);
  assert.match(form, /navigate\(`\/options\/\$\{encodeURIComponent\(normalized\.ticker\)\}`\)/);
  assert.doesNotMatch(form, /fetch\(|supabase|localStorage|addToWatchlist|addPortfolioTrade/i);
  assert.doesNotMatch(form, /onFocus|onMouseEnter|onPointerEnter/);
  assert.ok((home.match(/<AnalyzeTickerForm/g) ?? []).length >= 2, 'desktop and phone Scanner layouts expose the same explicit entry point');
  assert.match(form, /min-h-11/);
  assert.match(form, /text-base/);

  assert.match(options, /fetchTickerDetail\(ticker, requestedExpiry \?\? undefined/);
  assert.doesNotMatch(options, /fetchExtendedPrice|fetchVolatilityContext/);
  assert.match(options, /fetchOptions\(ticker, expDate/);
  assert.match(endpoint, /fetchYahooVolatilityContext\(ticker, \{ optionData: options/);
  assert.equal((endpoint.match(/await fetchYahooOptions\(/g) ?? []).length, 1, 'one initial chain is acquired and reused');
  assert.doesNotMatch(endpoint, /SCREENER_TICKERS|SCANNER_SYMBOLS|mapWithConcurrency|\.map\(\s*(?:async\s*)?\(?\s*ticker/i);
  assert.match(chart, /showLeverageContext && <div/);
});

test('product copy removes conventional IV Rank claims and names every yield denominator', async () => {
  const [options, screener, drawer, portfolio, labels, metricContract] = await Promise.all([
    read('src/pages/OptionsPage.tsx'),
    read('src/pages/ScreenerPage.tsx'),
    read('src/components/OptionDetailDrawer.tsx'),
    read('src/pages/PortfolioPage.tsx'),
    read('src/lib/optionQuoteDisplay.ts'),
    read('src/lib/putMetricContract.ts'),
  ]);
  assert.match(options, /IV vs 1Y Realized Range/);
  assert.match(screener, /IV vs 1Y Realized Range/);
  assert.doesNotMatch(options, />IV Rank</);
  assert.doesNotMatch(screener, />IV Rank</);
  assert.match(options, /not traditional historical IV Rank/);
  assert.match(drawer, /Gross Risk/);
  assert.match(drawer, /Net Risk/);
  assert.match(drawer, /Annualized Yield/);
  assert.doesNotMatch(drawer, /Net-Risk Return/);
  assert.doesNotMatch(drawer, /Annualized Net-Risk Return/);
  assert.match(portfolio, /Entry AY/);
  assert.match(portfolio, /Current AY/);
  assert.match(labels, /PUT_METRIC_CONTRACT/);
  assert.match(metricContract, /Nominal Yield/);
  assert.match(metricContract, /Annualized Yield/);
});

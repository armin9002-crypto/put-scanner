import assert from 'node:assert/strict';
import test from 'node:test';
import { accountStateStorage } from '../src/lib/cloudState/accountStateStorage.ts';
import {
  buildPortfolioHistoricalCsvExport,
  PORTFOLIO_HISTORICAL_CSV_COLUMNS,
} from '../src/lib/portfolioHistoricalCsvExport.ts';
import { REQUEST_BUDGET_LEDGER } from '../src/lib/requestBudgets.ts';
import {
  historyDaysHeld,
  historyFinalValue,
  historyPercentCaptured,
  historyRealizedIrr,
  historyRealizedPnl,
} from '../src/lib/portfolioHistoryAnalytics.ts';
import {
  calculateCurrentAnnualizedYield,
  calculateCurrentNominalYield,
  calculateCurrentOptionMark,
  calculateCurrentPositionValue,
  calculateDistanceToBreakeven,
  calculateDistanceToStrike,
  calculateEquityAtRisk,
  calculateNetCapitalAtRisk,
  calculateOriginalAnnualizedYield,
  calculateOriginalDte,
  calculateOriginalNominalYield,
  calculatePercentCaptured,
  calculatePremiumCollected,
  calculateTotalGainLoss,
} from '../src/lib/portfolioMetrics.ts';
import { readPortfolioTrades, writePortfolioTrades } from '../src/lib/portfolioStorage.ts';

const expectedColumns = [
  'Ticker', 'Expiration', 'Strike', 'Contracts', 'Sold Price (Net)', 'Sold Date', 'Delta at Entry', 'IV at Entry',
  'Status', 'Outcome', 'Close Date', 'Close price', 'Underlying Price at Expiration / Contract Close',
  'Trade/Lot ID', 'Option Type', 'Contract Key', 'Lifecycle State', 'Resolution Type', 'Resolution Source',
  'Resolution Warning', 'Notes', 'Original DTE', 'Entry Delta Source', 'Entry Delta Captured At', 'Entry IV Source',
  'Entry IV Captured At', 'Entry VIX', 'Entry VIX Date', 'Entry VIX Source', 'Notional', 'Premium Collected',
  'Entry Nominal Yield', 'Entry Annualized Yield', 'Breakeven at Entry', 'Net Capital at Risk', 'Final Option Value',
  'Realized P&L', 'Percent Captured', 'Days Held', 'Realized IRR', 'Current Underlying Price', 'Current DTE',
  'Current Option Bid', 'Current Option Mid', 'Current Option Ask', 'Current Option Last', 'Last Trade Date',
  'Current Delta', 'Current IV', 'Volume', 'Open Interest', 'Current Mark Basis', 'Current Option Mark',
  'Current Position Value', 'Current Gain / Loss', 'Current Percent Captured', 'Current Nominal Yield',
  'Current Annualized Yield', 'Distance to Strike', 'Distance to Breakeven', 'Availability Status',
  'Market Data Refreshed At', 'Provider Market At', 'Provider Quote At', 'Cache Timestamp', 'Timestamp Source',
];

function trade(overrides = {}) {
  return {
    id: 'open-one',
    ticker: 'TST',
    optionType: 'put',
    strike: 70,
    expiration: '2027-01-15',
    contracts: 1,
    soldPrice: 1.5,
    soldDate: '2026-08-01',
    status: 'open',
    notes: '',
    entryDelta: -0.08,
    entryDeltaSource: 'provider',
    entryDeltaCapturedAt: '2026-08-01T15:00:00.000Z',
    entryIv: 42.5,
    entryIvSource: 'provider',
    entryIvCapturedAt: '2026-08-01T15:00:00.000Z',
    entryVixClose: 18.75,
    entryVixDate: '2026-08-01',
    entryVixSource: 'historical_close',
    createdAt: '2026-08-01T15:00:00.000Z',
    updatedAt: '2026-08-01T15:00:00.000Z',
    latestMarketData: {
      underlyingPrice: 80,
      optionBid: 0.4,
      optionAsk: 0.6,
      optionLast: 0.55,
      lastTradeDate: '2026-09-04T19:45:00.000Z',
      delta: -0.08,
      iv: 39.25,
      volume: 0,
      openInterest: 125,
      refreshedAt: '2026-09-04T20:00:00.000Z',
      providerMarketAt: '2026-09-04T19:59:00.000Z',
      providerQuoteAt: '2026-09-04T19:58:00.000Z',
      cachedAt: '2026-09-04T20:00:30.000Z',
      timestampSource: 'provider_quote',
      availabilityStatus: 'live',
    },
    ...overrides,
  };
}

function fixtureLots() {
  return [
    trade(),
    trade({
      id: 'open-two', soldDate: '2026-08-08', soldPrice: 1.75, contracts: 2, latestMarketData: undefined,
      entrySnapshot: { underlyingPrice: 75 },
    }),
    trade({
      id: 'expired', ticker: 'OLD', strike: 40, expiration: '2025-06-20', contracts: 1, soldPrice: 1.5, soldDate: '2025-05-01',
      status: 'expired', resolutionType: 'expired_worthless', resolutionSource: 'manual_expiration_close',
      expirationClosePrice: 50, expirationCloseDate: '2025-06-20', closePrice: 0, closeDate: '2025-06-20',
      latestMarketData: { underlyingPrice: 999, optionBid: 9, refreshedAt: '2026-09-04T20:00:00.000Z', availabilityStatus: 'stale' },
    }),
    trade({
      id: 'closed', ticker: 'CLS', strike: 70, expiration: '2025-07-18', contracts: 2, soldPrice: 1.5, soldDate: '2025-05-02',
      status: 'closed', closeDate: '2025-06-10', closePrice: 0.5, closeUnderlyingPrice: 72, closeUnderlyingPriceSource: 'imported',
      notes: '  =SUM(1,2)\n"review, safely"', latestMarketData: { optionBid: 8, availabilityStatus: 'stale' },
    }),
    trade({
      id: 'assigned', ticker: 'ASN', strike: 60, expiration: '2025-08-15', contracts: 1, soldPrice: 2, soldDate: '2025-07-01',
      status: 'assigned', resolvedDate: '2025-08-01', realizedPnl: -1_000, finalOptionValue: 1_200,
      entryDelta: -0.35, latestMarketData: undefined,
    }),
  ];
}

const column = name => expectedColumns.indexOf(name);

function parseCsv(csv) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 1; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\r' && csv[index + 1] === '\n') { row.push(field); rows.push(row); row = []; field = ''; index += 1; }
    else field += char;
  }
  return rows;
}

test('historical CSV exports one row per canonical lot with the exact ordered schema and truthful lifecycle fields', () => {
  const lots = fixtureLots();
  const output = buildPortfolioHistoricalCsvExport(lots, 'bid', new Date('2026-09-05T12:00:00.000Z'));
  assert.deepEqual(PORTFOLIO_HISTORICAL_CSV_COLUMNS, expectedColumns);
  assert.equal(output.rows.length, 5);
  assert.equal(output.rows.every(row => row.length === expectedColumns.length), true);
  assert.deepEqual(output.summary, { openLots: 2, resolvedLots: 3, totalLots: 5, currentMarketCoveredLots: 1 });
  assert.equal(output.filename, 'put-scanner-portfolio-2026-09-05.csv');

  const [firstOpen, secondOpen, expired, closed, assigned] = output.rows;
  assert.equal(firstOpen[column('Contract Key')], secondOpen[column('Contract Key')]);
  assert.notEqual(firstOpen[column('Trade/Lot ID')], secondOpen[column('Trade/Lot ID')]);
  assert.deepEqual([firstOpen[column('Status')], firstOpen[column('Outcome')], firstOpen[column('Close Date')], firstOpen[column('Close price')], firstOpen[column('Underlying Price at Expiration / Contract Close')]], ['Open', '', null, null, null]);
  assert.equal(firstOpen.slice(column('Final Option Value'), column('Current Underlying Price')).every(value => value == null), true, 'open lots leave resolution economics blank');
  assert.deepEqual([expired[column('Status')], expired[column('Outcome')], expired[column('Close price')], expired[column('Underlying Price at Expiration / Contract Close')]], ['Held to Expiration', 'Expired Worthless', null, 50]);
  assert.deepEqual([closed[column('Status')], closed[column('Outcome')], closed[column('Close Date')], closed[column('Close price')], closed[column('Underlying Price at Expiration / Contract Close')]], ['Closed / Bought Back', 'Closed Manually', '2025-06-10', 0.5, 72]);
  assert.deepEqual([assigned[column('Status')], assigned[column('Outcome')], assigned[column('Close Date')]], ['Resolved', 'Assigned', '2025-08-01']);
  for (const resolved of [expired, closed, assigned]) {
    assert.equal(resolved.slice(column('Current Underlying Price')).every(value => value == null), true, 'resolved lots fail closed for every current-market field');
  }
});

test('historical CSV reuses canonical entry, realized, and selected-mark calculations at raw precision', () => {
  const lots = fixtureLots();
  const output = buildPortfolioHistoricalCsvExport(lots, 'bid');
  const open = output.rows[0];
  const expired = output.rows[2];
  const closed = output.rows[3];

  assert.equal(open[column('Notional')], calculateEquityAtRisk(lots[0]));
  assert.equal(open[column('Premium Collected')], calculatePremiumCollected(lots[0]));
  assert.equal(open[column('Entry Nominal Yield')], calculateOriginalNominalYield(lots[0]) * 100);
  assert.equal(open[column('Entry Annualized Yield')], calculateOriginalAnnualizedYield(lots[0]) * 100);
  assert.equal(open[column('Original DTE')], calculateOriginalDte(lots[0]));
  assert.equal(open[column('Breakeven at Entry')], 68.5);
  assert.equal(open[column('Net Capital at Risk')], calculateNetCapitalAtRisk(lots[0]));
  assert.equal(open[column('Current Mark Basis')], 'bid');
  assert.equal(open[column('Current Option Mark')], calculateCurrentOptionMark(lots[0], 'bid'));
  assert.equal(open[column('Current Option Mid')], 0.5);
  assert.equal(open[column('Current Position Value')], calculateCurrentPositionValue(lots[0], 'bid'));
  assert.equal(open[column('Current Gain / Loss')], calculateTotalGainLoss(lots[0], 'bid'));
  assert.equal(open[column('Current Percent Captured')], calculatePercentCaptured(lots[0], 'bid') * 100);
  assert.equal(open[column('Current Nominal Yield')], calculateCurrentNominalYield(lots[0], 'bid') * 100);
  assert.equal(open[column('Current Annualized Yield')], calculateCurrentAnnualizedYield(lots[0], 'bid') * 100);
  assert.equal(open[column('Distance to Strike')], calculateDistanceToStrike(lots[0]) * 100);
  assert.equal(open[column('Distance to Breakeven')], calculateDistanceToBreakeven(lots[0]) * 100);
  assert.equal(open[column('Volume')], 0, 'a real numeric zero remains zero');
  assert.equal(open[column('Last Trade Date')], '2026-09-04T19:45:00.000Z');
  assert.deepEqual(open.slice(column('Availability Status')), ['live', '2026-09-04T20:00:00.000Z', '2026-09-04T19:59:00.000Z', '2026-09-04T19:58:00.000Z', '2026-09-04T20:00:30.000Z', 'provider_quote']);

  assert.equal(expired[column('Final Option Value')], historyFinalValue(lots[2]));
  assert.equal(expired[column('Realized P&L')], historyRealizedPnl(lots[2]));
  assert.equal(expired[column('Percent Captured')], historyPercentCaptured(lots[2]) * 100);
  assert.equal(expired[column('Days Held')], historyDaysHeld(lots[2]));
  assert.equal(expired[column('Realized IRR')], historyRealizedIrr(lots[2]) * 100);
  assert.equal(closed[column('Realized IRR')], historyRealizedIrr(lots[3]) * 100);
  assert.equal(output.rows[1][column('Current Option Bid')], null, 'missing quotes remain blank, not zero');
  assert.equal(output.rows[1][column('Distance to Strike')], null, 'entry-snapshot fallback does not leak into current-only export fields');
  assert.equal(output.rows[1][column('Distance to Breakeven')], null, 'entry-snapshot fallback does not leak into current-only export fields');
});

test('CSV encoding is BOM/CRLF safe, neutralizes spreadsheet formulas, and performs no request or durable mutation', () => {
  const lots = fixtureLots();
  accountStateStorage.replace([], true);
  assert.equal(writePortfolioTrades(accountStateStorage, lots).status, 'ok');
  const before = readPortfolioTrades(accountStateStorage);
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error('export must not request data'); };
  try {
    const output = buildPortfolioHistoricalCsvExport(lots, 'ask', new Date('2026-09-05T12:00:00.000Z'));
    assert.equal(output.csv.charCodeAt(0), 0xfeff);
    assert.ok(output.csv.endsWith('\r\n'));
    const parsed = parseCsv(output.csv);
    assert.equal(parsed.length, 6);
    assert.deepEqual(parsed[0], expectedColumns);
    assert.equal(parsed[4][column('Notes')], `'  =SUM(1,2)\n"review, safely"`);
    assert.equal(parsed[1][column('Delta at Entry')], '-0.08', 'negative numeric values remain numeric and receive no apostrophe');
    assert.equal(parsed[2][column('Current Option Bid')], '');
    assert.equal(requests, 0);
    assert.deepEqual(REQUEST_BUDGET_LEDGER['portfolio-historical-csv-export'], {
      expected: { browserRequests: 0, functionInvocations: 0, providerAcquisitions: 0 },
      ceiling: { browserRequests: 0, functionInvocations: 0, providerAcquisitions: 0 },
      providerHttpAttemptCeiling: 0,
      fixture: 'one lot-fidelity CSV built only from currently loaded Portfolio data',
    });
    assert.deepEqual(readPortfolioTrades(accountStateStorage), before);
    assert.deepEqual(lots, fixtureLots(), 'export does not mutate its input lots');
  } finally {
    globalThis.fetch = originalFetch;
    accountStateStorage.lockAndClear();
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { accountStateStorage } from '../src/lib/cloudState/accountStateStorage.ts';
import {
  HISTORICAL_EXCEL_HEADERS,
  IMPORTED_EXPIRATION_PRICE_WARNING,
  enrichHistoricalExcelEntryVix,
  findExactHistoricalPortfolioLotMatches,
  parseHistoricalExcelWorkbook,
  summarizeHistoricalExcelImport,
} from '../src/lib/portfolioHistoricalExcelImport.ts';
import { REQUEST_BUDGET_LEDGER } from '../src/lib/requestBudgets.ts';
import { readPortfolioTrades, toDurablePortfolioState, writePortfolioTrades } from '../src/lib/portfolioStorage.ts';
import { historyPriceAtExpiration, historyRealizedIrr } from '../src/lib/portfolioHistoryAnalytics.ts';

const DAY_MS = 86_400_000;

function serial(date, date1904 = false) {
  const [year, month, day] = date.split('-').map(Number);
  const epoch = Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30);
  return (Date.UTC(year, month - 1, day) - epoch) / DAY_MS;
}

function asArrayBuffer(bytes) {
  return bytes instanceof ArrayBuffer
    ? bytes
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function expiredRow(overrides = {}) {
  const values = {
    ticker: 'XYZ', expiration: '2025-06-20', strike: 40, contracts: 1, soldPrice: 1.5,
    soldDate: '2025-05-01', delta: -0.0712, iv: 0.7954, status: 'Held to Expiration',
    outcome: 'Expired Worthless', closeDate: null, closePrice: 0, underlying: 50,
    ...overrides,
  };
  return [values.ticker, values.expiration, values.strike, values.contracts, values.soldPrice, values.soldDate,
    values.delta, values.iv, values.status, values.outcome, values.closeDate, values.closePrice, values.underlying];
}

function closedRow(overrides = {}) {
  const values = {
    ticker: 'ABC', expiration: '2025-07-18', strike: 70, contracts: 2, soldPrice: 1.5,
    soldDate: '2025-05-02', delta: -0.2, iv: 0.42, status: 'Closed / Bought Back',
    outcome: 'Closed Manually', closeDate: '2025-06-10', closePrice: 0.5, underlying: 72,
    ...overrides,
  };
  return [values.ticker, values.expiration, values.strike, values.contracts, values.soldPrice, values.soldDate,
    values.delta, values.iv, values.status, values.outcome, values.closeDate, values.closePrice, values.underlying];
}

function makeWorkbook(rows, options = {}) {
  const startRow = options.startRow ?? 2;
  const startColumn = options.startColumn ?? 2;
  const date1904 = options.date1904 ?? false;
  const worksheetRows = Array.from({ length: startRow }, () => []);
  const prefix = Array.from({ length: startColumn }, () => null);
  worksheetRows.push([...prefix, ...(options.headers ?? HISTORICAL_EXCEL_HEADERS)]);
  rows.forEach(row => worksheetRows.push([...prefix, ...row.map((value, index) => (
    (index === 1 || index === 5 || index === 10) && typeof value === 'string' ? serial(value, date1904) : value
  ))]));
  const sheet = XLSX.utils.aoa_to_sheet(worksheetRows);
  rows.forEach((row, rowOffset) => {
    [1, 5, 10].forEach(columnOffset => {
      if (row[columnOffset] != null) sheet[XLSX.utils.encode_cell({ r: startRow + 1 + rowOffset, c: startColumn + columnOffset })].z = 'yyyy-mm-dd';
    });
    const ivCell = sheet[XLSX.utils.encode_cell({ r: startRow + 1 + rowOffset, c: startColumn + 7 })];
    if (ivCell) ivCell.z = options.ivFormat ?? '0.00%';
  });
  options.mutateSheet?.(sheet, { headerRow: startRow, headerColumn: startColumn });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, options.sheetName ?? 'Historical Audit');
  for (const extra of options.extraSheets ?? []) XLSX.utils.book_append_sheet(workbook, extra.sheet, extra.name);
  workbook.Workbook = { WBProps: { date1904 } };
  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  return asArrayBuffer(bytes);
}

function ids() {
  let value = 0;
  return () => `import-lot-${++value}`;
}

const parseOptions = () => ({
  nowIso: '2026-09-04T12:00:00.000Z',
  idFactory: ids(),
  stagingSessionId: 'session',
});

test('exact V5 schema is found after leading rows/columns on an arbitrary worksheet and normalizes date, Delta, IV, and economics', async () => {
  const result = await parseHistoricalExcelWorkbook(makeWorkbook([expiredRow(), closedRow()]), 'invented.xlsx', parseOptions());
  assert.equal(result.worksheetName, 'Historical Audit');
  assert.deepEqual([result.headerRowNumber, result.headerColumnNumber, result.dateSystem], [3, 3, '1900']);
  assert.equal(result.formulaCellCount, 0);
  assert.equal(result.rows.length, 2);
  const expired = result.rows[0];
  assert.deepEqual([expired.source.expiration, expired.source.soldDate, expired.source.entryDelta, expired.source.entryIv], ['2025-06-20', '2025-05-01', -0.0712, 79.54]);
  assert.deepEqual([expired.proposedTrade.contracts, expired.proposedTrade.soldPrice], [1, 1.5]);
  assert.deepEqual(
    [expired.proposedTrade.status, expired.proposedTrade.resolutionType, expired.proposedTrade.resolutionSource, expired.proposedTrade.expirationClosePrice],
    ['expired', 'expired_worthless', 'manual_expiration_close', 50],
  );
  assert.equal(expired.proposedTrade.resolutionWarning, IMPORTED_EXPIRATION_PRICE_WARNING);
  assert.equal(expired.proposedTrade.expirationBasisStatus, undefined);
  assert.equal(expired.source.optionClosePrice, 0, 'the source placeholder remains audit-visible');
  assert.equal(expired.proposedTrade.closePrice, 0, 'canonical expiration economics independently produce zero final option value');
  const closed = result.rows[1];
  assert.deepEqual([closed.source.closeDate, closed.source.optionClosePrice, closed.source.underlyingHistoricalPrice], ['2025-06-10', 0.5, 72]);
  assert.equal(closed.proposedTrade.realizedPnl, 200);
  assert.equal(closed.proposedTrade.expirationClosePrice, undefined);
  assert.deepEqual(
    [closed.proposedTrade.closeUnderlyingPrice, closed.proposedTrade.closeUnderlyingPriceSource, historyPriceAtExpiration(closed.proposedTrade)],
    [72, 'imported', 72],
  );
  assert.equal(closed.proposedTrade.latestMarketData, undefined);
});

test('1904 workbook dates remain date-only and timezone-independent', async () => {
  const result = await parseHistoricalExcelWorkbook(makeWorkbook([closedRow()], { date1904: true }), 'date-system.xlsx', parseOptions());
  assert.equal(result.dateSystem, '1904');
  assert.deepEqual(
    [result.rows[0].source.soldDate, result.rows[0].source.closeDate, result.rows[0].source.expiration],
    ['2025-05-02', '2025-06-10', '2025-07-18'],
  );
});

test('manual-close underlying is durable history context and never changes option economics', async () => {
  const first = await parseHistoricalExcelWorkbook(makeWorkbook([closedRow({ underlying: 72 })]), 'first.xlsx', parseOptions());
  const second = await parseHistoricalExcelWorkbook(makeWorkbook([closedRow({ underlying: 90 })]), 'second.xlsx', parseOptions());
  const economicFields = trade => [trade.premiumCollected, trade.realizedPnl, trade.percentCaptured, trade.daysHeld, historyRealizedIrr(trade)];
  assert.deepEqual(economicFields(first.rows[0].proposedTrade), economicFields(second.rows[0].proposedTrade));
  for (const trade of [first.rows[0].proposedTrade, second.rows[0].proposedTrade]) {
    assert.equal(trade.expirationClosePrice, undefined);
    assert.equal(trade.closeUnderlyingPriceSource, 'imported');
    assert.equal(trade.entrySnapshot, undefined);
    assert.equal(trade.importedSnapshot, undefined);
    assert.equal(trade.latestMarketData, undefined);
    assert.equal(trade.notes, '');
  }
  assert.deepEqual([first.rows[0].proposedTrade.closeUnderlyingPrice, second.rows[0].proposedTrade.closeUnderlyingPrice], [72, 90]);
  assert.deepEqual([historyPriceAtExpiration(first.rows[0].proposedTrade), historyPriceAtExpiration(second.rows[0].proposedTrade)], [72, 90]);
  const durable = toDurablePortfolioState([first.rows[0].proposedTrade])[0];
  assert.deepEqual([durable.closeUnderlyingPrice, durable.closeUnderlyingPriceSource], [72, 'imported']);
  assert.equal('latestMarketData' in durable, false);
});

test('expired-worthless contradictions block without provider fallback', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error('must not fetch'); };
  try {
    const valid = await parseHistoricalExcelWorkbook(makeWorkbook([expiredRow({ strike: 40, underlying: 50 })]), 'valid.xlsx', parseOptions());
    const blocked = await parseHistoricalExcelWorkbook(makeWorkbook([expiredRow({ strike: 40, underlying: 35 })]), 'blocked.xlsx', parseOptions());
    assert.equal(valid.rows[0].state, 'ready');
    assert.equal(blocked.rows[0].state, 'blocked');
    assert.ok(blocked.rows[0].issues.some(issue => issue.code === 'worthless_price_contradiction'));
    assert.equal(blocked.rows[0].proposedTrade, null);
    assert.equal(requests, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('required formulas, invalid source prices, ambiguous IV scale, lifecycle mismatch, and date order fail closed', async () => {
  const formula = await parseHistoricalExcelWorkbook(makeWorkbook([expiredRow()], {
    mutateSheet(sheet, location) {
      const address = XLSX.utils.encode_cell({ r: location.headerRow + 1, c: location.headerColumn + 12 });
      sheet[address] = { t: 'n', v: 50, f: '25+25' };
    },
  }), 'formula.xlsx', parseOptions());
  assert.equal(formula.formulaCellCount, 1);
  assert.equal(formula.rows[0].state, 'blocked');
  assert.ok(formula.rows[0].issues.some(issue => issue.code === 'required_formula'));

  for (const value of ['not-a-number', 0, -1, null]) {
    const result = await parseHistoricalExcelWorkbook(makeWorkbook([expiredRow({ underlying: value })]), 'invalid-price.xlsx', parseOptions());
    assert.equal(result.rows[0].state, 'needs_review');
  }
  const iv = await parseHistoricalExcelWorkbook(makeWorkbook([expiredRow()], { ivFormat: '0.0000' }), 'iv.xlsx', parseOptions());
  assert.equal(iv.rows[0].state, 'needs_review');
  const lifecycle = await parseHistoricalExcelWorkbook(makeWorkbook([expiredRow({ outcome: 'Assigned' })]), 'lifecycle.xlsx', parseOptions());
  assert.equal(lifecycle.rows[0].state, 'blocked');
  const dateOrder = await parseHistoricalExcelWorkbook(makeWorkbook([closedRow({ soldDate: '2025-06-11', closeDate: '2025-06-10' })]), 'date-order.xlsx', parseOptions());
  assert.equal(dateOrder.rows[0].state, 'blocked');
  const nonIntegerContracts = await parseHistoricalExcelWorkbook(makeWorkbook([expiredRow({ contracts: 1.5 })]), 'contracts.xlsx', parseOptions());
  assert.ok(nonIntegerContracts.rows[0].issues.some(issue => issue.code === 'invalid_contracts'));
  const invalidSoldPrice = await parseHistoricalExcelWorkbook(makeWorkbook([expiredRow({ soldPrice: 0 })]), 'sold-price.xlsx', parseOptions());
  assert.ok(invalidSoldPrice.rows[0].issues.some(issue => issue.code === 'invalid_sold_price'));
});

test('schema failures reject missing, absent, ambiguous, and macro-enabled inputs', async () => {
  const missingHeaders = [...HISTORICAL_EXCEL_HEADERS];
  missingHeaders[12] = 'Wrong underlying header';
  await assert.rejects(() => parseHistoricalExcelWorkbook(makeWorkbook([expiredRow()], { headers: missingHeaders }), 'missing.xlsx', parseOptions()), /missing or changed.*Underlying Price/s);
  const noSchemaSheet = XLSX.utils.aoa_to_sheet([['unrelated']]);
  const noSchemaBook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(noSchemaBook, noSchemaSheet, 'Notes');
  const noSchemaBytes = XLSX.write(noSchemaBook, { type: 'array', bookType: 'xlsx' });
  await assert.rejects(() => parseHistoricalExcelWorkbook(asArrayBuffer(noSchemaBytes), 'none.xlsx', parseOptions()), /No exact V5/);
  const duplicateSheet = XLSX.utils.aoa_to_sheet([HISTORICAL_EXCEL_HEADERS, expiredRow().map((value, index) => [1, 5].includes(index) ? serial(value) : value)]);
  duplicateSheet.H2.z = '0.00%'; duplicateSheet.B2.z = 'yyyy-mm-dd'; duplicateSheet.F2.z = 'yyyy-mm-dd';
  await assert.rejects(() => parseHistoricalExcelWorkbook(makeWorkbook([expiredRow()], { extraSheets: [{ name: 'Second Match', sheet: duplicateSheet }] }), 'ambiguous.xlsx', parseOptions()), /More than one/);
  await assert.rejects(() => parseHistoricalExcelWorkbook(makeWorkbook([expiredRow()]), 'macro.xlsm', parseOptions()), /\.xlsx files only/);
});

test('lot-aware duplicate matching preserves multiplicity and distinguishes contract matches from lot matches', async () => {
  const distinctLots = await parseHistoricalExcelWorkbook(makeWorkbook([
    expiredRow(),
    expiredRow({ soldDate: '2025-05-02' }),
    expiredRow({ contracts: 2 }),
    expiredRow({ soldPrice: 1.6 }),
  ]), 'distinct-lots.xlsx', parseOptions());
  assert.deepEqual(distinctLots.rows.map(row => row.state), ['ready', 'ready', 'ready', 'ready']);
  assert.equal(distinctLots.rows.slice(1).every(row => row.destination === 'adds_to_imported_contract'), true);

  const firstParse = await parseHistoricalExcelWorkbook(makeWorkbook([
    expiredRow(), expiredRow(), expiredRow({ soldPrice: 1.6 }), closedRow(),
  ]), 'duplicates.xlsx', parseOptions());
  assert.deepEqual(firstParse.rows.slice(0, 2).map(row => row.state), ['possible_duplicate', 'possible_duplicate']);
  assert.equal(firstParse.rows[2].state, 'ready');
  assert.equal(firstParse.rows[2].destination, 'adds_to_imported_contract');
  const existing = [firstParse.rows[0].proposedTrade, { ...firstParse.rows[0].proposedTrade, id: 'existing-two' }];
  const secondParse = await parseHistoricalExcelWorkbook(makeWorkbook([expiredRow(), expiredRow(), expiredRow()]), 'multiplicity.xlsx', { ...parseOptions(), existingTrades: existing });
  assert.deepEqual(secondParse.rows.map(row => row.state), ['possible_existing_duplicate', 'possible_existing_duplicate', 'possible_duplicate']);
  assert.equal(secondParse.rows.every(row => row.destination === 'adds_to_existing_contract'), true);
  const matches = findExactHistoricalPortfolioLotMatches(secondParse.rows.map(row => row.proposedTrade), existing);
  assert.equal(matches.size, 2);

  const manualContext = await parseHistoricalExcelWorkbook(makeWorkbook([
    closedRow({ underlying: 72 }),
    closedRow({ underlying: 73 }),
  ]), 'manual-context.xlsx', parseOptions());
  assert.deepEqual(manualContext.rows.map(row => row.state), ['ready', 'ready']);
  assert.equal(manualContext.rows[1].destination, 'adds_to_imported_contract');

  const baselineClosed = (await parseHistoricalExcelWorkbook(makeWorkbook([closedRow()]), 'baseline-closed.xlsx', parseOptions())).rows[0].proposedTrade;
  const correctedContextExisting = {
    ...baselineClosed,
    id: 'existing-closed',
    closeUnderlyingPrice: 99,
    entryDelta: -0.31,
    entryIv: 91,
  };
  const correctedContextReupload = await parseHistoricalExcelWorkbook(makeWorkbook([closedRow({ underlying: 73, delta: -0.31, iv: 0.91 })]), 'corrected-context-reupload.xlsx', {
    ...parseOptions(),
    existingTrades: [correctedContextExisting],
  });
  assert.equal(correctedContextReupload.rows[0].state, 'possible_existing_duplicate');

  const baselineExpired = (await parseHistoricalExcelWorkbook(makeWorkbook([expiredRow()]), 'baseline-expired.xlsx', parseOptions())).rows[0].proposedTrade;
  const correctedExpirationExisting = { ...baselineExpired, id: 'existing-expired', expirationClosePrice: 51 };
  const correctedExpirationReupload = await parseHistoricalExcelWorkbook(makeWorkbook([expiredRow({ underlying: 51 })]), 'corrected-expiration-reupload.xlsx', {
    ...parseOptions(),
    existingTrades: [correctedExpirationExisting],
  });
  assert.equal(correctedExpirationReupload.rows[0].state, 'possible_existing_duplicate');
});

test('staging and Entry VIX enrichment perform no durable Portfolio mutation', async () => {
  accountStateStorage.replace([], true);
  assert.equal(writePortfolioTrades(accountStateStorage, []).status, 'ok');
  const before = readPortfolioTrades(accountStateStorage);
  const parsed = await parseHistoricalExcelWorkbook(makeWorkbook([expiredRow(), closedRow()]), 'staging.xlsx', parseOptions());
  let resolverCalls = 0;
  const enriched = await enrichHistoricalExcelEntryVix(parsed, async trades => {
    resolverCalls += 1;
    return {
      trades: trades.map(trade => ({ ...trade, entryVixClose: 20, entryVixDate: trade.soldDate, entryVixSource: 'historical_close' })),
      changed: true, networkRequests: 1, resolved: trades.length, unresolved: 0,
    };
  });
  assert.equal(resolverCalls, 1);
  assert.equal(enriched.entryVixNetworkRequests, 1);
  assert.equal(summarizeHistoricalExcelImport(enriched).entryVixEnriched, 2);
  assert.deepEqual(REQUEST_BUDGET_LEDGER['portfolio-historical-excel-import'].ceiling, {
    browserRequests: 1,
    functionInvocations: 1,
    providerAcquisitions: 1,
  });
  assert.deepEqual(readPortfolioTrades(accountStateStorage), before);
  accountStateStorage.lockAndClear();
});

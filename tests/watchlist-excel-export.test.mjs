import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { buildOpenPortfolioContractKeys } from '../src/lib/watchlistPortfolioMembership.ts';
import { buildWatchlistRow } from '../src/lib/watchlistRows.ts';
import {
  buildWatchlistExcelExport,
  buildWatchlistExcelFilename,
  buildWatchlistWorkbook,
  sanitizeWatchlistSpreadsheetText,
  WATCHLIST_EXCEL_COLUMNS,
} from '../src/lib/watchlistExcelExport.ts';

const column = name => WATCHLIST_EXCEL_COLUMNS.indexOf(name);
const dateSeconds = iso => Math.floor(Date.parse(iso) / 1000);
const dateMilliseconds = iso => Date.parse(iso);

function watchlistItem(overrides = {}) {
  const expiry = overrides.expiry ?? '2026-10-16';
  const expiryTimestamp = overrides.expiryTimestamp ?? dateSeconds(`${expiry}T00:00:00.000Z`);
  return {
    id: overrides.id ?? `watch-${overrides.strike ?? 100}`,
    ticker: overrides.ticker ?? 'AAPL',
    expiry,
    expiryTimestamp,
    expiryFormatted: 'Oct 16 \'26',
    strike: overrides.strike ?? 100,
    optionType: 'put',
    addedAt: overrides.addedAt ?? dateMilliseconds('2026-09-18T14:30:00.000Z'),
    savedAt: overrides.savedAt ?? dateMilliseconds('2026-09-18T14:30:00.000Z'),
    updatedAt: overrides.updatedAt ?? dateMilliseconds('2026-09-19T15:00:00.000Z'),
    note: overrides.note ?? 'review next earnings date',
    status: overrides.status ?? 'live',
    snapshot: overrides.snapshot ?? {
      underlyingPrice: 125,
      last: 2.5,
      bid: 2.25,
      ask: 2.75,
      lastTradeDate: dateSeconds('2026-09-18T19:00:00.000Z'),
      delta: -0.052,
      deltaSource: 'calculated',
      deltaModelVersion: 'bs-v1',
      iv: 50,
      volume: 250,
      openInterest: 1000,
      observedAt: dateMilliseconds('2026-09-19T15:00:00.000Z'),
      providerMarketTime: dateSeconds('2026-09-19T14:59:00.000Z'),
      evidenceFreshness: 'current',
      evidenceSource: 'fresh',
      integrityStatus: 'clean',
    },
  };
}

function exportFixture() {
  const unavailableAsk = watchlistItem({
    id: 'watch-aapl-101',
    strike: 101,
    note: '  =SUM(1,2)',
    snapshot: {
      underlyingPrice: 125,
      last: 1.5,
      bid: null,
      ask: null,
      lastTradeDate: dateSeconds('2026-09-01T19:00:00.000Z'),
      delta: -0.31,
      deltaSource: 'provider',
      iv: 75,
      volume: 0,
      openInterest: 0,
      observedAt: dateMilliseconds('2026-09-10T15:00:00.000Z'),
      evidenceFreshness: 'retained-stale',
      evidenceSource: 'snapshot',
      integrityStatus: 'degraded',
    },
  });
  const providerDelta = watchlistItem({
    id: 'watch-msft-95',
    ticker: 'MSFT',
    strike: 95,
    status: 'stale',
    note: 'normal note',
    snapshot: { ...watchlistItem().snapshot, delta: -0.18, deltaSource: 'provider', ask: null },
  });
  return [buildWatchlistRow(watchlistItem()), buildWatchlistRow(unavailableAsk), buildWatchlistRow(providerDelta)];
}

test('Watchlist export includes every row in the effective input order and preserves exact identity', () => {
  const rows = exportFixture();
  const keys = buildOpenPortfolioContractKeys([{
    id: 'portfolio-aapl',
    ticker: 'AAPL',
    optionType: 'put',
    expiration: '2026-10-16',
    strike: 100,
    status: 'open',
  }]);
  const output = buildWatchlistExcelExport(rows, keys, new Date('2026-09-21T15:00:00.000Z'));

  assert.deepEqual(output.rows.map(row => row[column('Ticker')]), ['AAPL', 'AAPL', 'MSFT']);
  assert.equal(output.rows.length, 3);
  assert.equal(output.rows[0][column('Strike')], 100);
  assert.equal(output.rows[1][column('Strike')], 101);
  assert.ok(output.rows[0][column('Expiration')] instanceof Date);
  assert.equal(output.rows[0][column('Expiration')].toISOString().slice(0, 10), '2026-10-16');
  assert.equal(output.rows[0][column('In Open Portfolio')], 'Yes');
  assert.equal(output.rows[1][column('In Open Portfolio')], 'No', 'same ticker with another strike is not an exact match');
  assert.equal(output.rows[2][column('In Open Portfolio')], 'No');
});

test('Watchlist export leaves unavailable values blank, keeps notes literal, and uses Excel-native percentages', () => {
  const rows = exportFixture();
  const output = buildWatchlistExcelExport(rows, new Set(), new Date('2026-09-21T15:00:00.000Z'));
  const first = output.rows[0];
  const stale = output.rows[1];

  assert.equal(first[column('IV')], 0.5);
  assert.equal(first[column('Moneyness %')], 0.2);
  assert.equal(first[column('Nominal Yield Last')], 0.025);
  assert.equal(first[column('Volume / Open Interest')], 0.25);
  assert.equal(stale[column('Bid')], null);
  assert.equal(stale[column('Ask')], null);
  assert.equal(stale[column('Note')], "'  =SUM(1,2)");
  assert.equal(rows[1].note, '  =SUM(1,2)', 'formula safety does not mutate the saved note');
  assert.equal(sanitizeWatchlistSpreadsheetText('normal'), 'normal');
  assert.equal(sanitizeWatchlistSpreadsheetText('  -not-a-formula'), "'  -not-a-formula");
});

test('Watchlist export filename follows the U.S. market date and empty exports have no data rows', () => {
  assert.equal(buildWatchlistExcelFilename(new Date('2026-09-22T01:00:00.000Z')), 'put-scanner-watchlist-2026-09-21.xlsx');
  const empty = buildWatchlistExcelExport([], new Set(), new Date('2026-09-21T15:00:00.000Z'));
  assert.equal(empty.rows.length, 0);
  assert.equal(empty.filename, 'put-scanner-watchlist-2026-09-21.xlsx');
});

test('Watchlist export workbook round-trips through xlsx with typed cells and usability metadata', () => {
  const output = buildWatchlistExcelExport(exportFixture(), new Set(), new Date('2026-09-21T15:00:00.000Z'));
  const workbook = buildWatchlistWorkbook(output, XLSX);
  const sheet = workbook.Sheets.Watchlist;
  assert.deepEqual(workbook.SheetNames, ['Watchlist']);
  assert.equal(sheet['!autofilter'].ref, `A1:AG${output.rows.length + 1}`);
  assert.equal(sheet['!cols'].length, WATCHLIST_EXCEL_COLUMNS.length);

  const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
  const reopened = XLSX.read(bytes, { type: 'array', cellDates: true, cellNF: true });
  const reopenedSheet = reopened.Sheets.Watchlist;
  const values = XLSX.utils.sheet_to_json(reopenedSheet, { header: 1, raw: true, defval: null });
  assert.equal(values.length, output.rows.length + 1);
  assert.deepEqual(values[0], [...WATCHLIST_EXCEL_COLUMNS]);
  assert.equal(typeof values[1][column('Strike')], 'number');
  assert.equal(values[1][column('IV')], 0.5);
  assert.equal(values[1][column('Nominal Yield Last')], 0.025);
  assert.ok(values[1][column('Expiration')] instanceof Date);
  assert.equal(values[1][column('Expiration')].toISOString().slice(0, 10), '2026-10-16');
  assert.equal(values[2][column('Note')], "'  =SUM(1,2)");
});

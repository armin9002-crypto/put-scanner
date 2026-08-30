import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildScannerOptionsPath,
  parseRequestedOptionExpiry,
  resolveOptionExpirySelection,
} from '../src/lib/optionExpiryNavigation.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relativePath => readFile(path.join(root, relativePath), 'utf8');

const timestamp = iso => Date.parse(`${iso}T00:00:00Z`) / 1_000;
const shortestExpiry = timestamp('2026-12-18');
const requestedExpiry = timestamp('2027-05-21');
const expirations = [
  { date: shortestExpiry, label: 'Dec 18, 2026', dte: 21 },
  { date: requestedExpiry, label: 'May 21, 2027', dte: 175 },
  { date: timestamp('2027-10-16'), label: 'Oct 16, 2027', dte: 316 },
];

test('Scanner-specific expiry becomes an explicit refresh-safe ETF detail URL', () => {
  assert.equal(
    buildScannerOptionsPath('tqqq', `date_${shortestExpiry}`),
    '/options/TQQQ?expiry=2026-12-18',
  );
  assert.equal(parseRequestedOptionExpiry('2026-12-18'), shortestExpiry);
  assert.equal(parseRequestedOptionExpiry(String(shortestExpiry)), shortestExpiry);
});

test('Scanner range buckets and no expiry preserve the existing detail default', () => {
  assert.equal(buildScannerOptionsPath('TQQQ', 'lte_30dte'), '/options/TQQQ');
  assert.equal(buildScannerOptionsPath('TQQQ', 'lte30'), '/options/TQQQ');
  assert.equal(buildScannerOptionsPath('TQQQ', 'all'), '/options/TQQQ');
  assert.equal(parseRequestedOptionExpiry('lte_30dte'), null);
  assert.equal(parseRequestedOptionExpiry(null), null);
});

test('an available requested expiry is selected from the normal response without a second chain fetch', () => {
  assert.deepEqual(
    resolveOptionExpirySelection(expirations, '2027-05-21', requestedExpiry),
    { date: requestedExpiry, requestedMatch: true, needsChainFetch: false },
  );
});

test('an unavailable requested expiry falls back to the first available chain safely', () => {
  assert.deepEqual(
    resolveOptionExpirySelection(expirations, '2028-01-21', shortestExpiry),
    { date: shortestExpiry, requestedMatch: false, needsChainFetch: false },
  );
  assert.deepEqual(
    resolveOptionExpirySelection(expirations, '2028-01-21', null),
    { date: shortestExpiry, requestedMatch: false, needsChainFetch: true },
  );
});

test('a direct route without a specific expiry retains shortest-chain behavior', () => {
  assert.deepEqual(
    resolveOptionExpirySelection(expirations, null, shortestExpiry),
    { date: shortestExpiry, requestedMatch: false, needsChainFetch: false },
  );
  assert.deepEqual(
    resolveOptionExpirySelection(expirations, 'lte_30dte', shortestExpiry),
    { date: shortestExpiry, requestedMatch: false, needsChainFetch: false },
  );
});

test('Scanner links use one shared expiry-aware path and detail load requests the exact date first', async () => {
  const [scanner, options] = await Promise.all([
    read('src/pages/HomePage.tsx'),
    read('src/pages/OptionsPage.tsx'),
  ]);
  assert.equal((scanner.match(/buildScannerOptionsPath\(etf\.ticker, expFilter\)/g) ?? []).length, 2);
  assert.match(options, /const requestedExpiry = parseRequestedOptionExpiry\(expiryParam\)/);
  assert.match(options, /fetchTickerDetail\(ticker, requestedExpiry \?\? undefined/);
  assert.doesNotMatch(options, /OptionsPage:(?:load|refresh):selected/);
  assert.doesNotMatch(scanner, /onMouseEnter[\s\S]{0,120}fetchOptions/);
});

test('Portfolio Analytics is local-only, collapsed by default, and accessible in both layouts', async () => {
  const source = await read('src/pages/PortfolioPage.tsx');
  assert.match(source, /const \[analyticsExpanded, setAnalyticsExpanded\] = useState\(false\)/);
  assert.equal((source.match(/aria-expanded=\{analyticsExpanded\}/g) ?? []).length, 2);
  assert.equal((source.match(/aria-controls="portfolio-analytics-content"/g) ?? []).length, 2);
  assert.ok((source.match(/analyticsExpanded &&/g) ?? []).length >= 2);
  assert.match(source, /min-h-11/);
  assert.doesNotMatch(source, /persist(?:Portfolio)?Analytics|emitDurableMutation\([^)]*analytics/i);
});

test('Schedule of Positions removes only the Net Capital at Risk display column', async () => {
  const source = await read('src/pages/PortfolioPage.tsx');
  const sortOptions = source.slice(
    source.indexOf('const PORTFOLIO_SCHEDULE_SORT_OPTIONS'),
    source.indexOf('function todayIso'),
  );
  const scheduleStart = source.indexOf('Schedule of Positions');
  const scheduleEnd = source.indexOf('<ArchiveHistorySection', scheduleStart);
  const schedule = source.slice(scheduleStart, scheduleEnd);

  assert.doesNotMatch(sortOptions, /netCapitalRisk|Net Capital at Risk/);
  assert.doesNotMatch(schedule, /netCapitalRisk|Net Capital at Risk|group\.netCapitalAtRisk|scheduleTotals\.netRisk|calculateNetCapitalAtRisk\(trade\)/);
  assert.match(source, /calculateNetCapitalAtRisk/);
  assert.match(source, /SummaryCard label="Net Risk"/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  backfillStoredEntryDeltas,
  entryDeltaFromExactChain,
  isContemporaneousPortfolioEntry,
  isValidEntryDelta,
  usMarketDateIso,
} from '../src/lib/portfolioEntryDelta.ts';
import { assessPortfolioMaintenance } from '../src/lib/portfolioMaintenance.ts';
import {
  elapsedMarketSessions,
  getPortfolioQuoteFreshness,
  summarizePortfolioQuoteFreshness,
} from '../src/lib/portfolioQuoteFreshness.ts';
import { buildCloseCandidates, getPortfolioAttentionScore } from '../src/lib/portfolioPolicies.ts';
import {
  PORTFOLIO_STORAGE_KEY,
  migratePortfolioState,
  readPortfolioTrades,
  writePortfolioTrades,
} from '../src/lib/portfolioStorage.ts';
import { resolveExpiredTradeWithClose } from '../src/lib/portfolioExpirationArchive.ts';
import { parsedBrokerageRowToPortfolioTrade } from '../src/lib/portfolioScreenshotImport.ts';
import { REQUEST_BUDGET_LEDGER } from '../src/lib/requestBudgets.ts';
import { createPutScannerBackup, applyPutScannerBackup } from '../src/lib/userDataBackup.ts';
import { fingerprintNamespaceDocument } from '../src/lib/cloudState/syncFingerprint.ts';
import { validateCloudNamespaceDocument } from '../src/lib/cloudState/cloudValidation.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFile(path.join(root, relative), 'utf8');

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); this.writes = 0; }
  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.writes += 1; this.values.set(key, String(value)); }
  removeItem(key) { this.values.delete(key); }
}

const trade = (overrides = {}) => ({
  id: 'trade-1', ticker: 'TQQQ', optionType: 'put', strike: 50, expiration: '2026-10-16', contracts: 1,
  soldPrice: 2, soldDate: '2026-08-28', status: 'open', notes: '',
  createdAt: '2026-08-28T15:00:00.000Z', updatedAt: '2026-08-28T15:00:00.000Z',
  entrySnapshot: { underlyingPrice: 65, iv: 45, delta: -0.22 },
  latestMarketData: { underlyingPrice: 65, optionBid: 1, optionAsk: 1.2, optionLast: 1.1, delta: -0.3, refreshedAt: '2026-08-28T15:00:00.000Z', availabilityStatus: 'live' },
  ...overrides,
});

const chain = (overrides = {}) => ({
  expirations: [], currentPrice: 65,
  puts: [{ strike: 50, bid: 1, ask: 1.2, last: 1.1, lastTradeDate: 1_777_000_000, delta: -0.24, impliedVolatility: 45, volume: 5, openInterest: 100 }],
  chainMeta: { ticker: 'TQQQ', requestedExpiration: 1_792_108_800, returnedExpiration: 1_792_108_800, expirationDate: 1_792_108_800, fetchedAt: Date.parse('2026-08-28T15:05:00.000Z'), source: 'network', putCount: 1 },
  ...overrides,
});

test('Entry Delta validates the canonical put convention and captures provider or calculated provenance', () => {
  assert.equal(isValidEntryDelta(-1), true);
  assert.equal(isValidEntryDelta(0), true);
  assert.equal(isValidEntryDelta(0.2), false);
  assert.equal(isValidEntryDelta(-1.01), false);
  const now = new Date('2026-08-28T15:05:00.000Z');
  const provider = entryDeltaFromExactChain(trade(), chain(), now);
  assert.equal(provider.status, 'captured');
  assert.deepEqual(provider.capture, { entryDelta: -0.24, entryDeltaSource: 'provider', entryDeltaCapturedAt: now.toISOString() });

  const calculated = entryDeltaFromExactChain(trade(), chain({ puts: [{ ...chain().puts[0], delta: null }] }), now);
  assert.equal(calculated.status, 'captured');
  assert.equal(calculated.capture.entryDeltaSource, 'calculated');
  assert.ok(calculated.capture.entryDelta < 0 && calculated.capture.entryDelta > -1);

  const unavailable = entryDeltaFromExactChain(trade(), chain({ currentPrice: 0, puts: [{ ...chain().puts[0], delta: null, impliedVolatility: null }] }), now);
  assert.equal(unavailable.status, 'unavailable');
});

test('historical trades and stale chains can never receive current Delta as Entry Delta', () => {
  const now = new Date('2026-08-28T15:05:00.000Z');
  const historical = trade({ soldDate: '2026-08-27', entrySnapshot: undefined });
  assert.equal(isContemporaneousPortfolioEntry(historical, now), false);
  assert.equal(entryDeltaFromExactChain(historical, chain(), now).status, 'ineligible');
  assert.equal(entryDeltaFromExactChain(trade(), chain({ chainMeta: { ...chain().chainMeta, freshness: 'stale', staleFallbackUsed: true } }), now).status, 'unavailable');
  assert.equal(entryDeltaFromExactChain(trade(), chain({ chainMeta: { ...chain().chainMeta, ticker: 'SPY' } }), now).status, 'unavailable');
  assert.equal(entryDeltaFromExactChain(trade(), chain({ chainMeta: { ...chain().chainMeta, returnedExpiration: 1_792_713_600 } }), now).status, 'unavailable');
  assert.equal(usMarketDateIso(new Date('2026-08-29T02:00:00Z')), '2026-08-28', 'market date follows New York rather than UTC rollover');
});

test('legacy Entry Delta recovery uses only a stored entry snapshot and preserves lifecycle history', () => {
  const missing = trade({ id: 'missing', entrySnapshot: { underlyingPrice: 65, iv: 45 } });
  const recovered = backfillStoredEntryDeltas([trade(), missing], '2026-08-28T16:00:00.000Z');
  assert.equal(recovered.resolved, 1);
  assert.equal(recovered.trades[0].entryDelta, -0.22);
  assert.equal(recovered.trades[0].entryDeltaSource, 'stored_snapshot');
  assert.equal(recovered.trades[1].entryDelta, undefined);
  const archived = resolveExpiredTradeWithClose({ ...recovered.trades[0], expiration: '2026-08-27' }, 60, '2026-08-27', 'expiration_close', undefined, '2026-08-28T17:00:00.000Z');
  assert.equal(archived.entryDelta, -0.22);
  assert.equal(archived.entryDeltaSource, 'stored_snapshot');
});

test('optional Entry Delta is backward compatible, rejects invalid data, and creates no legacy churn', () => {
  const legacy = trade({ entrySnapshot: undefined, latestMarketData: undefined });
  const migrated = migratePortfolioState(0, [legacy]);
  assert.equal(migrated.status, 'ok');
  assert.equal('entryDelta' in migrated.state.data[0], false);
  assert.equal(migratePortfolioState(0, [{ ...legacy, entryDelta: 0.5, entryDeltaSource: 'provider' }]).status, 'error');

  const storage = new MemoryStorage();
  assert.equal(writePortfolioTrades(storage, [legacy], { now: new Date('2026-08-28T15:00:00Z') }).status, 'ok');
  const before = readPortfolioTrades(storage);
  const writesBefore = storage.writes;
  const repeat = writePortfolioTrades(storage, before.data, { now: new Date('2026-08-29T15:00:00Z') });
  const after = readPortfolioTrades(storage);
  assert.deepEqual(repeat, { status: 'ok', written: false });
  assert.equal(storage.writes, writesBefore);
  assert.equal(after.revision, before.revision);
  assert.equal(after.updatedAt, before.updatedAt);
});

test('backup and canonical cloud fingerprints retain Entry Delta while old backups remain valid', () => {
  const source = new MemoryStorage();
  const enriched = trade({ entryDelta: -0.24, entryDeltaSource: 'provider', entryDeltaCapturedAt: '2026-08-28T15:05:00.000Z', latestMarketData: undefined });
  writePortfolioTrades(source, [enriched], { now: new Date('2026-08-28T15:06:00Z') });
  const backup = createPutScannerBackup(source, { now: new Date('2026-08-28T16:00:00Z') });
  assert.equal(backup.data.portfolio.data[0].entryDelta, -0.24);
  const destination = new MemoryStorage();
  applyPutScannerBackup(destination, backup);
  assert.equal(readPortfolioTrades(destination).data[0].entryDelta, -0.24);

  const oldSource = new MemoryStorage({ [PORTFOLIO_STORAGE_KEY]: JSON.stringify([trade({ entrySnapshot: undefined, latestMarketData: undefined })]) });
  const oldBackup = createPutScannerBackup(oldSource);
  assert.equal('entryDelta' in oldBackup.data.portfolio.data[0], false);
  const legacyFingerprint = fingerprintNamespaceDocument({ schemaVersion: 1, payload: { data: oldBackup.data.portfolio.data } });
  const enrichedFingerprint = fingerprintNamespaceDocument({ schemaVersion: 1, payload: { data: backup.data.portfolio.data } });
  assert.notEqual(legacyFingerprint, enrichedFingerprint, 'Entry Delta participates in canonical conflict detection');
  const cloudValidated = validateCloudNamespaceDocument('portfolio', 1, { data: backup.data.portfolio.data }, 'fetch_all');
  assert.equal(cloudValidated.ok, true);
  assert.equal(cloudValidated.value.payload.data[0].entryDelta, -0.24, 'cloud push/pull validation retains Entry Delta');
});

test('OCR imports never manufacture Entry Delta from screenshot market values', () => {
  const imported = parsedBrokerageRowToPortfolioTrade({
    rawText: 'TQQQ PUT', ticker: 'TQQQ', optionType: 'put', expiration: '2026-10-16', strike: 50, quantity: -1, contracts: 1,
    averageCostBasis: 2, costBasisTotal: 200, lastPrice: 1, selected: true, importAction: 'add', warnings: [],
  }, '2026-08-20', '2026-08-28T15:00:00.000Z');
  assert.ok(imported);
  assert.equal(imported.entryDelta, undefined);
  assert.equal(imported.entryDeltaSource, undefined);
});

test('quote freshness counts trading sessions, keeps weekends quiet, and separates last-trade age', () => {
  const friday = new Date('2026-08-28T20:00:00Z');
  assert.equal(elapsedMarketSessions(friday, new Date('2026-08-30T18:00:00Z')), 0);
  assert.equal(elapsedMarketSessions(friday, new Date('2026-08-31T18:00:00Z')), 1);
  assert.equal(elapsedMarketSessions(friday, new Date('2026-09-01T18:00:00Z')), 2);
  assert.equal(getPortfolioQuoteFreshness(trade(), new Date('2026-08-30T18:00:00Z')).state, 'fresh');
  assert.equal(getPortfolioQuoteFreshness(trade(), new Date('2026-08-31T18:00:00Z')).state, 'aging');
  assert.equal(getPortfolioQuoteFreshness(trade(), new Date('2026-09-01T18:00:00Z')).state, 'stale');

  const currentRefreshOldTrade = trade({ latestMarketData: { ...trade().latestMarketData, refreshedAt: '2026-08-31T15:00:00Z', lastTradeDate: Date.parse('2026-08-20T15:00:00Z') / 1000 } });
  const freshness = getPortfolioQuoteFreshness(currentRefreshOldTrade, new Date('2026-08-31T16:00:00Z'));
  assert.equal(freshness.state, 'fresh');
  assert.ok(freshness.lastTradeSessionAge > 1, 'provider last-trade age remains separate from observation freshness');
  assert.equal(getPortfolioQuoteFreshness(trade({ latestMarketData: { ...trade().latestMarketData, refreshedAt: '2026-08-31T15:00:00Z', availabilityStatus: 'refresh_failed' } }), new Date('2026-08-31T16:00:00Z')).state, 'stale');
});

test('stale or unavailable inputs are gated from Close Candidates and quote-derived attention confidence', () => {
  const now = new Date('2026-08-28T18:00:00Z');
  const fresh = trade({ latestMarketData: { ...trade().latestMarketData, optionBid: 0.2, optionAsk: 0.3, refreshedAt: now.toISOString() } });
  const stale = trade({ id: 'stale', latestMarketData: { ...fresh.latestMarketData, refreshedAt: '2026-08-25T18:00:00Z' } });
  const unavailable = trade({ id: 'unavailable', latestMarketData: undefined, entrySnapshot: undefined });
  assert.equal(buildCloseCandidates([fresh], 'ask', now).length, 1);
  assert.equal(buildCloseCandidates([stale, unavailable], 'ask', now).length, 0);
  assert.ok(getPortfolioAttentionScore(fresh, now) > getPortfolioAttentionScore(stale, now), 'stale quote-derived risk components are gated');
  assert.deepEqual(summarizePortfolioQuoteFreshness([fresh, stale, unavailable], now), { fresh: 1, aging: 0, stale: 1, unavailable: 1 });
});

test('maintenance assessment is local, distinguishes actionable recovery from permanent historical blanks', () => {
  const assessment = assessPortfolioMaintenance([
    trade({ id: 'expired', expiration: '2026-08-27', entryVixClose: undefined }),
    trade({ id: 'recoverable', entryVixClose: 20 }),
    trade({ id: 'unavailable', entrySnapshot: undefined, entryVixClose: undefined }),
    trade({ id: 'pending', status: 'expired_price_pending', entrySnapshot: undefined, entryVixClose: 19 }),
  ], new Date('2026-08-28T18:00:00Z'));
  assert.deepEqual(assessment.expiredLifecycleReview.map(item => item.id), ['expired']);
  assert.deepEqual(assessment.expirationPricePending.map(item => item.id), ['pending']);
  assert.deepEqual(assessment.recoverableEntryDelta.map(item => item.id), ['expired', 'recoverable']);
  assert.deepEqual(assessment.historicalEntryDeltaUnavailable.map(item => item.id), ['unavailable', 'pending']);
  assert.deepEqual(assessment.missingEntryVix.map(item => item.id), ['expired', 'unavailable']);
});

test('Portfolio mount, refresh, save, and import keep durable maintenance explicit', async () => {
  const page = await read('src/pages/PortfolioPage.tsx');
  const mount = page.slice(page.indexOf('useEffect(() => {\n    const stored = loadPortfolioTrades'), page.indexOf('const summary = useMemo'));
  const save = page.slice(page.indexOf('const handleSaveTrade'), page.indexOf('const handleBackupImported'));
  const refresh = page.slice(page.indexOf('const handleRefreshOpenTrades'), page.indexOf('const handleRetryResolve'));
  const screenshot = page.slice(page.indexOf('const handleScreenshotImported'), page.indexOf('const handleDeleteTrade'));
  assert.doesNotMatch(mount, /archiveExpiredOpenTrades|resolvePortfolioEntryVix|savePortfolioTrades/);
  assert.doesNotMatch(save, /archiveExpiredOpenTrades|resolvePortfolioEntryVix/);
  assert.doesNotMatch(refresh, /archiveExpiredOpenTrades|resolvePortfolioEntryVix|entryVixClose|entryDelta:/);
  assert.doesNotMatch(screenshot, /archiveExpiredOpenTrades|resolvePortfolioEntryVix/);
  assert.match(page, /Portfolio Maintenance/);
  assert.match(page, /handleResolveLifecycleMaintenance/);
  assert.match(page, /handleResolveEntryVixMaintenance/);
});

test('Stage 6B.4 request ledger makes cached and cold maintenance costs explicit', () => {
  assert.deepEqual(REQUEST_BUDGET_LEDGER['portfolio-entry-delta-capture'].expected, { browserRequests: 0, functionInvocations: 0, providerAcquisitions: 0 });
  assert.deepEqual(REQUEST_BUDGET_LEDGER['portfolio-entry-delta-capture'].ceiling, { browserRequests: 1, functionInvocations: 1, providerAcquisitions: 1 });
  assert.equal(REQUEST_BUDGET_LEDGER['portfolio-entry-vix-maintenance'].ceiling.browserRequests, 1);
  assert.equal(REQUEST_BUDGET_LEDGER['portfolio-lifecycle-maintenance'].ceiling.providerAcquisitions, 1);
});

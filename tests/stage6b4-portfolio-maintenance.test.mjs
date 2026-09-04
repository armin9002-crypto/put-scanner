import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  backfillStoredEntryDeltas,
  backfillStoredEntrySnapshots,
  buildEntryDeltaEditPatch,
  buildEntryIvEditPatch,
  enrichCurrentTradeEntrySnapshot,
  entryDeltaFromExactChain,
  entrySnapshotFromExactChain,
  isContemporaneousPortfolioEntry,
  isValidEntryDelta,
  isValidEntryIv,
  usMarketDateIso,
} from '../src/lib/portfolioEntryDelta.ts';
import { inferManualTradeModeFromExpiration } from '../src/lib/portfolioHistoricalTrade.ts';
import { mergePortfolioMarketRefresh } from '../src/lib/portfolioMarketRefresh.ts';
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
import { buildHistoryGroups, historyEntryVix, historyPremium, historyRealizedPnl } from '../src/lib/portfolioHistoryAnalytics.ts';
import { parsedBrokerageRowToPortfolioTrade } from '../src/lib/portfolioScreenshotImport.ts';
import { REQUEST_BUDGET_LEDGER } from '../src/lib/requestBudgets.ts';
import { createPutScannerBackup, applyPutScannerBackup } from '../src/lib/userDataBackup.ts';
import { canonicalJsonEqual } from '../src/lib/cloudState/stateComparison.ts';
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

test('new current trade captures Delta and percentage-point IV from one exact-contract observation before save', async () => {
  const now = new Date('2026-08-31T15:05:00.000Z');
  const current = trade({ soldDate: '2026-08-31', expiration: '2026-09-18', entrySnapshot: undefined, latestMarketData: undefined });
  const exactChain = chain({
    puts: [{ ...chain().puts[0], delta: -0.12, impliedVolatility: 65.4 }],
    chainMeta: {
      ...chain().chainMeta,
      requestedExpiration: Date.parse('2026-09-18T00:00:00Z') / 1000,
      returnedExpiration: Date.parse('2026-09-18T00:00:00Z') / 1000,
      expirationDate: Date.parse('2026-09-18T00:00:00Z') / 1000,
      fetchedAt: now.getTime(),
    },
  });
  let lookups = 0;
  const result = await enrichCurrentTradeEntrySnapshot(current, async (ticker, expiration) => {
    lookups += 1;
    assert.equal(ticker, 'TQQQ');
    assert.equal(expiration, Date.parse('2026-09-18T00:00:00Z') / 1000);
    return exactChain;
  }, now);

  assert.equal(result.status, 'captured');
  assert.equal(result.lookupCount, 1);
  assert.equal(lookups, 1, 'Delta and IV share one bounded lookup');
  assert.equal(result.trade.status, 'open');
  assert.deepEqual(
    [result.trade.entryDelta, result.trade.entryIv, result.trade.entryDeltaSource, result.trade.entryIvSource],
    [-0.12, 65.4, 'provider', 'provider'],
  );
  assert.equal(result.trade.entryDeltaCapturedAt, result.trade.entryIvCapturedAt);
  assert.deepEqual(
    [result.trade.entrySnapshot.delta, result.trade.entrySnapshot.iv],
    [-0.12, 65.4],
    'durable fields and the stored snapshot come from the same exact row',
  );
});

test('snapshot lookup failure leaves an eligible open trade saveable without Delta or IV', async () => {
  const now = new Date('2026-08-31T15:05:00.000Z');
  const current = trade({ soldDate: '2026-08-31', expiration: '2026-09-18', entrySnapshot: undefined, latestMarketData: undefined });
  const result = await enrichCurrentTradeEntrySnapshot(current, async () => { throw new Error('provider unavailable'); }, now);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.lookupCount, 1);
  assert.equal(result.trade, current);
  assert.equal(result.trade.status, 'open');
  assert.equal(result.trade.entryDelta, undefined);
  assert.equal(result.trade.entryIv, undefined);
});

test('expiration-only trade mode uses New York date semantics and recomputes in both directions', () => {
  const marketDate = '2026-08-31';
  assert.equal(inferManualTradeModeFromExpiration('2026-08-21', marketDate), 'historical');
  assert.equal(inferManualTradeModeFromExpiration('2026-08-31', marketDate), 'open', '0-DTE remains open');
  assert.equal(inferManualTradeModeFromExpiration('2026-09-18', marketDate), 'open');
  assert.equal(inferManualTradeModeFromExpiration('2027-01-15', marketDate), 'open');
  assert.equal(inferManualTradeModeFromExpiration('2026-08-21', marketDate), 'historical', 'future-to-past recomputes Historical');
  assert.equal(usMarketDateIso(new Date('2026-09-01T02:00:00Z')), marketDate, 'UTC rollover does not advance New York market date');
});

test('historical trades and stale chains can never receive current Delta as Entry Delta', () => {
  const now = new Date('2026-08-28T15:05:00.000Z');
  const historical = trade({ soldDate: '2026-08-27', entrySnapshot: undefined });
  assert.equal(isContemporaneousPortfolioEntry(historical, now), false);
  assert.equal(entryDeltaFromExactChain(historical, chain(), now).status, 'ineligible');
  assert.equal(entrySnapshotFromExactChain(historical, chain(), now).status, 'ineligible', 'current-chain IV cannot substitute for historical Entry IV');
  assert.equal(entryDeltaFromExactChain(trade(), chain({ chainMeta: { ...chain().chainMeta, freshness: 'stale', staleFallbackUsed: true } }), now).status, 'unavailable');
  assert.equal(entryDeltaFromExactChain(trade(), chain({ chainMeta: { ...chain().chainMeta, ticker: 'SPY' } }), now).status, 'unavailable');
  assert.equal(entryDeltaFromExactChain(trade(), chain({ chainMeta: { ...chain().chainMeta, returnedExpiration: 1_792_713_600 } }), now).status, 'unavailable');
  assert.equal(usMarketDateIso(new Date('2026-08-29T02:00:00Z')), '2026-08-28', 'market date follows New York rather than UTC rollover');
});

test('Edit Trade can populate, override, preserve, or explicitly clear frozen Entry Delta', () => {
  const capturedAt = '2026-08-30T15:00:00.000Z';
  assert.deepEqual(buildEntryDeltaEditPatch(trade({ entryDelta: undefined, entryDeltaSource: undefined }), -0.2, capturedAt), {
    entryDelta: -0.2, entryDeltaSource: 'manual', entryDeltaCapturedAt: capturedAt,
  });
  const captured = trade({ entryDelta: -0.24, entryDeltaSource: 'provider', entryDeltaCapturedAt: '2026-08-28T15:05:00.000Z' });
  assert.deepEqual(buildEntryDeltaEditPatch(captured, -0.24, capturedAt), {
    entryDelta: -0.24, entryDeltaSource: 'provider', entryDeltaCapturedAt: '2026-08-28T15:05:00.000Z',
  }, 'unrelated edits preserve the frozen value and its original provenance');
  assert.deepEqual(buildEntryDeltaEditPatch(captured, -0.31, capturedAt), {
    entryDelta: -0.31, entryDeltaSource: 'manual', entryDeltaCapturedAt: capturedAt,
  });
  assert.deepEqual(buildEntryDeltaEditPatch(captured, null, capturedAt), {
    entryDelta: undefined, entryDeltaSource: undefined, entryDeltaCapturedAt: undefined,
  });
  assert.throws(() => buildEntryDeltaEditPatch(captured, -1.1, capturedAt), RangeError);
});

test('Edit Trade uses unambiguous percentage points for Entry IV populate, preserve, override, and clear', () => {
  const capturedAt = '2026-08-31T15:00:00.000Z';
  assert.equal(isValidEntryIv(65.4), true);
  assert.equal(isValidEntryIv(0), false);
  assert.deepEqual(buildEntryIvEditPatch(trade({ entryIv: undefined, entryIvSource: undefined }), 65.4, capturedAt), {
    entryIv: 65.4, entryIvSource: 'manual', entryIvCapturedAt: capturedAt,
  });
  const captured = trade({ entryIv: 45, entryIvSource: 'provider', entryIvCapturedAt: '2026-08-28T15:05:00.000Z' });
  assert.deepEqual(buildEntryIvEditPatch(captured, 45, capturedAt), {
    entryIv: 45, entryIvSource: 'provider', entryIvCapturedAt: '2026-08-28T15:05:00.000Z',
  });
  assert.deepEqual(buildEntryIvEditPatch(captured, 65.4, capturedAt), {
    entryIv: 65.4, entryIvSource: 'manual', entryIvCapturedAt: capturedAt,
  });
  assert.deepEqual(buildEntryIvEditPatch(captured, null, capturedAt), {
    entryIv: undefined, entryIvSource: undefined, entryIvCapturedAt: undefined,
  });
  assert.throws(() => buildEntryIvEditPatch(captured, 0, capturedAt), RangeError);
});

test('manual Entry Delta and Entry IV remain position-specific and quote refresh cannot replace them', () => {
  const first = trade({ id: 'same-contract-1', entryDelta: -0.21, entryDeltaSource: 'manual', entryDeltaCapturedAt: '2026-08-30T15:00:00.000Z', entryIv: 51, entryIvSource: 'manual', entryIvCapturedAt: '2026-08-30T15:00:00.000Z' });
  const second = trade({ id: 'same-contract-2', entryDelta: -0.33, entryDeltaSource: 'manual', entryDeltaCapturedAt: '2026-08-30T15:01:00.000Z', entryIv: 72, entryIvSource: 'manual', entryIvCapturedAt: '2026-08-30T15:01:00.000Z' });
  const refreshed = [
    trade({ ...first, entryDelta: -0.7, latestMarketData: { ...first.latestMarketData, delta: -0.7, refreshedAt: '2026-08-30T16:00:00.000Z' } }),
    trade({ ...second, entryDelta: -0.8, latestMarketData: { ...second.latestMarketData, delta: -0.8, refreshedAt: '2026-08-30T16:00:00.000Z' } }),
  ];
  const merged = mergePortfolioMarketRefresh([first, second], refreshed);
  assert.deepEqual(merged.map(item => item.entryDelta), [-0.21, -0.33]);
  assert.deepEqual(merged.map(item => item.entryIv), [51, 72]);
  assert.deepEqual(merged.map(item => item.latestMarketData.delta), [-0.7, -0.8]);
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
  const archivedManual = resolveExpiredTradeWithClose({ ...trade(), expiration: '2026-08-27', entryDelta: -0.31, entryDeltaSource: 'manual', entryDeltaCapturedAt: '2026-08-27T15:00:00.000Z' }, 60, '2026-08-27', 'expiration_close');
  assert.deepEqual([archivedManual.entryDelta, archivedManual.entryDeltaSource], [-0.31, 'manual']);
});

test('legacy Entry IV recovery uses only a trustworthy stored snapshot and archive preserves it', () => {
  const missingBoth = trade({ entryDelta: undefined, entryIv: undefined });
  const unavailable = trade({ id: 'unavailable-iv', entrySnapshot: { underlyingPrice: 65, delta: -0.3 } });
  const recovered = backfillStoredEntrySnapshots([missingBoth, unavailable], '2026-08-31T16:00:00.000Z');
  assert.deepEqual([recovered.resolvedDeltas, recovered.resolvedIvs], [2, 1]);
  assert.deepEqual(
    [recovered.trades[0].entryIv, recovered.trades[0].entryIvSource, recovered.trades[0].entryIvCapturedAt],
    [45, 'stored_snapshot', missingBoth.createdAt],
  );
  assert.equal(recovered.trades[1].entryIv, undefined, 'missing stored IV remains unavailable');
  const archived = resolveExpiredTradeWithClose({ ...recovered.trades[0], expiration: '2026-08-27' }, 60, '2026-08-27', 'expiration_close');
  assert.deepEqual([archived.entryIv, archived.entryIvSource], [45, 'stored_snapshot']);
});

test('optional Entry Delta and Entry IV are backward compatible, reject invalid data, and create no legacy churn', () => {
  const legacy = trade({ entrySnapshot: undefined, latestMarketData: undefined });
  const migrated = migratePortfolioState(0, [legacy]);
  assert.equal(migrated.status, 'ok');
  assert.equal('entryDelta' in migrated.state.data[0], false);
  assert.equal('entryIv' in migrated.state.data[0], false);
  assert.equal(migratePortfolioState(0, [{ ...legacy, entryDelta: 0.5, entryDeltaSource: 'provider' }]).status, 'error');
  assert.equal(migratePortfolioState(0, [{ ...legacy, entryIv: 0, entryIvSource: 'provider' }]).status, 'error');

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

test('backup and canonical cloud documents retain Entry Delta and Entry IV while old backups remain valid', () => {
  const source = new MemoryStorage();
  const enriched = resolveExpiredTradeWithClose(
    trade({ expiration: '2026-08-27', soldDate: '2026-07-01', entryDelta: -0.24, entryDeltaSource: 'provider', entryDeltaCapturedAt: '2026-07-01T15:05:00.000Z', entryIv: 65.4, entryIvSource: 'provider', entryIvCapturedAt: '2026-07-01T15:05:00.000Z', latestMarketData: undefined }),
    60,
    '2026-08-27',
    'expiration_close',
    undefined,
    '2026-08-28T16:00:00.000Z',
    { basisStatus: 'provider_no_actions', basisCheckedFrom: '2026-07-01' },
  );
  writePortfolioTrades(source, [enriched], { now: new Date('2026-08-28T15:06:00Z') });
  const backup = createPutScannerBackup(source, { now: new Date('2026-08-28T16:00:00Z') });
  assert.equal(backup.data.portfolio.data[0].entryDelta, -0.24);
  assert.equal(backup.data.portfolio.data[0].entryIv, 65.4);
  assert.equal(backup.data.portfolio.data[0].expirationBasisStatus, 'provider_no_actions');
  const destination = new MemoryStorage();
  applyPutScannerBackup(destination, backup);
  assert.equal(readPortfolioTrades(destination).data[0].entryDelta, -0.24);
  assert.equal(readPortfolioTrades(destination).data[0].entryIv, 65.4);
  assert.equal(readPortfolioTrades(destination).data[0].expirationBasisStatus, 'provider_no_actions');

  const oldSource = new MemoryStorage({ [PORTFOLIO_STORAGE_KEY]: JSON.stringify([trade({ entrySnapshot: undefined, latestMarketData: undefined })]) });
  const oldBackup = createPutScannerBackup(oldSource);
  assert.equal('entryDelta' in oldBackup.data.portfolio.data[0], false);
  assert.equal('entryIv' in oldBackup.data.portfolio.data[0], false);
  assert.equal(canonicalJsonEqual(oldBackup.data.portfolio.data, backup.data.portfolio.data), false, 'Entry Delta participates in canonical CAS documents');
  const cloudValidated = validateCloudNamespaceDocument('portfolio', 1, { data: backup.data.portfolio.data }, 'fetch_all');
  assert.equal(cloudValidated.ok, true);
  assert.equal(cloudValidated.value.payload.data[0].entryDelta, -0.24, 'cloud validation retains Entry Delta');
  assert.equal(cloudValidated.value.payload.data[0].entryIv, 65.4, 'cloud validation retains Entry IV for CAS/reload');
  assert.equal(cloudValidated.value.payload.data[0].expirationBasisStatus, 'provider_no_actions', 'cloud validation retains expiration basis provenance');

  const manual = trade({ entryDelta: -0.31, entryDeltaSource: 'manual', entryDeltaCapturedAt: '2026-08-30T15:00:00.000Z', entryIv: 71.2, entryIvSource: 'manual', entryIvCapturedAt: '2026-08-30T15:00:00.000Z', latestMarketData: undefined });
  const manualStorage = new MemoryStorage();
  writePortfolioTrades(manualStorage, [manual]);
  const reloadedManual = readPortfolioTrades(manualStorage).data[0];
  assert.deepEqual(
    [reloadedManual.id, reloadedManual.entryDelta, reloadedManual.entryDeltaSource, reloadedManual.entryDeltaCapturedAt, reloadedManual.entryIv, reloadedManual.entryIvSource, reloadedManual.entryIvCapturedAt],
    ['trade-1', -0.31, 'manual', '2026-08-30T15:00:00.000Z', 71.2, 'manual', '2026-08-30T15:00:00.000Z'],
    'manual overrides survive a durable reload',
  );
});

test('OCR imports never manufacture Entry Delta or Entry IV from screenshot market values', () => {
  const imported = parsedBrokerageRowToPortfolioTrade({
    rawText: 'TQQQ PUT', ticker: 'TQQQ', optionType: 'put', expiration: '2026-10-16', strike: 50, quantity: -1, contracts: 1,
    averageCostBasis: 2, costBasisTotal: 200, lastPrice: 1, selected: true, importAction: 'add', warnings: [],
  }, '2026-08-20', '2026-08-28T15:00:00.000Z');
  assert.ok(imported);
  assert.equal(imported.entryDelta, undefined);
  assert.equal(imported.entryDeltaSource, undefined);
  assert.equal(imported.entryIv, undefined);
  assert.equal(imported.entryIvSource, undefined);
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
  assert.deepEqual(assessment.recoverableEntryIv.map(item => item.id), ['expired', 'recoverable']);
  assert.deepEqual(assessment.historicalEntryIvUnavailable.map(item => item.id), ['unavailable', 'pending']);
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
  assert.doesNotMatch(refresh, /archiveExpiredOpenTrades|resolvePortfolioEntryVix|entryVixClose|entryDelta:|entryIv:/);
  assert.doesNotMatch(screenshot, /archiveExpiredOpenTrades|resolvePortfolioEntryVix/);
  assert.match(page, /Portfolio Maintenance/);
  assert.match(page, /handleResolveLifecycleMaintenance/);
  assert.match(page, /handleResolveEntryVixMaintenance/);
});

test('Add Trade exposes manual Entry Delta and percentage-point IV only for historical entry while Edit retains explicit overrides', async () => {
  const page = await read('src/pages/PortfolioPage.tsx');
  const modal = page.slice(page.indexOf('function TradeModal'), page.indexOf('function PortfolioPage'));
  const field = modal.indexOf('Entry Delta (optional)');
  assert.ok(field > 0);
  assert.ok(modal.lastIndexOf('{showEntrySnapshots && (', field) > 0, 'Entry snapshot inputs are conditional on Edit or Historical mode');
  assert.match(modal, /const showEntrySnapshots = trade != null \|\| tradeMode === 'historical'/);
  assert.match(modal, /Entry IV \(%\) \(optional\)/);
  assert.match(modal, /65\.4 means 65\.4%/);
  assert.match(modal, /Entry Delta and Entry IV are captured automatically from exact-contract data when available/);
  assert.match(modal, /Historical \/ Realized/);
  assert.match(modal, /Held to Expiration/);
  assert.match(modal, /Closed \/ Bought Back/);
  assert.match(modal, /Assigned \(Confirmed\)/);
  assert.doesNotMatch(modal, /<option value="expired"|<option value="expired_price_pending"/);
  assert.match(modal, /inferManualTradeModeFromExpiration\(value, marketDate\)/, 'every valid expiration change recomputes the canonical mode in both directions');
  const save = page.slice(page.indexOf('const handleSaveTrade'), page.indexOf('const handleBackupImported'));
  assert.match(save, /snapshotResult = !id && intent\.mode === 'open'/, 'only current/open creation can start automatic capture, so historical manual values remain frozen');
  assert.ok(save.indexOf('enrichCurrentTradeEntrySnapshot') < save.indexOf('addPortfolioTrade(finalTrade)'), 'snapshot lookup completes before the one initial durable add');
  assert.equal((save.match(/addPortfolioTrade\(/g) ?? []).length, 1, 'manual Add Trade uses one canonical durable mutation');
  assert.match(page, /useState<HistoryGroupMode>\('year'\)/, 'History defaults to expiration-year grouping without durable preference state');
  assert.match(page, /summary\.totalHistoricalNotional/, 'the headline notional always covers all History, independent of outcome filtering');
  assert.match(page, /label="Total Realized IRR"/, 'History exposes the combined realized money-weighted return');
  assert.match(page, /label="Wtd\. Avg\. Entry Delta"/, 'History exposes the signed weighted Entry Delta summary');
  assert.match(page, /label="Wtd\. Avg\. Entry IV"/, 'History exposes Gross-Risk-weighted Entry IV with coverage');
  assert.match(page, /label="Avg\. Days Held" value=\{formatAverageDays/, 'History keeps one-decimal average holding periods');
  assert.match(page, /label="Total Historical Notional"/, 'History exposes cumulative historical notional');
  assert.doesNotMatch(page, /label="Premium Collected"/, 'Portfolio-facing summary labels use the concise Premium name');
  assert.match(page, /HISTORY_SORT_OPTIONS\.map\(option => historySortButton/, 'History table uses compact sortable date and historical market columns');
  assert.match(page, /formatHistoricalOptionPrice\(trade\.soldPrice\)/, 'History uses the dedicated Sold Price display formatter');
  assert.match(page, /minimumFractionDigits: 2, maximumFractionDigits: 2/, 'History displays Sold Price to exactly two decimals without changing stored precision');
  assert.doesNotMatch(page, /\['Ticker', 'Expiration'.*'Final Value'/s, 'History table does not display the legacy Final Value column');
  assert.match(page, /function formatHistoryDate/, 'History dates use a deterministic compact formatter');
  assert.match(page, /aria-label="Group history by"/, 'History grouping uses the shared segmented-control interaction language');
  assert.match(page, /collapsedHistoryGroups/, 'History group disclosure is session-local presentation state');
  assert.match(page, /aria-expanded={!collapsed}/, 'History group toggles expose expanded state');
  assert.match(page, /group\.contractCount/, 'History subtotals align additive contract totals under Contracts');
  assert.match(page, /group\.premium/, 'History subtotals align Premium under Premium');
  assert.match(page, /group\.realizedPnl/, 'History subtotals align realized P&L under Realized P&L');
  assert.match(page, /portfolio-history-group-subtotal[\s\S]{0,900}group\.grossRisk/, 'History subtotals align canonical Gross Risk under Gross Risk');
  assert.match(page, /group\.weightedAverageRealizedIrr/, 'History subtotals use the canonical weighted individual IRR');
  assert.match(page, /group\.weightedAverageDaysHeld/, 'History subtotals align weighted Days Held');
  assert.match(page, /group\.weightedAverageNy/, 'History subtotals align weighted Entry NY');
  assert.match(page, /group\.weightedAverageEntryVix/, 'History subtotals align weighted Entry VIX');
  assert.match(page, /group\.weightedAveragePercentCaptured/, 'History subtotals align weighted % Captured');
  assert.match(page, /group\.weightedAverageEntryDelta/, 'History subtotals align weighted Entry Delta');
  assert.match(page, /group\.weightedAverageEntryIv/, 'History subtotals align weighted Entry IV');
  assert.match(page, /!multiLot && isManualWorthlessConfirmationEligible\(lifecycleTrade\)/, 'History derives confirmation eligibility from one canonical durable lot and never applies it in bulk');
  assert.match(page, />Confirm Worthless<\/button>/, 'eligible pending rows expose the narrow outcome-attestation action');
  assert.match(page, /Confirm this put expired worthless\? Put Scanner will record final option value as \$0 and keep Price @ Exp\. unavailable\./, 'financial mutation requires the established confirmation-sheet pattern');
  const manualConfirmation = page.slice(page.indexOf('const handleConfirmExpiredWorthless'), page.indexOf('const openDrawer'));
  assert.match(manualConfirmation, /confirmPortfolioTradeExpiredWorthless\(current\)/);
  assert.doesNotMatch(manualConfirmation, /getExpirationClosePrice|handleRetryResolve|fetch\(|fetchOptions|fetchBatchPrices/, 'manual attestation cannot invoke the provider resolver or any market request');
  assert.doesNotMatch(page, /trades.*Premium.*P&amp;L/, 'History does not use the detached hanging group-summary sentence');
  const historyAnalytics = await read('src/lib/portfolioHistoryAnalytics.ts');
  assert.doesNotMatch(historyAnalytics, /fetch\(|requestMarketData|fetchOptions/, 'History analytics remain request-free');
});

test('historical entry UX keeps outcome states and repeated-entry actions in the modal', async () => {
  const page = await read('src/pages/PortfolioPage.tsx');
  const modal = page.slice(page.indexOf('function TradeModal'), page.indexOf('function PortfolioPage'));
  assert.match(modal, /role="dialog" aria-modal="true"/);
  assert.match(modal, /aria-label="Trade mode"/);
  assert.match(modal, /How did it end\?/);
  assert.match(modal, /Save & Add Another/);
  assert.match(modal, /keepOpen/);
  assert.match(modal, /setHistoricalOutcome\('held_to_expiration'\)/, 'Save & Add Another resets the default historical outcome');
  assert.match(modal, /This past expiration uses Historical \/ Realized mode/);
  assert.match(modal, /Expiration price will be resolved through Portfolio Maintenance/);
  assert.match(modal, /formatEntryDeltaInput/);
  assert.match(modal, /entryDeltaDirty/);
  assert.match(modal, /Close Date/);
  assert.match(modal, /Close Price/);
  assert.doesNotMatch(modal, /<option value="expired_price_pending"/);
});

test('History grouped table keeps canonical additive subtotal presentation across grouping modes', () => {
  const first = trade({ id: 'history-a', expiration: '2026-10-16', contracts: 2, status: 'closed', closePrice: 0.05, closeDate: '2026-10-16', entryVixClose: 22 });
  const second = trade({ id: 'history-b', expiration: '2026-12-18', contracts: 1, status: 'expired', resolutionType: 'expired_worthless', expirationClosePrice: 60, expirationCloseDate: '2026-12-18', entryVixClose: undefined });
  const groups = buildHistoryGroups([first, second], 'year');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].contractCount, 3);
  assert.equal(groups[0].premium, historyPremium(first) + historyPremium(second));
  assert.equal(groups[0].realizedPnl, historyRealizedPnl(first) + historyRealizedPnl(second));
  assert.equal(historyEntryVix(second), null, 'missing Entry VIX remains unavailable rather than falling back to current VIX');
  assert.equal(buildHistoryGroups([first, second], 'none').length, 1, 'None remains ungrouped');
});

test('Scanner uses one controlled local filter/direct-submit form and the supplied wordmark', async () => {
  const [page, form, app, styles] = await Promise.all([
    read('src/pages/HomePage.tsx'),
    read('src/components/AnalyzeTickerForm.tsx'),
    read('src/App.tsx'),
    read('src/index.css'),
  ]);
  assert.equal((page.match(/<AnalyzeTickerForm/g) ?? []).length, 2, 'mobile and desktop Scanner render the same unified form');
  assert.doesNotMatch(page, /Filter by ticker or underlying index|Search ETFs|Analyze Ticker/, 'old duplicate search and micro-label copy is gone');
  assert.doesNotMatch(page, /Find high-quality put opportunities across leveraged ETFs|Compare price action, option context, and liquidity before opening the chain\./, 'removed Scanner descriptions are absent');
  assert.match(page, /placeholder="Filter \/ Search by Ticker"/, 'unified placeholder is exact');
  assert.match(form, /className="analyze-ticker-input[^\"]*uppercase/, 'typed ticker input keeps existing uppercase behavior');
  assert.match(styles, /\.analyze-ticker-input::placeholder\s*\{\s*text-transform: none;/, 'placeholder casing is corrected at the pseudo-element only');
  assert.match(page, /setSearch\(event\.target\.value\)|onValueChange=\{setSearch\}/, 'typing remains local state-driven');
  assert.match(page, /ticker\.toLowerCase\(\).*underlying|underlying\.toLowerCase\(\).*ticker/s, 'local filter preserves ticker/underlying search semantics');
  assert.match(form, /navigate\(`\/options\//, 'explicit submit preserves direct option-chain navigation');
  assert.doesNotMatch(form, /fetch\(|fetchBatch|requestMarketData/, 'typing and submit form do not add provider fetch behavior');
  assert.match(app, /put-scanner-wordmark\.png|wordmarkUrl/, 'supplied wordmark asset is referenced');
  assert.match(app, /aria-label="Put Scanner"/, 'brand remains accessible');
  assert.doesNotMatch(app, /ShieldCheck|Leveraged ETFs/, 'old shield/two-line brand treatment is removed');
});

test('Stage 6B.4 request ledger makes cached and cold maintenance costs explicit', () => {
  assert.deepEqual(REQUEST_BUDGET_LEDGER['portfolio-entry-delta-capture'].expected, { browserRequests: 0, functionInvocations: 0, providerAcquisitions: 0 });
  assert.deepEqual(REQUEST_BUDGET_LEDGER['portfolio-entry-delta-capture'].ceiling, { browserRequests: 1, functionInvocations: 1, providerAcquisitions: 1 });
  assert.deepEqual(REQUEST_BUDGET_LEDGER['portfolio-historical-expiration-save'].expected, { browserRequests: 0, functionInvocations: 0, providerAcquisitions: 0 });
  assert.deepEqual(REQUEST_BUDGET_LEDGER['portfolio-historical-expiration-save'].ceiling, { browserRequests: 1, functionInvocations: 1, providerAcquisitions: 1 });
  assert.deepEqual(REQUEST_BUDGET_LEDGER['portfolio-manual-worthless-confirmation'].expected, { browserRequests: 0, functionInvocations: 0, providerAcquisitions: 0 });
  assert.deepEqual(REQUEST_BUDGET_LEDGER['portfolio-manual-worthless-confirmation'].ceiling, { browserRequests: 0, functionInvocations: 0, providerAcquisitions: 0 });
  assert.equal(REQUEST_BUDGET_LEDGER['portfolio-manual-worthless-confirmation'].providerHttpAttemptCeiling, 0);
  assert.equal(REQUEST_BUDGET_LEDGER['portfolio-entry-vix-maintenance'].ceiling.browserRequests, 1);
  assert.equal(REQUEST_BUDGET_LEDGER['portfolio-lifecycle-maintenance'].ceiling.providerAcquisitions, 1);
});

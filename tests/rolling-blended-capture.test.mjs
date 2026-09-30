import test from 'node:test';
import assert from 'node:assert/strict';

import { buildHistoryAnalytics, historyRealizedIrr, historyRealizedPnl } from '../src/lib/portfolioHistoryAnalytics.ts';
import { canonicalHistoricalRealizedDate } from '../src/lib/portfolioRealizedEconomics.ts';
import { buildRollingHistoricalAnalyticsSeries } from '../src/lib/rollingHistoricalAnalytics.ts';

const asOf = new Date('2026-09-01T02:00:00.000Z'); // 2026-08-31 in New York.
const trade = (overrides = {}) => ({
  id: 'trade',
  ticker: 'TST',
  optionType: 'put',
  strike: 50,
  expiration: '2026-12-18',
  contracts: 1,
  soldPrice: 2,
  soldDate: '2026-01-01',
  status: 'open',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});
const terminalPoint = series => series.points.at(-1);

test('rolling Blended Capture uses the exact canonical History aggregate over inclusive realized-event windows', () => {
  const origin = trade({ id: 'origin', soldDate: '2025-01-01' });
  const boundaryEarlyClose = trade({
    id: 'boundary-early-close', soldDate: '2026-01-01', expiration: '2027-01-15', status: 'closed',
    closeDate: '2026-05-31', soldPrice: 3, closePrice: 1,
  });
  const negative = trade({
    id: 'negative', soldDate: '2026-06-01', expiration: '2026-12-18', status: 'closed',
    closeDate: '2026-06-15', soldPrice: 1, closePrice: 3,
  });
  const zeroPremium = trade({
    id: 'zero-premium', soldDate: '2026-06-02', expiration: '2026-12-18', status: 'closed',
    closeDate: '2026-07-15', soldPrice: 0, closePrice: 0,
  });
  const finitePnlWithoutRisk = trade({
    id: 'no-risk', soldDate: '2026-06-03', expiration: '2026-12-18', status: 'closed',
    closeDate: '2026-08-01', strike: 0, soldPrice: 2, closePrice: 1,
  });
  const unavailablePremium = trade({
    id: 'unavailable-premium', soldDate: '2026-06-04', expiration: '2026-12-18', status: 'closed',
    closeDate: '2026-08-02', soldPrice: Number.NaN, positionMetrics: { realizedPnl: 50 },
  });
  const beforeBoundary = trade({
    id: 'before-boundary', soldDate: '2026-01-01', expiration: '2027-01-15', status: 'closed',
    closeDate: '2026-05-30', soldPrice: 4, closePrice: 1,
  });
  const unavailable = trade({
    id: 'unavailable', soldDate: '2026-06-05', expiration: '2026-07-17', status: 'expired_price_pending',
    resolutionType: 'expired_price_pending',
  });
  const rows = [origin, boundaryEarlyClose, negative, zeroPremium, finitePnlWithoutRisk, unavailablePremium, beforeBoundary, unavailable];
  const included = [boundaryEarlyClose, negative, zeroPremium, finitePnlWithoutRisk, unavailablePremium];

  assert.equal(canonicalHistoricalRealizedDate(boundaryEarlyClose), '2026-05-31', 'early close dates the event before expiration');
  assert.equal(historyRealizedPnl(unavailable), null, 'unavailable resolved economics are not in the History population');
  assert.deepEqual(included.map(historyRealizedPnl), [200, -200, 0, 100, 50]);

  const point = terminalPoint(buildRollingHistoricalAnalyticsSeries(rows, 'blendedCapture', 3, asOf));
  assert.equal(point.requestedWindowStart, '2026-05-31');
  assert.equal(point.value, buildHistoryAnalytics(included).blendedCapture, 'the rolling value delegates to the canonical History aggregate');
  assert.equal(point.value, 1 / 4, 'unequal positive, negative, zero, and unavailable-Premium records reconcile by aggregate dollars');
  assert.equal(point.tradesIncluded, included.length, 'all finite realized P&L records in the inclusive window are counted');
  assert.equal(point.grossRiskRepresented, 20_000, 'only valid positive Gross Risk is represented without changing the included population');
});

test('Blended Capture does not change existing rolling metric eligibility or values', () => {
  const origin = trade({ id: 'origin', soldDate: '2025-01-01' });
  const realized = trade({
    id: 'realized', soldDate: '2026-06-01', expiration: '2026-07-01', status: 'closed',
    closeDate: '2026-06-16', soldPrice: 2, closePrice: 1, strike: 100,
  });
  const noRisk = trade({
    id: 'no-risk', soldDate: '2026-06-02', expiration: '2026-07-02', status: 'closed',
    closeDate: '2026-06-17', soldPrice: 2, closePrice: 1, strike: 0,
  });
  const rows = [origin, realized, noRisk];

  const realizedAy = terminalPoint(buildRollingHistoricalAnalyticsSeries(rows, 'realizedIrr', 3, asOf));
  assert.ok(Math.abs(realizedAy.value - historyRealizedIrr(realized)) < 1e-12);
  assert.equal(realizedAy.tradesIncluded, 1, 'Realized AY still excludes records without valid positive Gross Risk');

  const premium = terminalPoint(buildRollingHistoricalAnalyticsSeries(rows, 'premiumRunRate', 3, asOf));
  assert.equal(premium.value, 800, 'entry-dated Premium Run Rate remains unchanged');
});

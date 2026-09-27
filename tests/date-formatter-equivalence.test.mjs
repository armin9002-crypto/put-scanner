import test from 'node:test';
import assert from 'node:assert/strict';
import { usMarketDateIso } from '../shared/marketDate.js';
import { formatOptionLastTradeDate } from '../src/lib/format.ts';
import { buildExpirationPeriodRealizedPnl } from '../src/lib/portfolioHistoryAnalytics.ts';

test('cached date formatters preserve market-date and last-trade output', () => {
  const marketFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  });
  for (const value of [
    '2024-03-10T05:00:00Z', '2024-11-03T05:00:00Z',
    '2020-01-01T00:00:00Z', '2026-12-31T23:59:59.999Z',
    1_700_000_000, 1_700_000_000_000,
  ]) {
    const date = new Date(typeof value === 'number' && value < 10_000_000_000 ? value * 1000 : value);
    const parts = Object.fromEntries(marketFormatter.formatToParts(date).map(({ type, value: part }) => [type, part]));
    assert.equal(usMarketDateIso(value), `${parts.year}-${parts.month}-${parts.day}`);
  }

  const lastFormatter = new Intl.DateTimeFormat('en-US', {
    month: '2-digit', day: '2-digit', year: '2-digit', timeZone: 'America/New_York',
  });
  for (const value of [1_700_000_000, 1_700_000_000_000, Date.UTC(2024, 2, 10, 7)]) {
    assert.equal(formatOptionLastTradeDate(value), lastFormatter.format(new Date(value < 10_000_000_000 ? value * 1000 : value)));
  }
  assert.equal(formatOptionLastTradeDate(null), '—');
  assert.equal(formatOptionLastTradeDate(Date.now() + 86_400_000), '—');
  for (const value of [null, NaN, Infinity, new Date(NaN), 'invalid', '2024-02-30']) {
    assert.equal(usMarketDateIso(value), null);
  }
  assert.equal(usMarketDateIso('2024-02-29'), '2024-02-29');
  for (const value of [undefined, NaN, Infinity, 0, -1]) assert.equal(formatOptionLastTradeDate(value), '—');
});

test('formatter reuse does not cache the current date or timestamp admission', t => {
  const midnight = Date.parse('2024-03-11T04:00:00Z');
  t.mock.timers.enable({ apis: ['Date'], now: midnight - 1 });
  assert.equal(usMarketDateIso(), '2024-03-10');
  assert.equal(formatOptionLastTradeDate(midnight), '—');
  t.mock.timers.tick(1);
  assert.equal(usMarketDateIso(), '2024-03-11');
  assert.equal(formatOptionLastTradeDate(midnight), '03/11/24');
});

test('cached expiration month formatter preserves month labels at year boundaries', () => {
  const trade = expiration => ({
    id: `trade-${expiration}`, ticker: 'TST', optionType: 'put', strike: 50,
    expiration, contracts: 1, soldPrice: 2, soldDate: `${expiration.slice(0, 4)}-01-02`,
    status: 'closed', closePrice: 1, closeDate: `${expiration.slice(0, 4)}-01-03`,
  });
  const dates = Array.from({ length: 12 }, (_, month) => `2024-${String(month + 1).padStart(2, '0')}-19`);
  const rows = buildExpirationPeriodRealizedPnl(dates.map(trade), 'month');
  assert.deepEqual(rows.map(row => row.label), dates.map(date => `${new Date(`${date}T00:00:00Z`).toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })} '24`));
});
